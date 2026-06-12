// bookshelf OAuth Proxy
// =======================================================================
// GitHub の OAuth Device Flow / token endpoints は CORS ヘッダを返さないため、
// SPA (bookshelf) からブラウザ経由で直接叩けない。
// この Worker は CORS ヘッダを付加して GitHub に転送するだけのシンプルな proxy。
//
// 受け付けるパス:
//   POST /login/device/code           → https://github.com/login/device/code
//   POST /login/oauth/access_token    → https://github.com/login/oauth/access_token
//
// refresh_token グラント (トークン自動更新):
//   GitHub の仕様で refresh には client_secret が必須。secret はこの Worker の
//   環境変数 (Secret) `GITHUB_CLIENT_SECRET` にのみ置き、
//   body に `grant_type=refresh_token` が含まれるリクエストに限って注入する。
//   それ以外のリクエスト (device code / device flow polling) には付けない。
//
// セキュリティ方針:
//   - 通過するリクエスト/レスポンスを保存しない (Worker のログにも残さない)
//   - body は素通し (refresh 時の client_secret 追加のみ)、Origin / Referer ヘッダは削ぐ
//   - 上記 2 パス以外は 404 を返す (任意 URL を叩く踏み台にしない)
//
// デプロイ:
//   cf-worker/ ディレクトリで `npx wrangler deploy` (wrangler.toml 参照)。
//   **デプロイ前に Secret `GITHUB_CLIENT_SECRET` の設定が必要**
//   (Dashboard → Workers → Settings → Variables and Secrets。wrangler デプロイでも保持される)。
//   発行された <name>.<account>.workers.dev を bookshelf 側の
//   GITHUB_OAUTH_PROXY_BASE に設定する。
// =======================================================================

const ALLOWED_PATHS = new Set([
    '/login/device/code',
    '/login/oauth/access_token'
]);

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Max-Age': '86400'
};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        if (!ALLOWED_PATHS.has(url.pathname)) {
            return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
        }

        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
        }

        const target = `https://github.com${url.pathname}`;

        // 転送用ヘッダ: Origin / Referer / Host は削ぐ
        const fwdHeaders = new Headers();
        const contentType = request.headers.get('Content-Type');
        if (contentType) fwdHeaders.set('Content-Type', contentType);
        const accept = request.headers.get('Accept');
        if (accept) fwdHeaders.set('Accept', accept);
        fwdHeaders.set('User-Agent', 'bookshelf-oauth-proxy/1.0');

        let body = await request.text();

        // refresh_token グラントのみ client_secret を注入
        // (クライアントは form-urlencoded で送る前提。同じ形式で追加する)
        if (url.pathname === '/login/oauth/access_token') {
            const params = new URLSearchParams(body);
            if (params.get('grant_type') === 'refresh_token') {
                if (!env || !env.GITHUB_CLIENT_SECRET) {
                    return new Response(JSON.stringify({ error: 'proxy_secret_not_configured' }), {
                        status: 500,
                        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
                    });
                }
                params.set('client_secret', env.GITHUB_CLIENT_SECRET);
                body = params.toString();
            }
        }

        let upstream;
        try {
            upstream = await fetch(target, {
                method: 'POST',
                headers: fwdHeaders,
                body
            });
        } catch (e) {
            return new Response(`Upstream fetch failed: ${e.message}`, {
                status: 502,
                headers: CORS_HEADERS
            });
        }

        const respHeaders = new Headers();
        for (const [k, v] of Object.entries(CORS_HEADERS)) respHeaders.set(k, v);
        const upstreamContentType = upstream.headers.get('Content-Type');
        if (upstreamContentType) respHeaders.set('Content-Type', upstreamContentType);

        return new Response(upstream.body, {
            status: upstream.status,
            headers: respHeaders
        });
    }
};
