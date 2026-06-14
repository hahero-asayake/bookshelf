// Asayake Hub Worker  (参考実装 / リファレンス — ADR-032, 設計書 09 §10)
// =======================================================================
// hahero 運営の共有公開先 + 私的同期 (平文) を 1 つの Worker + R2 + KV で提供する。
// **単一ドメイン・パス分離** (origin 分離はしない。ADR-032 改訂 2026-06-14)。
//
//   配信 (公開):  GET  https://<HUB_DOMAIN>/public/<siteId>/...  → R2 sites/<siteId>/...  (誰でも・CSP)
//   投稿 (公開):  POST https://<HUB_DOMAIN>/publish              → sites/<siteId>/ を置換
//   私的同期:     GET/PUT/DELETE https://<HUB_DOMAIN>/data/<path> → data/<uid>/<path> (本人のみ・平文)
//   認証:         POST https://<HUB_DOMAIN>/session             → Google ID トークン検証 → ハブ公開キー発行
//
// 同一ドメインで安全な根拠 (この 4 不変条件を保つこと):
//   (1) ハブのドメインはアプリ配信元 (github.io) と別 → 公開ページはアプリと別 origin。
//   (2) 認証は Authorization: Bearer (cookie を使わない) → 公開ページに渡る ambient セッションが無い。
//   (3) /public は CSP `script-src 'none'` → 公開ページで JS が動かない (API を叩けない)。
//   (4) 私的データは /data の認証必須経路のみ。/public からは到達不能。
//   → JS を吐くスタイルを将来許可するなら、この前提が崩れるので origin 分離 or 厳格サニタイズを再検討。
//
// ⚠️ 未検証: API 契約と挙動の定義。**本番投入前に live infra で必ず実機検証**。
//   特に Google JWT 検証・私的 API の認可・パストラバーサル防止はセキュリティの要。
//
// env バインディング:
//   BUCKET           R2 bucket (sites/ と data/ を格納)
//   KV               KV namespace (キー/uid/通報)
//   GOOGLE_CLIENT_ID Google OAuth クライアント ID (ID トークンの aud 検証)
//   HUB_DOMAIN       ハブの単一ホスト名 (例 "asayake.app")。公開 URL の組立に使う
//   APP_ORIGIN       アプリ配信元 (CORS 許可。例 "https://hahero-asayake.github.io")
//   QUOTA_BYTES      1 ユーザの保存上限 (任意、既定 100MB = Free プラン。Plus は uid レコードで個別に引き上げ)
//   WRITE_LIMITER    (任意) ratelimit バインディング。書込 (PUT/DELETE/batch/publish) を uid/キー単位で制限
//                    し、Class A 書込暴走による課金事故を防ぐ (ADR-033)。未設定なら制限なし (本番では必須)。
//
// コスト防御 (ADR-033, 収益化分析):
//   ① Class A 書込暴走 → WRITE_LIMITER で書込系を Bearer キー単位にレート制限 (KV/R2 参照前に弾く)。
//   ② 公開 Class B 読取テール → /public を Cache API (caches.default) でキャッシュし R2 読取を間引く。

const DEFAULT_QUOTA = 100 * 1024 * 1024;  // Free プラン = 100MB (収益化設計 ADR-033)
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 公開配信 (認証不要・同一ホストの GET)。Cache API で R2 読取 (Class B) を間引く
        if (path.startsWith('/public/')) return serveSite(request, env, path, ctx);

        // API (アプリは別 origin なので CORS 付与)
        if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env, request);
        try {
            if (path === '/session' && request.method === 'POST') return cors(await handleSession(request, env), env, request);
            if (path === '/usage' && request.method === 'GET') return cors(await handleUsage(request, env), env, request);
            if (path === '/publish' && request.method === 'POST') return cors(await handlePublish(request, env), env, request);
            if (path === '/data/batch' && request.method === 'POST') return cors(await handleBatch(request, env), env, request);
            if (path.startsWith('/data/')) return cors(await handleData(request, env, url), env, request);
            return cors(json({ error: 'not found' }, 404), env, request);
        } catch (e) {
            return cors(json({ error: e.message || 'error' }, e.status || 500), env, request);
        }
    }
};

