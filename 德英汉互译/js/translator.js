/**
 * ============================================================
 * translator.js — 翻译核心模块
 * 职责：DeepSeek V4 Pro API 调用、流式/非流式翻译、Prompt构建
 * 依赖：settings.js（API Key）、memory.js（缓存查找/保存）、
 *       glossary.js（术语匹配/注入Prompt）
 *
 * 翻译流程：
 *   输入文本 → 查术语表 → 查记忆缓存 → 命中→直接返回
 *     └→ 未命中 → 构建Prompt → 调API → 存记忆 → 返回译文
 * ============================================================
 */

// ---------- 配置常量 ----------

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const API_TIMEOUT_MS = 30000;       // 30秒超时
const MAX_CHARS_PER_REQUEST = 5000; // 单次翻译最大字符数（超长时分段）
const STREAMING_DEBOUNCE_MS = 300;  // 实时翻译防抖毫秒

// ---------- 语言名称映射 ----------

/**
 * 语言代码 → 中文名称 映射表
 */
const LANG_NAMES = {
  'de': '德语',
  'en': '英语',
  'zh': '中文'
};

/**
 * 将语言代码转为中文名称
 * @param {string} code - 语言代码
 * @returns {string} 中文名称
 */
function langName(code) {
  return LANG_NAMES[code] || code;
}

// ---------- 核心翻译函数 ----------

/**
 * 翻译文本（非流式，完整返回）
 *
 * @param {string} text - 待翻译的原文
 * @param {string} sourceLang - 源语言代码（de/en/zh）
 * @param {string} targetLang - 目标语言代码
 * @param {Object} options - 可选配置
 *   { signal: AbortSignal, skipMemory: bool, skipGlossary: bool }
 * @returns {Promise<Object>}
 *   成功：{ success: true, translatedText: string, fromCache: bool }
 *   失败：{ success: false, error: string, message: string }
 */
async function translateText(text, sourceLang, targetLang, options = {}) {
  // ---- 1. 校验输入 ----
  if (!text || !text.trim()) {
    return { success: false, error: 'EMPTY_INPUT', message: '请输入要翻译的文本' };
  }

  if (sourceLang === targetLang) {
    return { success: false, error: 'SAME_LANG', message: '源语言和目标语言不能相同' };
  }

  const normalizedText = text.trim();

  // ---- 2. 查术语表 ----
  let glossaryResult = { matchedTerms: [], hasMatch: false };
  if (!options.skipGlossary) {
    glossaryResult = matchGlossary(normalizedText, sourceLang, targetLang);
  }

  // ---- 3. 查翻译记忆缓存 ----
  if (!options.skipMemory) {
    // 先尝试完全匹配
    let memResult = lookupMemory(normalizedText, sourceLang, targetLang);

    // 完全匹配失败，尝试模糊匹配
    if (!memResult.hit) {
      memResult = lookupMemoryFuzzy(normalizedText, sourceLang, targetLang);
    }

    if (memResult.hit) {
      // 缓存命中，直接返回！
      return {
        success: true,
        translatedText: memResult.translatedText,
        fromCache: true,
        fuzzy: memResult.fuzzy || false,
        matchedTerms: glossaryResult.matchedTerms
      };
    }
  }

  // ---- 4. 超长文本分段处理 ----
  if (normalizedText.length > MAX_CHARS_PER_REQUEST) {
    return await translateLongText(normalizedText, sourceLang, targetLang,
                                   glossaryResult, options);
  }

  // ---- 5. 构建 Prompt 并调用 API ----
  try {
    const messages = buildTranslationMessages(
      normalizedText, sourceLang, targetLang, glossaryResult.matchedTerms
    );

    const translatedText = await callDeepSeekAPI(messages, {
      stream: false,
      signal: options.signal || null
    });

    // ---- 6. 保存到翻译记忆 ----
    saveMemory(normalizedText, translatedText, sourceLang, targetLang);

    return {
      success: true,
      translatedText: translatedText,
      fromCache: false,
      matchedTerms: glossaryResult.matchedTerms
    };

  } catch (error) {
    // ---- 7. 错误分类处理 ----
    return handleTranslationError(error);
  }
}

/**
 * 流式翻译（用于实时字幕）
 * 每收到新的文本块时调用 onChunk 回调
 *
 * @param {string} text - 待翻译的原文
 * @param {string} sourceLang - 源语言代码
 * @param {string} targetLang - 目标语言代码
 * @param {Function} onChunk - 回调函数 (partialText: string)
 * @param {AbortSignal} signal - 中断信号（用于取消上一个未完成的请求）
 * @returns {Promise<Object>} 最终结果
 */
