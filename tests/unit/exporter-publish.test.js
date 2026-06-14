// BookshelfExporter (P1 ページ駆動) の push オーケストレーション テスト (ADR-030)
//  - 公開ページ → generator.build → GitHubAdapter で push + 削除同期 + Pages URL
import { describe, it, expect, beforeEach } from 'vitest';

let mockConfig;
let listing; // { '': {files, dirs}, 'stale': {files, dirs} }
let listThrow = false; // true で listFiles を失敗させ、削除同期の列挙失敗を再現
const captured = { entries: [], deletes: [], commits: [] };

globalThis.SyncConfigManager = { load: () => mockConfig };
globalThis.GitHubAdapter = class {
    constructor(opts) { this.opts = opts; }
    async listFiles(dir) { if (listThrow) throw new Error('403 API rate limit exceeded'); return (listing[dir] || { files: [] }).files; }
    async listDirs(dir) { return (listing[dir] || { dirs: [] }).dirs || []; }
    beginBatch() {}
    addBatchEntry(path, content) { captured.entries.push({ path, content }); }
    addBatchDelete(path) { captured.deletes.push(path); }
    async commitBatch(msg) { captured.commits.push(msg); }
};

const hubCaptured = { files: null, deleteMissing: null };
globalThis.HubStorageAdapter = class {
    constructor(opts) { this.opts = opts; }
    async publishSite(files, deleteMissing) {
        hubCaptured.files = files; hubCaptured.deleteMissing = deleteMissing;
        return { ok: true, siteId: 'sid', siteUrl: 'https://hub.example/public/sid/', published: files.length };
    }
};
globalThis.HubAuth = { refreshUsage: async () => {} };

await import('../../js/exporter.js');
const BookshelfExporter = window.BookshelfExporter;

function makeApp({ pages = [], build } = {}) {
    const updated = [];
    return {
        _isSyncReady: () => true,
        syncMethod: 'local',
        _updates: updated,
        publishPageStore: {
            load: async () => pages,
            update: async (id, patch) => { updated.push({ id, patch }); }
        },
        publishGenerator: {
            build: build || (async () => ({
                files: [
                    { path: 'index.html', content: '<!doctype html>top' },
                    { path: 'manga/index.html', content: '<!doctype html>manga' }
                ],
                pages: [{ id: 'p1', slug: 'manga', title: '漫画', url: 'manga/', books: 2 }],
                leak: [],
                errors: []
            }))
        }
    };
}

beforeEach(() => {
    captured.entries = []; captured.deletes = []; captured.commits = [];
    hubCaptured.files = null; hubCaptured.deleteMissing = null;
    listThrow = false;
    mockConfig = { github: { token: 'ghu_x', login: 'hahero-asayake' }, publish: { owner: 'hahero-asayake', repo: 'bookshelf-public', branch: 'main' } };
    listing = {
        '': { files: ['index.html', 'README.md'], dirs: ['stale'] },
        'stale': { files: ['index.html'], dirs: [] }
    };
});

describe('happy path', () => {
    it('生成ファイルを push し、README以外の不要ファイルを削除、Pages URL を返す', async () => {
        const app = makeApp({ pages: [{ id: 'p1', published: true }] });
        const exporter = new BookshelfExporter(app);
        const r = await exporter.export();
        // push されたパス
        expect(captured.entries.map(e => e.path).sort()).toEqual(['index.html', 'manga/index.html']);
        // 削除同期: stale/index.html だけ (README.md は残す、index.html は今回も出力)
        expect(captured.deletes).toEqual(['stale/index.html']);
        expect(captured.commits.length).toBe(1);
        // GitHub Pages URL
        expect(r.siteUrl).toBe('https://hahero-asayake.github.io/bookshelf-public/');
        expect(r.published).toBe(1);
        // lastBuiltAt 更新
        expect(app._updates[0].patch.lastBuiltAt).toBeTruthy();
    });

    it('dryRun は push せず write/delete 一覧を返す', async () => {
        const exporter = new BookshelfExporter(makeApp({ pages: [{ id: 'p1', published: true }] }));
        const r = await exporter.export({ dryRun: true });
        expect(r.dryRun).toBe(true);
        expect(captured.commits.length).toBe(0);
        expect(r.writeEntries.sort()).toEqual(['index.html', 'manga/index.html']);
        expect(r.deleteEntries).toEqual(['stale/index.html']);
    });
});

