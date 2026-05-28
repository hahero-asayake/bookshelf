// BookshelfStorage - 同期フォルダの新ファイル構造の読み書きを担当
// 設計: 設計.md（obsidian vault 内）参照
//
// ディレクトリ構造:
//   同期先/
//     library.json              # Kindle生データ（書誌のみ）
//     exclusions.json           # all本棚から除外するASIN
//     bookshelves.json          # 本棚一覧メタ
//     books/<ASIN>__<title>.md  # 長文メモ
//     bookshelves/
//       all.json                # 本データ正本（books+notes全保持）
//       <slug>.json             # ユーザ作成本棚
//     private/
//       settings.json
//       main.json
//     public/
//       settings.json
//       main.json
//     plugins/<id>/

class BookshelfStorage {
    constructor() {
        this.dirHandle = null;
    }

    setDirHandle(handle) {
        this.dirHandle = handle;
    }

    hasDirHandle() {
        return !!this.dirHandle;
    }

    // ===== 内部ユーティリティ =====

    async _resolveDir(pathParts, { create = false } = {}) {
        let dir = this.dirHandle;
        for (const name of pathParts) {
            dir = await dir.getDirectoryHandle(name, { create });
        }
        return dir;
    }

    async _readJSON(...pathParts) {
        const fileName = pathParts[pathParts.length - 1];
        const dirParts = pathParts.slice(0, -1);
        try {
            const dir = await this._resolveDir(dirParts);
            const fileHandle = await dir.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            const text = await file.text();
            return text.trim() ? JSON.parse(text) : null;
        } catch (e) {
            if (e.name === 'NotFoundError') return null;
            throw e;
        }
    }

    async _writeJSON(data, ...pathParts) {
        const fileName = pathParts[pathParts.length - 1];
        const dirParts = pathParts.slice(0, -1);
        const dir = await this._resolveDir(dirParts, { create: true });
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
    }

    async _writeText(text, ...pathParts) {
        const fileName = pathParts[pathParts.length - 1];
        const dirParts = pathParts.slice(0, -1);
        const dir = await this._resolveDir(dirParts, { create: true });
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
    }

    async _readText(...pathParts) {
        const fileName = pathParts[pathParts.length - 1];
        const dirParts = pathParts.slice(0, -1);
        try {
            const dir = await this._resolveDir(dirParts);
            const fileHandle = await dir.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            return await file.text();
        } catch (e) {
            if (e.name === 'NotFoundError') return null;
            throw e;
        }
    }

    async _fileExists(...pathParts) {
        const fileName = pathParts[pathParts.length - 1];
        const dirParts = pathParts.slice(0, -1);
        try {
            const dir = await this._resolveDir(dirParts);
            await dir.getFileHandle(fileName);
            return true;
        } catch (e) {
            return false;
        }
    }

    // ===== 形式判定 =====
    // 'new'    : bookshelves/all.json + notes.json が存在 → 新構造（notes 分離済）
    // 'pre-notes-split': bookshelves/all.json はあるが notes.json 無し（all.json に notes が混在）
    // 'legacy' : 旧 library.json（books が object 形式）のみ → マイグレーション要
    // 'empty'  : どちらも無し → 初回
    async detectFormat() {
        const hasAll = await this._fileExists('bookshelves', 'all.json');
        const hasNotes = await this._fileExists('notes.json');
        if (hasAll && hasNotes) return 'new';
        if (hasAll && !hasNotes) return 'pre-notes-split';
        const legacy = await this._readJSON('library.json');
        if (legacy && legacy.books && !Array.isArray(legacy.books) && typeof legacy.books === 'object') {
            return 'legacy';
        }
        return 'empty';
    }

