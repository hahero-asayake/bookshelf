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
//   ADMIN_EMAILS           (secret) カンマ区切りの管理者メール。/admin/plan で特定アカウントを無料↔Plus に手動
//                    切替できる (Stripe を経由しない優待。ADR-038)。未設定なら /admin/plan は 403。
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

        // Kindle リレー (認証不要・amazon.co.jp ブックマークレットから呼ばれるため CORS は全開放)
        if ((path === '/kindle/relay' || path.startsWith('/kindle/relay/')) && request.method === 'OPTIONS') {
            return corsAll(new Response(null, { status: 204 }));
        }
        if (path === '/kindle/relay' && request.method === 'POST') return corsAll(await handleKindleRelayCreate(request, env));
        if (path.startsWith('/kindle/relay/') && request.method === 'GET') return corsAll(await handleKindleRelayGet(request, env, path));

        // API (アプリは別 origin なので CORS 付与)
        if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env, request);
        try {
            if (path === '/session' && request.method === 'POST') return cors(await handleSession(request, env), env, request);
            if (path === '/usage' && request.method === 'GET') return cors(await handleUsage(request, env), env, request);
            if (path === '/publish' && request.method === 'POST') return cors(await handlePublish(request, env), env, request);
            if (path === '/data/batch' && request.method === 'POST') return cors(await handleBatch(request, env), env, request);
            if (path === '/account' && request.method === 'DELETE') return cors(await handleAccountDelete(request, env), env, request);
            if (path === '/admin/plan' && request.method === 'POST') return cors(await handleAdminSetPlan(request, env), env, request);
            if (path === '/plugins' && request.method === 'GET') return cors(await handleListPlugins(request, env), env, request);
            if (path === '/admin/plugins' && request.method === 'POST') return cors(await handleAdminUpsertPlugin(request, env), env, request);
            if (path === '/billing/checkout' && request.method === 'POST') return cors(await handleCheckout(request, env), env, request);
            if (path === '/billing/portal' && request.method === 'POST') return cors(await handleBillingPortal(request, env), env, request);
            // --- Asayake コミュニティ (ADR-044): 公開本棚ギャラリー＋マーケット社会機能。D1 (env.DB) 必須 ---
            if (path === '/community/plugins' && request.method === 'GET') return cors(await handleCommunityPlugins(request, env), env, request);
            if (path === '/community/sites' && request.method === 'GET') return cors(await handleCommunitySitesList(request, env, url), env, request);
            if (path === '/community/sites' && request.method === 'POST') return cors(await handleCommunitySiteUpsert(request, env), env, request);
            if (path.startsWith('/community/sites/') && request.method === 'DELETE') return cors(await handleCommunitySiteDelete(request, env, path), env, request);
            if (path === '/community/stars' && request.method === 'POST') return cors(await handleCommunityStar(request, env), env, request);
            if (path === '/community/me/stars' && request.method === 'GET') return cors(await handleCommunityMyStars(request, env), env, request);
            if (path === '/community/comments' && request.method === 'GET') return cors(await handleCommunityCommentsList(request, env, url), env, request);
            if (path === '/community/comments' && request.method === 'POST') return cors(await handleCommunityCommentAdd(request, env), env, request);
            if (path === '/community/install' && request.method === 'POST') return cors(await handleCommunityInstall(request, env), env, request);
            if (path === '/community/report' && request.method === 'POST') return cors(await handleCommunityReport(request, env), env, request);
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
    // email → uid の逆引き (管理者プラン切替 /admin/plan がメール指定で対象を引くため。ADR-038)。冪等
    if (rec.email) await env.KV.put(`email:${String(rec.email).toLowerCase()}`, uid);
    const key = 'hk_' + crypto.randomUUID().replace(/-/g, '');
    await env.KV.put(`key:${key}`, JSON.stringify({ uid, siteId: rec.siteId, createdAt: Date.now() }));
    const planRec = await getPlan(env, uid);
    return json({
        key, uid, siteId: rec.siteId, email,
        plan: planRec.plan, quotaBytes: planRec.quotaBytes, usedBytes: await getUsed(env, uid),
        interval: planRec.interval, currentPeriodEnd: planRec.currentPeriodEnd,
        cancelAtPeriodEnd: planRec.cancelAtPeriodEnd, subStatus: planRec.subStatus,
        billingManaged: !!planRec.stripeCustomerId,    // Stripe 顧客がある=Portal を開ける (ADR-039)
        isAdmin: isAdminEmail(rec.email || email, env),
        apiBase: `https://${env.HUB_DOMAIN}`,
        publicBase: `https://${env.HUB_DOMAIN}/public/${rec.siteId}/`
    });
}

