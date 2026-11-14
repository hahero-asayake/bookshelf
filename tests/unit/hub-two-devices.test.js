// 2台 (A・B) が同じハブに一括保存する時の、上書き・照合・送る件数 (イシュー#612・ADR-160)。
// 経路を通す形: BookshelfStorage.syncBatch → HubStorageAdapter (js/hub-adapter.js) → fetch →
// 本物の hub worker (cf-worker/asayake-hub.js の fetch ハンドラ) → R2 の模擬。端末2台は同じ R2 を見る。
// 直す前は、1回保存した端末の2回目以降の保存が、変えていないファイルも古い中身で書き直し、相手の変更を黙って消していた。
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../../cf-worker/asayake-hub.js';

await import('../../js/storage-adapter.js');
await import('../../js/hub-adapter.js');
await import('../../js/storage.js');
const { HubStorageAdapter, HubRemoteChangedError, StorageAdapter } = globalThis;
const BookshelfStorage = window.BookshelfStorage;

const KEY = 'hk_abc123';
const UID = 'u1';
const NOTES = 'private/notes.json';
const SETTINGS = 'private/settings.json';

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

// tests/unit/hub-batch.test.js と同じ R2 の最小模擬 (put({onlyIf}) を本番と同じ意味で評価する)。呼ばれた回数も数える
function makeR2() {
    const store = new Map();
    let seq = 0;
    const counts = { put: 0, get: 0, head: 0 };
    return {
        store, counts,
        async get(k) {
            counts.get++;
            const o = store.get(k);
            return o ? { body: o.body, httpEtag: `"${o.etag}"`, etag: o.etag, size: o.size, text: async () => o.body, writeHttpMetadata() {} } : null;
        },
        async head(k) {
            counts.head++;
            const o = store.get(k);
            return o ? { etag: o.etag, httpEtag: `"${o.etag}"`, size: o.size, writeHttpMetadata() {} } : null;
        },
        async put(k, body, opts = {}) {
            const o = store.get(k);
            if (opts.onlyIf instanceof Headers) {
                if (opts.onlyIf.get('If-None-Match') === '*' && o) return null;
            } else if (opts.onlyIf && opts.onlyIf.etagMatches !== undefined) {
                if (!o || o.etag !== opts.onlyIf.etagMatches) return null;
            }
            counts.put++;
            const etag = `e${++seq}`;
            const size = new TextEncoder().encode(body).length;
            store.set(k, { body, etag, size });
            return { httpEtag: `"${etag}"`, etag, size };
        },
        async delete(k) { store.delete(k); },
        async list({ prefix = '' } = {}) {
            return { objects: [...store.entries()].filter(([k2]) => k2.startsWith(prefix)).map(([key, v]) => ({ key, size: v.size, etag: v.etag, httpEtag: `"${v.etag}"` })), truncated: false, delimitedPrefixes: [] };
        }
    };
}

let KV, R2, env, log;
beforeEach(() => {
    try { localStorage.clear(); } catch (_) { /* 無視 */ }
    KV = makeKV({
        [`key:${KEY}`]: { uid: UID, siteId: 'site1', created: 1 },
        [`uid:${UID}`]: { uid: UID, siteId: 'site1', createdAt: 0 }
    });
    R2 = makeR2();
    env = { KV, BUCKET: R2, GOOGLE_CLIENT_ID: 'c', HUB_DOMAIN: 'hub.test' };
    log = [];
    // 端末ごとに apiBase のホストを変える (端末内の版の覚え=localStorage を分けるため)。行き先は同じ worker
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const method = (init.method || 'GET').toUpperCase();
        const rec = { dev: u.hostname, method, path: u.pathname };
        if (method === 'POST' && u.pathname === '/data/batch') rec.entries = JSON.parse(init.body).entries;
        log.push(rec);
        const req = new Request(`https://hub.test${u.pathname}${u.search}`, { method, headers: init.headers, body: init.body });
        const res = await worker.fetch(req, env, {});
        rec.status = res.status;
        // 古いハブ (成功の応答に本文が無い) を真似る時は、一括書き込みの 200 の本文を落とす
        if (oldHub && rec.entries && res.status === 200) return new Response(null, { status: 200 });
        return res;
    };
});
let oldHub = false;
beforeEach(() => { oldHub = false; });