    // notes.json への分離マイグレーション
    // 旧 all.json の notes を notes.json に移動 + all.json は notes 抜きで書き直し
    // + bookshelves.json に all 本棚エントリを追加（isSpecial=true）
    async migrateNotesSplit() {
        const allBookshelf = await this._readJSON('bookshelves', 'all.json');
        if (!allBookshelf) return;
        const notes = allBookshelf.notes || {};
        await this.writeNotes({ notes });

        const cleanedAll = {
            internalId: allBookshelf.internalId,
            slug: 'all',
            name: allBookshelf.name || 'すべての本',
            isSpecial: true,
            isPublic: allBookshelf.isPublic || false,
            parent: null,
            appliedPlugins: allBookshelf.appliedPlugins || [],
            defaultBookOrder: allBookshelf.defaultBookOrder || 'addedDate-desc',
            books: allBookshelf.books || []
        };
        await this._writeJSON(cleanedAll, 'bookshelves', 'all.json');

        // bookshelves.json に all 本棚を含める（既に含まれていれば追加しない）
        const meta = (await this._readJSON('bookshelves.json')) || { bookshelves: [] };
        const hasAllEntry = meta.bookshelves.some(b => b.slug === 'all');
        if (!hasAllEntry) {
            meta.bookshelves.unshift({
                internalId: allBookshelf.internalId,
                slug: 'all',
                name: allBookshelf.name || 'すべての本',
                isSpecial: true,
                parent: null,
                appliedPlugins: allBookshelf.appliedPlugins || [],
                isPublic: allBookshelf.isPublic || false
            });
            await this._writeJSON(meta, 'bookshelves.json');
        }
    }

    // ===== マイグレーション =====
    // 旧 library.json（単一ファイル統合形式）→ 新構造へ分解
    async migrateFromLegacy() {
        const legacy = await this._readJSON('library.json');
        if (!legacy || !legacy.books || Array.isArray(legacy.books)) {
            throw new Error('旧形式の library.json が見つかりません');
        }

        const libraryBooks = [];
        const allBooks = [];
        const allNotes = {};

        Object.entries(legacy.books).forEach(([asin, b]) => {
            libraryBooks.push({
                asin,
                title: b.title || '',
                authors: b.authors || '',
                acquiredTime: b.acquiredTime || Date.now(),
                readStatus: b.readStatus || 'UNKNOWN',
                productImage: b.productImage || '',
                source: b.source || 'unknown',
                addedDate: b.addedDate || Date.now(),
                ...(b.updatedAsin ? { updatedAsin: b.updatedAsin } : {})
            });
            allBooks.push(asin);
            if (b.memo || b.rating) {
                allNotes[asin] = {
                    memo: b.memo || '',
                    rating: b.rating || 0,
                    hasDetailMemo: false
                };
            }
        });

        const newLibrary = {
            exportDate: legacy.exportDate || new Date().toISOString(),
            books: libraryBooks
        };

        const allInternalId = generateInternalId();
        const allBookshelf = {
            internalId: allInternalId,
            slug: 'all',
            name: 'すべての本',
            isSpecial: true,
            isPublic: false,
            parent: null,
            defaultBookOrder: 'addedDate-desc',
            appliedPlugins: [],
            books: allBooks
        };
        const notesFile = { notes: allNotes };

        // 旧 bookshelves 配列を新形式に変換（all 以外）
        const userBookshelvesLegacy = (legacy.bookshelves || []).filter(b => b.id !== 'all');
        const bookshelvesMetaEntries = [];
        const bookshelfFilesToWrite = [];
        const usedSlugs = new Set();

        for (const bs of userBookshelvesLegacy) {
            const internalId = generateInternalId();
            let slug = (bs.id || bs.name || internalId)
                .toString()
                .toLowerCase()
                .replace(/[^a-z0-9-_]+/g, '-')
                .replace(/^-+|-+$/g, '');
            if (!slug) slug = internalId;
            // 衝突回避
            let candidateSlug = slug;
            let i = 2;
            while (usedSlugs.has(candidateSlug)) {
                candidateSlug = `${slug}-${i++}`;
            }
            slug = candidateSlug;
            usedSlugs.add(slug);

            bookshelvesMetaEntries.push({
                internalId,
                slug,
                name: bs.name || slug,
                parent: allInternalId,
                ...(bs.color ? { color: bs.color } : {}),
                appliedPlugins: [],
                isPublic: bs.isPublic || false
            });

            const bookList = (legacy.bookOrder && legacy.bookOrder[bs.id])
                ? legacy.bookOrder[bs.id]
                : (bs.books || []);

            bookshelfFilesToWrite.push({
                slug,
                data: {
                    internalId,
                    books: bookList,
                    notes: {}
                }
            });
        }

        // bookshelves.json に all を最初のエントリとして含める
        const bookshelvesMeta = {
            bookshelves: [
                {
                    internalId: allInternalId,
                    slug: 'all',
                    name: 'すべての本',
                    isSpecial: true,
                    parent: null,
                    appliedPlugins: [],
                    isPublic: false
                },
                ...bookshelvesMetaEntries
            ]
        };

        const settings = legacy.settings || {};
        const privateSettings = {
            version: '2.0',
            affiliateId: settings.affiliateId || '',
            theme: settings.theme || 'light',
            language: 'ja',
            defaultView: settings.defaultView || 'covers',
            booksPerPage: settings.booksPerPage || 50,
            coverSize: settings.coverSize || 'medium',
            showHighlights: settings.showHighlights !== false,
            showImagesInOverview: settings.showImagesInOverview !== false,
            enabledPlugins: [],
            memoOverrideDefault: 'this-bookshelf-only',
            publishExportPath: null,
            extensionImportOrigins: ['http://localhost:*', 'https://hahero-asayake.github.io']
        };

        const privateMain = {
            enabledPlugins: [],
            appliedPlugins: [],
            bookshelves: [allInternalId, ...bookshelvesMetaEntries.map(e => e.internalId)],
            defaultSort: 'addedDate-desc'
        };

        // 一斉書き込み
        await this._writeJSON(newLibrary, 'library.json');
        await this._writeJSON({ excludedASINs: [] }, 'exclusions.json');
        await this._writeJSON(notesFile, 'notes.json');
        await this._writeJSON(bookshelvesMeta, 'bookshelves.json');
        await this._writeJSON(allBookshelf, 'bookshelves', 'all.json');
        for (const { slug, data } of bookshelfFilesToWrite) {
            await this._writeJSON(data, 'bookshelves', `${slug}.json`);
        }
        await this._writeJSON(privateSettings, 'private', 'settings.json');
        await this._writeJSON(privateMain, 'private', 'main.json');

        return { migrated: true, allInternalId };
    }

