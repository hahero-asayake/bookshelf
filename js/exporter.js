// BookshelfExporter - 公開記事 (静的 SSG) をユーザの公開 repo / 共有ハブへ push する
// (P1, ADR-030 → 公開v2 記事モデルへ移行, ADR-058 §11)
//
// ホスト型マルチユーザ前提: アプリは 1 箇所 (hahero-asayake.github.io/bookshelf) で配信され、
// 各ユーザは自分の公開 repo (例 <user>/bookshelf-public) に「静的ページ」を push する。
//
// PublishArticleStore (private/publish/articles.json) の記事から PublishArticleGenerator が
// 自己完結 HTML を生成し、それをそのまま push する (旧 PublishPageStore/PublishGenerator 経路は
// 公開v2 S3 で撤去済み)。
//
//   出力構造 (公開 repo のルート):
//     index.html              # 公開記事一覧 (トップ)
//     <slug>/index.html       # 各公開記事
//   README.md はルートに残す (削除同期の対象外)。
//   配信は公開 repo の GitHub Pages を想定 (https://<owner>.github.io/<repo>/)。

class BookshelfExporter {
    constructor(app) {
        this.app = app;
    }

    // 公開先の設定を解決。target='github'(自分の repo) | 'hub'(共有ハブ)。
    // owner 既定 = GitHub login。repo は「ユーザが明示的に選んだもの」だけを使う。
    _resolvePublishConfig() {
        const cfg = SyncConfigManager.load();
        const gh = cfg.github || {};
        const pub = cfg.publish || {};
        const target = pub.target === 'github' ? 'github' : 'hub';   // 未設定はハブ (かんたん公開・2026-07-28)
        const owner = pub.owner || gh.login || gh.owner || '';
        const repo = pub.repo || '';
        const branch = pub.branch || 'main';
        return { target, owner, repo, branch, token: gh.token, configured: !!(pub.owner && pub.repo) };
    }

    // 公開 repo を GitHub Pages で配信する想定の URL
    _pagesSiteUrl(owner, repo) {
        const o = String(owner || '').toLowerCase();
        if (repo && String(repo).toLowerCase() === `${o}.github.io`) return `https://${o}.github.io/`;
        return `https://${o}.github.io/${repo}/`;
    }

