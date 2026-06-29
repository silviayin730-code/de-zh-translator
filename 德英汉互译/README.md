# 德英汉互译 — 双语翻译网页工具

## 📖 项目简介

一个纯前端的德汉/英汉双语翻译网页工具，支持文本粘贴翻译、DOCX/PDF文件上传翻译、实时字幕、翻译记忆、自定义术语表等功能。双击 `index.html` 即可在浏览器中运行，无需安装任何软件。

### ✨ 核心功能

| 功能 | 说明 |
|------|------|
| 🔄 双向翻译 | 德语↔中文、英语↔中文自由切换 |
| 📄 多文件翻译 | 支持粘贴文本、上传DOCX Word文档、PDF文档 |
| ⚡ 实时字幕翻译 | 输入时300ms防抖，实时流式显示译文 |
| 🧠 翻译记忆库 | 自动缓存翻译结果，重复原文自动回填 |
| 📖 自定义术语表 | 手动添加专业词汇，翻译时优先匹配术语 |
| ⏰ 自动清理 | 可设置1/3/5天保留，到期自动清理过期记录 |
| 🔍 历史管理 | 时间倒序展示、置顶、删除、批量清空、关键词搜索 |
| 📥 导出功能 | 双语对照Excel表格、双语PDF文档下载 |

---

## 🚀 本地运行（零安装）

### 准备工作
1. 获取 DeepSeek API Key：
   - 访问 https://platform.deepseek.com/
   - 注册/登录账号
   - 在API Keys页面创建新的API Key（以 `sk-` 开头）
   - 复制保存好这个Key

### 运行步骤
1. 确保所有文件在同一个文件夹中（目录结构见下方）
2. 双击 `index.html`，用浏览器打开
3. 点击右上角「⚙️ 设置」，粘贴你的 DeepSeek API Key
4. 保存设置，开始使用！

### 目录结构
```
德英汉互译/
├── index.html          ← 双击这个文件启动
├── css/
│   └── style.css
├── js/
│   ├── settings.js
│   ├── glossary.js
│   ├── memory.js
│   ├── translator.js
│   ├── fileHandler.js
│   ├── history.js
│   ├── export.js
│   ├── cleanup.js
│   └── app.js
└── README.md
```

> ⚠️ **注意**：首次打开需要联网加载CDN库（mammoth.js、pdf.js等），加载完成后可正常使用。建议使用Chrome、Edge、Firefox等现代浏览器。

---

## 🌐 免费公网部署教程

以下任选一种方式，5分钟内即可获得公网访问链接：

### 方式一：GitHub Pages（推荐，永久免费）

1. 注册 GitHub 账号：https://github.com/
2. 创建新仓库（New Repository），名称任意（如 `de-zh-translator`）
3. 上传所有项目文件到仓库：
   - 点击「uploading an existing file」
   - 将整个文件夹拖入浏览器
   - 点击「Commit changes」
4. 开启 GitHub Pages：
   - 进入仓库 → Settings → Pages
   - Source 选择 `main` 分支，根目录 `/ (root)`
   - 点击 Save
5. 等待1-2分钟，页面会显示公网地址：
   `https://你的用户名.github.io/de-zh-translator/`

### 方式二：Netlify（拖拽部署，免费）

1. 访问 https://app.netlify.com/
2. 用 GitHub 账号登录（或邮箱注册）
3. 在 Sites 页面，将整个项目文件夹**直接拖入**浏览器窗口
4. Netlify 自动部署，几秒后生成公网地址：
   `https://xxxxx.netlify.app`
5. 可在 Site settings 中自定义子域名

### 方式三：Vercel（免费）

1. 访问 https://vercel.com/
2. 用 GitHub 账号登录
3. 点击「New Project」→ 导入你的 GitHub 仓库
4. 无需任何配置，直接点击「Deploy」
5. 获得公网地址：`https://xxxxx.vercel.app`

> 💡 **提示**：以上三种方式全部免费，推荐 GitHub Pages（稳定、无流量限制）。
> 部署后把链接发给老师即可在任意设备上打开使用。

---

## 📋 使用说明

