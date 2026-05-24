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
// 読み込み判定:
//   userData.settings.enabledPlugins  → 起動時に activate
//   userData._storage.main.appliedPlugins → 全本棚共通で適用（読み込み判定としては enabled と同等扱い）

class BookshelfPluginLoader {
    constructor(app) {
        this.app = app;
        this.loaded = new Map();        // id → manifest
        this.failedToLoad = new Map();  // id → error message
        this._installed = null;         // キャッシュ（listInstalledPlugins）
    }

    // ===== インストール済みプラグインを列挙 =====
    async listInstalledPlugins({ refresh = false } = {}) {
        if (!refresh && this._installed) return this._installed;
        if (!this.app.obsidianDirHandle) return [];
        const handle = this.app.obsidianDirHandle;
        let pluginsDir;
        try {
            pluginsDir = await handle.getDirectoryHandle('plugins', { create: false });
        } catch (e) {
            if (e.name === 'NotFoundError') return (this._installed = []);
            throw e;
        }
        const plugins = [];
        for await (const entry of pluginsDir.values()) {
            if (entry.kind !== 'directory') continue;
            try {
                const dir = await pluginsDir.getDirectoryHandle(entry.name);
                const mh = await dir.getFileHandle('manifest.json');
                const file = await mh.getFile();
                const manifest = JSON.parse(await file.text());
                plugins.push({ id: entry.name, manifest });
            } catch (e) {
                console.warn(`[pluginLoader] "${entry.name}" の manifest.json 読み込み失敗:`, e);
            }
        }
        this._installed = plugins;
        return plugins;
    }

    // ===== 有効なプラグインを起動 =====
    async loadEnabledPlugins() {
        if (!window.bookshelfAPI) {
            console.warn('[pluginLoader] bookshelfAPI が未生成、スキップ');
            return [];
        }
        const settings = (this.app.userData && this.app.userData.settings) || {};
        const main = (this.app.userData && this.app.userData._storage && this.app.userData._storage.main) || {};
        const enabledIds = new Set([
            ...(settings.enabledPlugins || []),
            ...(main.enabledPlugins || []),
            ...(main.appliedPlugins || [])
        ]);
        if (enabledIds.size === 0) return [];
        const installed = await this.listInstalledPlugins({ refresh: true });
        const enabled = installed.filter(p => enabledIds.has(p.manifest.id || p.id));

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

        for (const p of ok) {
            await this._loadPlugin(p);
        }
        return ok;
    }

    async _loadPlugin({ id, manifest }) {
        try {
            const indexJs = await this._readPluginFile(id, 'index.js');
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
        const handle = this.app.obsidianDirHandle;
        if (!handle) return null;
        try {
            const pluginsDir = await handle.getDirectoryHandle('plugins');
            const dir = await pluginsDir.getDirectoryHandle(id);
            const fh = await dir.getFileHandle(filename);
            const file = await fh.getFile();
            return await file.text();
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

        if (!this.app.obsidianDirHandle) throw new Error('同期フォルダが未接続です');
        const pluginsDir = await this.app.obsidianDirHandle.getDirectoryHandle('plugins', { create: true });
        const pluginDir = await pluginsDir.getDirectoryHandle(manifest.id, { create: true });

        const files = ['manifest.json', ...(manifest.files || ['index.js'])];
        for (const f of files) {
            const r = await fetch(raw + f);
            if (!r.ok) throw new Error(`${f} 取得失敗: HTTP ${r.status}`);
            const text = await r.text();
            const fh = await pluginDir.getFileHandle(f, { create: true });
            const w = await fh.createWritable();
            await w.write(text);
            await w.close();
        }

        // 設定に追加して即時有効化
        if (!this.app.userData.settings) this.app.userData.settings = {};
        if (!Array.isArray(this.app.userData.settings.enabledPlugins)) this.app.userData.settings.enabledPlugins = [];
        if (!this.app.userData.settings.enabledPlugins.includes(manifest.id)) {
            this.app.userData.settings.enabledPlugins.push(manifest.id);
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
        if (!this.app.obsidianDirHandle) throw new Error('同期フォルダ未接続');
        // 先に即時アンロードして UI / イベントハンドラを解除
        if (this.loaded.has(pluginId)) {
            await this.unloadPlugin(pluginId);
        }
        const pluginsDir = await this.app.obsidianDirHandle.getDirectoryHandle('plugins');
        await pluginsDir.removeEntry(pluginId, { recursive: true });
        const settings = this.app.userData?.settings || {};
        if (Array.isArray(settings.enabledPlugins)) {
            settings.enabledPlugins = settings.enabledPlugins.filter(id => id !== pluginId);
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
