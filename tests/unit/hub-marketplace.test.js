// @vitest-environment node
// プラグインマーケット レジストリ (Worker asayake-hub.js, ADR-040 Phase1)
//  - GET /plugins = 公開一覧 (認証不要)。POST /admin/plugins = ADMIN_EMAILS guard で upsert/削除。
import { describe, it, expect } from 'vitest';
import { handleListPlugins, handleAdminUpsertPlugin } from '../../cf-worker/asayake-hub.js';

// 簡易 KV モック (get(json)/put/delete/list 互換)
function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        store,
        async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); },
        async list({ prefix = '', cursor } = {}) {
            const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
            return { keys, list_complete: true };
        }
    };
}

// 管理者/一般ユーザのセッションを用意した KV
function authKV(extra = {}) {
    return makeKV({
        'key:hk_aaa111': { uid: 'uadmin', siteId: 's' },
        'uid:uadmin': { email: 'admin@example.com' },
        'key:hk_bbb222': { uid: 'uuser' },
        'uid:uuser': { email: 'user@example.com' },
        ...extra
    });
}
const env = (KV) => ({ KV, ADMIN_EMAILS: 'admin@example.com' });

function upsertReq(body, key = 'hk_aaa111') {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;
    return new Request('https://hub/admin/plugins', { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('GET /plugins (公開一覧)', () => {
    it('plugin:* を name 順で返す (認証不要)', async () => {
        const KV = makeKV({ 'plugin:b': { id: 'b', name: 'Bravo' }, 'plugin:a': { id: 'a', name: 'Alpha' } });
        const res = await handleListPlugins(null, env(KV));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.plugins.map(p => p.id)).toEqual(['a', 'b']); // Alpha, Bravo
    });
    it('空なら空配列', async () => {
        const res = await handleListPlugins(null, env(makeKV()));
        expect((await res.json()).plugins).toEqual([]);
    });
});

describe('POST /admin/plugins (admin guard + 検証)', () => {
    it('管理者は upsert でき、予約フィールドが埋まる', async () => {
        const KV = authKV();
        const res = await handleAdminUpsertPlugin(
            upsertReq({ id: 'series-grouping', name: 'シリーズまとめ', repoUrl: 'https://github.com/hahero-asayake/bookshelf', path: 'plugins-sample/series-grouping', sha: 'abc123', categories: ['filter', 'command'] }),
            env(KV)
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        const saved = JSON.parse(KV.store.get('plugin:series-grouping'));
        expect(saved.path).toBe('plugins-sample/series-grouping');
        expect(saved.sha).toBe('abc123');
        expect(saved.categories).toEqual(['filter', 'command']);
        expect(saved.stars).toBe(0);
        expect(saved.installs).toBe(0);
        expect(saved.reportCount).toBe(0);
        expect(typeof saved.updatedAt).toBe('number');
    });

    it('非管理者は 403', async () => {
        await expect(handleAdminUpsertPlugin(
            upsertReq({ id: 'x', repoUrl: 'https://github.com/o/r' }, 'hk_bbb222'), env(authKV())
        )).rejects.toThrow('admin only');
    });

    it('キー無しは 401', async () => {
        await expect(handleAdminUpsertPlugin(
            upsertReq({ id: 'x', repoUrl: 'https://github.com/o/r' }, null), env(authKV())
        )).rejects.toThrow(/key/i);
    });

    it('不正な id は 400', async () => {
        await expect(handleAdminUpsertPlugin(
            upsertReq({ id: 'Bad Id!', repoUrl: 'https://github.com/o/r' }), env(authKV())
        )).rejects.toThrow('invalid id');
    });

    it('github.com 以外の repoUrl は 400', async () => {
        await expect(handleAdminUpsertPlugin(
            upsertReq({ id: 'x', repoUrl: 'https://gitlab.com/o/r' }), env(authKV())
        )).rejects.toThrow(/repoUrl/);
    });

    it('delete:true でレジストリから削除', async () => {
        const KV = authKV({ 'plugin:x': { id: 'x', name: 'X' } });
        const res = await handleAdminUpsertPlugin(upsertReq({ id: 'x', delete: true }), env(KV));
        expect((await res.json()).deleted).toBe('x');
        expect(KV.store.has('plugin:x')).toBe(false);
    });
});
