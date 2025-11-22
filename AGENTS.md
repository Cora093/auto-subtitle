# AGENTS.md

B 站视频自动字幕 Tampermonkey 脚本开发指南

## 项目概述

这是一个单文件的 Tampermonkey 用户脚本，集成音频提取、腾讯云 AI 识别和原生级字幕渲染功能。

## 核心技术实现

### 0. 配置管理 (ConfigManager)
- **安全存储**：使用 Tampermonkey 的 `GM_setValue` / `GM_getValue` API 将密钥加密存储在浏览器本地。
- **配置验证**：提供 `validate()` 方法检查配置完整性。
- **UI 集成**：提供可视化配置面板，用户无需修改代码。

### 1. 音频提取 (AudioExtractor)
- **DASH 解析**：通过 `window.__playinfo__` 获取高码率 DASH 音频流 URL。
- **格式处理**：优先下载 m4a 格式，与腾讯云 API 兼容性最好。
- **缓存机制**：使用 `CacheManager` (IndexedDB) 存储 Blob 数据，避免重复下载，设置 100MB 自动清理阈值。

### 2. AI 识别服务 (AISubtitleService)
- **API 对接**：对接腾讯云录音文件识别极速版 (`/asr/flash/v1`)。
- **签名鉴权**：
  - 内置纯 JavaScript 实现的 HMAC-SHA1 算法 (`HmacSha1`)，不依赖 `Web Crypto API`，确保在所有 Tampermonkey 环境下的兼容性。
  - 实现参数字典序排序和签名原文拼接。
- **智能分段算法 (`_jsonToSrt`)**：
  - **输入**：API 返回的 `sentence_list` (粗粒度) 和 `word_list` (词级)。
  - **逻辑**：
    1. 修正词级时间戳（累加 `sentence.start_time`）。
    2. 遍历单词，累积构建短句。
    3. **断句条件**：
       - 遇到标点符号 (`，。！？` 等)。
       - 当前句长超过 20 字符。
       - 单词间停顿超过 500ms。
  - **输出**：生成时间轴精准、长短适宜的 SRT 格式字幕。

### 3. 字幕渲染 (SubtitleRenderer)
- **DOM 注入**：自动侦测 B 站播放器容器 (`.bpx-player-video-area`) 并插入字幕层。
- **样式复刻**：
  - 使用半透明黑底 (`rgba(0,0,0,0.6)`) 和白色文字。
  - CSS 样式注入隔离 (`bili-auto-subtitle-style`)。
- **自适应缩放**：监听播放器 `ResizeObserver`，动态计算 `font-size` (约为宽度的 3.5%)。
- **同步机制**：使用 `requestAnimationFrame` 轮询 `video.currentTime`，实现高帧率同步。

## 开发调试

### 密钥配置
在 `TENCENT_CONFIG` 常量中配置测试用的 API Key。实际发布时应提醒用户替换。

### 调试控制台
脚本会在控制台输出关键日志：
- `[AudioExtractor]`: 音频流解析和下载进度。
- `[AISubtitleService]`: 签名原文和 API 响应状态。
- `[SubtitleRenderer]`: 字幕加载数量和渲染状态。

## 未来优化方向

### 1. 功能扩展
- **多模型支持**：增加 OpenAI Whisper API 接口支持（需处理 25MB 文件限制和分片上传）。
- **字幕导出**：添加“下载 SRT”按钮，允许用户保存字幕文件。
- **双语字幕**：利用翻译 API 实现实时双语字幕显示。

### 2. 性能与体验
- **长视频处理**：对于超过 2 小时或 100MB 的视频，实现前端音频分片上传或压缩（利用 ffmpeg.wasm）。
- **样式自定义**：提供字体大小、颜色、背景透明度的用户自定义选项。

## 已实现的优化

### ✅ 安全配置管理（v0.2.0）
- 实现了可视化配置面板，用户可通过 UI 输入和管理 API 密钥。
- 使用 `GM_setValue` 安全存储密钥，避免硬编码泄露风险。
- 首次使用自动引导配置流程。

### ✅ 字幕缓存功能（v0.2.1）
- 实现了字幕缓存机制，避免重复调用 API。
- 字幕数据与音频文件关联存储在 IndexedDB 中。
- **工作流程**：
  1. 首次识别：调用腾讯云 API，识别后自动保存字幕到缓存。
  2. 再次加载：直接从缓存读取，无需重新调用 API，节省成本和时间。
- **缓存管理**：
  - 字幕与音频文件关联存储（同一记录中）。
  - UI 显示缓存状态（"已缓存音频+字幕"或"已缓存音频"）。
  - 按钮文案智能切换（"加载字幕 (使用缓存)"或"生成字幕 (腾讯云 AI)"）。