// 管理者判定: ADMIN_EMAILS (secret, カンマ区切り) に含まれるメールか。未設定なら常に false。
function isAdminEmail(email, env) {
    if (!email || !env.ADMIN_EMAILS) return false;
    const set = String(env.ADMIN_EMAILS).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return set.includes(String(email).toLowerCase());
}

// 課金レコード plan:<uid> を返す (旧形式=uid レコードに plan/quota を持つ場合は遅延フォールバック)。
async function getPlan(env, uid) {
    const p = await env.KV.get(`plan:${uid}`, 'json');
    if (p) return { plan: p.plan || 'free', quotaBytes: p.quotaBytes || (Number(env.QUOTA_BYTES) || DEFAULT_QUOTA),
                    stripeCustomerId: p.stripeCustomerId, stripeSubscriptionId: p.stripeSubscriptionId,
                    interval: p.interval, currentPeriodEnd: p.currentPeriodEnd, cancelAtPeriodEnd: !!p.cancelAtPeriodEnd, subStatus: p.subStatus };
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
        interval: planRec.interval,
        currentPeriodEnd: planRec.currentPeriodEnd,
        cancelAtPeriodEnd: planRec.cancelAtPeriodEnd,
        subStatus: planRec.subStatus,
        billingManaged: !!planRec.stripeCustomerId,    // Stripe 顧客がある=Portal を開ける (ADR-039)
        isAdmin: isAdminEmail(rec.email, env),
        siteId: rec.siteId,
        publicBase: `https://${env.HUB_DOMAIN}/public/${rec.siteId}/`
    });
}

// 管理者によるプラン手動切替 (ADR-038): 特定アカウントを無料↔Plus に切替える (Stripe を経由しない)。
// 用途は運営/招待アカウントの優待・検証。対象は **Stripe サブスクを持たないアカウント** を想定。
// adminGrant フラグを立て、Stripe 失効イベントで降格しないようにする (comp が webhook で剥がれない)。
async function handleAdminSetPlan(request, env) {
    const sess = await requireAuth(request, env);
    const caller = await env.KV.get(`uid:${sess.uid}`, 'json');
    if (!caller || !isAdminEmail(caller.email, env)) throw httpError(403, 'admin only');
    const body = await request.json().catch(() => ({}));
    const resetBilling = body.resetBilling === true || body.resetBilling === 'true';   // 課金リンクのリセット (ADR-039)
    const plan = body.plan === 'plus' ? 'plus' : 'free';
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) throw httpError(400, 'email required');
    const targetUid = await env.KV.get(`email:${email}`);
    if (!targetUid) throw httpError(404, 'account not found (まだログインしていない可能性)');
    let ok;
    if (resetBilling) {
        // test→live 残骸の課金リンクを純 KV で安全にリセット (Stripe を呼ばないので stale ID でも 502 にならない, ADR-039)。
        // customer/subscription/周期メタ/adminGrant を全消去し free に戻す。逆引きは自分を指すときだけ削除。
        const old = await getPlan(env, targetUid);
        ok = await setPlan(env, targetUid, 'free', { stripeCustomerId: null, stripeSubscriptionId: null, interval: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, subStatus: null, adminGrant: false });
        if (ok && old.stripeCustomerId) {
            const owner = await env.KV.get(`stripe:${old.stripeCustomerId}`);
            if (owner === targetUid) await env.KV.delete(`stripe:${old.stripeCustomerId}`);
        }
    } else {
        // adminGrant: Plus 付与時 true / 解除時 false。setPlan が plan/quota も合わせて更新する
        ok = await setPlan(env, targetUid, plan, { adminGrant: plan === 'plus' });
    }
    if (!ok) throw httpError(404, 'account record missing');
    return json({ ok: true, email, uid: targetUid, plan: resetBilling ? 'free' : plan, adminGrant: resetBilling ? false : (plan === 'plus'), reset: resetBilling });
}

// ===== プラグインマーケット レジストリ (ADR-040 Phase1) =====
// 公開レジストリ。plugin:<id> に { id, name, description, author, repoUrl, path, sha,
// categories, capabilities, stars, installs, reportCount, updatedAt } を保持する。
// 配布は GitHub の SHA ピン (repoUrl + path + sha)。Phase1 は hahero が手動登録 = 公式カタログ。

async function handleListPlugins(request, env) {
    // 公開一覧 (認証不要)。plugin:* を全件列挙して name 順で返す。
    const out = [];
    let cursor;
    do {
        const res = await env.KV.list({ prefix: 'plugin:', cursor });
        for (const k of res.keys) {
            const v = await env.KV.get(k.name, 'json');
            if (v) out.push(v);
        }
        cursor = res.list_complete ? null : res.cursor;
    } while (cursor);
    out.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    return json({ plugins: out });
}

