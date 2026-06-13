// BookshelfStorage - 同期フォルダの bookshelf ファイル構造を読み書きする
//
// I/O は StorageAdapter に委譲する。デフォルトでは LocalFSAdapter
// (File System Access API) を使用するが、コンストラクタで他の adapter
// (GitHub / Google Drive / Dropbox) を注入することで切替可能。
//
// ディレクトリ構造 (2026-05-31〜):
//   <同期フォルダ root>/
//     private/                 # アプリ編集データの正本
//       library.json
//       exclusions.json
//       notes.json
//       bookshelves.json
//       bookshelves/all.json
//       bookshelves/<slug>.json
//       books/<ASIN>__<title>.md   # 長文メモ
//       settings.json
//       main.json
//     public/                  # 公開エクスポート出力
//       (アプリが書き出す)
//     plugins/<id>/            # プラグイン (private/public 両方が参照)

class BookshelfStorage {
    constructor(adapter) {
        this.adapter = adapter || new LocalFSAdapter();
    }

    // ===== 接続管理 (LocalFSAdapter 互換) =====

    setDirHandle(handle) {
        if (typeof this.adapter.setDirHandle === 'function') {
            this.adapter.setDirHandle(handle);
        }
    }

    hasDirHandle() {
        if (typeof this.adapter.hasDirHandle === 'function') {
            return this.adapter.hasDirHandle();
        }
        return this.adapter.isConnected();
    }

    // ===== 形式判定 =====
    // 'new'        : private/bookshelves/all.json が存在 → 新構造 (private 配下に集約)
    // 'flat'       : root に bookshelves/all.json が存在 → 旧フラット構造 (要マイグレーション)
    // 'pre-notes-split': flat 構造で notes.json が無い (all.json 内 notes 混在)
    // 'legacy'     : 旧 library.json (books が object 形式) のみ
    // 'empty'      : どれも無し → 初回
    async detectFormat() {
        const hasNewAll = await this.adapter.fileExists('private/bookshelves/all.json');
        if (hasNewAll) return 'new';
        const hasFlatAll = await this.adapter.fileExists('bookshelves/all.json');
        const hasFlatNotes = await this.adapter.fileExists('notes.json');
        if (hasFlatAll && hasFlatNotes) return 'flat';
        if (hasFlatAll && !hasFlatNotes) return 'pre-notes-split';
        const legacy = await this.adapter.readJSON('library.json');
        if (legacy && legacy.books && !Array.isArray(legacy.books) && typeof legacy.books === 'object') {
            return 'legacy';
        }
        return 'empty';
    }

    // 旧 flat 構造の notes 分離マイグレーションは廃止。
    // 新構造 (private/ 配下) では最初から notes.json が分離している前提。
    // 旧データを移行する場合は migrateFlatToNew() を使う (未公開のため最小限実装)。
    async migrateNotesSplit() {
        console.warn('migrateNotesSplit() は旧 flat 構造用、新構造では未使用');
    }

    // ===== マイグレーション =====
    // 旧 library.json（単一ファイル統合形式）→ 新構造へ分解
    async migrateFromLegacy() {
        const legacy = await this.adapter.readJSON('library.json');
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

        // 一斉書き込み (新構造: 全部 private/ 配下)
        await this.adapter.writeJSON('private/library.json', newLibrary);
        await this.adapter.writeJSON('private/exclusions.json', { excludedASINs: [] });
        await this.adapter.writeJSON('private/notes.json', notesFile);
        await this.adapter.writeJSON('private/bookshelves.json', bookshelvesMeta);
        await this.adapter.writeJSON('private/bookshelves/all.json', allBookshelf);
        for (const { slug, data } of bookshelfFilesToWrite) {
            await this.adapter.writeJSON(`private/bookshelves/${slug}.json`, data);
        }
        await this.adapter.writeJSON('private/settings.json', privateSettings);
        await this.adapter.writeJSON('private/main.json', privateMain);

        return { migrated: true, allInternalId };
    }