function device(host) {
    const adapter = new HubStorageAdapter({ apiBase: `https://${host}`, getKey: () => KEY });
    return { adapter, storage: new BookshelfStorage(adapter) };
}
const put = (path, data) => ({ op: 'put', path, data, kind: 'json' });
const remote = (path) => { const o = R2.store.get(`data/${UID}/${path}`); return o ? JSON.parse(o.body) : null; };
const remoteEtag = (path) => `"${R2.store.get(`data/${UID}/${path}`).etag}"`;
async function seed() {
    await R2.put(`data/${UID}/${NOTES}`, JSON.stringify({ notes: {} }, null, 2));
    await R2.put(`data/${UID}/${SETTINGS}`, JSON.stringify({ version: '2.0', theme: 'x' }, null, 2));
}
async function load(d) { return { notes: await d.storage.readJSON(NOTES), settings: await d.storage.readJSON(SETTINGS) }; }

describe('2台 (A・B) が同じハブに一括保存する', () => {
    it('Bが1回保存した後の2回目の保存でも、Bが変えていない notes.json は送らず、Aの短文メモは消えない', async () => {
        await seed();
        const A = device('hub-a.test'); const B = device('hub-b.test');
        const b0 = await load(B);
        // B の1回目の保存 (設定だけ変える)
        await B.storage.syncBatch([put(NOTES, b0.notes), put(SETTINGS, { ...b0.settings, theme: 'b1' })]);
        // A が読んで、本1に短文メモを書いて保存
        const a0 = await load(A);
        await A.storage.syncBatch([put(NOTES, { notes: { book1: { memo: 'Aのメモ' } } }), put(SETTINGS, a0.settings)]);
        // B の2回目の保存 (読み直さない・設定だけ変える・短文メモは変えていない)
        const mark = log.length;
        const r = await B.storage.syncBatch([put(NOTES, b0.notes), put(SETTINGS, { ...b0.settings, theme: 'b2' })]);
        const mine = log.slice(mark);
        const post = mine.find(x => x.method === 'POST');
        expect(r).toBe(true);
        expect(post.entries.map(e => e.path)).toEqual([SETTINGS]);      // 変えたファイルだけ送る
        expect(mine.filter(x => x.method === 'HEAD').length).toBe(0);   // 保存の前の HEAD は要らない (ETag を覚えている)
        expect(remote(NOTES).notes.book1.memo).toBe('Aのメモ');          // Aの短文メモは残る
        expect(remote(SETTINGS).theme).toBe('b2');
    });

    it('読んだ直後の保存でも、Bが変えていない notes.json は送らない (Aが先に変えていても止まらず、Aの短文メモは残る)', async () => {
        await seed();
        const A = device('hub-a.test'); const B = device('hub-b.test');
        const b0 = await load(B);
        const a0 = await load(A);
        await A.storage.syncBatch([put(NOTES, { notes: { book1: { memo: 'Aのメモ' } } }), put(SETTINGS, a0.settings)]);
        const r = await B.storage.syncBatch([put(NOTES, b0.notes), put(SETTINGS, { ...b0.settings, theme: 'b' })]);
        expect(r).toBe(true);
        expect(remote(NOTES).notes.book1.memo).toBe('Aのメモ');
        expect(remote(SETTINGS).theme).toBe('b');
    });

    it('Bが自分で書いた notes.json の同じ本の短文メモを、Aが間に変えていたら、2回目以降の保存でも止まる (上書きしない)', async () => {
        await seed();
        const A = device('hub-a.test'); const B = device('hub-b.test');
        await load(B);
        await B.storage.syncBatch([put(NOTES, { notes: { book2: { memo: 'B1' } } })]);          // B の1回目 (本2に書く)
        await load(A);                                                                           // A は B1 を読む
        await A.storage.syncBatch([put(NOTES, { notes: { book2: { memo: 'Aが書き直した' } } })]);
        // B の2回目 (読み直さない・同じ本2を書き直す)。412 → 同じ項目を両方が違う値に変えた＝合わせられない
        await expect(B.storage.syncBatch([put(NOTES, { notes: { book2: { memo: 'B2' } } })]))
            .rejects.toBeInstanceOf(HubRemoteChangedError);
        expect(remote(NOTES).notes).toEqual({ book2: { memo: 'Aが書き直した' } });
    });

    it('項目ごとの合わせ: 2台が別々の本の短文メモを交互に保存しても止まらず、両方残る。合わせた分は lastMerged で返る', async () => {
        await seed();
        const A = device('hub-a.test'); const B = device('hub-b.test');
        await load(A); await load(B);
        await A.storage.syncBatch([put(NOTES, { notes: { book1: { memo: 'A1' } } })]);
        expect(A.storage.lastMerged).toBeNull();
        // B は読み直さずに本2へ書く → 412 → 項目ごとに合わせて送り直す (3択にならない)
        await expect(B.storage.syncBatch([put(NOTES, { notes: { book2: { memo: 'B2' } } })])).resolves.toBe(true);
        expect(remote(NOTES).notes).toEqual({ book2: { memo: 'B2' }, book1: { memo: 'A1' } });
        const m = B.storage.lastMerged[NOTES];
        expect(JSON.parse(m.local).notes).toEqual({ book2: { memo: 'B2' } });
        expect(JSON.parse(m.merged).notes).toEqual({ book2: { memo: 'B2' }, book1: { memo: 'A1' } });
        // A も読み直さずに本1を書き直す → B の本2は消えない
        await expect(A.storage.syncBatch([put(NOTES, { notes: { book1: { memo: 'A1-2' } } })])).resolves.toBe(true);
        expect(remote(NOTES).notes).toEqual({ book1: { memo: 'A1-2' }, book2: { memo: 'B2' } });
    });

    it('同じ端末で2本の syncBatch を同時に呼んでも1本ずつ流れ、合わせた分 (merged) は呼び出しごとに返る (イシュー#667)', async () => {
        await seed();
        const A = device('hub-a.test'); const B = device('hub-b.test');
        await load(A); await load(B);
        await A.storage.syncBatch([put(NOTES, { notes: { book1: { memo: 'A1' } } })]);
        // B は読み直さずに本2を書く (412 → 項目ごとに合わせる) と同時に、設定だけのまとめ保存も呼ぶ
        const [n, s] = await Promise.all([
            B.storage.syncBatch([put(NOTES, { notes: { book2: { memo: 'B2' } } })], { withMerged: true }),
            B.storage.syncBatch([put(SETTINGS, { version: '2.0', theme: 'b' })], { withMerged: true })
        ]);
        expect(n.result).toBe(true);
        expect(s.result).toBe(true);
        expect(JSON.parse(n.merged[NOTES].merged).notes).toEqual({ book2: { memo: 'B2' }, book1: { memo: 'A1' } });
        expect(s.merged).toBeNull();
        expect(remote(NOTES).notes).toEqual({ book2: { memo: 'B2' }, book1: { memo: 'A1' } });
        expect(remote(SETTINGS).theme).toBe('b');
    });

    it('項目ごとの合わせ: 設定 (settings.json) も別々のキー・更新時刻の表なら合わせる。同じキーを違う値にしたら止まる', async () => {
        await seed();
        const A = device('hub-a.test'); const B = device('hub-b.test');
        const a0 = await load(A); const b0 = await load(B);
        await A.storage.syncBatch([put(SETTINGS, { ...a0.settings, theme: 'dark', _updatedAt: { theme: 10 } })]);
        await B.storage.syncBatch([put(SETTINGS, { ...b0.settings, fontSize: 'l', _updatedAt: { fontSize: 20 } })]);
        expect(remote(SETTINGS)).toEqual({ version: '2.0', theme: 'dark', fontSize: 'l', _updatedAt: { fontSize: 20, theme: 10 } });
        // A が (読み直さずに) theme を変え、B も (読み直さずに) 同じ theme を違う値に → B は止まる
        await A.storage.syncBatch([put(SETTINGS, { ...a0.settings, theme: 'light', _updatedAt: { theme: 40 } })]);
        expect(remote(SETTINGS)).toEqual({ version: '2.0', theme: 'light', _updatedAt: { theme: 40, fontSize: 20 }, fontSize: 'l' });
        await expect(B.storage.syncBatch([put(SETTINGS, { ...b0.settings, theme: 'sepia', fontSize: 'l', _updatedAt: { fontSize: 20, theme: 50 } })]))
            .rejects.toBeInstanceOf(HubRemoteChangedError);
        expect(remote(SETTINGS).theme).toBe('light');
    });

    it('項目ごとの合わせは対象のファイルだけ (library.json などは今までどおり止まる)', () => {
        const base = JSON.stringify({ a: 1 }); const local = JSON.stringify({ a: 1, b: 2 }); const remote = JSON.stringify({ a: 1, c: 3 });
        expect(StorageAdapter.mergeRemoteChange('private/library.json', base, local, remote)).toBeNull();
        expect(JSON.parse(StorageAdapter.mergeRemoteChange(NOTES, base, local, remote))).toEqual({ a: 1, b: 2, c: 3 });
        expect(StorageAdapter.mergeRemoteChange(NOTES, base, 'not json', remote)).toBeNull();
    });

    it('何も変えない保存は、ハブに何も送らず、R2 にも書かない', async () => {
        await seed();
        const B = device('hub-b.test');
        const b0 = await load(B);
        const before = { ...R2.counts };
        const mark = log.length;
        const r = await B.storage.syncBatch([put(NOTES, b0.notes), put(SETTINGS, b0.settings)]);
        expect(r).toBe(true);
        expect(log.slice(mark)).toEqual([]);
        expect(R2.counts.put - before.put).toBe(0);
    });

    it('書いた後の ETag をハブの応答から覚え、次の保存の ifMatch に使う', async () => {
        await seed();
        const B = device('hub-b.test');
        const b0 = await load(B);
        await B.storage.syncBatch([put(SETTINGS, { ...b0.settings, theme: 'b1' })]);
        const e1 = remoteEtag(SETTINGS);
        expect(B.adapter._etagCache.get(SETTINGS)).toBe(e1);
        expect(B.adapter._etagCache.get(NOTES)).toBeDefined();          // 送らなかったファイルの ETag は捨てない
        const mark = log.length;
        await B.storage.syncBatch([put(SETTINGS, { ...b0.settings, theme: 'b2' })]);
        const post = log.slice(mark).find(x => x.method === 'POST');
        expect(post.entries).toEqual([{ op: 'put', path: SETTINGS, content: JSON.stringify({ ...b0.settings, theme: 'b2' }, null, 2), ifMatch: e1 }]);
        expect(log.slice(mark).filter(x => x.method === 'HEAD').length).toBe(0);
    });

    it('存在の確認 (fileExists) は、覚えている ETag を「今の」ETag で置き換えない (Aが間に変えていたら、Bの保存は止まる)', async () => {
        await seed();
        const A = device('hub-a.test'); const B = device('hub-b.test');
        await load(B);
        await load(A);
        await A.storage.syncBatch([put(NOTES, { notes: { book1: { memo: 'Aのメモ' } } })]);
        expect(await B.adapter.fileExists(NOTES)).toBe(true);           // 保存のたびに呼ばれる存在の確認 (js/storage.js)
        await expect(B.storage.syncBatch([put(NOTES, { notes: { book1: { memo: 'Bのメモ' } } })]))
            .rejects.toBeInstanceOf(HubRemoteChangedError);
        expect(remote(NOTES).notes).toEqual({ book1: { memo: 'Aのメモ' } });
    });

    it('起動時の種まき (別のファイル15件の一括書き込み) の後でも、読んだ時の ETag を捨てない＝最初の保存で照合が効く', async () => {
        await seed();
        const A = device('hub-a.test'); const B = device('hub-b.test');
        await load(B);
        // B の起動時の種まき (標準プラグインの15件)。直す前は、これが成功した時に ETag を全部捨てていた
        await B.storage.syncBatch(Array.from({ length: 15 }, (_, i) => ({ op: 'put', path: `plugins/p${i}/manifest.json`, data: { id: `p${i}` }, kind: 'json' })));
        await load(A);
        await A.storage.syncBatch([put(NOTES, { notes: { book1: { memo: 'Aのメモ' } } })]);
        // B の最初の保存 (読み直さない・同じ notes.json を変える) → 止まる。Aの短文メモは残る
        await expect(B.storage.syncBatch([put(NOTES, { notes: { book1: { memo: 'Bのメモ' } } })]))
            .rejects.toBeInstanceOf(HubRemoteChangedError);
        expect(remote(NOTES).notes).toEqual({ book1: { memo: 'Aのメモ' } });
    });

    it('版の印: 書く物がある保存では、同じ一括書き込みで照合なしに書く。何も変えない保存では印も書かない', async () => {
        await seed();
        const B = device('hub-b.test');
        const b0 = await load(B);
        const STAMP = BookshelfStorage.SYNC_STAMP_PATH;
        // 変えた保存: 設定＋印の2件。印には ifMatch も ifNoneMatch も付かない
        let mark = log.length;
        await B.storage.syncBatch([put(NOTES, b0.notes), put(SETTINGS, { ...b0.settings, theme: 'b1' })], { stamp: 's1' });
        let post = log.slice(mark).find(x => x.method === 'POST');
        expect(post.entries.map(e => e.path)).toEqual([SETTINGS, STAMP]);
        expect(post.entries[1]).toEqual({ op: 'put', path: STAMP, content: JSON.stringify({ stamp: 's1' }, null, 2) });
        expect(remote(STAMP)).toEqual({ stamp: 's1' });
        expect(B.storage.syncStamp).toBe('s1');
        // 何も変えない保存: 何も送らない。保存先の印は s1 のまま、覚えている印も進めない
        mark = log.length;
        const before = R2.counts.put;
        await B.storage.syncBatch([put(NOTES, b0.notes), put(SETTINGS, { ...b0.settings, theme: 'b1' })], { stamp: 's2' });
        expect(log.slice(mark)).toEqual([]);
        expect(R2.counts.put - before).toBe(0);
        expect(remote(STAMP)).toEqual({ stamp: 's1' });
        expect(B.storage.syncStamp).toBe('s1');
    });

    it('版の印: 2台が別々のファイルを交互に保存しても、印ではぶつからない (後から書いた方が勝つ)', async () => {
        await seed();
        const A = device('hub-a.test'); const B = device('hub-b.test');
        const b0 = await load(B);
        const a0 = await load(A);
        await A.storage.syncBatch([put(NOTES, { notes: { book1: { memo: 'Aのメモ' } } })], { stamp: 'a1' });
        await B.storage.syncBatch([put(SETTINGS, { ...b0.settings, theme: 'b1' })], { stamp: 'b1' });
        await A.storage.syncBatch([put(NOTES, { notes: { book1: { memo: 'Aのメモ2' } } })], { stamp: 'a2' });
        await B.storage.syncBatch([put(SETTINGS, { ...b0.settings, theme: 'b2' })], { stamp: 'b2' });
        expect(remote(BookshelfStorage.SYNC_STAMP_PATH)).toEqual({ stamp: 'b2' });
        expect(remote(NOTES).notes.book1.memo).toBe('Aのメモ2');
        expect(remote(SETTINGS).theme).toBe('b2');
        expect(a0.settings.theme).toBe('x');
    });

    it('版の印: 読み込みで保存先の印を覚える (loadAll)', async () => {
        await seed();
        await R2.put(`data/${UID}/${BookshelfStorage.SYNC_STAMP_PATH}`, JSON.stringify({ stamp: 'remote-1' }));
        const B = device('hub-b.test');
        const state = await B.storage.loadAll();
        expect(state.syncStamp).toBe('remote-1');
        expect(B.storage.syncStamp).toBe('remote-1');
    });

    it('ハブの成功の応答には、put した分の ETag だけが入る (delete した分は入らない)', async () => {
        await seed();
        const res = await worker.fetch(new Request('https://hub.test/data/batch', {
            method: 'POST', headers: { Authorization: `Bearer ${KEY}` },
            body: JSON.stringify({ entries: [
                { op: 'put', path: SETTINGS, content: '{"v":2}', ifMatch: remoteEtag(SETTINGS) },
                { op: 'delete', path: NOTES, ifMatch: remoteEtag(NOTES) },
                { op: 'put', path: 'private/main.json', content: '{}', ifNoneMatch: '*' }
            ] })
        }), env, {});
        expect(res.status).toBe(200);
        expect((await res.json()).etags).toEqual({ [SETTINGS]: remoteEtag(SETTINGS), 'private/main.json': remoteEtag('private/main.json') });
    });

    it('古いハブ (成功の応答に ETag が無い) でも動く: ETag は今までどおり捨て、変えていないファイルは送らない', async () => {
        await seed();
        oldHub = true;
        const B = device('hub-b.test');
        const b0 = await load(B);
        await B.storage.syncBatch([put(NOTES, b0.notes), put(SETTINGS, { ...b0.settings, theme: 'b1' })]);
        expect(B.adapter._etagCache.size).toBe(0);                       // 今までどおり全部捨てる
        const mark = log.length;
        await B.storage.syncBatch([put(NOTES, b0.notes), put(SETTINGS, { ...b0.settings, theme: 'b2' })]);
        const mine = log.slice(mark);
        expect(mine.filter(x => x.method === 'HEAD').length).toBe(1);   // 送るファイルの分だけ HEAD で取り直す
        expect(mine.find(x => x.method === 'POST').entries.map(e => e.path)).toEqual([SETTINGS]);
        expect(remote(SETTINGS).theme).toBe('b2');
    });
});