async function handleAdminUpsertPlugin(request, env) {
    // 管理者のみ。レジストリにエントリを upsert / 削除する (Phase1 は hahero 手動登録)。
    const sess = await requireAuth(request, env);
    const caller = await env.KV.get(`uid:${sess.uid}`, 'json');
    if (!caller || !isAdminEmail(caller.email, env)) throw httpError(403, 'admin only');
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || '').trim();
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw httpError(400, 'invalid id');
    if (body.delete === true) {
        await env.KV.delete(`plugin:${id}`);
        return json({ ok: true, deleted: id });
    }
    if (!/^https:\/\/github\.com\//.test(String(body.repoUrl || ''))) throw httpError(400, 'repoUrl must be a github.com URL');
    const entry = {
        id,
        name: String(body.name || id),
        description: String(body.description || ''),
        author: String(body.author || ''),
        repoUrl: String(body.repoUrl),
        path: String(body.path || ''),
        sha: String(body.sha || ''),
        categories: Array.isArray(body.categories) ? body.categories.map(String) : [],
        capabilities: Array.isArray(body.capabilities) ? body.capabilities.map(String) : [],
        // 予約フィールド (Phase3/4: 星 / インストール数 / 通報)
        stars: Number(body.stars) || 0,
        installs: Number(body.installs) || 0,
        reportCount: Number(body.reportCount) || 0,
        updatedAt: Date.now()
    };
    await env.KV.put(`plugin:${id}`, JSON.stringify(entry));
    return json({ ok: true, plugin: entry });
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
        try {
            await stripeApi(env, 'DELETE', `subscriptions/${planRec.stripeSubscriptionId}`, null);
        } catch (e) {
            // 1本目が stale (No such subscription) なら、customer に紐づく生きたサブスクを全解約して課金継続を防ぐ (ADR-039)。
            // status=all で取り、終了済み (canceled/incomplete_expired) 以外を解約する (trialing/past_due 等も拾う)。
            if (isStripeMissing(e, 'subscription') && planRec.stripeCustomerId) {
                try {
                    const list = await stripeApi(env, 'GET', `subscriptions?customer=${encodeURIComponent(planRec.stripeCustomerId)}&status=all&limit=100`, null);
                    for (const s of (list.data || [])) {
                        if (['canceled', 'incomplete_expired'].includes(s.status)) continue;
                        try { await stripeApi(env, 'DELETE', `subscriptions/${s.id}`, null); } catch (_) {}
                    }
                } catch (_) {}
            }
        }
    }

    await deletePrefix(env, `data/${sess.uid}/`);
    if (sess.siteId) await deletePrefix(env, `sites/${sess.siteId}/`);

    await env.KV.delete(`uid:${sess.uid}`);
    await env.KV.delete(`plan:${sess.uid}`);
    await env.KV.delete(`usage:${sess.uid}`);
    if (planRec && planRec.stripeCustomerId) {
        const owner = await env.KV.get(`stripe:${planRec.stripeCustomerId}`);
        if (owner === sess.uid) await env.KV.delete(`stripe:${planRec.stripeCustomerId}`);   // 自分を指す逆引きだけ削除 (ADR-039)
    }
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
    const ver = env.STRIPE_API_VERSION || STRIPE_MANAGED_PAYMENTS_VERSION;
    let data;
    try {
        data = await stripeApi(env, 'POST', 'checkout/sessions', form, ver);
    } catch (e) {
        // test→live 等でKVに残った customer が live に存在しない ("No such customer") → customer を外し
        // email で1回だけ作り直し、stale を掃除する (self-heal, ADR-039)。次回 checkout は新 customer で通る。
        if (planRec && planRec.stripeCustomerId && isStripeMissing(e, 'customer')) {
            form.delete('customer');
            if (rec && rec.email) form.set('customer_email', rec.email);
            data = await stripeApi(env, 'POST', 'checkout/sessions', form, ver);
            await clearStaleStripe(env, sess.uid, planRec.stripeCustomerId);
        } else throw e;
    }
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
    let data;
    try {
        data = await stripeApi(env, 'POST', 'billing_portal/sessions', form);
    } catch (e) {
        // stale customer (test→live 残骸) なら掃除して「管理対象なし」に縮退 → ユーザは再 Checkout で自己修復 (ADR-039)
        if (isStripeMissing(e, 'customer')) { await clearStaleStripe(env, sess.uid, planRec.stripeCustomerId); throw httpError(400, 'no subscription'); }
        throw e;
    }
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
        // 二重課金防止 (ADR-039): 同一 uid に既存の別サブスクが残っていたら解約する (1 uid = 1 有効サブスク)。
        // self-heal の再 Checkout やユーザの連打で複数サブスクが並行成立するのを防ぐ。stale な旧 sub は DELETE 失敗→無視。
        const prev = await getPlan(env, uid);
        if (env.STRIPE_SECRET_KEY && prev.stripeSubscriptionId && obj.subscription && prev.stripeSubscriptionId !== obj.subscription) {
            try { await stripeApi(env, 'DELETE', `subscriptions/${prev.stripeSubscriptionId}`, null); } catch (_) {}
        }
        // サブスク詳細 (周期/次回更新/解約予約) は session に無い → Stripe から取得して一緒に保存し UI に出す。
        // 秘密鍵が無い環境 (単体テスト) では取得をスキップ (plus 化だけ行う)。
        let meta = {};
        if (obj.subscription && env.STRIPE_SECRET_KEY) {
            try { meta = subMeta(await stripeApi(env, 'GET', `subscriptions/${obj.subscription}`, null, env.STRIPE_API_VERSION || STRIPE_MANAGED_PAYMENTS_VERSION)); }
            catch (_) {}
        }
        const ok = await setPlan(env, uid, 'plus', { stripeCustomerId: obj.customer, stripeSubscriptionId: obj.subscription, ...meta });
        // setPlan が false = uid レコードが無い (退会レース等)。throw で 500 を返し Stripe にリトライさせる
        // (取りこぼしの検知。orphaned な stripe: 逆引きも張らない)。
        if (!ok) throw httpError(409, 'account record missing (deleted?) — retry');
        if (obj.customer) await env.KV.put(`stripe:${obj.customer}`, uid);   // customer→uid 逆引き (失効/変更イベント用)
    } else if (type === 'customer.subscription.updated' || type === 'customer.subscription.created') {
        const uid = obj.customer ? await env.KV.get(`stripe:${obj.customer}`) : null;
        if (!uid) return;   // 逆引き未確立 (created が completed より先着) — completed 側で確定する
        const meta = subMeta(obj);
        if (['active', 'trialing'].includes(obj.status)) {
            // 周期変更 (月↔年)・解約予約 (cancel_at_period_end) もここで取り込む。降格中からの復帰も Plus に戻す
            await setPlan(env, uid, 'plus', { stripeSubscriptionId: obj.id, ...meta });
        } else if (['canceled', 'unpaid', 'incomplete_expired'].includes(obj.status)) {
            if (!(await isAdminGranted(env, uid))) await setPlan(env, uid, 'free', {});   // 管理者付与は剥がさない
        }
    } else if (type === 'customer.subscription.deleted') {
        // 解約予約の期間満了でサブスクが実際に終了 → Free に降格 (周期/更新日もクリア)
        const uid = obj.customer ? await env.KV.get(`stripe:${obj.customer}`) : null;
        if (uid && !(await isAdminGranted(env, uid))) await setPlan(env, uid, 'free', {});
    }
}

