// @vitest-environment node
// Stripe 課金ロジック (Worker asayake-hub.js): イベント→プラン反映 / 署名検証 (ADR-035)
//  - 決済の実体は Stripe ホスト画面・Webhook。ここでは KV だけに依存する純ロジックを検証する。
//  - Checkout/Portal の作成 (Stripe REST 呼び出し) は実口座が要るため対象外 (デプロイ後に実機検証)。
import { describe, it, expect } from 'vitest';
import { applyStripeEvent, setPlan, verifyStripeSignature } from '../../cf-worker/asayake-hub.js';

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

describe('setPlan', () => {
    it('plus に上げると quota を PLUS_QUOTA_BYTES に・customer/subscription を記録・既存使用量は保持', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', plan: 'free', quotaBytes: FREE_QUOTA, usedBytes: 10 } });
        await setPlan(env(KV), 'u1', 'plus', { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });
        const rec = await KV.get('uid:u1', 'json');
        expect(rec.plan).toBe('plus');
        expect(rec.quotaBytes).toBe(PLUS_QUOTA);
        expect(rec.stripeCustomerId).toBe('cus_1');
        expect(rec.stripeSubscriptionId).toBe('sub_1');
        expect(rec.usedBytes).toBe(10);
    });

    it('free に戻すと quota を Free 既定に・customer は残す (再開時に使える)', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', plan: 'plus', quotaBytes: PLUS_QUOTA, usedBytes: 5, stripeCustomerId: 'cus_1' } });
        await setPlan(env(KV), 'u1', 'free', {});
        const rec = await KV.get('uid:u1', 'json');
        expect(rec.plan).toBe('free');
        expect(rec.quotaBytes).toBe(FREE_QUOTA);
        expect(rec.stripeCustomerId).toBe('cus_1');
    });

    it('存在しない uid は無視 (レコードを作らない)', async () => {
        const KV = makeKV({});
        await setPlan(env(KV), 'nope', 'plus', {});
        expect(await KV.get('uid:nope', 'json')).toBeNull();
    });
});

describe('applyStripeEvent', () => {
    it('checkout.session.completed で Plus 化し customer→uid 逆引きを張る', async () => {
        const KV = makeKV({ 'uid:u1': { siteId: 's1', plan: 'free', quotaBytes: FREE_QUOTA, usedBytes: 0 } });
        await applyStripeEvent({
            type: 'checkout.session.completed',
            data: { object: { client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_1' } }
        }, env(KV));
        const rec = await KV.get('uid:u1', 'json');
        expect(rec.plan).toBe('plus');
        expect(rec.quotaBytes).toBe(PLUS_QUOTA);
        expect(await KV.get('stripe:cus_1')).toBe('u1');
    });

    it('client_reference_id が無ければ何もしない', async () => {
        const KV = makeKV({ 'uid:u1': { plan: 'free', quotaBytes: FREE_QUOTA } });
        await applyStripeEvent({ type: 'checkout.session.completed', data: { object: { customer: 'cus_1' } } }, env(KV));
        expect((await KV.get('uid:u1', 'json')).plan).toBe('free');
    });

    it('customer.subscription.deleted で Free に戻す (customer 逆引き経由)', async () => {
        const KV = makeKV({
            'uid:u1': { siteId: 's1', plan: 'plus', quotaBytes: PLUS_QUOTA, usedBytes: 0, stripeCustomerId: 'cus_1' },
            'stripe:cus_1': 'u1'
        });
        await applyStripeEvent({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1', status: 'canceled' } } }, env(KV));
        const rec = await KV.get('uid:u1', 'json');
        expect(rec.plan).toBe('free');
        expect(rec.quotaBytes).toBe(FREE_QUOTA);
    });

    it('subscription.updated は終了ステータスのときだけ降格 (active は維持)', async () => {
        const KV = makeKV({
            'uid:u1': { siteId: 's1', plan: 'plus', quotaBytes: PLUS_QUOTA, usedBytes: 0 },
            'stripe:cus_1': 'u1'
        });
        await applyStripeEvent({ type: 'customer.subscription.updated', data: { object: { customer: 'cus_1', status: 'active' } } }, env(KV));
        expect((await KV.get('uid:u1', 'json')).plan).toBe('plus');
        await applyStripeEvent({ type: 'customer.subscription.updated', data: { object: { customer: 'cus_1', status: 'canceled' } } }, env(KV));
        expect((await KV.get('uid:u1', 'json')).plan).toBe('free');
    });

    it('未知のイベントは無視', async () => {
        const KV = makeKV({ 'uid:u1': { plan: 'free', quotaBytes: FREE_QUOTA } });
        await applyStripeEvent({ type: 'invoice.created', data: { object: {} } }, env(KV));
        expect((await KV.get('uid:u1', 'json')).plan).toBe('free');
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
