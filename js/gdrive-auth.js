// GoogleDriveAuth - Google Identity Services (GIS) token model による認証 (T07)
//
// scope は drive.file のみ (非センシティブ → Google の審査不要、テストモードの 7 日失効も回避)。
// access token は約 1 時間。期限切れは requestAccessToken({prompt:''}) でサイレント再取得。
// client_secret 不要 (token model は public client)。Client ID は定数 (公開情報)。
//
// トークンと expiry、bookshelf-data フォルダの fileId は bookshelf_sync.googleDrive に保存。

// 全ユーザ共用の OAuth Client ID (ホスト型マルチユーザ、ADR-028)。公開情報。
const GDRIVE_CLIENT_ID = '71180460551-i3tltloc3sl2oej2avi748ns2qmm6cvd.apps.googleusercontent.com';
const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GDRIVE_ROOT_FOLDER_NAME = 'bookshelf-data';

class GoogleDriveAuth {
    static isClientIdConfigured() {
        return !!GDRIVE_CLIENT_ID && !GDRIVE_CLIENT_ID.startsWith('REPLACE_ME');
    }

    // GIS スクリプトを遅延ロード (Drive 選択時のみ)
    static async _loadGis() {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) return;
        if (!GoogleDriveAuth._gisPromise) {
            GoogleDriveAuth._gisPromise = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = GIS_SRC;
                s.async = true;
                s.defer = true;
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('GIS スクリプトの読み込みに失敗しました'));
                document.head.appendChild(s);
            });
        }
        await GoogleDriveAuth._gisPromise;
    }

    static async _ensureTokenClient() {
        await GoogleDriveAuth._loadGis();
        if (!GoogleDriveAuth._tokenClient) {
            GoogleDriveAuth._tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: GDRIVE_CLIENT_ID,
                scope: GDRIVE_SCOPE,
                callback: () => {} // requestToken で都度差し替える
            });
        }
        return GoogleDriveAuth._tokenClient;
    }

    // access token を取得 (prompt 指定)。consent='' でサイレント、'consent' で同意ポップアップ
    static _requestToken(prompt) {
        return new Promise(async (resolve, reject) => {
            const client = await GoogleDriveAuth._ensureTokenClient();
            client.callback = (resp) => {
                if (resp.error) { reject(new Error(resp.error)); return; }
                resolve(resp); // { access_token, expires_in, ... }
            };
            try {
                client.requestAccessToken({ prompt });
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * 初回接続: 同意ポップアップ → token 取得 → bookshelf-data フォルダを用意 → 設定保存。
     * @returns {Promise<{rootFolderId, email}>}
     */
    static async connect() {
        if (!GoogleDriveAuth.isClientIdConfigured()) {
            throw new Error('Google Drive の Client ID が未設定です');
        }
        const resp = await GoogleDriveAuth._requestToken('consent');
        const token = resp.access_token;
        const expiresAt = Date.now() + (resp.expires_in || 3600) * 1000;
        const rootFolderId = await GoogleDriveAuth._ensureRootFolder(token);
        const email = await GoogleDriveAuth._fetchEmail(token).catch(() => null);

        const cfg = SyncConfigManager.load();
        cfg.googleDrive = { ...(cfg.googleDrive || {}), token, tokenExpiresAt: expiresAt, rootFolderId, email };
        SyncConfigManager.save(cfg);
        return { rootFolderId, email };
    }

    // bookshelf-data フォルダの fileId を取得 (無ければ作成)
    static async _ensureRootFolder(token) {
        const headers = { 'Authorization': `Bearer ${token}` };
        const q = `name='${GDRIVE_ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const params = new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '1' });
        const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers });
        if (listRes.ok) {
            const data = await listRes.json();
            if (data.files && data.files[0]) return data.files[0].id;
        }
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: GDRIVE_ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
        });
        if (!createRes.ok) throw new Error('bookshelf-data フォルダの作成に失敗しました');
        return (await createRes.json()).id;
    }

    static async _fetchEmail(token) {
        const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.user && data.user.emailAddress;
    }

    /**
     * 有効な access token を返す。失効 5 分前ならサイレント再取得。
     * 同時実行ガードあり。失敗時は Error('GDRIVE_AUTH_FAILED')。
     * GoogleDriveAdapter の getToken として渡す。
     * @param {object} [opts]
     * @param {boolean} [opts.force] 強制再取得 (401 リトライ用)
     */
    static async ensureToken({ force = false } = {}) {
        const gd = (SyncConfigManager.load().googleDrive) || {};
        const valid = gd.token && gd.tokenExpiresAt && Date.now() < gd.tokenExpiresAt - 5 * 60 * 1000;
        if (valid && !force) return gd.token;
        if (GoogleDriveAuth._refreshPromise) return GoogleDriveAuth._refreshPromise;

        GoogleDriveAuth._refreshPromise = (async () => {
            try {
                const resp = await GoogleDriveAuth._requestToken(''); // サイレント
                const merged = SyncConfigManager.load();
                merged.googleDrive = {
                    ...(merged.googleDrive || {}),
                    token: resp.access_token,
                    tokenExpiresAt: Date.now() + (resp.expires_in || 3600) * 1000
                };
                SyncConfigManager.save(merged);
                return resp.access_token;
            } catch (e) {
                throw new Error('GDRIVE_AUTH_FAILED');
            } finally {
                GoogleDriveAuth._refreshPromise = null;
            }
        })();
        return GoogleDriveAuth._refreshPromise;
    }

    static disconnect() {
        const cfg = SyncConfigManager.load();
        if (cfg.googleDrive) {
            cfg.googleDrive = { ...cfg.googleDrive, token: '', tokenExpiresAt: null };
        }
        SyncConfigManager.save(cfg);
    }
}

window.GoogleDriveAuth = GoogleDriveAuth;