// 管理者付与 (ADR-038) が立っているか。立っていれば Stripe 失効でも Plus を維持する。
async function isAdminGranted(env, uid) {
    const p = await env.KV.get(`plan:${uid}`, 'json');
    return !!(p && p.adminGrant);
}

// サブスクから UI 表示用メタを抽出 (課金周期/次回更新日/解約予約/状態)。版差で period が item 側にも入るので両対応。
function subMeta(sub) {
    if (!sub || typeof sub !== 'object') return {};
    const item = sub.items && sub.items.data && sub.items.data[0];
    const interval = item && item.price && item.price.recurring && item.price.recurring.interval;
    const periodEnd = sub.current_period_end || (item && item.current_period_end) || undefined;
    return {
        interval: interval || undefined,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: !!sub.cancel_at_period_end,
        subStatus: sub.status || undefined
    };
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
    // 'in extra' 判定: キーを渡したときだけ更新。truthy なら上書き、null/'' なら明示クリア (ADR-039)。
    // キー未指定 (通常の Stripe イベントは extra に customer を含めない) では既存値を温存する。
    if (extra && 'stripeCustomerId' in extra) { if (extra.stripeCustomerId) next.stripeCustomerId = extra.stripeCustomerId; else delete next.stripeCustomerId; }
    if (extra && 'stripeSubscriptionId' in extra) { if (extra.stripeSubscriptionId) next.stripeSubscriptionId = extra.stripeSubscriptionId; else delete next.stripeSubscriptionId; }
    // サブスク表示メタ (周期/次回更新/解約予約/状態) を取り込む (渡されたぶんだけ更新)
    if (extra && extra.interval !== undefined) next.interval = extra.interval;
    if (extra && extra.currentPeriodEnd !== undefined) next.currentPeriodEnd = extra.currentPeriodEnd;
    if (extra && extra.cancelAtPeriodEnd !== undefined) next.cancelAtPeriodEnd = !!extra.cancelAtPeriodEnd;
    if (extra && extra.subStatus !== undefined) next.subStatus = extra.subStatus;
    if (extra && extra.adminGrant !== undefined) next.adminGrant = !!extra.adminGrant;   // 管理者付与 (ADR-038)
    // Free 降格時は周期/更新日/解約予約をクリア (有効なサブスクが無い)
    if (plan === 'free') { delete next.interval; delete next.currentPeriodEnd; next.cancelAtPeriodEnd = false; delete next.subStatus; }
    await env.KV.put(`plan:${uid}`, JSON.stringify(next));
    return true;
}

