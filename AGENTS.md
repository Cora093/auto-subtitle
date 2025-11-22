# AGENTS.md

B 站视频自动字幕 Tampermonkey 脚本开发指南

## 项目概述

这是一个单文件的 Tampermonkey 用户脚本，用于为 B 站视频自动生成字幕。项目采用模块化设计，但打包为单个 `.user.js` 文件以便于分发和安装。

## 项目结构

```
auto-subtitle/
├── README.md                      # 用户文档
├── AGENTS.md                      # 本文件（开发文档）
└── bilibili-auto-subtitle.user.js # 主脚本文件（单文件架构）
```

### 单文件架构说明

虽然最终是单个 `.user.js` 文件，但代码内部应保持模块化结构：

```javascript
// ==UserScript==
// @name         B站自动字幕
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  为B站视频自动生成字幕
// @author       You
// @match        https://www.bilibili.com/video/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';
    
    // 模块1: AudioExtractor
    // 模块2: CacheManager
    // 模块3: AISubtitleService
    // 模块4: SubtitleRenderer
    // 主入口逻辑
})();
```

## 开发环境

### 必需工具

- **浏览器**：Chrome 90+ / Edge 90+ / Firefox 88+
- **Tampermonkey 扩展**：用于开发和测试脚本
- **代码编辑器**：支持 JavaScript 语法高亮即可（VS Code、Sublime Text 等）

### 开发流程

1. **编辑脚本**
   - 在 Tampermonkey 管理面板中创建新脚本
   - 或直接编辑 `bilibili-auto-subtitle.user.js` 文件
   - 使用 Tampermonkey 的"文件"功能导入本地文件

2. **测试脚本**
   - 打开 B 站视频页面（匹配 `@match` 规则）
   - 打开浏览器开发者工具（F12）
   - 查看控制台输出和网络请求

3. **调试技巧**
   - 使用 `console.log()` 输出调试信息
   - 使用 `debugger;` 语句设置断点
   - 在 Tampermonkey 脚本编辑器中设置断点

## 代码规范

### 语法标准

- **ES6+ 语法**：使用现代 JavaScript 特性
- **严格模式**：所有代码包裹在 `'use strict';` 中
- **单引号**：字符串使用单引号
- **分号**：语句末尾使用分号

### 命名规范

- **类名**：PascalCase（如 `AudioExtractor`）
- **函数名**：camelCase（如 `extractAudio`）
- **常量**：UPPER_SNAKE_CASE（如 `MAX_CACHE_SIZE`）
- **私有成员**：以下划线开头（如 `_internalMethod`）

### 模块化设计

虽然是单文件，但应保持清晰的模块边界：

```javascript
// 模块定义示例
const AudioExtractor = (function() {
    // 私有变量
    const _defaultOptions = { ... };
    
    // 私有方法
    function _validateInput(input) { ... }
    
    // 公共接口
    return {
        extract: function(videoElement) { ... },
        download: function(audioBlob) { ... }
    };
})();
```

### 接口抽象模式

AI 接口应设计为抽象接口，便于切换不同的实现：

```javascript
// AI 接口抽象层
const AISubtitleService = {
    // 标准接口方法
    transcribe: async function(audioBlob, options) {
        // 调用具体实现
        return this._provider.transcribe(audioBlob, options);
    },
    
    // 设置提供者
    setProvider: function(provider) {
        this._provider = provider;
    }
};

// 具体实现示例
const OpenAIProvider = {
    transcribe: async function(audioBlob, options) {
        // OpenAI Whisper API 实现
    }
};
```

## 核心模块设计

### 1. AudioExtractor（音频提取模块）

**职责**：从 B 站视频元素中提取音频数据

**接口设计**：
```javascript
AudioExtractor.extract(videoElement, options)
  - 输入：video 元素，选项（格式、质量等）
  - 输出：Promise<Blob> 音频 Blob 对象

AudioExtractor.download(audioBlob, filename)
  - 输入：音频 Blob，文件名
  - 输出：Promise<void> 下载完成
```

