// @vitest-environment node
// Asayake コミュニティ API (Worker asayake-hub.js, ADR-044)
//  - 公開本棚ギャラリー掲載 / スター(無料) / コメント(有料のみ) / 直接インストール(hub同期) / 通報。
//  D1 はインメモリ fake、直接インストールは KV/R2/fetch をモックして検証する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    rawGitHubBase,
    handleCommunitySiteUpsert, handleCommunitySitesList, handleCommunitySiteDelete,
    handleCommunityStar, handleCommunityMyStars,
    handleCommunityCommentAdd, handleCommunityCommentsList,
    handleCommunityInstall, handleCommunityPlugins, handleCommunityReport
} from '../../cf-worker/asayake-hub.js';

// ---- KV モック (hub-marketplace.test.js と同形) ----
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
function communityKV(extra = {}) {
    return makeKV({
        'key:hk_aaaaaa': { uid: 'uadmin', siteId: 'sa' }, 'uid:uadmin': { email: 'admin@example.com', siteId: 'sa' }, 'usage:uadmin': '0',
        'key:hk_bbbbbb': { uid: 'uuser', siteId: 'su' }, 'uid:uuser': { email: 'user@example.com', siteId: 'su' }, 'usage:uuser': '0', 'plan:uuser': { plan: 'free' },
        'key:hk_cccccc': { uid: 'uplus', siteId: 'sp' }, 'uid:uplus': { email: 'plus@example.com', siteId: 'sp' }, 'usage:uplus': '0', 'plan:uplus': { plan: 'plus' },
        ...extra
    });
}

// ---- D1 インメモリ fake (本ハンドラが発行する文だけを解釈する) ----
function makeD1() {
    const t = { sites: [], stats: [], stars: [], comments: [], reports: [] };
    function exec(sql, p) {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.startsWith('INSERT INTO stats')) {
            const metric = s.match(/DO UPDATE SET (\w+) =/)[1];
            let row = t.stats.find(r => r.target_type === p[0] && r.target_id === p[1]);
            if (!row) t.stats.push({ target_type: p[0], target_id: p[1], star_count: p[2], install_count: p[3], view_count: p[4], comment_count: p[5] });
            else row[metric] += p[6];
            return { success: true };
        }
        if (s.startsWith('SELECT target_id, star_count') && s.includes('FROM stats'))
            return { results: t.stats.filter(r => r.target_type === p[0]).map(r => ({ ...r })) };
        if (s.startsWith('SELECT star_count FROM stats')) {
            const row = t.stats.find(r => r.target_type === p[0] && r.target_id === p[1]);
            return row ? { star_count: row.star_count } : null;
        }
        if (s.startsWith('SELECT id, url, title') && s.includes('FROM sites'))
            return { results: t.sites.filter(r => r.hidden === 0).map(r => ({ ...r })) };
        if (s.startsWith('SELECT id FROM sites WHERE uid')) {
            const row = t.sites.find(r => r.uid === p[0] && r.url === p[1]); return row ? { id: row.id } : null;
        }
        if (s.startsWith('SELECT uid FROM sites WHERE id')) {
            const row = t.sites.find(r => r.id === p[0]); return row ? { uid: row.uid } : null;
        }
        if (s.startsWith('UPDATE sites SET title')) {
            const row = t.sites.find(r => r.id === p[5]);
            if (row) Object.assign(row, { title: p[0], description: p[1], cover_url: p[2], tags: p[3], updated_at: p[4] });
            return { success: true };
        }
        if (s.startsWith('INSERT INTO sites')) {
            t.sites.push({ id: p[0], uid: p[1], url: p[2], title: p[3], description: p[4], cover_url: p[5], tags: p[6], created_at: p[7], updated_at: p[7], hidden: 0 });
            return { success: true };
        }
        if (s.startsWith('DELETE FROM sites WHERE id')) {
            const i = t.sites.findIndex(r => r.id === p[0]); if (i >= 0) t.sites.splice(i, 1); return { success: true };
        }
        if (s.startsWith('SELECT 1 AS x FROM stars')) {
            const row = t.stars.find(r => r.target_type === p[0] && r.target_id === p[1] && r.uid === p[2]); return row ? { x: 1 } : null;
        }
        if (s.startsWith('DELETE FROM stars')) {
            const i = t.stars.findIndex(r => r.target_type === p[0] && r.target_id === p[1] && r.uid === p[2]); if (i >= 0) t.stars.splice(i, 1); return { success: true };
        }
        if (s.startsWith('INSERT INTO stars')) {
            t.stars.push({ target_type: p[0], target_id: p[1], uid: p[2], created_at: p[3] }); return { success: true };
        }
        if (s.startsWith('SELECT target_type, target_id FROM stars WHERE uid'))
            return { results: t.stars.filter(r => r.uid === p[0]).map(r => ({ target_type: r.target_type, target_id: r.target_id })) };
        if (s.startsWith('SELECT id, author_name, body') && s.includes('FROM comments'))
            return {
                results: t.comments.filter(r => r.target_type === p[0] && r.target_id === p[1] && r.hidden === 0)
                    .sort((a, b) => b.created_at - a.created_at)
                    .map(r => ({ id: r.id, author_name: r.author_name, body: r.body, created_at: r.created_at }))
            };
        if (s.startsWith('INSERT INTO comments')) {
            t.comments.push({ id: p[0], target_type: p[1], target_id: p[2], uid: p[3], author_name: p[4], body: p[5], created_at: p[6], hidden: 0, report_count: 0 });
            return { success: true };
        }
        if (s.startsWith('UPDATE comments SET report_count')) {
            const row = t.comments.find(r => r.id === p[0]); if (row) row.report_count += 1; return { success: true };
        }
        if (s.startsWith('INSERT INTO reports')) {
            t.reports.push({ id: p[0], target_type: p[1], target_id: p[2], comment_id: p[3], uid: p[4], reason: p[5], created_at: p[6] });
            return { success: true };
        }
        throw new Error('unhandled SQL in D1 fake: ' + s);
    }
    function prepare(sql) {
        let params = [];
        const stmt = { bind(...a) { params = a; return stmt; }, run: async () => exec(sql, params), all: async () => exec(sql, params), first: async () => exec(sql, params) };
        return stmt;
    }
    return { _t: t, prepare };
}