### 1. 文本翻译
- 在左侧输入框输入/粘贴文本
- 选择语言对（如 德语→中文）
- 自动实时翻译，或点击「🔄 翻译」按钮

### 2. 文件翻译
- 点击「📎 上传DOCX」或「📎 上传PDF」
- 选择文件后自动提取文本并填充到输入框
- 自动触发翻译

### 3. 术语表管理
- 点击右上角「📖 术语表」
- 添加专业词汇（如：Maschinelles Lernen → 机器学习）
- 翻译时会自动优先匹配术语表中的译法

### 4. 历史记录
- 所有翻译自动保存到底部历史列表
- 可搜索原文/译文关键词
- 支持置顶（最多5条）、删除、批量清空

### 5. 导出
- 点击「📥 导出Excel」下载双语对照表格
- 点击「📥 导出PDF」下载双语对照文档

### 6. 设置
- API Key：填写你的DeepSeek API Key
- 保留天数：选择1/3/5天，到期自动清理

---

## 🎓 期末PPT讲解提纲

### 第一页：封面
- 作品名称：德英汉双语翻译网页工具
- 姓名、学号、班级、日期

### 第二页：项目背景与需求
- 德语学习中的翻译需求
- 现有工具不足（需安装软件、不支持术语定制）
- 本项目目标：零安装、一键打开、专业翻译

### 第三页：技术架构
- 纯前端 SPA（HTML + CSS + JavaScript）
- 调用 DeepSeek V4 Pro 大模型API
- CDN引入第三方库（mammoth.js、pdf.js、SheetJS、jsPDF）
- 数据本地存储（localStorage）

### 第四页：核心功能演示（一）
- 双语翻译（德语↔中文、英语↔中文）
- 多文件翻译（DOCX/PDF文本提取）
- 实时字幕翻译（流式输出 + 300ms防抖）
- 现场演示截图

### 第五页：核心功能演示（二）
- 翻译记忆库原理与效果
- 自定义术语表管理
- 历史记录搜索、置顶、导出
- 现场演示截图

### 第六页：翻译记忆库设计
- 数据结构：{原文, 译文, 语言对, 时间戳, 命中次数}
- 查找策略：完全匹配 → 模糊匹配
- 淘汰策略：最多500条，超限删最旧
- 与术语表的协同工作流程

### 第七页：自定义语料库设计
- 术语数据模型：{源词, 目标词, 源语言, 目标语言, 优先级}
- 匹配算法：长词优先匹配（避免"机器"误匹配"机器学习"）
- Prompt注入策略：在系统提示中注入术语表而非直接替换原文

### 第八页：DeepSeek API 对接
- API地址：https://api.deepseek.com/chat/completions
- 模型：deepseek-v4-pro
- 参数：temperature=0.3（低温翻译一致）、thinking=disabled
- 流式vs非流式：实时字幕用流式，手动翻译用非流式
- 错误处理：401/429/500/超时分类提示

### 第九页：自动清理机制
- 保留天数：用户可选 1/3/5 天
- 清理策略：置顶记录永不过期
- 调度机制：页面加载检查 + 每24小时定时检查
- 存储保护：超限自动淘汰最旧数据

### 第十页：部署方案
- 本地使用：双击 index.html
- 公网部署：GitHub Pages / Netlify / Vercel
- 演示公网访问链接

### 第十一页：项目总结
- 完成情况：覆盖全部8项硬性要求
- 技术亮点：防抖实时翻译、术语长词优先匹配、中文PDF解决方案
- 不足与改进：可增加OCR支持、多语种扩展
- 致谢

---

## 🔑 技术说明

### 翻译API参数
- **模型**：`deepseek-v4-pro`
- **Temperature**：0.3（保持翻译一致性）
- **Max Tokens**：4096
- **Thinking模式**：已禁用（翻译任务不需要推理链）
- **超时**：30秒

### 数据存储
- 全部使用 `localStorage`
- 4个独立Key：`app_settings`、`translation_history`、`translator_memory`、`glossary_entries`
- 总存储上限约5MB，自动淘汰机制防止写满

### 浏览器兼容
- Chrome 90+
- Edge 90+
- Firefox 90+
- Safari 14+
- 需要支持 `fetch`、`localStorage`、`AbortController`