**实现要点（参考 Bilibili-Evolved 逻辑）**：
- **优先方案：DASH 音频流提取**
  - 从 `window.__playinfo__` 获取 DASH 数据
  - 解析 `dash.audio` 数组，选择最高质量的音频流（`bandwidth` 最大）
  - 获取 `baseUrl` 和 `backupUrl`
  - 使用 `GM_xmlhttpRequest` 下载音频流（需处理 Referer 防盗链）
- **降级方案：MediaRecorder 录制**
  - 如果无法获取 DASH 数据，回退到 MediaRecorder 录制当前播放音频
- **通用处理**
  - 统一输出 Blob 对象
  - 处理下载进度和错误

### 2. CacheManager（缓存管理模块）

**职责**：管理浏览器 IndexedDB 缓存

**接口设计**：
```javascript
CacheManager.save(key, audioBlob)
  - 输入：缓存键，音频 Blob
  - 输出：Promise<void>

CacheManager.get(key)
  - 输入：缓存键
  - 输出：Promise<Blob|null>

CacheManager.clearOldest()
  - 清理最早的缓存，直到总大小 < MAX_CACHE_SIZE
  - 输出：Promise<void>

CacheManager.getTotalSize()
  - 获取当前缓存总大小
  - 输出：Promise<number> 字节数
```

**实现要点**：
- 使用 IndexedDB 存储音频 Blob
- 记录每个缓存项的时间戳和大小
- 实现 FIFO 清理策略
- 100MB 限制检查

### 3. AISubtitleService（AI 接口抽象层）

**职责**：提供统一的 AI 语音识别接口

**接口设计**：
```javascript
AISubtitleService.transcribe(audioBlob, options)
  - 输入：音频 Blob，选项（语言、格式等）
  - 输出：Promise<string> SRT 格式字幕字符串

AISubtitleService.setProvider(provider)
  - 设置具体的 AI 服务提供者
  - 输入：Provider 对象

AISubtitleService.validateConfig(config)
  - 验证配置是否完整
  - 输入：配置对象
  - 输出：boolean
```

**实现要点**：
- 定义标准的 Provider 接口规范
- 支持多种 AI 服务（OpenAI、阿里云、自定义）
- 处理 API 请求和响应
- 错误处理和重试机制
- 将响应转换为 SRT 格式

**Provider 接口规范**：
```javascript
{
  name: string,              // 提供者名称
  transcribe: async function(audioBlob, options) {
    // 返回 SRT 格式字符串
    return srtString;
  },
  validateConfig: function(config) {
    // 验证配置
    return isValid;
  }
}
```

### 4. SubtitleRenderer（字幕渲染模块）

**职责**：将字幕添加到 B 站视频播放器

**接口设计**：
```javascript
SubtitleRenderer.render(srtContent, videoContainer)
  - 输入：SRT 字幕内容，视频容器元素
  - 输出：Promise<void>

SubtitleRenderer.show()
  - 显示字幕

SubtitleRenderer.hide()
  - 隐藏字幕

SubtitleRenderer.updateTime(currentTime)
  - 根据当前播放时间更新字幕显示
  - 输入：当前播放时间（秒）
```

**实现要点**：
- 解析 SRT 格式字幕
- 创建字幕 DOM 元素
- 监听视频播放时间，同步显示字幕
- 样式与 B 站原生字幕保持一致
- 支持字幕位置和样式自定义

## 测试方法

### 手动测试流程

1. **音频提取测试**
   - 打开 B 站视频页面
   - 触发音频提取功能
   - 验证音频文件是否正确生成
   - 检查本地下载或缓存存储

2. **缓存管理测试**
   - 提取多个视频的音频
   - 验证缓存大小计算是否正确
   - 触发超过 100MB 限制
   - 验证最早缓存是否被清理

