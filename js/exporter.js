// BookshelfExporter - 同期先の `public/` 配下に公開スナップショットを書き出す
//
// 設計 (2026-05-31〜):
//   出力先は同期先の `public/` フォルダ。別途 picker は不要。
//   GitHub Adapter なら `storage.syncBatch` で **1 commit にまとめて push**。
//   LocalFS Adapter なら順次書く。
//
//   出力構造:
//     <同期先>/public/
//       index.html              # body に class="public-mode" を注入
//       css/bookshelf.css
//       js/*.js
//       library.json            # publishable な書誌のみ
//       bookshelves.json        # isPublic=true (+ all) のみ
//       bookshelves/all.json    # all (filtered)
//       bookshelves/<slug>.json # publishable bookshelves
//       notes.json              # 公開対象 ASIN のみ (hideDetailMemo の hasDetailMemo は除去)
//       books/<ASIN>__*.md      # hideDetailMemo=false の長文メモ
//       main.json               # 公開アプリの起動設定
//       settings.json           # 個人情報除外済 settings
//       plugins/<id>/           # manifest.publishable=true のみ

class BookshelfExporter {
    constructor(app) {
        this.app = app;
    }

    async export() {
        if (!this.app._isSyncReady()) {
            throw new Error('同期先が未接続です');
        }
        const storage = this.app.storage;
        const state = await storage.loadAll();

        // 公開対象本棚: all (特殊) + isPublic=true のユーザ本棚
        const publishableMetas = (state.bookshelvesMeta.bookshelves || [])
            .filter(meta => meta.isSpecial || meta.isPublic);

        const publishAsins = new Set();
        const hideDetailAsins = new Set();
        const filteredBookshelfFiles = [];
        const filteredMetas = [];

        for (const meta of publishableMetas) {
            const isAll = meta.slug === 'all';
            const data = isAll ? state.allBookshelf : state.bookshelfFiles[meta.internalId];
            if (!data) continue;
            const filteredBooks = (data.books || []).filter(asin => {
                const note = data.notes && data.notes[asin];
                return !(note && note.publishHide);
            });
            const filteredData = { ...data, books: filteredBooks };
            filteredBookshelfFiles.push({ slug: meta.slug, data: filteredData });
            filteredMetas.push(meta);
            for (const asin of filteredBooks) {
                publishAsins.add(asin);
                const note = data.notes && data.notes[asin];
                if (note && note.hideDetailMemo) hideDetailAsins.add(asin);
            }
        }

        // notes.json の hideDetailMemo も統合
        for (const [asin, note] of Object.entries(state.notes || {})) {
            if (note && note.hideDetailMemo && publishAsins.has(asin)) {
                hideDetailAsins.add(asin);
            }
        }

        const libraryBooks = ((state.library && state.library.books) || [])
            .filter(b => publishAsins.has(b.asin));

        // entries 配列に集めて 1 commit (GitHub) / 順次 (LocalFS) で書き出し
        const entries = [];
        const errors = [];

        entries.push({ op: 'put', path: 'public/library.json', data: {
            exportDate: new Date().toISOString(),
            books: libraryBooks
        }});
        entries.push({ op: 'put', path: 'public/bookshelves.json', data: {
            bookshelves: filteredMetas
        }});
        for (const f of filteredBookshelfFiles) {
            entries.push({ op: 'put', path: `public/bookshelves/${f.slug}.json`, data: f.data });
        }

        // notes.json
        // Phase B-4: ALL.notes[asin].hideMemo=true なら memo を除去 (opt-out)
        //           hideDetailMemo=true なら hasDetailMemo を除去 (公開アプリが長文メモ存在判定で使う)
        //           hideMemo / hideDetailMemo フラグ自体は公開側には漏らさない
        const filteredNotes = {};
        for (const asin of publishAsins) {
            const n = state.notes[asin];
            if (!n) continue;
            const { hideMemo, hideDetailMemo, hasDetailMemo, memo, ...rest } = n;
            const out = { ...rest };
            if (memo && !hideMemo) out.memo = memo;
            if (hasDetailMemo && !hideDetailMemo && !hideDetailAsins.has(asin)) {
                out.hasDetailMemo = true;
            }
            if (Object.keys(out).length > 0) filteredNotes[asin] = out;
        }
        entries.push({ op: 'put', path: 'public/notes.json', data: { notes: filteredNotes }});

        // main.json (公開アプリの起動設定 — bookshelvesMetaEntries には all 含む)
        entries.push({ op: 'put', path: 'public/main.json', data: {
            bookshelves: filteredMetas.map(m => m.internalId),
            appliedPlugins: [],
            defaultSort: 'addedDate-desc'
        }});

        // settings.json (個人情報除外)
        const publicSettings = { ...(state.privateSettings || {}) };
        delete publicSettings.affiliateId;
        delete publicSettings.obsidianVaultName;
        delete publicSettings.obsidianSubPath;
        delete publicSettings.extensionImportOrigins;
        delete publicSettings.bookMemoOpenWith;
        entries.push({ op: 'put', path: 'public/settings.json', data: publicSettings });

        // 長文メモ (.md)
        for (const asin of publishAsins) {
            if (hideDetailAsins.has(asin)) continue;
            const book = libraryBooks.find(b => b.asin === asin);
            if (!book) continue;
            const note = state.notes[asin];
            if (!note || !note.hasDetailMemo) continue;
            try {
                const text = await storage.readBookMemo(asin, book.title);
                if (text !== null) {
                    entries.push({
                        op: 'put',
                        path: `public/books/${storage.bookMemoFileName(asin, book.title)}`,
                        data: text,
                        kind: 'text'
                    });
                }
            } catch (e) {
                errors.push(`books/${asin}: ${e.message}`);
            }
        }

        // app shell (index.html / css / js)
        const shell = await this._collectAppShell();
        entries.push(...shell.entries);
        errors.push(...shell.errors);

        // publishable プラグイン
        const plugins = await this._collectPublishablePlugins();
        entries.push(...plugins.entries);
        errors.push(...plugins.errors);

        // バッチ書き込み (GitHub なら 1 commit)
        try {
            await storage.syncBatch(entries, {
                message: `chore(bookshelf): publish ${publishAsins.size} books / ${filteredMetas.length} bookshelves`
            });
        } catch (err) {
            if (err && err.name === 'GitHubConflictError') {
                throw new Error('公開エクスポート中に同期先データが更新されました。リロードしてやり直してください。');
            }
            throw err;
        }

        return {
            exported: publishAsins.size,
            bookshelves: filteredMetas.length,
            longMemos: publishAsins.size - hideDetailAsins.size,
            plugins: plugins.pluginIds,
            entries: entries.length,
            errors
        };
    }

