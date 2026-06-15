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
//   OPERATOR_AFFILIATE_TAG (任意) ハブ公開ページの Amazon アフィタグ (Free / 解決不能時)。/go が解決して使う。
//                    空なら Free 公開は無印リンク (誤ったタグへの送客を防ぐ)。タグ正本はここで一元管理 (ADR-034追補)。
//   --- 課金 (Stripe, ADR-035。未設定なら課金系は 503 を返し無効化) ---
//   STRIPE_SECRET_KEY      (secret) Stripe シークレットキー (sk_…)。Checkout / Portal セッション作成に使う。
//   STRIPE_WEBHOOK_SECRET  (secret) Webhook 署名シークレット (whsec_…)。/billing/webhook の署名検証。
//   STRIPE_PRICE_MONTHLY   (var)    月額プランの Price ID (price_…)。
//   STRIPE_PRICE_YEARLY    (var)    年額プランの Price ID (price_…)。
//   STRIPE_API_VERSION     (任意)   Checkout を叩く Stripe バージョン。既定 = Managed Payments のプレビュー版
//                    (2026-02-25.preview, ADR-037)。Stripe が版を上げたらここで追従。Webhook 側も同版にする。
//   PLUS_QUOTA_BYTES       (var)    Plus プランの保存上限 (既定 3GB)。Checkout 完了で uid レコードを引き上げる。
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

        // アフィリンク・リダイレクタ (認証不要・公開ページからクリックされる)。クリック時にタグを解決
        if (path.startsWith('/go/')) return handleGo(request, env, path);

        // Stripe Webhook (サーバ間・署名検証。CORS 不要。アプリ origin 制限の外なので個別処理)
        if (path === '/billing/webhook' && request.method === 'POST') return handleStripeWebhook(request, env);

        // API (アプリは別 origin なので CORS 付与)
        if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env, request);
        try {
            if (path === '/session' && request.method === 'POST') return cors(await handleSession(request, env), env, request);
            if (path === '/usage' && request.method === 'GET') return cors(await handleUsage(request, env), env, request);
            if (path === '/publish' && request.method === 'POST') return cors(await handlePublish(request, env), env, request);
            if (path === '/data/batch' && request.method === 'POST') return cors(await handleBatch(request, env), env, request);
            if (path === '/account' && request.method === 'DELETE') return cors(await handleAccountDelete(request, env), env, request);
            if (path === '/billing/checkout' && request.method === 'POST') return cors(await handleCheckout(request, env), env, request);
            if (path === '/billing/portal' && request.method === 'POST') return cors(await handleBillingPortal(request, env), env, request);
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

// ===== アフィリンク・リダイレクタ: /go/<siteId>/<asin> → Amazon (タグ解決) =====
// 公開ページの Amazon リンクをタグ焼き込みではなくこのリダイレクタ経由にする (ADR-034追補)。
// クリック時に「現在の」プラン/タグを解決して 302 するため、Plus→Free 降格でも再公開不要で
// 運営タグへ即切替でき、静的キャッシュとも両立する (タグ正本は env = ハブ側で一元管理)。
//   Free / 解決不能 … env.OPERATOR_AFFILIATE_TAG (空なら無印)
//   Plus            … uid レコードの affiliateTag (本人が公開時に送る。空なら無印)
async function handleGo(request, env, pathname) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    const rest = decodeURIComponent(pathname.slice('/go/'.length));
    const slash = rest.indexOf('/');
    const siteId = slash < 0 ? '' : rest.slice(0, slash);
    const asin = slash < 0 ? rest : rest.slice(slash + 1);
    // ASIN は英数字 (10桁前後)。安全な文字種だけ許可し、オープンリダイレクトを構造的に防ぐ
    if (!siteId || !/^[A-Za-z0-9]{8,14}$/.test(asin)) return new Response('bad path', { status: 400 });

    let tag = env.OPERATOR_AFFILIATE_TAG || '';      // 既定 = 運営タグ (Free / 解決不能時)
    const uid = await env.KV.get(`site:${siteId}`);
    if (uid) {
        const planRec = await getPlan(env, uid);
        if (planRec && planRec.plan === 'plus') {     // Plus は本人タグ (uid レコード。空なら無印)
            const rec = await env.KV.get(`uid:${uid}`, 'json');
            tag = (rec && rec.affiliateTag) || '';
        }
    }
    const dest = `https://www.amazon.co.jp/dp/${asin}` + (tag ? `?tag=${encodeURIComponent(tag)}` : '');
    return new Response(null, {
        status: 302,
        headers: {
            'Location': dest,
            // プラン変更に追従させるためキャッシュさせない (クリックは低頻度・コスト無視可)
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer'
        }
    });
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

    // KV は read-modify-write の last-writer-wins (CAS 無し)。同一キーを頻繁な書き手 (addUsage) と
    // 課金書き手 (setPlan) が共有すると相互クロバーするため、レコードを 3 キーに分離する (ADR-035 競合対策):
    //   uid:<uid>   identity + affiliateTag   (session で作成 / handlePublish が affiliateTag)
    //   plan:<uid>  課金 plan/quota/stripe    (session で作成 / setPlan のみ)
    //   usage:<uid> 使用量バイト数            (session で作成 / addUsage のみ)
    let rec = await env.KV.get(`uid:${uid}`, 'json');
    if (!rec) {
        // 公開 URL は不透明な siteId (uuid)。本名/メール/Google sub を URL に晒さない
        const siteId = crypto.randomUUID();
        rec = { siteId, email, status: 'ok' };
        await env.KV.put(`uid:${uid}`, JSON.stringify(rec));
        // plan='free' が既定。Plus 化は plan:<uid> の plan/quotaBytes を引き上げるだけ (アプリ再実装不要)
        await env.KV.put(`plan:${uid}`, JSON.stringify({ plan: 'free', quotaBytes: Number(env.QUOTA_BYTES) || DEFAULT_QUOTA }));
        await env.KV.put(`usage:${uid}`, '0');
    }
    // siteId → uid の逆引き (/go リダイレクタが利用)。新規/既存とも冪等に張る (既存アカウントの backfill 兼)
    await env.KV.put(`site:${rec.siteId}`, uid);
    const key = 'hk_' + crypto.randomUUID().replace(/-/g, '');
    await env.KV.put(`key:${key}`, JSON.stringify({ uid, siteId: rec.siteId, createdAt: Date.now() }));
    const planRec = await getPlan(env, uid);
    return json({
        key, uid, siteId: rec.siteId, email,
        plan: planRec.plan, quotaBytes: planRec.quotaBytes, usedBytes: await getUsed(env, uid),
        apiBase: `https://${env.HUB_DOMAIN}`,
        publicBase: `https://${env.HUB_DOMAIN}/public/${rec.siteId}/`
    });
}

