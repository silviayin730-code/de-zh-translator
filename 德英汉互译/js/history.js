/**
 * ============================================================
 * history.js — 历史记录管理模块
 * 职责：翻译历史的增删改查、搜索、置顶、分页渲染
 * 依赖：settings.js（读取上限配置）
 * 存储位置：localStorage → translation_history
 *
 * 排序规则：置顶记录排最前 → 同一优先级按时间戳倒序
 * 分页：每页20条
 * 置顶上限：最多5条
 * ============================================================
 */

const PAGE_SIZE = 20;       // 每页显示20条
const MAX_PINNED = 5;       // 最多置顶5条

// 当前分页状态
let currentPage = 1;
let currentFilter = '';     // 当前搜索关键字
let currentSourceLang = ''; // 当前语言对过滤
let currentTargetLang = '';

// ---------- 数据读写辅助 ----------

/**
 * 从 localStorage 读取全部历史记录
 * @returns {Array} 历史记录数组
 */
function getHistoryData() {
  try {
    const raw = localStorage.getItem('translation_history');
    if (!raw) {
      saveHistoryData([]);
      return [];
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error('读取历史记录失败：', e);
    saveHistoryData([]);
    return [];
  }
}

/**
 * 保存历史记录到 localStorage
 * @param {Array} data - 历史记录数组
 */
function saveHistoryData(data) {
  try {
    localStorage.setItem('translation_history', JSON.stringify(data));
  } catch (e) {
    console.error('保存历史记录失败：', e);
    // 存储满时尝试删减最旧数据
    if (data.length > 50) {
      const pinned = data.filter(h => h.pinned);
      const unpinned = data.filter(h => !h.pinned);
      unpinned.sort((a, b) => b.timestamp - a.timestamp);
      const reduced = unpinned.slice(0, Math.floor(unpinned.length * 0.7));
      try {
        localStorage.setItem('translation_history', JSON.stringify([...pinned, ...reduced]));
      } catch (e2) {
        console.error('重试保存历史记录依然失败：', e2);
      }
    }
  }
}

// ---------- 历史记录 CRUD ----------

/**
 * 添加一条翻译历史
 *
 * @param {Object} entry - { sourceText, translatedText, sourceLang, targetLang, fromFile?, fromCache? }
 * @returns {Object} 创建的历史记录条目
 */
function addHistory(entry) {
  const data = getHistoryData();

  const newEntry = {
    id: generateID('h'),
    sourceText: entry.sourceText || '',
    translatedText: entry.translatedText || '',
    sourceLang: entry.sourceLang || '',
    targetLang: entry.targetLang || '',
    timestamp: Date.now(),
    pinned: false,
    fromFile: entry.fromFile || null,
    fromCache: entry.fromCache || false
  };

  data.push(newEntry);

  // 按时间戳倒序排列
  data.sort((a, b) => b.timestamp - a.timestamp);

  // 超过上限时删除最旧的条目
  const settings = getSettings();
  const maxEntries = settings.maxHistoryEntries || 500;
  if (data.length > maxEntries) {
    // 但保留所有置顶记录
    const pinned = data.filter(h => h.pinned);
    const unpinned = data.filter(h => !h.pinned);
    const keptUnpinned = unpinned.slice(0, maxEntries - pinned.length);
    saveHistoryData([...pinned, ...keptUnpinned]);
  } else {
    saveHistoryData(data);
  }

  return newEntry;
}

/**
 * 删除单条历史记录
 *
 * @param {string} id - 记录ID
 * @returns {Object} { success: bool, message: string }
 */
function deleteHistory(id) {
  const data = getHistoryData();
  const before = data.length;
  const filtered = data.filter(e => e.id !== id);

  if (filtered.length === before) {
    return { success: false, message: '未找到该记录' };
  }

  saveHistoryData(filtered);
  return { success: true, message: '记录已删除' };
}

/**
 * 清空全部历史记录
 * 保留置顶记录（可选）
 *
 * @param {boolean} keepPinned - 是否保留置顶记录
 * @returns {Object} { success: bool, message: string, deleted: number }
 */
function clearAllHistory(keepPinned = false) {
  const data = getHistoryData();
  let deleted = 0;

  if (keepPinned) {
    const kept = data.filter(h => h.pinned);
    deleted = data.length - kept.length;
    saveHistoryData(kept);
  } else {
    deleted = data.length;
    saveHistoryData([]);
  }

  return { success: true, message: `已清空 ${deleted} 条记录`, deleted: deleted };
}

/**
 * 切换记录的置顶状态
 *
 * @param {string} id - 记录ID
 * @returns {Object} { success: bool, message: string, pinned: bool }
 */
function togglePinHistory(id) {
  const data = getHistoryData();
  const entry = data.find(e => e.id === id);

  if (!entry) {
    return { success: false, message: '未找到该记录' };
  }

  if (!entry.pinned) {
    // 检查置顶数量上限
    const pinnedCount = data.filter(e => e.pinned).length;
    if (pinnedCount >= MAX_PINNED) {
      return { success: false, message: `最多只能置顶 ${MAX_PINNED} 条记录，请先取消其他置顶` };
    }
    entry.pinned = true;
  } else {
    entry.pinned = false;
  }

  saveHistoryData(data);
  return { success: true, message: entry.pinned ? '已置顶' : '已取消置顶', pinned: entry.pinned };
}

// ---------- 历史搜索与过滤 ----------

/**
 * 搜索历史记录（不区分大小写，在原文和译文中搜索）
 *
 * @param {string} keyword - 搜索关键字
 * @param {string} [sourceLang] - 按源语言过滤
 * @param {string} [targetLang] - 按目标语言过滤
 * @returns {Array} 匹配的历史记录（已排序）
 */
function searchHistory(keyword, sourceLang, targetLang) {
  let data = getHistoryData();

  // 按语言对过滤
  if (sourceLang) {
    data = data.filter(e => e.sourceLang === sourceLang);
  }
  if (targetLang) {
    data = data.filter(e => e.targetLang === targetLang);
  }

  // 按关键字过滤
  if (keyword && keyword.trim()) {
    const kw = keyword.trim().toLowerCase();
    data = data.filter(
      e =>
        e.sourceText.toLowerCase().includes(kw) ||
        e.translatedText.toLowerCase().includes(kw)
    );
  }

  // 排序：置顶优先 → 同优先级按时间倒序
  data.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.timestamp - a.timestamp;
  });

  return data;
}