    /**
     * 公開: 公開記事 (PublishArticleStore) から静的ページを生成し、公開 repo へ push する。
     * @param {object} [opts]
     * @param {boolean} [opts.dryRun] true なら push せず、書き込む/削除するエントリ一覧を返す
     * @returns {Promise<object>}
     */
    async export({ dryRun = false } = {}) {
        if (!this.app._isSyncReady()) {
            throw new Error('同期先が未接続です');
        }
        const pub = this._resolvePublishConfig();

        // アフィタグの Plus/Free 出し分けに使う plan を、生成前に最新化する (ハブ接続時のみ・失敗は無視)。
        // これをしないと、直前のプラン変更 (Plus化/失効) が次回リロードまで反映されない。
        if (typeof HubAuth !== 'undefined' && typeof HubAuth.isConnected === 'function' && HubAuth.isConnected()) {
            try { await HubAuth.refreshUsage(); } catch (_) {}
        }

        // 公開記事 → 静的ページ生成 (PublishArticleGenerator)。生成は公開先に依らず共通
        const store = this.app.publishArticleStore;
        const generator = this.app.publishArticleGenerator;
        if (!store || !generator) {
            throw new Error('公開システムが初期化されていません。リロードしてください。');
        }
        // 公開は記事単位 (ADR-058 §11): サイトは「published=true の記事」の集合。
        // 公開中 0 件 (=全記事未公開) も許容し、index のみ push + 削除同期でサイトをクリアする。
        // ただし store.load() 自体の失敗 (通信/認証/権限エラー) は「0件」と区別し、ここで throw して
        // 公開を中止する (握り潰すと、読めなかっただけの記事が削除同期で公開サイトから消える)。
        const allArticles = await store.load();
        const articles = allArticles.filter(a => a.published);

        // 公開先の絶対 URL (canonical / og:url 用)。hub=publicBase、GitHub=Pages URL。
        // hub のときは siteId も渡す (generator が /go/<siteId>/ アフィリンクを組むのに使う, ADR-034追補)。
        let siteBaseUrl = '';
        let siteId = '';
        if (pub.target === 'hub') {
            const hub = SyncConfigManager.load().hub || {};
            siteBaseUrl = hub.publicBase || '';
            siteId = hub.siteId || '';
        } else if (pub.owner && pub.repo) {
            siteBaseUrl = this._pagesSiteUrl(pub.owner, pub.repo);
        }

        // プラグインの公開スナップショットを収集 (コード非実行・data/publish.json を読むだけ。ADR-042)
        const publishData = await this._collectPluginPublishData();

        const result = await generator.build(articles, { siteBaseUrl, target: pub.target, siteId, publishData });
        if (articles.length > 0 && result.articles.length === 0) {
            throw new Error('公開できる記事がありません。各記事のブロック内容を確認してください。');
        }
        if (result.leak.length > 0) {
            throw new Error(`公開記事に個人情報が混入している可能性があります: ${result.leak.join(', ')}`);
        }

        // 公開先で分岐: 共有ハブ (/publish) か、自分の GitHub repo か
        if (pub.target === 'hub') {
            return await this._exportToHub(result, { dryRun });
        }

        // === GitHub repo への公開 (既定) ===
        if (!pub.token) {
            throw new Error('公開には GitHub 接続が必要です。設定の「同期 / 公開」で GitHub に接続してください。');
        }
        if (!pub.owner) {
            throw new Error('公開先のアカウントが特定できません。GitHub に接続し直してください。');
        }
        if (!pub.repo) {
            throw new Error('公開先リポジトリが未設定です。設定の「同期 / 公開」で、公開用の GitHub リポジトリ（必ず public リポジトリ）を選んでください。');
        }
        // 公開先が GitHub のときは、同期方式に関わらずトークンを最新化する (publish 専用 refresh)。
        // 同期=ハブ/ローカルでも『公開だけ GitHub』構成があり、失効トークンで 401 になるのを防ぐ。
        if (typeof this.app._ensureFreshGitHubToken === 'function') {
            try { await this.app._ensureFreshGitHubToken({ forPublish: true }); } catch (_) {}
            pub.token = (SyncConfigManager.load().github || {}).token || pub.token;
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
            // 空 repo / 未作成なら _listAllFiles は [] を返す (throw しない)。
            // ここに来る = 403/5xx/認証失効などで「現状を取得できなかった」=削除の取りこぼし確定。
            // 黙って続行すると非公開化したページが公開サイトに残り続けるため、安全のため公開を中止する。
            throw new Error('公開先リポジトリの現在のファイル一覧を取得できませんでした。時間をおいて再試行するか、GitHub を再接続してください。（取りこぼしを防ぐため公開を中止しました）');
        }

        const siteUrl = this._pagesSiteUrl(pub.owner, pub.repo);

        if (dryRun) {
            return {
                dryRun: true,
                target: `${pub.owner}/${pub.repo}@${pub.branch}`,
                articles: result.articles,
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
            await publishAdapter.commitBatch(`chore(bookshelf): publish ${result.articles.length} article(s)`);
        } catch (err) {
            if (err && err.name === 'GitHubConflictError') {
                throw new Error('公開中に公開 repo が更新されました。リロードしてやり直してください。');
            }
            // 初期コミットの無い空 repo: branch ref が 404 → 分かりやすい案内に変換
            if (err && /get ref|404/i.test(String(err.message || ''))) {
                throw new Error('公開先リポジトリが空（初期コミットなし）です。GitHub で「Add a README file」にチェックして初期化してから、もう一度公開してください。');
            }
            throw err;
        }

        // 各記事の lastBuiltAt を更新
        const now = Date.now();
        for (const a of result.articles) {
            // 公開自体は成功しているため握り潰すが、テストから真因が追えるよう console.error は残す
            // (イシュー#104: 握り潰しで CI 失敗時に lastBuiltAt が null になる理由が追えなかった)。
            try { await store.update(a.id, { lastBuiltAt: now }); } catch (e) { console.error('記事のlastBuiltAt更新に失敗 (公開自体は成功):', a.id, e); }
        }

        return {
            articles: result.articles,
            published: result.articles.length,
            deletes: deletes.length,
            siteUrl,
            publicUrl: siteUrl,
            errors: result.errors
        };
    }

    /**
     * 共有ハブ (/publish) へ公開する。GitHub repo は不要 (Google ログインのみ)。
     * sites/<siteId>/ をサーバ側で今回集合に置換 (削除同期は deleteMissing でサーバが担う)。
     */
    async _exportToHub(result, { dryRun = false } = {}) {
        const cfg = SyncConfigManager.load();
        const hub = cfg.hub || {};
        if (!hub.key || !hub.apiBase) {
            throw new Error('共有（ハブ）に公開するには、設定の「同期」で Asayake ハブにログインしてください。');
        }
        const siteUrl = hub.publicBase || '';
        if (dryRun) {
            return {
                dryRun: true,
                target: 'hub',
                articles: result.articles,
                writeEntries: result.files.map(f => f.path),
                deleteEntries: [],   // 削除はサーバ側 (deleteMissing) で実施
                leak: result.leak,
                siteUrl,
                errors: result.errors
            };
        }
        const adapter = new HubStorageAdapter({
            apiBase: hub.apiBase,
            getKey: () => (SyncConfigManager.load().hub || {}).key || ''
        });
        // ownTag を同送: Worker が uid レコードに記録し、Plus 時に /go がクリック時に解決して使う (ADR-034追補)。
        const resp = await adapter.publishSite(result.files, true, result.ownTag || '');
        // 公開後に使用量が変わるのでキャッシュ更新 (バー反映用・失敗は黙殺)
        if (typeof HubAuth !== 'undefined') { try { await HubAuth.refreshUsage(); } catch (_) {} }

        const now = Date.now();
        for (const a of result.articles) {
            // 公開自体は成功しているため握り潰すが、テストから真因が追えるよう console.error は残す
            // (イシュー#104: 握り潰しで CI 失敗時に lastBuiltAt が null になる理由が追えなかった)。
            try { await this.app.publishArticleStore.update(a.id, { lastBuiltAt: now }); } catch (e) { console.error('記事のlastBuiltAt更新に失敗 (公開自体は成功):', a.id, e); }
        }
        const url = (resp && resp.siteUrl) || siteUrl;
        return {
            articles: result.articles,
            published: result.articles.length,
            deletes: 0,
            siteUrl: url,
            publicUrl: url,
            errors: result.errors
        };
    }

    // プラグインの公開スナップショットを収集する (ADR-042)。publishable=true のプラグインの
    // plugins/<id>/data/publish.json (純データ JSON) を読むだけで、プラグインのコードは実行しない。
    // 読めない / 壊れた JSON はスキップ。返り値は generator.build の opts.publishData。
    // 受け付けるのは footerNote (文字列) のみ。generator 側が必ず esc して所定スロットへ出す。
    async _collectPluginPublishData() {
        const out = [];
        try {
            if (typeof this.app._collectPublishablePluginIds !== 'function' || !this.app.pluginAPI) return out;
            const ids = await this.app._collectPublishablePluginIds();
            for (const id of ids) {
                let json;
                try {
                    const text = await this.app.pluginAPI.readPluginFile(id, 'publish.json');
                    if (!text) continue;
                    json = JSON.parse(text);
                } catch (_) { continue; }
                const note = json && typeof json.footerNote === 'string' ? json.footerNote.trim() : '';
                if (note) out.push({ id, footerNote: note });
            }
        } catch (_) {}
        return out;
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
