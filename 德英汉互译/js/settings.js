/**
 * ============================================================
 * settings.js — 设置管理模块
 * 职责：读写应用设置（API Key、保留天数、存储上限等）
 * 依赖：无（最底层模块，所有其他模块依赖它）
 * 存储位置：localStorage → app_settings
 * ============================================================
 */

// ---------- 默认设置 ----------
const DEFAULT_SETTINGS = {
  apiKey: '',              // DeepSeek API Key（用户必须自行填写）
  retentionDays: 3,        // 翻译记录保留天数：1 / 3 / 5
  lastCleanup: null,       // 上次自动清理的时间戳（null = 从未清理）
  lastCleanupCount: 0,     // 上次清理删除的记录数
  maxHistoryEntries: 500,  // 历史记录最大条数
  maxMemoryEntries: 500,   // 翻译记忆最大条数
  version: '1.0.0'         // 数据版本号（用于未来数据迁移）
};

// ---------- 数据读写核心函数 ----------

/**
 * 从 localStorage 读取全部设置
 * 如果数据不存在或损坏，返回默认设置
 * @returns {Object} 当前设置对象
 */
function getSettings() {
  try {
    const raw = localStorage.getItem('app_settings');
    if (!raw) {
      // 首次使用，写入默认设置
      saveSettings(DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    // 合并默认值：防止新增字段缺失
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    return merged;
  } catch (e) {
    // 数据损坏时重置为默认
    console.error('读取设置失败，已重置为默认值：', e);
    saveSettings(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * 保存设置到 localStorage
 * 使用 try-catch 保护，防止存储满导致崩溃
 * @param {Object} settings - 要保存的设置对象
 * @returns {boolean} 是否保存成功
 */
function saveSettings(settings) {
  try {
    localStorage.setItem('app_settings', JSON.stringify(settings));
    return true;
  } catch (e) {
    console.error('保存设置失败（存储可能已满）：', e);
    // 触发紧急清理：删除最旧20%的数据
    emergencyCleanup();
    try {
      // 重试一次
      localStorage.setItem('app_settings', JSON.stringify(settings));
      return true;
    } catch (e2) {
      console.error('重试保存设置依然失败：', e2);
      return false;
    }
  }
}

/**
 * 更新单项设置
 * @param {string} key - 设置项名称
 * @param {*} value - 新值
 */
function updateSetting(key, value) {
  const settings = getSettings();
  settings[key] = value;
  saveSettings(settings);
}

/**
 * 存储空间紧急清理
 * 当 localStorage 写满时，删除最旧20%的数据腾出空间
 */
function emergencyCleanup() {
  // 跨模块依赖安全设计：直接操作 localStorage，不依赖 memory.js / history.js
  // 因为 settings.js 是第一个加载的模块，此时其他模块可能尚未定义
  try {
    // 清理翻译记忆中最旧的20%
    const memRaw = localStorage.getItem('translator_memory');
    if (memRaw) {
      const memory = JSON.parse(memRaw);
      if (Array.isArray(memory) && memory.length > 20) {
        memory.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const keepCount = Math.floor(memory.length * 0.8);
        localStorage.setItem('translator_memory', JSON.stringify(memory.slice(0, keepCount)));
      }
    }

    // 清理历史记录中最旧的20%（保留置顶记录）
    const histRaw = localStorage.getItem('translation_history');
    if (histRaw) {
      const history = JSON.parse(histRaw);
      if (Array.isArray(history) && history.length > 20) {
        const pinned = history.filter(h => h.pinned);
        const unpinned = history.filter(h => !h.pinned);
        unpinned.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const keepCount = Math.floor(unpinned.length * 0.8);
        localStorage.setItem('translation_history', JSON.stringify([...pinned, ...unpinned.slice(0, keepCount)]));
      }
    }
  } catch (e) {
    console.error('紧急清理失败：', e);
  }
}

/**
 * 验证 API Key 格式
 * DeepSeek API Key 以 'sk-' 开头
 * @param {string} key - 要验证的 API Key
 * @returns {boolean} 格式是否有效
 */
function validateAPIKey(key) {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  return trimmed.length >= 30 && trimmed.startsWith('sk-');
}

/**
 * 获取存储空间使用情况的统计信息
 * @returns {Object} 各存储项的大小和条数
 */
function getStorageStats() {
  const stats = {};
  const keys = ['app_settings', 'translation_history', 'translator_memory', 'glossary_entries'];
  let totalBytes = 0;

  keys.forEach(key => {
    const raw = localStorage.getItem(key);
    const size = raw ? new Blob([raw]).size : 0;
    totalBytes += size;
    stats[key] = {
      sizeKB: (size / 1024).toFixed(2),
      count: raw ? (JSON.parse(raw).length || 1) : 0
    };
  });

  stats.totalKB = (totalBytes / 1024).toFixed(2);
  stats.totalMB = (totalBytes / 1024 / 1024).toFixed(2);
  // localStorage 一般限制 5-10MB
  stats.usagePercent = ((totalBytes / (5 * 1024 * 1024)) * 100).toFixed(1);

  return stats;
}

console.log('✅ settings.js 加载完毕');