// 課金レコード plan:<uid> を返す (旧形式=uid レコードに plan/quota を持つ場合は遅延フォールバック)。
async function getPlan(env, uid) {
    const p = await env.KV.get(`plan:${uid}`, 'json');
    if (p) return { plan: p.plan || 'free', quotaBytes: p.quotaBytes || (Number(env.QUOTA_BYTES) || DEFAULT_QUOTA),
                    stripeCustomerId: p.stripeCustomerId, stripeSubscriptionId: p.stripeSubscriptionId };
    const rec = await env.KV.get(`uid:${uid}`, 'json');
    if (!rec) return { plan: 'free', quotaBytes: Number(env.QUOTA_BYTES) || DEFAULT_QUOTA };
    return { plan: rec.plan || 'free', quotaBytes: rec.quotaBytes || (Number(env.QUOTA_BYTES) || DEFAULT_QUOTA),
             stripeCustomerId: rec.stripeCustomerId, stripeSubscriptionId: rec.stripeSubscriptionId };
}

// 使用量バイト数を返す (旧形式=uid レコードに usedBytes を持つ場合は遅延フォールバック)。
async function getUsed(env, uid) {
    const v = await env.KV.get(`usage:${uid}`);
    if (v != null) return Number(v) || 0;
    const rec = await env.KV.get(`uid:${uid}`, 'json');
    return rec ? (rec.usedBytes || 0) : 0;
}

