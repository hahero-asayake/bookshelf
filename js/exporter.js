// BookshelfExporter - 同期フォルダから出力先（../bookshelf-export/ 等）への公開ビルド
//
// 設計:
//   出力先は showDirectoryPicker で指定、IndexedDB に永続化
//   出力構造:
//     <出力先>/
//       data/
//         library.json        # 公開対象 ASIN のみ
//         bookshelves.json    # 公開対象本棚メタのみ
//         bookshelves/
//           all.json          # all（公開対象 ASIN のみ）
//           <slug>.json       # 各公開本棚（publishHide=true 除外済）
//         books/
//           <ASIN>__*.md      # 長文メモ（hideDetailMemo=true は除外）
//         main.json           # = public/main.json
//         settings.json       # = public/settings.json
//     ※ index.html / css / js のコピーは Phase 3-C で IS_PUBLIC 対応後に実装

class BookshelfExporter {
    constructor(app) {
        this.app = app;
        this.exportDirHandle = null;
    }

    async loadStoredHandle() {
        try {
            const handle = await getStoredExportDirHandle();
            if (!handle) return null;
            const perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                this.exportDirHandle = handle;
                return handle;
            }
            // 権限あれば再リクエストはしない（ユーザー操作で改めて pick）
            this.exportDirHandle = handle;
            return handle;
        } catch (e) {
            console.warn('exportDirHandle 復元失敗:', e);
            return null;
        }
    }

    async pickExportDir() {
        if (!('showDirectoryPicker' in window)) {
            throw new Error('このブラウザは showDirectoryPicker に対応していません');
        }
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        this.exportDirHandle = handle;
        await storeExportDirHandle(handle);
        return handle;
    }

    async ensurePermission() {
        if (!this.exportDirHandle) return false;
        let perm = await this.exportDirHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
            perm = await this.exportDirHandle.requestPermission({ mode: 'readwrite' });
        }
        return perm === 'granted';
    }

    async _getDir(root, ...parts) {
        let dir = root;
        for (const p of parts) {
            dir = await dir.getDirectoryHandle(p, { create: true });
        }
        return dir;
    }

    async _writeJSON(data, ...path) {
        const fileName = path.pop();
        const dir = await this._getDir(this.exportDirHandle, ...path);
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
    }

    async _writeText(text, ...path) {
        const fileName = path.pop();
        const dir = await this._getDir(this.exportDirHandle, ...path);
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
    }

    async export() {
        if (!this.app.obsidianDirHandle) {
            throw new Error('同期フォルダが未接続です');
        }
        if (!this.exportDirHandle) {
            throw new Error('出力先フォルダが未選択です');
        }
        if (!await this.ensurePermission()) {
            throw new Error('出力先フォルダへの書き込み権限がありません');
        }

        const storage = this.app.storage;
        storage.setDirHandle(this.app.obsidianDirHandle);

        const publicMain = await storage.readPublicMain();
        const publicSettings = await storage.readPublicSettings();
        if (!publicMain) {
            throw new Error('public/main.json が見つかりません。先に「📤 公開にコピー」を実行してください');
        }
        if (!publicSettings) {
            throw new Error('public/settings.json が見つかりません。先に「📤 公開にコピー」を実行してください');
        }

        const state = await storage.loadAll();
        const publishBookshelfIds = new Set(publicMain.bookshelves || []);
        const allId = state.allBookshelf && state.allBookshelf.internalId;

        const publishAsins = new Set();
        const hideDetailAsins = new Set();
        const filteredBookshelfFiles = []; // [{ slug, data }]
        const filteredMetas = [];

        // all（特殊）
        if (allId && publishBookshelfIds.has(allId) && state.allBookshelf) {
            for (const asin of (state.allBookshelf.books || [])) publishAsins.add(asin);
            // all.notes の hideDetailMemo フラグ
            for (const [asin, note] of Object.entries(state.allBookshelf.notes || {})) {
                if (note && note.hideDetailMemo) hideDetailAsins.add(asin);
            }
            filteredBookshelfFiles.push({ slug: 'all', data: state.allBookshelf });
        }

        // ユーザ本棚
        for (const meta of (state.bookshelvesMeta.bookshelves || [])) {
            if (!publishBookshelfIds.has(meta.internalId)) continue;
            const data = state.bookshelfFiles[meta.internalId];
            if (!data) continue;
            // publishHide フラグでフィルタ
            const filteredBooks = (data.books || []).filter(asin => {
                const note = data.notes && data.notes[asin];
                return !(note && note.publishHide);
            });
            const filteredData = {
                ...data,
                books: filteredBooks
            };
            filteredBookshelfFiles.push({ slug: meta.slug, data: filteredData });
            filteredMetas.push(meta);
            for (const asin of filteredBooks) {
                publishAsins.add(asin);
                const note = data.notes && data.notes[asin];
                if (note && note.hideDetailMemo) hideDetailAsins.add(asin);
            }
        }

        // library.json サブセット
        const libraryBooks = ((state.library && state.library.books) || []).filter(b => publishAsins.has(b.asin));
        await this._writeJSON({
            exportDate: new Date().toISOString(),
            books: libraryBooks
        }, 'data', 'library.json');

        // bookshelves.json
        await this._writeJSON({ bookshelves: filteredMetas }, 'data', 'bookshelves.json');

        // bookshelves/<slug>.json
        for (const f of filteredBookshelfFiles) {
            await this._writeJSON(f.data, 'data', 'bookshelves', `${f.slug}.json`);
        }

        // main.json / settings.json
        await this._writeJSON(publicMain, 'data', 'main.json');
        await this._writeJSON(publicSettings, 'data', 'settings.json');

        // 長文メモ
        const errors = [];
        const allNotes = (state.allBookshelf && state.allBookshelf.notes) || {};
        for (const asin of publishAsins) {
            if (hideDetailAsins.has(asin)) continue;
            const book = libraryBooks.find(b => b.asin === asin);
            if (!book) continue;
            const allNote = allNotes[asin];
            if (!allNote || !allNote.hasDetailMemo) continue;
            try {
                const text = await storage.readBookMemo(asin, book.title);
                if (text !== null) {
                    await this._writeText(text, 'data', 'books', storage.bookMemoFileName(asin, book.title));
                }
            } catch (e) {
                errors.push(`books/${asin}: ${e.message}`);
            }
        }

        return {
            exported: publishAsins.size,
            bookshelves: filteredBookshelfFiles.length,
            longMemos: publishAsins.size - hideDetailAsins.size,
            errors
        };
    }
}

// ===== IndexedDB ヘルパー (exportDirHandle 用) =====
async function getStoredExportDirHandle() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('bookshelf-sync', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('config');
        req.onsuccess = e => {
            const db = e.target.result;
            try {
                const tx = db.transaction('config', 'readonly');
                const r = tx.objectStore('config').get('exportDirHandle');
                r.onsuccess = ev => resolve(ev.target.result || null);
                r.onerror = ev => reject(ev.target.error);
            } catch (err) {
                reject(err);
            }
        };
        req.onerror = e => reject(e.target.error);
    });
}

async function storeExportDirHandle(handle) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('bookshelf-sync', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('config');
        req.onsuccess = e => {
            const db = e.target.result;
            try {
                const tx = db.transaction('config', 'readwrite');
                tx.objectStore('config').put(handle, 'exportDirHandle');
                tx.oncomplete = resolve;
                tx.onerror = ev => reject(ev.target.error);
            } catch (err) {
                reject(err);
            }
        };
        req.onerror = e => reject(e.target.error);
    });
}

window.BookshelfExporter = BookshelfExporter;
