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
// セキュリティ方針:
//   - 通過するリクエスト/レスポンスを保存しない (Worker のログにも残さない)
//   - body は素通し、Origin / Referer ヘッダは削ぐ
//   - 上記 2 パス以外は 404 を返す (任意 URL を叩く踏み台にしない)
//
// デプロイ:
//   Cloudflare Dashboard → Workers & Pages → Create Worker → このファイルを貼付 → Deploy
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
    async fetch(request) {
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

        const body = await request.text();

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
