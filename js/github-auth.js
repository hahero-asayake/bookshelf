// GitHubDeviceAuth - GitHub OAuth Device Flow による認証
//
// PAT (Personal Access Token) を廃止し、OAuth でのみ認証する。
// Device Flow は callback URL 不要なので、GitHub Pages / localhost / iOS PWA
// 等あらゆる配信形態でそのまま動作する。
//
// 前提:
//   GitHub の "Settings > Developer settings > OAuth Apps" で作成した
//   OAuth App の Client ID をハードコード。Device Flow を有効化済みであること。
//   App owner は hahero。fork する場合は自分の OAuth App に置き換える必要あり。
//
// フロー:
//   1. POST https://github.com/login/device/code
//      → { device_code, user_code, verification_uri, expires_in, interval }
//   2. user_code をユーザに見せて github.com/login/device で入力させる
//   3. POST https://github.com/login/oauth/access_token を interval 秒ごとに polling
//      → authorization_pending / slow_down / access_token
//   4. access_token を受け取って保存

// GitHub App の Client ID (Settings > Developer settings > GitHub Apps > <app>)
// OAuth App ではなく **GitHub App** を使う。理由はリポジトリ単位の最小権限化:
//   - OAuth App + scope=repo はユーザの全 private repo に R/W → セキュリティ的に過大
//   - GitHub App はユーザがインストール時に対象 repo を選べる (Selected repositories)
//   - permission は Contents R/W のみ要求
const GITHUB_OAUTH_CLIENT_ID = 'Iv23lise8JM9t7EQ8nSg';
// GitHub App は OAuth scope を使わない。permission は App 側で設定する。
const GITHUB_OAUTH_SCOPE = '';
// App の公開 URL (https://github.com/apps/<app-name>)
// 未インストール時に「ここでインストール」リンクとして表示
const GITHUB_APP_PUBLIC_URL = 'https://github.com/apps/bookshelf-sync';

// GitHub の OAuth endpoints は CORS ヘッダを返さないため、
// Cloudflare Workers の薄い proxy 経由でアクセスする。
// proxy のソース: cf-worker/oauth-proxy.js
// デプロイ手順: CLAUDE.md「Cloudflare Worker (OAuth proxy) のデプロイ」参照
const GITHUB_OAUTH_PROXY_BASE = 'https://bookshelf-oauth-proxy.asayake-hahero.workers.dev';

function oauthEndpoint(path) {
    if (GITHUB_OAUTH_PROXY_BASE && !GITHUB_OAUTH_PROXY_BASE.startsWith('REPLACE_ME')) {
        return GITHUB_OAUTH_PROXY_BASE.replace(/\/+$/, '') + path;
    }
    return 'https://github.com' + path;
}

class GitHubDeviceAuth {
    static get clientId() {
        return GITHUB_OAUTH_CLIENT_ID;
    }

    static isClientIdConfigured() {
        return !!GITHUB_OAUTH_CLIENT_ID && !GITHUB_OAUTH_CLIENT_ID.startsWith('REPLACE_ME');
    }

    static isProxyConfigured() {
        return !!GITHUB_OAUTH_PROXY_BASE && !GITHUB_OAUTH_PROXY_BASE.startsWith('REPLACE_ME');
    }

    static getAppPublicUrl() {
        if (!GITHUB_APP_PUBLIC_URL || GITHUB_APP_PUBLIC_URL.startsWith('REPLACE_ME')) return null;
        return GITHUB_APP_PUBLIC_URL;
    }

