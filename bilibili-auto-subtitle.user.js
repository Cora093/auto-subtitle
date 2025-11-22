// ==UserScript==
// @name         B站自动字幕
// @namespace    http://tampermonkey.net/
// @version      0.1.2
// @description  为B站视频自动生成字幕，支持提取音频、AI识别和字幕显示
// @author       You
// @match        https://www.bilibili.com/video/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 模块 1: AudioExtractor (音频提取模块)
    // ==========================================
    const AudioExtractor = (function() {
        function _getDashAudioUrl() {
            try {
                const playinfo = unsafeWindow.__playinfo__;
                if (!playinfo || !playinfo.data || !playinfo.data.dash) {
                    console.warn('[AudioExtractor] 未找到 DASH 数据');
                    return null;
                }
                const dashData = playinfo.data.dash;
                const audioArr = dashData.audio;
                if (!audioArr || audioArr.length === 0) {
                    console.warn('[AudioExtractor] DASH 中无音频流');
                    return null;
                }
                const bestAudio = audioArr.reduce((prev, current) => {
                    return (prev.bandwidth > current.bandwidth) ? prev : current;
                });
                console.log('[AudioExtractor] 找到最佳音频流:', bestAudio);
                return bestAudio.baseUrl || bestAudio.backupUrl[0];
            } catch (e) {
                console.error('[AudioExtractor] 解析 DASH 数据失败:', e);
                return null;
            }
        }

        function _downloadAudio(url, onProgress) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    responseType: 'blob',
                    headers: {
                        'Referer': 'https://www.bilibili.com/',
                        'User-Agent': navigator.userAgent
                    },
                    onprogress: (response) => {
                        if (onProgress && response.lengthComputable) {
                            const percent = Math.round((response.loaded / response.total) * 100);
                            onProgress(percent);
                        }
                    },
                    onload: (response) => {
                        if (response.status >= 200 && response.status < 300) {
                            resolve(response.response);
                        } else {
                            reject(new Error(`下载失败，状态码: ${response.status}`));
                        }
                    },
                    onerror: (err) => {
                        reject(err);
                    }
                });
            });
        }

        function _getVideoTitle() {
            const titleEl = document.querySelector('.video-title') || document.title;
            let title = typeof titleEl === 'string' ? titleEl : titleEl.innerText;
            return title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'bilibili_audio';
        }

        return {
            extract: async function(onProgress) {
                console.log('[AudioExtractor] 开始提取音频...');
                const dashUrl = _getDashAudioUrl();
                if (dashUrl) {
                    console.log('[AudioExtractor] 使用 DASH 接口下载...');
                    const blob = await _downloadAudio(dashUrl, onProgress);
                    const filename = _getVideoTitle() + '.m4a';
                    return { blob, filename };
                }
                throw new Error('无法提取音频：DASH 接口不可用或下载失败。');
            },
            
            getVideoId: function() {
                 const bvid = unsafeWindow?.bvid || location.pathname.split('/')[2];
                 return bvid || 'unknown_video';
            }
        };
    })();

    // ==========================================
    // 模块 2: CacheManager (缓存管理模块)
    // ==========================================
    const CacheManager = (function() {
        const DB_NAME = 'BilibiliSubtitleCache';
        const STORE_NAME = 'audios';
        const DB_VERSION = 1;
        const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB

        let _db = null;

        function _openDB() {
            return new Promise((resolve, reject) => {
                if (_db) return resolve(_db);
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onerror = (event) => {
                    console.error('[CacheManager] 打开数据库失败', event);
                    reject('无法打开 IndexedDB');
                };
                request.onsuccess = (event) => {
                    _db = event.target.result;
                    resolve(_db);
                };
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
                        objectStore.createIndex('size', 'size', { unique: false });
                    }
                };
            });
        }

        async function _checkQuotaAndClear() {
            const db = await _openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORE_NAME], 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.getAll();
                
                request.onsuccess = async (event) => {
                    const items = event.target.result;
                    let totalSize = items.reduce((sum, item) => sum + item.blob.size, 0);
                    
                    if (totalSize > MAX_CACHE_SIZE) {
                        console.log(`[CacheManager] 缓存总大小 (${(totalSize/1024/1024).toFixed(2)}MB) 超过限制，开始清理...`);
                        items.sort((a, b) => a.timestamp - b.timestamp);
                        
                        const deleteTransaction = db.transaction([STORE_NAME], 'readwrite');
                        const deleteStore = deleteTransaction.objectStore(STORE_NAME);
                        
                        for (const item of items) {
                            if (totalSize <= MAX_CACHE_SIZE) break;
                            deleteStore.delete(item.id);
                            totalSize -= item.blob.size;
                            console.log(`[CacheManager] 已删除旧缓存: ${item.id}`);
                        }
                    }
                    resolve();
                };
                request.onerror = reject;
            });
        }

        return {
            save: async function(id, blob, filename) {
                await _checkQuotaAndClear();
                const db = await _openDB();
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction([STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);
                    const record = {
                        id: id,
                        blob: blob,
                        filename: filename,
                        timestamp: Date.now(),
                        size: blob.size
                    };
                    const request = store.put(record);
                    request.onsuccess = () => resolve();
                    request.onerror = (e) => reject(e);
                });
            },

            get: async function(id) {
                const db = await _openDB();
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction([STORE_NAME], 'readonly');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.get(id);
                    request.onsuccess = (event) => {
                        resolve(event.target.result);
                    };
                    request.onerror = (e) => reject(e);
                });
            },

            has: async function(id) {
                const item = await this.get(id);
                return !!item;
            }
        };
    })();

    // ==========================================
    // 模块 3: AISubtitleService (AI 接口服务)
    // ==========================================
    const AISubtitleService = (function() {
        
        // Mock Provider 实现
        const MockProvider = {
            name: 'mock',
            transcribe: async function(audioBlob, options) {
                return new Promise((resolve) => {
                    console.log('[AISubtitleService] Mock Provider: 开始处理音频...', audioBlob);
                    setTimeout(() => {
                        resolve(`1
00:00:01,000 --> 00:00:05,000
这是一个 Mock 字幕。
This is a mock subtitle.

2
00:00:06,000 --> 00:00:10,000
AI 接口调用成功！
AI API call successful!`);
                    }, 2000); // 模拟 2 秒延迟
                });
            },
            validateConfig: () => true
        };

        let _currentProvider = MockProvider; // 默认使用 Mock

        return {
            transcribe: async function(audioBlob, options) {
                if (!_currentProvider) {
                    throw new Error('未设置 AI 提供者');
                }
                return _currentProvider.transcribe(audioBlob, options);
            },
            setProvider: function(provider) {
                _currentProvider = provider;
            },
            getProviderName: function() {
                return _currentProvider ? _currentProvider.name : 'None';
            }
        };
    })();

    // ==========================================
    // 模块 4: UI Manager (界面管理)
    // ==========================================
    const UIManager = (function() {
        let _container = null;
        let _statusDiv = null;
        let _actionBtn = null;
        let _currentVideoId = null;

        function _createUI() {
            if (_container) return;

            _container = document.createElement('div');
            _container.style.cssText = `
                position: fixed; top: 150px; right: 20px; z-index: 9999;
                background: white; padding: 15px; border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1); width: 220px;
                font-family: sans-serif;
            `;
            
            const title = document.createElement('h3');
            title.innerText = 'B站自动字幕';
            title.style.margin = '0 0 10px 0';
            title.style.fontSize = '16px';
            _container.appendChild(title);

            _actionBtn = document.createElement('button');
            _actionBtn.innerText = '初始化中...';
            _actionBtn.style.cssText = `
                display: block; width: 100%; padding: 8px;
                background: #ccc; color: white; border: none;
                border-radius: 4px; cursor: pointer; margin-bottom: 8px;
            `;
            // 初始不绑定具体 onclick，或绑定一个空函数，等待 _checkStatus 更新
            _actionBtn.onclick = () => {}; 
            _container.appendChild(_actionBtn);

            _statusDiv = document.createElement('div');
            _statusDiv.style.fontSize = '12px';
            _statusDiv.style.color = '#666';
            _statusDiv.innerText = '检查缓存中...';
            _container.appendChild(_statusDiv);

            document.body.appendChild(_container);
            
            _checkStatus();
        }

        async function _checkStatus() {
            try {
                _currentVideoId = AudioExtractor.getVideoId();
                const cached = await CacheManager.get(_currentVideoId);
                if (cached) {
                    _updateStatus(`已缓存 (${(cached.size / 1024 / 1024).toFixed(1)} MB)`);
                    _actionBtn.innerText = '生成字幕 (Mock AI)';
                    _actionBtn.onclick = _handleGenerateSubtitle;
                    _actionBtn.style.background = '#4caf50';
                    _actionBtn.disabled = false;
                } else {
                    _updateStatus('未缓存音频');
                    _actionBtn.innerText = '提取音频';
                    _actionBtn.onclick = _handleExtract;
                    _actionBtn.style.background = '#00a1d6';
                    _actionBtn.disabled = false;
                }
            } catch (e) {
                console.error('[UIManager] 状态检查失败:', e);
                _updateStatus('状态检查出错');
            }
        }

        async function _handleExtract() {
            try {
                _updateStatus('正在下载音频...');
                _actionBtn.disabled = true;
                
                const { blob, filename } = await AudioExtractor.extract((percent) => {
                    _updateStatus(`下载中: ${percent}%`);
                });

                _updateStatus('正在存入缓存...');
                await CacheManager.save(_currentVideoId, blob, filename);
                
                _updateStatus('缓存完成');
                _checkStatus();
            } catch (e) {
                console.error(e);
                _updateStatus(`错误: ${e.message}`);
                _actionBtn.disabled = false;
            }
        }

        async function _handleGenerateSubtitle() {
            try {
                _updateStatus('正在读取缓存...');
                _actionBtn.disabled = true;

                const cachedItem = await CacheManager.get(_currentVideoId);
                if (!cachedItem) {
                    throw new Error('缓存文件丢失，请重新提取');
                }

                _updateStatus('AI 正在识别 (Mock)...');
                const srt = await AISubtitleService.transcribe(cachedItem.blob);

                console.log('生成的 SRT 字幕:', srt);
                _updateStatus('字幕生成成功！(请查看控制台)');
                alert('Mock 字幕已生成，内容请查看浏览器控制台');

            } catch (e) {
                console.error(e);
                _updateStatus(`AI 错误: ${e.message}`);
            } finally {
                _actionBtn.disabled = false;
            }
        }

        function _updateStatus(text) {
            if (_statusDiv) _statusDiv.innerText = text;
        }

        return {
            init: function() {
                window.addEventListener('load', () => setTimeout(_createUI, 1000));
                GM_registerMenuCommand('显示控制面板', _createUI);
                
                let lastUrl = location.href;
                // 使用 setInterval 轮询作为 MutationObserver 的补充，防止某些情况未触发
                setInterval(() => {
                    if (location.href !== lastUrl) {
                        lastUrl = location.href;
                        setTimeout(_checkStatus, 1000);
                    }
                }, 2000);
            }
        };
    })();

    (function main() {
        UIManager.init();
    })();

})();
