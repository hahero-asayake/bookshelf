// @vitest-environment node
// DELETE /account (退会)・認証キーの失効・不正 ID トークン (イシュー#204 / 設計: 09 §10.3-v2, ADR-076)。
//  - 所見A: 退会は呼び出しに使ったキー1本しか消さず、同一アカウントの別キーが削除済みアカウントの R2 に書けた。
//  - 所見B: 退会後も KV の uname:<username> / email:<address> が残り、再登録で POST /username は 200 なのに
//          /usage の username が null になる。
//          → 退会で email: は削除、uname: は墓標 (tombstone・生の uid を持たず本人照合ハッシュのみ) に置換。
//            他人は同名を取れず (409)、cdn も 404。退会した本人だけが再登録で取り戻せる (②承認 2026-09-24)。
//  - 3    : 不正形式の idToken (JSON.parse 失敗など) が 401 でなく 500 になる。
// 経路を通す形: default export の fetch ハンドラ (ルーティング・cors・エラー正規化込み) を叩く。
// 再ログインは実際に RS256 で署名した ID トークンを POST /session に渡す (Google JWKS の fetch だけ差し替え)。
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import worker from '../../cf-worker/asayake-hub.js';
import cdn from '../../cf-worker/bookshelf-cdn.js';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const KID = 'test-kid';
const EMAIL = 'taro@example.invalid';

function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        store,
        async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); },
        async list({ prefix = '' } = {}) {
            return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true };
        }
    };
}

function makeR2() {
    const store = new Map();
    const sizeOf = (v) => new TextEncoder().encode(v).length;
    return {
        store,
        async get(k) { const v = store.get(k); return v == null ? null : { body: v, httpEtag: '"e"', etag: 'e', size: sizeOf(v) }; },
        async head(k) { const v = store.get(k); return v == null ? null : { size: sizeOf(v), etag: 'e' }; },
        async put(k, body) { store.set(k, body); return { httpEtag: '"e"' }; },
        async delete(k) { store.delete(k); },
        async list({ prefix = '' } = {}) {
            return { objects: [...store.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false };
        }
    };
}

// ----- Google ID トークンの署名 (ローカル鍵) -----
const b64u = (buf) => Buffer.from(buf).toString('base64url');
let privateKey;
let publicJwk;

beforeAll(async () => {
    const kp = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true, ['sign', 'verify']);
    privateKey = kp.privateKey;
    publicJwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
});

async function mintIdToken(claims = {}, header = { alg: 'RS256', kid: KID }) {
    const h = b64u(JSON.stringify(header));
    const p = b64u(JSON.stringify({
        iss: 'https://accounts.google.com', aud: CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 3600, ...claims
    }));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}

// 同一ミリ秒でのキー発行/再登録の衝突 (世代判定の境界) を避けるため Date を固定し、明示的に進める。
const tick = (ms = 1000) => vi.setSystemTime(Date.now() + ms);

let KV, R2, env, realFetch;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T00:00:00Z'));
    KV = makeKV();
    R2 = makeR2();
    env = { KV, BUCKET: R2, GOOGLE_CLIENT_ID: CLIENT_ID, HUB_DOMAIN: 'hub.test' };
    globalThis.caches = { default: { async match() { return null; }, async put() {} } };   // bookshelf-cdn が使う Cache API
    realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input) => {
        if (String(input) === GOOGLE_CERTS) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
        throw new Error(`unexpected fetch: ${input}`);
    });
});

afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
});

function call(method, path, { key, body } = {}) {
    const headers = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    return worker.fetch(new Request(`https://hub.test${path}`, { method, headers, body }), env, {});
}

// /session 経由のログイン。戻り値 = { key, uid, ... } (同じ sub で何度呼んでも新しいキーが1本増える)
async function login(sub = 'g-sub-1', email = EMAIL) {
    const idToken = await mintIdToken({ sub, email });
    const res = await call('POST', '/session', { body: JSON.stringify({ idToken }) });
    expect(res.status).toBe(200);
    return res.json();
}

