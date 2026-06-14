// HubStorageAdapter のテスト (ADR-032, 09 §10.5)
// fetch をモックして read/write/ETag 楽観ロック/list/batch/認証/パス検証を確認する。
import { describe, it, expect, beforeEach, vi } from 'vitest';

await import('../../js/storage-adapter.js');
await import('../../js/hub-adapter.js');
const { HubStorageAdapter, HubConflictError, HubAuthError, HubQuotaError } = globalThis;

const API = 'https://api.asayake.test';

// 簡易ルータ: routes[`${method} ${pathname}`] = (req) => Response
function mockFetch(routes) {
    const fn = vi.fn(async (url, init = {}) => {
        const u = new URL(url);
        const method = (init.method || 'GET').toUpperCase();
        const key = `${method} ${u.pathname}`;
        const handler = routes[key] || routes[`${method} *`];
        if (!handler) throw new Error(`no mock route for ${key}`);
        return handler({ url: u, init, method });
    });
    globalThis.fetch = fn;
    return fn;
}

function res(body, status = 200, headers = {}) {
    return new Response(body, { status, headers });
}

let adapter;
beforeEach(() => {
    adapter = new HubStorageAdapter({ apiBase: API, getKey: () => 'hk_deadbeef' });
});

describe('read', () => {
    it('readJSON は 200 本文をパースし ETag をキャッシュ', async () => {
        mockFetch({ 'GET /data/private/library.json': () => res('{"books":[1,2]}', 200, { ETag: '"e1"' }) });
        const data = await adapter.readJSON('private/library.json');
        expect(data).toEqual({ books: [1, 2] });
        expect(adapter._etagCache.get('private/library.json')).toBe('"e1"');
    });

    it('404 は null (存在しないファイル)', async () => {
        mockFetch({ 'GET /data/private/x.json': () => res(null, 404) });
        expect(await adapter.readJSON('private/x.json')).toBeNull();
    });

    it('readText は本文をそのまま返す', async () => {
        mockFetch({ 'GET /data/private/books/a.md': () => res('# memo', 200, { ETag: '"m1"' }) });
        expect(await adapter.readText('private/books/a.md')).toBe('# memo');
    });
});

describe('write + 楽観ロック', () => {
    it('キャッシュ ETag があれば HEAD せず If-Match 付きで PUT', async () => {
        // 先に read して ETag をキャッシュ
        mockFetch({
            'GET /data/private/m.json': () => res('{}', 200, { ETag: '"v1"' }),
            'PUT /data/private/m.json': ({ init }) => {
                expect(init.headers['If-Match']).toBe('"v1"');
                return res(null, 200, { ETag: '"v2"' });
            }
        });
        await adapter.readJSON('private/m.json');
        await adapter.writeJSON('private/m.json', { a: 1 });
        expect(adapter._etagCache.get('private/m.json')).toBe('"v2"');
    });

    it('ETag 未知なら HEAD で現状確認 → 新規(404)は If-Match 無しで PUT', async () => {
        const calls = [];
        mockFetch({
            'HEAD /data/private/new.json': () => { calls.push('head'); return res(null, 404); },
            'PUT /data/private/new.json': ({ init }) => {
                calls.push('put');
                expect(init.headers['If-Match']).toBeUndefined();
                return res(null, 200, { ETag: '"n1"' });
            }
        });
        await adapter.writeJSON('private/new.json', { x: 1 });
        expect(calls).toEqual(['head', 'put']);
    });

    it('412 は HubConflictError', async () => {
        mockFetch({
            'GET /data/private/c.json': () => res('{}', 200, { ETag: '"a"' }),
            'PUT /data/private/c.json': () => res('conflict', 412)
        });
        await adapter.readJSON('private/c.json');
        await expect(adapter.writeJSON('private/c.json', { y: 2 })).rejects.toBeInstanceOf(HubConflictError);
    });

    it('413 は HubQuotaError', async () => {
        mockFetch({
            'HEAD /data/private/big.json': () => res(null, 404),
            'PUT /data/private/big.json': () => res('too big', 413)
        });
        await expect(adapter.writeJSON('private/big.json', { z: 3 })).rejects.toBeInstanceOf(HubQuotaError);
    });
});

describe('list', () => {
    it('listFiles / listDirs は ?list=1 のレスポンスを振り分ける', async () => {
        mockFetch({ 'GET /data/private/bookshelves': () => res(JSON.stringify({ files: ['all.json', 'tech.json'], dirs: ['sub'] }), 200) });
        expect(await adapter.listFiles('private/bookshelves')).toEqual(['all.json', 'tech.json']);
        mockFetch({ 'GET /data/private/bookshelves': () => res(JSON.stringify({ files: ['all.json'], dirs: ['sub'] }), 200) });
        expect(await adapter.listDirs('private/bookshelves')).toEqual(['sub']);
    });

    it('404 の dir は空配列', async () => {
        mockFetch({ 'GET /data/private/none': () => res(null, 404) });
        expect(await adapter.listFiles('private/none')).toEqual([]);
    });
});

