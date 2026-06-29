/**
 * ============================================================
 * memory.js — 翻译记忆缓存模块
 * 职责：缓存翻译结果，重复原文自动回填译文
 * 依赖：settings.js（读取 maxMemoryEntries 上限）
 * 存储位置：localStorage → translator_memory
 *
 * 查找逻辑：完全匹配（原文 + 源语言 + 目标语言 三者完全相同）
 * 淘汰策略：超过上限时删除最旧的非高频条目
 * ============================================================
 */

// ---------- 数据读写辅助 ----------

/**
 * 从 localStorage 读取全部翻译记忆
 * @returns {Array} 记忆条目数组
 */
function getMemoryData() {
  try {
    const raw = localStorage.getItem('translator_memory');
    if (!raw) {
      saveMemoryData([]);
      return [];
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error('读取翻译记忆失败：', e);
    saveMemoryData([]);
    return [];
  }
}

/**
 * 保存翻译记忆到 localStorage
 * @param {Array} data - 记忆条目数组
 */
function saveMemoryData(data) {
  try {
    localStorage.setItem('translator_memory', JSON.stringify(data));
  } catch (e) {
    console.error('保存翻译记忆失败：', e);
    // 尝试删除最旧条目后重试
    if (data.length > 50) {
      const trimmed = data.slice(0, Math.floor(data.length * 0.7));
      try {
        localStorage.setItem('translator_memory', JSON.stringify(trimmed));
      } catch (e2) {
        console.error('重试保存翻译记忆依然失败：', e2);
      }
    }
  }
}

// ---------- 记忆查找 ----------

/**
 * 在翻译记忆中查找匹配的缓存
 * 完全匹配：原文完全相同 + 语言对完全相同
 *
 * @param {string} text - 待翻译的原文
 * @param {string} sourceLang - 源语言代码
 * @param {string} targetLang - 目标语言代码
 * @returns {Object} { hit: bool, translatedText?: string, timestamp?: number }
 */
function lookupMemory(text, sourceLang, targetLang) {
  if (!text || !text.trim()) {
    return { hit: false };
  }

  const normalizedText = text.trim();
  const data = getMemoryData();

  // 遍历查找完全匹配（注意：localStorage不支持索引，500条以内遍历性能可接受）
  for (const entry of data) {
    if (
      entry.sourceText === normalizedText &&
      entry.sourceLang === sourceLang &&
      entry.targetLang === targetLang
    ) {
      // 命中！更新命中次数和时间戳
      entry.hitCount = (entry.hitCount || 0) + 1;
      entry.timestamp = Date.now();
      // 异步保存（不阻塞返回）
      setTimeout(() => saveMemoryData(data), 0);
      return {
        hit: true,
        translatedText: entry.translatedText,
        timestamp: entry.timestamp
      };
    }
  }

  return { hit: false };
}

/**
 * 模糊查找：忽略大小写和首尾标点后匹配
 * 在完全匹配失败后尝试
 *
 * @param {string} text - 待翻译的原文
 * @param {string} sourceLang - 源语言代码
 * @param {string} targetLang - 目标语言代码
 * @returns {Object} { hit: bool, translatedText?: string }
 */
function lookupMemoryFuzzy(text, sourceLang, targetLang) {
  if (!text || !text.trim()) return { hit: false };

  // 标准化：去除首尾标点、统一大小写
  const normalize = (str) => {
    return str.trim()
      .replace(/^[.,!?;:，。！？；：、""''「」『』【】\s]+/, '')
      .replace(/[.,!?;:，。！？；：、""''「」『』【】\s]+$/, '')
      .toLowerCase();
  };

  const normalizedText = normalize(text);
  const data = getMemoryData();

  for (const entry of data) {
    if (
      normalize(entry.sourceText) === normalizedText &&
      entry.sourceLang === sourceLang &&
      entry.targetLang === targetLang
    ) {
      // 模糊命中，更新时间戳
      entry.hitCount = (entry.hitCount || 0) + 1;
      entry.timestamp = Date.now();
      setTimeout(() => saveMemoryData(data), 0);
      return {
        hit: true,
        translatedText: entry.translatedText,
        timestamp: entry.timestamp,
        fuzzy: true
      };
    }
  }

  return { hit: false };
}

// ---------- 记忆保存 ----------

/**
 * 保存翻译结果到记忆缓存
 * 如果完全相同的原文已存在，更新译文和时间戳
 * 如果超过上限，删除最旧的条目
 *
 * @param {string} sourceText - 原文
 * @param {string} translatedText - 译文
 * @param {string} sourceLang - 源语言代码
 * @param {string} targetLang - 目标语言代码
 */
function saveMemory(sourceText, translatedText, sourceLang, targetLang) {
  if (!sourceText || !translatedText || !sourceLang || !targetLang) return;

  const normalizedSource = sourceText.trim();
  const normalizedTarget = translatedText.trim();
  if (!normalizedSource || !normalizedTarget) return;

  const data = getMemoryData();
  const settings = getSettings();
  const maxEntries = settings.maxMemoryEntries || 500;

  // 检查是否已存在相同条目（相同原文+语言对）
  const existingIdx = data.findIndex(
    e =>
      e.sourceText === normalizedSource &&
      e.sourceLang === sourceLang &&
      e.targetLang === targetLang
  );

  if (existingIdx !== -1) {
    // 更新已有条目
    data[existingIdx].translatedText = normalizedTarget;
    data[existingIdx].timestamp = Date.now();
    data[existingIdx].hitCount = (data[existingIdx].hitCount || 0) + 1;
  } else {
    // 添加新条目
    const entry = {
      hash: generateMemoryHash(normalizedSource, sourceLang, targetLang),
      sourceText: normalizedSource,
      translatedText: normalizedTarget,
      sourceLang: sourceLang,
      targetLang: targetLang,
      timestamp: Date.now(),
      hitCount: 0
    };
    data.push(entry);
  }

  // 按时间戳降序排列（新→旧）
  data.sort((a, b) => b.timestamp - a.timestamp);

  // 超过上限时，删除最旧的条目（保留前 maxEntries 条）
  if (data.length > maxEntries) {
    data.splice(maxEntries);
  }

  saveMemoryData(data);
}

/**
 * 生成记忆条目的简单哈希（用于调试和日志）
 * @param {string} text - 原文
 * @param {string} sourceLang - 源语言
 * @param {string} targetLang - 目标语言
 * @returns {string} 哈希字符串
 */
function generateMemoryHash(text, sourceLang, targetLang) {
  // 简单哈希：取前50字符 + 语言对 + 长度
  const prefix = text.substring(0, 50);
  const raw = `${prefix}|${sourceLang}|${targetLang}|${text.length}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * 获取翻译记忆统计信息
 * @returns {Object} { totalEntries, oldestEntry, newestEntry }
 */
function getMemoryStats() {
  const data = getMemoryData();
  if (data.length === 0) {
    return { totalEntries: 0, oldestEntry: null, newestEntry: null };
  }

  const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
  return {
    totalEntries: data.length,
    oldestEntry: sorted[0].timestamp,
    newestEntry: sorted[sorted.length - 1].timestamp
  };
}

/**
 * 删除过期的翻译记忆（由 cleanup.js 调用）
 * @param {number} cutoffTimestamp - 截止时间戳，早于此时间的条目将被删除
 * @returns {number} 删除的条目数量
 */
function cleanupExpiredMemory(cutoffTimestamp) {
  const data = getMemoryData();
  const before = data.length;
  const filtered = data.filter(e => e.timestamp >= cutoffTimestamp);
  const deleted = before - filtered.length;
  if (deleted > 0) {
    saveMemoryData(filtered);
  }
  return deleted;
}

console.log('✅ memory.js 加载完毕');
