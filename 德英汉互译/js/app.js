/**
 * ============================================================
 * app.js — 应用入口模块
 * 职责：初始化所有子模块、绑定全局事件、管理应用状态
 * 依赖：所有其他 JS 模块（最后加载）
 *
 * 初始流程：
 *   1. 检查 CDN 库是否正确加载
 *   2. 初始化设置（检查 API Key）
 *   3. 绑定所有 UI 事件
 *   4. 初始化实时翻译监听
 *   5. 渲染历史列表
 *   6. 启动自动清理调度器
 * ============================================================
 */

// ---------- 全局状态 ----------

/**
 * 应用全局状态对象
 * 存储当前操作中的临时状态
 */
const AppState = {
  // 实时翻译相关
  realTimeEnabled: true,           // 是否启用实时翻译
  realTimeTimer: null,             // 防抖定时器ID
  abortController: null,           // 用于取消进行中的流式翻译请求
  lastTranslatedText: '',          // 上一次翻译的原文（用于避免重复请求）
  isTranslating: false,            // 是否正在翻译中

  // 当前选中的语言对
  selectedSourceLang: 'de',
  selectedTargetLang: 'zh',

  // 当前翻译结果（用于导出段落对照表）
  currentSourceText: '',           // 最近一次翻译的原文
  currentTranslatedText: '',       // 最近一次翻译的译文

  // 历史分页
  historyPage: 1,

  // 待操作的确认回调
  pendingConfirmCallback: null
};

// ---------- 应用初始化 ----------

/**
 * 应用入口：页面加载完成后执行
 */
function initApp() {
  console.log('🚀 德英汉互译 启动中...');

  // ---- 1. 检查 CDN 库加载 ----
  checkCDNLibraries();

  // ---- 2. 初始化设置 ----
  const settings = getSettings();
  applySettingsToUI(settings);

  // 如果未配置 API Key，自动打开设置弹窗
  if (!settings.apiKey || !settings.apiKey.trim()) {
    setTimeout(() => {
      showToast('👋 欢迎使用！请先在设置中配置 DeepSeek API Key', 'info', 5000);
    }, 800);
  }

  // ---- 3. 绑定所有 UI 事件 ----
  bindAllEvents();

  // ---- 4. 初始化文件上传 ----
  initFileUpload();

  // ---- 5. 初始化实时翻译监听 ----
  initRealTimeTranslation();

  // ---- 6. 渲染历史列表 ----
  renderHistoryList();

  // ---- 7. 渲染术语表 ----
  renderGlossaryList();

  // ---- 8. 启动自动清理调度器 ----
  initCleanupScheduler();

  // ---- 9. 更新存储状态 ----
  updateStorageStatsUI();

  console.log('✅ 德英汉互译 启动完成！');
}

// ---------- CDN 库检查 ----------

/**
 * 检查所有必需的 CDN 库是否正确加载
 * 如果某个库加载失败，在控制台输出警告
 */
function checkCDNLibraries() {
  const libraries = [
    { name: 'mammoth.js',   test: () => typeof mammoth !== 'undefined',   feature: 'DOCX解析' },
    { name: 'pdf.js',       test: () => typeof pdfjsLib !== 'undefined',  feature: 'PDF解析' },
    { name: 'SheetJS',      test: () => typeof XLSX !== 'undefined',      feature: 'Excel导出' },
    { name: 'jsPDF',        test: () => typeof jspdf !== 'undefined',     feature: 'PDF导出' },
    { name: 'html2canvas',  test: () => typeof html2canvas !== 'undefined', feature: 'PDF截图' }
  ];

  const failed = libraries.filter(lib => !lib.test());

  if (failed.length > 0) {
    const names = failed.map(l => `${l.name}（${l.feature}）`).join('、');
    console.warn(`⚠️ 以下CDN库加载失败，相关功能不可用：${names}`);
    console.warn('请检查网络连接，或刷新页面重试');
  } else {
    console.log('✅ 所有CDN库加载正常');
  }
}