/**
 * 获取分页数据
 *
 * @param {number} page - 页码（从1开始）
 * @param {number} pageSize - 每页条数
 * @param {string} keyword - 搜索关键字
 * @returns {Object} { entries, total, totalPages, page }
 */
function getHistoryPage(page, pageSize, keyword) {
  const filtered = searchHistory(
    keyword || currentFilter,
    currentSourceLang,
    currentTargetLang
  );

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / (pageSize || PAGE_SIZE)));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * (pageSize || PAGE_SIZE);
  const entries = filtered.slice(start, start + (pageSize || PAGE_SIZE));

  return { entries, total, totalPages, page: safePage };
}

// ---------- 历史统计 ----------

/**
 * 获取历史记录统计信息
 * @returns {Object} { total, pinned, dateRange }
 */
function getHistoryStats() {
  const data = getHistoryData();
  if (data.length === 0) {
    return { total: 0, pinned: 0, oldest: null, newest: null };
  }

  const sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);

  return {
    total: data.length,
    pinned: data.filter(h => h.pinned).length,
    oldest: sorted[0].timestamp,
    newest: sorted[sorted.length - 1].timestamp
  };
}

/**
 * 删除过期的历史记录（由 cleanup.js 调用）
 *
 * @param {number} cutoffTimestamp - 截止时间戳，早于此时间的记录将被删除
 * @returns {number} 删除的记录数量
 */
function cleanupExpiredHistory(cutoffTimestamp) {
  const data = getHistoryData();
  const before = data.length;

  // 保留：置顶记录 + 未过期记录
  const filtered = data.filter(
    e => e.pinned || e.timestamp >= cutoffTimestamp
  );

  const deleted = before - filtered.length;
  if (deleted > 0) {
    saveHistoryData(filtered);
  }
  return deleted;
}

// ---------- UI 渲染 ----------