    // ===== 空状態の初期化 (新構造: 全部 private/ 配下) =====
    async initEmpty() {
        const allInternalId = generateInternalId();
        await this.adapter.writeJSON('private/library.json', { exportDate: new Date().toISOString(), books: [] });
        await this.adapter.writeJSON('private/exclusions.json', { excludedASINs: [] });
        await this.adapter.writeJSON('private/notes.json', { notes: {} });
        await this.adapter.writeJSON('private/bookshelves.json', {
            bookshelves: [{
                internalId: allInternalId,
                slug: 'all',
                name: 'すべての本',
                iconName: 'library',
                isSpecial: true,
                parent: null,
                appliedPlugins: [],
                isPublic: false
            }]
        });
        await this.adapter.writeJSON('private/bookshelves/all.json', {
            internalId: allInternalId,
            slug: 'all',
            name: 'すべての本',
            iconName: 'library',
            isSpecial: true,
            isPublic: false,
            parent: null,
            defaultBookOrder: 'addedDate-desc',
            appliedPlugins: [],
            books: []
        });
        await this.adapter.writeJSON('private/settings.json', {
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
            bookMemoOpenWith: 'app-editor',
            extensionImportOrigins: ['http://localhost:*', 'https://hahero-asayake.github.io']
        });
        await this.adapter.writeJSON('private/main.json', {
            enabledPlugins: [],
            appliedPlugins: [],
            bookshelves: [allInternalId],
            defaultSort: 'addedDate-desc'
        });
        return { allInternalId };
    }

