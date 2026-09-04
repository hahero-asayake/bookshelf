// @vitest-environment node
// bookshelf.asayake.org 配信 Worker (S6・ADR-076): username → siteId 解決・予約語ガード・改名301・配信
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../cf-worker/bookshelf-cdn.js';

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
    globalThis.caches = { default: { async match() { return null; }, async put() {} } };
});

const env = (KV, BUCKET) => ({ KV, BUCKET });
const ctx = { waitUntil() {} };

describe('bookshelf-cdn Worker', () => {
    it('①予約語 (top) は username 解決を試みず 404', async () => {
        const KV = makeKV({ 'uname:top': { uid: 'someone', siteId: 'siteX' } }); // 万一登録されていても無視
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/top/'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(404);
    });

    it('②除外パス (favicon.ico) は username 解決を試みず 404', async () => {
        const KV = makeKV({});
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/favicon.ico'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(404);
    });

    it('未登録 username は 404', async () => {
        const KV = makeKV({});
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/nobody/'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(404);
    });

    it('登録済み username のトップは R2 sites/<siteId>/index.html を配信 (CSP script無し)', async () => {
        const KV = makeKV({ 'uname:taro-books': { uid: 'u1', siteId: 'site1' } });
        const BUCKET = makeBucket({ 'sites/site1/index.html': '<html>profile</html>' });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/taro-books/'), env(KV, BUCKET), ctx);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('<html>profile</html>');
        expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('記事 (publicId) は R2 sites/<siteId>/<publicId>/index.html を配信', async () => {
        const KV = makeKV({ 'uname:taro-books': { uid: 'u1', siteId: 'site1' } });
        const BUCKET = makeBucket({ 'sites/site1/aB3xQ9k2Lm/index.html': '<html>article</html>' });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/taro-books/aB3xQ9k2Lm/'), env(KV, BUCKET), ctx);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('<html>article</html>');
    });

    it('改名した旧 username は新 username へ 301 (movedTo)', async () => {
        const KV = makeKV({ 'uname:old-name': { uid: 'u1', siteId: 'site1', movedTo: 'new-name' } });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/old-name/'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(301);
        expect(res.headers.get('Location')).toBe('https://bookshelf.asayake.org/new-name/');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('通報停止中 (report:suspended) は 451', async () => {
        const KV = makeKV({ 'uname:taro-books': { uid: 'u1', siteId: 'site1' }, 'report:site1': { status: 'suspended' } });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/taro-books/'), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(451);
    });

    it('".." を含む URL は WHATWG URL 正規化で解決され、意図しないパスに抜けない (username = "secret" として解決を試みるだけ)', async () => {
        // new URL() の時点で /taro-books/../secret → /secret に正規化される (Node/Workers 共通の URL 実装)。
        // コード側の split('..') チェックは万一の防御であり実際には到達しない。ここではその前提=安全側に
        // 倒れる (未登録 username として 404 になる。site1 の R2 中身には抜けない) ことを検証する。
        const KV = makeKV({ 'uname:taro-books': { uid: 'u1', siteId: 'site1' } });
        const BUCKET = makeBucket({ 'sites/site1/index.html': '<html>should not leak</html>' });
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/taro-books/../secret'), env(KV, BUCKET), ctx);
        expect(res.status).toBe(404);
    });

    it('POST は 405', async () => {
        const KV = makeKV({});
        const res = await worker.fetch(new Request('https://bookshelf.asayake.org/taro-books/', { method: 'POST' }), env(KV, makeBucket()), ctx);
        expect(res.status).toBe(405);
    });
});
