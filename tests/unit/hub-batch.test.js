// hub worker POST /data/batch の楽観ロック (イシュー#376・#374 ADR-132 で発見)。
//  - 単発 PUT /data は If-Match→412 で楽観ロックが効くが、handleBatch は無条件に適用していた。
//  - 本テストは経路を通す形: default export の fetch ハンドラ (cf-worker/asayake-hub.js) を叩く。
// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../cf-worker/asayake-hub.js';

const KEY = 'hk_abc123';
const UID = 'u1';

function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        store,
        async get(k, t) { const v = store.get(k); if (v == null) return null; return t === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); },
        async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
    };
}

// R2 の put({onlyIf}) を本番同様に評価する最小モック。etag は put ごとに連番発行 (値の形式自体は無関係)。
function makeR2() {
    const store = new Map(); // key -> { body, etag, size }
    let seq = 0;
    return {
        store,
        async get(k) {
            const o = store.get(k);
            return o ? { body: o.body, httpEtag: `"${o.etag}"`, etag: o.etag, size: o.size, text: async () => o.body } : null;
        },
        async head(k) {
            const o = store.get(k);
            return o ? { etag: o.etag, size: o.size } : null;
        },
        async put(k, body, opts = {}) {
            const o = store.get(k);
            if (opts.onlyIf instanceof Headers) {
                // If-None-Match:'*' (新規作成専用・イシュー#381)。本番R2と同じ意味: 既に存在すれば失敗(null)。
                if (opts.onlyIf.get('If-None-Match') === '*' && o) return null;
            } else if (opts.onlyIf && opts.onlyIf.etagMatches !== undefined) {
                if (!o || o.etag !== opts.onlyIf.etagMatches) return null; // onlyIf 失敗 (本番 R2 と同じ: null 返却)
            }
            const etag = `e${++seq}`;
            const size = new TextEncoder().encode(body).length;
            store.set(k, { body, etag, size });
            return { httpEtag: `"${etag}"`, etag, size };
        },
        async delete(k) { store.delete(k); },
        async list({ prefix = '' } = {}) {
            return { objects: [...store.entries()].filter(([k2]) => k2.startsWith(prefix)).map(([key, v]) => ({ key, size: v.size })), truncated: false };
        }
    };
}

let KV, R2, env;
beforeEach(() => {
    KV = makeKV({
        [`key:${KEY}`]: { uid: UID, siteId: 'site1', created: 1 },
        [`uid:${UID}`]: { uid: UID, siteId: 'site1', createdAt: 0 }
    });
    R2 = makeR2();
    env = { KV, BUCKET: R2, GOOGLE_CLIENT_ID: 'c', HUB_DOMAIN: 'hub.test' };
});

function batch(entries, key = KEY) {
    return worker.fetch(new Request('https://hub.test/data/batch', {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ entries })
    }), env, {});
}
const usedBytes = async () => Number(await KV.get(`usage:${UID}`) || 0);

describe('後方互換: ifMatch/ifNoneMatch を送らない旧アプリのバッチ', () => {
    it('従来どおり無条件で適用され200(ETag相違があっても黙って上書きする既存挙動を保つ)', async () => {
        R2.store.set('data/u1/a.txt', { body: 'old', etag: 'stale', size: 3 });
        const res = await batch([{ op: 'put', path: 'a.txt', content: 'new' }, { op: 'delete', path: 'nope.txt' }]);
        expect(res.status).toBe(200);
        expect(R2.store.get('data/u1/a.txt').body).toBe('new');
    });
});

describe('ifMatch 一致: 成功して新しい内容が反映される', () => {
    it('既存ファイルの期待ETagが一致すれば200で書き込まれる', async () => {
        await R2.put('data/u1/a.txt', 'v1'); // etag=e1
        const head = await R2.head('data/u1/a.txt');
        const res = await batch([{ op: 'put', path: 'a.txt', content: 'v2', ifMatch: `"${head.etag}"` }]);
        expect(res.status).toBe(200);
        expect(R2.store.get('data/u1/a.txt').body).toBe('v2');
    });
});

describe('ifMatch 不一致 (段階1で検出): バッチ全体を書かずに412', () => {
    it('1件でも不一致ならconflictsを返し、一致した他のentryも書かれない', async () => {
        await R2.put('data/u1/a.txt', 'v1');
        await R2.put('data/u1/b.txt', 'v1');
        const headA = await R2.head('data/u1/a.txt');
        const res = await batch([
            { op: 'put', path: 'a.txt', content: 'v2', ifMatch: `"${headA.etag}"` },     // 一致
            { op: 'put', path: 'b.txt', content: 'v2', ifMatch: '"stale-etag"' }          // 不一致
        ]);
        expect(res.status).toBe(412);
        const body = await res.json();
        expect(body.conflicts).toEqual([{ path: 'b.txt', etag: (await R2.head('data/u1/b.txt')).etag }]);
        // 一致していた a.txt も書かれていない (バッチ全体不変)
        expect(R2.store.get('data/u1/a.txt').body).toBe('v1');
        expect(R2.store.get('data/u1/b.txt').body).toBe('v1');
    });
});