// test→live 等で残った stale な Stripe リンク (customer/subscription) を KV から掃除する (純 KV・Stripe を呼ばない, ADR-039)。
// plan 自体は変えない (Plus 化は再 Checkout 完了の webhook が行う)。
// CAS ガード: (1) webhook が先に新 customer を書いていたら消さない (現値が oldCustomer と一致時のみ)。
//            (2) 逆引きは自分(uid)を指すときだけ削除 (他 uid の逆引きを巻き込まない)。
async function clearStaleStripe(env, uid, oldCustomer) {
    const cur = await getPlan(env, uid);
    if (cur.stripeCustomerId && oldCustomer && cur.stripeCustomerId !== oldCustomer) return;   // 既に新 customer に置換済み → 触らない
    await setPlan(env, uid, cur.plan, { stripeCustomerId: null, stripeSubscriptionId: null });
    if (oldCustomer) {
        const owner = await env.KV.get(`stripe:${oldCustomer}`);
        if (owner === uid) await env.KV.delete(`stripe:${oldCustomer}`);
    }
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
    if (!res.ok) {
        const se = (data && data.error) || {};
        const e = httpError(502, `stripe: ${se.message || res.status}`);
        e.stripeCode = se.code; e.stripeParam = se.param; e.stripeStatus = res.status;   // 呼び出し側が stale を判別できるよう構造を残す (ADR-039)
        throw e;
    }
    return data;
}

