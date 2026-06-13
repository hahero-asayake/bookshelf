// BookshelfExporter - 公開スナップショットをユーザの公開 repo へ push する (T09, ADR-022/028)
//
// ホスト型マルチユーザ前提: アプリは 1 箇所 (hahero-asayake.github.io/bookshelf) で配信され、
// 各ユーザは自分の公開 repo (例 <user>/bookshelf-public) にデータだけを push する。
// 公開モードは ?u=<owner>/<repo> でその repo の raw.githubusercontent から fetch する。
//
//   出力構造 (公開 repo のルート。アプリシェルは同梱しない = 共通配信):
//     library.json            # publishable な書誌のみ
//     bookshelves.json        # isPublic=true (+ all) のみ
//     bookshelves/all.json    # all (filtered)
//     bookshelves/<slug>.json # publishable bookshelves
//     notes.json              # 公開対象 ASIN のみ (hideMemo/hideDetailMemo 反映・フラグ除去)
//     books/<ASIN>__*.md      # hideDetailMemo=false の長文メモ
//     main.json / settings.json
//     plugins/<id>/           # manifest.publishable=true のみ
//   README.md はルートに残す (削除同期の対象外)。

class BookshelfExporter {
    constructor(app) {
        this.app = app;
    }

    // 公開先 repo の設定を解決。owner 既定 = GitHub login、repo 既定 'bookshelf-public'
    _resolvePublishConfig() {
        const cfg = SyncConfigManager.load();
        const gh = cfg.github || {};
        const pub = cfg.publish || {};
        const owner = pub.owner || gh.login || gh.owner || '';
        const repo = pub.repo || 'bookshelf-public';
        const branch = pub.branch || 'main';
        return { owner, repo, branch, token: gh.token };
    }

    /**
     * 公開エクスポート。
     * @param {object} [opts]
     * @param {boolean} [opts.dryRun] true なら push せず、書き込む/削除するエントリ一覧を返す
     * @returns {Promise<object>}
     */
    async export({ dryRun = false } = {}) {
        if (!this.app._isSyncReady()) {
            throw new Error('同期先が未接続です');
        }
        // 公開には GitHub 接続が必須 (同期方式が GitHub 以外でも、公開のためだけに接続できる)
        const pub = this._resolvePublishConfig();
        if (!pub.token) {
            throw new Error('公開には GitHub 接続が必要です。設定の「同期 / 公開」で GitHub に接続してください。');
        }
        if (!pub.owner) {
            throw new Error('公開先のアカウントが特定できません。GitHub に接続し直してください。');
        }
        // 同期方式が GitHub の場合はトークンを最新化 (refresh 自動更新)
        if (this.app.syncMethod === 'github' && typeof this.app._ensureFreshGitHubToken === 'function') {
            await this.app._ensureFreshGitHubToken();
            pub.token = (SyncConfigManager.load().github || {}).token || pub.token;
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

        for (const [asin, note] of Object.entries(state.notes || {})) {
            if (note && note.hideDetailMemo && publishAsins.has(asin)) {
                hideDetailAsins.add(asin);
            }
        }

        const libraryBooks = ((state.library && state.library.books) || [])
            .filter(b => publishAsins.has(b.asin));

        const entries = [];
        const errors = [];

        entries.push({ op: 'put', path: 'library.json', data: {
            exportDate: new Date().toISOString(),
            books: libraryBooks
        }});
        entries.push({ op: 'put', path: 'bookshelves.json', data: {
            bookshelves: filteredMetas
        }});
        for (const f of filteredBookshelfFiles) {
            entries.push({ op: 'put', path: `bookshelves/${f.slug}.json`, data: f.data });
        }

        // notes.json: hideMemo で memo 除去 / hideDetailMemo で hasDetailMemo 除去 / フラグ自体は漏らさない
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
        entries.push({ op: 'put', path: 'notes.json', data: { notes: filteredNotes }});

        entries.push({ op: 'put', path: 'main.json', data: {
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
        entries.push({ op: 'put', path: 'settings.json', data: publicSettings });

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
                        path: `books/${storage.bookMemoFileName(asin, book.title)}`,
                        data: text,
                        kind: 'text'
                    });
                }
            } catch (e) {
                errors.push(`books/${asin}: ${e.message}`);
            }
        }

