/**
 * ============================================================
 * cleanup.js — 自动清理模块
 * 职责：按用户设置的保留天数（1/3/5天），自动删除过期记录
 * 依赖：settings.js（读取保留天数）、memory.js（清理记忆缓存）、
 *       history.js（清理历史记录）
 *
 * 清理策略：
 *   - 每次页面加载时检查一次
 *   - 用户可手动触发"立即清理"
 *   - 置顶记录永不过期
 *   - 术语表不受清理影响
 * ============================================================
 */

// 清理检查间隔（毫秒）：24小时
const CLEANUP_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

// 定时器ID
let cleanupTimerId = null;

// ---------- 初始化 ----------

/**
 * 初始化自动清理调度器
 * 页面加载时调用一次，然后每24小时检查一次
 */
function initCleanupScheduler() {
  // 页面加载时立即检查一次
  runCleanup();

  // 设置定期检查（每24小时）
  if (cleanupTimerId) {
    clearInterval(cleanupTimerId);
  }

  cleanupTimerId = setInterval(() => {
    runCleanup();
  }, CLEANUP_CHECK_INTERVAL);

  console.log('✅ 自动清理调度器已启动');
}

// ---------- 核心清理逻辑 ----------

/**
 * 执行清理操作
 * 根据用户设置的保留天数，删除过期数据
 *
 * @returns {Object} { historyDeleted, memoryDeleted, totalDeleted }
 */
function runCleanup() {
  const settings = getSettings();
  const retentionDays = settings.retentionDays || 3; // 默认3天

  // 计算截止时间戳：当前时间 - 保留天数
  const now = Date.now();
  const cutoffTimestamp = now - (retentionDays * 24 * 60 * 60 * 1000);

  let historyDeleted = 0;
  let memoryDeleted = 0;

  // ---- 1. 清理过期历史记录 ----
  try {
    historyDeleted = cleanupExpiredHistory(cutoffTimestamp);
  } catch (e) {
    console.error('清理过期历史记录失败：', e);
  }

  // ---- 2. 清理过期翻译记忆 ----
  try {
    memoryDeleted = cleanupExpiredMemory(cutoffTimestamp);
  } catch (e) {
    console.error('清理过期翻译记忆失败：', e);
  }

  const totalDeleted = historyDeleted + memoryDeleted;

  // ---- 3. 更新清理记录 ----
  settings.lastCleanup = now;
  settings.lastCleanupCount = totalDeleted;
  try {
    saveSettings(settings);
  } catch (e) {
    console.error('保存清理记录失败：', e);
  }

  // ---- 4. 日志 ----
  if (totalDeleted > 0) {
    console.log(
      `🧹 自动清理完成：删除 ${historyDeleted} 条历史记录 + ${memoryDeleted} 条翻译记忆 ` +
      `（保留天数：${retentionDays}天，截止时间：${formatTimestamp(cutoffTimestamp)}）`
    );
  } else {
    console.log('🧹 自动清理检查：无过期数据');
  }

  return { historyDeleted, memoryDeleted, totalDeleted };
}

/**
 * 手动触发立即清理（用户点击按钮）
 * 清理后显示结果并刷新UI
 */
function forceCleanup() {
  const settings = getSettings();
  const retentionDays = settings.retentionDays || 3;

  const result = runCleanup();

  if (result.totalDeleted > 0) {
    showToast(
      `已清理 ${result.totalDeleted} 条过期记录（保留天数：${retentionDays}天）`,
      'success'
    );
  } else {
    showToast(
      `没有需要清理的记录（保留天数：${retentionDays}天）`,
      'info'
    );
  }

  // 刷新历史列表
  if (typeof renderHistoryList === 'function') {
    renderHistoryList();
  }

  // 刷新存储状态
  if (typeof updateStorageStatsUI === 'function') {
    updateStorageStatsUI();
  }

  return result;
}

// ---------- 下一次清理时间 ----------

/**
 * 获取距离下一次自动清理的大概时间
 * @returns {string} 人类可读的时间描述
 */
function getNextCleanupTime() {
  const settings = getSettings();
  if (!settings.lastCleanup) {
    return '尚未执行过自动清理';
  }

  const nextCleanup = settings.lastCleanup + CLEANUP_CHECK_INTERVAL;
  const remaining = nextCleanup - Date.now();

  if (remaining <= 0) {
    return '即将进行下一次清理';
  }

  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

  if (hours > 0) {
    return `约 ${hours} 小时 ${minutes} 分钟后`;
  } else {
    return `约 ${minutes} 分钟后`;
  }
}

/**
 * 获取保留天数的可读描述
 * @param {number} days - 天数
 * @returns {string} 中文描述
 */
function getRetentionDescription(days) {
  const descriptions = {
    1: '保留1天内的翻译记录，超时自动清理',
    3: '保留3天内的翻译记录，超时自动清理（推荐）',
    5: '保留5天内的翻译记录，超时自动清理'
  };
  return descriptions[days] || `保留${days}天`;
}

// ---------- 销毁 ----------

/**
 * 停止自动清理定时器
 * （目前不需要主动调用，预留接口）
 */
function stopCleanupScheduler() {
  if (cleanupTimerId) {
    clearInterval(cleanupTimerId);
    cleanupTimerId = null;
    console.log('🛑 自动清理调度器已停止');
  }
}

console.log('✅ cleanup.js 加载完毕');
