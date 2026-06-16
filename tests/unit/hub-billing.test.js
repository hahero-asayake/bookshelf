// @vitest-environment node
// Stripe 課金ロジック (Worker asayake-hub.js): イベント→プラン反映 / 署名検証 / KV キー分離 (ADR-035)
//  - 決済の実体は Stripe ホスト画面・Webhook。ここでは KV だけに依存する純ロジックを検証する。
//  - レコードは 3 キーに分離 (uid:=identity / plan:=課金 / usage:=使用量) され、頻繁な書込 (addUsage) と
//    課金書込 (setPlan) がキーを共有せず互いをクロバーしない。setPlan/applyStripeEvent はその plan: を書く。
//  - Checkout/Portal の作成 (Stripe REST 呼び出し) は実口座が要るため対象外 (デプロイ後に実機検証)。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyStripeEvent, setPlan, verifyStripeSignature, getPlan, getUsed, handleCheckout } from '../../cf-worker/asayake-hub.js';

// 簡易 KV モック (Cloudflare KV の get(json)/put/delete 互換)
function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        store,
        async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); }
    };
}

const FREE_QUOTA = 100 * 1024 * 1024;
const PLUS_QUOTA = 3 * 1024 * 1024 * 1024;
const env = (KV) => ({ KV, PLUS_QUOTA_BYTES: String(PLUS_QUOTA), QUOTA_BYTES: String(FREE_QUOTA) });

describe('setPlan (plan:<uid> に書く・キー分離)', () => {
    it('plus に上げると plan: の quota を PLUS に・stripe を記録・true を返す。uid:/usage: は触らない', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', email: 'e', status: 'ok' }, 'plan:u1': { plan: 'free', quotaBytes: FREE_QUOTA }, 'usage:u1': '123' });
        const ok = await setPlan(env(KV), 'u1', 'plus', { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });
        expect(ok).toBe(true);
        const p = await KV.get('plan:u1', 'json');
        expect(p.plan).toBe('plus');
        expect(p.quotaBytes).toBe(PLUS_QUOTA);
        expect(p.stripeCustomerId).toBe('cus_1');
        expect(p.stripeSubscriptionId).toBe('sub_1');
        expect(await KV.get('uid:u1', 'json')).toEqual({ siteId: 's1', email: 'e', status: 'ok' }); // identity 不変
        expect(await KV.get('usage:u1')).toBe('123'); // 使用量不変
    });

    it('free に戻すと plan: が Free 既定に・customer は残す (再開時に使える)', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', status: 'ok' }, 'plan:u1': { plan: 'plus', quotaBytes: PLUS_QUOTA, stripeCustomerId: 'cus_1' } });
        await setPlan(env(KV), 'u1', 'free', {});
        const p = await KV.get('plan:u1', 'json');
        expect(p.plan).toBe('free');
        expect(p.quotaBytes).toBe(FREE_QUOTA);
        expect(p.stripeCustomerId).toBe('cus_1');
    });

    it('uid レコードが無ければ false を返し plan: も書かない (退会レース検知)', async () => {
        const KV = makeKV({});
        const ok = await setPlan(env(KV), 'nope', 'plus', {});
        expect(ok).toBe(false);
        expect(await KV.get('plan:nope', 'json')).toBeNull();
    });

    it('旧形式 (uid に plan/quota) からの遷移: plan: が無くても uid から継承して plan: を作る', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', plan: 'free', quotaBytes: FREE_QUOTA, usedBytes: 7 } });
        await setPlan(env(KV), 'u1', 'plus', { stripeCustomerId: 'cus_1' });
        const p = await KV.get('plan:u1', 'json');
        expect(p.plan).toBe('plus');
        expect(p.quotaBytes).toBe(PLUS_QUOTA);
    });
});

