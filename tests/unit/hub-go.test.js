// @vitest-environment node
// /go/<siteId>/<asin> アフィリンク・リダイレクタ (ADR-034追補・ADR-058 §11.10)
//  - Amazon アソシエイト規約: Referrer を落とすと流入元が判別できずアフィリエイトが無効化されうる。
//    no-referrer は不採用、既定 (strict-origin-when-cross-origin) で origin までは渡す。
import { describe, it, expect } from 'vitest';
import { handleGo, serveHeaders } from '../../cf-worker/asayake-hub.js';

function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        store,
        async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); }
    };
}

const env = (KV) => ({ KV, OPERATOR_AFFILIATE_TAG: 'operator-tag-01' });

describe('handleGo (/go/<siteId>/<asin>)', () => {
    it('Referrer-Policy は no-referrer にしない (strict-origin-when-cross-origin で流入元を判別可能にする)', async () => {
        const KV = makeKV({});
        const res = await handleGo(new Request('https://hub.test/go/site1/B000000001'), env(KV), '/go/site1/B000000001');
        expect(res.status).toBe(302);
        expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        expect(res.headers.get('Referrer-Policy')).not.toBe('no-referrer');
    });

    it('Free/未解決は運営タグで Amazon へ 302・キャッシュさせない', async () => {
        const KV = makeKV({});
        const res = await handleGo(new Request('https://hub.test/go/site1/B000000001'), env(KV), '/go/site1/B000000001');
        expect(res.headers.get('Location')).toBe('https://www.amazon.co.jp/dp/B000000001?tag=operator-tag-01');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('Plus ユーザーは本人タグで解決する', async () => {
        const KV = makeKV({
            'site:site1': 'u1',
            'plan:u1': { plan: 'plus', quotaBytes: 1 },
            'uid:u1': { siteId: 'site1', affiliateTag: 'mytag-22' }
        });
        const res = await handleGo(new Request('https://hub.test/go/site1/B000000001'), env(KV), '/go/site1/B000000001');
        expect(res.headers.get('Location')).toBe('https://www.amazon.co.jp/dp/B000000001?tag=mytag-22');
    });

    it('ASIN の文字種が不正なら 400 (オープンリダイレクト防止)', async () => {
        const KV = makeKV({});
        const res = await handleGo(new Request('https://hub.test/go/site1/../evil'), env(KV), '/go/site1/../evil');
        expect(res.status).toBe(400);
    });
});

describe('serveHeaders (公開ページ本体配信ヘッダ)', () => {
    it('script 無し CSP・nosniff は維持 (公開ページの安全性はこちらが担保)', () => {
        const h = serveHeaders('text/html');
        expect(h['Content-Security-Policy']).toContain("default-src 'none'");
        expect(h['X-Content-Type-Options']).toBe('nosniff');
    });
});