async function translateTextStreaming(text, sourceLang, targetLang, onChunk, signal) {
  // 校验输入
  if (!text || !text.trim()) {
    onChunk('');
    return { success: false, error: 'EMPTY_INPUT' };
  }

  if (sourceLang === targetLang) {
    return { success: false, error: 'SAME_LANG' };
  }

  const normalizedText = text.trim();

  // 先查缓存
  const memResult = lookupMemory(normalizedText, sourceLang, targetLang);
  if (memResult.hit) {
    onChunk(memResult.translatedText);
    return { success: true, translatedText: memResult.translatedText, fromCache: true };
  }

  // 获取术语匹配
  const glossaryResult = matchGlossary(normalizedText, sourceLang, targetLang);

  // 构建消息
  const messages = buildTranslationMessages(
    normalizedText, sourceLang, targetLang, glossaryResult.matchedTerms
  );

  try {
    // 流式API调用
    const fullText = await callDeepSeekAPIStreaming(messages, onChunk, signal);

    // 保存记忆
    if (fullText) {
      saveMemory(normalizedText, fullText, sourceLang, targetLang);
    }

    return { success: true, translatedText: fullText, fromCache: false };

  } catch (error) {
    return handleTranslationError(error);
  }
}

// ---------- 超长文本分段翻译 ----------

/**
 * 将超长文本按段落分割后逐段翻译，显示进度
 *
 * @param {string} text - 超长原文
 * @param {string} sourceLang - 源语言
 * @param {string} targetLang - 目标语言
 * @param {Object} glossaryResult - 术语匹配结果
 * @param {Object} options - 可选项
 * @returns {Promise<Object>} 合并后的翻译结果
 */
async function translateLongText(text, sourceLang, targetLang, glossaryResult, options) {
  // 按段落（\n\n）分割
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());
  const segments = [];

  // 将段落进一步组合，使每段不超过 MAX_CHARS_PER_REQUEST
  let currentSegment = '';
  for (const para of paragraphs) {
    if (currentSegment.length + para.length + 2 <= MAX_CHARS_PER_REQUEST) {
      currentSegment += (currentSegment ? '\n\n' : '') + para;
    } else {
      if (currentSegment) segments.push(currentSegment);
      // 如果单个段落还是太长，按句子分
      if (para.length > MAX_CHARS_PER_REQUEST) {
        const subSegments = splitLongParagraph(para, MAX_CHARS_PER_REQUEST);
        segments.push(...subSegments);
      } else {
        currentSegment = para;
      }
    }
  }
  if (currentSegment) segments.push(currentSegment);

  // 逐段翻译
  const translatedParts = [];
  for (let i = 0; i < segments.length; i++) {
    // 报告进度（通过全局事件）
    if (typeof updateProgress === 'function') {
      updateProgress(i + 1, segments.length);
    }

    const messages = buildTranslationMessages(
      segments[i], sourceLang, targetLang, glossaryResult.matchedTerms
    );

    try {
      const result = await callDeepSeekAPI(messages, {
        stream: false,
        signal: options.signal || null
      });
      translatedParts.push(result);

      // 逐段保存记忆
      saveMemory(segments[i], result, sourceLang, targetLang);
    } catch (e) {
      translatedParts.push(`[翻译失败: ${e.message}]`);
    }
  }

  // 隐藏进度条
  if (typeof hideProgress === 'function') {
    hideProgress();
  }

  const merged = translatedParts.join('\n\n');

  // 不保存超长文本的完整记忆（节省空间）
  // 但各段已分别保存

  return {
    success: true,
    translatedText: merged,
    fromCache: false,
    segmented: true,
    totalSegments: segments.length
  };
}

/**
 * 将超长段落按句子边界分割
 */