describe('getPlan / getUsed の遅延フォールバック', () => {
    it('plan:/usage: が無い旧形式は uid レコードの plan/quota/usedBytes にフォールバック', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', plan: 'plus', quotaBytes: PLUS_QUOTA, usedBytes: 42 } });
        const p = await getPlan(env(KV), 'u1');
        expect(p.plan).toBe('plus');
        expect(p.quotaBytes).toBe(PLUS_QUOTA);
        expect(await getUsed(env(KV), 'u1')).toBe(42);
    });

    it('plan:/usage: があればそれを優先 (uid の旧フィールドは無視)', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', plan: 'free', quotaBytes: FREE_QUOTA, usedBytes: 1 }, 'plan:u1': { plan: 'plus', quotaBytes: PLUS_QUOTA }, 'usage:u1': '999' });
        expect((await getPlan(env(KV), 'u1')).plan).toBe('plus');
        expect(await getUsed(env(KV), 'u1')).toBe(999);
    });
});

describe('applyStripeEvent', () => {
    it('checkout.session.completed で Plus 化し customer→uid 逆引きを張る', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', status: 'ok' }, 'plan:u1': { plan: 'free', quotaBytes: FREE_QUOTA } });
        await applyStripeEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_1' } } }, env(KV));
        const p = await KV.get('plan:u1', 'json');
        expect(p.plan).toBe('plus');
        expect(p.quotaBytes).toBe(PLUS_QUOTA);
        expect(await KV.get('stripe:cus_1')).toBe('u1');
    });

    it('client_reference_id が無ければ何もしない', async () => {
        const KV = makeKV({ 'uid:u1': { status: 'ok' }, 'plan:u1': { plan: 'free', quotaBytes: FREE_QUOTA } });
        await applyStripeEvent({ type: 'checkout.session.completed', data: { object: { customer: 'cus_1' } } }, env(KV));
        expect((await KV.get('plan:u1', 'json')).plan).toBe('free');
    });

    it('checkout で uid レコードが無ければ throw (Stripe にリトライさせる)・orphan 逆引きを張らない', async () => {
        const KV = makeKV({}); // uid:u1 無し (退会済み等)
        await expect(applyStripeEvent({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'u1', customer: 'cus_1' } } }, env(KV))).rejects.toThrow();
        expect(await KV.get('stripe:cus_1')).toBeNull();
    });

    it('customer.subscription.deleted で Free に戻す (customer 逆引き経由)', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', status: 'ok' }, 'plan:u1': { plan: 'plus', quotaBytes: PLUS_QUOTA, stripeCustomerId: 'cus_1' }, 'stripe:cus_1': 'u1' });
        await applyStripeEvent({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1', status: 'canceled' } } }, env(KV));
        const p = await KV.get('plan:u1', 'json');
        expect(p.plan).toBe('free');
        expect(p.quotaBytes).toBe(FREE_QUOTA);
    });

    it('subscription.updated は active 復帰で Plus に戻し・終了ステータスで Free に落とす', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', status: 'ok' }, 'plan:u1': { plan: 'free', quotaBytes: FREE_QUOTA }, 'stripe:cus_1': 'u1' });
        // unpaid で一度 Free (既に free・no-op)
        await applyStripeEvent({ type: 'customer.subscription.updated', data: { object: { customer: 'cus_1', status: 'unpaid' } } }, env(KV));
        expect((await KV.get('plan:u1', 'json')).plan).toBe('free');
        // カード更新で active 復帰 → Plus に戻す
        await applyStripeEvent({ type: 'customer.subscription.updated', data: { object: { customer: 'cus_1', status: 'active', id: 'sub_9' } } }, env(KV));
        expect((await KV.get('plan:u1', 'json')).plan).toBe('plus');
        // 解約 → Free
        await applyStripeEvent({ type: 'customer.subscription.updated', data: { object: { customer: 'cus_1', status: 'canceled' } } }, env(KV));
        expect((await KV.get('plan:u1', 'json')).plan).toBe('free');
    });

    it('未知のイベントは無視', async () => {
        const KV = makeKV({ 'uid:u1': { status: 'ok' }, 'plan:u1': { plan: 'free', quotaBytes: FREE_QUOTA } });
        await applyStripeEvent({ type: 'invoice.created', data: { object: {} } }, env(KV));
        expect((await KV.get('plan:u1', 'json')).plan).toBe('free');
    });
});

