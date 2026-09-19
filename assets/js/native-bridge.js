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

            idbEntries.forEach(entry => {
                let value = entry.value;
                if (stripImages) {
                    value = deepClone(value);
                    stripImagesDeep(value);
                }
                pushFile('idb/' + encodeURIComponent(entry.key) + '.json', JSON.stringify(value ?? null));
            });
            localEntries.forEach(entry => {
                pushFile('local/' + encodeURIComponent(entry.key) + '.json', JSON.stringify({ s: entry.value }));
            });

            const manifest = {
                type: MANIFEST_MARKER,
                app: 'RoleplayHub',
                version: 1,
                exportedAt: new Date().toISOString(),
                stripImages: !!stripImages,
                idbCount: idbEntries.length,
                localCount: localEntries.length
            };
            const manifestFile = { path: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest)) };
            const allFiles = [manifestFile, ...files];

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
                    if (path.startsWith('idb/')) {
                        const key = decodeURIComponent(path.slice(4).replace(/\.json$/, ''));
                        await idbPut(db, key, JSON.parse(text));
                        restored++;
                    } else if (path.startsWith('local/')) {
                        const key = decodeURIComponent(path.slice(6).replace(/\.json$/, ''));
                        const parsed = JSON.parse(text);
                        localStorage.setItem(key, String(parsed && typeof parsed.s === 'string' ? parsed.s : ''));
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