describe('ifNoneMatch:"*" (新規作成)', () => {
    it('対象が存在しなければ200で作成される', async () => {
        const res = await batch([{ op: 'put', path: 'new.txt', content: 'hello', ifNoneMatch: '*' }]);
        expect(res.status).toBe(200);
        expect(R2.store.get('data/u1/new.txt').body).toBe('hello');
    });
    it('対象が既に存在すれば412で書かれない', async () => {
        await R2.put('data/u1/exists.txt', 'already-there');
        const res = await batch([{ op: 'put', path: 'exists.txt', content: 'hello', ifNoneMatch: '*' }]);
        expect(res.status).toBe(412);
        expect(R2.store.get('data/u1/exists.txt').body).toBe('already-there');
    });
    it('段階1/段階2のhead判定が(TOCTOUで)見落としても、onlyIf(If-None-Match:"*")が既存物への作成を412で止める (イシュー#376/#381)', async () => {
        // 本番実測(#376)で再現したTOCTOU: head()が「存在しない」と見た直後に別タブが作成する窓。
        // head()を常にnullにして「見落とした」状態を模し、onlyIf単独で排他が効くことを確認する。
        await R2.put('data/u1/race.txt', 'already-there');
        const originalHead = R2.head.bind(R2);
        R2.head = async (k) => (k === 'data/u1/race.txt' ? null : originalHead(k));
        const res = await batch([{ op: 'put', path: 'race.txt', content: 'new-content', ifNoneMatch: '*' }]);
        expect(res.status).toBe(412);
        expect(R2.store.get('data/u1/race.txt').body).toBe('already-there'); // 上書きされていない
    });
    it('delete の ifNoneMatch は無効 (400)', async () => {
        const res = await batch([{ op: 'delete', path: 'a.txt', ifNoneMatch: '*' }]);
        expect(res.status).toBe(400);
    });
});

describe('入力検証', () => {
    it('ifMatch と ifNoneMatch の同時指定は400', async () => {
        const res = await batch([{ op: 'put', path: 'a.txt', content: 'x', ifMatch: '"e"', ifNoneMatch: '*' }]);
        expect(res.status).toBe(400);
    });
});

describe('delete の ifMatch', () => {
    it('一致すれば削除され200、usedBytesも減る', async () => {
        await R2.put('data/u1/a.txt', 'v1');
        await KV.put(`usage:${UID}`, String((await R2.head('data/u1/a.txt')).size));
        const head = await R2.head('data/u1/a.txt');
        const res = await batch([{ op: 'delete', path: 'a.txt', ifMatch: `"${head.etag}"` }]);
        expect(res.status).toBe(200);
        expect(R2.store.has('data/u1/a.txt')).toBe(false);
        expect(await usedBytes()).toBe(0);
    });
    it('不一致なら412で削除されない', async () => {
        await R2.put('data/u1/a.txt', 'v1');
        const res = await batch([{ op: 'delete', path: 'a.txt', ifMatch: '"stale"' }]);
        expect(res.status).toBe(412);
        expect(R2.store.has('data/u1/a.txt')).toBe(true);
    });
});

describe('原子性: 段階2 (実書込) 中に他の書込が割り込む (TOCTOU)', () => {
    it('先行して書かれたentryは旧本文へ補償ロールバックされ、全体として412', async () => {
        await R2.put('data/u1/a.txt', 'A0');
        await R2.put('data/u1/b.txt', 'B0');
        const etagA0 = (await R2.head('data/u1/a.txt')).etag;
        const etagB0 = (await R2.head('data/u1/b.txt')).etag;

        // a.txt への put が成功した直後に、別端末が b.txt を横から書き換えたことを模す
        const origPut = R2.put.bind(R2);
        R2.put = async (k, body, opts) => {
            const res = await origPut(k, body, opts);
            if (k === 'data/u1/a.txt' && res) R2.store.set('data/u1/b.txt', { body: 'B-hijacked', etag: 'eB-hijacked', size: 10 });
            return res;
        };

        const res = await batch([
            { op: 'put', path: 'a.txt', content: 'A1', ifMatch: `"${etagA0}"` },
            { op: 'put', path: 'b.txt', content: 'B1', ifMatch: `"${etagB0}"` }
        ]);
        expect(res.status).toBe(412);
        // a.txt は書いた後に元 (A0) へ戻されている
        expect(R2.store.get('data/u1/a.txt').body).toBe('A0');
        // b.txt は横からの割り込み内容のまま (このバッチは何も書けていない)
        expect(R2.store.get('data/u1/b.txt').body).toBe('B-hijacked');
    });

    it('補償ロールバック自体が失敗したら409+partial:trueを返す', async () => {
        await R2.put('data/u1/a.txt', 'A0');
        await R2.put('data/u1/b.txt', 'B0');
        const etagA0 = (await R2.head('data/u1/a.txt')).etag;
        const etagB0 = (await R2.head('data/u1/b.txt')).etag;

        const origPut = R2.put.bind(R2);
        let aPutCount = 0;
        R2.put = async (k, body, opts) => {
            if (k === 'data/u1/a.txt') {
                aPutCount++;
                if (aPutCount === 1) {
                    const res = await origPut(k, body, opts);
                    R2.store.set('data/u1/b.txt', { body: 'B-hijacked', etag: 'eB-hijacked', size: 10 }); // 割り込み
                    return res;
                }
                throw new Error('R2 outage during compensation'); // 2回目=補償の戻し書込みで失敗させる
            }
            return origPut(k, body, opts);
        };

        const res = await batch([
            { op: 'put', path: 'a.txt', content: 'A1', ifMatch: `"${etagA0}"` },
            { op: 'put', path: 'b.txt', content: 'B1', ifMatch: `"${etagB0}"` }
        ]);
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.partial).toBe(true);
    });
});

describe('認証', () => {
    it('無効なキーは401', async () => {
        const res = await batch([{ op: 'put', path: 'a.txt', content: 'x' }], 'hk_invalid');
        expect(res.status).toBe(401);
    });
});