describe('サブスク表示メタ (周期/次回更新/解約予約, ADR-035 追補)', () => {
    // subscription.updated から interval / current_period_end / cancel_at_period_end を plan: に取り込む
    function subUpdated(status, extra = {}) {
        return { type: 'customer.subscription.updated', data: { object: {
            id: 'sub_9', customer: 'cus_1', status,
            cancel_at_period_end: !!extra.cancel,
            current_period_end: extra.periodEnd,
            items: { data: [{ price: { recurring: { interval: extra.interval || 'month' } } }] }
        } } };
    }

    it('active のサブスク更新で周期・次回更新日を取り込む (getPlan が返す)', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', status: 'ok' }, 'plan:u1': { plan: 'free', quotaBytes: FREE_QUOTA }, 'stripe:cus_1': 'u1' });
        await applyStripeEvent(subUpdated('active', { interval: 'year', periodEnd: 1800000000 }), env(KV));
        const p = await getPlan(env(KV), 'u1');
        expect(p.plan).toBe('plus');
        expect(p.interval).toBe('year');
        expect(p.currentPeriodEnd).toBe(1800000000);
        expect(p.cancelAtPeriodEnd).toBe(false);
    });

    it('解約予約 (cancel_at_period_end=true・status=active) は Plus を維持しつつ予約フラグを立てる', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', status: 'ok' }, 'plan:u1': { plan: 'plus', quotaBytes: PLUS_QUOTA, stripeCustomerId: 'cus_1' }, 'stripe:cus_1': 'u1' });
        await applyStripeEvent(subUpdated('active', { interval: 'month', periodEnd: 1700000000, cancel: true }), env(KV));
        const p = await getPlan(env(KV), 'u1');
        expect(p.plan).toBe('plus');             // 期間末まで Plus
        expect(p.cancelAtPeriodEnd).toBe(true);  // 予約フラグ
        expect(p.currentPeriodEnd).toBe(1700000000);
    });

    it('期間満了で deleted → Free 降格時に周期/更新日/解約予約をクリア', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', status: 'ok' },
            'plan:u1': { plan: 'plus', quotaBytes: PLUS_QUOTA, stripeCustomerId: 'cus_1', interval: 'month', currentPeriodEnd: 1700000000, cancelAtPeriodEnd: true },
            'stripe:cus_1': 'u1' });
        await applyStripeEvent({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1', status: 'canceled' } } }, env(KV));
        const p = await getPlan(env(KV), 'u1');
        expect(p.plan).toBe('free');
        expect(p.interval).toBeUndefined();
        expect(p.currentPeriodEnd).toBeUndefined();
        expect(p.cancelAtPeriodEnd).toBe(false);
    });

    it('周期変更 (月→年) は interval を上書きする', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', status: 'ok' },
            'plan:u1': { plan: 'plus', quotaBytes: PLUS_QUOTA, stripeCustomerId: 'cus_1', interval: 'month', currentPeriodEnd: 1700000000 },
            'stripe:cus_1': 'u1' });
        await applyStripeEvent(subUpdated('active', { interval: 'year', periodEnd: 1731536000 }), env(KV));
        const p = await getPlan(env(KV), 'u1');
        expect(p.interval).toBe('year');
        expect(p.currentPeriodEnd).toBe(1731536000);
    });
});