// bookshelf.asayake.org 配信 Worker (同じ KV/R2 を参照する)。username → 公開ページ
const cdnGet = (name) => cdn.fetch(new Request(`https://bookshelf.asayake.org/${name}/`), { KV, BUCKET: R2 }, { waitUntil() {} });
const setUsername = (key, username) => call('POST', '/username', { key, body: JSON.stringify({ username }) });
const putData = (key, name = 'x.txt') => call('PUT', `/data/${name}`, { key, body: 'hello' });
const dataObjects = () => [...R2.store.keys()].filter(k => k.startsWith('data/'));

describe('所見A: 退会で同一アカウントの全キーが失効する', () => {
    it('別端末で発行済みのキー hk_B は、hk_A で退会した後は PUT /data が 401 で R2 に書けない', async () => {
        const a = await login(); tick();
        const b = await login(); tick();
        expect(a.key).not.toBe(b.key);
        expect((await putData(b.key)).status).toBe(200);   // 退会前は有効 (前提の確認)

        expect((await call('DELETE', '/account', { key: a.key })).status).toBe(200);
        expect(dataObjects()).toEqual([]);                 // 退会で私的データは消えている

        const res = await putData(b.key);
        expect(res.status).toBe(401);
        expect(dataObjects()).toEqual([]);                 // 削除済みアカウントの R2 に何も書かれていない
    });

    it('退会後、別キー hk_B の /usage も 401 (削除済みアカウントとして扱う)', async () => {
        const a = await login(); tick();
        const b = await login(); tick();
        await call('DELETE', '/account', { key: a.key });
        expect((await call('GET', '/usage', { key: b.key })).status).toBe(401);
    });

    it('退会後に同じ Google アカウントで再ログイン (hk_C) しても、旧キー hk_A/hk_B は復活しない', async () => {
        const a = await login(); tick();
        const b = await login(); tick();
        await call('DELETE', '/account', { key: a.key }); tick();
        const c = await login(); tick();                   // 同一 sub → 同一 uid のアカウントが作り直される

        expect((await putData(b.key)).status).toBe(401);
        expect((await putData(a.key)).status).toBe(401);
        expect((await call('GET', '/usage', { key: b.key })).status).toBe(401);
        // 再登録後の新キーは通常どおり使える (過剰失効の回帰ガード)
        expect((await putData(c.key)).status).toBe(200);
        expect((await call('GET', '/usage', { key: c.key })).status).toBe(200);
    });
});

