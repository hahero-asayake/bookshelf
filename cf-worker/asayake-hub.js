// Asayake Hub Worker  (参考実装 / リファレンス — ADR-032, 設計書 09 §10)
// =======================================================================
// hahero 運営の共有公開先 + 私的同期 (平文) を 1 つの Worker + R2 + KV で提供する。
//
//   配信 (公開):  GET https://<handle>.<HUB_DOMAIN>/...      → R2 sites/<handle>/...  (誰でも)
//   投稿 (公開):  POST https://api.<HUB_DOMAIN>/publish      → sites/<handle>/ を置換
//   私的同期:     */PUT/DELETE/LIST https://api.<HUB_DOMAIN>/data/<path>  → data/<uid>/<path> (本人のみ・平文)
//   認証:         POST https://api.<HUB_DOMAIN>/session      → Google ID トークン検証 → ハブ公開キー発行
//
// ⚠️ 重要 (未検証):
//   - これは「API 契約と挙動」を定義するリファレンス。**本番投入前に live infra で必ず実機検証すること**。
//   - 特に Google JWT 検証・私的 API の認可・パストラバーサル防止はセキュリティの要。
//   - origin 分離前提。公開配信と私的 API はホスト名で分け、配信は data/ に到達不能。
//
// env バインディング:
//   BUCKET           R2 bucket (sites/ と data/ を格納)
//   KV               KV namespace (キー/uid/handle/通報)
//   GOOGLE_CLIENT_ID Google OAuth クライアント ID (ID トークンの aud 検証)
//   HUB_DOMAIN       例 "asayake.example" ( <handle>.asayake.example / api.asayake.example )
//   APP_ORIGIN       アプリ配信元 (CORS 許可。例 "https://hahero-asayake.github.io")
//   QUOTA_BYTES      1 ユーザの保存上限 (任意、既定 50MB)

const DEFAULT_QUOTA = 50 * 1024 * 1024;
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const RESERVED_HANDLES = new Set(['www', 'api', 'admin', 'mail', 'asayake', 'static', 'assets', 'app']);

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const host = url.hostname;
        const apiHost = `api.${env.HUB_DOMAIN}`;

        // ---- 配信 (公開): <handle>.<HUB_DOMAIN> ----
        if (host !== apiHost && host.endsWith(`.${env.HUB_DOMAIN}`)) {
            return serveSite(request, env, host.slice(0, -(env.HUB_DOMAIN.length + 1)), url);
        }
        // ---- API: api.<HUB_DOMAIN> ----
        if (host === apiHost) {
            if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env);
            try {
                if (url.pathname === '/session' && request.method === 'POST') return cors(await handleSession(request, env), env);
                if (url.pathname === '/publish' && request.method === 'POST') return cors(await handlePublish(request, env), env);
                if (url.pathname === '/data/batch' && request.method === 'POST') return cors(await handleBatch(request, env), env);
                if (url.pathname.startsWith('/data/')) return cors(await handleData(request, env, url), env);
                return cors(json({ error: 'not found' }, 404), env);
            } catch (e) {
                const status = e.status || 500;
                return cors(json({ error: e.message || 'error' }, status), env);
            }
        }
        return new Response('not found', { status: 404 });
    }
};

// ===== 公開配信 =====
async function serveSite(request, env, handle, url) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('method not allowed', { status: 405 });
    }
    const rep = await env.KV.get(`report:${handle}`, 'json');
    if (rep && rep.status === 'suspended') return new Response('This site has been suspended.', { status: 451 });

    let path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (path === '' || path.endsWith('/')) path += 'index.html';
    if (path.split('/').some(s => s === '..')) return new Response('bad path', { status: 400 });

    const obj = await env.BUCKET.get(`sites/${handle}/${path}`);
    if (!obj) return new Response('Not found', { status: 404, headers: serveHeaders('text/plain') });
    const ct = contentType(path);
    return new Response(request.method === 'HEAD' ? null : obj.body, { headers: serveHeaders(ct, obj.httpEtag) });
}

// 公開配信のセキュリティヘッダ: スクリプト無し CSP・nosniff・cookie 出さない・iframe 制限
function serveHeaders(ct, etag) {
    const h = {
        'Content-Type': ct,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'public, max-age=60'
    };
    if (etag) h['ETag'] = etag;
    return h;
}

