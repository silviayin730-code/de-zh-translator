/**
 * ============================================================
 * fileHandler.js — 文件处理模块
 * 职责：DOCX/PDF 文件上传与文本提取
 * 依赖：mammoth.js（CDN → window.mammoth）、pdf.js（CDN → window.pdfjsLib）
 * 依赖：translator.js（提取文本后调用翻译，通过 app.js 协调）
 *
 * 支持格式：
 *   .docx → mammoth.js 提取纯文本
 *   .pdf  → pdf.js 逐页提取文本
 * ============================================================
 */

// ---------- 文件大小限制 ----------
const MAX_DOCX_SIZE = 10 * 1024 * 1024;  // 10MB
const MAX_PDF_SIZE  = 20 * 1024 * 1024;  // 20MB
const MAX_PDF_PAGES  = 50;               // PDF最多处理50页

// ---------- 文件上传初始化 ----------

/**
 * 初始化文件上传监听器
 * 在 app.js 中调用，绑定文件选择事件
 */
function initFileUpload() {
  const fileDOCX = document.getElementById('fileDOCX');
  const filePDF = document.getElementById('filePDF');

  if (fileDOCX) {
    fileDOCX.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await processUploadedFile(file, 'docx');
      // 清空 input 值，允许重新选择同一文件
      fileDOCX.value = '';
    });
  }

  if (filePDF) {
    filePDF.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await processUploadedFile(file, 'pdf');
      filePDF.value = '';
    });
  }
}

/**
 * 处理上传的文件（主流程）
 * 校验文件 → 提取文本 → 填充到输入框
 *
 * @param {File} file - 浏览器 File 对象
 * @param {string} expectedType - 期望的文件类型（'docx' 或 'pdf'）
 */
async function processUploadedFile(file, expectedType) {
  const fileInfo = document.getElementById('fileInfo');
  const inputText = document.getElementById('inputText');

  // ---- 1. 校验文件类型 ----
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext !== expectedType) {
    showToast(`请上传 .${expectedType} 格式的文件`, 'error');
    return;
  }

  // ---- 2. 校验文件大小 ----
  const maxSize = expectedType === 'docx' ? MAX_DOCX_SIZE : MAX_PDF_SIZE;
  if (file.size > maxSize) {
    const sizeMB = (maxSize / 1024 / 1024).toFixed(0);
    showToast(`文件过大，${expectedType.toUpperCase()} 文件不能超过 ${sizeMB}MB`, 'error');
    return;
  }

  // ---- 3. 显示处理中状态 ----
  if (fileInfo) fileInfo.textContent = `⏳ 正在解析 ${file.name}...`;
  showLoading('#inputText');

  try {
    // ---- 4. 根据类型分发处理 ----
    let extractedText = '';
    if (expectedType === 'docx') {
      extractedText = await parseDOCX(file);
    } else if (expectedType === 'pdf') {
      extractedText = await parsePDF(file);
    }

    // ---- 5. 校验提取结果 ----
    const validated = validateExtractedText(extractedText);
    if (!validated.valid) {
      showToast(validated.message, 'error');
      if (fileInfo) fileInfo.textContent = '';
      hideLoading('#inputText');
      return;
    }

    // ---- 6. 填充到输入框 ----
    if (inputText) {
      inputText.value = validated.text;
      // 触发输入事件，启动实时翻译
      inputText.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // ---- 7. 显示成功信息 ----
    const charCount = validated.text.length;
    if (fileInfo) {
      fileInfo.textContent = `✅ 已提取 ${file.name}（${charCount} 字符）`;
    }
    showToast(`成功提取 ${charCount} 字符`, 'success');

  } catch (error) {
    console.error('文件处理失败：', error);
    showToast(error.message || '文件处理失败，请重试', 'error');
    if (fileInfo) fileInfo.textContent = '';
  } finally {
    hideLoading('#inputText');
  }
}

// ---------- DOCX 解析 ----------

/**
 * 使用 mammoth.js 解析 DOCX 文件
 *
 * @param {File} file - DOCX 文件对象
 * @returns {Promise<string>} 提取的纯文本
 */