function makeBucket() {
    const store = new Map();
    return {
        store,
        async head(key) { const v = store.get(key); return v != null ? { size: new TextEncoder().encode(v).length } : null; },
        async put(key, body) { store.set(key, body); return { httpEtag: '"x"' }; },
        async get(key) { const v = store.get(key); return v != null ? { body: v } : null; },
        async delete(key) { store.delete(key); }
    };
}

function makeEnv(over = {}) {
    return { KV: communityKV(), DB: makeD1(), BUCKET: makeBucket(), ADMIN_EMAILS: 'admin@example.com', QUOTA_BYTES: '104857600', ...over };
}
function req(path, method, body, key) {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;
    return new Request('https://hub' + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined });
}
const withUrl = (r) => new URL(r.url);

describe('rawGitHubBase (SHAピン raw URL 構築)', () => {
    it('owner/repo + sha + path から raw ベースを作る', () => {
        expect(rawGitHubBase('https://github.com/hahero-asayake/bookshelf', 'abc123', 'plugins-sample/series-grouping'))
            .toBe('https://raw.githubusercontent.com/hahero-asayake/bookshelf/abc123/plugins-sample/series-grouping/');
    });
    it('.git 接尾と前後スラッシュを正規化、sha 省略は main', () => {
        expect(rawGitHubBase('https://github.com/o/r.git', '', '/sub/'))
            .toBe('https://raw.githubusercontent.com/o/r/main/sub/');
    });
    it('github 以外は null', () => {
        expect(rawGitHubBase('https://gitlab.com/o/r', 'x', '')).toBe(null);
    });
});

