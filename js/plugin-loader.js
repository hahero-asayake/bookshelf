// BookshelfPluginLoader
//
// 同期フォルダ内の plugins/ をスキャンし、有効なプラグインを動的に読み込む。
// GitHub の repo URL からのインストールにも対応。
//
// プラグイン構造:
//   plugins/<id>/
//     manifest.json    { id, name, version, files: ["index.js"], dependencies: [], publishable, description }
//     index.js         export function activate(api, manifest) { ... }
//     data/            プラグイン固有の任意ファイル
//
// 読み込み判定（オプトアウト方式）:
//   インストール済みは原則すべて自動有効化
//   userData.settings.disabledPlugins に含まれる id だけ無効化
//   userData._storage.main.appliedPlugins → 全本棚共通で適用（無効化されていれば除外）

class BookshelfPluginLoader {
    constructor(app) {
        this.app = app;
        this.loaded = new Map();        // id → { manifest, deactivate, module }
        this.failedToLoad = new Map();  // id → error message
        this._installed = null;         // キャッシュ（listInstalledPlugins）
    }

    /**
     * プラグイン ID から manifest を取り出す helper (plugin-api からアクセスされる)
     * @returns {object|null} manifest or null
     */
    getManifest(id) {
        const rec = this.loaded.get(id);
        return rec ? rec.manifest : null;
    }

    /**
     * Proxy-like: loader.manifests[id] で manifest を取得できるようにする
     * (plugin-api 側が `this.pluginLoader.manifests[pluginId]` を期待しているため)
     */
    get manifests() {
        const map = {};
        for (const [id, rec] of this.loaded) {
            if (rec && rec.manifest) map[id] = rec.manifest;
        }
        return map;
    }

    // ===== インストール済みプラグインを列挙 =====
    async listInstalledPlugins({ refresh = false } = {}) {
        if (!refresh && this._installed) return this._installed;
        if (!this._isReady()) return [];
        let pluginIds;
        try {
            pluginIds = await this.app.storage.listDirs('plugins');
        } catch (e) {
            console.warn('[pluginLoader] plugins ディレクトリ列挙失敗:', e);
            return (this._installed = []);
        }
        // manifest.json を並列読み込み (逐次 await だと同期先が GitHub のとき特に遅い)。
        const results = await Promise.all(pluginIds.map(async (id) => {
            try {
                const manifest = await this.app.storage.readJSON(`plugins/${id}/manifest.json`);
                return manifest ? { id, manifest } : null;
            } catch (e) {
                console.warn(`[pluginLoader] "${id}" の manifest.json 読み込み失敗:`, e);
                return null;
            }
        }));
        this._installed = results.filter(Boolean);
        return this._installed;
    }

    _isReady() {
        return typeof this.app._isSyncReady === 'function' && this.app._isSyncReady();
    }

    // ===== 有効なプラグインを起動（オプトアウト: disabledPlugins に無いものを全部有効化） =====
    async loadEnabledPlugins() {
        if (!window.bookshelfAPI) {
            console.warn('[pluginLoader] bookshelfAPI が未生成、スキップ');
            return [];
        }
        const settings = (this.app.userData && this.app.userData.settings) || {};
        const disabledIds = new Set(settings.disabledPlugins || []);

        const installed = await this.listInstalledPlugins({ refresh: true });
        if (installed.length === 0) return [];
        const enabled = installed.filter(p => !disabledIds.has(p.manifest.id || p.id));

        // 依存関係チェック
        const enabledSet = new Set(enabled.map(p => p.manifest.id || p.id));
        const ok = [];
        for (const p of enabled) {
            const deps = p.manifest.dependencies || [];
            const missing = deps.filter(d => !enabledSet.has(d));
            if (missing.length > 0) {
                const msg = `依存プラグイン不足: ${missing.join(', ')}`;
                console.warn(`[pluginLoader] ${p.id} スキップ: ${msg}`);
                this.failedToLoad.set(p.id, msg);
                continue;
            }
            ok.push(p);
        }

        // index.js を全プラグイン分まとめて並列読み込み (I/O を同時化 → 体感速度を改善)。
        if (typeof this.onProgress === 'function') {
            try { this.onProgress(0, ok.length); } catch (_) {}
        }
        const sources = await Promise.all(ok.map(async (p) => ({
            p,
            src: await this._readPluginFile(p.id, 'index.js')
        })));
        // activate は登録順を保つため逐次実行 (依存プラグインが先に登録される必要があるため)。
        let done = 0;
        for (const { p, src } of sources) {
            await this._activatePlugin(p, src);
            done++;
            if (typeof this.onProgress === 'function') {
                try { this.onProgress(done, sources.length); } catch (_) {}
            }
        }
        return ok;
    }