describe('delete', () => {
    it('204 で成功・ETag キャッシュを破棄', async () => {
        mockFetch({ 'DELETE /data/private/d.json': () => res(null, 204) });
        adapter._etagCache.set('private/d.json', '"x"');
        await adapter.deleteFile('private/d.json');
        expect(adapter._etagCache.has('private/d.json')).toBe(false);
    });
    it('404 も成功扱い', async () => {
        mockFetch({ 'DELETE /data/private/gone.json': () => res(null, 404) });
        await expect(adapter.deleteFile('private/gone.json')).resolves.toBeUndefined();
    });
});

describe('batch', () => {
    it('put/delete をまとめて POST /data/batch、成功で ETag キャッシュをクリア', async () => {
        let sentBody;
        mockFetch({ 'POST /data/batch': ({ init }) => { sentBody = JSON.parse(init.body); return res(null, 200); } });
        adapter._etagCache.set('private/library.json', '"old"');
        adapter.beginBatch();
        adapter.addBatchEntry('private/library.json', '{"v":1}');
        adapter.addBatchDelete('private/old.json');
        await adapter.commitBatch();
        expect(sentBody.entries).toEqual([
            { op: 'put', path: 'private/library.json', content: '{"v":1}' },
            { op: 'delete', path: 'private/old.json' }
        ]);
        expect(adapter._etagCache.size).toBe(0);
    });

    it('batch 412/409 は HubConflictError', async () => {
        mockFetch({ 'POST /data/batch': () => res('conflict', 409) });
        adapter.beginBatch();
        adapter.addBatchEntry('private/a.json', '1');
        await expect(adapter.commitBatch()).rejects.toBeInstanceOf(HubConflictError);
    });

    it('空バッチは何もしない', async () => {
        const fn = mockFetch({});
        adapter.beginBatch();
        expect(await adapter.commitBatch()).toBeNull();
        expect(fn).not.toHaveBeenCalled();
    });
});

describe('publishSite (共有ハブ公開)', () => {
    it('files を /publish に POST し、deleteMissing と正規化 path を送る', async () => {
        let sentBody;
        mockFetch({ 'POST /publish': ({ init }) => {
            sentBody = JSON.parse(init.body);
            return res(JSON.stringify({ ok: true, siteId: 'sid', siteUrl: 'https://hub.example/public/sid/', published: 2 }), 200);
        } });
        const out = await adapter.publishSite([
            { path: '/index.html', content: '<html>' },
            { path: 'tech/index.html', content: '<html>2' }
        ], true);
        expect(sentBody.deleteMissing).toBe(true);
        expect(sentBody.files).toEqual([
            { path: 'index.html', content: '<html>' },
            { path: 'tech/index.html', content: '<html>2' }
        ]);
        expect(out.siteUrl).toBe('https://hub.example/public/sid/');
    });

    it('413 は HubQuotaError', async () => {
        mockFetch({ 'POST /publish': () => res('too big', 413) });
        await expect(adapter.publishSite([{ path: 'i.html', content: 'x' }])).rejects.toBeInstanceOf(HubQuotaError);
    });

    it('Authorization ヘッダにキーを載せる', async () => {
        mockFetch({ 'POST /publish': ({ init }) => {
            expect(init.headers['Authorization']).toBe('Bearer hk_deadbeef');
            return res(JSON.stringify({ ok: true }), 200);
        } });
        await adapter.publishSite([{ path: 'i.html', content: 'x' }]);
    });
});

describe('認証・安全性', () => {
    it('401 は HubAuthError', async () => {
        mockFetch({ 'GET /data/private/x.json': () => res('no', 401) });
        await expect(adapter.readJSON('private/x.json')).rejects.toBeInstanceOf(HubAuthError);
    });

    it('キー未取得なら fetch せず HubAuthError', async () => {
        const fn = mockFetch({});
        const a2 = new HubStorageAdapter({ apiBase: API, getKey: () => '' });
        await expect(a2.readJSON('private/x.json')).rejects.toBeInstanceOf(HubAuthError);
        expect(fn).not.toHaveBeenCalled();
    });

    it('パストラバーサルを拒否', async () => {
        mockFetch({});
        await expect(adapter.writeJSON('../secret.json', {})).rejects.toThrow(/unsafe path/);
        expect(() => adapter._dataUrl('private/../../etc')).toThrow(/unsafe path/);
    });

    it('Authorization ヘッダにキーを載せる', async () => {
        mockFetch({ 'GET /data/private/x.json': ({ init }) => {
            expect(init.headers['Authorization']).toBe('Bearer hk_deadbeef');
            return res('{}', 200);
        } });
        await adapter.readJSON('private/x.json');
    });
});
