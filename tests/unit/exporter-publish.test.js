// BookshelfExporter (公開v2 記事駆動) の push オーケストレーション テスト (ADR-058 §11)
//  - 公開記事 → generator.build → GitHubAdapter で push + 削除同期 + Pages URL
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

const hubCaptured = { files: null, deleteMissing: null, affiliateTag: null };
globalThis.HubStorageAdapter = class {
    constructor(opts) { this.opts = opts; }
    async publishSite(files, deleteMissing, affiliateTag) {
        hubCaptured.files = files; hubCaptured.deleteMissing = deleteMissing; hubCaptured.affiliateTag = affiliateTag;
        return { ok: true, siteId: 'sid', siteUrl: 'https://hub.example/public/sid/', published: files.length };
    }
};
globalThis.HubAuth = { refreshUsage: async () => {} };

await import('../../js/exporter.js');
const BookshelfExporter = window.BookshelfExporter;

function makeApp({ articles = [], build } = {}) {
    const updated = [];
    return {
        _isSyncReady: () => true,
        syncMethod: 'local',
        _updates: updated,
        publishArticleStore: {
            load: async () => articles,
            update: async (id, patch) => { updated.push({ id, patch }); }
        },
        publishArticleGenerator: {
            build: build || (async () => ({
                files: [
                    { path: 'index.html', content: '<!doctype html>top' },
                    { path: 'manga/index.html', content: '<!doctype html>manga' }
                ],
                articles: [{ id: 'p1', slug: 'manga', title: '漫画', url: 'manga/', books: 2 }],
                leak: [],
                errors: []
            }))
        }
    };
}

beforeEach(() => {
    captured.entries = []; captured.deletes = []; captured.commits = [];
    hubCaptured.files = null; hubCaptured.deleteMissing = null; hubCaptured.affiliateTag = null;
    listThrow = false;
    mockConfig = { github: { token: 'ghu_x', login: 'hahero-asayake' }, publish: { target: 'github', owner: 'hahero-asayake', repo: 'bookshelf-public', branch: 'main' } };
    // target 明示が必要 (未設定の既定は 2026-07-28 に github → hub へ変更。この一連のテストは GitHub 公開経路の検証)
    listing = {
        '': { files: ['index.html', 'README.md'], dirs: ['stale'] },
        'stale': { files: ['index.html'], dirs: [] }
    };
});

describe('happy path', () => {
    it('生成ファイルを push し、README以外の不要ファイルを削除、Pages URL を返す', async () => {
        const app = makeApp({ articles: [{ id: 'p1', published: true }] });
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
        const exporter = new BookshelfExporter(makeApp({ articles: [{ id: 'p1', published: true }] }));
        const r = await exporter.export({ dryRun: true });
        expect(r.dryRun).toBe(true);
        expect(captured.commits.length).toBe(0);
        expect(r.writeEntries.sort()).toEqual(['index.html', 'manga/index.html']);
        expect(r.deleteEntries).toEqual(['stale/index.html']);
    });
});

describe('記事単位公開 (published フィルタ, ADR-058 §11)', () => {
    it('published=true の記事だけが build に渡る', async () => {
        let received = null;
        const app = makeApp({
            articles: [{ id: 'p1', published: true }, { id: 'p2', published: false }, { id: 'p3', published: true }],
            build: async (articles) => { received = articles; return { files: [{ path: 'index.html', content: 't' }], articles: articles.map(a => ({ id: a.id, slug: a.id })), leak: [], errors: [] }; }
        });
        const r = await new BookshelfExporter(app).export();
        expect(received.map(a => a.id)).toEqual(['p1', 'p3']);
        expect(r.published).toBe(2);
    });

    it('公開中記事が 0 でも throw せず index のみ push (サイトをクリア)', async () => {
        const app = makeApp({
            articles: [{ id: 'p1', published: false }],
            build: async () => ({ files: [{ path: 'index.html', content: 'top' }], articles: [], leak: [], errors: [] })
        });
        const r = await new BookshelfExporter(app).export();
        expect(captured.commits.length).toBe(1);
        expect(captured.entries.map(e => e.path)).toEqual(['index.html']);
        // 公開中記事が無いので manga 等は削除同期で消える
        expect(captured.deletes).toContain('stale/index.html');
        expect(r.published).toBe(0);
    });
});