    // ===== 空状態の初期化 =====
    async initEmpty() {
        const allInternalId = generateInternalId();
        await this._writeJSON({ exportDate: new Date().toISOString(), books: [] }, 'library.json');
        await this._writeJSON({ excludedASINs: [] }, 'exclusions.json');
        await this._writeJSON({ notes: {} }, 'notes.json');
        await this._writeJSON({
            bookshelves: [{
                internalId: allInternalId,
                slug: 'all',
                name: 'すべての本',
                isSpecial: true,
                parent: null,
                appliedPlugins: [],
                isPublic: false
            }]
        }, 'bookshelves.json');
        await this._writeJSON({
            internalId: allInternalId,
            slug: 'all',
            name: 'すべての本',
            isSpecial: true,
            isPublic: false,
            parent: null,
            defaultBookOrder: 'addedDate-desc',
            appliedPlugins: [],
            books: []
        }, 'bookshelves', 'all.json');
        await this._writeJSON({
            version: '2.0',
            affiliateId: '',
            theme: 'light',
            language: 'ja',
            defaultView: 'covers',
            booksPerPage: 50,
            coverSize: 'medium',
            showHighlights: true,
            showImagesInOverview: true,
            enabledPlugins: [],
            memoOverrideDefault: 'this-bookshelf-only',
            publishExportPath: null,
            extensionImportOrigins: ['http://localhost:*', 'https://hahero-asayake.github.io']
        }, 'private', 'settings.json');
        await this._writeJSON({
            enabledPlugins: [],
            appliedPlugins: [],
            bookshelves: [allInternalId],
            defaultSort: 'addedDate-desc'
        }, 'private', 'main.json');
        return { allInternalId };
    }

