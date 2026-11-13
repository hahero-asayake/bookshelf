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
// 保存先との衝突中の印 (3択でまだ「再読込」を選んでいない。イシュー#616)
const SYNC_CONFLICT_KEY = 'virtualBookshelf_syncConflict';

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
        const before = SyncConfigManager.isConfigured() ? SyncConfigManager.destinationKey(SyncConfigManager.load()) : null;
        localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
        // 保存先を切り替えたら、前の保存先との衝突中の印は外す (端末内の編集と pendingSync はそのまま新しい保存先へ送る・イシュー#616)
        if (before !== SyncConfigManager.destinationKey(config)) SyncConfigManager.clearConflict();
    }

    static clear() {
        localStorage.removeItem(SYNC_CONFIG_KEY);
        SyncConfigManager.clearConflict();
    }

    /** 保存先を見分ける鍵 (方式＋つなぎ先)。トークンの更新などでは変わらない (イシュー#616) */
    static destinationKey(config) {
        const c = config || {};
        if (c.method === 'github') { const g = c.github || {}; return ['github', g.owner, g.repo, g.branch, g.basePath].join('|'); }
        if (c.method === 'hub') { const h = c.hub || {}; return ['hub', h.apiBase, h.uid].join('|'); }
        return String(c.method || 'local');
    }

    /** 保存先との衝突中の印を残す。3択で「再読込」を選ぶまで (または保存先を切り替えるまで) 送らない (イシュー#616) */
    static markConflict() {
        try { localStorage.setItem(SYNC_CONFLICT_KEY, JSON.stringify({ dest: SyncConfigManager.destinationKey(SyncConfigManager.load()), at: Date.now() })); } catch (e) {}
    }

    /** いまの保存先との衝突中の印 ({dest, at})。無い・別の保存先 (切り替えた・退会して作り直した) なら null */
    static conflict() {
        let mark = null;
        try { mark = JSON.parse(localStorage.getItem(SYNC_CONFLICT_KEY) || 'null'); } catch (e) { mark = null; }
        if (!mark) return null;
        if (mark.dest !== SyncConfigManager.destinationKey(SyncConfigManager.load())) { SyncConfigManager.clearConflict(); return null; }
        return mark;
    }

    static clearConflict() {
        try { localStorage.removeItem(SYNC_CONFLICT_KEY); } catch (e) {}
    }

    /** 保存先を一度でも自分で決めた (保存した) ことがあるか。未設定なら UI はハブ推し表示にする (ADR-056)。
     *  3方式とも、つないだ時に method を保存して記録する (ローカルはフォルダを選んだ時・起動時に保存済みのフォルダが見つかった時。イシュー#592) */
    static isConfigured() {
        return !!localStorage.getItem(SYNC_CONFIG_KEY);
    }

    /** 保存先の方式 (method) だけを書き換えて保存する。接続情報など他のフィールドはそのまま残す。
     * @param {'local'|'github'|'hub'} method */
    static setMethod(method) {
        SyncConfigManager.save({ ...SyncConfigManager.load(), method });
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
            // owner 未設定なら GitHub login にフォールバック。既定=ハブ (かんたん公開・ADR-056)
            publish: { target: 'hub', owner: '', repo: 'bookshelf-public', branch: 'main' }
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