describe('共有ハブ公開 (target=hub, ADR-033)', () => {
    it('target=hub なら /publish 経路で公開し GitHub には触らない', async () => {
        mockConfig.publish = { target: 'hub' };
        mockConfig.hub = { key: 'hk_x', apiBase: 'https://hub.example', publicBase: 'https://hub.example/public/sid/' };
        const app = makeApp({ articles: [{ id: 'p1', published: true }] });
        const r = await new BookshelfExporter(app).export();
        expect(hubCaptured.files.map(f => f.path).sort()).toEqual(['index.html', 'manga/index.html']);
        expect(hubCaptured.deleteMissing).toBe(true);
        expect(captured.commits.length).toBe(0); // GitHub には push しない
        expect(r.siteUrl).toBe('https://hub.example/public/sid/');
        expect(r.published).toBe(1);
        expect(app._updates.some(u => u.patch.lastBuiltAt)).toBe(true);
    });

    it('build が返した ownTag を publishSite に転送する (/go の Plus 解決用, ADR-034追補)', async () => {
        mockConfig.publish = { target: 'hub' };
        mockConfig.hub = { key: 'hk_x', apiBase: 'https://hub.example', publicBase: 'https://hub.example/public/sid/', siteId: 'sid' };
        const app = makeApp({
            articles: [{ id: 'p1', published: true }],
            build: async (articles, opts) => ({
                files: [{ path: 'index.html', content: 't' }], articles: [{ id: 'p1', slug: 'x' }],
                leak: [], errors: [], ownTag: 'mytag-22', _opts: opts
            })
        });
        await new BookshelfExporter(app).export();
        expect(hubCaptured.affiliateTag).toBe('mytag-22');
    });

    it('ハブ未ログインなら中止', async () => {
        mockConfig.publish = { target: 'hub' };
        mockConfig.hub = { key: '', apiBase: '' };
        const exporter = new BookshelfExporter(makeApp({ articles: [{ id: 'p1', published: true }] }));
        await expect(exporter.export()).rejects.toThrow(/ハブにログイン/);
    });

    it('dryRun(hub) は publishSite を呼ばず write 一覧を返す', async () => {
        mockConfig.publish = { target: 'hub' };
        mockConfig.hub = { key: 'hk_x', apiBase: 'https://hub.example', publicBase: 'https://hub.example/public/sid/' };
        const r = await new BookshelfExporter(makeApp({ articles: [{ id: 'p1', published: true }] })).export({ dryRun: true });
        expect(r.dryRun).toBe(true);
        expect(r.target).toBe('hub');
        expect(hubCaptured.files).toBeNull();
        expect(r.writeEntries.sort()).toEqual(['index.html', 'manga/index.html']);
    });
});

describe('削除同期の安全性 (ADR-033 監査)', () => {
    it('公開 repo の列挙が失敗したら、黙って続行せず公開を中止する', async () => {
        listThrow = true; // 403 等で _listAllFiles が throw
        const exporter = new BookshelfExporter(makeApp({ articles: [{ id: 'p1', published: true }] }));
        await expect(exporter.export()).rejects.toThrow(/取得できませんでした|中止/);
        // 列挙失敗時は push もしない (取りこぼし確定の状態で公開を成功させない)
        expect(captured.commits.length).toBe(0);
    });
});

describe('ガード', () => {
    it('公開先 repo 未設定なら中止', async () => {
        mockConfig.publish = { target: 'github', owner: '', repo: '', branch: 'main' };
        const exporter = new BookshelfExporter(makeApp({ articles: [{ id: 'p1', published: true }] }));
        await expect(exporter.export()).rejects.toThrow(/公開先リポジトリ/);
    });

    it('generator が leak を返したら push せず中止', async () => {
        const app = makeApp({
            articles: [{ id: 'p1', published: true }],
            build: async () => ({ files: [{ path: 'index.html', content: 'x' }], articles: [{ id: 'p1', slug: 'x' }], leak: ['MyVault (index.html)'], errors: [] })
        });
        const exporter = new BookshelfExporter(app);
        await expect(exporter.export()).rejects.toThrow(/個人情報/);
        expect(captured.commits.length).toBe(0);
    });
});

describe('Pages URL の特例', () => {
    it('repo が <owner>.github.io ならルート', async () => {
        mockConfig.publish = { target: 'github', owner: 'hahero-asayake', repo: 'hahero-asayake.github.io', branch: 'main' };
        const exporter = new BookshelfExporter(makeApp({ articles: [{ id: 'p1', published: true }] }));
        const r = await exporter.export();
        expect(r.siteUrl).toBe('https://hahero-asayake.github.io/');
    });
});

describe('プラグイン公開スナップショット収集 (_collectPluginPublishData, ADR-042)', () => {
    it('publishable プラグインの publish.json から footerNote だけ集める (壊れ/空/無は除外・コード非実行)', async () => {
        const app = makeApp({ articles: [] });
        app._collectPublishablePluginIds = async () => new Set(['pc', 'broken', 'empty', 'nofile']);
        const store = {
            pc: JSON.stringify({ footerNote: '  ひとこと  ' }),
            broken: '{ not json',
            empty: JSON.stringify({ footerNote: '   ' }),
            nofile: null
        };
        app.pluginAPI = { readPluginFile: async (id) => store[id] };
        const out = await new BookshelfExporter(app)._collectPluginPublishData();
        expect(out).toEqual([{ id: 'pc', footerNote: 'ひとこと' }]);
    });

    it('収集した publishData が generator.build に渡る (配線)', async () => {
        let opts = null;
        const app = makeApp({
            articles: [{ id: 'p1', published: true }],
            build: async (articles, o) => { opts = o; return { files: [{ path: 'index.html', content: 't' }], articles: articles.map(a => ({ id: a.id, slug: a.id })), leak: [], errors: [] }; }
        });
        app._collectPublishablePluginIds = async () => new Set(['pc']);
        app.pluginAPI = { readPluginFile: async () => JSON.stringify({ footerNote: 'hi' }) };
        await new BookshelfExporter(app).export();
        expect(opts.publishData).toEqual([{ id: 'pc', footerNote: 'hi' }]);
    });

    it('収集器の前提が無い旧 app でも空配列で安全 (後方互換)', async () => {
        const out = await new BookshelfExporter(makeApp({ articles: [] }))._collectPluginPublishData();
        expect(out).toEqual([]);
    });
});
