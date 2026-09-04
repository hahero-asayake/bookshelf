// @vitest-environment node
// GET /public/<siteId>/… の 301 移行 (S6・ADR-076・設計書 09 §10.3-v2「/go の扱い」直下の 301設計)
//  - username 移行済みの siteId は bookshelf.asayake.org/<username>/ へ 301 する
//  - username 未設定 (=移行未了) の siteId は従来どおり /public/<siteId>/ を配信し続ける (段階移行)
//  - 旧 slug 単位の 301 マッピングは新設しない (ADR-006 と衝突するため) → 常にトップへ1系統のみ
import { describe, it, expect, beforeEach } from 'vitest';
import { serveSite } from '../../cf-worker/asayake-hub.js';

function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        store,
        async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); }
    };
}

function makeBucket(files = {}) {
    return {
        async get(key) {
            const body = files[key];
            if (body == null) return null;
            return { body, httpEtag: '"etag"' };
        }
    };
}

beforeEach(() => {
    // Worker ランタイムの Cache API をテスト用にスタブ (node 環境にはグローバル定義が無いため)
    globalThis.caches = { default: { async match() { return null; }, async put() {} } };
});

const env = (KV, BUCKET) => ({ KV, BUCKET });

describe('serveSite (/public/<siteId>/…) の username 移行対応', () => {
    it('username 移行済み siteId は bookshelf.asayake.org/<username>/ へ 301・no-store', async () => {
        const KV = makeKV({ 'site:site1': 'u1', 'uid:u1': { siteId: 'site1', username: 'taro-books' } });
        const res = await serveSite(new Request('https://hub.test/public/site1/'), env(KV, makeBucket()), '/public/site1/');
        expect(res.status).toBe(301);
        expect(res.headers.get('Location')).toBe('https://bookshelf.asayake.org/taro-books/');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('旧 slug 個別パスへのアクセスも一律トップへ 301 (slug 単位のマッピングは持たない)', async () => {
        const KV = makeKV({ 'site:site1': 'u1', 'uid:u1': { siteId: 'site1', username: 'taro-books' } });
        const res = await serveSite(new Request('https://hub.test/public/site1/my-old-slug/'), env(KV, makeBucket()), '/public/site1/my-old-slug/');
        expect(res.status).toBe(301);
        expect(res.headers.get('Location')).toBe('https://bookshelf.asayake.org/taro-books/');
    });

    it('username 未設定 (移行未了) の siteId は従来どおり R2 から配信する', async () => {
        const KV = makeKV({ 'site:site1': 'u1', 'uid:u1': { siteId: 'site1' } }); // username 無し
        const BUCKET = makeBucket({ 'sites/site1/index.html': '<html>old</html>' });
        const res = await serveSite(new Request('https://hub.test/public/site1/'), env(KV, BUCKET), '/public/site1/');
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('<html>old</html>');
    });

    it('site: 逆引きが無い siteId (未知/退会後) も従来どおり配信を試みる (404 等は既存挙動のまま)', async () => {
        const KV = makeKV({});
        const BUCKET = makeBucket({ 'sites/unknown/index.html': '<html>x</html>' });
        const res = await serveSite(new Request('https://hub.test/public/unknown/'), env(KV, BUCKET), '/public/unknown/');
        expect(res.status).toBe(200);
    });
});