    /**
     * Device Code を取得する。
     * @returns {Promise<{device_code, user_code, verification_uri, expires_in, interval}>}
     */
    static async requestDeviceCode() {
        if (!GitHubDeviceAuth.isClientIdConfigured()) {
            throw new Error('GitHub OAuth Client ID が未設定です。js/github-auth.js の GITHUB_OAUTH_CLIENT_ID を OAuth App の Client ID に置き換えてください。');
        }
        if (!GitHubDeviceAuth.isProxyConfigured()) {
            throw new Error('OAuth proxy URL が未設定です。Cloudflare Worker をデプロイし、js/github-auth.js の GITHUB_OAUTH_PROXY_BASE を Worker URL に置き換えてください。');
        }
        // GitHub App では scope は使わない (permission は App 側で固定)。
        // OAuth App の場合のみ scope を付ける (互換性のため、scope が空でなければ載せる)。
        const params = { client_id: GITHUB_OAUTH_CLIENT_ID };
        if (GITHUB_OAUTH_SCOPE) params.scope = GITHUB_OAUTH_SCOPE;
        const body = new URLSearchParams(params);
        const res = await fetch(oauthEndpoint('/login/device/code'), {
            method: 'POST',
            headers: { 'Accept': 'application/json' },
            body
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Device code request failed: ${res.status} ${res.statusText}\n${text}`);
        }
        const data = await res.json();
        if (data.error) {
            throw new Error(`Device code error: ${data.error_description || data.error}`);
        }
        return data;
    }

    /**
     * access_token を polling で取得する。
     * @param {object} deviceCodeResult requestDeviceCode の戻り値
     * @param {object} [options]
     * @param {() => boolean} [options.shouldCancel] true を返すとキャンセル (Error throw)
     * @param {(state: 'waiting' | 'slow') => void} [options.onTick] polling ごとに呼ばれる
     * @returns {Promise<{access_token, token_type, scope, refresh_token?, expires_in?, refresh_token_expires_in?}>}
     *   GitHub App で「Expire user authorization tokens」が有効な場合、
     *   refresh_token (約 6 ヶ月有効) と expires_in (8h) が含まれる。
     */
    static async pollAccessToken(deviceCodeResult, options = {}) {
        const { device_code, expires_in, interval } = deviceCodeResult;
        const { shouldCancel, onTick } = options;
        const deadline = Date.now() + (expires_in || 900) * 1000;
        let waitMs = Math.max((interval || 5), 5) * 1000;

        while (Date.now() < deadline) {
            await GitHubDeviceAuth._sleep(waitMs);
            if (shouldCancel && shouldCancel()) {
                throw new Error('AUTH_CANCELLED');
            }
            if (onTick) onTick('waiting');

            const body = new URLSearchParams({
                client_id: GITHUB_OAUTH_CLIENT_ID,
                device_code,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
            });
            const res = await fetch(oauthEndpoint('/login/oauth/access_token'), {
                method: 'POST',
                headers: { 'Accept': 'application/json' },
                body
            });

            if (!res.ok && res.status !== 400) {
                // 400 はエラー応答も含むので token endpoint は OK
                const text = await res.text().catch(() => '');
                throw new Error(`Access token request failed: ${res.status}\n${text}`);
            }

            const data = await res.json();

            if (data.access_token) {
                return data;
            }

            switch (data.error) {
                case 'authorization_pending':
                    continue;
                case 'slow_down':
                    waitMs += 5000;
                    if (onTick) onTick('slow');
                    continue;
                case 'expired_token':
                    throw new Error('AUTH_EXPIRED');
                case 'access_denied':
                    throw new Error('AUTH_DENIED');
                case 'unsupported_grant_type':
                case 'incorrect_client_credentials':
                case 'incorrect_device_code':
                case 'device_flow_disabled':
                    throw new Error(`OAuth App 設定エラー: ${data.error_description || data.error}`);
                default:
                    throw new Error(`Device flow error: ${data.error_description || data.error || 'unknown'}`);
            }
        }
        throw new Error('AUTH_EXPIRED');
    }

    /**
     * refresh_token で access_token を更新する。
     * GitHub の仕様で client_secret が必須のため、proxy (Cloudflare Worker) が
     * grant_type=refresh_token のリクエストに限り secret を注入する (ADR-021)。
     * 注意: refresh_token はローテーションする (毎回新しい ghr_ が返る) ため、
     * 戻り値の refreshToken を必ず保存し直すこと。
     * @param {string} refreshToken
     * @returns {Promise<{token, refreshToken, tokenExpiresAt, refreshTokenExpiresAt}>}
     *   ExpiresAt は絶対時刻 (ms)。失敗時は Error('AUTH_REFRESH_FAILED') を throw。
     */
    static async refreshAccessToken(refreshToken) {
        if (!refreshToken) throw new Error('AUTH_REFRESH_FAILED');
        if (!GitHubDeviceAuth.isProxyConfigured()) throw new Error('AUTH_REFRESH_FAILED');
        const body = new URLSearchParams({
            client_id: GITHUB_OAUTH_CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        });
        let data;
        try {
            const res = await fetch(oauthEndpoint('/login/oauth/access_token'), {
                method: 'POST',
                headers: { 'Accept': 'application/json' },
                body
            });
            // GitHub はエラーを HTTP 200 + { error } で返すことがある → error フィールドで判定
            data = await res.json();
        } catch (e) {
            throw new Error('AUTH_REFRESH_FAILED');
        }
        if (!data || data.error || !data.access_token) {
            throw new Error('AUTH_REFRESH_FAILED');
        }
        const now = Date.now();
        return {
            token: data.access_token,
            refreshToken: data.refresh_token || refreshToken,
            tokenExpiresAt: data.expires_in ? now + data.expires_in * 1000 : null,
            refreshTokenExpiresAt: data.refresh_token_expires_in ? now + data.refresh_token_expires_in * 1000 : null
        };
    }

    /**
     * access_token を使って認証ユーザ情報を取得する (接続確認用)。
     * @param {string} accessToken
     * @returns {Promise<{login, name, avatar_url}>}
     */
    static async fetchUser(accessToken) {
        const res = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });
        if (res.status === 401) throw new Error('OAuth token が無効です');
        if (!res.ok) throw new Error(`GitHub /user failed: ${res.status}`);
        return await res.json();
    }

    static _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
}

window.GitHubDeviceAuth = GitHubDeviceAuth;
