// BookshelfExporter - 公開ページ (静的 SSG) をユーザの公開 repo へ push する (P1, ADR-030)
//
// ホスト型マルチユーザ前提: アプリは 1 箇所 (hahero-asayake.github.io/bookshelf) で配信され、
// 各ユーザは自分の公開 repo (例 <user>/bookshelf-public) に「静的ページ」を push する。
//
// 旧方式 (ADR-022, `?u=` でアプリ丸ごと描画) は廃止。いまは PublishGenerator が
// 公開ページ定義 (private/publish/pages.json) から自己完結 HTML を生成し、それをそのまま push する。
//
//   出力構造 (公開 repo のルート):
//     index.html              # 公開ページ一覧 (トップ)
//     <slug>/index.html       # 各公開ページ
//   README.md はルートに残す (削除同期の対象外)。
//   配信は公開 repo の GitHub Pages を想定 (https://<owner>.github.io/<repo>/)。

class BookshelfExporter {
    constructor(app) {
        this.app = app;
    }

    // 公開先 repo の設定を解決。owner 既定 = GitHub login。
    // repo は「ユーザが明示的に選んだもの」だけを使う (勝手に bookshelf-public を作らない)。
    _resolvePublishConfig() {
        const cfg = SyncConfigManager.load();
        const gh = cfg.github || {};
        const pub = cfg.publish || {};
        const owner = pub.owner || gh.login || gh.owner || '';
        const repo = pub.repo || '';
        const branch = pub.branch || 'main';
        return { owner, repo, branch, token: gh.token, configured: !!(pub.owner && pub.repo) };
    }

    // 公開 repo を GitHub Pages で配信する想定の URL
    _pagesSiteUrl(owner, repo) {
        const o = String(owner || '').toLowerCase();
        if (repo && String(repo).toLowerCase() === `${o}.github.io`) return `https://${o}.github.io/`;
        return `https://${o}.github.io/${repo}/`;
    }

    /**
     * 公開: 公開ページ定義から静的ページを生成し、公開 repo へ push する。
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
        if (!pub.repo) {
            throw new Error('公開先リポジトリが未設定です。設定の「同期 / 公開」で、公開用の GitHub リポジトリ（必ず public リポジトリ）を選んでください。');
        }
        // 同期方式が GitHub の場合はトークンを最新化 (refresh 自動更新)
        if (this.app.syncMethod === 'github' && typeof this.app._ensureFreshGitHubToken === 'function') {
            await this.app._ensureFreshGitHubToken();
            pub.token = (SyncConfigManager.load().github || {}).token || pub.token;
        }

        // 公開ページ → 静的ページ生成 (PublishGenerator)
        const store = this.app.publishPageStore;
        const generator = this.app.publishGenerator;
        if (!store || !generator) {
            throw new Error('公開システムが初期化されていません。リロードしてください。');
        }
        // 公開はページ単位 (ADR-030): サイトは「published=true のページ」の集合。
        // 公開中 0 件 (=全ページ未公開) も許容し、index のみ push + 削除同期でサイトをクリアする。
        const allPages = await store.load();
        const pages = allPages.filter(p => p.published);

        const result = await generator.build(pages);
        if (pages.length > 0 && result.pages.length === 0) {
            throw new Error('公開できるページがありません。各ページのスタイルと対象（本棚/本）を確認してください。');
        }
        if (result.leak.length > 0) {
            throw new Error(`公開ページに個人情報が混入している可能性があります: ${result.leak.join(', ')}`);
        }

        // 公開 repo 用アダプタ (第 2 インスタンス。token は GitHub 接続のものを共用)
        const publishAdapter = new GitHubAdapter({
            owner: pub.owner, repo: pub.repo, branch: pub.branch, basePath: '', token: pub.token
        });

        // 削除同期: 公開 repo の現状を列挙し、今回の出力に無いものを削除 (README.md は残す)
        const writePaths = new Set(result.files.map(f => f.path));
        const deletes = [];
        try {
            const existing = await this._listAllFiles(publishAdapter, '');
            for (const p of existing) {
                if (p === 'README.md') continue;
                if (!writePaths.has(p)) deletes.push(p);
            }
        } catch (e) {
            // repo が空 or 未作成 → 削除対象なし
            result.errors.push(`list publish repo: ${e.message}`);
        }

        const siteUrl = this._pagesSiteUrl(pub.owner, pub.repo);

        if (dryRun) {
            return {
                dryRun: true,
                target: `${pub.owner}/${pub.repo}@${pub.branch}`,
                pages: result.pages,
                writeEntries: [...writePaths],
                deleteEntries: deletes,
                leak: result.leak,
                siteUrl,
                errors: result.errors
            };
        }

        // バッチ push (1 commit)
        publishAdapter.beginBatch();
        for (const f of result.files) publishAdapter.addBatchEntry(f.path, f.content);
        for (const p of deletes) publishAdapter.addBatchDelete(p);
        try {
            await publishAdapter.commitBatch(`chore(bookshelf): publish ${result.pages.length} page(s)`);
        } catch (err) {
            if (err && err.name === 'GitHubConflictError') {
                throw new Error('公開中に公開 repo が更新されました。リロードしてやり直してください。');
            }
            throw err;
        }

        // 各ページの lastBuiltAt を更新
        const now = Date.now();
        for (const p of result.pages) {
            try { await store.update(p.id, { lastBuiltAt: now }); } catch (_) {}
        }

        return {
            pages: result.pages,
            published: result.pages.length,
            deletes: deletes.length,
            siteUrl,
            publicUrl: siteUrl,
            errors: result.errors
        };
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
}

window.BookshelfExporter = BookshelfExporter;