// Stripe の「対象が存在しない」エラーか (test→live で残った customer/subscription ID 等, ADR-039)。
// code(resource_missing) を最優先。Managed Payments プレビュー版が code を返さない場合に備え message 正規表現も併用。
function isStripeMissing(e, param) {
    if (!e) return false;
    const msg = String(e.message || '');
    const codeMissing = e.stripeCode === 'resource_missing';
    const msgMissing = /no such (customer|subscription)/i.test(msg) || /similar object exists in test mode/i.test(msg);
    if (!(codeMissing || msgMissing)) return false;
    if (!param) return true;
    return e.stripeParam === param || new RegExp('no such ' + param, 'i').test(msg);
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
// ===== Asayake コミュニティ (ADR-044): 公開本棚ギャラリー＋マーケット社会機能 =====
// バックエンドは hub Worker 相乗り。社会データ (sites/stars/comments/reports/stats) は D1 (env.DB)。
// 設計: スター=ログイン無料 / コメント投稿=有料(Plus)のみ・閲覧は無料 / 直接インストール=hub同期ユーザ。
// 広告・UI はフロント (別repo bookshelf-community) 側で、ここは API のみを提供する。
// target_type は 'plugin' | 'site' の2種で star/comment/report/install を共通土台に載せる (拡張前提)。

function requireD1(env) {
    if (!env.DB || typeof env.DB.prepare !== 'function') throw httpError(503, 'community backend (D1) not configured');
    return env.DB;
}
function ttOk(t) { return t === 'plugin' || t === 'site'; }
async function isPlus(env, uid) { return (await getPlan(env, uid)).plan === 'plus'; }
function rawGitHubBase(repoUrl, sha, subPath) {
    // repoUrl (https://github.com/owner/repo) + SHA ピン + subPath → raw.githubusercontent.com ベース。
    const m = String(repoUrl || '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    if (!m) return null;
    const ref = String(sha || 'main');
    let p = String(subPath || '').replace(/^\/+|\/+$/g, '');
    if (p) p += '/';
    return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${ref}/${p}`;
}
async function fetchRaw(rawUrl) {
    const r = await fetch(rawUrl, { cf: { cacheTtl: 300 } });
    if (!r.ok) return null;
    return await r.text();
}
// stats を 1 行 upsert し metric を delta 加算 (ランキング読取用の集計を書込時に維持)。
async function bumpStat(env, type, id, metric, delta) {
    const cols = ['star_count', 'install_count', 'view_count', 'comment_count'];
    if (!cols.includes(metric)) return;
    const init = cols.map(c => c === metric ? delta : 0);
    await env.DB.prepare(
        `INSERT INTO stats (target_type, target_id, star_count, install_count, view_count, comment_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(target_type, target_id) DO UPDATE SET ${metric} = ${metric} + ?7`
    ).bind(type, id, init[0], init[1], init[2], init[3], delta).run();
}
async function getStatsMap(env, type) {
    const map = {};
    if (!env.DB || typeof env.DB.prepare !== 'function') return map;
    const rs = await env.DB.prepare(
        `SELECT target_id, star_count, install_count, view_count, comment_count FROM stats WHERE target_type = ?1`
    ).bind(type).all();
    for (const r of (rs.results || [])) map[r.target_id] = r;
    return map;
}

// 一覧 (公開): プラグイン (KV レジストリ) に D1 の星/インストール数/コメント数を合成して返す。
async function handleCommunityPlugins(request, env) {
    const baseRes = await handleListPlugins(request, env);
    const data = await baseRes.json();
    const map = await getStatsMap(env, 'plugin');
    for (const p of (data.plugins || [])) {
        const st = map[p.id] || {};
        p.stars = st.star_count || 0;
        p.installs = st.install_count || p.installs || 0;
        p.comments = st.comment_count || 0;
    }
    return json(data);
}

// Bearer キーがあれば uid を返す (無ければ null)。公開エンドポイントで「自分のものか」を判定する用。
async function optionalUid(request, env) {
    const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(hk_[a-f0-9]+)$/i);
    if (!m) return null;
    const sess = await env.KV.get(`key:${m[1]}`, 'json');
    return sess ? sess.uid : null;
}

// 一覧 (公開): 掲載された公開本棚。?sort=new|stars。uid は晒さず owned フラグだけ返す。
async function handleCommunitySitesList(request, env, url) {
    requireD1(env);
    const sort = (url && url.searchParams.get('sort')) || 'new';
    const viewer = await optionalUid(request, env);
    const rs = await env.DB.prepare(
        `SELECT id, uid, url, title, description, cover_url, tags, created_at, updated_at FROM sites WHERE hidden = 0`
    ).all();
    const sites = rs.results || [];
    const map = await getStatsMap(env, 'site');
    for (const s of sites) {
        const st = map[s.id] || {};
        s.stars = st.star_count || 0;
        s.comments = st.comment_count || 0;
        s.views = st.view_count || 0;
        s.tags = s.tags ? String(s.tags).split(',').filter(Boolean) : [];
        s.owned = !!(viewer && s.uid === viewer);
        delete s.uid;   // Google sub を公開レスポンスに出さない
    }
    sites.sort(sort === 'stars'
        ? (a, b) => (b.stars - a.stars) || (b.created_at - a.created_at)
        : (a, b) => b.created_at - a.created_at);
    return json({ sites });
}

// 掲載 (オプトイン・認証必須): 自分の公開本棚 URL を登録/更新。1 uid が複数掲載可、同一 URL は更新。
async function handleCommunitySiteUpsert(request, env) {
    await enforceWriteLimit(request, env);
    const sess = await requireAuth(request, env);
    requireD1(env);
    const body = await request.json().catch(() => ({}));
    const url = String(body.url || '').trim();
    if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 500) throw httpError(400, 'url must be https');
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) throw httpError(400, 'title required');
    const description = String(body.description || '').slice(0, 1000);
    const coverUrl = String(body.coverUrl || body.cover_url || '').trim().slice(0, 500);
    const tags = (Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(','))
        .map(s => String(s).trim()).filter(Boolean).slice(0, 10).join(',');
    const now = Date.now();
    const existing = await env.DB.prepare(`SELECT id FROM sites WHERE uid = ?1 AND url = ?2`).bind(sess.uid, url).first();
    let id;
    if (existing) {
        id = existing.id;
        await env.DB.prepare(`UPDATE sites SET title=?1, description=?2, cover_url=?3, tags=?4, updated_at=?5 WHERE id=?6`)
            .bind(title, description, coverUrl, tags, now, id).run();
    } else {
        id = crypto.randomUUID();
        await env.DB.prepare(
            `INSERT INTO sites (id, uid, url, title, description, cover_url, tags, created_at, updated_at, hidden)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 0)`
        ).bind(id, sess.uid, url, title, description, coverUrl, tags, now).run();
    }
    return json({ ok: true, id });
}

// 掲載の取り下げ (本人 or 管理者)。
async function handleCommunitySiteDelete(request, env, path) {
    await enforceWriteLimit(request, env);
    const sess = await requireAuth(request, env);
    requireD1(env);
    const id = decodeURIComponent(path.slice('/community/sites/'.length));
    const row = await env.DB.prepare(`SELECT uid FROM sites WHERE id = ?1`).bind(id).first();
    if (!row) return new Response(null, { status: 204 });
    const caller = await env.KV.get(`uid:${sess.uid}`, 'json');
    if (row.uid !== sess.uid && !(caller && isAdminEmail(caller.email, env))) throw httpError(403, 'not owner');
    await env.DB.prepare(`DELETE FROM sites WHERE id = ?1`).bind(id).run();
    return new Response(null, { status: 204 });
}

// スター toggle (ログイン無料・1 uid 1 票)。
async function handleCommunityStar(request, env) {
    await enforceWriteLimit(request, env);
    const sess = await requireAuth(request, env);
    requireD1(env);
    const body = await request.json().catch(() => ({}));
    const type = String(body.targetType || body.target_type || '');
    const id = String(body.targetId || body.target_id || '');
    if (!ttOk(type) || !id) throw httpError(400, 'bad target');
    const existing = await env.DB.prepare(`SELECT 1 AS x FROM stars WHERE target_type=?1 AND target_id=?2 AND uid=?3`).bind(type, id, sess.uid).first();
    let starred;
    if (existing) {
        await env.DB.prepare(`DELETE FROM stars WHERE target_type=?1 AND target_id=?2 AND uid=?3`).bind(type, id, sess.uid).run();
        await bumpStat(env, type, id, 'star_count', -1);
        starred = false;
    } else {
        await env.DB.prepare(`INSERT INTO stars (target_type, target_id, uid, created_at) VALUES (?1,?2,?3,?4)`).bind(type, id, sess.uid, Date.now()).run();
        await bumpStat(env, type, id, 'star_count', 1);
        starred = true;
    }
    const st = await env.DB.prepare(`SELECT star_count FROM stats WHERE target_type=?1 AND target_id=?2`).bind(type, id).first();
    return json({ ok: true, starred, starCount: (st && st.star_count) || 0 });
}

// 自分がスター済みの一覧 (UI の塗り分け用)。uid は返さない。
async function handleCommunityMyStars(request, env) {
    const sess = await requireAuth(request, env);
    requireD1(env);
    const rs = await env.DB.prepare(`SELECT target_type, target_id FROM stars WHERE uid = ?1`).bind(sess.uid).all();
    return json({ stars: rs.results || [] });
}

// コメント閲覧 (公開)。uid は晒さず author_name のみ返す。
async function handleCommunityCommentsList(request, env, url) {
    requireD1(env);
    const type = url.searchParams.get('targetType') || url.searchParams.get('target_type') || '';
    const id = url.searchParams.get('targetId') || url.searchParams.get('target_id') || '';
    if (!ttOk(type) || !id) throw httpError(400, 'bad target');
    const rs = await env.DB.prepare(
        `SELECT id, author_name, body, created_at FROM comments WHERE target_type=?1 AND target_id=?2 AND hidden=0 ORDER BY created_at DESC LIMIT 200`
    ).bind(type, id).all();
    return json({ comments: rs.results || [] });
}

// コメント投稿 (有料会員のみ・民度対策, ADR-044)。
async function handleCommunityCommentAdd(request, env) {
    await enforceWriteLimit(request, env);
    const sess = await requireAuth(request, env);
    requireD1(env);
    if (!(await isPlus(env, sess.uid))) throw httpError(403, 'comments are for Plus members');
    const body = await request.json().catch(() => ({}));
    const type = String(body.targetType || body.target_type || '');
    const id = String(body.targetId || body.target_id || '');
    const text = String(body.body || '').trim().slice(0, 2000);
    if (!ttOk(type) || !id) throw httpError(400, 'bad target');
    if (!text) throw httpError(400, 'empty comment');
    const name = String(body.authorName || '').trim().slice(0, 60);
    const cid = crypto.randomUUID();
    await env.DB.prepare(
        `INSERT INTO comments (id, target_type, target_id, uid, author_name, body, created_at, hidden, report_count) VALUES (?1,?2,?3,?4,?5,?6,?7,0,0)`
    ).bind(cid, type, id, sess.uid, name, text, Date.now()).run();
    await bumpStat(env, type, id, 'comment_count', 1);
    return json({ ok: true, id: cid });
}

// 直接インストール (hub 同期ユーザ向け, ADR-044): レジストリの SHA ピンから GitHub raw を取得し、
// 認証ユーザの hub ストレージ data/<uid>/plugins/<id>/ へ書き込む (アプリが次回ロードで取り込む)。
// GitHub/ローカル同期ユーザはサーバがストレージに書けないため、アプリ内マーケットでインストールする。
async function handleCommunityInstall(request, env) {
    await enforceWriteLimit(request, env);
    const sess = await requireAuth(request, env);
    const body = await request.json().catch(() => ({}));
    const id = String(body.pluginId || body.id || '').trim();
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw httpError(400, 'invalid plugin id');
    const entry = await env.KV.get(`plugin:${id}`, 'json');
    if (!entry) throw httpError(404, 'plugin not found');
    const rawBase = rawGitHubBase(entry.repoUrl, entry.sha, entry.path);
    if (!rawBase) throw httpError(400, 'bad repoUrl');
    const manifestText = await fetchRaw(rawBase + 'manifest.json');
    if (manifestText == null) throw httpError(502, 'manifest.json fetch failed');
    let manifest;
    try { manifest = JSON.parse(manifestText); } catch { throw httpError(502, 'manifest.json invalid'); }
    const files = ['manifest.json', 'index.js'];
    if (Array.isArray(manifest.files)) for (const f of manifest.files) if (typeof f === 'string') files.push(f);
    const written = [];
    let added = 0;
    for (const f of [...new Set(files)]) {
        const safe = safeRel(f);
        const text = f === 'manifest.json' ? manifestText : await fetchRaw(rawBase + safe);
        if (text == null) { if (f === 'index.js') throw httpError(502, `fetch failed: ${f}`); else continue; }
        const key = `data/${sess.uid}/plugins/${id}/${safe}`;
        const head = await env.BUCKET.head(key);
        await env.BUCKET.put(key, text);
        added += new TextEncoder().encode(text).length - (head ? head.size : 0);
        written.push(safe);
    }
    if (added) await addUsage(env, sess.uid, added);
    if (env.DB && typeof env.DB.prepare === 'function') await bumpStat(env, 'plugin', id, 'install_count', 1);
    return json({ ok: true, installed: id, files: written });
}

// 通報 (Phase C: モデレーションキュー)。非表示化は hahero の審査で別途行う。
async function handleCommunityReport(request, env) {
    await enforceWriteLimit(request, env);
    const sess = await requireAuth(request, env);
    requireD1(env);
    const body = await request.json().catch(() => ({}));
    const type = String(body.targetType || body.target_type || '');
    const id = String(body.targetId || body.target_id || '');
    if (!ttOk(type) || !id) throw httpError(400, 'bad target');
    const commentId = String(body.commentId || body.comment_id || '');
    const rid = crypto.randomUUID();
    await env.DB.prepare(
        `INSERT INTO reports (id, target_type, target_id, comment_id, uid, reason, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)`
    ).bind(rid, type, id, commentId, sess.uid, String(body.reason || '').slice(0, 500), Date.now()).run();
    if (commentId) await env.DB.prepare(`UPDATE comments SET report_count = report_count + 1 WHERE id = ?1`).bind(commentId).run();
    return json({ ok: true });
}

export { applyStripeEvent, setPlan, verifyStripeSignature, getPlan, getUsed, handleCheckout, handleAdminSetPlan, isAdminEmail, handleBillingPortal, handleAccountDelete, isStripeMissing, clearStaleStripe, handleListPlugins, handleAdminUpsertPlugin, rawGitHubBase, handleCommunityInstall, handleCommunityStar, handleCommunitySiteUpsert, handleCommunitySitesList, handleCommunitySiteDelete, handleCommunityCommentAdd, handleCommunityCommentsList, handleCommunityPlugins, handleCommunityMyStars, handleCommunityReport, isPlus, bumpStat };

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
// ===== Kindle リレー =====
// ブックマークレットが amazon.co.jp から結果を送り付け、bookshelf 側がポーリングで受け取る。
// UUID は bookshelf 側が生成・Amazon URL に ?bs_relay= で埋め込む。KV TTL 900s で自動失効。
// 認証なし・CORS 全開放 (UUID の 128bit 非推測性がセキュリティ根拠)。

async function handleKindleRelayCreate(request, env) {
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.items)) throw httpError(400, 'need {id, items:[...]}');
    if (!body.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) {
        throw httpError(400, 'invalid relay id');
    }
    if (body.items.length > 10000) throw httpError(400, 'too many items');
    await env.KV.put(`kindle:relay:${body.id}`, JSON.stringify(body.items), { expirationTtl: 900 });
    return json({ ok: true });
}

async function handleKindleRelayGet(request, env, path) {
    const id = path.slice('/kindle/relay/'.length);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw httpError(400, 'invalid relay id');
    }
    const raw = await env.KV.get(`kindle:relay:${id}`);
    if (!raw) return json({ items: null }); // まだ届いていない
    await env.KV.delete(`kindle:relay:${id}`); // 1 回限り消費
    return json({ items: JSON.parse(raw) });
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
function corsAll(res) {
    const h = new Headers(res.headers);
    h.set('Access-Control-Allow-Origin', '*');
    h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type');
    return new Response(res.body, { status: res.status, headers: h });
}
function b64urlToText(s) { return new TextDecoder().decode(b64urlToBytes(s)); }
function b64urlToBytes(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}
