// SyncConfigManager - 同期方式 (local / github / ...) の設定保管と adapter 構築
//
// 保管先: LocalStorage (`bookshelf_sync` キー)
//   - PAT を含むため vault には保存しない
//   - 端末ごとに再入力が必要 (許容)
//
// 設定形式:
//   {
//     method: 'local' | 'github' | 'google-drive' | 'dropbox',
//     github: { owner, repo, branch, basePath, token },
//     googleDrive: { ... },
//     dropbox: { ... }
//   }
//
// 利用方法:
//   const config = SyncConfigManager.load();
//   const adapter = SyncConfigManager.buildAdapter(config);  // null なら local + handle 未復元
//   const storage = new BookshelfStorage(adapter);

const SYNC_CONFIG_KEY = 'bookshelf_sync';

class SyncConfigManager {
    static load() {
        const raw = localStorage.getItem(SYNC_CONFIG_KEY);
        if (!raw) return SyncConfigManager.defaults();
        try {
            const parsed = JSON.parse(raw);
            return { ...SyncConfigManager.defaults(), ...parsed };
        } catch (e) {
            console.warn('SyncConfigManager: failed to parse config, using defaults', e);
            return SyncConfigManager.defaults();
        }
    }

    static save(config) {
        localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    }

    static clear() {
        localStorage.removeItem(SYNC_CONFIG_KEY);
    }

    static defaults() {
        return {
            method: 'local',
            github: { owner: '', repo: '', branch: 'main', basePath: '', token: '' },
            googleDrive: {},
            dropbox: {}
        };
    }

    /**
     * 設定から adapter を構築。
     * - method='local'  → LocalFSAdapter (handle は別途 setDirHandle で渡す)
     * - method='github' → GitHubAdapter (config 不正なら null)
     * @param {object} config
     * @returns {StorageAdapter|null}
     */
    static buildAdapter(config) {
        if (!config) config = SyncConfigManager.load();
        switch (config.method) {
            case 'github':
                return SyncConfigManager._buildGitHub(config.github);
            case 'google-drive':
            case 'dropbox':
                console.warn(`SyncConfigManager: ${config.method} is not implemented yet, falling back to local`);
                return new LocalFSAdapter();
            case 'local':
            default:
                return new LocalFSAdapter();
        }
    }

    static _buildGitHub(github) {
        if (!github || !github.owner || !github.repo || !github.token) {
            return null;
        }
        return new GitHubAdapter({
            owner: github.owner,
            repo: github.repo,
            branch: github.branch || 'main',
            basePath: github.basePath || '',
            token: github.token
        });
    }
}

window.SyncConfigManager = SyncConfigManager;
