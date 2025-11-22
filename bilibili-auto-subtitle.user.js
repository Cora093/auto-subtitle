// ==UserScript==
// @name         B站自动字幕
// @namespace    http://tampermonkey.net/
// @version      0.2.0
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
    // 模块 0: ConfigManager (配置管理模块)
    // ==========================================
    const ConfigManager = (function() {
        const CONFIG_KEY = 'bili_subtitle_config';
        
        const DEFAULT_CONFIG = {
            APPID: "",
            SECRET_ID: "",
            SECRET_KEY: "",
            ENGINE_TYPE: "16k_zh"
        };

        return {
            get: function() {
                const saved = GM_getValue(CONFIG_KEY, null);
                if (saved) {
                    return JSON.parse(saved);
                }
                return DEFAULT_CONFIG;
            },

            save: function(config) {
                GM_setValue(CONFIG_KEY, JSON.stringify(config));
            },

            isConfigured: function() {
                const config = this.get();
                return !!(config.APPID && config.SECRET_ID && config.SECRET_KEY);
            },

            validate: function(config) {
                if (!config.APPID || !config.APPID.trim()) {
                    return { valid: false, message: 'APPID 不能为空' };
                }
                if (!config.SECRET_ID || !config.SECRET_ID.trim()) {
                    return { valid: false, message: 'SECRET_ID 不能为空' };
                }
                if (!config.SECRET_KEY || !config.SECRET_KEY.trim()) {
                    return { valid: false, message: 'SECRET_KEY 不能为空' };
                }
                return { valid: true };
            }
        };
    })();

    // ==========================================
    // 模块 1: AudioExtractor (音频提取模块)
    // ==========================================
    const AudioExtractor = (function() {
        function _getDashAudioUrl() {
            try {
                const playinfo = unsafeWindow.__playinfo__;
                if (!playinfo || !playinfo.data || !playinfo.data.dash) return null;
                const dashData = playinfo.data.dash;
                const audioArr = dashData.audio;
                if (!audioArr || audioArr.length === 0) return null;
                const bestAudio = audioArr.reduce((prev, current) => {
                    return (prev.bandwidth > current.bandwidth) ? prev : current;
                });
                return bestAudio.baseUrl || bestAudio.backupUrl[0];
            } catch (e) {
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
                    onerror: (err) => reject(err)
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
                    const blob = await _downloadAudio(dashUrl, onProgress);
                    const filename = _getVideoTitle() + '.m4a';
                    return { blob, filename };
                }
                throw new Error('无法提取音频：DASH 接口不可用。');
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
        const MAX_CACHE_SIZE = 100 * 1024 * 1024; 

        let _db = null;

        function _openDB() {
            return new Promise((resolve, reject) => {
                if (_db) return resolve(_db);
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onerror = (event) => reject('无法打开 IndexedDB');
                request.onsuccess = (event) => {
                    _db = event.target.result;
                    resolve(_db);
                };
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
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
                        items.sort((a, b) => a.timestamp - b.timestamp);
                        const deleteTransaction = db.transaction([STORE_NAME], 'readwrite');
                        const deleteStore = deleteTransaction.objectStore(STORE_NAME);
                        
                        for (const item of items) {
                            if (totalSize <= MAX_CACHE_SIZE) break;
                            deleteStore.delete(item.id);
                            totalSize -= item.blob.size;
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
                    store.put(record).onsuccess = () => resolve();
                });
            },

            get: async function(id) {
                const db = await _openDB();
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction([STORE_NAME], 'readonly');
                    const store = transaction.objectStore(STORE_NAME);
                    store.get(id).onsuccess = (e) => resolve(e.target.result);
                });
            },
            
            has: async function(id) {
                return !!(await this.get(id));
            }
        };
    })();

    // ==========================================
    // 模块 3: AISubtitleService (AI 接口服务)
    // ==========================================
    const AISubtitleService = (function() {
        
        // 纯 JS HMAC-SHA1 实现
        const HmacSha1 = function(key, data) {
            var b64pad="=";
            var chrsz=8;
            function b64_hmac_sha1(k,d){return binb2b64(core_hmac_sha1(k,d))}
            function binb2b64(binarray){var tab="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";var str="";for(var i=0;i<binarray.length*4;i+=3){var triplet=(((binarray[i>>2]>>8*(3-i%4))&0xFF)<<16)|(((binarray[i+1>>2]>>8*(3-(i+1)%4))&0xFF)<<8)|((binarray[i+2>>2]>>8*(3-(i+2)%4))&0xFF);for(var j=0;j<4;j++){if(i*8+j*6>binarray.length*32)str+=b64pad;else str+=tab.charAt((triplet>>6*(3-j))&0x3F)}}return str}
            function core_hmac_sha1(key,data){var bkey=str2binb(key);if(bkey.length>16)bkey=core_sha1(bkey,key.length*chrsz);var ipad=Array(16),opad=Array(16);for(var i=0;i<16;i++){ipad[i]=bkey[i]^0x36363636;opad[i]=bkey[i]^0x5C5C5C5C}var hash=core_sha1(ipad.concat(str2binb(data)),512+data.length*chrsz);return core_sha1(opad.concat(hash),512+160)}
            function core_sha1(x,len){x[len>>5]|=0x80<<(24-len%32);x[((len+64>>9)<<4)+15]=len;var w=Array(80);var a=1732584193;var b=-271733879;var c=-1732584194;var d=271733878;var e=-1009589776;for(var i=0;i<x.length;i+=16){var olda=a;var oldb=b;var oldc=c;var oldd=d;var olde=e;for(var j=0;j<80;j++){if(j<16)w[j]=x[i+j];else w[j]=rol(w[j-3]^w[j-8]^w[j-14]^w[j-16],1);var t=safe_add(safe_add(rol(a,5),sha1_ft(j,b,c,d)),safe_add(safe_add(e,w[j]),sha1_kt(j)));e=d;d=c;c=rol(b,30);b=a;a=t}a=safe_add(a,olda);b=safe_add(b,oldb);c=safe_add(c,oldc);d=safe_add(d,oldd);e=safe_add(e,olde)}return Array(a,b,c,d,e)}
            function sha1_ft(t,b,c,d){if(t<20)return(b&c)|((~b)&d);if(t<40)return b^c^d;if(t<60)return(b&c)|(b&d)|(c&d);return b^c^d}
            function sha1_kt(t){return(t<20)?1518500249:(t<40)?1859775393:(t<60)?-1894007588:-899497514}
            function safe_add(x,y){var lsw=(x&0xFFFF)+(y&0xFFFF);var msw=(x>>16)+(y>>16)+(lsw>>16);return(msw<<16)|(lsw&0xFFFF)}
            function rol(num,cnt){return(num<<cnt)|(num>>>(32-cnt))}
            function str2binb(str){var bin=Array();var mask=(1<<chrsz)-1;for(var i=0;i<str.length*chrsz;i+=chrsz)bin[i>>5]|=(str.charCodeAt(i/chrsz)&mask)<<(24-i%32);return bin}
            
            return b64_hmac_sha1(key, data);
        };

        function formatTime(ms) {
            const date = new Date(ms);
            const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
            const m = String(date.getUTCMinutes()).padStart(2, '0');
            const s = String(date.getUTCSeconds()).padStart(2, '0');
            const millis = String(date.getUTCMilliseconds()).padStart(3, '0');
            return `${h}:${m}:${s},${millis}`;
        }

        const TencentCloudProvider = {
            name: 'tencent',
            
            transcribe: async function(audioBlob) {
                // 从 ConfigManager 读取配置
                const config = ConfigManager.get();
                
                const timestamp = Math.floor(Date.now() / 1000);
                const params = {
                    secretid: config.SECRET_ID,
                    engine_type: config.ENGINE_TYPE,
                    timestamp: timestamp,
                    voice_format: 'm4a', 
                    speaker_diarization: 0,
                    filter_dirty: 0,
                    filter_modal: 0,
                    filter_punc: 0,
                    convert_num_mode: 1,
                    word_info: 2 
                };

                const sortedKeys = Object.keys(params).sort();
                let queryStr = '';
                for (const key of sortedKeys) {
                    queryStr += `${key}=${params[key]}&`;
                }
                queryStr = queryStr.slice(0, -1); 

                const urlHost = "asr.cloud.tencent.com";
                const urlPath = `/asr/flash/v1/${config.APPID}`;
                const signStr = `POST${urlHost}${urlPath}?${queryStr}`;

                console.log('[AISubtitleService] 签名原文:', signStr);
                const signature = HmacSha1(config.SECRET_KEY, signStr);
                console.log('[AISubtitleService] 签名结果:', signature);
                
                const requestUrl = `https://${urlHost}${urlPath}?${queryStr}`;
                
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: requestUrl,
                        headers: {
                            'Host': urlHost,
                            'Authorization': signature,
                            'Content-Type': 'application/octet-stream',
                            'Content-Length': audioBlob.size
                        },
                        data: audioBlob,
                        onload: (response) => {
                            if (response.status === 200) {
                                try {
                                    const resData = JSON.parse(response.responseText);
                                    if (resData.code === 0) {
                                        const srt = this._jsonToSrt(resData);
                                        resolve(srt);
                                    } else {
                                        reject(new Error(`腾讯云 API 错误: ${resData.code} - ${resData.message}`));
                                    }
                                } catch (e) {
                                    reject(new Error('解析响应失败: ' + e.message));
                                }
                            } else {
                                reject(new Error(`请求失败: ${response.status} ${response.statusText}`));
                            }
                        },
                        onerror: (err) => reject(new Error('网络错误'))
                    });
                });
            },

            _jsonToSrt: function(json) {
                let srt = '';
                let index = 1;
                
                if (json.flash_result && json.flash_result[0]) {
                    const sentenceList = json.flash_result[0].sentence_list;
                    let allWords = [];
                    
                    // 1. 扁平化所有单词，并修正时间戳
                    // 注意：腾讯云极速版 word_list 时间戳是相对于 sentence 的相对偏移，需累加 sentence.start_time
                    sentenceList.forEach(sent => {
                        if (sent.word_list) {
                            const sentStart = sent.start_time;
                            const absWords = sent.word_list.map(w => ({
                                word: w.word,
                                start_time: w.start_time + sentStart,
                                end_time: w.end_time + sentStart
                            }));
                            allWords = allWords.concat(absWords);
                        }
                    });

                    if (allWords.length === 0) return '';

                    // 2. 重组单词为短句
                    let currentSegment = [];
                    let currentLength = 0;
                    const MAX_CHARS = 20; 
                    const PUNCTUATION = /[，。！？；：、,.;:?!]/;

                    for (let i = 0; i < allWords.length; i++) {
                        const wordObj = allWords[i];
                        const word = wordObj.word;
                        
                        currentSegment.push(wordObj);
                        currentLength += word.length;

                        const isPunctuation = PUNCTUATION.test(word);
                        const isOverLength = currentLength >= MAX_CHARS;
                        const isLastWord = i === allWords.length - 1;
                        let isPause = false;
                        if (!isLastWord) {
                            const nextWord = allWords[i+1];
                            if (nextWord.start_time - wordObj.end_time > 500) {
                                isPause = true;
                            }
                        }

                        if (isPunctuation || isOverLength || isPause || isLastWord) {
                            if (currentSegment.length > 0) {
                                const startTime = formatTime(currentSegment[0].start_time);
                                const endTime = formatTime(currentSegment[currentSegment.length - 1].end_time);
                                const text = currentSegment.map(w => w.word).join('');
                                
                                srt += `${index}\n${startTime} --> ${endTime}\n${text}\n\n`;
                                index++;
                                
                                currentSegment = [];
                                currentLength = 0;
                            }
                        }
                    }
                }
                return srt;
            }
        };

        let _currentProvider = TencentCloudProvider; 

        return {
            transcribe: async function(audioBlob) {
                if (!_currentProvider) throw new Error('未设置 AI 提供者');
                if (!ConfigManager.isConfigured()) {
                    throw new Error('请先配置腾讯云 API 密钥');
                }
                return _currentProvider.transcribe(audioBlob);
            }
        };
    })();

    // ==========================================
    // 模块 4: SRTParser (SRT 解析器)
    // ==========================================
    const SRTParser = {
        parse: function(srtContent) {
            const items = [];
            if (!srtContent) return items;
            
            const blocks = srtContent.trim().replace(/\r\n/g, '\n').split('\n\n');
            
            blocks.forEach(block => {
                const lines = block.split('\n');
                if (lines.length >= 3) {
                    const timeLine = lines[1];
                    const times = timeLine.split(' --> ');
                    if (times.length === 2) {
                        const start = this._timeToSeconds(times[0]);
                        const end = this._timeToSeconds(times[1]);
                        const text = lines.slice(2).join('\n');
                        items.push({ start, end, text });
                    }
                }
            });
            return items;
        },

        _timeToSeconds: function(timeStr) {
            const parts = timeStr.split(':');
            const secondsParts = parts[2].split(',');
            const h = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            const s = parseInt(secondsParts[0], 10);
            const ms = parseInt(secondsParts[1], 10);
            return h * 3600 + m * 60 + s + ms / 1000;
        }
    };

    // ==========================================
    // 模块 5: SubtitleRenderer (字幕渲染模块)
    // ==========================================
    const SubtitleRenderer = (function() {
        let _container = null;
        let _textElement = null;
        let _subtitles = [];
        let _videoElement = null;
        let _animationFrameId = null;
        let _playerElement = null;
        let _isVisible = true;
        let _isLoaded = false;

        function _injectStyles() {
            const styleId = 'bili-auto-subtitle-style';
            if (document.getElementById(styleId)) return;
            
            const css = `
                .bili-auto-subtitle-container {
                    position: absolute;
                    bottom: 8%;
                    left: 50%;
                    transform: translateX(-50%);
                    text-align: center;
                    pointer-events: none;
                    z-index: 20;
                    width: 100%;
                }
                .bili-auto-subtitle-text-bg {
                    display: inline-block;
                    background: rgba(0, 0, 0, 0.6);
                    border-radius: 4px;
                    padding: 4px 12px;
                    backdrop-filter: blur(2px);
                }
                .bili-auto-subtitle-text {
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
                    text-shadow: 0 1px 2px rgba(0,0,0,0.4);
                    line-height: 1.5;
                    white-space: pre-wrap;
                }
            `;
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = css;
            document.head.appendChild(style);
        }

        function _initElements() {
            _videoElement = document.querySelector('video');
            _playerElement = document.querySelector('.bpx-player-video-area') || document.querySelector('.bilibili-player-video-area');
            
            if (!_videoElement || !_playerElement) return false;

            if (!_container) {
                _container = document.createElement('div');
                _container.className = 'bili-auto-subtitle-container';
                
                const contentWrap = document.createElement('div');
                contentWrap.className = 'bili-auto-subtitle-text-bg';
                
                _textElement = document.createElement('span');
                _textElement.className = 'bili-auto-subtitle-text';
                
                contentWrap.appendChild(_textElement);
                _container.appendChild(contentWrap);
                _playerElement.appendChild(_container);
                
                _handleResize();
                new ResizeObserver(() => _handleResize()).observe(_playerElement);
            }
            return true;
        }

        function _handleResize() {
            if (!_playerElement || !_textElement) return;
            const width = _playerElement.clientWidth;
            let fontSize = Math.max(16, width * 0.035); 
            _textElement.style.fontSize = `${fontSize}px`;
        }

        function _update() {
            if (!_videoElement || _subtitles.length === 0) return;

            const currentTime = _videoElement.currentTime;
            const activeSub = _subtitles.find(sub => currentTime >= sub.start && currentTime <= sub.end);
            
            if (activeSub && _isVisible) {
                if (_textElement.innerText !== activeSub.text) {
                    _textElement.innerText = activeSub.text;
                    _container.style.display = 'block';
                }
            } else {
                if (_container.style.display !== 'none') {
                    _container.style.display = 'none';
                    _textElement.innerText = '';
                }
            }
            _animationFrameId = requestAnimationFrame(_update);
        }

        return {
            render: function(srtContent) {
                _injectStyles();
                if (!_initElements()) {
                    console.error('[SubtitleRenderer] 找不到播放器元素');
                    return;
                }
                
                _subtitles = SRTParser.parse(srtContent);
                console.log(`[SubtitleRenderer] 已加载 ${_subtitles.length} 条字幕`);
                
                _isLoaded = true;
                // 从存储中恢复显示状态
                const savedState = GM_getValue('subtitle_visible', true);
                _isVisible = savedState;
                
                if (_animationFrameId) cancelAnimationFrame(_animationFrameId);
                _update();
            },
            
            clear: function() {
                 if (_animationFrameId) cancelAnimationFrame(_animationFrameId);
                 _subtitles = [];
                 _isLoaded = false;
                 if (_container) _container.style.display = 'none';
            },
            
            show: function() {
                _isVisible = true;
                GM_setValue('subtitle_visible', true);
                console.log('[SubtitleRenderer] 字幕已显示');
            },
            
            hide: function() {
                _isVisible = false;
                GM_setValue('subtitle_visible', false);
                if (_container) _container.style.display = 'none';
                console.log('[SubtitleRenderer] 字幕已隐藏');
            },
            
            toggle: function() {
                if (_isVisible) {
                    this.hide();
                } else {
                    this.show();
                }
                return _isVisible;
            },
            
            isVisible: function() {
                return _isVisible;
            },
            
            isLoaded: function() {
                return _isLoaded;
            }
        };
    })();

    // ==========================================
    // 模块 6: UI Manager (界面管理)
    // ==========================================
    const UIManager = (function() {
        let _container = null;
        let _statusDiv = null;
        let _actionBtn = null;
        let _settingsBtn = null;
        let _toggleBtn = null;
        let _currentVideoId = null;
        let _configModal = null;

        function _createConfigModal() {
            if (_configModal) {
                _configModal.style.display = 'flex';
                return;
            }

            _configModal = document.createElement('div');
            _configModal.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.7); z-index: 99999;
                display: flex; align-items: center; justify-content: center;
                font-family: sans-serif;
            `;

            const panel = document.createElement('div');
            panel.style.cssText = `
                background: white; padding: 25px; border-radius: 12px;
                width: 450px; max-width: 90vw; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            `;

            const title = document.createElement('h2');
            title.innerText = '腾讯云 API 配置';
            title.style.cssText = 'margin: 0 0 20px 0; font-size: 20px; color: #333;';
            panel.appendChild(title);

            const config = ConfigManager.get();

            // APPID
            const appidLabel = document.createElement('label');
            appidLabel.innerText = 'APPID:';
            appidLabel.style.cssText = 'display: block; margin-bottom: 5px; font-size: 14px; color: #666;';
            panel.appendChild(appidLabel);

            const appidInput = document.createElement('input');
            appidInput.type = 'text';
            appidInput.value = config.APPID || '';
            appidInput.placeholder = '请输入腾讯云 APPID';
            appidInput.style.cssText = `
                width: 100%; padding: 10px; margin-bottom: 15px;
                border: 1px solid #ddd; border-radius: 4px; font-size: 14px;
                box-sizing: border-box;
            `;
            panel.appendChild(appidInput);

            // SECRET_ID
            const sidLabel = document.createElement('label');
            sidLabel.innerText = 'SECRET_ID:';
            sidLabel.style.cssText = 'display: block; margin-bottom: 5px; font-size: 14px; color: #666;';
            panel.appendChild(sidLabel);

            const sidInput = document.createElement('input');
            sidInput.type = 'text';
            sidInput.value = config.SECRET_ID || '';
            sidInput.placeholder = '请输入 SECRET_ID';
            sidInput.style.cssText = `
                width: 100%; padding: 10px; margin-bottom: 15px;
                border: 1px solid #ddd; border-radius: 4px; font-size: 14px;
                box-sizing: border-box;
            `;
            panel.appendChild(sidInput);

            // SECRET_KEY
            const skeyLabel = document.createElement('label');
            skeyLabel.innerText = 'SECRET_KEY:';
            skeyLabel.style.cssText = 'display: block; margin-bottom: 5px; font-size: 14px; color: #666;';
            panel.appendChild(skeyLabel);

            const skeyInput = document.createElement('input');
            skeyInput.type = 'password';
            skeyInput.value = config.SECRET_KEY || '';
            skeyInput.placeholder = '请输入 SECRET_KEY';
            skeyInput.style.cssText = `
                width: 100%; padding: 10px; margin-bottom: 15px;
                border: 1px solid #ddd; border-radius: 4px; font-size: 14px;
                box-sizing: border-box;
            `;
            panel.appendChild(skeyInput);

            // 提示信息
            const hint = document.createElement('div');
            hint.innerHTML = `
                <p style="font-size: 12px; color: #999; margin: 0 0 15px 0;">
                    💡 获取密钥：访问 <a href="https://console.cloud.tencent.com/cam/capi" target="_blank" style="color: #00a1d6;">腾讯云控制台</a>
                </p>
            `;
            panel.appendChild(hint);

            // 按钮容器
            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = 'display: flex; gap: 10px;';

            const saveBtn = document.createElement('button');
            saveBtn.innerText = '保存';
            saveBtn.style.cssText = `
                flex: 1; padding: 10px; background: #00a1d6; color: white;
                border: none; border-radius: 4px; cursor: pointer; font-size: 14px;
            `;
            saveBtn.onclick = () => {
                const newConfig = {
                    APPID: appidInput.value.trim(),
                    SECRET_ID: sidInput.value.trim(),
                    SECRET_KEY: skeyInput.value.trim(),
                    ENGINE_TYPE: "16k_zh"
                };

                const validation = ConfigManager.validate(newConfig);
                if (!validation.valid) {
                    alert(validation.message);
                    return;
                }

                ConfigManager.save(newConfig);
                alert('配置已保存！');
                _configModal.style.display = 'none';
                _checkStatus();
            };

            const cancelBtn = document.createElement('button');
            cancelBtn.innerText = '取消';
            cancelBtn.style.cssText = `
                flex: 1; padding: 10px; background: #ccc; color: white;
                border: none; border-radius: 4px; cursor: pointer; font-size: 14px;
            `;
            cancelBtn.onclick = () => {
                _configModal.style.display = 'none';
            };

            btnContainer.appendChild(saveBtn);
            btnContainer.appendChild(cancelBtn);
            panel.appendChild(btnContainer);

            _configModal.appendChild(panel);
            document.body.appendChild(_configModal);
        }

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
            _actionBtn.innerText = '初始化...';
            _actionBtn.style.cssText = `
                display: block; width: 100%; padding: 8px;
                background: #ccc; color: white; border: none;
                border-radius: 4px; cursor: pointer; margin-bottom: 8px;
            `;
            _actionBtn.onclick = () => {}; 
            _container.appendChild(_actionBtn);

            _settingsBtn = document.createElement('button');
            _settingsBtn.innerText = '⚙️ 设置';
            _settingsBtn.style.cssText = `
                display: block; width: 100%; padding: 8px;
                background: #666; color: white; border: none;
                border-radius: 4px; cursor: pointer; margin-bottom: 8px;
            `;
            _settingsBtn.onclick = () => _createConfigModal();
            _container.appendChild(_settingsBtn);

            _toggleBtn = document.createElement('button');
            _toggleBtn.innerText = '👁️ 隐藏字幕';
            _toggleBtn.style.cssText = `
                display: none; width: 100%; padding: 8px;
                background: #ff9800; color: white; border: none;
                border-radius: 4px; cursor: pointer; margin-bottom: 8px;
            `;
            _toggleBtn.onclick = () => {
                SubtitleRenderer.toggle();
                _updateToggleButton();
            };
            _container.appendChild(_toggleBtn);

            _statusDiv = document.createElement('div');
            _statusDiv.style.fontSize = '12px';
            _statusDiv.style.color = '#666';
            _statusDiv.innerText = '检查缓存中...';
            _container.appendChild(_statusDiv);

            document.body.appendChild(_container);
            
            // 首次使用检测
            if (!ConfigManager.isConfigured()) {
                setTimeout(() => {
                    _createConfigModal();
                    alert('欢迎使用 B 站自动字幕！\n请先配置腾讯云 API 密钥。');
                }, 500);
            } else {
                _checkStatus();
            }
        }

        async function _checkStatus() {
            try {
                _currentVideoId = AudioExtractor.getVideoId();
                const cached = await CacheManager.get(_currentVideoId);
                if (cached) {
                    _updateStatus(`已缓存 (${(cached.size / 1024 / 1024).toFixed(1)} MB)`);
                    _actionBtn.innerText = '生成字幕 (腾讯云 AI)';
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
                // 检查配置
                if (!ConfigManager.isConfigured()) {
                    alert('请先配置腾讯云 API 密钥！');
                    _createConfigModal();
                    return;
                }

                _updateStatus('正在读取缓存...');
                _actionBtn.disabled = true;

                const cachedItem = await CacheManager.get(_currentVideoId);
                if (!cachedItem) throw new Error('缓存丢失');

                _updateStatus('上传腾讯云识别中...');
                const srt = await AISubtitleService.transcribe(cachedItem.blob);

                _updateStatus('识别成功，正在渲染...');
                console.log('SRT Result:', srt);
                
                SubtitleRenderer.render(srt);
                
                _updateStatus('字幕已加载到播放器');
                _actionBtn.innerText = '重新生成';
                _updateToggleButton();
                
            } catch (e) {
                console.error(e);
                _updateStatus(`API 错误: ${e.message}`);
                if (e.message.includes('密钥') || e.message.includes('签名')) {
                    setTimeout(() => {
                        if (confirm('API 密钥可能有误，是否重新配置？')) {
                            _createConfigModal();
                        }
                    }, 500);
                }
            } finally {
                _actionBtn.disabled = false;
            }
        }

        function _updateStatus(text) {
            if (_statusDiv) _statusDiv.innerText = text;
        }

        function _updateToggleButton() {
            if (!_toggleBtn) return;
            
            if (SubtitleRenderer.isLoaded()) {
                _toggleBtn.style.display = 'block';
                if (SubtitleRenderer.isVisible()) {
                    _toggleBtn.innerText = '👁️ 隐藏字幕';
                    _toggleBtn.style.background = '#ff9800';
                } else {
                    _toggleBtn.innerText = '👁️ 显示字幕';
                    _toggleBtn.style.background = '#4caf50';
                }
            } else {
                _toggleBtn.style.display = 'none';
            }
        }

        return {
            init: function() {
                window.addEventListener('load', () => setTimeout(_createUI, 1000));
                GM_registerMenuCommand('显示控制面板', _createUI);
                
                let lastUrl = location.href;
                setInterval(() => {
                    if (location.href !== lastUrl) {
                        lastUrl = location.href;
                        SubtitleRenderer.clear();
                        _updateToggleButton();
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