// ---------- 事件绑定 ----------

/**
 * 绑定所有UI交互事件
 */
function bindAllEvents() {
  // -- 语言选择 --
  document.getElementById('selectSourceLang')
    .addEventListener('change', onSourceLangChange);
  document.getElementById('selectTargetLang')
    .addEventListener('change', onTargetLangChange);
  document.getElementById('btnSwapLang')
    .addEventListener('click', onSwapLanguages);

  // -- 翻译按钮 --
  document.getElementById('btnTranslate')
    .addEventListener('click', onManualTranslate);
  document.getElementById('btnCopy')
    .addEventListener('click', onCopyTranslation);

  // -- 设置弹窗 --
  document.getElementById('btnSettings')
    .addEventListener('click', () => showModal('modalSettings'));
  document.getElementById('btnCloseSettings')
    .addEventListener('click', () => hideModal('modalSettings'));
  document.getElementById('btnSaveSettings')
    .addEventListener('click', onSaveSettings);
  document.getElementById('btnToggleKey')
    .addEventListener('click', onToggleAPIKeyVisibility);
  document.getElementById('btnForceCleanup')
    .addEventListener('click', onForceCleanup);

  // -- 术语表弹窗 --
  document.getElementById('btnGlossary')
    .addEventListener('click', () => {
      renderGlossaryList();
      showModal('modalGlossary');
    });
  document.getElementById('btnCloseGlossary')
    .addEventListener('click', () => hideModal('modalGlossary'));
  document.getElementById('btnAddGlossary')
    .addEventListener('click', onAddGlossaryEntry);

  // -- 导出当前翻译（段落对照表） --
  document.getElementById('btnExportCurrentExcel')
    .addEventListener('click', () => exportCurrentTranslation('excel'));
  document.getElementById('btnExportCurrentPDF')
    .addEventListener('click', () => exportCurrentTranslation('pdf'));

  // -- 历史记录 --
  document.getElementById('searchInput')
    .addEventListener('input', debounce(onSearchHistory, 300));
  document.getElementById('btnExportExcel')
    .addEventListener('click', () => exportFilteredHistory('excel', currentFilter));
  document.getElementById('btnExportPDF')
    .addEventListener('click', () => exportFilteredHistory('pdf', currentFilter));
  document.getElementById('btnClearAll')
    .addEventListener('click', onClearAllHistory);
  document.getElementById('btnPrevPage')
    .addEventListener('click', () => { currentPage--; renderHistoryList(); });
  document.getElementById('btnNextPage')
    .addEventListener('click', () => { currentPage++; renderHistoryList(); });

  // -- 确认弹窗 --
  document.getElementById('btnConfirmCancel')
    .addEventListener('click', () => hideModal('modalConfirm'));
  document.getElementById('btnConfirmOk')
    .addEventListener('click', onConfirmOk);
  document.getElementById('btnCloseConfirm')
    .addEventListener('click', () => hideModal('modalConfirm'));

  // -- 弹窗点击遮罩关闭 --
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.style.display = 'none';
      }
    });
  });

  // -- 键盘快捷键 --
  document.addEventListener('keydown', onKeyboardShortcut);

  console.log('✅ 所有UI事件绑定完成');
}

// ---------- 实时翻译 ----------

/**
 * 初始化实时翻译（监听输入框变化）
 * 使用防抖机制：用户停止输入300ms后发起翻译
 */
