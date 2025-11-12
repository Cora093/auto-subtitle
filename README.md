# B 站视频自动字幕脚本

一个基于 Tampermonkey 的用户脚本，为 B 站视频自动生成字幕。通过提取视频音频、调用 AI 接口进行语音识别，并自动将字幕添加到视频播放器中。

## 功能特性

### 1. 音频提取
- 从当前正在观看的 B 站视频页面提取音频文件
- 支持两种存储方式：
  - **本地下载**：直接保存到用户下载目录
  - **浏览器缓存**：存储在浏览器 IndexedDB 中，便于快速访问
- 智能缓存管理：缓存超过 100MB 时自动清除最早的缓存文件

### 2. AI 字幕识别
- 抽象的 AI 接口设计，支持多种语音识别服务
- 自动将音频文件转换为 SRT 格式字幕
- 可配置的 API 接口，方便切换不同的 AI 服务提供商

### 3. 字幕显示
- 自动将生成的字幕添加到当前视频窗口
- 与 B 站原生字幕系统集成
- 支持字幕样式自定义

## 安装方法

### 前置要求
- 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
  - [Chrome 版本](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
  - [Firefox 版本](https://addons.mozilla.org/firefox/addon/tampermonkey/)
  - [Edge 版本](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

### 安装步骤
1. 安装 Tampermonkey 扩展
2. 打开 Tampermonkey 管理面板
3. 点击"创建新脚本"
4. 将 `bilibili-auto-subtitle.user.js` 文件内容复制到编辑器中
5. 保存脚本（Ctrl+S）
6. 刷新 B 站视频页面

## 使用说明

### 基本使用流程

1. **打开 B 站视频页面**
   - 访问任意 B 站视频播放页面
   - 脚本会自动检测并加载

2. **提取音频**
   - 点击视频播放器上的"提取音频"按钮（脚本添加）
   - 选择存储方式：本地下载或浏览器缓存
   - 等待音频提取完成

3. **生成字幕**
   - 音频提取完成后，点击"生成字幕"按钮
   - 脚本会自动调用配置的 AI 接口
   - 等待字幕生成（根据音频长度可能需要几分钟）

4. **查看字幕**
   - 字幕生成后会自动添加到视频播放器
   - 可以在 B 站字幕设置中切换显示/隐藏

### 高级功能

- **缓存管理**：在脚本设置中可以查看和管理缓存文件
- **批量处理**：支持为播放列表中的多个视频批量生成字幕
- **字幕导出**：可以将生成的字幕导出为独立的 SRT 文件

## 配置说明

### AI API 配置

脚本使用抽象的 AI 接口设计，需要配置具体的 AI 服务提供商。在脚本顶部找到配置区域：

```javascript
// AI 接口配置
const AI_CONFIG = {
  // 接口类型：'openai' | 'aliyun' | 'custom'
  provider: 'custom',
  
  // API 端点
  endpoint: 'https://your-api-endpoint.com/transcribe',
  
  // API Key（建议使用 Tampermonkey 的存储功能）
  apiKey: '',
  
  // 其他配置参数
  language: 'zh-CN',
  format: 'srt'
};
```

### 支持的 AI 服务

- **OpenAI Whisper API**：需要 OpenAI API Key
- **阿里云智能语音**：需要阿里云 AccessKey
- **自定义接口**：实现标准接口规范即可接入

### 存储配置

- **缓存大小限制**：默认 100MB，可在配置中修改
- **缓存清理策略**：FIFO（先进先出）
- **本地存储位置**：浏览器默认下载目录

## 技术架构

### 项目结构

```
auto-subtitle/
├── README.md                      # 用户文档
├── AGENTS.md                      # 开发文档
└── bilibili-auto-subtitle.user.js # 主脚本文件
```

### 单文件架构

虽然项目是单个 `.user.js` 文件，但内部采用模块化设计：

- **AudioExtractor**：音频提取模块
- **CacheManager**：缓存管理模块
- **AISubtitleService**：AI 接口抽象层
- **SubtitleRenderer**：字幕渲染模块

### 浏览器 API 依赖

- **MediaRecorder API**：用于音频录制
- **IndexedDB API**：用于浏览器缓存存储
- **Fetch API**：用于网络请求
- **File System Access API**：用于本地文件保存（可选）

## 依赖说明

### 浏览器要求
- Chrome 90+ / Edge 90+ / Firefox 88+
- 支持 ES6+ 语法
- 支持 IndexedDB

### 外部依赖
- 无外部 JavaScript 库依赖
- 仅依赖浏览器原生 API
- AI 服务通过 HTTP/HTTPS 调用

## 注意事项

1. **API 费用**：使用 AI 接口可能产生费用，请根据服务商定价合理使用
2. **隐私安全**：音频文件会发送到配置的 AI 服务，请注意隐私保护
3. **跨域限制**：某些 AI 服务可能需要配置 CORS，或使用代理
4. **存储限制**：浏览器缓存受 IndexedDB 配额限制（通常为可用磁盘空间的 50%）

## 常见问题

### Q: 脚本无法提取音频？
A: 检查浏览器是否支持 MediaRecorder API，并确保视频已开始播放。

### Q: 字幕生成失败？
A: 检查 AI API 配置是否正确，API Key 是否有效，网络连接是否正常。

### Q: 缓存占用空间过大？
A: 可以在脚本设置中手动清理缓存，或调整缓存大小限制。

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