        // publishable プラグイン
        const plugins = await this._collectPublishablePlugins();
        entries.push(...plugins.entries);
        errors.push(...plugins.errors);

        // 公開 repo 用アダプタ (第 2 インスタンス。token は GitHub 接続のものを共用)
        const publishAdapter = new GitHubAdapter({
            owner: pub.owner, repo: pub.repo, branch: pub.branch, basePath: '', token: pub.token
        });

        // 削除同期: 公開 repo の現状を列挙し、今回エントリに無いものに delete を出す (README.md は残す)
        const writePaths = new Set(entries.map(e => e.path));
        const deletes = [];
        try {
            const existing = await this._listAllFiles(publishAdapter, '');
            for (const p of existing) {
                if (p === 'README.md') continue;
                if (!writePaths.has(p)) deletes.push(p);
            }
        } catch (e) {
            // repo が空 or 未作成 → 削除対象なし
            errors.push(`list publish repo: ${e.message}`);
        }

        // private 情報の混入チェック (dryRun でも本番でも実施)
        const leak = this._detectPrivateLeak(entries);

        if (dryRun) {
            return {
                dryRun: true,
                target: `${pub.owner}/${pub.repo}@${pub.branch}`,
                publicBookshelves: filteredMetas.map(m => m.name),
                exported: publishAsins.size,
                bookshelves: filteredMetas.length,
                longMemos: publishAsins.size - hideDetailAsins.size,
                plugins: plugins.pluginIds,
                writeEntries: entries.map(e => e.path),
                deleteEntries: deletes,
                privateLeak: leak,
                errors
            };
        }

        if (leak.length > 0) {
            throw new Error(`公開データに個人情報が混入している可能性があります: ${leak.join(', ')}`);
        }

        // バッチ push (1 commit)
        publishAdapter.beginBatch();
        for (const e of entries) {
            const content = (e.kind === 'text') ? e.data : JSON.stringify(e.data, null, 2);
            publishAdapter.addBatchEntry(e.path, content);
        }
        for (const p of deletes) {
            publishAdapter.addBatchDelete(p);
        }
        try {
            await publishAdapter.commitBatch(
                `chore(bookshelf): publish ${publishAsins.size} books / ${filteredMetas.length} bookshelves`
            );
        } catch (err) {
            if (err && err.name === 'GitHubConflictError') {
                throw new Error('公開中に公開 repo が更新されました。リロードしてやり直してください。');
            }
            throw err;
        }

        return {
            exported: publishAsins.size,
            bookshelves: filteredMetas.length,
            longMemos: publishAsins.size - hideDetailAsins.size,
            plugins: plugins.pluginIds,
            entries: entries.length,
            deletes: deletes.length,
            publicUrl: `${location.origin}${location.pathname}?u=${pub.owner}/${pub.repo}`,
            errors
        };
    }

    // 公開エントリに個人情報が混入していないか検査 (key 名で判定)
    _detectPrivateLeak(entries) {
        const banned = ['affiliateId', 'obsidianVaultName', 'obsidianSubPath', 'extensionImportOrigins', 'hideMemo', 'hideDetailMemo'];
        const found = new Set();
        for (const e of entries) {
            if (e.kind === 'text') continue; // 長文メモ本文は対象外 (ユーザが書いた内容)
            const json = JSON.stringify(e.data);
            for (const key of banned) {
                if (json.includes(`"${key}"`)) found.add(`${key} (${e.path})`);
            }
        }
        return [...found];
    }

    // adapter の dir 以下の全ファイル path を再帰列挙
    async _listAllFiles(adapter, dir) {
        const out = [];
        const files = await adapter.listFiles(dir);
        for (const f of files) out.push(dir ? `${dir}/${f}` : f);
        let subdirs = [];
        try {
            subdirs = await adapter.listDirs(dir);
        } catch (_) {}
        for (const sub of subdirs) {
            const subPath = dir ? `${dir}/${sub}` : sub;
            const nested = await this._listAllFiles(adapter, subPath);
            out.push(...nested);
        }
        return out;
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
                            path: `plugins/${id}/${f}`,
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