    async _collectAppShell() {
        const entries = [];
        const errors = [];
        const fetchText = async (path) => {
            const r = await fetch(path);
            if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
            return r.text();
        };

        try {
            const indexHtml = await fetchText('index.html');
            const publicIndex = indexHtml.replace('<body>', '<body class="public-mode" data-public-mode="true">');
            entries.push({ op: 'put', path: 'public/index.html', data: publicIndex, kind: 'text' });
        } catch (e) {
            errors.push(`index.html: ${e.message}`);
        }

        try {
            entries.push({
                op: 'put',
                path: 'public/css/bookshelf.css',
                data: await fetchText('css/bookshelf.css'),
                kind: 'text'
            });
        } catch (e) {
            errors.push(`css/bookshelf.css: ${e.message}`);
        }

        const jsFiles = [
            'storage-adapter.js',
            'local-fs-adapter.js',
            'github-adapter.js',
            'github-auth.js',
            'sync-config.js',
            'storage.js',
            'book-manager.js',
            'bookshelf-manager.js',
            'exporter.js',
            'plugin-api.js',
            'plugin-loader.js',
            'router.js',
            'bookshelf.js'
        ];
        for (const f of jsFiles) {
            try {
                entries.push({
                    op: 'put',
                    path: `public/js/${f}`,
                    data: await fetchText(`js/${f}`),
                    kind: 'text'
                });
            } catch (e) {
                errors.push(`js/${f}: ${e.message}`);
            }
        }
        return { entries, errors };
    }

    async _collectPublishablePlugins() {
        const entries = [];
        const errors = [];
        const pluginIds = [];
        const storage = this.app.storage;

        let ids;
        try {
            ids = await storage.listDirs('plugins');
        } catch (e) {
            errors.push(`plugins/: ${e.message}`);
            return { entries, errors, pluginIds };
        }

        for (const id of ids) {
            try {
                const manifest = await storage.readJSON(`plugins/${id}/manifest.json`);
                if (!manifest || !manifest.publishable) continue;

                const files = ['manifest.json', ...(manifest.files || ['index.js'])];
                for (const f of files) {
                    try {
                        const text = await storage.readText(`plugins/${id}/${f}`);
                        if (text == null) {
                            errors.push(`plugins/${id}/${f}: not found`);
                            continue;
                        }
                        entries.push({
                            op: 'put',
                            path: `public/plugins/${id}/${f}`,
                            data: text,
                            kind: 'text'
                        });
                    } catch (e) {
                        errors.push(`plugins/${id}/${f}: ${e.message}`);
                    }
                }
                pluginIds.push(id);
            } catch (e) {
                errors.push(`plugins/${id}/manifest.json: ${e.message}`);
            }
        }
        return { entries, errors, pluginIds };
    }
}

window.BookshelfExporter = BookshelfExporter;
