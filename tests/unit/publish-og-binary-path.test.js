// og.png (バイナリ) を公開先へ載せる経路 (S5・ADR-098): GitHub adapter / hub adapter / hub worker の後方互換つき検証。
//  - encoding 未指定 = 従来どおり UTF-8 文字列 (旧アプリ ↔ 新 worker / 新アプリ ↔ 旧 worker の双方で壊さない)
//  - encoding='base64' = バイナリ。worker は PNG のみ受け付け、quota はデコード後のバイト長で計量する。
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../../cf-worker/asayake-hub.js';
import cdn from '../../cf-worker/bookshelf-cdn.js';

// ---- GitHub adapter ----
globalThis.window = globalThis.window || globalThis;
await import('../../js/storage-adapter.js');
await import('../../js/github-adapter.js');
const GitHubAdapter = globalThis.GitHubAdapter;
await import('../../js/hub-adapter.js');
const HubStorageAdapter = globalThis.HubStorageAdapter;

const PNG = new Uint8Array(3000); PNG.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); PNG[10] = 200; PNG[2999] = 7;
const PNG_B64 = Buffer.from(PNG).toString('base64');

describe('GitHubAdapter.commitBatch: バイナリ (encoding=base64) の透過', () => {
    let bodies;
    beforeEach(() => {
        bodies = [];
        const seq = [
            () => ({ object: { sha: 'r1' } }), () => ({ tree: { sha: 't1' } }),
            null,   // blob (下で本文を記録)
        ];
        globalThis.fetch = vi.fn(async (url, init = {}) => {
            const u = String(url);
            const j = (o) => new Response(JSON.stringify(o), { status: 200 });
            if (u.includes('/git/refs/heads/') && (init.method || 'GET') === 'GET') return j({ object: { sha: 'r1' } });
            if (u.includes('/git/commits/')) return j({ tree: { sha: 't1' } });
            if (u.endsWith('/git/blobs')) { bodies.push(JSON.parse(init.body)); return j({ sha: `blob${bodies.length}` }); }
            if (u.endsWith('/git/trees')) return j({ sha: 'nt' });
            if (u.endsWith('/git/commits')) return j({ sha: 'nc' });
            if (u.includes('/git/refs/heads/')) return j({ object: { sha: 'nc' } });
            throw new Error('unexpected ' + u);
        });
    });

    it('文字列は従来どおり UTF-8→base64、encoding=base64 はそのまま blob (二重エンコードしない)', async () => {
        const a = new GitHubAdapter({ owner: 'o', repo: 'r', branch: 'main', basePath: '', token: 't' });
        a.beginBatch();
        a.addBatchEntry('a/index.html', '<p>日本語</p>');
        a.addBatchEntry('a/og.png', PNG_B64, 'base64');
        await a.commitBatch('m');
        expect(bodies).toHaveLength(2);
        expect(Buffer.from(bodies[0].content, 'base64').toString('utf-8')).toBe('<p>日本語</p>');
        expect(bodies[1].encoding).toBe('base64');
        expect(bodies[1].content).toBe(PNG_B64);
        expect(Buffer.from(bodies[1].content, 'base64').equals(Buffer.from(PNG))).toBe(true);
    });
});

describe('HubStorageAdapter.publishSite: encoding を送る (未指定は従来の形のまま)', () => {
    it('文字列ファイルは { path, content } のまま・og.png だけ encoding=base64 が付く', async () => {
        let sent;
        globalThis.fetch = vi.fn(async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true }), { status: 200 }); });
        const h = new HubStorageAdapter({ apiBase: 'https://hub.test', getKey: () => 'hk_x' });
        await h.publishSite([{ path: 'a/index.html', content: '<p>x</p>' }, { path: 'a/og.png', content: PNG_B64, encoding: 'base64' }], true, '');
        expect(sent.files[0]).toEqual({ path: 'a/index.html', content: '<p>x</p>' });
        expect(sent.files[1]).toEqual({ path: 'a/og.png', content: PNG_B64, encoding: 'base64' });
    });
});

// ---- hub worker (POST /publish) ----
function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return { store, async get(k, t) { const v = store.get(k); if (v == null) return null; return t === 'json' ? JSON.parse(v) : v; }, async put(k, v) { store.set(k, v); }, async delete(k) { store.delete(k); }, async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; } };
}
const sizeOf = (v) => (typeof v === 'string' ? new TextEncoder().encode(v).length : v.byteLength);
function makeR2() {
    const store = new Map();
    return { store, async get(k) { const v = store.get(k); return v == null ? null : { body: v, httpEtag: '"e"', size: sizeOf(v) }; }, async put(k, body) { store.set(k, body); }, async delete(k) { store.delete(k); }, async list({ prefix = '' } = {}) { return { objects: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: sizeOf(v) })), truncated: false }; } };
}