    // 単体読み込み (installFromGitHub から使用)。読み込み + activate。
    async _loadPlugin({ id, manifest }) {
        const indexJs = await this._readPluginFile(id, 'index.js');
        await this._activatePlugin({ id, manifest }, indexJs);
    }

    // 読み込み済みソースを import + activate する (読み込みは呼び出し側が並列化できる)。
    async _activatePlugin({ id, manifest }, indexJs) {
        try {
            if (indexJs === null) throw new Error('index.js が見つかりません');
            const blob = new Blob([indexJs], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            let mod, deactivate;
            try {
                mod = await import(url);
                const activate = mod.activate || mod.default;
                if (typeof activate === 'function') {
                    // スコープ付き API を渡す（unloadPlugin で一括解除可能にする）
                    const scopedApi = window.bookshelfAPI.forPlugin(id);
                    const result = await activate(scopedApi, manifest);
                    deactivate = (result && typeof result.deactivate === 'function')
                        ? result.deactivate
                        : (typeof mod.deactivate === 'function' ? mod.deactivate : null);
                } else {
                    console.warn(`[pluginLoader] ${id} に activate / default export がありません`);
                }
            } finally {
                URL.revokeObjectURL(url);
            }
            this.loaded.set(id, { manifest, deactivate, module: mod });
            this.failedToLoad.delete(id);
            console.log(`[pluginLoader] ${id} v${manifest.version || '?'} 読み込み完了`);
        } catch (e) {
            console.error(`[pluginLoader] ${id} 読み込み失敗:`, e);
            this.failedToLoad.set(id, e.message || String(e));
        }
    }

    /**
     * プラグインを即時アンロード。
     * - プラグイン自前の deactivate を呼ぶ（あれば）
     * - scopedApi 経由で登録された UI ボタン / イベントハンドラ / エクスポート変換を一括解除
     * - this.loaded から除外
     * - 設定からは外さない（呼び出し側が settings.enabledPlugins を更新する）
     */
    async unloadPlugin(id) {
        const entry = this.loaded.get(id);
        if (!entry) return false;
        if (typeof entry.deactivate === 'function') {
            try { await entry.deactivate(); }
            catch (e) { console.error(`[pluginLoader] ${id} deactivate 失敗:`, e); }
        }
        if (window.bookshelfAPI && typeof window.bookshelfAPI.unregisterPlugin === 'function') {
            window.bookshelfAPI.unregisterPlugin(id);
        }
        this.loaded.delete(id);
        console.log(`[pluginLoader] ${id} アンロード完了`);
        return true;
    }

    async _readPluginFile(id, filename) {
        if (!this._isReady()) return null;
        try {
            return await this.app.storage.readText(`plugins/${id}/${filename}`);
        } catch {
            return null;
        }
    }

    // ===== GitHub からインストール =====
    // 受け付ける repo URL 例:
    //   https://github.com/owner/repo                          → main / ルート
    //   https://github.com/owner/repo/tree/branch              → branch / ルート
    //   https://github.com/owner/repo/tree/branch/sub/path     → branch / sub/path
    async installFromGitHub(repoUrl) {
        const raw = this._toRawGitHubBase(repoUrl);
        if (!raw) throw new Error('GitHub の repo URL を指定してください (https://github.com/owner/repo[/tree/branch/path])');

        let manifest;
        try {
            const r = await fetch(raw + 'manifest.json');
            if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
            manifest = await r.json();
        } catch (e) {
            throw new Error(`manifest.json 取得失敗: ${e.message}`);
        }
        if (!manifest.id) throw new Error('manifest.json に "id" が必要です');

        const confirmMsg =
            `インストールしますか？\n\n` +
            `id: ${manifest.id}\n` +
            `name: ${manifest.name || '(未指定)'}\n` +
            `version: ${manifest.version || '(未指定)'}\n` +
            `publishable: ${manifest.publishable ? 'yes' : 'no'}\n\n` +
            `${manifest.description || ''}`;
        if (!confirm(confirmMsg)) return null;

        if (!this._isReady()) throw new Error('同期先が未接続です');

        // GitHub からファイル取得 → entries に集める → batch で 1 commit 書き込み
        const files = ['manifest.json', ...(manifest.files || ['index.js'])];
        const entries = [];
        for (const f of files) {
            const r = await fetch(raw + f);
            if (!r.ok) throw new Error(`${f} 取得失敗: HTTP ${r.status}`);
            const text = await r.text();
            entries.push({ op: 'put', path: `plugins/${manifest.id}/${f}`, data: text, kind: 'text' });
        }
        await this.app.storage.syncBatch(entries, {
            message: `feat(plugin): install ${manifest.id}${manifest.version ? ' v' + manifest.version : ''}`
        });

        // オプトアウト方式: 新規インストール時に disabledPlugins から除外して即時有効化
        if (!this.app.userData.settings) this.app.userData.settings = {};
        if (Array.isArray(this.app.userData.settings.disabledPlugins)) {
            this.app.userData.settings.disabledPlugins =
                this.app.userData.settings.disabledPlugins.filter(id => id !== manifest.id);
        }
        await this.app.saveUserData();

        // キャッシュ無効化 → 即読み込み
        this._installed = null;
        await this._loadPlugin({ id: manifest.id, manifest });

        return manifest;
    }

    _toRawGitHubBase(repoUrl) {
        try {
            const u = new URL(repoUrl);
            if (u.hostname !== 'github.com') return null;
            const parts = u.pathname.split('/').filter(Boolean);
            if (parts.length < 2) return null;
            const owner = parts[0];
            const repo = parts[1].replace(/\.git$/, '');
            let branch = 'main';
            let subPath = '';
            if (parts[2] === 'tree' && parts[3]) {
                branch = parts[3];
                if (parts.length > 4) subPath = parts.slice(4).join('/') + '/';
            }
            return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${subPath}`;
        } catch {
            return null;
        }
    }

    // ===== アンインストール =====
    async uninstall(pluginId) {
        if (!this._isReady()) throw new Error('同期先未接続');
        // 先に即時アンロードして UI / イベントハンドラを解除
        if (this.loaded.has(pluginId)) {
            await this.unloadPlugin(pluginId);
        }

        // plugins/<id>/ 配下の全ファイルを batch delete でまとめて消す (GitHub なら 1 commit)
        const pluginDir = `plugins/${pluginId}`;
        const filesToDelete = [];
        try {
            const files = await this.app.storage.listFiles(pluginDir);
            for (const f of files) filesToDelete.push(`${pluginDir}/${f}`);
        } catch (_) {}
        try {
            const subDirs = await this.app.storage.listDirs(pluginDir);
            for (const sub of subDirs) {
                try {
                    const subFiles = await this.app.storage.listFiles(`${pluginDir}/${sub}`);
                    for (const f of subFiles) filesToDelete.push(`${pluginDir}/${sub}/${f}`);
                } catch (_) {}
            }
        } catch (_) {}

        if (filesToDelete.length > 0) {
            const entries = filesToDelete.map(p => ({ op: 'delete', path: p }));
            await this.app.storage.syncBatch(entries, {
                message: `chore(plugin): uninstall ${pluginId}`
            });
        }

        const settings = this.app.userData?.settings || {};
        if (Array.isArray(settings.disabledPlugins)) {
            settings.disabledPlugins = settings.disabledPlugins.filter(id => id !== pluginId);
        }
        const main = this.app.userData?._storage?.main || {};
        if (Array.isArray(main.appliedPlugins)) {
            main.appliedPlugins = main.appliedPlugins.filter(id => id !== pluginId);
        }
        await this.app.saveUserData();
        this._installed = null;
    }
}

window.BookshelfPluginLoader = BookshelfPluginLoader;
