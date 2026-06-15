// DropboxAuth - OAuth2 PKCE + リダイレクトによる Dropbox 認証 (T08)
//
// Dropbox は public client の PKCE と refresh_token をネイティブサポート → proxy も secret も不要。
// App folder 型アプリ: 認可後はユーザの Dropbox の「アプリ/asayake-bookshelf/」配下にだけ書ける。
// access token は約 4 時間 → tokenExpiresAt を保存し、期限前 / 401 時に refresh。

// 全ユーザ共用の App key (ADR-028)。公開情報。App secret は使わない。
const DROPBOX_APP_KEY = 'jv37cvpdbjfd55y';
const DROPBOX_AUTHORIZE = 'https://www.dropbox.com/oauth2/authorize';
const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_VERIFIER_KEY = 'bookshelf_dropbox_pkce_verifier';

class DropboxAuth {
    static isConfigured() {
        return !!DROPBOX_APP_KEY && !DROPBOX_APP_KEY.startsWith('REPLACE_ME');
    }

    static _redirectUri() {
        // 現在のアプリ URL (クエリ・ハッシュ抜き)。Dropbox App の Redirect URI に登録した値と一致させる
        return location.origin + location.pathname;
    }

    // ===== PKCE =====

    static _randomVerifier() {
        const bytes = new Uint8Array(64);
        crypto.getRandomValues(bytes);
        return DropboxAuth._base64url(bytes);
    }

    static async _challenge(verifier) {
        const data = new TextEncoder().encode(verifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return DropboxAuth._base64url(new Uint8Array(digest));
    }

    static _base64url(bytes) {
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // ===== 接続フロー =====

    /** 認可ページへ遷移する (PKCE challenge を付与、verifier は sessionStorage に保持) */
    static async startConnect() {
        if (!DropboxAuth.isConfigured()) throw new Error('Dropbox の App key が未設定です');
        const verifier = DropboxAuth._randomVerifier();
        sessionStorage.setItem(DROPBOX_VERIFIER_KEY, verifier);
        const challenge = await DropboxAuth._challenge(verifier);
        const params = new URLSearchParams({
            client_id: DROPBOX_APP_KEY,
            response_type: 'code',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            token_access_type: 'offline', // refresh_token を得る
            redirect_uri: DropboxAuth._redirectUri()
        });
        location.href = `${DROPBOX_AUTHORIZE}?${params}`;
    }

    /**
     * 起動時にリダイレクト復帰 (?code=) を検知して token 交換する。
     * 交換したら URL を掃除し、method=dropbox で設定保存。
     * @returns {Promise<boolean>} 交換を行ったら true (呼び出し側はリロードする)
     */
    static async handleRedirect() {
        const url = new URL(location.href);
        const code = url.searchParams.get('code');
        const verifier = sessionStorage.getItem(DROPBOX_VERIFIER_KEY);
        if (!code || !verifier) return false;

        try {
            const body = new URLSearchParams({
                code,
                grant_type: 'authorization_code',
                client_id: DROPBOX_APP_KEY,
                code_verifier: verifier,
                redirect_uri: DropboxAuth._redirectUri()
            });
            const res = await fetch(DROPBOX_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body
            });
            if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
            const data = await res.json();
            const email = await DropboxAuth._fetchEmail(data.access_token).catch(() => null);

            const cfg = SyncConfigManager.load();
            cfg.method = 'dropbox';
            cfg.dropbox = {
                ...(cfg.dropbox || {}),
                token: data.access_token,
                refreshToken: data.refresh_token || (cfg.dropbox && cfg.dropbox.refreshToken) || '',
                tokenExpiresAt: Date.now() + (data.expires_in || 14400) * 1000,
                email
            };
            SyncConfigManager.save(cfg);
            return true;
        } finally {
            sessionStorage.removeItem(DROPBOX_VERIFIER_KEY);
            // URL から code/state を掃除
            url.searchParams.delete('code');
            url.searchParams.delete('state');
            history.replaceState(null, '', url.pathname + url.search + url.hash);
        }
    }

    static async _fetchEmail(token) {
        const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return (data.email) || (data.name && data.name.display_name) || null;
    }

    /**
     * 有効な access token を返す。失効 5 分前 or force なら refresh_token で更新。
     * 同時実行ガードあり。失敗時 Error('DROPBOX_AUTH_FAILED')。
     * DropboxAdapter の getToken として渡す。
     */
    static async ensureToken({ force = false } = {}) {
        const db = (SyncConfigManager.load().dropbox) || {};
        const valid = db.token && db.tokenExpiresAt && Date.now() < db.tokenExpiresAt - 5 * 60 * 1000;
        if (valid && !force) return db.token;
        if (!db.refreshToken) throw new Error('DROPBOX_AUTH_FAILED');
        if (DropboxAuth._refreshPromise) return DropboxAuth._refreshPromise;

        DropboxAuth._refreshPromise = (async () => {
            try {
                const body = new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: db.refreshToken,
                    client_id: DROPBOX_APP_KEY
                });
                const res = await fetch(DROPBOX_TOKEN_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body
                });
                if (!res.ok) throw new Error('refresh failed');
                const data = await res.json();
                const merged = SyncConfigManager.load();
                merged.dropbox = {
                    ...(merged.dropbox || {}),
                    token: data.access_token,
                    tokenExpiresAt: Date.now() + (data.expires_in || 14400) * 1000
                };
                // Dropbox の refresh は通常 refresh_token を返さない (回り続ける) が、返れば更新
                if (data.refresh_token) merged.dropbox.refreshToken = data.refresh_token;
                SyncConfigManager.save(merged);
                return data.access_token;
            } catch (e) {
                throw new Error('DROPBOX_AUTH_FAILED');
            } finally {
                DropboxAuth._refreshPromise = null;
            }
        })();
        return DropboxAuth._refreshPromise;
    }

    static async disconnect() {
        const db = (SyncConfigManager.load().dropbox) || {};
        if (db.token) {
            try {
                await fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${db.token}` }
                });
            } catch (_) {}
        }
        const cfg = SyncConfigManager.load();
        cfg.dropbox = { token: '', refreshToken: '', tokenExpiresAt: null, email: null };
        SyncConfigManager.save(cfg);
    }
}

window.DropboxAuth = DropboxAuth;
