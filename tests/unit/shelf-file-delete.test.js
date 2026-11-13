// 本棚ファイルの削除待ち (イシュー#587)。
// 本棚の削除・slug 変更で要らなくなった private/bookshelves/<slug>.json を、保存先を問わず次の保存で
// 消すための仕組みを確かめる。BookshelfManager の公開メソッド (remove/rename) → BookshelfStorage の
// 削除待ち → 保存時に取り出す、の順に通す。GitHub のまとめ保存は fetch を模擬して commitBatch を通す。
import { describe, it, expect, beforeEach, vi } from 'vitest';

let idCounter = 0;
globalThis.generateInternalId = () => `gen${++idCounter}`;

await import('../../js/storage-adapter.js');
await import('../../js/github-adapter.js');
await import('../../js/storage.js');
await import('../../js/bookshelf-manager.js');
const { BookshelfManager, BookshelfStorage, GitHubAdapter } = window;

const KEY = 'virtualBookshelf_pendingShelfDeletes';

// 保存先の操作を記録するだけの adapter (manager がその場で消していないことを確かめる)
function makeAdapter() {
    return { deleteFile: vi.fn(async () => {}), isConnected: () => true };
}

function makeApp(storage) {
    return {
        storage,
        userData: {
            bookshelves: [
                { id: 'all', internalId: 'allid', name: 'すべての本', isSpecial: true, books: ['A1', 'A2'], notes: {} },
                { id: 'parent', internalId: 'p1', name: '親', parent: 'allid', books: ['A1'], notes: {} },
                { id: 'child', internalId: 'c1', name: '子', parent: 'p1', books: ['A1'], notes: {} },
                { id: 'other', internalId: 'o1', name: '別系統', parent: 'allid', books: ['A2'], notes: {} }
            ],
            notes: {},
            bookOrder: {},
            _storage: { allInternalId: 'allid' }
        }
    };
}

const slugsOf = (app) => app.userData.bookshelves.map((b) => b.id);

let adapter, storage, app, mgr;
beforeEach(() => {
    localStorage.removeItem(KEY);
    adapter = makeAdapter();
    storage = new BookshelfStorage(adapter);
    app = makeApp(storage);
    mgr = new BookshelfManager(app);
    mgr.rebuildReverseIndex();
});

describe('本棚の削除・名前変更で、消す本棚ファイルが決まる', () => {
    it('本棚1つの削除: その本棚のファイルが削除待ちになり、保存先へはその場で何も送らない', async () => {
        await mgr.remove('o1');
        const { slugs, entries } = storage.takeBookshelfFileDeletes(slugsOf(app));
        expect(slugs).toEqual(['other']);
        expect(entries).toEqual([{ op: 'delete', path: 'private/bookshelves/other.json' }]);
        expect(adapter.deleteFile).not.toHaveBeenCalled();
    });

    it('子を持つ本棚の削除: 親と子の両方のファイルが削除待ちになる', async () => {
        await mgr.remove('p1');
        expect(storage.takeBookshelfFileDeletes(slugsOf(app)).slugs).toEqual(['parent', 'child']);
    });

    it('slug の変更: 古い slug のファイルが削除待ちになり、新しい slug は消さない', async () => {
        await mgr.rename('o1', 'renamed');
        expect(storage.takeBookshelfFileDeletes(slugsOf(app)).slugs).toEqual(['other']);
    });

    it('確認で取り消した削除は削除待ちにしない', async () => {
        await mgr.remove('o1', { confirmCallback: async () => false });
        expect(storage.takeBookshelfFileDeletes(slugsOf(app)).slugs).toEqual([]);
    });
});