// ===== 認証: Google ID トークン → ハブ公開キー =====
async function handleSession(request, env) {
    const { idToken } = await request.json().catch(() => ({}));
    if (!idToken) throw httpError(400, 'idToken required');
    const claims = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID);
    const uid = claims.sub;
    const email = claims.email || null;

    let rec = await env.KV.get(`uid:${uid}`, 'json');
    if (!rec) {
        const handle = await allocHandle(env, email, uid);
        rec = { handle, email, quotaBytes: Number(env.QUOTA_BYTES) || DEFAULT_QUOTA, usedBytes: 0, status: 'ok' };
        await env.KV.put(`uid:${uid}`, JSON.stringify(rec));
        await env.KV.put(`handle:${handle}`, uid);
    }
    const key = 'hk_' + crypto.randomUUID().replace(/-/g, '');
    await env.KV.put(`key:${key}`, JSON.stringify({ uid, handle: rec.handle, createdAt: Date.now() }));
    return json({ key, uid, handle: rec.handle, email, apiBase: `https://api.${env.HUB_DOMAIN}` });
}

// handle 採番: email ローカル部を DNS セーフ化 → 衝突なら数字付与
async function allocHandle(env, email, uid) {
    let base = (email ? email.split('@')[0] : 'user').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'user';
    if (RESERVED_HANDLES.has(base)) base = `u-${base}`;
    let cand = base, i = 1;
    while (await env.KV.get(`handle:${cand}`) || RESERVED_HANDLES.has(cand)) cand = `${base}-${++i}`;
    return cand;
}

// ===== 認証ヘルパ (ハブ公開キー → uid/handle) =====
async function requireAuth(request, env) {
    const auth = request.headers.get('Authorization') || '';
    const m = auth.match(/^Bearer\s+(hk_[a-f0-9]+)$/i);
    if (!m) throw httpError(401, 'missing key');
    const sess = await env.KV.get(`key:${m[1]}`, 'json');
    if (!sess) throw httpError(401, 'invalid key');
    return sess; // { uid, handle }
}

// ===== 私的同期 (data/<uid>/...) =====
async function handleData(request, env, url) {
    const sess = await requireAuth(request, env);
    const rel = safeRel(decodeURIComponent(url.pathname.slice('/data/'.length)));
    const key = `data/${sess.uid}/${rel}`;

    if (request.method === 'GET' || request.method === 'HEAD') {
        if (url.searchParams.get('list') === '1') return listDir(env, `data/${sess.uid}/`, rel);
        const obj = await env.BUCKET.get(key);
        if (!obj) return new Response(null, { status: 404 });
        return new Response(request.method === 'HEAD' ? null : obj.body, {
            status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'ETag': obj.httpEtag }
        });
    }
    if (request.method === 'PUT') {
        const body = await request.text();
        return putObject(env, sess, key, body, request.headers.get('If-Match'));
    }
    if (request.method === 'DELETE') {
        const head = await env.BUCKET.head(key);
        if (head) { await env.BUCKET.delete(key); await addUsage(env, sess.uid, -head.size); }
        return new Response(null, { status: 204 });
    }
    throw httpError(405, 'method not allowed');
}

async function putObject(env, sess, key, body, ifMatch) {
    const size = new TextEncoder().encode(body).length;
    const head = await env.BUCKET.head(key);
    if (ifMatch && (!head || head.httpEtag !== ifMatch)) throw httpError(412, 'etag mismatch');
    // quota (近似): 既存サイズを引いて新サイズを足す
    const rec = await env.KV.get(`uid:${sess.uid}`, 'json');
    const projected = (rec ? rec.usedBytes : 0) - (head ? head.size : 0) + size;
    if (rec && projected > rec.quotaBytes) throw httpError(413, 'quota exceeded');
    const putOpts = {};
    if (ifMatch) putOpts.onlyIf = { etagMatches: ifMatch };
    const res = await env.BUCKET.put(key, body, putOpts);
    if (!res) throw httpError(412, 'etag mismatch'); // onlyIf 失敗
    await addUsage(env, sess.uid, size - (head ? head.size : 0));
    return new Response(null, { status: 200, headers: { 'ETag': res.httpEtag } });
}

async function listDir(env, base, rel) {
    const prefix = base + (rel ? rel.replace(/\/?$/, '/') : '');
    const out = { files: [], dirs: [] };
    const res = await env.BUCKET.list({ prefix, delimiter: '/' });
    for (const o of res.objects) out.files.push(o.key.slice(prefix.length));
    for (const p of (res.delimitedPrefixes || [])) out.dirs.push(p.slice(prefix.length).replace(/\/$/, ''));
    return json(out);
}

