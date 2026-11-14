// イシュー#667: 保存先への書き込みは BookshelfStorage の待ち行列 (serialWrite) で1本ずつ流す。
// GitHub は書き込みのたびに ref を楽観ロック (force:false) で進めるため、同じページから2本のまとめ保存が重なると
// 後の方が 422 になり、1台なのに書き込み時の3択が出た (同期と標準機能の補充の重なり・#622 R3)。
// 経路を通す形: BookshelfStorage.syncBatch / writeJSON → GitHubAdapter (js/github-adapter.js) → fetch → 下の模擬の GitHub。
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../js/storage-adapter.js');
await import('../../js/github-adapter.js');
await import('../../js/storage.js');
const { GitHubAdapter, GitHubConflictError } = globalThis;
const BookshelfStorage = window.BookshelfStorage;

// ref・commit・tree・blob と Contents API を持つ模擬の GitHub。どの応答も少し遅らせ、並んだ書き込みが交互に進むようにする
function fakeGitHub() {
    const st = { head: 'c0', commits: new Map([['c0', { tree: 't0', parents: [] }]]), trees: new Map([['t0', new Map()]]), blobs: new Map(), n: 0, log: [], fail: null };
    const treeOfHead = () => st.trees.get(st.commits.get(st.head).tree);
    const commitWith = (changes, message) => {
        const t = new Map(treeOfHead());
        for (const [path, sha] of changes) { if (sha === null) t.delete(path); else t.set(path, sha); }
        const treeSha = 't' + (++st.n); st.trees.set(treeSha, t);
        const sha = 'c' + (++st.n); st.commits.set(sha, { tree: treeSha, parents: [st.head], message });
        st.head = sha;
        return sha;
    };
    globalThis.fetch = async (url, init = {}) => {
        await new Promise((r) => setTimeout(r, 2));
        const method = (init.method || 'GET').toUpperCase();
        const body = init.body ? JSON.parse(init.body) : null;
        const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
        const p = new URL(url).pathname.replace(/^\/repos\/o\/r/, '');
        if (st.fail && st.fail(method, p, body)) { st.log.push(`${method} ${p} 500`); return json({ message: 'boom' }, 500); }
        if (p.startsWith('/git/refs/heads/') && method === 'GET') return json({ object: { sha: st.head } });
        if (p.startsWith('/git/refs/heads/') && method === 'PATCH') {
            const c = st.commits.get(body.sha);
            if (!c || (!body.force && c.parents[0] !== st.head)) { st.log.push('PATCH 422'); return json({ message: 'Update is not a fast forward' }, 422); }
            st.head = body.sha;
            st.log.push(`PATCH 200 ${c.message}`);
            return json({ object: { sha: st.head } });
        }
        if (p.startsWith('/git/commits/') && method === 'GET') { const sha = p.split('/').pop(); return json({ sha, tree: { sha: st.commits.get(sha).tree } }); }
        if (p === '/git/commits' && method === 'POST') { const sha = 'c' + (++st.n); st.commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message }); return json({ sha }, 201); }
        if (p.startsWith('/git/trees/') && method === 'GET') { const t = st.trees.get(p.split('/').pop()) || new Map(); return json({ truncated: false, tree: [...t].map(([path, sha]) => ({ path, type: 'blob', sha })) }); }
        if (p === '/git/trees' && method === 'POST') {
            const t = new Map(st.trees.get(body.base_tree) || []);
            for (const e of body.tree) { if (e.sha === null) t.delete(e.path); else t.set(e.path, e.sha); }
            const sha = 't' + (++st.n); st.trees.set(sha, t); return json({ sha }, 201);
        }
        if (p === '/git/blobs' && method === 'POST') { const sha = 'b' + (++st.n); st.blobs.set(sha, Buffer.from(body.content, 'base64').toString('utf-8')); return json({ sha }, 201); }
        if (p.startsWith('/contents/')) {
            const path = decodeURIComponent(p.slice('/contents/'.length));
            const cur = treeOfHead().get(path) || null;
            if (method === 'GET') {
                if (!cur) return json({ message: 'Not Found' }, 404);
                return json({ type: 'file', path, sha: cur, encoding: 'base64', content: Buffer.from(st.blobs.get(cur)).toString('base64') });
            }
            if (method === 'PUT') {
                if ((cur && body.sha !== cur) || (!cur && body.sha)) return json({ message: 'sha does not match' }, 409);
                const blob = 'b' + (++st.n); st.blobs.set(blob, Buffer.from(body.content, 'base64').toString('utf-8'));
                commitWith([[path, blob]], body.message);
                st.log.push(`PUT ${path}`);
                return json({ content: { path, sha: blob }, commit: { sha: st.head } });
            }
        }
        throw new Error(`unrouted ${method} ${p}`);
    };
    const read = (path) => { const sha = treeOfHead().get(path); return sha ? JSON.parse(st.blobs.get(sha)) : null; };
    return { st, read };
}