describe('hub worker POST /publish: base64 PNG のデコード・後方互換・quota', () => {
    let KV, R2, env;
    const KEY = 'hk_abc123';
    beforeEach(() => {
        KV = makeKV({
            [`key:${KEY}`]: { uid: 'u1', siteId: 'site1', created: 1 },
            'uid:u1': { uid: 'u1', siteId: 'site1', createdAt: 0 },
            'plan:u1': { plan: 'free', quotaBytes: 10000 }
        });
        R2 = makeR2();
        env = { KV, BUCKET: R2, GOOGLE_CLIENT_ID: 'c', HUB_DOMAIN: 'hub.test' };
    });
    const publish = (files, deleteMissing = true) => worker.fetch(new Request('https://hub.test/publish', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ files, deleteMissing }) }), env, {});
    const used = async () => Number(await KV.get('usage:u1') || 0);

    it('後方互換: encoding 無しの従来の文字列ファイルは今までどおり保存され、バイト長で計量される', async () => {
        const res = await publish([{ path: 'index.html', content: '<p>日本語</p>' }]);
        expect(res.status).toBe(200);
        expect(R2.store.get('sites/site1/index.html')).toBe('<p>日本語</p>');
        expect(await used()).toBe(new TextEncoder().encode('<p>日本語</p>').length);
    });

    it('base64 の og.png は PNG バイト列として R2 に保存され、quota はデコード後のバイト長 (base64 の文字数ではない)', async () => {
        const res = await publish([{ path: 'a/index.html', content: '<p>x</p>' }, { path: 'a/og.png', content: PNG_B64, encoding: 'base64' }]);
        expect(res.status).toBe(200);
        const stored = R2.store.get('sites/site1/a/og.png');
        expect(stored instanceof Uint8Array).toBe(true);
        expect(Buffer.from(stored).equals(Buffer.from(PNG))).toBe(true);
        expect(await used()).toBe(8 + PNG.length);
        expect(PNG_B64.length).toBeGreaterThan(PNG.length);   // base64 で数えていたら別の値になる
    });

    it('quota 超過は 413 で R2 に何も書かない (デコード後サイズで判定)', async () => {
        const big = new Uint8Array(9000); big.set(PNG.subarray(0, 8));
        const res = await publish([{ path: 'a/og.png', content: Buffer.from(big).toString('base64'), encoding: 'base64' }, { path: 'a/index.html', content: 'y'.repeat(2000) }]);
        expect(res.status).toBe(413);
        expect(R2.store.size).toBe(0);
    });

    it('不正入力は 400: .png 以外への base64・PNG でないバイト列・壊れた base64・未知の encoding', async () => {
        const bad = [
            [{ path: 'a/index.html', content: PNG_B64, encoding: 'base64' }],
            [{ path: 'a/og.png', content: Buffer.from('not a png at all').toString('base64'), encoding: 'base64' }],
            [{ path: 'a/og.png', content: '***', encoding: 'base64' }],
            [{ path: 'a/og.png', content: PNG_B64, encoding: 'hex' }]
        ];
        for (const files of bad) expect((await publish(files)).status).toBe(400);
        expect(R2.store.size).toBe(0);
    });

    it('512KB を超えるバイナリは 413', async () => {
        const huge = new Uint8Array(512 * 1024 + 1); huge.set(PNG.subarray(0, 8));
        expect((await publish([{ path: 'a/og.png', content: Buffer.from(huge).toString('base64'), encoding: 'base64' }])).status).toBe(413);
    });

    it('回帰防止: 入力ハッシュで書込を省いた og.png が公開先に残るのは「出力集合に載せ続ける」時だけ。載せなければ deleteMissing で消える (ハブは常に送る設計の根拠)', async () => {
        await publish([{ path: 'a/index.html', content: 'v1' }, { path: 'a/og.png', content: PNG_B64, encoding: 'base64' }]);
        expect(R2.store.has('sites/site1/a/og.png')).toBe(true);
        await publish([{ path: 'a/index.html', content: 'v2' }, { path: 'a/og.png', content: PNG_B64, encoding: 'base64' }]);   // 常に送る
        expect(R2.store.has('sites/site1/a/og.png')).toBe(true);
        await publish([{ path: 'a/index.html', content: 'v3' }]);   // 送らなければ消える
        expect(R2.store.has('sites/site1/a/og.png')).toBe(false);
    });
});

describe('公開した og.png の配信 (worker の実経路: POST /publish → GET)', () => {
    it('bookshelf.asayake.org/<username>/<publicId>/og.png と hub.asayake.org/public/<siteId>/... の両方が image/png で同じバイト列を返す', async () => {
        const KV = makeKV({
            'key:hk_abc123': { uid: 'u1', siteId: 'site1', created: 1 },
            'uid:u1': { uid: 'u1', siteId: 'site1', createdAt: 0, username: 'hahero' },
            'uname:hahero': { uid: 'u1', siteId: 'site1' },
            'plan:u1': { plan: 'free', quotaBytes: 1000000 }
        });
        const R2 = makeR2();
        const env = { KV, BUCKET: R2, GOOGLE_CLIENT_ID: 'c', HUB_DOMAIN: 'hub.test' };
        globalThis.caches = { default: { async match() { return null; }, async put() {} } };
        const pub = await worker.fetch(new Request('https://hub.test/publish', { method: 'POST', headers: { Authorization: 'Bearer hk_abc123' }, body: JSON.stringify({ files: [{ path: 'pid1/index.html', content: '<p>x</p>' }, { path: 'pid1/og.png', content: PNG_B64, encoding: 'base64' }], deleteMissing: true }) }), env, {});
        expect(pub.status).toBe(200);

        const viaCdn = await cdn.fetch(new Request('https://bookshelf.asayake.org/hahero/pid1/og.png'), env, { waitUntil() {} });
        expect(viaCdn.status).toBe(200);
        expect(viaCdn.headers.get('Content-Type')).toBe('image/png');
        expect(Buffer.from(await viaCdn.arrayBuffer()).equals(Buffer.from(PNG))).toBe(true);

        const viaHub = await worker.fetch(new Request('https://hub.test/public/site1/pid1/og.png'), env, {});
        expect(viaHub.status).toBe(200);
        expect(viaHub.headers.get('Content-Type')).toBe('image/png');
        expect(Buffer.from(await viaHub.arrayBuffer()).equals(Buffer.from(PNG))).toBe(true);
    });
});
