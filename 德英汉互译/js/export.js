/**
 * ============================================================
 * export.js — 导出模块
 * 职责：导出翻译结果为 Excel 表格和 PDF 文档
 * 依赖：history.js（历史数据）、CDN库（SheetJS、jsPDF、html2canvas）
 *
 * 两种导出模式：
 *   1. "导出当前翻译" — 段落对照表（原文 ||| 译文，按段落分行）
 *   2. "导出历史记录" — 全部翻译历史列表
 *
 * 字体规则：
 *   中文 → 宋体 (SimSun)
 *   德语/英语 → Times New Roman
 * ============================================================
 */

// ====================================================================
//  第一部分：导出「当前翻译结果」— 段落对照表（核心新功能）
// ====================================================================

/**
 * 导出当前翻译结果为双语段落对照表
 * 这是输出区「导出Excel」「导出PDF」按钮的入口函数
 *
 * @param {string} type - 'excel' 或 'pdf'
 */
async function exportCurrentTranslation(type) {
  // ---- 1. 获取当前翻译数据 ----
  const sourceText = AppState.currentSourceText || '';
  const translatedText = AppState.currentTranslatedText || '';

  if (!sourceText.trim() || !translatedText.trim()) {
    showToast('没有可导出的翻译结果，请先翻译一段文本', 'warning');
    return false;
  }

  const sourceLang = AppState.selectedSourceLang;
  const targetLang = AppState.selectedTargetLang;

  // ---- 2. 按段落拆分（\n\n = 段落分隔） ----
  const sourceParagraphs = splitParagraphs(sourceText);
  const targetParagraphs = splitParagraphs(translatedText);

  // 确保两边的段落数一致（取最大值，不足的填空）
  const maxLen = Math.max(sourceParagraphs.length, targetParagraphs.length);
  const paragraphs = [];
  for (let i = 0; i < maxLen; i++) {
    paragraphs.push({
      index: i + 1,
      source: sourceParagraphs[i] || '(空)',
      target: targetParagraphs[i] || '(空)'
    });
  }

  // ---- 3. 按类型分发 ----
  if (type === 'excel') {
    return await buildBilingualExcel(paragraphs, sourceLang, targetLang);
  } else if (type === 'pdf') {
    return await buildBilingualPDF(paragraphs, sourceLang, targetLang);
  }

  return false;
}

/**
 * 将文本按段落拆分
 * 以连续换行（\n{2,}）作为段落分隔符
 * 保留段落内的换行（单\n）
 *
 * @param {string} text - 原始文本
 * @returns {string[]} 段落数组
 */
function splitParagraphs(text) {
  if (!text || !text.trim()) return [];

  // 按2个及以上换行符拆分（段落分隔）
  const parts = text.split(/\n{2,}/);

  // 过滤纯空白的"段落"，保留有效内容
  return parts
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

// ---------- 构建双语对照 Excel ----------

/**
 * 生成段落对照 Excel 文件
 * 格式：序号 | 原文（宋体/TNR） | 译文（宋体/TNR）
 *
 * @param {Array} paragraphs - [{index, source, target}, ...]
 * @param {string} sourceLang - 源语言代码
 * @param {string} targetLang - 目标语言代码
 */
async function buildBilingualExcel(paragraphs, sourceLang, targetLang) {
  if (typeof XLSX === 'undefined') {
    showToast('Excel导出库未加载，请刷新页面后重试', 'error');
    return false;
  }

  try {
    // ---- 确定列字体 ----
    // 源语言列：源语言是中文→宋体，否则→Times New Roman
    const sourceFont = (sourceLang === 'zh') ? 'SimSun' : 'Times New Roman';
    // 译文列：目标语言是中文→宋体，否则→Times New Roman
    const targetFont = (targetLang === 'zh') ? 'SimSun' : 'Times New Roman';

    // 表头字体（中文用宋体）
    const headerFont = 'SimSun';

    // ---- 创建工作表（使用 cell object 格式以支持字体样式） ----
    const ws_data = [];

    // 表头行
    ws_data.push([
      { v: '段落', t: 's', s: { font: { name: headerFont, bold: true, sz: 12 } } },
      { v: `原文（${langName(sourceLang)}）`, t: 's', s: { font: { name: headerFont, bold: true, sz: 12 } } },
      { v: `译文（${langName(targetLang)}）`, t: 's', s: { font: { name: headerFont, bold: true, sz: 12 } } }
    ]);

    // 数据行
    paragraphs.forEach(p => {
      ws_data.push([
        { v: p.index, t: 'n', s: { font: { name: 'Times New Roman', sz: 11 } } },
        { v: p.source, t: 's', s: { font: { name: sourceFont, sz: 11 } } },
        { v: p.target, t: 's', s: { font: { name: targetFont, sz: 11 } } }
      ]);
    });

    // ---- 构建工作表 ----
    const ws = XLSX.utils.aoa_to_sheet(ws_data);

    // 设置列宽
    ws['!cols'] = [
      { wch: 8 },   // 段落序号
      { wch: 55 },  // 原文
      { wch: 55 }   // 译文
    ];

    // ---- 创建工作簿 ----
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '段落对照');

    // ---- 写入并下载 ----
    const filename = `翻译对照_${langName(sourceLang)}-${langName(targetLang)}_${formatDateForFile(new Date())}`;
    XLSX.writeFile(wb, `${filename}.xlsx`, { cellStyles: true, bookType: 'xlsx' });

    showToast(`成功导出 ${paragraphs.length} 段双语对照到 Excel（中文=宋体，外文=Times New Roman）`, 'success');
    return true;

  } catch (error) {
    console.error('Excel导出失败：', error);
    showToast('Excel导出失败：' + (error.message || '未知错误'), 'error');
    return false;
  }
}