describe('ページ単位公開 (published フィルタ, ADR-030)', () => {
    it('published=true のページだけが build に渡る', async () => {
        let received = null;
        const app = makeApp({
            pages: [{ id: 'p1', published: true }, { id: 'p2', published: false }, { id: 'p3', published: true }],
            build: async (pages) => { received = pages; return { files: [{ path: 'index.html', content: 't' }], pages: pages.map(p => ({ id: p.id, slug: p.id })), leak: [], errors: [] }; }
        });
        const r = await new BookshelfExporter(app).export();
        expect(received.map(p => p.id)).toEqual(['p1', 'p3']);
        expect(r.published).toBe(2);
    });

    it('公開中ページが 0 でも throw せず index のみ push (サイトをクリア)', async () => {
        const app = makeApp({
            pages: [{ id: 'p1', published: false }],
            build: async () => ({ files: [{ path: 'index.html', content: 'top' }], pages: [], leak: [], errors: [] })
        });
        const r = await new BookshelfExporter(app).export();
        expect(captured.commits.length).toBe(1);
        expect(captured.entries.map(e => e.path)).toEqual(['index.html']);
        // 公開中ページが無いので manga 等は削除同期で消える
        expect(captured.deletes).toContain('stale/index.html');
        expect(r.published).toBe(0);
    });
});

describe('共有ハブ公開 (target=hub, ADR-033)', () => {
    it('target=hub なら /publish 経路で公開し GitHub には触らない', async () => {
        mockConfig.publish = { target: 'hub' };
        mockConfig.hub = { key: 'hk_x', apiBase: 'https://hub.example', publicBase: 'https://hub.example/public/sid/' };
        const app = makeApp({ pages: [{ id: 'p1', published: true }] });
        const r = await new BookshelfExporter(app).export();
        expect(hubCaptured.files.map(f => f.path).sort()).toEqual(['index.html', 'manga/index.html']);
        expect(hubCaptured.deleteMissing).toBe(true);
        expect(captured.commits.length).toBe(0); // GitHub には push しない
        expect(r.siteUrl).toBe('https://hub.example/public/sid/');
        expect(r.published).toBe(1);
        expect(app._updates.some(u => u.patch.lastBuiltAt)).toBe(true);
    });

    it('ハブ未ログインなら中止', async () => {
        mockConfig.publish = { target: 'hub' };
        mockConfig.hub = { key: '', apiBase: '' };
        const exporter = new BookshelfExporter(makeApp({ pages: [{ id: 'p1', published: true }] }));
        await expect(exporter.export()).rejects.toThrow(/ハブにログイン/);
    });

    it('dryRun(hub) は publishSite を呼ばず write 一覧を返す', async () => {
        mockConfig.publish = { target: 'hub' };
        mockConfig.hub = { key: 'hk_x', apiBase: 'https://hub.example', publicBase: 'https://hub.example/public/sid/' };
        const r = await new BookshelfExporter(makeApp({ pages: [{ id: 'p1', published: true }] })).export({ dryRun: true });
        expect(r.dryRun).toBe(true);
        expect(r.target).toBe('hub');
        expect(hubCaptured.files).toBeNull();
        expect(r.writeEntries.sort()).toEqual(['index.html', 'manga/index.html']);
    });
});

describe('削除同期の安全性 (ADR-033 監査)', () => {
    it('公開 repo の列挙が失敗したら、黙って続行せず公開を中止する', async () => {
        listThrow = true; // 403 等で _listAllFiles が throw
        const exporter = new BookshelfExporter(makeApp({ pages: [{ id: 'p1', published: true }] }));
        await expect(exporter.export()).rejects.toThrow(/取得できませんでした|中止/);
        // 列挙失敗時は push もしない (取りこぼし確定の状態で公開を成功させない)
        expect(captured.commits.length).toBe(0);
    });
});

describe('ガード', () => {
    it('公開先 repo 未設定なら中止', async () => {
        mockConfig.publish = { owner: '', repo: '', branch: 'main' };
        const exporter = new BookshelfExporter(makeApp({ pages: [{ id: 'p1', published: true }] }));
        await expect(exporter.export()).rejects.toThrow(/公開先リポジトリ/);
    });

    it('generator が leak を返したら push せず中止', async () => {
        const app = makeApp({
            pages: [{ id: 'p1', published: true }],
            build: async () => ({ files: [{ path: 'index.html', content: 'x' }], pages: [{ id: 'p1', slug: 'x' }], leak: ['MyVault (index.html)'], errors: [] })
        });
        const exporter = new BookshelfExporter(app);
        await expect(exporter.export()).rejects.toThrow(/個人情報/);
        expect(captured.commits.length).toBe(0);
    });
});

describe('Pages URL の特例', () => {
    it('repo が <owner>.github.io ならルート', async () => {
        mockConfig.publish = { owner: 'hahero-asayake', repo: 'hahero-asayake.github.io', branch: 'main' };
        const exporter = new BookshelfExporter(makeApp({ pages: [{ id: 'p1', published: true }] }));
        const r = await exporter.export();
        expect(r.siteUrl).toBe('https://hahero-asayake.github.io/');
    });
});