describe('所見B: 退会で email は削除・username は墓標化 (本人だけ取り戻せる)', () => {
    it('username 予約済みの退会後、email:<address> は消え、uname:<username> は生の uid を持たない墓標になる', async () => {
        const a = await login();
        expect((await setUsername(a.key, 'taro')).status).toBe(200);
        expect(KV.store.has('uname:taro')).toBe(true);
        expect(KV.store.has(`email:${EMAIL}`)).toBe(true);

        expect((await call('DELETE', '/account', { key: a.key })).status).toBe(200);

        expect(KV.store.has(`email:${EMAIL}`)).toBe(false);
        const tomb = await KV.get('uname:taro', 'json');
        expect(tomb.tombstone).toBe(true);
        expect(tomb.owner).toMatch(/^[0-9a-f]{64}$/);            // 本人照合用の HMAC-SHA-256
        expect(tomb.uid).toBeUndefined();
        expect(tomb.siteId).toBeUndefined();
        expect(tomb.movedTo).toBeUndefined();
        expect(JSON.stringify([...KV.store])).not.toContain(a.uid);   // KV のどこにも生の uid (Google sub) が残らない
        // 既存の削除対象 (回帰ガード)
        for (const k of [`uid:${a.uid}`, `plan:${a.uid}`, `usage:${a.uid}`, `site:${a.siteId}`]) {
            expect(KV.store.has(k)).toBe(false);
        }
    });

    it('退会→同じ Google アカウントで再ログイン→同名 username を取り直すと 200 かつ /usage に username が入る', async () => {
        const a = await login();
        await setUsername(a.key, 'taro');
        await call('DELETE', '/account', { key: a.key }); tick();
        const c = await login(); tick();
        expect(c.username).toBeNull();                     // 作り直したアカウントは username 未設定

        const res = await setUsername(c.key, 'taro');
        expect(res.status).toBe(200);
        const usage = await (await call('GET', '/usage', { key: c.key })).json();
        expect(usage.username).toBe('taro');
        expect(usage.bookshelfBase).toBe('https://bookshelf.asayake.org/taro/');
        // 墓標は生きたレコードに戻り、新しい siteId を指す
        const rec = await KV.get('uname:taro', 'json');
        expect(rec).toMatchObject({ uid: c.uid, siteId: c.siteId });
        expect(rec.tombstone).toBeUndefined();
    });

    it('退会後、別アカウントは同名 username を取れない (409)。退会した本人だけが取り戻せる', async () => {
        const a = await login('g-sub-1', EMAIL);
        await setUsername(a.key, 'taro');
        await call('DELETE', '/account', { key: a.key }); tick();

        const other = await login('g-sub-2', 'jiro@example.invalid');
        expect((await setUsername(other.key, 'taro')).status).toBe(409);
        expect((await (await call('GET', '/usage', { key: other.key })).json()).username).toBeNull();
        expect((await KV.get('uname:taro', 'json')).tombstone).toBe(true);   // 墓標のまま (乗っ取られていない)

        const back = await login('g-sub-1', EMAIL);
        expect((await setUsername(back.key, 'taro')).status).toBe(200);
    });

    it('退会後の username は bookshelf.asayake.org で 404 (退会前は 200)。改名前の旧名 (301) も他人へ飛ばさず 404', async () => {
        const a = await login();
        await setUsername(a.key, 'taro');
        R2.store.set(`sites/${a.siteId}/index.html`, '<html>taro</html>');
        expect((await cdnGet('taro')).status).toBe(200);
        await setUsername(a.key, 'jiro');                                  // taro → jiro (旧名 taro は movedTo で 301)
        expect((await cdnGet('taro')).status).toBe(301);

        await call('DELETE', '/account', { key: a.key });
        for (const name of ['taro', 'jiro']) {
            const res = await cdnGet(name);
            expect(res.status).toBe(404);
            expect(res.headers.get('Location')).toBeNull();
        }
    });

    it('email:<address> が他アカウントの uid を指している場合は消さない (過剰削除の回帰ガード)', async () => {
        // 同一アドレスを後からログインした別 sub が email: を上書きした状態 (KV は last-writer-wins)
        const x = await login('g-sub-1', EMAIL); tick();
        const y = await login('g-sub-2', EMAIL); tick();
        expect(await KV.get(`email:${EMAIL}`)).toBe(y.uid);

        await call('DELETE', '/account', { key: x.key });
        expect(await KV.get(`email:${EMAIL}`)).toBe(y.uid);
        expect((await putData(y.key)).status).toBe(200);   // 別アカウント y は影響を受けない
    });
});