// ---------- 构建双语对照 PDF ----------

/**
 * 生成段落对照 PDF 文件
 * 使用"可见覆盖层 + html2canvas 截图 + jsPDF 嵌入"方案
 * 中文文本用宋体，拉丁文本用 Times New Roman
 *
 * @param {Array} paragraphs - [{index, source, target}, ...]
 * @param {string} sourceLang - 源语言代码
 * @param {string} targetLang - 目标语言代码
 */
async function buildBilingualPDF(paragraphs, sourceLang, targetLang) {
  // 检查库是否加载
  if (typeof jspdf === 'undefined' || typeof html2canvas === 'undefined') {
    showToast('PDF导出库未加载，请刷新页面后重试', 'error');
    return false;
  }

  // 用于存储覆盖层引用（便于finally清理）
  let overlay = null;

  try {
    showToast('正在生成PDF，请稍候...', 'info', 5000);

    // ---- 1. 创建可见覆盖层（关键：必须可见，html2canvas才能截图） ----
    overlay = document.createElement('div');
    overlay.className = 'pdf-overlay';
    overlay.innerHTML = buildBilingualPDFHTML(paragraphs, sourceLang, targetLang);

    // 添加到页面
    document.body.appendChild(overlay);

    // 短暂延迟让浏览器完成字体渲染
    await sleep(300);

    // ---- 2. html2canvas 截图 ----
    const pdfContent = overlay.querySelector('.pdf-content');
    if (!pdfContent) throw new Error('PDF内容元素未找到');

    const canvas = await html2canvas(pdfContent, {
      scale: 2,                  // 2倍分辨率保证清晰
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      allowTaint: true
    });

    // ---- 3. 创建 PDF ----
    const { jsPDF } = jspdf;
    const imgWidth = 190;        // 图片在A4上的宽度 (mm)（留10mm边距）
    const pageWidth = 210;       // A4宽度
    const pageHeight = 297;      // A4高度
    const margin = 10;           // 边距

    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const doc = new jsPDF('p', 'mm', 'a4');

    // 单页图片高度不超过一页
    const maxImgHeightPerPage = pageHeight - margin * 2;
    let heightLeft = imgHeight;
    let sourceY = 0;  // 从canvas顶部开始截取的位置

    // 逐页添加图片
    let pageNum = 0;
    while (heightLeft > 0) {
      if (pageNum > 0) {
        doc.addPage();
      }

      // 计算当前页截取的canvas高度
      const sliceHeight = Math.min(heightLeft, maxImgHeightPerPage);

      // 创建这一页的切片canvas
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = Math.round((sliceHeight / imgHeight) * canvas.height);
      const ctx = sliceCanvas.getContext('2d');
      ctx.drawImage(
        canvas,
        0, sourceY,                                          // 源起点
        canvas.width, sliceCanvas.height,                     // 源尺寸
        0, 0,                                                 // 目标起点
        sliceCanvas.width, sliceCanvas.height                 // 目标尺寸
      );

      const sliceData = sliceCanvas.toDataURL('image/png', 1.0);
      doc.addImage(sliceData, 'PNG', margin, margin, imgWidth, sliceHeight);

      sourceY += sliceCanvas.height;
      heightLeft -= sliceHeight;
      pageNum++;
    }

    // ---- 4. 下载 ----
    const filename = `翻译对照_${langName(sourceLang)}-${langName(targetLang)}_${formatDateForFile(new Date())}`;
    doc.save(`${filename}.pdf`);

    showToast(`成功导出 ${paragraphs.length} 段双语对照到 PDF`, 'success');
    return true;

  } catch (error) {
    console.error('PDF导出失败：', error);
    showToast('PDF导出失败：' + (error.message || '未知错误'), 'error');
    return false;

  } finally {
    // ---- 清理覆盖层 ----
    if (overlay && overlay.parentNode) {
      document.body.removeChild(overlay);
    }
  }
}

