// RP-Hub native shell bridge: plain backup export/import and back-button handling.
// Loaded only in the Android WebView shell (window.RoleplayHubNative is injected natively);
// in plain browsers it degrades to a no-op so the page keeps working unchanged.

(function () {
    'use strict';

    const DB_NAME = 'RPHubDB';
    const STORE_NAME = 'store';
    const STORAGE_PREFIX = 'rp_hub_';
    const MANIFEST_MARKER = 'rphub-plain-backup';
    const CHUNK_SIZE = 256 * 1024; // matches the native import-side chunk size

    const isNativeShell = () => {
        const native = window.RoleplayHubNative;
        return !!(native && typeof native.beginPlainBackup === 'function');
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const bytesToBase64 = (bytes) => {
        let binary = '';
        const step = 0x8000;
        for (let i = 0; i < bytes.length; i += step) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
        }
        return btoa(binary);
    };

    const base64ToBytes = (base64) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    };

    const openDB = () => new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('当前环境不支持 IndexedDB'));
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error || new Error('打开数据库失败'));
    });

    const idbGetAll = (db) => new Promise((resolve, reject) => {
        const entries = [];
        const request = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME).openCursor();
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve(entries);
            entries.push({ key: String(cursor.key), value: cursor.value });
            cursor.continue();
        };
        request.onerror = () => reject(request.error || new Error('读取数据库失败'));
    });

    const idbPut = (db, key, value) => new Promise((resolve, reject) => {
        const request = db.transaction([STORE_NAME], 'readwrite').objectStore(STORE_NAME).put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('写入数据库失败'));
    });

    const idbGet = (db, key) => new Promise((resolve, reject) => {
        const request = db.transaction([STORE_NAME], 'readonly').objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('读取数据库失败'));
    });

    const deepClone = (value) => {
        if (typeof structuredClone === 'function') {
            try { return structuredClone(value); } catch (_) { /* fall through */ }
        }
        return JSON.parse(JSON.stringify(value));
    };

    // Strip chat image payloads for the compact backup variant.
    const IMAGE_FIELD_KEYS = ['images', 'imageAttachments'];
    const stripImagesDeep = (value, depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 12) return;
        if (Array.isArray(value)) {
            value.forEach(item => stripImagesDeep(item, depth + 1));
            return;
        }
        IMAGE_FIELD_KEYS.forEach(key => {
            if (Array.isArray(value[key])) value[key] = [];
        });
        Object.keys(value).forEach(key => stripImagesDeep(value[key], depth + 1));
    };

    const collectLocalEntries = () => {
        const entries = [];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(STORAGE_PREFIX)) {
                    entries.push({ key, value: localStorage.getItem(key) || '' });
                }
            }
        } catch (_) { /* localStorage unavailable */ }
        return entries;
    };

    const reportProgress = (done, total, stage) => {
        const native = window.RoleplayHubNative;
        if (native && typeof native.onBackupProgress === 'function') {
            try { native.onBackupProgress(done, total, stage); } catch (_) { /* ignore */ }
        }
    };

    const sendFileToNative = async (path, bytes, index, total) => {
        const native = window.RoleplayHubNative;
        native.beginPlainBackupFile(path, bytes.length);
        const base64 = bytesToBase64(bytes);
        let offset = 0;
        let chunkCount = 0;
        while (offset < base64.length) {
            const end = Math.min(offset + CHUNK_SIZE, base64.length);
            native.addPlainBackupChunk(base64.slice(offset, end));
            offset = end;
            if (++chunkCount % 8 === 0) await sleep(0);
        }
        native.endPlainBackupFile();
        reportProgress(index + 1, total, 'transfer');
    };

    const READABLE_DIRS = {
        settings: '设置',
        presets: '预设',
        worldinfo: '世界书',
        user: '用户',
        regex: '正则',
        uiTemplates: '界面模板'
    };

    const toSafeName = (value, fallback = '未命名') => {
        const cleaned = String(value == null ? '' : value)
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 60);
        return cleaned || fallback;
    };

    const makePath = (used, dir, base, ext) => {
        let index = 2;
        let name = `${base}${ext}`;
        while (used.has(`${dir}/${name}`)) {
            name = `${base} (${index})${ext}`;
            index += 1;
        }
        used.add(`${dir}/${name}`);
        return `${dir}/${name}`;
    };

    // 把角色卡里的内联图片换成占位符，保证「角色卡」目录是纯文本、体积可控。
    const stripInlineImages = (value, depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 12) return;
        if (Array.isArray(value)) {
            value.forEach(item => stripInlineImages(item, depth + 1));
            return;
        }
        Object.keys(value).forEach(key => {
            const item = value[key];
            if (typeof item === 'string' && item.startsWith('data:image/') && item.length > 256) {
                value[key] = '[图片已省略，原始数据见「原始数据」目录]';
            } else {
                stripInlineImages(item, depth + 1);
            }
        });
    };

    // API 密钥一类的字段永不写入备份文件；恢复时会保留本机已有的密钥。
    const SECRET_FIELD_PATTERN = /^(apiProviderKeys|apiKeys)$|(api_?key|secret|password|credential|auth_?token|access_?token|_token)$/i;

    const stripSecretFields = (value, depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 8) return value;
        if (Array.isArray(value)) {
            value.forEach(item => stripSecretFields(item, depth + 1));
            return value;
        }
        Object.keys(value).forEach(key => {
            if (SECRET_FIELD_PATTERN.test(key)) {
                delete value[key];
            } else {
                stripSecretFields(value[key], depth + 1);
            }
        });
        return value;
    };

    const mergeSecretFields = (incoming, existing, depth = 0) => {
        if (!incoming || !existing || typeof incoming !== 'object' || typeof existing !== 'object' || depth > 8) return;
        if (Array.isArray(incoming) || Array.isArray(existing)) {
            if (Array.isArray(incoming) && Array.isArray(existing)) {
                incoming.forEach((item, index) => mergeSecretFields(item, existing[index], depth + 1));
            }
            return;
        }
        Object.keys(existing).forEach(key => {
            if (SECRET_FIELD_PATTERN.test(key)) {
                if (!(key in incoming)) incoming[key] = existing[key];
            } else {
                mergeSecretFields(incoming[key], existing[key], depth + 1);
            }
        });
    };

    const buildReadableFiles = (entries, stripImages) => {
        const encoder = new TextEncoder();
        const files = [];
        const used = new Set();
        const byKey = new Map(entries.map(entry => [entry.key, entry.value]));
        const pushText = (path, text) => files.push({ path, bytes: encoder.encode(text) });
        const characters = Array.isArray(byKey.get('rp_hub_characters')) ? byKey.get('rp_hub_characters') : [];

        // scopeId -> { char, branchName }
        const scopeMeta = new Map();
        characters.forEach(char => {
            if (!char || !char.uuid) return;
            scopeMeta.set(char.uuid, { char, branchName: '' });
            const saved = byKey.get('rp_hub_branches_' + char.uuid);
            const branches = Array.isArray(saved?.branches) ? saved.branches : [];
            branches.forEach(branch => {
                if (!branch || !branch.id || branch.id === 'main') return;
                scopeMeta.set(char.uuid + '__branch__' + branch.id, {
                    char,
                    branchName: branch.name || '分支'
                });
            });
        });

        // 角色卡
        const cardUtils = window.RPHubCardUtils;
        characters.forEach(char => {
            if (!char) return;
            let payload = char;
            if (cardUtils && typeof cardUtils.buildCharacterCardData === 'function') {
                try {
                    const built = cardUtils.buildCharacterCardData(char);
                    if (built && built.data) payload = built.data;
                } catch (_) { payload = char; }
            }
            let clone;
            try { clone = deepClone(payload); } catch (_) { clone = char; }
            stripInlineImages(clone);
            pushText(
                makePath(used, '角色卡', toSafeName(char.name, '未命名角色'), '.json'),
                JSON.stringify(clone, null, 2)
            );
        });

        // 聊天记录（一行一条消息，分支单独成文件）
        let chatFileCount = 0;
        entries.forEach(entry => {
            if (!entry.key.startsWith('rp_hub_chat_')) return;
            const scopeId = entry.key.slice('rp_hub_chat_'.length);
            const history = Array.isArray(entry.value) ? entry.value : [];
            if (!history.length) return;
            const meta = scopeMeta.get(scopeId) || null;
            const lines = [];
            history.forEach(message => {
                if (!message || !message.role) return;
                const item = { role: message.role, content: message.content || '' };
                if (message.name) item.name = message.name;
                if (message.timestamp) item.time = message.timestamp;
                lines.push(JSON.stringify(item));
            });
            if (!lines.length) return;
            const base = meta
                ? toSafeName(meta.char.name, '未命名角色') + (meta.branchName ? '-分支-' + toSafeName(meta.branchName) : '')
                : '未知角色-' + scopeId.slice(0, 8);
            pushText(makePath(used, '聊天记录', base, '.jsonl'), lines.join('\n') + '\n');
            chatFileCount += 1;
        });

        // 其余配置类数据
        const directMap = [
            ['rp_hub_settings', READABLE_DIRS.settings + '/设置.json'],
            ['rp_hub_presets', READABLE_DIRS.presets + '/预设.json'],
            ['rp_hub_global_worldinfo', READABLE_DIRS.worldinfo + '/全局世界书.json'],
            ['rp_hub_worldinfo_settings', READABLE_DIRS.worldinfo + '/世界书设置.json'],
            ['rp_hub_user', READABLE_DIRS.user + '/用户资料.json'],
            ['rp_hub_user_profiles', READABLE_DIRS.user + '/用户档案.json'],
            ['rp_hub_global_regex', READABLE_DIRS.regex + '/全局正则.json'],
            ['rp_hub_global_ui_templates', READABLE_DIRS.uiTemplates + '/全局界面模板.json']
        ];
        directMap.forEach(([key, path]) => {
            if (!byKey.has(key)) return;
            let clone;
            try { clone = deepClone(byKey.get(key)); } catch (_) { clone = byKey.get(key); }
            stripInlineImages(clone);
            if (key === 'rp_hub_settings') stripSecretFields(clone);
            pushText(path, JSON.stringify(clone ?? null, null, 2));
        });

        // 原始数据：完整、无损，供 App 恢复使用（API 密钥始终剔除）
        entries.forEach(entry => {
            let value = entry.value;
            if (stripImages || entry.key === 'rp_hub_settings') {
                value = deepClone(value);
                if (stripImages) stripImagesDeep(value);
                if (entry.key === 'rp_hub_settings') stripSecretFields(value);
            }
            pushText('原始数据/' + entry.key + '.json', JSON.stringify(value ?? null));
        });

        return { files, chatFileCount, characterCount: characters.length };
    };

    const buildReadme = (manifest) => [
        'RoleplayHub 数据备份',
        '导出时间：' + manifest.exportedAt,
        '',
        '这个压缩包里有两部分：',
        '',
        '【看得懂的】',
        '  角色卡/      每个角色一个 JSON，标准角色卡格式，可以直接打开或导入其它前端',
        '  聊天记录/    每个角色（含剧情分支）一个 .jsonl，一行一条消息',
        '  设置/ 预设/ 世界书/ 用户/ 正则/ 界面模板/   对应的配置文本',
        '',
        '【用来恢复的】',
        '  原始数据/    程序内部原始数据（rp_hub_xxx.json），不要删',
        '  manifest.json  备份清单',
        '',
        '恢复方法：App 悬浮按钮 →「恢复数据备份」→ 选择这个 zip。',
        '恢复只读取「原始数据」目录；角色卡和聊天记录是给你看的，不参与恢复。',
        '图片、头像等二进制内容只保留在「原始数据」里，可读目录中用占位文字代替。',
        '',
        'API 密钥（apiKey、各提供商密钥、Tavily 密钥等）不会写进备份文件；',
        '恢复备份时也不会覆盖本机已保存的密钥，密钥只留在本机。',
        ''
    ].join('\n');

    const exportAll = async (stripImages) => {
        if (!isNativeShell()) return;
        const native = window.RoleplayHubNative;
        try {
            reportProgress(0, 0, 'collect');
            const db = await openDB();
            const idbEntries = await idbGetAll(db);
            const localEntries = collectLocalEntries();
            db.close();

            const files = [];
            const pushFile = (path, text) => {
                files.push({ path, bytes: new TextEncoder().encode(text) });
            };

            const readable = buildReadableFiles(idbEntries, stripImages);
            localEntries.forEach(entry => {
                pushFile('原始数据/' + 'local/' + entry.key + '.json', JSON.stringify({ s: entry.value }));
            });

            const manifest = {
                type: MANIFEST_MARKER,
                app: 'RoleplayHub',
                version: 2,
                exportedAt: new Date().toISOString(),
                stripImages: !!stripImages,
                idbCount: idbEntries.length,
                localCount: localEntries.length,
                characterCount: readable.characterCount,
                chatFileCount: readable.chatFileCount
            };
            const manifestFile = { path: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) };
            const readmeFile = { path: '说明.txt', bytes: new TextEncoder().encode(buildReadme(manifest)) };
            const allFiles = [manifestFile, readmeFile, ...files, ...readable.files];

            native.beginPlainBackup(allFiles.length);
            for (let i = 0; i < allFiles.length; i++) {
                await sendFileToNative(allFiles[i].path, allFiles[i].bytes, i, allFiles.length);
                await sleep(0);
            }
            native.finishPlainBackup();
        } catch (error) {
            console.error('RPHubPlainBackup export failed:', error);
            try { alert('导出失败：' + (error && error.message ? error.message : '未知错误')); } catch (_) { /* ignore */ }
        }
    };

    // --- Import (native shell pushes the zip contents back into the page) ---
    const importState = {
        expected: 0,
        files: new Map(),
        currentPath: '',
        chunks: []
    };

    const resetImportState = () => {
        importState.expected = 0;
        importState.files.clear();
        importState.currentPath = '';
        importState.chunks = [];
    };

    const importBegin = (fileCount) => {
        resetImportState();
        importState.expected = Number(fileCount) || 0;
        return 'ok';
    };

    const importFileChunk = (path, chunk, isLast) => {
        if (typeof path !== 'string' || !path) return '';
        if (importState.currentPath !== path) {
            if (importState.currentPath) {
                importState.files.set(importState.currentPath, importState.chunks.join(''));
            }
            importState.currentPath = path;
            importState.chunks = [];
        }
        importState.chunks.push(String(chunk || ''));
        if (isLast) {
            importState.files.set(path, importState.chunks.join(''));
            importState.currentPath = '';
            importState.chunks = [];
        }
        return 'ok';
    };

    const importFinish = async () => {
        if (importState.currentPath) {
            importState.files.set(importState.currentPath, importState.chunks.join(''));
        }
        try {
            const db = await openDB();
            let restored = 0;
            for (const [path, base64] of importState.files.entries()) {
                try {
                    const bytes = base64ToBytes(base64);
                    const text = new TextDecoder().decode(bytes);
                    if (path === 'manifest.json') continue;
                    // 兼容旧备份（idb/、local/）与新备份（原始数据/rp_hub_*.json、原始数据/local/）
                    let idbKey = '';
                    let localKey = '';
                    if (path.startsWith('原始数据/local/')) {
                        localKey = decodeURIComponent(path.slice('原始数据/local/'.length).replace(/\.json$/, ''));
                    } else if (path.startsWith('原始数据/idb/')) {
                        idbKey = decodeURIComponent(path.slice('原始数据/idb/'.length).replace(/\.json$/, ''));
                    } else if (path.startsWith('原始数据/')) {
                        idbKey = decodeURIComponent(path.slice('原始数据/'.length).replace(/\.json$/, ''));
                    } else if (path.startsWith('idb/')) {
                        idbKey = decodeURIComponent(path.slice(4).replace(/\.json$/, ''));
                    } else if (path.startsWith('local/')) {
                        localKey = decodeURIComponent(path.slice(6).replace(/\.json$/, ''));
                    }
                    if (idbKey && idbKey.startsWith('rp_hub_')) {
                        if (idbKey === 'rp_hub_settings') {
                            const incoming = JSON.parse(text);
                            const existing = await idbGet(db, 'rp_hub_settings');
                            mergeSecretFields(incoming, existing);
                            await idbPut(db, idbKey, incoming);
                        } else {
                            await idbPut(db, idbKey, JSON.parse(text));
                        }
                        restored++;
                    } else if (localKey) {
                        const parsed = JSON.parse(text);
                        localStorage.setItem(localKey, String(parsed && typeof parsed.s === 'string' ? parsed.s : ''));
                        restored++;
                    }
                } catch (error) {
                    console.warn('RPHubPlainBackup restore skipped file:', path, error);
                }
            }
            db.close();
            resetImportState();
            alert('数据恢复完成，共 ' + restored + ' 项，页面即将刷新');
            setTimeout(() => location.reload(), 600);
        } catch (error) {
            console.error('RPHubPlainBackup import failed:', error);
            resetImportState();
            try { alert('恢复失败：' + (error && error.message ? error.message : '未知错误')); } catch (_) { /* ignore */ }
        }
        return 'ok';
    };

    window.RPHubPlainBackup = Object.freeze({
        exportAll: (stripImages) => { exportAll(stripImages === true || stripImages === 'true'); },
        importBegin,
        importFileChunk,
        importFinish
    });
    // app.js owns RPHubBack; an uninitialized page must not signal root/exit.
})();