/**
 * 渲染历史记录列表到页面
 * 读取当前搜索和分页状态
 */
function renderHistoryList() {
  const listContainer = document.getElementById('historyList');
  if (!listContainer) return;

  const { entries, total, totalPages, page } = getHistoryPage(
    currentPage, PAGE_SIZE, currentFilter
  );

  // 更新当前页
  currentPage = page;

  // 空状态
  if (entries.length === 0) {
    listContainer.innerHTML = '<p class="history-empty">暂无翻译记录</p>';
    updatePaginationUI(0, 1, 1);
    return;
  }

  // 构建HTML
  const html = entries.map(entry => {
    const timeStr = formatTimestamp(entry.timestamp);
    const sourceLangName = langName(entry.sourceLang);
    const targetLangName = langName(entry.targetLang);
    const fileBadge = entry.fromFile
      ? `<span class="history-file-badge">📄 ${escapeHTML(entry.fromFile)}</span>`
      : '';
    const cacheBadge = entry.fromCache
      ? `<span class="cache-badge" style="font-size:11px;">⚡ 缓存</span>`
      : '';

    return `
      <div class="history-item ${entry.pinned ? 'pinned' : ''}" data-id="${entry.id}">
        <div class="history-item-left">
          <div class="history-meta">
            ${entry.pinned ? '<span class="history-pin-badge">📌 置顶</span>' : ''}
            <span class="history-lang-badge">${sourceLangName} → ${targetLangName}</span>
            <span class="history-time">${timeStr}</span>
            ${fileBadge}
            ${cacheBadge}
          </div>
          <div class="history-source">${escapeHTML(entry.sourceText)}</div>
          <div class="history-target">${escapeHTML(entry.translatedText)}</div>
        </div>
        <div class="history-item-right">
          <button class="btn btn-sm" onclick="handlePinClick('${entry.id}')"
                  title="${entry.pinned ? '取消置顶' : '置顶'}">
            ${entry.pinned ? '📌 取消' : '📌 置顶'}
          </button>
          <button class="btn btn-sm btn-danger" onclick="handleDeleteClick('${entry.id}')"
                  title="删除此记录">
            🗑 删除
          </button>
        </div>
      </div>
    `;
  }).join('');

  listContainer.innerHTML = html;
  updatePaginationUI(total, totalPages, currentPage);
}

/**
 * 更新分页按钮状态
 */
function updatePaginationUI(total, totalPages, page) {
  const pagination = document.getElementById('historyPagination');
  const pageInfo = document.getElementById('pageInfo');
  const btnPrev = document.getElementById('btnPrevPage');
  const btnNext = document.getElementById('btnNextPage');

  if (!pagination) return;

  if (total <= PAGE_SIZE) {
    pagination.style.display = 'none';
  } else {
    pagination.style.display = 'flex';
    if (pageInfo) pageInfo.textContent = `第 ${page} / ${totalPages} 页（共 ${total} 条）`;
    if (btnPrev) btnPrev.disabled = page <= 1;
    if (btnNext) btnNext.disabled = page >= totalPages;
  }
}

/**
 * 置顶按钮点击处理
 * 供 HTML onclick 属性调用
 */
function handlePinClick(id) {
  const result = togglePinHistory(id);
  showToast(result.message, result.success ? 'success' : 'warning');
  if (result.success) {
    renderHistoryList();
  }
}

/**
 * 删除按钮点击处理
 */
function handleDeleteClick(id) {
  showConfirm('删除确认', '确定要删除这条翻译记录吗？', () => {
    const result = deleteHistory(id);
    showToast(result.message, result.success ? 'success' : 'error');
    if (result.success) {
      renderHistoryList();
    }
  });
}

/**
 * 刷新历史列表（重置到第1页）
 */
function refreshHistoryList() {
  currentPage = 1;
  renderHistoryList();
}

// ---------- 工具函数 ----------

/**
 * 格式化时间戳为可读字符串
 * @param {number} timestamp - Unix时间戳（毫秒）
 * @returns {string} 格式化后的时间字符串 "2026-06-29 14:30:25"
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '未知时间';
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * HTML 转义（防止 XSS）
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

console.log('✅ history.js 加载完毕');