/**
 * 构建PDF覆盖层的HTML内容
 * 中文文本包在 <span class="font-cn">（SimSun），
 * 拉丁文本包在 <span class="font-latin">（Times New Roman）
 *
 * @param {Array} paragraphs - [{index, source, target}, ...]
 * @param {string} sourceLang - 源语言
 * @param {string} targetLang - 目标语言
 * @returns {string} HTML字符串
 */
function buildBilingualPDFHTML(paragraphs, sourceLang, targetLang) {
  const title = `翻译对照表（${langName(sourceLang)} → ${langName(targetLang)}）`;
  const dateStr = formatTimestamp(Date.now());

  let rowsHTML = '';

  paragraphs.forEach((p, i) => {
    const bgColor = i % 2 === 0 ? '#f8f9fa' : '#ffffff';
    rowsHTML += `
      <tr style="background:${bgColor};">
        <td class="pdf-td idx">${p.index}</td>
        <td class="pdf-td src">${wrapTextByLang(p.source, sourceLang)}</td>
        <td class="pdf-td tgt">${wrapTextByLang(p.target, targetLang)}</td>
      </tr>`;
  });

  return `
    <div class="pdf-content">
      <!-- 标题 -->
      <div class="pdf-title">${escapeHTML(title)}</div>
      <div class="pdf-meta">
        导出时间：${dateStr} ｜ 共 ${paragraphs.length} 段 ｜
        中文 = 宋体 ｜ 外文 = Times New Roman
      </div>

      <!-- 表格 -->
      <table class="pdf-table">
        <thead>
          <tr>
            <th class="pdf-th idx">段落</th>
            <th class="pdf-th src">原文（${langName(sourceLang)}）</th>
            <th class="pdf-th tgt">译文（${langName(targetLang)}）</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHTML}
        </tbody>
      </table>

      <!-- 页脚 -->
      <div class="pdf-footer">由 德英汉互译工具 生成</div>
    </div>
  `;
}

/**
 * 判断文本是否主要为中文
 * @param {string} text - 要判断的文本
 * @returns {boolean}
 */
function isChineseText(text) {
  if (!text) return false;
  // 统计中文字符占比
  const chineseChars = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  return totalChars > 0 && (chineseChars / totalChars) > 0.3;
}

/**
 * 根据语言类型包裹文本到对应的字体span中
 * 中文 → SimSun，拉丁 → Times New Roman
 *
 * @param {string} text - 文本内容
 * @param {string} lang - 语言代码
 * @returns {string} 带字体span的HTML
 */
function wrapTextByLang(text, lang) {
  const escaped = escapeHTML(text);
  // 保留换行
  const withBreaks = escaped.replace(/\n/g, '<br>');

  if (lang === 'zh' || isChineseText(text)) {
    return `<span class="font-cn">${withBreaks}</span>`;
  } else {
    return `<span class="font-latin">${withBreaks}</span>`;
  }
}