function initRealTimeTranslation() {
  const inputText = document.getElementById('inputText');
  if (!inputText) return;

  // 使用防抖包装翻译函数
  const debouncedTranslate = debounce(async (text) => {
    if (!text || !text.trim()) {
      updateSubtitle('输入文本后将自动显示翻译预览...', '');
      return;
    }

    const sourceLang = AppState.selectedSourceLang;
    const targetLang = AppState.selectedTargetLang;

    if (sourceLang === targetLang) {
      updateSubtitle('请选择不同的源语言和目标语言', '');
      return;
    }

    // 与上一次翻译相同，跳过
    if (text === AppState.lastTranslatedText) return;

    // 取消上一次未完成的请求
    if (AppState.abortController) {
      AppState.abortController.abort();
    }

    // 创建新的 AbortController
    AppState.abortController = new AbortController();

    AppState.lastTranslatedText = text;
    AppState.isTranslating = true;
    updateSubtitle('', '⏳ 翻译中...');

    // 流式翻译
    const result = await translateTextStreaming(
      text,
      sourceLang,
      targetLang,
      (partialText) => {
        // 实时更新字幕
        if (partialText) {
          updateSubtitle(partialText, '⚡ 实时');
        }
      },
      AppState.abortController.signal
    );

    AppState.isTranslating = false;

    if (result.success) {
      const cacheTag = result.fromCache ? ' ⚡缓存' : '';
      updateSubtitle(result.translatedText, `✅${cacheTag}`);

      // 自动保存到历史记录
      addHistory({
        sourceText: text,
        translatedText: result.translatedText,
        sourceLang: sourceLang,
        targetLang: targetLang,
        fromCache: result.fromCache || false
      });

      // 同时更新右侧翻译结果区
      updateOutputArea(result);

      // 刷新历史列表
      refreshHistoryList();
    } else {
      updateSubtitle(result.message || '翻译失败', '❌');
    }
  }, STREAMING_DEBOUNCE_MS || 300);

  // 绑定输入事件
  inputText.addEventListener('input', (e) => {
    const text = e.target.value;
    debouncedTranslate(text);
  });

  console.log('✅ 实时翻译监听已启动');
}

/**
 * 更新实时字幕显示
 */
function updateSubtitle(text, status) {
  const subtitleText = document.getElementById('subtitleText');
  const subtitleStatus = document.getElementById('subtitleStatus');

  if (subtitleText) subtitleText.textContent = text || '';
  if (subtitleStatus) subtitleStatus.textContent = status || '';
}

/**
 * 更新右侧翻译结果区
 */
function updateOutputArea(result) {
  const outputContent = document.getElementById('outputContent');
  const cacheBadge = document.getElementById('cacheBadge');
  const btnExportExcel = document.getElementById('btnExportCurrentExcel');
  const btnExportPDF = document.getElementById('btnExportCurrentPDF');

  if (!outputContent) return;

  if (result.success) {
    // 保留原文段落结构的显示
    outputContent.innerHTML = `<p style="white-space:pre-wrap;">${escapeHTML(result.translatedText)}</p>`;
    if (cacheBadge) {
      cacheBadge.style.display = result.fromCache ? 'inline-block' : 'none';
    }

    // 保存当前翻译结果到AppState（用于导出段落对照表）
    AppState.currentTranslatedText = result.translatedText || '';
    // 原文从输入框读取
    const inputText = document.getElementById('inputText');
    AppState.currentSourceText = inputText ? inputText.value : '';

    // 启用导出按钮
    if (btnExportExcel) btnExportExcel.disabled = false;
    if (btnExportPDF) btnExportPDF.disabled = false;
  } else {
    outputContent.innerHTML = `<p class="output-placeholder" style="color:#ef5350;">${escapeHTML(result.message)}</p>`;
    if (cacheBadge) cacheBadge.style.display = 'none';

    // 翻译失败，清空当前结果
    AppState.currentTranslatedText = '';
    AppState.currentSourceText = '';

    // 禁用导出按钮
    if (btnExportExcel) btnExportExcel.disabled = true;
    if (btnExportPDF) btnExportPDF.disabled = true;
  }
}

// ---------- 事件处理函数 ----------

/**
 * 手动点击翻译按钮
 */