// ===== バッチ (複数 put/delete を 1 リクエスト) =====
async function handleBatch(request, env) {
    const sess = await requireAuth(request, env);
    const { entries } = await request.json().catch(() => ({}));
    if (!Array.isArray(entries)) throw httpError(400, 'entries required');
    for (const e of entries) {
        const key = `data/${sess.uid}/${safeRel(e.path)}`;
        if (e.op === 'delete') {
            const head = await env.BUCKET.head(key);
            if (head) { await env.BUCKET.delete(key); await addUsage(env, sess.uid, -head.size); }
        } else if (e.op === 'put') {
            const head = await env.BUCKET.head(key);
            const size = new TextEncoder().encode(e.content || '').length;
            await env.BUCKET.put(key, e.content || '');
            await addUsage(env, sess.uid, size - (head ? head.size : 0));
        }
    }
    return new Response(null, { status: 200 });
}

// ===== 公開 (投稿): sites/<handle>/ を今回集合で置換 =====
async function handlePublish(request, env) {
    const sess = await requireAuth(request, env);
    const { files, deleteMissing } = await request.json().catch(() => ({}));
    if (!Array.isArray(files)) throw httpError(400, 'files required');
    const base = `sites/${sess.handle}/`;
    const keep = new Set();
    for (const f of files) {
        const rel = safeRel(f.path);
        keep.add(base + rel);
        await env.BUCKET.put(base + rel, f.content || '');
    }
    if (deleteMissing) {
        let cursor;
        do {
            const res = await env.BUCKET.list({ prefix: base, cursor });
            for (const o of res.objects) if (!keep.has(o.key)) await env.BUCKET.delete(o.key);
            cursor = res.truncated ? res.cursor : undefined;
        } while (cursor);
    }
    return json({ ok: true, handle: sess.handle, siteUrl: `https://${sess.handle}.${env.HUB_DOMAIN}/`, published: files.length });
}

// ===== Google ID トークン検証 (RS256, JWKS) =====
async function verifyGoogleIdToken(idToken, clientId) {
    const [h, p, s] = idToken.split('.');
    if (!h || !p || !s) throw httpError(401, 'malformed token');
    const header = JSON.parse(b64urlToText(h));
    const payload = JSON.parse(b64urlToText(p));
    if (payload.aud !== clientId) throw httpError(401, 'aud mismatch');
    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') throw httpError(401, 'iss mismatch');
    if (payload.exp * 1000 < Date.now()) throw httpError(401, 'token expired');

    const certs = await (await fetch(GOOGLE_CERTS)).json();
    const jwk = certs.keys.find(k => k.kid === header.kid);
    if (!jwk) throw httpError(401, 'signing key not found');
    const cryptoKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) throw httpError(401, 'signature invalid');
    return payload;
}

// ===== ユーティリティ =====
function safeRel(path) {
    const p = String(path || '').replace(/^\/+/, '');
    if (p.split('/').some(seg => seg === '..' || seg === '.' || seg === '')) throw httpError(400, `unsafe path: ${path}`);
    return p;
}
async function addUsage(env, uid, delta) {
    const rec = await env.KV.get(`uid:${uid}`, 'json');
    if (!rec) return;
    rec.usedBytes = Math.max(0, (rec.usedBytes || 0) + delta);
    await env.KV.put(`uid:${uid}`, JSON.stringify(rec));
}
function contentType(path) {
    if (path.endsWith('.html')) return 'text/html; charset=utf-8';
    if (path.endsWith('.css')) return 'text/css; charset=utf-8';
    if (path.endsWith('.json')) return 'application/json; charset=utf-8';
    if (path.endsWith('.svg')) return 'image/svg+xml';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    return 'application/octet-stream';
}
function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
function cors(res, env) {
    const h = new Headers(res.headers);
    h.set('Access-Control-Allow-Origin', env.APP_ORIGIN || '*');
    h.set('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, HEAD, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match');
    h.set('Access-Control-Expose-Headers', 'ETag');
    return new Response(res.body, { status: res.status, headers: h });
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function b64urlToText(s) { return new TextDecoder().decode(b64urlToBytes(s)); }
function b64urlToBytes(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}