/**
 * 等待指定毫秒
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ====================================================================
//  第二部分：导出「翻译历史」— 原有功能（保留）
// ====================================================================

/**
 * 将翻译历史导出为 Excel 文件（.xlsx）
 * 保留原有历史导出功能，改进列布局和字体
 *
 * @param {Array} entries - 历史记录数组
 * @param {string} filename - 文件名（不含扩展名）
 */
async function exportToExcel(entries, filename) {
  let data = entries;
  if (!data || data.length === 0) {
    const allData = getHistoryData();
    if (allData.length === 0) {
      showToast('暂无翻译记录可导出', 'warning');
      return false;
    }
    data = allData;
  }

  if (typeof XLSX === 'undefined') {
    showToast('Excel导出库未加载，请刷新页面后重试', 'error');
    return false;
  }

  try {
    // 构建数据
    const ws_data = [
      [
        { v: '序号', t: 's', s: { font: { name: 'SimSun', bold: true } } },
        { v: '时间', t: 's', s: { font: { name: 'SimSun', bold: true } } },
        { v: '语言对', t: 's', s: { font: { name: 'SimSun', bold: true } } },
        { v: '原文', t: 's', s: { font: { name: 'SimSun', bold: true } } },
        { v: '译文', t: 's', s: { font: { name: 'SimSun', bold: true } } },
        { v: '来源', t: 's', s: { font: { name: 'SimSun', bold: true } } }
      ]
    ];

    data.forEach((entry, index) => {
      const timeStr = formatTimestamp(entry.timestamp);
      const langStr = `${langName(entry.sourceLang)} → ${langName(entry.targetLang)}`;
      const sourceText = entry.fromFile
        ? `[${entry.fromFile}] ${entry.sourceText}`
        : entry.sourceText;

      // 根据语言选字体
      const srcFont = entry.sourceLang === 'zh' ? 'SimSun' : 'Times New Roman';
      const tgtFont = entry.targetLang === 'zh' ? 'SimSun' : 'Times New Roman';

      ws_data.push([
        { v: index + 1, t: 'n', s: { font: { name: 'Times New Roman' } } },
        { v: timeStr, t: 's', s: { font: { name: 'Times New Roman' } } },
        { v: langStr, t: 's', s: { font: { name: 'SimSun' } } },
        { v: sourceText, t: 's', s: { font: { name: srcFont } } },
        { v: entry.translatedText, t: 's', s: { font: { name: tgtFont } } },
        { v: entry.fromFile || '直接输入', t: 's', s: { font: { name: 'SimSun' } } }
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 20 },
      { wch: 14 },
      { wch: 50 },
      { wch: 50 },
      { wch: 14 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '翻译历史');
    const fname = filename || `翻译历史_${formatDateForFile(new Date())}`;
    XLSX.writeFile(wb, `${fname}.xlsx`, { cellStyles: true, bookType: 'xlsx' });

    showToast(`成功导出 ${data.length} 条历史到 Excel`, 'success');
    return true;

  } catch (error) {
    console.error('Excel导出失败：', error);
    showToast('Excel导出失败：' + (error.message || '未知错误'), 'error');
    return false;
  }
}

/**
 * 将翻译历史导出为 PDF 文件
 * 同样使用可见覆盖层方案
 *
 * @param {Array} entries - 历史记录数组
 * @param {string} filename - 文件名
 */
async function exportToPDF(entries, filename) {
  let data = entries;
  if (!data || data.length === 0) {
    const allData = getHistoryData();
    if (allData.length === 0) {
      showToast('暂无翻译记录可导出', 'warning');
      return false;
    }
    data = allData;
  }

  if (typeof jspdf === 'undefined' || typeof html2canvas === 'undefined') {
    showToast('PDF导出库未加载，请刷新页面后重试', 'error');
    return false;
  }

  let overlay = null;

  try {
    showToast('正在生成PDF，请稍候...', 'info', 5000);

    // 创建可见覆盖层
    overlay = document.createElement('div');
    overlay.className = 'pdf-overlay';
    overlay.innerHTML = buildHistoryPDFHTML(data);
    document.body.appendChild(overlay);

    await sleep(300);

    const pdfContent = overlay.querySelector('.pdf-content');
    if (!pdfContent) throw new Error('PDF内容元素未找到');

    const canvas = await html2canvas(pdfContent, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      allowTaint: true
    });

    const { jsPDF } = jspdf;
    const imgWidth = 190;
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const maxImgHeightPerPage = pageHeight - margin * 2;

    const doc = new jsPDF('p', 'mm', 'a4');

    let heightLeft = imgHeight;
    let sourceY = 0;
    let pageNum = 0;

    while (heightLeft > 0) {
      if (pageNum > 0) doc.addPage();

      const sliceHeight = Math.min(heightLeft, maxImgHeightPerPage);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = Math.round((sliceHeight / imgHeight) * canvas.height);
      const ctx = sliceCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, sourceY, canvas.width, sliceCanvas.height,
                    0, 0, sliceCanvas.width, sliceCanvas.height);

      const sliceData = sliceCanvas.toDataURL('image/png', 1.0);
      doc.addImage(sliceData, 'PNG', margin, margin, imgWidth, sliceHeight);

      sourceY += sliceCanvas.height;
      heightLeft -= sliceHeight;
      pageNum++;
    }

    const fname = filename || `翻译历史_${formatDateForFile(new Date())}`;
    doc.save(`${fname}.pdf`);

    showToast(`成功导出 ${data.length} 条历史到 PDF`, 'success');
    return true;

  } catch (error) {
    console.error('PDF导出失败：', error);
    showToast('PDF导出失败：' + (error.message || '未知错误'), 'error');
    return false;

  } finally {
    if (overlay && overlay.parentNode) {
      document.body.removeChild(overlay);
    }
  }
}

/**
 * 构建历史导出PDF的HTML
 */
function buildHistoryPDFHTML(data) {
  const title = '德英汉互译 — 翻译历史记录';
  const dateStr = formatTimestamp(Date.now());

  let rowsHTML = '';
  data.forEach((entry, i) => {
    const timeStr = formatTimestamp(entry.timestamp);
    const langStr = `${langName(entry.sourceLang)} → ${langName(entry.targetLang)}`;
    const sourceText = escapeHTML(entry.sourceText).replace(/\n/g, '<br>');
    const targetText = escapeHTML(entry.translatedText).replace(/\n/g, '<br>');
    const bgColor = i % 2 === 0 ? '#f8f9fa' : '#ffffff';

    rowsHTML += `
      <tr style="background:${bgColor};">
        <td class="pdf-td idx">${i + 1}</td>
        <td class="pdf-td time">${timeStr}</td>
        <td class="pdf-td lang">${langStr}</td>
        <td class="pdf-td src">${wrapTextByLang(entry.sourceText, entry.sourceLang)}</td>
        <td class="pdf-td tgt">${wrapTextByLang(entry.translatedText, entry.targetLang)}</td>
      </tr>`;
  });

  return `
    <div class="pdf-content">
      <div class="pdf-title">${escapeHTML(title)}</div>
      <div class="pdf-meta">导出时间：${dateStr} ｜ 共 ${data.length} 条记录</div>
      <table class="pdf-table">
        <thead>
          <tr>
            <th class="pdf-th idx">#</th>
            <th class="pdf-th time">时间</th>
            <th class="pdf-th lang">语言</th>
            <th class="pdf-th src">原文</th>
            <th class="pdf-th tgt">译文</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
      <div class="pdf-footer">由 德英汉互译工具 生成</div>
    </div>
  `;
}

/**
 * 导出当前筛选结果
 */
async function exportFilteredHistory(exportType, keyword) {
  const filtered = searchHistory(keyword || currentFilter, currentSourceLang, currentTargetLang);

  if (filtered.length === 0) {
    showToast('当前筛选条件下没有可导出的记录', 'warning');
    return;
  }

  if (exportType === 'excel') {
    await exportToExcel(filtered);
  } else if (exportType === 'pdf') {
    await exportToPDF(filtered);
  }
}

// ====================================================================
//  第三部分：工具函数
// ====================================================================

/**
 * 格式化日期为文件名安全的字符串
 */
function formatDateForFile(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}_${hours}${minutes}${seconds}`;
}

console.log('✅ export.js 加载完毕');
