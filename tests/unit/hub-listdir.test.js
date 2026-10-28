// hub worker GET /data/<dir>?list=1 (cf-worker/asayake-hub.js:564 listDir) のテスト。
// イシュー#392: files/dirs (既存互換) に加えて entries[](name/etag/size/uploaded) と
// truncated を返すようになった。既存呼び出し (hub-adapter.js:414 の listFiles/listDirs は
// files/dirs のみ読む) が壊れないこと、entries[].etag が同ファイルの GET の ETag と一致する
// こと、truncated 時の契約 (entries は付けたまま truncated:true) を確認する。
// 本テストは経路を通す形: default export の fetch ハンドラ (cf-worker/asayake-hub.js) を叩く
// (hub-batch.test.js と同じ型)。
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

// hub-batch.test.js の makeR2 を基に、delimiter (ディレクトリ区切り) と truncated を注入できるよう拡張。
function makeR2({ truncated = false } = {}) {
    const store = new Map(); // key -> { body, etag, size, uploaded }
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
        async put(k, body) {
            const etag = `e${++seq}`;
            const size = new TextEncoder().encode(body).length;
            const uploaded = new Date(Date.UTC(2026, 0, 1, 0, 0, seq));
            store.set(k, { body, etag, size, uploaded });
            return { httpEtag: `"${etag}"`, etag, size, uploaded };
        },
        async delete(k) { store.delete(k); },
        // 本番 R2 の list({prefix, delimiter}) と同じ意味: delimiter 以降を含むキーは
        // delimitedPrefixes にまとめ、objects には含めない。
        async list({ prefix = '', delimiter } = {}) {
            const objects = [];
            const dirSet = new Set();
            for (const [k, v] of store.entries()) {
                if (!k.startsWith(prefix)) continue;
                const rest = k.slice(prefix.length);
                if (delimiter && rest.includes(delimiter)) {
                    dirSet.add(prefix + rest.slice(0, rest.indexOf(delimiter) + delimiter.length));
                    continue;
                }
                objects.push({ key: k, httpEtag: `"${v.etag}"`, etag: v.etag, size: v.size, uploaded: v.uploaded });
            }
            return { objects, delimitedPrefixes: [...dirSet], truncated };
        }
    };
}

let KV, R2, env;
function setup({ truncated = false } = {}) {
    KV = makeKV({
        [`key:${KEY}`]: { uid: UID, siteId: 'site1', created: 1 },
        [`uid:${UID}`]: { uid: UID, siteId: 'site1', createdAt: 0 }
    });
    R2 = makeR2({ truncated });
    env = { KV, BUCKET: R2, GOOGLE_CLIENT_ID: 'c', HUB_DOMAIN: 'hub.test' };
}
beforeEach(() => setup());

function list(dir, key = KEY) {
    return worker.fetch(new Request(`https://hub.test/data/${dir}?list=1`, {
        method: 'GET', headers: { Authorization: `Bearer ${key}` }
    }), env, {});
}
function getFile(path, key = KEY) {
    return worker.fetch(new Request(`https://hub.test/data/${path}`, {
        method: 'GET', headers: { Authorization: `Bearer ${key}` }
    }), env, {});
}

describe('既存互換: files/dirs はフィールド追加前と同じ値', () => {
    it('files はファイル名のみ、dirs はサブディレクトリ名のみを返す', async () => {
        await R2.put('data/u1/private/a.json', '{}');
        await R2.put('data/u1/private/b.json', '{}');
        await R2.put('data/u1/private/sub/c.json', '{}');
        const res = await list('private');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.files.sort()).toEqual(['a.json', 'b.json']);
        expect(body.dirs).toEqual(['sub']);
    });
});

describe('entries[]: etag が GET の ETag ヘッダと一致する (イシュー#392)', () => {
    it('entries[].etag は同ファイルの GET レスポンスの ETag ヘッダと同じ文字列(クォート付き)', async () => {
        await R2.put('data/u1/private/library.json', '{"books":[]}');
        const listRes = await list('private');
        const listBody = await listRes.json();
        const entry = listBody.entries.find((e) => e.name === 'library.json');
        expect(entry).toBeTruthy();

        const getRes = await getFile('private/library.json');
        expect(getRes.headers.get('ETag')).toBe(entry.etag);
    });

    it('entries[] は name/etag/size/uploaded を持ち、files と同じ集合を指す', async () => {
        await R2.put('data/u1/private/x.json', '12345');
        const res = await list('private');
        const body = await res.json();
        expect(body.entries).toHaveLength(1);
        const [e] = body.entries;
        expect(e.name).toBe('x.json');
        expect(e.etag).toMatch(/^".+"$/);
        expect(e.size).toBe(5);
        expect(e.uploaded).toBeTruthy();
        expect(body.files).toEqual(['x.json']);
    });

    it('truncated でない時は truncated:false を返す', async () => {
        await R2.put('data/u1/private/a.json', '{}');
        const res = await list('private');
        const body = await res.json();
        expect(body.truncated).toBe(false);
    });
});

describe('truncated (1000件超・R2既定上限) の契約 (②指示2026-10-29)', () => {
    it('truncated:true の時も entries は付けたまま返す(消さない)', async () => {
        setup({ truncated: true });
        await R2.put('data/u1/private/a.json', '{}');
        const res = await list('private');
        const body = await res.json();
        expect(body.truncated).toBe(true);
        expect(body.entries.length).toBeGreaterThan(0);
        expect(body.files.length).toBeGreaterThan(0); // files/dirs の既存挙動も変えない
    });
});
