// HubStorageAdapter のテスト (ADR-032, 09 §10.5)
// fetch をモックして read/write/ETag 楽観ロック/list/batch/認証/パス検証を確認する。
import { describe, it, expect, beforeEach, vi } from 'vitest';

await import('../../js/storage-adapter.js');
await import('../../js/hub-adapter.js');
const { HubStorageAdapter, HubConflictError, HubRemoteChangedError, HubAuthError, HubQuotaError } = globalThis;

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

    it('readText(path, hooks) の hooks が実際の fetch まで届き、onHeaders → onBody の順に呼ばれる (イシュー#156)', async () => {
        mockFetch({ 'GET /data/private/books/a.md': () => res('# memo', 200, { ETag: '"m1"' }) });
        const order = [];
        const text = await adapter.readText('private/books/a.md', {
            onHeaders: () => order.push('headers'),
            onBody: () => order.push('body')
        });
        expect(text).toBe('# memo');
        expect(order).toEqual(['headers', 'body']);
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

    // イシュー#374 (案D): 412 は「リトライしても回復しない場合のみ」HubConflictError。
    // github-adapter.js の 409 リカバリ (ADR-080/081) と同じ意味を StorageAdapter.recoverFromConflict
    // 経由で共通化した。本文比較で「不一致」(=他所が変更) と「一致」(=単なる ETag キャッシュのズレ) を
    // 区別し、後者だけ1回だけ再送して回復する。
    it('412 はリトライ(本文比較+1回再送)しても回復しない場合のみ HubConflictError (本当の競合)', async () => {
        let getCalls = 0, putCalls = 0;
        mockFetch({
            'GET /data/private/c.json': () => { getCalls++; return res('{}', 200, { ETag: '"a"' }); },
            'PUT /data/private/c.json': () => { putCalls++; return res('conflict', 412); }
        });
        await adapter.readJSON('private/c.json'); // _lastKnownContent = '{}'
        await expect(adapter.writeJSON('private/c.json', { y: 2 })).rejects.toBeInstanceOf(HubConflictError);
        // readJSON の GET(1) + リカバリの本文確認 GET(1) = 2。初回 PUT(1) + 本文一致での再送 PUT(1) = 2。
        expect(getCalls).toBe(2);
        expect(putCalls).toBe(2);
    });

    it('412 後、最新本文が自分の最終認識と一致すれば1回だけ再送して成功する (単なる ETag キャッシュのズレ・自分の先行書き込みの再送)', async () => {
        let putCalls = 0;
        mockFetch({
            'GET /data/private/r.json': () => res('{"a":1}', 200, { ETag: '"old"' }),
            'PUT /data/private/r.json': () => {
                putCalls += 1;
                if (putCalls === 1) return res('conflict', 412);
                return res(null, 200, { ETag: '"new"' });
            }
        });
        await adapter.readJSON('private/r.json'); // _lastKnownContent = '{"a":1}' (リモートは変わっていない)
        await expect(adapter.writeJSON('private/r.json', { a: 2 })).resolves.toBeUndefined();
        expect(putCalls).toBe(2);
        expect(adapter._etagCache.get('private/r.json')).toBe('"new"');
    });

    it('412 後、最新本文が自分の最終認識と異なれば上書きせず HubRemoteChangedError (lost update 防止・②指示2026-10-26)', async () => {
        mockFetch({
            'GET /data/private/x.json': () => res('{"a":1}', 200, { ETag: '"old"' })
        });
        await adapter.readJSON('private/x.json'); // _lastKnownContent = '{"a":1}'
        let putCalls = 0;
        // 412 発生後のリカバリ GET は「他タブ/他デバイスが実際に書き換えた」内容を返すよう切替
        mockFetch({
            'GET /data/private/x.json': () => res('{"a":999}', 200, { ETag: '"other"' }),
            'PUT /data/private/x.json': () => { putCalls += 1; return res('conflict', 412); }
        });
        await expect(adapter.writeJSON('private/x.json', { a: 2 })).rejects.toBeInstanceOf(HubRemoteChangedError);
        expect(putCalls).toBe(1); // 不一致と分かった時点で再送しない (盲目的に上書きしない)
    });

    it('412後、リモートが削除されていた場合も上書きせず HubRemoteChangedError (削除後の無条件再作成を防ぐ・イシュー#381)', async () => {
        mockFetch({
            'GET /data/private/del.json': () => res('{"a":1}', 200, { ETag: '"old"' })
        });
        await adapter.readJSON('private/del.json'); // _lastKnownContent = '{"a":1}' (存在すると認識)
        let putCalls = 0;
        // 412発生後のリカバリGETは「他タブ/他デバイスが削除した」ことを表す404を返す
        mockFetch({
            'GET /data/private/del.json': () => res(null, 404),
            'PUT /data/private/del.json': () => { putCalls += 1; return res('conflict', 412); }
        });
        await expect(adapter.writeJSON('private/del.json', { a: 2 })).rejects.toBeInstanceOf(HubRemoteChangedError);
        expect(putCalls).toBe(1); // 削除されたと分かった時点で再送しない (盲目的に再作成しない・以前は無条件で再送していた)
    });

    it('同一パスへの write/delete は直列化される (連打しても同時に2つ走らない・イシュー#374案D)', async () => {
        let inFlight = 0;
        let maxConcurrent = 0;
        const order = [];
        mockFetch({
            'HEAD /data/private/s.json': () => res(null, 404),
            'PUT /data/private/s.json': async ({ init }) => {
                inFlight += 1;
                maxConcurrent = Math.max(maxConcurrent, inFlight);
                const n = JSON.parse(init.body).n;
                order.push(`start:${n}`);
                await new Promise((r) => setTimeout(r, 5));
                order.push(`end:${n}`);
                inFlight -= 1;
                return res(null, 200, { ETag: `"v${n}"` });
            }
        });
        await Promise.all([
            adapter.writeJSON('private/s.json', { n: 1 }),
            adapter.writeJSON('private/s.json', { n: 2 })
        ]);
        expect(maxConcurrent).toBe(1); // 直列化されていれば同時実行は常に1
        expect(order).toEqual(['start:1', 'end:1', 'start:2', 'end:2']); // 発火順 = 呼び出し順
    });

    it('GET/HEAD/PUT/DELETE/batch の全リクエストに cache:no-store が付く (GitHubAdapter と同じ理由・イシュー#150/#374)', async () => {
        const caches = [];
        mockFetch({
            'GET /data/private/n.json': ({ init }) => { caches.push(init.cache); return res('{}', 200, { ETag: '"a"' }); },
            'PUT /data/private/n.json': ({ init }) => { caches.push(init.cache); return res(null, 200, { ETag: '"b"' }); },
            'DELETE /data/private/n.json': ({ init }) => { caches.push(init.cache); return res(null, 204); },
            // delete で ETag キャッシュが消えている (イシュー#376: commitBatch の期待ETag事前確定で HEAD を叩く)
            'HEAD /data/private/n.json': ({ init }) => { caches.push(init.cache); return res(null, 404); },
            'POST /data/batch': ({ init }) => { caches.push(init.cache); return res(null, 200); }
        });
        await adapter.readJSON('private/n.json');
        await adapter.writeJSON('private/n.json', { x: 1 }); // ETag キャッシュ済みなので HEAD は呼ばれない
        await adapter.deleteFile('private/n.json');
        adapter.beginBatch();
        adapter.addBatchEntry('private/n.json', '{}');
        await adapter.commitBatch();
        expect(caches.length).toBe(5);
        expect(caches.every((c) => c === 'no-store')).toBe(true);
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

describe('batch: 期待ETag(ifMatch/ifNoneMatch)の付与 (イシュー#376)', () => {
    it('_etagCache に値があればそれを ifMatch として送る (追加の通信無し)', async () => {
        let sentBody;
        mockFetch({ 'POST /data/batch': ({ init }) => { sentBody = JSON.parse(init.body); return res(null, 200); } });
        adapter._etagCache.set('private/library.json', '"old"');
        adapter.beginBatch();
        adapter.addBatchEntry('private/library.json', '{"v":1}');
        await adapter.commitBatch();
        expect(sentBody.entries).toEqual([{ op: 'put', path: 'private/library.json', content: '{"v":1}', ifMatch: '"old"' }]);
        expect(adapter._etagCache.size).toBe(0);
    });

    it('キャッシュ無しの entry は単発 _writeOnce と同じく HEAD で事前確定する: 既存ファイルなら ifMatch', async () => {
        let sentBody;
        mockFetch({
            'HEAD /data/private/old.json': () => res(null, 200, { ETag: '"o1"' }),
            'POST /data/batch': ({ init }) => { sentBody = JSON.parse(init.body); return res(null, 200); }
        });
        adapter.beginBatch();
        adapter.addBatchDelete('private/old.json');
        await adapter.commitBatch();
        expect(sentBody.entries).toEqual([{ op: 'delete', path: 'private/old.json', ifMatch: '"o1"' }]);
    });

    it('キャッシュ無しの新規 put (HEAD 404) は ifNoneMatch:"*" を送る', async () => {
        let sentBody;
        mockFetch({
            'HEAD /data/private/new.json': () => res(null, 404),
            'POST /data/batch': ({ init }) => { sentBody = JSON.parse(init.body); return res(null, 200); }
        });
        adapter.beginBatch();
        adapter.addBatchEntry('private/new.json', '{"v":1}');
        await adapter.commitBatch();
        expect(sentBody.entries).toEqual([{ op: 'put', path: 'private/new.json', content: '{"v":1}', ifNoneMatch: '*' }]);
    });

    it('削除対象がキャッシュ無し・HEAD 404 (既に無い) ならそのentryを送らず除外する (単発 deleteFile の404=成功扱いと同じ)', async () => {
        let posted = false;
        mockFetch({
            'HEAD /data/private/gone.json': () => res(null, 404),
            'POST /data/batch': () => { posted = true; return res(null, 200); }
        });
        adapter.beginBatch();
        adapter.addBatchDelete('private/gone.json');
        await expect(adapter.commitBatch()).resolves.toBe(true);
        expect(posted).toBe(false); // 全entry除外→ POST 自体しない
    });

    it('事前HEADは最大6本まで並行実行する (件数の多いバッチの往復レイテンシ対策・イシュー#376 ②指示2026-10-26)', async () => {
        let inFlight = 0;
        let maxConcurrent = 0;
        const routes = { 'POST /data/batch': () => res(null, 200) };
        for (let i = 1; i <= 7; i++) {
            routes[`HEAD /data/private/h${i}.json`] = async () => {
                inFlight += 1;
                maxConcurrent = Math.max(maxConcurrent, inFlight);
                await new Promise((r) => setTimeout(r, 5));
                inFlight -= 1;
                return res(null, 404);
            };
        }
        mockFetch(routes);
        adapter.beginBatch();
        for (let i = 1; i <= 7; i++) adapter.addBatchEntry(`private/h${i}.json`, 'x');
        await adapter.commitBatch();
        expect(maxConcurrent).toBeLessThanOrEqual(6); // BATCH_HEAD_CONCURRENCY を超えない
        expect(maxConcurrent).toBeGreaterThan(1); // 逐次(=1)ではなく並行していること
    });

    it('空バッチは何もしない', async () => {
        const fn = mockFetch({});
        adapter.beginBatch();
        expect(await adapter.commitBatch()).toBeNull();
        expect(fn).not.toHaveBeenCalled();
    });
});

describe('batch: 412 (衝突) の回復 — 単発 _recoverFromConflictAndRetry と同じ意味に揃える (イシュー#376)', () => {
    it('conflicts の本文が自分が送ろうとした内容と一致: 既に反映済みとして成功扱い (再送しない)', async () => {
        let postCalls = 0;
        mockFetch({
            'HEAD /data/private/a.json': () => res(null, 404),
            'POST /data/batch': ({ init }) => {
                postCalls += 1;
                if (postCalls === 1) {
                    expect(JSON.parse(init.body).entries).toEqual([{ op: 'put', path: 'private/a.json', content: '{"v":1}', ifNoneMatch: '*' }]);
                    return res(JSON.stringify({ error: 'etag mismatch', conflicts: [{ path: 'private/a.json', etag: '"e1"' }] }), 412);
                }
                throw new Error('本文一致で成功扱いのはずなので再送されてはいけない');
            },
            'GET /data/private/a.json': () => res('{"v":1}', 200, { ETag: '"e1"' }) // 既に (自分の先行書込等で) 同じ内容がある
        });
        adapter.beginBatch();
        adapter.addBatchEntry('private/a.json', '{"v":1}');
        await expect(adapter.commitBatch()).resolves.toBe(true);
        expect(postCalls).toBe(1);
    });

    it('conflicts の本文が自分の knownContent と一致: 単なるETagキャッシュのズレとして新ETagで1回だけ再送する', async () => {
        mockFetch({ 'GET /data/private/b.json': () => res('{"v":0}', 200, { ETag: '"stale"' }) });
        await adapter.readJSON('private/b.json'); // _lastKnownContent = '{"v":0}'
        adapter.beginBatch();
        adapter.addBatchEntry('private/b.json', '{"v":1}');
        let postCalls = 0;
        mockFetch({
            'POST /data/batch': ({ init }) => {
                postCalls += 1;
                const body = JSON.parse(init.body);
                if (postCalls === 1) {
                    expect(body.entries[0].ifMatch).toBe('"stale"');
                    return res(JSON.stringify({ conflicts: [{ path: 'private/b.json', etag: '"stale"' }] }), 412);
                }
                expect(body.entries[0].ifMatch).toBe('"fresh"');
                return res(null, 200);
            },
            'GET /data/private/b.json': () => res('{"v":0}', 200, { ETag: '"fresh"' }) // リモートは自分が最後に認識した内容のまま
        });
        await expect(adapter.commitBatch()).resolves.toBe(true);
        expect(postCalls).toBe(2);
    });

    it('conflicts の本文が自分の認識と異なる (他タブ/他デバイスが実際に変更): 上書きせず HubRemoteChangedError', async () => {
        mockFetch({
            'HEAD /data/private/c.json': () => res(null, 404),
            'POST /data/batch': () => res(JSON.stringify({ conflicts: [{ path: 'private/c.json', etag: '"other"' }] }), 412),
            'GET /data/private/c.json': () => res('{"v":999}', 200, { ETag: '"other"' })
        });
        adapter.beginBatch();
        adapter.addBatchEntry('private/c.json', '{"v":1}');
        await expect(adapter.commitBatch()).rejects.toBeInstanceOf(HubRemoteChangedError);
    });

    it('再送してもなお412 (本当の競合): HubConflictError', async () => {
        mockFetch({ 'GET /data/private/d.json': () => res('{"v":0}', 200, { ETag: '"stale"' }) });
        await adapter.readJSON('private/d.json');
        adapter.beginBatch();
        adapter.addBatchEntry('private/d.json', '{"v":1}');
        mockFetch({
            'POST /data/batch': () => res(JSON.stringify({ conflicts: [{ path: 'private/d.json', etag: '"stale"' }] }), 412),
            'GET /data/private/d.json': () => res('{"v":0}', 200, { ETag: '"fresh"' }) // knownContent一致→差し替えて再送するが…
        });
        await expect(adapter.commitBatch()).rejects.toBeInstanceOf(HubConflictError);
    });

    it('worker が conflicts 詳細を返さない想定外の412は保守的に HubConflictError', async () => {
        mockFetch({
            'HEAD /data/private/e.json': () => res(null, 404),
            'POST /data/batch': () => res('conflict', 412)
        });
        adapter.beginBatch();
        adapter.addBatchEntry('private/e.json', '1');
        await expect(adapter.commitBatch()).rejects.toBeInstanceOf(HubConflictError);
    });

    it('409 (worker側の補償ロールバック自体が失敗) は再送せずそのまま Error', async () => {
        mockFetch({
            'HEAD /data/private/f.json': () => res(null, 404),
            'POST /data/batch': () => res(JSON.stringify({ error: 'batch write failed, partial compensation', partial: true }), 409)
        });
        adapter.beginBatch();
        adapter.addBatchEntry('private/f.json', '1');
        await expect(adapter.commitBatch()).rejects.toThrow(/partial compensation/);
    });

    it('旧worker (ifMatch/ifNoneMatchを無視して常に200を返す) でも後方互換でそのまま成功する', async () => {
        let sentBody;
        mockFetch({
            'HEAD /data/private/g.json': () => res(null, 404),
            'POST /data/batch': ({ init }) => { sentBody = JSON.parse(init.body); return res(null, 200); }
        });
        adapter.beginBatch();
        adapter.addBatchEntry('private/g.json', '{"v":1}');
        await expect(adapter.commitBatch()).resolves.toBe(true);
        expect(sentBody.entries[0].ifNoneMatch).toBe('*'); // クライアントは新形式を送り、旧workerはそれを無視するだけ
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

    it('索引 (ADR-099): index を渡すと /publish の body に載せ、省略すると載せない', async () => {
        const bodies = [];
        mockFetch({ 'POST /publish': ({ init }) => { bodies.push(JSON.parse(init.body)); return res(JSON.stringify({ ok: true, indexed: true }), 200); } });
        const index = [{ publicId: 'AbCdEfGhIj', title: 't', tags: ['a'], coverUrl: '', publishedAt: 1, modifiedAt: 2 }];
        await adapter.publishSite([{ path: 'AbCdEfGhIj/index.html', content: 'x' }], true, '', index);
        await adapter.publishSite([{ path: 'i.html', content: 'x' }], true);
        expect(bodies[0].index).toEqual(index);
        expect('index' in bodies[1]).toBe(false);
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
