// @vitest-environment node
// POST /username (S6・ADR-076・設計書 09 §10.3-v2): username 一意予約と改名の 301 準備。
//  - KV は CAS 無し (last-writer-wins)。ここでは「get→put」実装の正常系・予約語・重複拒否・
//    改名時に旧 username を movedTo で残す (解放しない) 挙動を検証する。
import { describe, it, expect } from 'vitest';
import { handleUsername, handleUsage, handlePublish } from '../../cf-worker/asayake-hub.js';

function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        store,
        async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); }
    };
}

const env = (KV) => ({ KV });

function req(body, key = 'hk_a1') {
    return new Request('https://hub.test/username', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}` },
        body: JSON.stringify(body)
    });
}

describe('handleUsername (POST /username)', () => {
    it('新規予約: uname:<username> と uid:<uid>.username が両方書かれる', async () => {
        const KV = makeKV({ 'key:hk_a1': { uid: 'u1', siteId: 's1' }, 'uid:u1': { siteId: 's1', email: 'e@x' } });
        const res = await handleUsername(req({ username: 'taro-books' }), env(KV));
        const body = await res.json();
        expect(body.username).toBe('taro-books');
        expect(body.bookshelfBase).toBe('https://bookshelf.asayake.org/taro-books/');
        expect(await KV.get('uname:taro-books', 'json')).toEqual({ uid: 'u1', siteId: 's1' });
        expect((await KV.get('uid:u1', 'json')).username).toBe('taro-books');
    });

    it('形式違反 (大文字・記号・短すぎ) は 400', async () => {
        const KV = makeKV({ 'key:hk_a1': { uid: 'u1', siteId: 's1' }, 'uid:u1': { siteId: 's1' } });
        await expect(handleUsername(req({ username: 'Taro_Books' }), env(KV))).rejects.toMatchObject({ status: 400 });
        await expect(handleUsername(req({ username: 'ab' }), env(KV))).rejects.toMatchObject({ status: 400 });
        await expect(handleUsername(req({ username: '-taro' }), env(KV))).rejects.toMatchObject({ status: 400 });
    });

    it('予約語 (①取得禁止語) は 400', async () => {
        const KV = makeKV({ 'key:hk_a1': { uid: 'u1', siteId: 's1' }, 'uid:u1': { siteId: 's1' } });
        await expect(handleUsername(req({ username: 'top' }), env(KV))).rejects.toMatchObject({ status: 400 });
        await expect(handleUsername(req({ username: 'public' }), env(KV))).rejects.toMatchObject({ status: 400 });
        await expect(handleUsername(req({ username: 'kindle' }), env(KV))).rejects.toMatchObject({ status: 400 });
    });

    it('他人が既に取得した username は 409 (先着優先)', async () => {
        const KV = makeKV({
            'key:hk_a1': { uid: 'u1', siteId: 's1' }, 'uid:u1': { siteId: 's1' },
            'uname:taken': { uid: 'other-uid', siteId: 's9' }
        });
        await expect(handleUsername(req({ username: 'taken' }), env(KV))).rejects.toMatchObject({ status: 409 });
    });

    it('自分が既に持つ username への再送は冪等に 200 (409 にしない)', async () => {
        const KV = makeKV({
            'key:hk_a1': { uid: 'u1', siteId: 's1' }, 'uid:u1': { siteId: 's1', username: 'taro-books' },
            'uname:taro-books': { uid: 'u1', siteId: 's1' }
        });
        const res = await handleUsername(req({ username: 'taro-books' }), env(KV));
        expect(res.status).toBe(200);
    });

    it('改名: 旧 username は削除されず movedTo で新 username を指す (解放しない・なりすまし防止)', async () => {
        const KV = makeKV({
            'key:hk_a1': { uid: 'u1', siteId: 's1' }, 'uid:u1': { siteId: 's1', username: 'old-name' },
            'uname:old-name': { uid: 'u1', siteId: 's1' }
        });
        await handleUsername(req({ username: 'new-name' }), env(KV));
        const oldRec = await KV.get('uname:old-name', 'json');
        expect(oldRec.movedTo).toBe('new-name');
        expect(oldRec.uid).toBe('u1'); // 削除されていない
        const newRec = await KV.get('uname:new-name', 'json');
        expect(newRec.uid).toBe('u1');
        expect((await KV.get('uid:u1', 'json')).username).toBe('new-name');
    });

    it('未認証 (Authorization 無し) は 401', async () => {
        const KV = makeKV({});
        const bad = new Request('https://hub.test/username', { method: 'POST', body: JSON.stringify({ username: 'taro' }) });
        await expect(handleUsername(bad, env(KV))).rejects.toMatchObject({ status: 401 });
    });
});

describe('handleUsage / handlePublish の username/bookshelfBase 追従 (S6・ADR-076)', () => {
    function usageReq(key = 'hk_a1') {
        return new Request('https://hub.test/usage', { headers: { 'Authorization': `Bearer ${key}` } });
    }
    function publishReq(body, key = 'hk_a1') {
        return new Request('https://hub.test/publish', { method: 'POST', headers: { 'Authorization': `Bearer ${key}` }, body: JSON.stringify(body) });
    }
    function makeBucket(files = {}) {
        return {
            async list() { return { objects: [], truncated: false }; },
            async put(key, content) { files[key] = content; },
            async delete(key) { delete files[key]; }
        };
    }
    const hubEnv = (KV, BUCKET) => ({ KV, BUCKET, HUB_DOMAIN: 'hub.asayake.org' });

    it('handleUsage: username 設定済みなら bookshelfBase も返す', async () => {
        const KV = makeKV({
            'key:hk_a1': { uid: 'u1', siteId: 's1' },
            'uid:u1': { siteId: 's1', email: 'e@x', username: 'taro-books' },
            'plan:u1': { plan: 'free', quotaBytes: 100 }
        });
        const res = await handleUsage(usageReq(), hubEnv(KV));
        const body = await res.json();
        expect(body.username).toBe('taro-books');
        expect(body.bookshelfBase).toBe('https://bookshelf.asayake.org/taro-books/');
    });

    it('handleUsage: username 未設定なら null (旧 publicBase のまま)', async () => {
        const KV = makeKV({
            'key:hk_a1': { uid: 'u1', siteId: 's1' },
            'uid:u1': { siteId: 's1', email: 'e@x' },
            'plan:u1': { plan: 'free', quotaBytes: 100 }
        });
        const res = await handleUsage(usageReq(), hubEnv(KV));
        const body = await res.json();
        expect(body.username).toBeNull();
        expect(body.bookshelfBase).toBeNull();
        expect(body.publicBase).toBe('https://hub.asayake.org/public/s1/');
    });

    it('handlePublish: username 設定済みなら siteUrl は bookshelf.asayake.org/<username>/', async () => {
        const KV = makeKV({
            'key:hk_a1': { uid: 'u1', siteId: 's1' },
            'uid:u1': { siteId: 's1', email: 'e@x', username: 'taro-books' },
            'plan:u1': { plan: 'free', quotaBytes: 1000000 },
            'usage:u1': '0'
        });
        const res = await handlePublish(publishReq({ files: [{ path: 'index.html', content: '<html></html>' }], deleteMissing: true }), hubEnv(KV, makeBucket()));
        const body = await res.json();
        expect(body.siteUrl).toBe('https://bookshelf.asayake.org/taro-books/');
    });

    it('handlePublish: username 未設定なら siteUrl は従来どおり hub.asayake.org/public/<siteId>/', async () => {
        const KV = makeKV({
            'key:hk_a1': { uid: 'u1', siteId: 's1' },
            'uid:u1': { siteId: 's1', email: 'e@x' },
            'plan:u1': { plan: 'free', quotaBytes: 1000000 },
            'usage:u1': '0'
        });
        const res = await handlePublish(publishReq({ files: [{ path: 'index.html', content: '<html></html>' }], deleteMissing: true }), hubEnv(KV, makeBucket()));
        const body = await res.json();
        expect(body.siteUrl).toBe('https://hub.asayake.org/public/s1/');
    });
});
