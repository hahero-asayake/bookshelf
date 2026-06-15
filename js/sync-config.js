// SyncConfigManager - 同期方式 (local / github / ...) の設定保管と adapter 構築
//
// 保管先: LocalStorage (`bookshelf_sync` キー)
//   - PAT を含むため vault には保存しない
//   - 端末ごとに再入力が必要 (許容)
//
// 設定形式:
//   {
//     method: 'local' | 'github' | 'hub',
//     github: { owner, repo, branch, basePath, token, login,
//               refreshToken,           // ghr_… (約6ヶ月有効・refresh ごとにローテーション)
//               tokenExpiresAt,         // access_token の失効時刻 (絶対時刻 ms)
//               refreshTokenExpiresAt   // refresh_token の失効時刻 (絶対時刻 ms)
//             },
//     hub: { ... }
//   }
//   refresh 系フィールドは旧接続には無い (後方互換: 無ければ refresh せず 401 時に再接続誘導)
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
            // Asayake ハブ (hahero 運営・平文私的同期 + 共有公開, ADR-032/033)。
            // key=ハブ公開キー hk_ / siteId=公開サイト ID / plan=free|plus / quota・used はバイト (使用量バー用キャッシュ)
            hub: { apiBase: '', key: '', uid: '', siteId: '', handle: '', email: null,
                   plan: 'free', quotaBytes: 0, usedBytes: 0, publicBase: '' },
            // 公開先 (T09 / ADR-033)。target='github'(自分の repo) | 'hub'(共有ハブ)。
            // owner 未設定なら GitHub login にフォールバック
            publish: { target: 'github', owner: '', repo: 'bookshelf-public', branch: 'main' }
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
            case 'hub':
                return SyncConfigManager._buildHub(config.hub);
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

    // Asayake ハブ (ADR-032/033)。apiBase + ハブ公開キーが揃って初めて構築。
    // getKey は都度 config を読み直す (再発行/更新が反映されるように)。認証は HubAuth が担う。
    static _buildHub(hub) {
        if (!hub || !hub.apiBase || !hub.key) {
            return null; // 未接続 → 呼び出し側で local フォールバック
        }
        return new HubStorageAdapter({
            apiBase: hub.apiBase,
            getKey: () => (SyncConfigManager.load().hub || {}).key || ''
        });
    }
}

window.SyncConfigManager = SyncConfigManager;
