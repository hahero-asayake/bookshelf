// @vitest-environment node
// 通報モデレーション (ADR-099 Q1=A・全件手動審査 / イシュー#220 step3)
//  - POST /community/report: category 必須・重複は 200 {duplicate:true} で件数を増やさない・自記事は 400・索引外 URL は 404・日次上限 429。
//    受付時に Discord webhook で通知 (通報者の uid/メールは載せない)。未設定・失敗でも通報は成功。status は自動では変えない。
//  - /admin/reports・/admin/articles/:id/hide|restore・/admin/reports/:id/dismiss: 管理者 (ADMIN_EMAILS) だけ。
// 経路を通す形: default export の fetch。D1 は実 SQLite (node:sqlite)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../../cf-worker/asayake-hub.js';
import { makeSqliteD1 } from './helpers/sqlite-d1.js';

function makeKV(initial = {}) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return {
        store,
        async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { store.set(k, v); },
        async delete(k) { store.delete(k); },
        async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
    };
}

const URL_A = 'https://bookshelf.asayake.org/alice/AbCdEfGhIj/';
const HOOK = 'https://discord.example/api/webhooks/1/secret-token';
let env, DB, pending, hookCalls, realFetch;

beforeEach(() => {
    DB = makeSqliteD1();
    DB._db.exec(`INSERT INTO sites (id, uid, url, title, created_at, updated_at, public_id) VALUES ('sA','ualice','${URL_A}','アリスの記事',1,1,'AbCdEfGhIj')`);
    env = {
        DB, HUB_DOMAIN: 'hub.example', ADMIN_EMAILS: 'admin@example.com', REPORT_WEBHOOK_URL: HOOK,
        KV: makeKV({
            'key:hk_aaaaaa': { uid: 'ualice', siteId: 'sa' }, 'uid:ualice': { email: 'alice@example.com', siteId: 'sa' },
            'key:hk_bbbbbb': { uid: 'ubob', siteId: 'sb' }, 'uid:ubob': { email: 'bob@example.com', siteId: 'sb' },
            'key:hk_cccccc': { uid: 'ucarol', siteId: 'sc' }, 'uid:ucarol': { email: 'carol@example.com', siteId: 'sc' },
            'key:hk_dddddd': { uid: 'uadmin', siteId: 'sd' }, 'uid:uadmin': { email: 'admin@example.com', siteId: 'sd' }
        })
    };
    pending = []; hookCalls = [];
    realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u, init) => { hookCalls.push({ url: String(u), body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

const call = async (path, method, body, key) => {
    const res = await worker.fetch(new Request('https://hub.example' + path, {
        method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: body != null ? JSON.stringify(body) : undefined
    }), env, { waitUntil(p) { pending.push(p); } });
    await Promise.all(pending);
    return res;
};
const report = (o = {}, key = 'hk_bbbbbb') => call('/community/report', 'POST', { articleUrl: URL_A, category: 'spam', reason: '広告ばかり', ...o }, key);
const site = () => DB.rows(`SELECT status, hidden, report_count FROM sites WHERE id='sA'`)[0];
const reports = () => DB.rows(`SELECT * FROM reports ORDER BY created_at`);

describe('POST /community/report (索引の記事の通報)', () => {
    it('通報を記録し report_count を加算する。status は自動では変えない (Q1=A・自動非表示なし)', async () => {
        const res = await report();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        expect(reports()).toHaveLength(1);
        expect(reports()[0]).toMatchObject({ target_type: 'site', target_id: 'sA', uid: 'ubob', category: 'spam', status: 'open', reason: '広告ばかり', weight: 1 });
        expect(site()).toEqual({ status: 'active', hidden: 0, report_count: 1 });
    });

    it('複数人が通報しても status は active のまま (件数が増えても自動非表示にならない)', async () => {
        for (const k of ['hk_bbbbbb', 'hk_cccccc', 'hk_dddddd']) await report({}, k);
        expect(site()).toEqual({ status: 'active', hidden: 0, report_count: 3 });
    });

    it('同じ uid の重複通報は 200 {duplicate:true} で、件数も通知も増えない', async () => {
        await report();
        const res = await report({ reason: 'もう一度' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true, duplicate: true });
        expect(reports()).toHaveLength(1);
        expect(site().report_count).toBe(1);
        expect(hookCalls).toHaveLength(1);
    });

    it('category が無い・不正なら 400 (何も記録しない)', async () => {
        expect((await report({ category: undefined })).status).toBe(400);
        expect((await report({ category: 'nope' })).status).toBe(400);
        expect(reports()).toHaveLength(0);
    });

    it('未ログインは 401', async () => {
        expect((await call('/community/report', 'POST', { articleUrl: URL_A, category: 'spam' }, null)).status).toBe(401);
    });

    it('索引に無い URL (自前公開・他サイト・非表示の記事) は 404 = 通報の対象外', async () => {
        expect((await report({ articleUrl: 'https://someone.github.io/bookshelf/x/' })).status).toBe(404);
        DB._db.exec(`UPDATE sites SET status='hidden', hidden=1`);
        expect((await report()).status).toBe(404);
        expect(reports()).toHaveLength(0);
    });

    it('自分の記事は通報できない (400)', async () => {
        expect((await report({}, 'hk_aaaaaa')).status).toBe(400);
        expect(reports()).toHaveLength(0);
    });

    it('targetId (=sites.id) でも指せる', async () => {
        const res = await report({ articleUrl: undefined, targetType: 'site', targetId: 'sA' });
        expect(res.status).toBe(200);
        expect(reports()[0].target_id).toBe('sA');
    });

    it('uid あたり日次 20 件を超えると 429 (重複の再送も数える)・別の uid は影響を受けない', async () => {
        await report();
        for (let i = 0; i < 19; i++) expect((await report()).status).toBe(200);   // 重複 19 回 = 合計 20 回
        expect((await report()).status).toBe(429);
        expect(reports()).toHaveLength(1);
        expect((await report({}, 'hk_cccccc')).status).toBe(200);
    });
});

describe('通知 (Discord webhook)', () => {
    it('受付時に webhook へ POST する。記事 URL・カテゴリ・件数は載り、通報者の uid/メールは載らない・メンションは無効化', async () => {
        await report({ reason: '@everyone 見て' });
        expect(hookCalls).toHaveLength(1);
        expect(hookCalls[0].url).toBe(HOOK);
        const c = hookCalls[0].body.content;
        expect(c).toContain('アリスの記事');
        expect(c).toContain(URL_A);
        expect(c).toContain('スパム');
        expect(c).toContain('1 件');
        for (const secret of ['ubob', 'bob@example.com', 'ualice', 'alice@example.com']) expect(c).not.toContain(secret);
        expect(hookCalls[0].body.allowed_mentions).toEqual({ parse: [] });
    });

    it('REPORT_WEBHOOK_URL 未設定でも通報は成功し、通知は飛ばない (warn のみ)', async () => {
        delete env.REPORT_WEBHOOK_URL;
        const res = await report();
        expect(res.status).toBe(200);
        expect(reports()).toHaveLength(1);
        expect(hookCalls).toHaveLength(0);
        expect(console.warn).toHaveBeenCalled();
    });

    it('webhook が失敗 (例外・非 2xx) しても通報は成功する', async () => {
        globalThis.fetch = vi.fn(async () => { throw new Error('network down'); });
        expect((await report()).status).toBe(200);
        globalThis.fetch = vi.fn(async () => new Response('x', { status: 500 }));
        expect((await report({}, 'hk_cccccc')).status).toBe(200);
        expect(reports()).toHaveLength(2);
    });
});

describe('通報の審査 API (管理者のみ)', () => {
    it('非管理者・未ログインは 403/401', async () => {
        expect((await call('/admin/reports', 'GET', null, 'hk_bbbbbb')).status).toBe(403);
        expect((await call('/admin/reports', 'GET', null, null)).status).toBe(401);
        expect((await call('/admin/articles/sA/hide', 'POST', {}, 'hk_bbbbbb')).status).toBe(403);
        expect((await call('/admin/articles/sA/restore', 'POST', {}, 'hk_bbbbbb')).status).toBe(403);
        expect((await call('/admin/reports/x/dismiss', 'POST', {}, 'hk_bbbbbb')).status).toBe(403);
        expect(site().status).toBe('active');
    });

    it('GET /admin/reports: 未対応の通報を記事単位に集約して返す (通報者の uid は返さない)', async () => {
        await report({ category: 'spam', reason: '広告' });
        await report({ category: 'abuse', reason: '' }, 'hk_cccccc');
        const j = await (await call('/admin/reports', 'GET', null, 'hk_dddddd')).json();
        expect(j.reports).toHaveLength(1);
        expect(j.reports[0]).toMatchObject({ articleId: 'sA', url: URL_A, title: 'アリスの記事', articleStatus: 'active', count: 2, categories: { spam: 1, abuse: 1 } });
        expect(j.reports[0].reportIds).toHaveLength(2);
        expect(JSON.stringify(j)).not.toMatch(/ubob|ucarol|bob@|carol@/);
        expect(j.hidden).toEqual([]);
    });

    it('hide → 公開一覧から消え、未対応の通報は対応済みになり、非表示リストに出る。restore → 一覧に戻り、通報は却下扱い・件数 0', async () => {
        await report();
        const hide = await call('/admin/articles/sA/hide', 'POST', {}, 'hk_dddddd');
        expect(hide.status).toBe(200);
        expect(site()).toMatchObject({ status: 'hidden', hidden: 1 });
        expect((await (await call('/community/sites', 'GET')).json()).sites).toEqual([]);
        expect(reports()[0].status).toBe('actioned');
        const list = await (await call('/admin/reports', 'GET', null, 'hk_dddddd')).json();
        expect(list.reports).toEqual([]);
        expect(list.hidden.map(h => h.articleId)).toEqual(['sA']);

        const restore = await call('/admin/articles/sA/restore', 'POST', {}, 'hk_dddddd');
        expect(restore.status).toBe(200);
        expect(site()).toEqual({ status: 'active', hidden: 0, report_count: 0 });
        expect((await (await call('/community/sites', 'GET')).json()).sites.map(s => s.url)).toEqual([URL_A]);
        expect(reports()[0].status).toBe('dismissed');
        expect((await (await call('/admin/reports', 'GET', null, 'hk_dddddd')).json()).hidden).toEqual([]);
    });

    it('dismiss → その通報だけ却下・件数は 1 減り・記事は active のまま。重複 dismiss は冪等', async () => {
        await report({}, 'hk_bbbbbb'); await report({}, 'hk_cccccc');
        const j = await (await call('/admin/reports', 'GET', null, 'hk_dddddd')).json();
        const [r1] = j.reports[0].reportIds;
        expect((await call(`/admin/reports/${r1}/dismiss`, 'POST', {}, 'hk_dddddd')).status).toBe(200);
        expect((await call(`/admin/reports/${r1}/dismiss`, 'POST', {}, 'hk_dddddd')).status).toBe(200);
        expect(site()).toEqual({ status: 'active', hidden: 0, report_count: 1 });
        expect(reports().filter(r => r.status === 'dismissed')).toHaveLength(1);
        expect((await (await call('/admin/reports', 'GET', null, 'hk_dddddd')).json()).reports[0].count).toBe(1);
    });

    it('存在しない記事・通報は 404', async () => {
        expect((await call('/admin/articles/none/hide', 'POST', {}, 'hk_dddddd')).status).toBe(404);
        expect((await call('/admin/articles/none/restore', 'POST', {}, 'hk_dddddd')).status).toBe(404);
        expect((await call('/admin/reports/none/dismiss', 'POST', {}, 'hk_dddddd')).status).toBe(404);
    });
});