async function onManualTranslate() {
  const inputText = document.getElementById('inputText');
  const text = inputText ? inputText.value : '';

  if (!text || !text.trim()) {
    showToast('请先输入要翻译的文本', 'warning');
    return;
  }

  const sourceLang = AppState.selectedSourceLang;
  const targetLang = AppState.selectedTargetLang;

  if (sourceLang === targetLang) {
    showToast('源语言和目标语言不能相同', 'warning');
    return;
  }

  // 显示加载状态
  const btnTranslate = document.getElementById('btnTranslate');
  const originalText = btnTranslate.textContent;
  btnTranslate.textContent = '⏳ 翻译中...';
  btnTranslate.disabled = true;

  const result = await translateText(text, sourceLang, targetLang, {
    skipMemory: false,
    skipGlossary: false
  });

  // 恢复按钮
  btnTranslate.textContent = originalText;
  btnTranslate.disabled = false;

  // 处理结果
  if (result.success) {
    updateOutputArea(result);

    // 显示提示
    const msg = result.fromCache
      ? '翻译完成（来自缓存 ⚡）'
      : (result.segmented ? `分段翻译完成（共${result.totalSegments}段）` : '翻译完成');
    showToast(msg, 'success');

    // 保存历史
    addHistory({
      sourceText: text,
      translatedText: result.translatedText,
      sourceLang: sourceLang,
      targetLang: targetLang,
      fromCache: result.fromCache || false
    });

    // 刷新历史列表
    refreshHistoryList();
  } else {
    updateOutputArea(result);
    showToast(result.message, 'error');

    // 429限流：3秒后自动重试
    if (result.error === 'RATE_LIMITED') {
      showToast('3秒后将自动重试...', 'info', 3000);
      setTimeout(async () => {
        const retryResult = await translateText(text, sourceLang, targetLang,
                                                 { skipMemory: true });
        if (retryResult.success) {
          updateOutputArea(retryResult);
          showToast('重试成功！', 'success');
          refreshHistoryList();
        }
      }, 3000);
    }
  }
}

/**
 * 复制译文到剪贴板
 */
async function onCopyTranslation() {
  const outputContent = document.getElementById('outputContent');
  if (!outputContent) return;

  const text = outputContent.textContent.trim();
  if (!text || text === '翻译结果将在此显示...') {
    showToast('没有可复制的内容', 'warning');
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板', 'success');
  } catch (e) {
    // 降级方案：使用旧版API
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('已复制到剪贴板', 'success');
  }
}

/**
 * 语言选择变化
 */
function onSourceLangChange(e) {
  AppState.selectedSourceLang = e.target.value;
  // 如果源语言和目标语言相同，自动调整目标语言
  if (AppState.selectedSourceLang === AppState.selectedTargetLang) {
    const targetSelect = document.getElementById('selectTargetLang');
    const options = targetSelect.options;
    for (let i = 0; i < options.length; i++) {
      if (options[i].value !== AppState.selectedSourceLang) {
        targetSelect.value = options[i].value;
        AppState.selectedTargetLang = options[i].value;
        break;
      }
    }
  }
  // 清空实时翻译的缓存
  AppState.lastTranslatedText = '';
}

function onTargetLangChange(e) {
  AppState.selectedTargetLang = e.target.value;
  AppState.lastTranslatedText = '';
}

function onSwapLanguages() {
  const sourceSelect = document.getElementById('selectSourceLang');
  const targetSelect = document.getElementById('selectTargetLang');

  const temp = sourceSelect.value;
  sourceSelect.value = targetSelect.value;
  targetSelect.value = temp;

  AppState.selectedSourceLang = sourceSelect.value;
  AppState.selectedTargetLang = targetSelect.value;
  AppState.lastTranslatedText = '';

  showToast('已交换语言方向', 'info');
}

/**
 * 设置弹窗：保存设置
 */
function onSaveSettings() {
  const apiKey = document.getElementById('settingAPIKey').value.trim();

  // 校验 API Key
  if (apiKey && !apiKey.startsWith('sk-')) {
    showToast('API Key 格式不正确（应以 sk- 开头）', 'error');
    return;
  }

  // 读取保留天数
  const retentionRadio = document.querySelector('input[name="retentionDays"]:checked');
  const retentionDays = retentionRadio ? parseInt(retentionRadio.value) : 3;

  // 保存
  updateSetting('apiKey', apiKey);
  updateSetting('retentionDays', retentionDays);

  showToast('设置已保存', 'success');
  hideModal('modalSettings');
}