describe('公開本棚 掲載 (sites)', () => {
    it('掲載 → 一覧に出る、同一 URL の再掲載は更新 (重複しない)', async () => {
        const e = makeEnv();
        const r1 = await handleCommunitySiteUpsert(req('/community/sites', 'POST', { url: 'https://asayake.org/public/x/', title: '私の本棚', tags: ['SF', '技術書'] }, 'hk_bbbbbb'), e);
        const { id } = await r1.json();
        expect(id).toBeTruthy();
        await handleCommunitySiteUpsert(req('/community/sites', 'POST', { url: 'https://asayake.org/public/x/', title: '改題した本棚', tags: ['SF', '技術書'] }, 'hk_bbbbbb'), e);
        const listReq = req('/community/sites', 'GET', null, null);
        const list = await (await handleCommunitySitesList(listReq, e, withUrl(listReq))).json();
        expect(list.sites).toHaveLength(1);
        expect(list.sites[0].title).toBe('改題した本棚');
        expect(list.sites[0].tags).toEqual(['SF', '技術書']);
        expect(list.sites[0].stars).toBe(0);
    });
    it('title 無しは 400 / https でない URL は 400', async () => {
        const e = makeEnv();
        await expect(handleCommunitySiteUpsert(req('/community/sites', 'POST', { url: 'https://a.test/', title: '' }, 'hk_bbbbbb'), e)).rejects.toThrow('title');
        await expect(handleCommunitySiteUpsert(req('/community/sites', 'POST', { url: 'http://a.test/', title: 'x' }, 'hk_bbbbbb'), e)).rejects.toThrow('https');
    });
    it('掲載は本人 or 管理者のみ削除でき、他人は 403', async () => {
        const e = makeEnv();
        const { id } = await (await handleCommunitySiteUpsert(req('/community/sites', 'POST', { url: 'https://a.test/', title: 'x' }, 'hk_bbbbbb'), e)).json();
        await expect(handleCommunitySiteDelete(req('/community/sites/' + id, 'DELETE', null, 'hk_cccccc'), e, '/community/sites/' + id)).rejects.toThrow('not owner');
        const del = await handleCommunitySiteDelete(req('/community/sites/' + id, 'DELETE', null, 'hk_bbbbbb'), e, '/community/sites/' + id);
        expect(del.status).toBe(204);
        const listReq = req('/community/sites', 'GET', null, null);
        expect((await (await handleCommunitySitesList(listReq, e, withUrl(listReq))).json()).sites).toHaveLength(0);
    });
    it('未ログインは 401', async () => {
        await expect(handleCommunitySiteUpsert(req('/community/sites', 'POST', { url: 'https://a.test/', title: 'x' }, null), makeEnv())).rejects.toThrow(/key/i);
    });
});

describe('スター (ログイン無料・toggle)', () => {
    it('付与→解除で count が 1→0、本人の済み一覧に反映', async () => {
        const e = makeEnv();
        const on = await (await handleCommunityStar(req('/community/stars', 'POST', { targetType: 'plugin', targetId: 'p1' }, 'hk_bbbbbb'), e)).json();
        expect(on).toMatchObject({ starred: true, starCount: 1 });
        const mine = await (await handleCommunityMyStars(req('/community/me/stars', 'GET', null, 'hk_bbbbbb'), e)).json();
        expect(mine.stars).toEqual([{ target_type: 'plugin', target_id: 'p1' }]);
        const off = await (await handleCommunityStar(req('/community/stars', 'POST', { targetType: 'plugin', targetId: 'p1' }, 'hk_bbbbbb'), e)).json();
        expect(off).toMatchObject({ starred: false, starCount: 0 });
    });
    it('不正な target は 400', async () => {
        await expect(handleCommunityStar(req('/community/stars', 'POST', { targetType: 'book', targetId: 'x' }, 'hk_bbbbbb'), makeEnv())).rejects.toThrow('bad target');
    });
});

describe('コメント (投稿=有料のみ・閲覧=無料)', () => {
    it('無料会員は投稿 403、有料会員は投稿でき、閲覧は uid を晒さない', async () => {
        const e = makeEnv();
        await expect(handleCommunityCommentAdd(req('/community/comments', 'POST', { targetType: 'site', targetId: 's1', body: 'いい本棚' }, 'hk_bbbbbb'), e)).rejects.toThrow(/Plus/);
        const add = await (await handleCommunityCommentAdd(req('/community/comments', 'POST', { targetType: 'site', targetId: 's1', body: 'いい本棚', authorName: 'plusさん' }, 'hk_cccccc'), e)).json();
        expect(add.ok).toBe(true);
        const lReq = req('/community/comments?targetType=site&targetId=s1', 'GET', null, null);
        const list = await (await handleCommunityCommentsList(lReq, e, withUrl(lReq))).json();
        expect(list.comments).toHaveLength(1);
        expect(list.comments[0].body).toBe('いい本棚');
        expect(list.comments[0].author_name).toBe('plusさん');
        expect(list.comments[0]).not.toHaveProperty('uid');
    });
    it('空コメントは 400', async () => {
        await expect(handleCommunityCommentAdd(req('/community/comments', 'POST', { targetType: 'site', targetId: 's1', body: '  ' }, 'hk_cccccc'), makeEnv())).rejects.toThrow('empty');
    });
});