    // ===== 一括読み込み =====
    async loadAll() {
        const library = await this._readJSON('library.json');
        const exclusions = (await this._readJSON('exclusions.json')) || { excludedASINs: [] };
        const notesFile = (await this._readJSON('notes.json')) || { notes: {} };
        const bookshelvesMeta = (await this._readJSON('bookshelves.json')) || { bookshelves: [] };
        const allBookshelf = await this._readJSON('bookshelves', 'all.json');
        const privateSettings = (await this._readJSON('private', 'settings.json')) || {};
        const privateMain = (await this._readJSON('private', 'main.json')) || {};

        const bookshelfFiles = {};
        for (const meta of bookshelvesMeta.bookshelves) {
            // 特殊本棚（all）は別途 allBookshelf として返すので bookshelfFiles には入れない
            if (meta.isSpecial) continue;
            const data = await this._readJSON('bookshelves', `${meta.slug}.json`);
            if (data) bookshelfFiles[meta.internalId] = data;
        }

        return {
            library,
            exclusions,
            notes: notesFile.notes || {},
            bookshelvesMeta,
            allBookshelf,
            bookshelfFiles,
            privateSettings,
            privateMain
        };
    }

    // ===== 個別書き出し =====
    writeLibrary(data) { return this._writeJSON(data, 'library.json'); }
    writeExclusions(data) { return this._writeJSON(data, 'exclusions.json'); }
    writeBookshelvesMeta(data) { return this._writeJSON(data, 'bookshelves.json'); }
    writeAllBookshelf(data) { return this._writeJSON(data, 'bookshelves', 'all.json'); }
    writeBookshelfFile(slug, data) { return this._writeJSON(data, 'bookshelves', `${slug}.json`); }
    writePrivateSettings(data) { return this._writeJSON(data, 'private', 'settings.json'); }
    writePrivateMain(data) { return this._writeJSON(data, 'private', 'main.json'); }

    readPublicMain() { return this._readJSON('public', 'main.json'); }
    readPublicSettings() { return this._readJSON('public', 'settings.json'); }
    writePublicMain(data) { return this._writeJSON(data, 'public', 'main.json'); }
    writePublicSettings(data) { return this._writeJSON(data, 'public', 'settings.json'); }

    readNotes() { return this._readJSON('notes.json'); }
    writeNotes(data) { return this._writeJSON(data, 'notes.json'); }

    async deleteBookshelfFile(slug) {
        try {
            const dir = await this._resolveDir(['bookshelves']);
            await dir.removeEntry(`${slug}.json`);
        } catch (e) {
            if (e.name !== 'NotFoundError') throw e;
        }
    }

    // ===== 長文メモ.md =====
    sanitizeFileName(title) {
        if (!title) return 'untitled';
        return title
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, '_')
            .slice(0, 50)
            || 'untitled';
    }

    bookMemoFileName(asin, title) {
        return `${asin}__${this.sanitizeFileName(title)}.md`;
    }

    async readBookMemo(asin, title) {
        return await this._readText('books', this.bookMemoFileName(asin, title));
    }

    async writeBookMemo(asin, title, content) {
        const fileName = this.bookMemoFileName(asin, title);
        await this._writeText(content, 'books', fileName);
        return fileName;
    }

    async bookMemoExists(asin, title) {
        return await this._fileExists('books', this.bookMemoFileName(asin, title));
    }

    buildBookMemoTemplate(book) {
        const now = new Date().toISOString();
        const title = (book.title || '').replace(/"/g, '\\"');
        const authors = (book.authors || '').replace(/"/g, '\\"');
        return `---
asin: ${book.asin}
title: "${title}"
authors: "${authors}"
created: ${now}
updated: ${now}
---

# ${book.title || book.asin}

`;
    }
}

function generateInternalId() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 8; i++) {
        id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return id;
}

window.BookshelfStorage = BookshelfStorage;
window.generateInternalId = generateInternalId;