describe('verifyStripeSignature', () => {
    async function sign(payload, secret, t) {
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`));
        return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    it('正しい署名は parse 済みイベントを返す', async () => {
        const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
        const t = Math.floor(Date.now() / 1000);
        const v1 = await sign(payload, 'whsec_test', t);
        const event = await verifyStripeSignature(payload, `t=${t},v1=${v1}`, 'whsec_test');
        expect(event.type).toBe('checkout.session.completed');
    });

    it('改ざん署名は拒否', async () => {
        const payload = JSON.stringify({ type: 'x' });
        const t = Math.floor(Date.now() / 1000);
        await expect(verifyStripeSignature(payload, `t=${t},v1=deadbeef`, 'whsec_test')).rejects.toThrow();
    });

    it('古いタイムスタンプは拒否 (リプレイ対策)', async () => {
        const payload = JSON.stringify({ type: 'x' });
        const t = Math.floor(Date.now() / 1000) - 10000;
        const v1 = await sign(payload, 'whsec_test', t);
        await expect(verifyStripeSignature(payload, `t=${t},v1=${v1}`, 'whsec_test')).rejects.toThrow(/tolerance/);
    });
});

describe('handleCheckout (Managed Payments, ADR-037)', () => {
    afterEach(() => vi.unstubAllGlobals());

    function checkoutEnv(KV, extra = {}) {
        return { KV, STRIPE_SECRET_KEY: 'sk_test', STRIPE_PRICE_MONTHLY: 'price_m', STRIPE_PRICE_YEARLY: 'price_y',
                 APP_ORIGIN: 'https://app.example', ...extra };
    }
    function authedRequest(body) {
        return new Request('https://hub.example/billing/checkout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer hk_abc', 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }
    // fetch をモックして Stripe へ渡る form / ヘッダを捕捉する
    function stubStripe() {
        const captured = {};
        vi.stubGlobal('fetch', async (url, opts) => {
            captured.url = url; captured.opts = opts;
            return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/xyz' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        });
        return captured;
    }

    it('managed_payments[enabled]=true と プレビュー版ヘッダを付けて Checkout を作る', async () => {
        const KV = makeKV({ 'key:hk_abc': { uid: 'u1', siteId: 's1' }, 'uid:u1': { email: 'e@x' } });
        const cap = stubStripe();
        const res = await handleCheckout(authedRequest({ plan: 'monthly', returnUrl: 'https://app.example/bookshelf/' }), checkoutEnv(KV));
        expect((await res.json()).url).toBe('https://checkout.stripe.com/c/xyz');
        expect(cap.url).toBe('https://api.stripe.com/v1/checkout/sessions');
        expect(cap.opts.headers['Stripe-Version']).toBe('2026-02-25.preview');   // 既定 = プレビュー版
        expect(cap.opts.body.get('managed_payments[enabled]')).toBe('true');      // MoR 化
        expect(cap.opts.body.get('mode')).toBe('subscription');
        expect(cap.opts.body.get('line_items[0][price]')).toBe('price_m');
        expect(cap.opts.body.get('client_reference_id')).toBe('u1');              // Webhook で uid 特定
    });

    it('plan=yearly は年額 Price を使い、STRIPE_API_VERSION で版を上書きできる', async () => {
        const KV = makeKV({ 'key:hk_abc': { uid: 'u1', siteId: 's1' }, 'uid:u1': { email: 'e@x' } });
        const cap = stubStripe();
        await handleCheckout(authedRequest({ plan: 'yearly' }), checkoutEnv(KV, { STRIPE_API_VERSION: '2026-03-01.preview' }));
        expect(cap.opts.headers['Stripe-Version']).toBe('2026-03-01.preview');
        expect(cap.opts.body.get('line_items[0][price]')).toBe('price_y');
    });

    it('STRIPE_SECRET_KEY 未設定なら 503 (口座準備前は課金無効)', async () => {
        const KV = makeKV({ 'key:hk_abc': { uid: 'u1' } });
        await expect(handleCheckout(authedRequest({ plan: 'monthly' }), { KV, STRIPE_PRICE_MONTHLY: 'price_m' }))
            .rejects.toMatchObject({ status: 503 });
    });

    it('Price がプレースホルダ (REPLACE_) なら 503', async () => {
        const KV = makeKV({ 'key:hk_abc': { uid: 'u1' } });
        const cap = stubStripe();
        await expect(handleCheckout(authedRequest({ plan: 'monthly' }), checkoutEnv(KV, { STRIPE_PRICE_MONTHLY: 'REPLACE_price_monthly' })))
            .rejects.toMatchObject({ status: 503 });
        expect(cap.url).toBeUndefined();   // Stripe を叩く前に弾く
    });
});