describe('退会の掃除範囲・順序・墓標の塩 (設計: uid 先行削除・索引・墓標, #204)', () => {
    it('退会後、KV に残るのは墓標 uname: だけ (key:/ukey:/unames:/uid:/plan:/usage:/site:/email: は1件も残らない)', async () => {
        const a = await login(); tick();
        await login(); tick();
        await setUsername(a.key, 'taro');
        await call('DELETE', '/account', { key: a.key });
        expect([...KV.store.keys()]).toEqual(['uname:taro']);
    });

    it('改名 (taro→jiro) 後に退会すると現用名・旧名 (movedTo) の両方が墓標になり、movedTo/siteId は消える', async () => {
        const a = await login();
        await setUsername(a.key, 'taro');
        await setUsername(a.key, 'jiro');
        expect((await KV.get('uname:taro', 'json')).movedTo).toBe('jiro');
        await call('DELETE', '/account', { key: a.key });
        for (const name of ['taro', 'jiro']) {
            const tomb = await KV.get(`uname:${name}`, 'json');
            expect(tomb).toMatchObject({ tombstone: true });
            expect(tomb.movedTo).toBeUndefined();
            expect(tomb.siteId).toBeUndefined();
        }
        // 再登録した本人は旧名・現用名のどちらも取り戻せる
        const c = await login();
        expect((await setUsername(c.key, 'jiro')).status).toBe(200);
        expect((await setUsername(c.key, 'taro')).status).toBe(200);
    });

    it('旧実装の退会残骸 (uname:taro が旧 siteId・同じ uid のまま残存) を、同じ Google アカウントの作り直しが取り直せる', async () => {
        KV.store.set('uname:taro', JSON.stringify({ uid: 'g-sub-1', siteId: 'old-site' }));
        const c = await login('g-sub-1', EMAIL);
        expect((await setUsername(c.key, 'taro')).status).toBe(200);
        expect((await (await call('GET', '/usage', { key: c.key })).json()).username).toBe('taro');
        expect((await KV.get('uname:taro', 'json')).siteId).toBe(c.siteId);   // 新 siteId で上書き
    });

    it('旧実装の退会残骸が別の uid のものなら、他人は従来どおり 409 (乗っ取れない)', async () => {
        KV.store.set('uname:taro', JSON.stringify({ uid: 'g-sub-9', siteId: 'old-site' }));
        const c = await login('g-sub-1', EMAIL);
        expect((await setUsername(c.key, 'taro')).status).toBe(409);
    });

    it('掃除中に R2 が失敗したら uid レコードを戻し、同じキーで退会を再実行できる (全キーは失効しない)', async () => {
        const a = await login(); tick();
        const b = await login();
        const realList = R2.list;
        R2.list = async () => { throw new Error('r2 down'); };
        expect((await call('DELETE', '/account', { key: a.key })).status).toBe(500);
        R2.list = realList;
        expect((await putData(b.key)).status).toBe(200);                       // アカウントは生きている
        expect((await call('DELETE', '/account', { key: a.key })).status).toBe(200);
        expect((await putData(b.key)).status).toBe(401);
    });

    it('TOMBSTONE_SALT を設定した環境でも墓標→本人の取り戻しが通る。塩を変えると (本人でも) 取り戻せない', async () => {
        env.TOMBSTONE_SALT = 'salt-1';
        const a = await login();
        await setUsername(a.key, 'taro');
        await call('DELETE', '/account', { key: a.key }); tick();
        const c = await login(); tick();
        expect((await setUsername(c.key, 'taro')).status).toBe(200);

        await call('DELETE', '/account', { key: c.key }); tick();
        env.TOMBSTONE_SALT = 'salt-2';                                        // 塩の変更 = 既存の墓標は照合できなくなる (仕様)
        const d = await login();
        expect((await setUsername(d.key, 'taro')).status).toBe(409);
    });
});

describe('不正形式の idToken は 500 でなく 401', () => {
    const b64json = (v) => b64u(typeof v === 'string' ? v : JSON.stringify(v));

    it.each([
        ['aaa.bbb.ccc (#199 の実測ケース)', () => 'aaa.bbb.ccc'],
        ['base64url でない文字列', () => '!!!.???.***'],
        ['base64url だが JSON でない header/payload', () => `${b64json('not json')}.${b64json('also not json')}.sig`],
        ['payload が JSON の null', () => `${b64json({ alg: 'RS256', kid: KID })}.${b64json('null')}.sig`],
        ['header が JSON の null (payload は正当)', () => `${b64json('null')}.${b64json({ iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`],
        ['部分が2つしかない', () => 'aaa.bbb'],
    ])('%s', async (_name, make) => {
        const res = await call('POST', '/session', { body: JSON.stringify({ idToken: make() }) });
        expect(res.status).toBe(401);
        expect([...KV.store.keys()]).toEqual([]);          // アカウントも鍵も作られない
    });
});