// ===== 公開配信: /public/<siteId>/<rest> → R2 sites/<siteId>/<rest> =====
// Cache API (caches.default) を前段に置き、ヒット時は R2 / KV を一切叩かない。
// Class B (R2 読取) のテール課金を抑える主防御 (ADR-033)。キャッシュは max-age=60。
// ※ ヒット中は通報停止 (report:suspended) の反映が最大 60 秒遅れる (許容)。
async function serveSite(request, env, pathname, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('method not allowed', { status: 405 });
    }
    const cache = caches.default;
    // HEAD も GET としてキャッシュ照合 (本文は呼び出し側で捨てる)。クエリ無し URL をキーに正規化
    const cacheKey = new Request(new URL(request.url).origin + pathname, { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) {
        return request.method === 'HEAD'
            ? new Response(null, { status: cached.status, headers: cached.headers })
            : cached;
    }

    const rest = decodeURIComponent(pathname.slice('/public/'.length));
    const slash = rest.indexOf('/');
    const siteId = slash < 0 ? rest : rest.slice(0, slash);
    let sub = slash < 0 ? '' : rest.slice(slash + 1);
    if (!siteId || siteId.split('/').some(s => s === '..')) return new Response('bad path', { status: 400 });
    if (sub === '' || sub.endsWith('/')) sub += 'index.html';
    if (sub.split('/').some(s => s === '..')) return new Response('bad path', { status: 400 });

    const rep = await env.KV.get(`report:${siteId}`, 'json');
    if (rep && rep.status === 'suspended') return new Response('This site has been suspended.', { status: 451 });

    const obj = await env.BUCKET.get(`sites/${siteId}/${sub}`);
    if (!obj) return new Response('Not found', { status: 404, headers: serveHeaders('text/plain') });
    const res = new Response(obj.body, { headers: serveHeaders(contentType(sub), obj.httpEtag) });
    // 200 のみキャッシュ (404/451 はしない)。waitUntil でレスポンスを遅らせない
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
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
        // 公開 URL は不透明な siteId (uuid)。本名/メール/Google sub を URL に晒さない
        const siteId = crypto.randomUUID();
        // plan='free' が既定。Plus 化は uid レコードの plan/quotaBytes を引き上げるだけ (アプリ再実装不要)
        rec = { siteId, email, plan: 'free', quotaBytes: Number(env.QUOTA_BYTES) || DEFAULT_QUOTA, usedBytes: 0, status: 'ok' };
        await env.KV.put(`uid:${uid}`, JSON.stringify(rec));
    }
    const key = 'hk_' + crypto.randomUUID().replace(/-/g, '');
    await env.KV.put(`key:${key}`, JSON.stringify({ uid, siteId: rec.siteId, createdAt: Date.now() }));
    return json({
        key, uid, siteId: rec.siteId, email,
        plan: rec.plan || 'free', quotaBytes: rec.quotaBytes, usedBytes: rec.usedBytes || 0,
        apiBase: `https://${env.HUB_DOMAIN}`,
        publicBase: `https://${env.HUB_DOMAIN}/public/${rec.siteId}/`
    });
}

// ===== 使用量照会 (認証必須): プラン/quota/used を返す。UI の使用量バー更新用 =====
async function handleUsage(request, env) {
    const sess = await requireAuth(request, env);
    const rec = await env.KV.get(`uid:${sess.uid}`, 'json');
    if (!rec) throw httpError(404, 'no account');
    return json({
        plan: rec.plan || 'free',
        quotaBytes: rec.quotaBytes || DEFAULT_QUOTA,
        usedBytes: rec.usedBytes || 0,
        siteId: rec.siteId,
        publicBase: `https://${env.HUB_DOMAIN}/public/${rec.siteId}/`
    });
}

