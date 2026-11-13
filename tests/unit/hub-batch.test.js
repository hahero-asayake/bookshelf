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
        // 段階1は get で読む (イシュー#600)。head と get の両方を「見落とした」状態にする
        const originalHead = R2.head.bind(R2);
        const originalGet = R2.get.bind(R2);
        R2.head = async (k) => (k === 'data/u1/race.txt' ? null : originalHead(k));
        R2.get = async (k) => (k === 'data/u1/race.txt' ? null : originalGet(k));
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

        // 段階1の後、b.txt を書く直前に別端末が b.txt を横から書き換えたことを模す
        // (イシュー#600 で段階2の put を並列にしたため、割り込む時点を「a の後」から「b の直前」へ移した。期待値は同じ)
        const origPut = R2.put.bind(R2);
        R2.put = async (k, body, opts) => {
            if (k === 'data/u1/b.txt' && opts && opts.onlyIf) R2.store.set('data/u1/b.txt', { body: 'B-hijacked', etag: 'eB-hijacked', size: 10 });
            return origPut(k, body, opts);
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
            // 割り込み: b.txt を書く直前に別端末が書き換える (イシュー#600: 並列化に合わせて時点を移した)
            if (k === 'data/u1/b.txt' && opts && opts.onlyIf) R2.store.set('data/u1/b.txt', { body: 'B-hijacked', etag: 'eB-hijacked', size: 10 });
            if (k === 'data/u1/a.txt') {
                aPutCount++;
                if (aPutCount !== 1) throw new Error('R2 outage during compensation'); // 2回目=補償の戻し書込みで失敗させる
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

// ===== イシュー#600: 使用量の書き込みはバッチで1回・並列でも同時2件の契約は保つ =====
// usage:<uid> への KV put の回数を数える (KV.put を包む)
function countUsagePuts() {
    const counter = { n: 0, fail: false };
    const origPut = KV.put.bind(KV);
    KV.put = async (k, v) => {
        if (k === `usage:${UID}`) {
            counter.n++;
            if (counter.fail) throw new Error('KV PUT failed: 429 Too Many Requests');
        }
        return origPut(k, v);
    };
    return counter;
}
// R2 の各操作に非同期の遅れを入れて、2本のバッチが交互に進むようにする (onlyIf の判定と書込は遅れの後に一度に行う＝本番 R2 と同じく原子的)
function addR2Jitter(seed) {
    let s = seed;
    const next = () => { s = (s * 1103515245 + 12345) % 2147483648; return s % 4; };
    for (const m of ['get', 'head', 'put', 'delete']) {
        const orig = R2[m].bind(R2);
        R2[m] = async (...args) => { await new Promise(r => setTimeout(r, next())); return orig(...args); };
    }
}

describe('使用量 (usage:<uid>) はバッチで1回だけ書く (イシュー#600)', () => {
    it('put/delete 混在でも KV の usage put は1回だけで、値は差分の合計', async () => {
        await R2.put('data/u1/a.txt', 'v1');      // 2バイト
        await R2.put('data/u1/b.txt', 'bb');      // 2バイト
        await KV.put(`usage:${UID}`, '4');
        const counter = countUsagePuts();
        const res = await batch([
            { op: 'put', path: 'a.txt', content: 'v22', ifMatch: `"${(await R2.head('data/u1/a.txt')).etag}"` }, // +1
            { op: 'delete', path: 'b.txt', ifMatch: `"${(await R2.head('data/u1/b.txt')).etag}"` },              // -2
            { op: 'put', path: 'c.txt', content: 'hello', ifNoneMatch: '*' }                                       // +5
        ]);
        expect(res.status).toBe(200);
        expect(counter.n).toBe(1);
        expect(await usedBytes()).toBe(8);
        expect(R2.store.get('data/u1/a.txt').body).toBe('v22');
        expect(R2.store.has('data/u1/b.txt')).toBe(false);
        expect(R2.store.get('data/u1/c.txt').body).toBe('hello');
    });
    it('旧アプリの無条件バッチも usage put は1回だけ', async () => {
        const counter = countUsagePuts();
        const res = await batch([{ op: 'put', path: 'x.txt', content: 'abc' }, { op: 'put', path: 'y.txt', content: 'de' }]);
        expect(res.status).toBe(200);
        expect(counter.n).toBe(1);
        expect(await usedBytes()).toBe(5);
    });
    it('補償で全部戻せた時は usage を書かない (412)', async () => {
        await R2.put('data/u1/a.txt', 'A0');
        await R2.put('data/u1/b.txt', 'B0');
        await KV.put(`usage:${UID}`, '4');
        const etagA0 = (await R2.head('data/u1/a.txt')).etag;
        const etagB0 = (await R2.head('data/u1/b.txt')).etag;
        const origPut = R2.put.bind(R2);
        R2.put = async (k, body, opts) => {
            if (k === 'data/u1/b.txt' && opts && opts.onlyIf) R2.store.set('data/u1/b.txt', { body: 'B-hijacked', etag: 'eB-hijacked', size: 10 });
            return origPut(k, body, opts);
        };
        const counter = countUsagePuts();
        const res = await batch([
            { op: 'put', path: 'a.txt', content: 'A1-longer', ifMatch: `"${etagA0}"` },
            { op: 'put', path: 'b.txt', content: 'B1', ifMatch: `"${etagB0}"` }
        ]);
        expect(res.status).toBe(412);
        expect(R2.store.get('data/u1/a.txt').body).toBe('A0');
        expect(counter.n).toBe(0);
        expect(await usedBytes()).toBe(4);
    });
    it('補償の一部が失敗した時は、残った分の差分だけを1回で足す (409)', async () => {
        await R2.put('data/u1/a.txt', 'A0');
        await R2.put('data/u1/b.txt', 'B0');
        await KV.put(`usage:${UID}`, '4');
        const etagA0 = (await R2.head('data/u1/a.txt')).etag;
        const etagB0 = (await R2.head('data/u1/b.txt')).etag;
        const origPut = R2.put.bind(R2);
        let aPutCount = 0;
        R2.put = async (k, body, opts) => {
            if (k === 'data/u1/b.txt' && opts && opts.onlyIf) R2.store.set('data/u1/b.txt', { body: 'B-hijacked', etag: 'eB-hijacked', size: 10 });
            if (k === 'data/u1/a.txt' && ++aPutCount !== 1) throw new Error('R2 outage during compensation');
            return origPut(k, body, opts);
        };
        const counter = countUsagePuts();
        const res = await batch([
            { op: 'put', path: 'a.txt', content: 'A1-longer', ifMatch: `"${etagA0}"` }, // 2→9 バイト・戻せない
            { op: 'put', path: 'b.txt', content: 'B1', ifMatch: `"${etagB0}"` }
        ]);
        expect(res.status).toBe(409);
        expect(R2.store.get('data/u1/a.txt').body).toBe('A1-longer');
        expect(counter.n).toBe(1);
        expect(await usedBytes()).toBe(4 + 7);
    });
    it('usage の書き込みが失敗しても (429 等)、データは戻さず200', async () => {
        const counter = countUsagePuts();
        counter.fail = true;
        const res = await batch([{ op: 'put', path: 'n.txt', content: 'hello', ifNoneMatch: '*' }]);
        expect(res.status).toBe(200);
        expect(R2.store.get('data/u1/n.txt').body).toBe('hello');
        expect(counter.n).toBe(1);
    });
    it('ctx.waitUntil がある時は、使用量の書き込みを応答の後に回し、waitUntil に渡す', async () => {
        const pending = [];
        const res = await worker.fetch(new Request('https://hub.test/data/batch', {
            method: 'POST', headers: { Authorization: `Bearer ${KEY}` },
            body: JSON.stringify({ entries: [{ op: 'put', path: 'w.txt', content: 'hello', ifNoneMatch: '*' }] })
        }), env, { waitUntil: (p) => pending.push(p) });
        expect(res.status).toBe(200);
        expect(pending.length).toBe(1);
        await Promise.all(pending);
        expect(await usedBytes()).toBe(5);
    });
});

describe('同時2件 (2本のバッチを本当に並行に流す・イシュー#376/#381/#600)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
        it(`ifNoneMatch:'*' 同士は片方だけ200・もう片方412 (seed=${seed})`, async () => {
            addR2Jitter(seed);
            const [r1, r2] = await Promise.all([
                batch([{ op: 'put', path: 'race.txt', content: 'from-1', ifNoneMatch: '*' }, { op: 'put', path: 'only1.txt', content: 'x', ifNoneMatch: '*' }]),
                batch([{ op: 'put', path: 'race.txt', content: 'from-2', ifNoneMatch: '*' }, { op: 'put', path: 'only2.txt', content: 'y', ifNoneMatch: '*' }])
            ]);
            expect([r1.status, r2.status].sort()).toEqual([200, 412]);
            const winner = r1.status === 200 ? 1 : 2;
            expect(R2.store.get('data/u1/race.txt').body).toBe(`from-${winner}`);
            // 負けた側は他の entry も戻されている
            expect(R2.store.has(`data/u1/only${3 - winner}.txt`)).toBe(false);
            expect(R2.store.has(`data/u1/only${winner}.txt`)).toBe(true);
        });
        it(`同じ ifMatch 同士は片方だけ200・もう片方412 (seed=${seed})`, async () => {
            await R2.put('data/u1/a.txt', 'v1');
            const etag = `"${(await R2.head('data/u1/a.txt')).etag}"`;
            addR2Jitter(seed);
            const [r1, r2] = await Promise.all([
                batch([{ op: 'put', path: 'a.txt', content: 'from-1', ifMatch: etag }]),
                batch([{ op: 'put', path: 'a.txt', content: 'from-2', ifMatch: etag }])
            ]);
            expect([r1.status, r2.status].sort()).toEqual([200, 412]);
            expect(R2.store.get('data/u1/a.txt').body).toBe(r1.status === 200 ? 'from-1' : 'from-2');
        });
    }
});

describe('認証', () => {
    it('無効なキーは401', async () => {
        const res = await batch([{ op: 'put', path: 'a.txt', content: 'x' }], 'hk_invalid');
        expect(res.status).toBe(401);
    });
});