    // ===== 一括読み込み (新構造: 全部 private/ 配下) =====
    async loadAll() {
        const library = await this.adapter.readJSON('private/library.json');
        const exclusions = (await this.adapter.readJSON('private/exclusions.json')) || { excludedASINs: [] };
        const notesFile = (await this.adapter.readJSON('private/notes.json')) || { notes: {} };
        const bookshelvesMeta = (await this.adapter.readJSON('private/bookshelves.json')) || { bookshelves: [] };
        const allBookshelf = await this.adapter.readJSON('private/bookshelves/all.json');
        const privateSettings = (await this.adapter.readJSON('private/settings.json')) || {};
        const privateMain = (await this.adapter.readJSON('private/main.json')) || {};

        const bookshelfFiles = {};
        for (const meta of bookshelvesMeta.bookshelves) {
            if (meta.isSpecial) continue;
            const data = await this.adapter.readJSON(`private/bookshelves/${meta.slug}.json`);
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

    // ===== 個別書き出し (新構造: 全部 private/ 配下) =====
    writeLibrary(data) { return this.adapter.writeJSON('private/library.json', data); }
    writeExclusions(data) { return this.adapter.writeJSON('private/exclusions.json', data); }
    writeBookshelvesMeta(data) { return this.adapter.writeJSON('private/bookshelves.json', data); }
    writeAllBookshelf(data) { return this.adapter.writeJSON('private/bookshelves/all.json', data); }
    writeBookshelfFile(slug, data) { return this.adapter.writeJSON(`private/bookshelves/${slug}.json`, data); }
    writePrivateSettings(data) { return this.adapter.writeJSON('private/settings.json', data); }
    writePrivateMain(data) { return this.adapter.writeJSON('private/main.json', data); }

    readPublicMain() { return this.adapter.readJSON('public/main.json'); }
    readPublicSettings() { return this.adapter.readJSON('public/settings.json'); }
    writePublicMain(data) { return this.adapter.writeJSON('public/main.json', data); }
    writePublicSettings(data) { return this.adapter.writeJSON('public/settings.json', data); }

    readNotes() { return this.adapter.readJSON('private/notes.json'); }
    writeNotes(data) { return this.adapter.writeJSON('private/notes.json', data); }

    deleteBookshelfFile(slug) {
        return this.adapter.deleteFile(`private/bookshelves/${slug}.json`);
    }

    // ===== 汎用 (プラグインスキャン・公開ページ等の二次利用向け) =====
    listDirs(dirPath) { return this.adapter.listDirs(dirPath); }
    listFiles(dirPath) { return this.adapter.listFiles(dirPath); }
    readText(path) { return this.adapter.readText(path); }
    readJSON(path) { return this.adapter.readJSON(path); }
    writeJSON(path, data) { return this.adapter.writeJSON(path, data); }

    // ===== バッチ書き込み =====
    //
    // entries: [
    //   { op: 'put',    path: '...', data: object,        kind: 'json' },  // JSON.stringify される
    //   { op: 'put',    path: '...', data: 'raw text',    kind: 'text' },
    //   { op: 'delete', path: '...' }
    // ]
    // GitHubAdapter なら Trees API で 1 commit にまとめる。LocalFS では順次書く。
    async syncBatch(entries, { message } = {}) {
        if (!Array.isArray(entries) || entries.length === 0) return;
        const a = this.adapter;
        if (typeof a.beginBatch === 'function' && typeof a.commitBatch === 'function') {
            a.beginBatch();
            try {
                for (const e of entries) {
                    if (e.op === 'delete') {
                        a.addBatchDelete(e.path);
                    } else {
                        const content = e.kind === 'text'
                            ? String(e.data == null ? '' : e.data)
                            : JSON.stringify(e.data, null, 2);
                        a.addBatchEntry(e.path, content);
                    }
                }
                return await a.commitBatch(message);
            } catch (err) {
                if (typeof a.discardBatch === 'function') a.discardBatch();
                throw err;
            }
        }
        // バッチ未対応 adapter: 順次書く
        for (const e of entries) {
            if (e.op === 'delete') {
                await a.deleteFile(e.path);
            } else if (e.kind === 'text') {
                await a.writeText(e.path, String(e.data == null ? '' : e.data));
            } else {
                await a.writeJSON(e.path, e.data);
            }
        }
        return null;
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

    readBookMemo(asin, title) {
        return this.adapter.readText(`private/books/${this.bookMemoFileName(asin, title)}`);
    }

    async writeBookMemo(asin, title, content) {
        const fileName = this.bookMemoFileName(asin, title);
        await this.adapter.writeText(`private/books/${fileName}`, content);
        return fileName;
    }

    bookMemoExists(asin, title) {
        return this.adapter.fileExists(`private/books/${this.bookMemoFileName(asin, title)}`);
    }

    bookMemoFullPath(asin, title) {
        return `private/books/${this.bookMemoFileName(asin, title)}`;
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

    // ===== frontmatter ヘルパ (ADR-024: アプリ内では隠し、ファイルには維持) =====

    /**
     * YAML frontmatter と本文を分離する。
     * 先頭が `---` 行のときだけ、最初の終端 `---` 行までを frontmatter とみなす
     * (本文中の `---` 水平線を誤検出しない)。先頭に無ければ frontmatter: null。
     * @param {string} text
     * @returns {{frontmatter: string|null, body: string}}
     *   frontmatter は区切り行を含む生テキスト (joinFrontmatter にそのまま渡す)
     */
    static splitFrontmatter(text) {
        const t = String(text ?? '');
        // 先頭一致 + 最小マッチ。終端は「行頭の --- + 改行 or 文字列末尾」
        const m = t.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
        if (!m) return { frontmatter: null, body: t };
        return { frontmatter: m[0], body: t.slice(m[0].length) };
    }

    /**
     * frontmatter と本文を結合する。frontmatter が null なら body をそのまま返す
     * (frontmatter を勝手に追加しない)。frontmatter 内の `updated:` 行のみ現在時刻に
     * 置換し (無ければ閉じ --- の直前に追加)、他の行は一切変更しない。
     * @param {string|null} frontmatter splitFrontmatter が返した生テキスト
     * @param {string} body
     * @returns {string}
     */
    static joinFrontmatter(frontmatter, body) {
        if (!frontmatter) return body;
        const now = new Date().toISOString();
        let fm = frontmatter;
        if (/^updated:.*$/m.test(fm)) {
            fm = fm.replace(/^updated:.*$/m, `updated: ${now}`);
        } else {
            // 閉じ --- 行の直前に updated 行を追加
            fm = fm.replace(/(\r?\n)---(\r?\n|$)/, `$1updated: ${now}$1---$2`);
        }
        return fm + body;
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