// ===== 認証ヘルパ (ハブ公開キー → uid/siteId) =====
async function requireAuth(request, env) {
    const auth = request.headers.get('Authorization') || '';
    const m = auth.match(/^Bearer\s+(hk_[a-f0-9]+)$/i);
    if (!m) throw httpError(401, 'missing key');
    const sess = await env.KV.get(`key:${m[1]}`, 'json');
    if (!sess) throw httpError(401, 'invalid key');
    return sess; // { uid, siteId }
}

// ===== 書込レート制限 (Class A 書込暴走対策, ADR-033) =====
// Bearer キー (無ければ IP) 単位で制限し、KV/R2 を叩く前に弾く。
// WRITE_LIMITER 未設定なら何もしない (本番では必ず ratelimit バインディングを設定すること)。
async function enforceWriteLimit(request, env) {
    if (!env.WRITE_LIMITER || typeof env.WRITE_LIMITER.limit !== 'function') return;
    const auth = request.headers.get('Authorization') || '';
    const m = auth.match(/^Bearer\s+(hk_[a-f0-9]+)$/i);
    const limitKey = m ? m[1] : (request.headers.get('CF-Connecting-IP') || 'anon');
    const { success } = await env.WRITE_LIMITER.limit({ key: limitKey });
    if (!success) throw httpError(429, 'rate limit exceeded (slow down)');
}

// ===== 私的同期 (data/<uid>/...) — uid スコープ。URL の siteId とは無関係 =====
async function handleData(request, env, url) {
    // 書込系 (PUT/DELETE) は認証・R2 参照の前にレート制限で弾く
    if (request.method === 'PUT' || request.method === 'DELETE') await enforceWriteLimit(request, env);
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
        return putObject(env, sess, key, await request.text(), request.headers.get('If-Match'));
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
    // クライアントの If-Match は HTTP 標準どおりクォート付き ("abc")。R2 の etag / onlyIf.etagMatches は
    // クォート無し (abc) を要求するため正規化する (W/ 弱 ETag 接頭辞も除去)。
    const wantEtag = ifMatch ? ifMatch.replace(/^W\//, '').replace(/^"(.*)"$/, '$1') : null;
    if (wantEtag && (!head || head.etag !== wantEtag)) throw httpError(412, 'etag mismatch');
    const rec = await env.KV.get(`uid:${sess.uid}`, 'json');
    const projected = (rec ? rec.usedBytes : 0) - (head ? head.size : 0) + size;
    if (rec && projected > rec.quotaBytes) throw httpError(413, 'quota exceeded');
    const putOpts = {};
    if (wantEtag) putOpts.onlyIf = { etagMatches: wantEtag };
    const res = await env.BUCKET.put(key, body, putOpts);
    if (!res) throw httpError(412, 'etag mismatch'); // onlyIf 失敗 (TOCTOU)
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
    await enforceWriteLimit(request, env);
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

// ===== 公開 (投稿): sites/<siteId>/ を今回集合で置換 =====
async function handlePublish(request, env) {
    await enforceWriteLimit(request, env);
    const sess = await requireAuth(request, env);
    const { files, deleteMissing } = await request.json().catch(() => ({}));
    if (!Array.isArray(files)) throw httpError(400, 'files required');
    const base = `sites/${sess.siteId}/`;
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
    return json({ ok: true, siteId: sess.siteId, siteUrl: `https://${env.HUB_DOMAIN}/public/${sess.siteId}/`, published: files.length });
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
// APP_ORIGIN はカンマ区切りの許可リスト (移行中は github.io と asayake.org を併記)。
// リクエストの Origin が許可リストにあればそれを echo、無ければ先頭。
function cors(res, env, request) {
    const allow = String(env.APP_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean);
    const origin = request && request.headers.get('Origin');
    const allowed = allow.includes('*') ? '*' : (origin && allow.includes(origin) ? origin : (allow[0] || '*'));
    const h = new Headers(res.headers);
    h.set('Access-Control-Allow-Origin', allowed);
    h.set('Vary', 'Origin');
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