describe('直接インストール (hub同期ユーザ → hub ストレージ書込)', () => {
    beforeEach(() => {
        globalThis.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.endsWith('/manifest.json')) return new Response(JSON.stringify({ id: 'series-grouping', name: 'シリーズ', files: ['style.css'] }), { status: 200 });
            if (u.endsWith('/index.js')) return new Response('export default {};', { status: 200 });
            if (u.endsWith('/style.css')) return new Response('.x{}', { status: 200 });
            return new Response('nope', { status: 404 });
        });
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('SHAピン raw から取得し data/<uid>/plugins/<id>/ に書込・install_count を加算', async () => {
        const e = makeEnv({ KV: communityKV({ 'plugin:series-grouping': { id: 'series-grouping', repoUrl: 'https://github.com/hahero-asayake/bookshelf', sha: 'abc123', path: 'plugins-sample/series-grouping' } }) });
        const res = await (await handleCommunityInstall(req('/community/install', 'POST', { pluginId: 'series-grouping' }, 'hk_bbbbbb'), e)).json();
        expect(res.ok).toBe(true);
        expect(res.files).toEqual(['manifest.json', 'index.js', 'style.css']);
        // raw URL が SHA ピン
        expect(globalThis.fetch.mock.calls[0][0]).toBe('https://raw.githubusercontent.com/hahero-asayake/bookshelf/abc123/plugins-sample/series-grouping/manifest.json');
        // R2 に書かれた
        expect(e.BUCKET.store.get('data/uuser/plugins/series-grouping/index.js')).toBe('export default {};');
        expect(e.BUCKET.store.get('data/uuser/plugins/series-grouping/style.css')).toBe('.x{}');
        // install_count 加算
        expect(e.DB._t.stats.find(r => r.target_type === 'plugin' && r.target_id === 'series-grouping').install_count).toBe(1);
    });
    it('未登録プラグインは 404 / 不正 id は 400', async () => {
        await expect(handleCommunityInstall(req('/community/install', 'POST', { pluginId: 'nope' }, 'hk_bbbbbb'), makeEnv())).rejects.toThrow('not found');
        await expect(handleCommunityInstall(req('/community/install', 'POST', { pluginId: 'Bad Id!' }, 'hk_bbbbbb'), makeEnv())).rejects.toThrow('invalid');
    });
});

describe('GET /community/plugins (KV レジストリ + D1 集計の合成)', () => {
    it('スター/インストール数を合成して返す', async () => {
        const e = makeEnv({ KV: communityKV({ 'plugin:a': { id: 'a', name: 'Alpha' } }) });
        await handleCommunityStar(req('/community/stars', 'POST', { targetType: 'plugin', targetId: 'a' }, 'hk_bbbbbb'), e);
        const data = await (await handleCommunityPlugins(req('/community/plugins', 'GET', null, null), e)).json();
        const a = data.plugins.find(p => p.id === 'a');
        expect(a.stars).toBe(1);
        expect(a.installs).toBe(0);
    });
});

describe('通報 (Phase C モデレーションキュー)', () => {
    it('通報を記録し、comment 指定時は report_count を増やす', async () => {
        const e = makeEnv();
        await handleCommunityCommentAdd(req('/community/comments', 'POST', { targetType: 'site', targetId: 's1', body: 'x' }, 'hk_cccccc'), e);
        const cid = e.DB._t.comments[0].id;
        const res = await (await handleCommunityReport(req('/community/report', 'POST', { targetType: 'site', targetId: 's1', commentId: cid, reason: 'spam' }, 'hk_bbbbbb'), e)).json();
        expect(res.ok).toBe(true);
        expect(e.DB._t.reports).toHaveLength(1);
        expect(e.DB._t.comments[0].report_count).toBe(1);
    });
});