function splitLongParagraph(paragraph, maxLen) {
  const sentences = paragraph.split(/(?<=[.!?。！？\n])/);
  const chunks = [];
  let current = '';

  for (const sent of sentences) {
    if (current.length + sent.length <= maxLen) {
      current += sent;
    } else {
      if (current) chunks.push(current);
      // 如果单句还是超长，强制截断
      if (sent.length > maxLen) {
        for (let i = 0; i < sent.length; i += maxLen) {
          chunks.push(sent.substring(i, i + maxLen));
        }
      } else {
        current = sent;
      }
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

// ---------- Prompt 构建 ----------

/**
 * 构建发送给 DeepSeek API 的 messages 数组
 *
 * @param {string} text - 待翻译文本
 * @param {string} sourceLang - 源语言代码
 * @param {string} targetLang - 目标语言代码
 * @param {Array} matchedTerms - 匹配到的术语列表
 * @returns {Array} OpenAI格式的 messages 数组
 */
function buildTranslationMessages(text, sourceLang, targetLang, matchedTerms) {
  const sourceName = langName(sourceLang);
  const targetName = langName(targetLang);

  // ---- System Prompt ----
  let systemPrompt = `你是一位专业的${sourceName}-${targetName}翻译专家。请严格按照以下规则进行翻译：

1. **只输出翻译结果**，不要添加任何解释、注释或额外内容
2. **保持原文格式**：保留换行、分段、标点风格
3. **术语优先**：如果提供了"优先术语表"，必须使用术语表中指定的译法
4. **专业准确**：确保专业术语翻译准确，语气自然流畅
5. **直接翻译**：不需要先说"翻译如下："之类的引导语，直接给出译文`;

  // ---- 注入术语表 ----
  const glossaryText = formatGlossaryForPrompt(matchedTerms);
  if (glossaryText) {
    systemPrompt += `\n\n## 优先术语表（必须使用以下译法）：\n${glossaryText}`;
  }

  // ---- User Message ----
  const userMessage = `将以下${sourceName}文本翻译成${targetName}：\n\n${text}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];
}

// ---------- API 调用 ----------

/**
 * 调用 DeepSeek V4 Pro API（非流式）
 *
 * @param {Array} messages - messages 数组
 * @param {Object} options - { stream, signal }
 * @returns {Promise<string>} 翻译后的文本
 */
async function callDeepSeekAPI(messages, options = {}) {
  const settings = getSettings();

  // 校验 API Key
  if (!settings.apiKey || !settings.apiKey.trim()) {
    throw { type: 'NO_API_KEY', message: '请先在设置中配置 DeepSeek API Key' };
  }

  if (!settings.apiKey.startsWith('sk-')) {
    throw { type: 'INVALID_API_KEY', message: 'API Key 格式无效（应以 sk- 开头）' };
  }

  // 创建 AbortController 用于超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  // 如果外部传入了 signal，合并信号
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: messages,
        temperature: 0.3,           // 低温保持翻译一致性
        max_tokens: 4096,
        stream: false,
        // thinking 模式禁用（翻译不需要推理链）
        thinking: { type: 'disabled' }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // ---- 处理 HTTP 错误 ----
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (response.status === 401) {
        throw { type: 'API_KEY_INVALID', message: 'API Key 无效，请在设置中检查', status: 401 };
      }
      if (response.status === 429) {
        throw { type: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试', status: 429 };
      }
      if (response.status >= 500) {
        throw { type: 'SERVER_ERROR', message: '翻译服务暂时不可用，请稍后重试', status: response.status };
      }
      throw { type: 'HTTP_ERROR', message: `请求失败 (${response.status})`, status: response.status };
    }

    // ---- 解析响应 ----
    const data = await response.json();

    // 验证响应结构
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw { type: 'BAD_RESPONSE', message: 'API 返回数据格式异常' };
    }

    const content = data.choices[0].message.content;
    if (!content || !content.trim()) {
      throw { type: 'EMPTY_RESPONSE', message: '翻译结果为空，请重试' };
    }

    return content.trim();

  } catch (error) {
    clearTimeout(timeoutId);

    // 超时错误
    if (error.name === 'AbortError') {
      throw { type: 'TIMEOUT', message: '请求超时，请检查网络连接后重试' };
    }

    // 网络错误
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw { type: 'NETWORK_ERROR', message: '网络连接失败，请检查网络' };
    }

    // 已经是我们自定义的错误对象，直接抛出
    if (error.type) throw error;

    // 未知错误
    throw { type: 'UNKNOWN', message: error.message || '未知错误', originalError: error };
  }
}

/**
 * 调用 DeepSeek V4 Pro API（流式）
 * 逐个 chunk 调用 onChunk 回调，返回完整文本
 *
 * @param {Array} messages - messages 数组
 * @param {Function} onChunk - 每收到文本块时的回调
 * @param {AbortSignal} signal - 外部中断信号
 * @returns {Promise<string>} 完整的翻译文本
 */
async function callDeepSeekAPIStreaming(messages, onChunk, signal) {
  const settings = getSettings();

  if (!settings.apiKey || !settings.apiKey.trim()) {
    throw { type: 'NO_API_KEY', message: '请先配置 API Key' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: messages,
        temperature: 0.3,
        max_tokens: 4096,
        stream: true,
        thinking: { type: 'disabled' }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (response.status === 401) throw { type: 'API_KEY_INVALID', message: 'API Key 无效' };
      if (response.status === 429) throw { type: 'RATE_LIMITED', message: '请求过于频繁' };
      throw { type: 'HTTP_ERROR', message: `请求失败 (${response.status})` };
    }

    // 读取流式响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 解析SSE格式：data: {...}\n\n
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 最后一行可能不完整，保留到下次

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const jsonStr = trimmed.substring(6); // 去掉 "data: " 前缀
        if (jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk(fullText); // 传递累积文本
          }
        } catch (e) {
          // 忽略无法解析的行
        }
      }
    }

    return fullText;

  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw { type: 'TIMEOUT', message: '请求超时' };
    }
    if (error.type) throw error;
    throw { type: 'UNKNOWN', message: error.message };
  }
}

// ---------- 错误处理 ----------

/**
 * 将各类错误转为统一的返回格式
 * @param {Object} error - 错误对象
 * @returns {Object} { success: false, error, message }
 */
function handleTranslationError(error) {
  const errorMap = {
    'NO_API_KEY':        { type: 'NO_API_KEY',        msg: '请先在设置中配置 DeepSeek API Key' },
    'API_KEY_INVALID':   { type: 'API_KEY_INVALID',   msg: 'API Key 无效，请在设置中检查并重新输入' },
    'INVALID_API_KEY':   { type: 'INVALID_API_KEY',   msg: 'API Key 格式无效（应以 sk- 开头）' },
    'RATE_LIMITED':      { type: 'RATE_LIMITED',      msg: '请求过于频繁，请稍后重试（3秒后自动重试）' },
    'SERVER_ERROR':      { type: 'SERVER_ERROR',      msg: '翻译服务暂时不可用，请稍后重试' },
    'TIMEOUT':           { type: 'TIMEOUT',           msg: '请求超时（30秒），请检查网络连接后重试' },
    'NETWORK_ERROR':     { type: 'NETWORK_ERROR',     msg: '网络连接失败，请检查网络是否正常' },
    'BAD_RESPONSE':      { type: 'BAD_RESPONSE',      msg: 'API 返回数据异常，请稍后重试' },
    'EMPTY_RESPONSE':    { type: 'EMPTY_RESPONSE',    msg: '翻译结果为空，请尝试重新翻译' },
    'EMPTY_INPUT':       { type: 'EMPTY_INPUT',       msg: '请输入要翻译的文本' },
    'SAME_LANG':         { type: 'SAME_LANG',         msg: '源语言和目标语言不能相同' }
  };

  const mapped = errorMap[error.type] || { type: 'UNKNOWN', msg: error.message || '未知错误' };

  return {
    success: false,
    error: mapped.type,
    message: mapped.msg
  };
}

// ---------- 防抖工具 ----------

/**
 * 防抖函数：在连续调用时只执行最后一次
 * 用于实时翻译：用户停止输入300ms后才发起API请求
 *
 * @param {Function} fn - 要执行的函数
 * @param {number} delay - 延迟毫秒数
 * @returns {Function} 防抖包装后的函数
 */
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
      timer = null;
    }, delay);
  };
}

// ---------- 简易语言检测 ----------

/**
 * 简易语言检测（启发式）
 * 检测文本中是否包含特定语言的字符
 *
 * @param {string} text - 要检测的文本
 * @returns {string|null} 检测到的语言代码，无法确定时返回 null
 */
function detectLanguage(text) {
  if (!text || !text.trim()) return null;

  // 检测中文字符
  const hasChinese = /[一-鿿㐀-䶿]/.test(text);
  if (hasChinese) return 'zh';

  // 检测德语特殊字符
  const hasGerman = /[äöüßÄÖÜ]/.test(text);
  if (hasGerman) return 'de';

  // 大部分为英文字母 → 英语（德语无特殊字符时可与英语混淆）
  const alphaRatio = (text.match(/[a-zA-Z]/g) || []).length / text.length;
  if (alphaRatio > 0.5) return 'en';

  return null;
}

console.log('✅ translator.js 加载完毕');