describe('削除待ちの持ち方', () => {
    it('同じ slug で作り直した本棚のファイルは消さず、削除待ちからも外す', async () => {
        await mgr.remove('o1');
        mgr.create({ slug: 'other', name: '作り直した本棚' });
        expect(storage.takeBookshelfFileDeletes(slugsOf(app)).slugs).toEqual([]);
        // 外した分は、作り直した本棚が後で一覧から消えても戻らない (改めて削除した時に積み直す)
        expect(storage.takeBookshelfFileDeletes([]).slugs).toEqual([]);
    });

    it('保存が成功するまで残り、再読込 (別のインスタンス) でも引き継がれる', async () => {
        await mgr.remove('o1');
        storage.takeBookshelfFileDeletes(slugsOf(app));
        const afterReload = new BookshelfStorage(makeAdapter());
        expect(afterReload.takeBookshelfFileDeletes(slugsOf(app)).slugs).toEqual(['other']);
    });

    it('成功した分だけ外し、保存中に積まれた分は残す', async () => {
        await mgr.remove('o1');
        const sent = storage.takeBookshelfFileDeletes(slugsOf(app));
        await mgr.remove('p1'); // 保存中に別の本棚を削除
        storage.clearBookshelfFileDeletes(sent.slugs);
        expect(storage.takeBookshelfFileDeletes(slugsOf(app)).slugs).toEqual(['parent', 'child']);
    });

    it('all と空の slug は積まない', () => {
        storage.queueBookshelfFileDelete('all');
        storage.queueBookshelfFileDelete('');
        expect(storage.takeBookshelfFileDeletes([]).slugs).toEqual([]);
    });
});

describe('GitHub のまとめ保存: 保存先に無いファイルの削除で保存全体を失敗させない', () => {
    // ref → commit → (削除がある時だけ) 土台の tree → blob → tree 作成 → commit 作成 → ref 更新
    function mockGitHub({ baseTreePaths }) {
        const calls = [];
        globalThis.fetch = vi.fn(async (url, init = {}) => {
            const method = (init.method || 'GET').toUpperCase();
            const body = init.body ? JSON.parse(init.body) : null;
            calls.push({ url, method, body });
            const ok = (json, status = 200) => new Response(JSON.stringify(json), { status });
            if (url.includes('/git/refs/heads/') && method === 'GET') return ok({ object: { sha: 'c0' } });
            if (url.includes('/git/commits/') && method === 'GET') return ok({ tree: { sha: 't0' } });
            if (url.includes('/git/trees/t0') && method === 'GET') {
                return ok({ sha: 't0', truncated: false, tree: baseTreePaths.map((p) => ({ path: p, type: 'blob', sha: `s-${p}` })) });
            }
            if (url.endsWith('/git/blobs') && method === 'POST') return ok({ sha: 'b1' }, 201);
            if (url.endsWith('/git/trees') && method === 'POST') {
                // 実物と同じく、土台に無いパスの削除はエラーにする
                const missing = body.tree.find((e) => e.sha === null && !baseTreePaths.includes(e.path));
                if (missing) return ok({ message: 'Validation Failed' }, 422);
                return ok({ sha: 't1' }, 201);
            }
            if (url.endsWith('/git/commits') && method === 'POST') return ok({ sha: 'c1' }, 201);
            if (url.includes('/git/refs/heads/') && method === 'PATCH') return ok({ object: { sha: 'c1' } });
            throw new Error(`unexpected ${method} ${url}`);
        });
        return calls;
    }

    it('土台にある削除だけを tree に載せ、無い削除は外して commit する', async () => {
        const calls = mockGitHub({ baseTreePaths: ['private/bookshelves/old.json', 'private/bookshelves.json'] });
        const gh = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' });
        gh.beginBatch();
        gh.addBatchEntry('private/bookshelves.json', '{}');
        gh.addBatchDelete('private/bookshelves/old.json');
        gh.addBatchDelete('private/bookshelves/never-saved.json');
        await expect(gh.commitBatch('sync')).resolves.toBe('c1');
        const treePost = calls.find((c) => c.url.endsWith('/git/trees') && c.method === 'POST');
        expect(treePost.body.tree.map((e) => [e.path, e.sha])).toEqual([
            ['private/bookshelves.json', 'b1'],
            ['private/bookshelves/old.json', null]
        ]);
    });

    it('削除が全部保存先に無く、ほかに書くものも無ければ commit しない', async () => {
        const calls = mockGitHub({ baseTreePaths: [] });
        const gh = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' });
        gh.beginBatch();
        gh.addBatchDelete('private/bookshelves/never-saved.json');
        await expect(gh.commitBatch('sync')).resolves.toBeNull();
        expect(calls.some((c) => c.method === 'POST' || c.method === 'PATCH')).toBe(false);
    });

    it('削除が無いまとめ保存では土台の tree を読まない (通信を増やさない)', async () => {
        const calls = mockGitHub({ baseTreePaths: [] });
        const gh = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' });
        gh.beginBatch();
        gh.addBatchEntry('private/bookshelves.json', '{}');
        await gh.commitBatch('sync');
        expect(calls.some((c) => c.url.includes('/git/trees/t0'))).toBe(false);
    });
});