/**
 * 切换 API Key 可见性
 */
function onToggleAPIKeyVisibility() {
  const input = document.getElementById('settingAPIKey');
  const btn = document.getElementById('btnToggleKey');

  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈 隐藏';
  } else {
    input.type = 'password';
    btn.textContent = '👁 显示';
  }
}

/**
 * 强制清理按钮
 */
function onForceCleanup() {
  showConfirm(
    '确认清理',
    '将根据设置的保留天数立即清理过期记录，确定要继续吗？',
    () => {
      forceCleanup();
    }
  );
}

/**
 * 术语表：添加条目
 */
function onAddGlossaryEntry() {
  const sourceLang = document.getElementById('glossarySourceLang').value;
  const source = document.getElementById('glossarySource').value;
  const targetLang = document.getElementById('glossaryTargetLang').value;
  const target = document.getElementById('glossaryTarget').value;

  const result = addGlossaryEntry(source, target, sourceLang, targetLang);

  if (result.success) {
    showToast(result.message, 'success');
    // 清空输入
    document.getElementById('glossarySource').value = '';
    document.getElementById('glossaryTarget').value = '';
    // 刷新列表
    renderGlossaryList();
  } else {
    showToast(result.message, 'error');
  }
}

/**
 * 删除术语（由渲染的按钮调用）
 */
function handleGlossaryDelete(id) {
  const result = deleteGlossaryEntry(id);
  if (result.success) {
    showToast(result.message, 'success');
    renderGlossaryList();
  } else {
    showToast(result.message, 'error');
  }
}

/**
 * 搜索历史
 */
function onSearchHistory(e) {
  currentFilter = e.target.value.trim();
  currentPage = 1;
  renderHistoryList();
}

/**
 * 清空全部历史
 */
function onClearAllHistory() {
  const historyData = getHistoryData();
  if (historyData.length === 0) {
    showToast('没有可清空的记录', 'info');
    return;
  }

  showConfirm(
    '清空全部历史',
    `确定要清空全部 ${historyData.length} 条翻译记录吗？此操作不可撤销。`,
    () => {
      const result = clearAllHistory(false);
      showToast(result.message, 'success');
      currentPage = 1;
      currentFilter = '';
      document.getElementById('searchInput').value = '';
      renderHistoryList();
    }
  );
}

/**
 * 确认弹窗：确认按钮
 */
function onConfirmOk() {
  hideModal('modalConfirm');
  if (typeof AppState.pendingConfirmCallback === 'function') {
    const cb = AppState.pendingConfirmCallback;
    AppState.pendingConfirmCallback = null;
    cb();
  }
}

/**
 * 键盘快捷键
 */
function onKeyboardShortcut(e) {
  // Ctrl+Enter 触发翻译
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    onManualTranslate();
  }
  // Escape 关闭弹窗
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => {
      m.style.display = 'none';
    });
  }
}

// ---------- UI 渲染辅助 ----------

/**
 * 渲染术语表列表
 */
function renderGlossaryList() {
  const container = document.getElementById('glossaryList');
  if (!container) return;

  const entries = getGlossary();

  if (entries.length === 0) {
    container.innerHTML = '<p class="glossary-empty">暂无术语条目，请在上方添加</p>';
    return;
  }

  container.innerHTML = entries.map(entry => `
    <div class="glossary-item">
      <div class="glossary-item-text">
        <span class="glossary-source-term">${escapeHTML(entry.source)}</span>
        <span class="glossary-lang-tag">[${langName(entry.sourceLang)}]</span>
        <span style="color:#64b5f6;"> → </span>
        <span class="glossary-target-term">${escapeHTML(entry.target)}</span>
        <span class="glossary-lang-tag">[${langName(entry.targetLang)}]</span>
      </div>
      <div class="glossary-item-actions">
        <button class="btn btn-sm btn-danger"
                onclick="handleGlossaryDelete('${entry.id}')">🗑</button>
      </div>
    </div>
  `).join('');
}

