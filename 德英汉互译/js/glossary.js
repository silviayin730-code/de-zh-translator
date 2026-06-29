/**
 * ============================================================
 * glossary.js — 自定义术语表模块
 * 职责：术语的增删改查、按语言对匹配、长词优先匹配引擎
 * 依赖：settings.js（读 localStorage 存取配置）
 * 存储位置：localStorage → glossary_entries
 * ============================================================
 */

// ---------- 数据读写辅助 ----------

/**
 * 从 localStorage 读取全部术语
 * @returns {Array} 术语数组
 */
function getGlossaryData() {
  try {
    const raw = localStorage.getItem('glossary_entries');
    if (!raw) {
      saveGlossaryData([]);
      return [];
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error('读取术语表失败：', e);
    saveGlossaryData([]);
    return [];
  }
}

/**
 * 保存术语数组到 localStorage
 * @param {Array} data - 术语数组
 */
function saveGlossaryData(data) {
  try {
    localStorage.setItem('glossary_entries', JSON.stringify(data));
  } catch (e) {
    console.error('保存术语表失败：', e);
  }
}

// ---------- 术语 CRUD ----------

/**
 * 生成唯一ID
 * @param {string} prefix - ID前缀
 * @returns {string} 唯一ID
 */
function generateID(prefix) {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

/**
 * 添加术语条目
 * @param {string} source - 源词
 * @param {string} target - 目标词
 * @param {string} sourceLang - 源语言代码（de/en/zh）
 * @param {string} targetLang - 目标语言代码
 * @param {number} priority - 优先级（数字越大越优先，默认1）
 * @returns {Object} { success: bool, message: string, entry?: object }
 */
function addGlossaryEntry(source, target, sourceLang, targetLang, priority = 1) {
  // 校验：不能为空
  const src = (source || '').trim();
  const tgt = (target || '').trim();
  if (!src || !tgt) {
    return { success: false, message: '源词和目标词不能为空' };
  }

  // 校验：长度限制
  if (src.length > 200 || tgt.length > 200) {
    return { success: false, message: '单条术语不能超过200个字符' };
  }

  // 校验：源语言和目标语言不能相同
  if (sourceLang === targetLang) {
    return { success: false, message: '源语言和目标语言不能相同' };
  }

  // 校验：不能与已有术语重复（相同源词 + 相同语言对）
  const data = getGlossaryData();
  const duplicate = data.find(
    e => e.source === src && e.sourceLang === sourceLang && e.targetLang === targetLang
  );
  if (duplicate) {
    return { success: false, message: `术语"${src}"在此语言对中已存在` };
  }

  // 创建新术语
  const entry = {
    id: generateID('g'),
    source: src,
    target: tgt,
    sourceLang: sourceLang,
    targetLang: targetLang,
    priority: priority
  };

  data.push(entry);
  saveGlossaryData(data);
  return { success: true, message: '术语添加成功', entry: entry };
}

/**
 * 更新术语条目
 * @param {string} id - 术语ID
 * @param {Object} newData - 要更新的字段 { source?, target?, sourceLang?, targetLang?, priority? }
 * @returns {Object} { success: bool, message: string }
 */
function updateGlossaryEntry(id, newData) {
  const data = getGlossaryData();
  const idx = data.findIndex(e => e.id === id);
  if (idx === -1) {
    return { success: false, message: '未找到该术语' };
  }

  // 校验更新后的数据
  if (newData.source !== undefined) {
    if (!newData.source.trim()) return { success: false, message: '源词不能为空' };
    data[idx].source = newData.source.trim();
  }
  if (newData.target !== undefined) {
    if (!newData.target.trim()) return { success: false, message: '目标词不能为空' };
    data[idx].target = newData.target.trim();
  }
  if (newData.sourceLang !== undefined) data[idx].sourceLang = newData.sourceLang;
  if (newData.targetLang !== undefined) data[idx].targetLang = newData.targetLang;
  if (newData.priority !== undefined) data[idx].priority = newData.priority;

  saveGlossaryData(data);
  return { success: true, message: '术语更新成功' };
}

/**
 * 删除单条术语
 * @param {string} id - 术语ID
 */
function deleteGlossaryEntry(id) {
  const data = getGlossaryData();
  const filtered = data.filter(e => e.id !== id);
  if (filtered.length === data.length) {
    return { success: false, message: '未找到该术语' };
  }
  saveGlossaryData(filtered);
  return { success: true, message: '术语已删除' };
}

/**
 * 批量删除术语
 * @param {string[]} ids - 术语ID数组
 */
function batchDeleteGlossary(ids) {
  const data = getGlossaryData();
  const idSet = new Set(ids);
  const filtered = data.filter(e => !idSet.has(e.id));
  const deleted = data.length - filtered.length;
  saveGlossaryData(filtered);
  return { success: true, message: `已删除 ${deleted} 条术语` };
}

/**
 * 获取所有术语（可接可选过滤）
 * @param {string} [keyword] - 按关键字搜索源词或目标词
 * @param {string} [sourceLang] - 按源语言过滤
 * @param {string} [targetLang] - 按目标语言过滤
 * @returns {Array} 过滤后的术语数组
 */
function getGlossary(keyword, sourceLang, targetLang) {
  let data = getGlossaryData();

  // 按语言对过滤
  if (sourceLang) {
    data = data.filter(e => e.sourceLang === sourceLang);
  }
  if (targetLang) {
    data = data.filter(e => e.targetLang === targetLang);
  }

  // 按关键字搜索（不区分大小写）
  if (keyword && keyword.trim()) {
    const kw = keyword.trim().toLowerCase();
    data = data.filter(
      e => e.source.toLowerCase().includes(kw) || e.target.toLowerCase().includes(kw)
    );
  }

  // 按优先级降序排序
  data.sort((a, b) => b.priority - a.priority);

  return data;
}

// ---------- 术语匹配引擎 ----------

/**
 * 核心函数：在原文中匹配术语
 * 算法：1) 获取该语言对全部术语 2) 按长度降序排列（长词优先，避免"机器"误匹配"机器学习"）
 *       3) 顺序扫描原文，标记匹配位置 4) 返回匹配结果列表
 *
 * @param {string} text - 待翻译的原文
 * @param {string} sourceLang - 源语言代码
 * @param {string} targetLang - 目标语言代码
 * @returns {Object} { matchedTerms: Array, hasMatch: boolean }
 *   matchedTerms: [{ source, target, position, priority }]
 */
function matchGlossary(text, sourceLang, targetLang) {
  if (!text || !text.trim()) {
    return { matchedTerms: [], hasMatch: false };
  }

  // 获取该语言对的所有术语
  const entries = getGlossaryData().filter(
    e => e.sourceLang === sourceLang && e.targetLang === targetLang
  );

  if (entries.length === 0) {
    return { matchedTerms: [], hasMatch: false };
  }

  // 按术语源词长度降序排列（长词优先匹配）
  entries.sort((a, b) => b.source.length - a.source.length);

  const matchedTerms = [];
  const usedPositions = new Set(); // 防止同一位置被多个术语匹配

  // 对每个术语，在原文中查找所有出现位置
  for (const entry of entries) {
    const searchStr = entry.source;
    let startPos = 0;

    while (startPos < text.length) {
      const idx = text.indexOf(searchStr, startPos);
      if (idx === -1) break;

      // 检查该位置是否已被更长的术语占用
      let positionConflict = false;
      for (let i = idx; i < idx + searchStr.length; i++) {
        if (usedPositions.has(i)) {
          positionConflict = true;
          break;
        }
      }

      if (!positionConflict) {
        // 标记该位置已被占用
        for (let i = idx; i < idx + searchStr.length; i++) {
          usedPositions.add(i);
        }
        matchedTerms.push({
          id: entry.id,
          source: entry.source,
          target: entry.target,
          position: idx,
          length: searchStr.length,
          priority: entry.priority
        });
      }

      startPos = idx + searchStr.length;
    }
  }

  // 按在原文中的位置升序排列
  matchedTerms.sort((a, b) => a.position - b.position);

  return {
    matchedTerms: matchedTerms,
    hasMatch: matchedTerms.length > 0
  };
}

/**
 * 用匹配的术语替换原文中的对应内容
 * 用于在发送给API前预处理（可选策略：直接替换 vs 作为prompt参考）
 * 本工具采用"Prompt注入"策略：不在原文中替换，而是在system prompt中列出术语表
 * 此函数保留作为备选方案
 *
 * @param {string} text - 原文
 * @param {Array} matchedTerms - matchGlossary()的返回结果
 * @returns {string} 替换后的文本
 */
function applyGlossaryToText(text, matchedTerms) {
  if (!matchedTerms || matchedTerms.length === 0) return text;

  // 从后往前替换（避免位置偏移）
  const sorted = [...matchedTerms].sort((a, b) => b.position - a.position);
  let result = text;

  for (const term of sorted) {
    const before = result.substring(0, term.position);
    const after = result.substring(term.position + term.length);
    // 用特殊标记包裹术语（帮助API识别）
    result = before + `【术语：${term.target}】` + after;
  }

  return result;
}

/**
 * 将匹配到的术语格式化为Prompt中使用的文本
 * @param {Array} matchedTerms - 匹配结果
 * @returns {string} 格式化后的术语表文本
 */
function formatGlossaryForPrompt(matchedTerms) {
  if (!matchedTerms || matchedTerms.length === 0) return '';

  // 去重（同一target只保留一次）
  const seen = new Set();
  const unique = matchedTerms.filter(t => {
    const key = `${t.source}|${t.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique
    .map(t => `${t.source} → ${t.target}`)
    .join('\n');
}

console.log('✅ glossary.js 加载完毕');