// ===== 使用量照会 (認証必須): プラン/quota/used を返す。UI の使用量バー更新用 =====
async function handleUsage(request, env) {
    const sess = await requireAuth(request, env);
    const rec = await env.KV.get(`uid:${sess.uid}`, 'json');
    if (!rec) throw httpError(404, 'no account');
    const planRec = await getPlan(env, sess.uid);
    return json({
        plan: planRec.plan,
        quotaBytes: planRec.quotaBytes,
        usedBytes: await getUsed(env, sess.uid),
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
    const projected = (rec ? await getUsed(env, sess.uid) : 0) - (head ? head.size : 0) + size;
    if (rec && projected > (await getPlan(env, sess.uid)).quotaBytes) throw httpError(413, 'quota exceeded');
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
// quota を強制し usedBytes を更新する (公開経路の容量防御, ADR-033)。
// 原子性: R2 はトランザクション非対応のため、全 put を先に行い (失敗時は delete に進まず
// サイトを空にしない)、最後に削除同期する。中途失敗は次回の成功公開で自己修復する。
async function handlePublish(request, env) {
    await enforceWriteLimit(request, env);
    const sess = await requireAuth(request, env);
    const { files, deleteMissing, affiliateTag } = await request.json().catch(() => ({}));
    if (!Array.isArray(files)) throw httpError(400, 'files required');
    const base = `sites/${sess.siteId}/`;

    // 既存オブジェクトのサイズ把握 (quota 差分計算 + 削除同期に使う)
    const existing = new Map();
    let cursor;
    do {
        const res = await env.BUCKET.list({ prefix: base, cursor });
        for (const o of res.objects) existing.set(o.key, o.size);
        cursor = res.truncated ? res.cursor : undefined;
    } while (cursor);

    // 今回の集合と差分サイズ (新規/置換/削除) を算出
    const enc = new TextEncoder();
    const puts = [];
    const keep = new Set();
    let delta = 0;
    for (const f of files) {
        const key = base + safeRel(f.path);
        const content = f.content || '';
        keep.add(key);
        delta += enc.encode(content).length - (existing.get(key) || 0);
        puts.push({ key, content });
    }
    const deletes = [];
    if (deleteMissing) {
        for (const [key, size] of existing) {
            if (!keep.has(key)) { deletes.push(key); delta -= size; }
        }
    }

    // quota 判定 (R2 へ書き込む前に弾く)。超過なら 413 (HubStorageAdapter が HubQuotaError 化)
    const rec = await env.KV.get(`uid:${sess.uid}`, 'json');
    if (rec && (await getUsed(env, sess.uid)) + delta > (await getPlan(env, sess.uid)).quotaBytes) throw httpError(413, 'quota exceeded');

    // 本人の Amazon アフィタグを記録 (/go が Plus 時に解決して使う)。文字種を制限。
    // affiliateTag は uid レコードに書く。課金 (setPlan) は plan:<uid>、使用量 (addUsage) は usage:<uid> を
    // 書くのでキーを共有せず、これらの並行書込が互いをクロバーしない (ADR-035 競合対策)。
    if (rec && typeof affiliateTag === 'string') {
        const t = affiliateTag.trim().slice(0, 32);
        if (/^[A-Za-z0-9_-]*$/.test(t) && (rec.affiliateTag || '') !== t) {
            rec.affiliateTag = t;
            await env.KV.put(`uid:${sess.uid}`, JSON.stringify(rec));
        }
    }

    // 全 put を先に (失敗時はここで throw → delete に進まず旧ファイルを消さない)、最後に削除
    for (const p of puts) await env.BUCKET.put(p.key, p.content);
    for (const key of deletes) await env.BUCKET.delete(key);

    await addUsage(env, sess.uid, delta);
    return json({ ok: true, siteId: sess.siteId, siteUrl: `https://${env.HUB_DOMAIN}/public/${sess.siteId}/`, published: files.length });
}

// ===== アカウント削除 (退会, ADR-033 / 個人情報の削除権) =====
// uid の私的データ (data/<uid>/) と公開サイト (sites/<siteId>/) を全削除し、
// 使用量レコード・現在の公開キー・通報レコードを KV から消す。
async function handleAccountDelete(request, env) {
    await enforceWriteLimit(request, env);
    const sess = await requireAuth(request, env);
    const auth = request.headers.get('Authorization') || '';
    const m = auth.match(/^Bearer\s+(hk_[a-f0-9]+)$/i);
    const key = m ? m[1] : null;

    // 退会後の課金継続を防ぐため、有効な Stripe サブスクがあれば解約する (billing 未設定/sub 無しはスキップ)。
    const planRec = await getPlan(env, sess.uid);
    if (env.STRIPE_SECRET_KEY && planRec && planRec.stripeSubscriptionId) {
        try { await stripeApi(env, 'DELETE', `subscriptions/${planRec.stripeSubscriptionId}`, null); } catch (_) {}
    }

    await deletePrefix(env, `data/${sess.uid}/`);
    if (sess.siteId) await deletePrefix(env, `sites/${sess.siteId}/`);

    await env.KV.delete(`uid:${sess.uid}`);
    await env.KV.delete(`plan:${sess.uid}`);
    await env.KV.delete(`usage:${sess.uid}`);
    if (planRec && planRec.stripeCustomerId) await env.KV.delete(`stripe:${planRec.stripeCustomerId}`);
    if (key) await env.KV.delete(`key:${key}`);
    if (sess.siteId) {
        await env.KV.delete(`report:${sess.siteId}`);
        await env.KV.delete(`site:${sess.siteId}`);   // /go の逆引きも除去 (孤立防止)
    }

    return json({ ok: true, deleted: true });
}

// R2: prefix 配下のオブジェクトを全削除 (ページング対応)
async function deletePrefix(env, prefix) {
    let cursor;
    do {
        const res = await env.BUCKET.list({ prefix, cursor });
        for (const o of res.objects) await env.BUCKET.delete(o.key);
        cursor = res.truncated ? res.cursor : undefined;
    } while (cursor);
}

// ===== 課金 (Stripe Checkout / Billing Portal / Webhook, ADR-035) =====
// Plus 化は plan:<uid> の plan/quotaBytes を引き上げるだけ (既存設計の延長)。決済の正本は Stripe。
// 未設定 (STRIPE_* なし) の環境では課金系は 503 を返し、何も起きない (口座準備前でも他機能は動く)。
const PLUS_QUOTA_DEFAULT = 3 * 1024 * 1024 * 1024;   // Plus = 3GB (ADR-033/035)

// Managed Payments (Stripe = Merchant of Record。税の計算/徴収/納付を Stripe が代行) のプレビュー版 (ADR-037)。
// このバージョン以上が必須。STRIPE_API_VERSION で上書き可 (Stripe が版を上げたら toml で追従)。
const STRIPE_MANAGED_PAYMENTS_VERSION = '2026-02-25.preview';

// アップグレード: Stripe Checkout セッション (Managed Payments) を作り、その URL を返す (アプリがリダイレクト)。
async function handleCheckout(request, env) {
    if (!env.STRIPE_SECRET_KEY) throw httpError(503, 'billing not configured');
    const sess = await requireAuth(request, env);
    const body = await request.json().catch(() => ({}));
    const price = body.plan === 'yearly' ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY;
    if (!price || String(price).startsWith('REPLACE')) throw httpError(503, 'price not configured');
    const rec = await env.KV.get(`uid:${sess.uid}`, 'json');
    const planRec = await getPlan(env, sess.uid);
    const ret = safeReturnUrl(body.returnUrl, env);
    const form = new URLSearchParams();
    form.set('mode', 'subscription');
    form.set('managed_payments[enabled]', 'true');    // Stripe を MoR 化 → 税は Stripe が処理 (ADR-037)
    form.set('line_items[0][price]', price);
    form.set('line_items[0][quantity]', '1');
    form.set('client_reference_id', sess.uid);        // Webhook で uid を特定する
    form.set('success_url', `${ret}?billing=success`);
    form.set('cancel_url', `${ret}?billing=cancel`);
    if (planRec && planRec.stripeCustomerId) form.set('customer', planRec.stripeCustomerId);
    else if (rec && rec.email) form.set('customer_email', rec.email);
    // Managed Payments はプレビュー版バージョンヘッダ必須。Webhook 側も同版で設定すること (HUB-SETUP Phase E)。
    const data = await stripeApi(env, 'POST', 'checkout/sessions', form,
        env.STRIPE_API_VERSION || STRIPE_MANAGED_PAYMENTS_VERSION);
    return json({ url: data.url });
}

// 解約/支払い方法の管理: Stripe Billing Portal セッションを作り URL を返す。
async function handleBillingPortal(request, env) {
    if (!env.STRIPE_SECRET_KEY) throw httpError(503, 'billing not configured');
    const sess = await requireAuth(request, env);
    const planRec = await getPlan(env, sess.uid);
    if (!planRec || !planRec.stripeCustomerId) throw httpError(400, 'no subscription');
    const body = await request.json().catch(() => ({}));
    const form = new URLSearchParams();
    form.set('customer', planRec.stripeCustomerId);
    form.set('return_url', safeReturnUrl(body.returnUrl, env));
    const data = await stripeApi(env, 'POST', 'billing_portal/sessions', form);
    return json({ url: data.url });
}

// Webhook: 署名を検証し、課金イベントを uid レコードに反映する。
async function handleStripeWebhook(request, env) {
    if (!env.STRIPE_WEBHOOK_SECRET) return new Response('billing not configured', { status: 503 });
    const sig = request.headers.get('Stripe-Signature') || '';
    const raw = await request.text();
    let event;
    try { event = await verifyStripeSignature(raw, sig, env.STRIPE_WEBHOOK_SECRET); }
    catch (e) { return new Response(`bad signature: ${e.message}`, { status: 400 }); }
    try { await applyStripeEvent(event, env); }
    catch (e) { return new Response(`handler error: ${e.message}`, { status: 500 }); }
    return new Response('ok', { status: 200 });
}

// イベント → プラン反映 (テスト対象。KV だけに依存する純ロジック)。
async function applyStripeEvent(event, env) {
    const type = event && event.type;
    const obj = (event && event.data && event.data.object) || {};
    if (type === 'checkout.session.completed') {
        const uid = obj.client_reference_id;
        if (!uid) return;
        const ok = await setPlan(env, uid, 'plus', { stripeCustomerId: obj.customer, stripeSubscriptionId: obj.subscription });
        // setPlan が false = uid レコードが無い (退会レース等)。throw で 500 を返し Stripe にリトライさせる
        // (取りこぼしの検知。orphaned な stripe: 逆引きも張らない)。
        if (!ok) throw httpError(409, 'account record missing (deleted?) — retry');
        if (obj.customer) await env.KV.put(`stripe:${obj.customer}`, uid);   // customer→uid 逆引き (失効イベント用)
    } else if (type === 'customer.subscription.updated' && ['active', 'trialing'].includes(obj.status)) {
        // unpaid 等で一度 Free に落ちたサブスクがカード更新で復帰 → Plus に戻す (再アクティブ化は checkout を伴わない)
        const uid = obj.customer ? await env.KV.get(`stripe:${obj.customer}`) : null;
        if (uid) await setPlan(env, uid, 'plus', { stripeSubscriptionId: obj.id });
    } else if (type === 'customer.subscription.deleted' ||
               (type === 'customer.subscription.updated' && ['canceled', 'unpaid', 'incomplete_expired'].includes(obj.status))) {
        const uid = obj.customer ? await env.KV.get(`stripe:${obj.customer}`) : null;
        if (uid) await setPlan(env, uid, 'free', {});
    }
}

// プラン/quota を引き上げ/引き下げる (plan:<uid> に書く)。/go の Plus 解決もこの plan を見る (降格で運営タグへ戻る)。
// uid レコードが無ければ false を返す (退会レースの取りこぼし検知に使う)。
async function setPlan(env, uid, plan, extra) {
    const rec = await env.KV.get(`uid:${uid}`, 'json');
    if (!rec) return false;
    // 既存 plan:<uid> を継承 (旧形式は uid レコードから引き継ぐ)。setPlan 以外はこのキーを書かない
    const cur = (await env.KV.get(`plan:${uid}`, 'json'))
        || { plan: rec.plan, quotaBytes: rec.quotaBytes, stripeCustomerId: rec.stripeCustomerId, stripeSubscriptionId: rec.stripeSubscriptionId };
    const next = { ...cur, plan,
        quotaBytes: plan === 'plus' ? (Number(env.PLUS_QUOTA_BYTES) || PLUS_QUOTA_DEFAULT) : (Number(env.QUOTA_BYTES) || DEFAULT_QUOTA) };
    if (extra && extra.stripeCustomerId) next.stripeCustomerId = extra.stripeCustomerId;
    if (extra && extra.stripeSubscriptionId) next.stripeSubscriptionId = extra.stripeSubscriptionId;
    await env.KV.put(`plan:${uid}`, JSON.stringify(next));
    return true;
}

// Stripe 署名検証 (Stripe-Signature: t=…,v1=… の HMAC-SHA256(`${t}.${payload}`))。
async function verifyStripeSignature(payload, header, secret, toleranceSec = 300) {
    const parts = {};
    for (const kv of String(header).split(',')) {
        const i = kv.indexOf('=');
        if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    }
    const t = parts.t, v1 = parts.v1;
    if (!t || !v1) throw new Error('missing t/v1');
    if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) throw new Error('timestamp out of tolerance');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
    const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (!timingSafeEqualHex(hex, v1)) throw new Error('signature mismatch');
    return JSON.parse(payload);
}

function timingSafeEqualHex(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

// Stripe REST 呼び出し (application/x-www-form-urlencoded)。失敗は 502 に正規化。form 無し (DELETE 等) は body なし。
// apiVersion を渡すとその呼び出しだけ Stripe-Version を固定する (Managed Payments のプレビュー版用, ADR-037)。
// 渡さなければアカウント既定バージョン (Portal/解約はこちら)。
async function stripeApi(env, method, path, form, apiVersion) {
    const headers = { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` };
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (apiVersion) headers['Stripe-Version'] = apiVersion;
    const res = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers, body: form || undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(502, `stripe: ${(data && data.error && data.error.message) || res.status}`);
    return data;
}

// 戻り先 URL を APP_ORIGIN 許可リストで検証 (オープンリダイレクト防止)。不正なら先頭 origin。
function safeReturnUrl(url, env) {
    const allow = String(env.APP_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const fallback = (allow[0] || '') + '/bookshelf/';
    if (!url) return fallback;
    try {
        const u = new URL(url);
        const origin = `${u.protocol}//${u.host}`;
        if (allow.includes(origin)) return `${origin}${u.pathname}`;   // クエリ/ハッシュは落とす
    } catch (_) {}
    return fallback;
}

// テスト用に課金/プランロジックを名前付きエクスポート (Cloudflare は default のみ使用・named は無視)。
export { applyStripeEvent, setPlan, verifyStripeSignature, getPlan, getUsed, handleCheckout };

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
    // 使用量は usage:<uid> に分離して書く (頻繁な書込が課金レコード plan:<uid> をクロバーしないため, ADR-035)。
    const rec = await env.KV.get(`uid:${uid}`, 'json');
    if (!rec) return;   // アカウント無し (削除レース) は無視
    await env.KV.put(`usage:${uid}`, String(Math.max(0, (await getUsed(env, uid)) + delta)));
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