3. **AI 接口测试**
   - 配置有效的 AI API
   - 提交音频进行识别
   - 验证返回的 SRT 格式是否正确
   - 测试错误处理（无效 API Key、网络错误等）

4. **字幕渲染测试**
   - 生成字幕后验证是否正确显示
   - 测试字幕与视频播放同步
   - 验证字幕样式和位置
   - 测试字幕显示/隐藏切换

### 测试注意事项

- **API 费用**：测试时注意控制 API 调用次数，避免产生过多费用
- **跨域问题**：某些 AI 服务可能需要配置代理或使用 GM_xmlhttpRequest
- **浏览器兼容性**：在不同浏览器中测试 MediaRecorder 和 IndexedDB 的兼容性
- **性能测试**：测试长视频（>10分钟）的处理性能

## 安全考虑

### API Key 管理

- **存储方式**：使用 Tampermonkey 的 `GM_setValue` / `GM_getValue` 存储敏感信息
- **不要硬编码**：API Key 不应直接写在代码中
- **用户配置**：提供用户界面让用户自行配置 API Key

```javascript
// 安全存储示例
const apiKey = GM_getValue('ai_api_key', '');
if (!apiKey) {
    // 提示用户配置
    promptUserForApiKey();
}
```

### 跨域请求

- 使用 `GM_xmlhttpRequest` 而非 `fetch`，避免 CORS 限制
- 处理跨域错误和超时
- 验证 API 响应的完整性

### 存储限制

- IndexedDB 有配额限制，需要处理 `QuotaExceededError`
- 定期清理过期缓存
- 提供手动清理功能

### 内容安全

- 验证用户输入（文件名、配置参数等）
- 防止 XSS 攻击（字幕内容需要转义）
- 验证 SRT 格式的正确性

## 调试技巧

### 浏览器控制台调试

1. **查看脚本输出**
   ```javascript
   // 在脚本中使用
   console.log('Audio extracted:', audioBlob);
   console.error('API error:', error);
   ```

2. **检查 Tampermonkey 存储**
   ```javascript
   // 在控制台执行
   GM_getValue('cache_keys', []);
   ```

3. **监控网络请求**
   - 打开开发者工具 Network 标签
   - 查看 GM_xmlhttpRequest 发起的请求
   - 检查请求头和响应内容

### Tampermonkey 调试功能

- **脚本编辑器**：支持断点调试
- **脚本日志**：查看脚本运行日志
- **存储查看**：查看和管理脚本存储的数据

### 常见问题排查

1. **脚本未加载**
   - 检查 `@match` 规则是否正确
   - 确认 Tampermonkey 扩展已启用
   - 查看脚本是否在运行列表中

2. **API 请求失败**
   - 检查网络连接
   - 验证 API Key 是否正确
   - 查看 CORS 错误（使用 GM_xmlhttpRequest 避免）

3. **缓存操作失败**
   - 检查 IndexedDB 是否可用
   - 验证存储配额是否足够
   - 查看浏览器控制台错误信息

## 开发检查清单

在提交代码前，确保：

- [ ] 代码符合 ES6+ 语法规范
- [ ] 所有模块都有清晰的接口定义
- [ ] AI 接口抽象层设计合理，易于扩展
- [ ] 错误处理完善（try-catch、Promise.catch）
- [ ] 缓存管理逻辑正确（100MB 限制、FIFO 清理）
- [ ] SRT 格式解析和生成正确
- [ ] 字幕渲染与视频播放同步
- [ ] 代码注释清晰，关键逻辑有说明
- [ ] 测试过基本功能流程
- [ ] 处理了边界情况（空音频、API 错误等）

## 后续开发建议

1. **功能增强**
   - 支持批量处理播放列表
   - 添加字幕编辑功能
   - 支持多语言字幕

2. **性能优化**
   - 音频压缩以减少存储和传输
   - 字幕缓存（相同视频不重复识别）
   - 异步处理优化

3. **用户体验**
   - 添加进度提示
   - 错误提示更友好
   - 配置界面优化