const put = (path, data) => ({ op: 'put', path, data, kind: 'json' });
const A = 'private/library.json';
const B = 'plugins/sample/data/state.json';

describe('保存先への書き込みの待ち行列 (イシュー#667・GitHub)', () => {
    let gh; let storage;
    beforeEach(() => {
        gh = fakeGitHub();
        storage = new BookshelfStorage(new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' }));
    });

    it('前提: 行列を通さずに2本のまとめ保存を同時に流すと、後の方が 422 (GitHubConflictError) になる', async () => {
        const results = await Promise.allSettled([
            storage._syncBatchNow([put(A, { books: ['x'] })], { message: 'sync' }),
            storage._syncBatchNow([put(B, { v: 1 })], { message: 'seed' })
        ]);
        expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason)).toEqual([expect.any(GitHubConflictError)]);
        expect(gh.st.log).toContain('PATCH 422');
    });

    it('同時に呼んだ2本の syncBatch は1本ずつ流れ、どちらも 422 にならず、保存先に両方の中身が入る', async () => {
        const [r1, r2] = await Promise.all([
            storage.syncBatch([put(A, { books: ['x'] })], { message: 'sync' }),
            storage.syncBatch([put(B, { v: 1 })], { message: 'seed' })
        ]);
        expect(r1).toEqual(expect.any(String));
        expect(r2).toEqual(expect.any(String));
        expect(gh.st.log).not.toContain('PATCH 422');
        expect(gh.st.log.filter((l) => l.startsWith('PATCH 200'))).toEqual(['PATCH 200 sync', 'PATCH 200 seed']);
        expect(gh.read(A)).toEqual({ books: ['x'] });
        expect(gh.read(B)).toEqual({ v: 1 });
    });

    it('withMerged の時は呼び出しごとに { result, merged } を返す (GitHub は合わせないので merged は null)', async () => {
        const out = await storage.syncBatch([put(A, { books: ['y'] })], { message: 'sync', withMerged: true });
        expect(out).toEqual({ result: expect.any(String), merged: null });
    });

    it('1件ずつの書き込み (writeJSON・Contents API) も同じ行列に並び、まとめ保存の ref を追い越さない', async () => {
        const batch = storage.syncBatch([put(A, { books: ['x'] })], { message: 'sync' });
        const single = storage.writeJSON('private/settings.json', { theme: 'a' });
        await Promise.all([batch, single]);
        expect(gh.st.log).not.toContain('PATCH 422');
        // まとめ保存の PATCH の後に、1件の PUT が来る
        expect(gh.st.log.indexOf('PATCH 200 sync')).toBeLessThan(gh.st.log.indexOf('PUT private/settings.json'));
        expect(gh.read(A)).toEqual({ books: ['x'] });
        expect(gh.read('private/settings.json')).toEqual({ theme: 'a' });
    });

    it('1つの書き込みが失敗しても行列は止まらない (失敗は呼び出し元へ返り、後ろの書き込みは流れる)', async () => {
        gh.st.fail = (method, p) => method === 'POST' && p === '/git/commits' && !gh.st.failedOnce && (gh.st.failedOnce = true);
        const first = storage.syncBatch([put(A, { books: ['x'] })], { message: 'sync' });
        const second = storage.syncBatch([put(B, { v: 2 })], { message: 'seed' });
        const third = storage.writeJSON('private/settings.json', { theme: 'b' });
        await expect(first).rejects.toThrow();
        await expect(second).resolves.toEqual(expect.any(String));
        await expect(third).resolves.toBeUndefined();
        expect(gh.read(A)).toBeNull();
        expect(gh.read(B)).toEqual({ v: 2 });
        expect(gh.read('private/settings.json')).toEqual({ theme: 'b' });
    });

    it('行列の中で同じ行列の書き込みを待たない (syncBatch・writeJSON・initEmpty を重ねても止まらない)', async () => {
        const all = Promise.all([
            storage.initEmpty(),
            storage.syncBatch([put(B, { v: 3 })], { message: 'seed' }),
            storage.writeJSON('private/main.json', { a: 1 }),
            storage.syncBatch([put(A, { books: ['z'] })], { message: 'sync' })
        ]);
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('行列が止まった')), 5000));
        await Promise.race([all, timeout]);
        expect(gh.st.log).not.toContain('PATCH 422');
        expect(gh.read(A)).toEqual({ books: ['z'] });
        expect(gh.read(B)).toEqual({ v: 3 });
        expect(gh.read('private/main.json')).toEqual({ a: 1 });
    });
});