async function parseDOCX(file) {
  // 检查 mammoth 库是否加载
  if (typeof mammoth === 'undefined') {
    throw new Error('DOCX解析库未加载，请刷新页面后重试');
  }

  // 读取文件为 ArrayBuffer
  const arrayBuffer = await readFileAsArrayBuffer(file);

  // 使用 mammoth 提取纯文本
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    const text = result.value || '';

    // mammoth 可能会产生警告（如：不支持的格式特性）
    if (result.messages && result.messages.length > 0) {
      const warnings = result.messages
        .filter(m => m.type === 'warning')
        .map(m => m.message)
        .join('; ');
      if (warnings) {
        console.warn('DOCX解析警告：', warnings);
      }
    }

    if (!text.trim()) {
      throw new Error('此DOCX文件中未找到可提取的文本内容');
    }

    return text;
  } catch (e) {
    if (e.message && e.message.includes('未找到可提取的文本')) {
      throw e; // 重新抛出我们自己的错误
    }
    throw new Error('无法解析此DOCX文件，请确认文件未损坏且不是旧版.doc格式');
  }
}

// ---------- PDF 解析 ----------

/**
 * 使用 pdf.js 解析 PDF 文件
 *
 * @param {File} file - PDF 文件对象
 * @returns {Promise<string>} 提取的文本（每页之间用 \n\n 分隔）
 */
async function parsePDF(file) {
  // 检查 pdf.js 库是否加载
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF解析库未加载，请刷新页面后重试');
  }

  const arrayBuffer = await readFileAsArrayBuffer(file);

  try {
    // 加载PDF文档
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      // 禁用字体渲染（只需要文本，节省内存）
      disableFontFace: true
    });

    const pdf = await loadingTask.promise;

    // 检查是否加密
    if (pdf.isEncrypted) {
      throw new Error('此PDF受密码保护，无法解析文字内容');
    }

    const totalPages = pdf.numPages;
    const pagesToProcess = Math.min(totalPages, MAX_PDF_PAGES);
    const textParts = [];

    // 逐页提取文本
    for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // 将文本项按位置排序后拼接
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ');

      if (pageText.trim()) {
        textParts.push(pageText);
      }
    }

    const fullText = textParts.join('\n\n');

    // 检查是否为扫描件（无文本层）
    if (!fullText.trim()) {
      throw new Error('此PDF不含可提取的文字层（可能为扫描件或图片PDF），请使用OCR工具处理后再试');
    }

    // 页数超限提示
    if (totalPages > MAX_PDF_PAGES) {
      showToast(`PDF共${totalPages}页，仅提取了前${MAX_PDF_PAGES}页内容`, 'warning');
    }

    return fullText;

  } catch (e) {
    // 重新抛出自定义错误
    if (e.message && (e.message.includes('扫描件') || e.message.includes('密码保护'))) {
      throw e;
    }
    throw new Error('无法解析此PDF文件：' + (e.message || '未知错误'));
  }
}

// ---------- 文件读取辅助 ----------

/**
 * 将 File 对象读取为 ArrayBuffer
 *
 * @param {File} file - 浏览器 File 对象
 * @returns {Promise<ArrayBuffer>}
 */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 将 File 对象读取为文本字符串
 *
 * @param {File} file - 浏览器 File 对象
 * @returns {Promise<string>}
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

// ---------- 文本校验 ----------

/**
 * 校验提取的文本是否有效
 *
 * @param {string} text - 提取的文本
 * @returns {Object} { valid: bool, text: string, message?: string }
 */
function validateExtractedText(text) {
  if (!text || typeof text !== 'string') {
    return { valid: false, text: '', message: '未提取到任何文本内容' };
  }

  const cleaned = text.trim();

  if (!cleaned) {
    return { valid: false, text: '', message: '文件中的文本内容为空' };
  }

  // 去除多余空白（但保留段落结构）
  const normalized = cleaned
    .replace(/[ \t]+/g, ' ')   // 多个空格→单个空格
    .replace(/\n{3,}/g, '\n\n') // 多个空行→保留两个换行
    .trim();

  return { valid: true, text: normalized };
}

console.log('✅ fileHandler.js 加载完毕');
