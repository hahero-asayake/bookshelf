// イシュー#771: 自分の書き込みを「他の場所で更新されています」と見誤る（誤検出）の回帰。
// H1（応答の消えた自分の書き込み）は step3 で直した＝StorageAdapter.recoverFromConflict の (1)(2) と結果待ちの記録。
// H2（読みが書きに追い越される）は step4 で直した＝書き込みの世代（StorageAdapter.bumpWriteGen）で、読みの応答が控えを巻き戻さない。
// 本当に他の端末が書いた時は HubRemoteChangedError のまま（検出そのものは残す）。切り替え bookshelf.flag.ownWriteMatch='0' で前の形。
import { describe, it, expect, beforeEach, vi } from 'vitest';

await import('../../js/storage-adapter.js');
await import('../../js/hub-adapter.js');
await import('../../js/storage.js');
const { HubStorageAdapter, HubRemoteChangedError } = globalThis;

const API = 'https://api.asayake.test';
const ART = 'private/articles.json';
const res = (body, status = 200, headers = {}) => new Response(body, { status, headers });

// 中身と ETag を持つハブの模擬。PUT は If-Match を照合して 412。
// dropNextPutResponse: 次の PUT は保存先に入れてから応答だけ消す（iPhone が裏で止まる／10秒の中断／Load failed 相当）
// holdNextGet: 次の本文の GET は「受けた時点の中身」で応答を作り、release まで返さない（読みが書きに追い越される）
function fakeHub(initial) {
    const files = new Map();
    let seq = 0;
    const log = [];
    const put = (p, body) => { files.set(p, { body, etag: `"v${++seq}"` }); };
    for (const [p, b] of Object.entries(initial)) put(p, b);
    const st = { dropNextPutResponse: false, dropNextBatchResponse: false, holdNextGet: null, getReceived: 0, puts: 0 };
    const pathOf = (u) => decodeURIComponent(u.pathname.replace(/^\/data\//, ''));
    globalThis.fetch = vi.fn(async (url, init = {}) => {
        const u = new URL(url);
        const method = (init.method || 'GET').toUpperCase();
        const p = pathOf(u);
        if (method === 'POST' && u.pathname === '/data/batch') {
            const { entries } = JSON.parse(init.body);
            const conflicts = entries.filter((e) => {
                const cur = files.get(e.path);
                if (e.ifNoneMatch === '*') return !!cur;
                return e.ifMatch && (!cur || cur.etag !== e.ifMatch);
            }).map((e) => ({ path: e.path, etag: files.get(e.path) ? files.get(e.path).etag : null }));
            if (conflicts.length) { log.push(`BATCH -> 412 ${conflicts.map((c) => c.path).join(',')}`); return res(JSON.stringify({ conflicts }), 412); }
            const etags = {};
            for (const e of entries) { st.puts++; put(e.path, e.content); etags[e.path] = files.get(e.path).etag; }
            log.push(`BATCH -> 200 ${Object.values(etags).join(',')}`);
            if (st.dropNextBatchResponse) { st.dropNextBatchResponse = false; log.push('  (応答を消した)'); throw new TypeError('Load failed'); }
            return res(JSON.stringify({ ok: true, etags }));
        }
        if (method === 'GET' && u.searchParams.get('list')) {
            const prefix = `${p}/`;
            const entries = [...files].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
                .map(([k, f]) => ({ name: k.slice(prefix.length), etag: f.etag, size: f.body.length }));
            return res(JSON.stringify({ files: entries.map((e) => e.name), dirs: [], entries, truncated: false }));
        }
        const f = files.get(p);
        if (method === 'HEAD') return f ? res(null, 200, { ETag: f.etag }) : res(null, 404);
        if (method === 'GET') {
            st.getReceived++;
            const snap = f ? { ...f } : null;
            log.push(`GET ${p} -> ${snap ? snap.etag : 404}`);
            if (st.holdNextGet) { const w = st.holdNextGet; st.holdNextGet = null; await w; }
            return snap ? res(snap.body, 200, { ETag: snap.etag }) : res('', 404);
        }
        if (method === 'PUT') {
            const im = init.headers && init.headers['If-Match'];
            if (f && im && im !== f.etag) { log.push(`PUT ${p} If-Match=${im} -> 412 (now ${f.etag})`); return res('conflict', 412); }
            put(p, init.body);
            st.puts++;
            log.push(`PUT ${p} If-Match=${im || '-'} -> 200 ${files.get(p).etag}`);
            if (st.dropNextPutResponse) { st.dropNextPutResponse = false; log.push('  (応答を消した)'); throw new TypeError('Load failed'); }
            return res(null, 200, { ETag: files.get(p).etag });
        }
        throw new Error(`no route ${method} ${p}`);
    });
    return { files, log, st };
}

const doc = (n) => ({ articles: [{ id: 'a1', title: `t${n}` }] });

let adapter;
beforeEach(() => {
    try { localStorage.clear(); } catch (_) { /* noop */ }
    adapter = new HubStorageAdapter({ apiBase: API, getKey: () => 'hk_deadbeef' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('#771 H1 応答の消えた自分の書き込み', () => {
    it('PUT が保存先に入ったのに応答が消えた後、次の保存（違う中身）が 412→「他の場所で更新」にならない', async () => {
        const hub = fakeHub({ [ART]: JSON.stringify(doc(0)) });
        await adapter.readJSON(ART);
        hub.st.dropNextPutResponse = true;
        await expect(adapter.writeJSON(ART, doc(1))).rejects.toThrow('Load failed');
        // 保存先にあるのは自分の doc(1)＝結果待ちの中身 → 自分の版とみなして1回だけ送り直す
        await adapter.writeJSON(ART, doc(2));
        expect(JSON.parse(hub.files.get(ART).body)).toEqual(doc(2));
        expect(hub.log.slice(-3)).toEqual([
            `PUT ${ART} If-Match="v1" -> 412 (now "v2")`,
            `GET ${ART} -> "v2"`,
            `PUT ${ART} If-Match="v2" -> 200 "v3"`,
        ]);
        expect(adapter._pendingWrites.has(ART)).toBe(false); // 応答を受けたので結果待ちは空
        // 控えが進んでいる＝その次の保存は 412 にならない
        await adapter.writeJSON(ART, doc(3));
        expect(hub.log.at(-1)).toBe(`PUT ${ART} If-Match="v3" -> 200 "v4"`);
    });

    it('応答が消えた後、同じ中身の再送は送らずに成功する（保存先が既に書きたい中身）', async () => {
        const hub = fakeHub({ [ART]: JSON.stringify(doc(0)) });
        await adapter.readJSON(ART);
        hub.st.dropNextPutResponse = true;
        await expect(adapter.writeJSON(ART, doc(1))).rejects.toThrow('Load failed');
        const putsBefore = hub.st.puts;
        await adapter.writeJSON(ART, doc(1));
        expect(hub.st.puts).toBe(putsBefore); // 412 の後に送り直していない
        expect(adapter._etagCache.get(ART)).toBe('"v2"'); // 控えの版が最新になった
        await adapter.writeJSON(ART, doc(2));
        expect(hub.log.at(-1)).toBe(`PUT ${ART} If-Match="v2" -> 200 "v3"`);
    });

    it('まとめ保存でも、応答の消えた自分の送信を他の変更と見誤らない', async () => {
        const hub = fakeHub({ [ART]: JSON.stringify(doc(0)) });
        await adapter.readJSON(ART);
        hub.st.dropNextBatchResponse = true;
        adapter.beginBatch();
        adapter.addBatchEntry(ART, JSON.stringify(doc(1)));
        await expect(adapter.commitBatch()).rejects.toThrow('Load failed');
        adapter.beginBatch();
        adapter.addBatchEntry(ART, JSON.stringify(doc(2)));
        await expect(adapter.commitBatch()).resolves.toBe(true);
        expect(JSON.parse(hub.files.get(ART).body)).toEqual(doc(2));
        expect(hub.log.slice(-3)).toEqual([`BATCH -> 412 ${ART}`, `GET ${ART} -> "v2"`, 'BATCH -> 200 "v3"']);
    });

    it('応答が消えた後に別の端末が書いていたら、今までどおり HubRemoteChangedError（上書きしない）', async () => {
        const hub = fakeHub({ [ART]: JSON.stringify(doc(0)) });
        await adapter.readJSON(ART);
        hub.st.dropNextPutResponse = true;
        await expect(adapter.writeJSON(ART, doc(1))).rejects.toThrow('Load failed');
        hub.files.set(ART, { body: JSON.stringify(doc(99)), etag: '"other"' });
        await expect(adapter.writeJSON(ART, doc(2))).rejects.toBeInstanceOf(HubRemoteChangedError);
        expect(JSON.parse(hub.files.get(ART).body)).toEqual(doc(99));
    });

    it('まとめ保存：応答が消えた後に別の端末が書いていたら HubRemoteChangedError', async () => {
        const hub = fakeHub({ [ART]: JSON.stringify(doc(0)) });
        await adapter.readJSON(ART);
        hub.st.dropNextBatchResponse = true;
        adapter.beginBatch();
        adapter.addBatchEntry(ART, JSON.stringify(doc(1)));
        await expect(adapter.commitBatch()).rejects.toThrow('Load failed');
        hub.files.set(ART, { body: JSON.stringify(doc(99)), etag: '"other"' });
        adapter.beginBatch();
        adapter.addBatchEntry(ART, JSON.stringify(doc(2)));
        await expect(adapter.commitBatch()).rejects.toBeInstanceOf(HubRemoteChangedError);
        expect(JSON.parse(hub.files.get(ART).body)).toEqual(doc(99));
    });

    it('応答を受けた失敗（5xx）は結果待ちに残さない', async () => {
        const hub = fakeHub({ [ART]: JSON.stringify(doc(0)) });
        await adapter.readJSON(ART);
        const orig = globalThis.fetch;
        globalThis.fetch = vi.fn(async (url, init = {}) => ((init.method || '').toUpperCase() === 'PUT' ? res('boom', 503) : orig(url, init)));
        await expect(adapter.writeJSON(ART, doc(1))).rejects.toThrow();
        expect(adapter._pendingWrites.has(ART)).toBe(false);
        void hub;
    });

    it("切り替え bookshelf.flag.ownWriteMatch='0' では前の形（誤検出が起きる）", async () => {
        localStorage.setItem('bookshelf.flag.ownWriteMatch', '0');
        const hub = fakeHub({ [ART]: JSON.stringify(doc(0)) });
        await adapter.readJSON(ART);
        hub.st.dropNextPutResponse = true;
        await expect(adapter.writeJSON(ART, doc(1))).rejects.toThrow('Load failed');
        await expect(adapter.writeJSON(ART, doc(2))).rejects.toBeInstanceOf(HubRemoteChangedError);
        expect(hub.log).toEqual([
            `GET ${ART} -> "v1"`,
            `PUT ${ART} If-Match="v1" -> 200 "v2"`, '  (応答を消した)',
            `PUT ${ART} If-Match="v1" -> 412 (now "v2")`, // 控えの版が v1 のまま（応答が来ないと進まない）
            `GET ${ART} -> "v2"`, // 最新＝自分の doc(1) ≠ 控えの中身 doc(0) → 他の変更と判定
        ]);
    });
});

describe('#771 H2 読みが書きに追い越される', () => {
    it('書き込み中に始まった GET の応答が後から届いても、次の保存が誤検出にならない', async () => {
        const hub = fakeHub({ [ART]: JSON.stringify(doc(0)) });
        let release;
        hub.st.holdNextGet = new Promise((r) => { release = r; });
        const reading = adapter.readJSON(ART); // 古い doc(0) を v1 で掴んだまま止まる
        await vi.waitFor(() => expect(hub.st.getReceived).toBe(1));
        await adapter.writeJSON(ART, doc(1)); // HEAD v1 → PUT → v2（控え＝v2/doc(1)）
        release();
        expect(await reading).toEqual(doc(0)); // 読みは古い中身を返す（呼び手は書き込みを待ってから読む＝openPublishPagesModal #595）
        expect(adapter._etagCache.get(ART)).toBe('"v2"'); // 控えは巻き戻らない
        await adapter.writeJSON(ART, doc(2));
        expect(JSON.parse(hub.files.get(ART).body)).toEqual(doc(2));
    });

    it("切り替え '0' では前の形（読みの応答が控えを v1 に戻し、次の保存が誤検出）", async () => {
        localStorage.setItem('bookshelf.flag.ownWriteMatch', '0');
        const hub = fakeHub({ [ART]: JSON.stringify(doc(0)) });
        let release;
        hub.st.holdNextGet = new Promise((r) => { release = r; });
        const reading = adapter.readJSON(ART);
        await vi.waitFor(() => expect(hub.st.getReceived).toBe(1));
        await adapter.writeJSON(ART, doc(1));
        release();
        expect(await reading).toEqual(doc(0));
        await expect(adapter.writeJSON(ART, doc(2))).rejects.toBeInstanceOf(HubRemoteChangedError);
    });
});

describe('#771 本当の他の端末の変更は今もこれからも検出する', () => {
    it('別の端末が書いた後の保存は HubRemoteChangedError（上書きしない）', async () => {
        const hub = fakeHub({ [ART]: JSON.stringify(doc(0)) });
        await adapter.readJSON(ART);
        hub.files.set(ART, { body: JSON.stringify(doc(99)), etag: '"other"' });
        await expect(adapter.writeJSON(ART, doc(1))).rejects.toBeInstanceOf(HubRemoteChangedError);
        expect(JSON.parse(hub.files.get(ART).body)).toEqual(doc(99));
    });
});