/**
 * 将当前设置值填充到设置弹窗的UI控件
 */
function applySettingsToUI(settings) {
  const apiKeyInput = document.getElementById('settingAPIKey');
  if (apiKeyInput) apiKeyInput.value = settings.apiKey || '';

  const retentionRadio = document.querySelector(
    `input[name="retentionDays"][value="${settings.retentionDays || 3}"]`
  );
  if (retentionRadio) retentionRadio.checked = true;
}

/**
 * 更新存储状态显示
 */
function updateStorageStatsUI() {
  const container = document.getElementById('storageStats');
  if (!container) return;

  const stats = getStorageStats();
  const settings = getSettings();
  const retentionDays = settings.retentionDays || 3;

  container.innerHTML = `
    <div>📦 总存储：${stats.totalKB} KB（约 ${stats.usagePercent}% 用量）</div>
    <div>📝 历史记录：${stats['translation_history']?.count || 0} 条</div>
    <div>🧠 翻译记忆：${stats['translator_memory']?.count || 0} 条</div>
    <div>📖 术语条目：${stats['glossary_entries']?.count || 0} 条</div>
    <div>⏰ 保留天数：${retentionDays} 天 | 下次清理：${getNextCleanupTime()}</div>
    ${settings.lastCleanup
      ? `<div>🧹 上次清理：${formatTimestamp(settings.lastCleanup)}（清理${settings.lastCleanupCount || 0}条）</div>`
      : '<div>🧹 尚未执行过自动清理</div>'}
  `;
}

// ---------- 弹窗控制 ----------

/**
 * 显示弹窗
 */
function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  // 打开设置弹窗时，刷新存储状态
  if (modalId === 'modalSettings') {
    applySettingsToUI(getSettings());
    updateStorageStatsUI();
  }

  // 打开术语表弹窗时，刷新列表
  if (modalId === 'modalGlossary') {
    renderGlossaryList();
  }

  modal.style.display = 'flex';
}

/**
 * 隐藏弹窗
 */
function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.style.display = 'none';
}

// ---------- 确认弹窗 ----------

/**
 * 显示确认弹窗
 *
 * @param {string} title - 弹窗标题
 * @param {string} message - 确认消息
 * @param {Function} callback - 确认后执行的回调
 */
function showConfirm(title, message, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  AppState.pendingConfirmCallback = callback;
  showModal('modalConfirm');
}

// ---------- Toast 消息 ----------

/**
 * 显示 Toast 消息提示
 *
 * @param {string} message - 提示文本
 * @param {string} type - 类型：'success' | 'error' | 'info' | 'warning'
 * @param {number} duration - 显示毫秒数（默认3000）
 */
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  // 自动移除
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, duration);
}

// ---------- 加载动画 ----------

/**
 * 显示加载状态（在指定选择器的元素上）
 */
function showLoading(selector) {
  const el = document.querySelector(selector);
  if (el) {
    el.style.opacity = '0.6';
    el.style.pointerEvents = 'none';
  }
}

/**
 * 隐藏加载状态
 */
function hideLoading(selector) {
  const el = document.querySelector(selector);
  if (el) {
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
  }
}

// ---------- 进度条 ----------

/**
 * 更新进度条（超长文本分段翻译时调用）
 */
function updateProgress(current, total) {
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');

  if (!progressBar || !progressFill || !progressText) return;

  progressBar.style.display = 'block';
  const percent = Math.round((current / total) * 100);
  progressFill.style.width = percent + '%';
  progressText.textContent = `正在翻译第 ${current}/${total} 段...`;
}

/**
 * 隐藏进度条
 */
function hideProgress() {
  const progressBar = document.getElementById('progressBar');
  if (progressBar) {
    setTimeout(() => {
      progressBar.style.display = 'none';
    }, 1000);
  }
}

// ---------- 页面加载启动 ----------

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', initApp);

console.log('✅ app.js 加载完毕，等待 DOM 就绪...');
