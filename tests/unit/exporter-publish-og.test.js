// BookshelfExporter × og.png (S5・ADR-098): 入力ハッシュで書込を省いても og.png が削除対象に入らないこと (回帰防止)。
//  - GitHub 経路: ogUnchanged かつ公開先に既にある og.png は blob 書込を省く。ただし出力集合 (writePaths) には残るので
//    削除同期の対象にならない。公開先に無ければ (ogUnchanged でも) 書く。
//  - ハブ経路: deleteMissing=true でサーバが集合を丸ごと置換するため、ogUnchanged でも og.png は必ず送る。
//  - 公開後に記事の ogHash を保存する。exporter は公開時だけ ogImage:true で build を呼ぶ。
import { describe, it, expect, beforeEach } from 'vitest';

let mockConfig;
let listing;
const captured = { entries: [], deletes: [], commits: [] };

globalThis.SyncConfigManager = { load: () => mockConfig };
globalThis.GitHubAdapter = class {
    constructor(opts) { this.opts = opts; }
    async listFiles(dir) { return (listing[dir] || { files: [] }).files; }
    async listDirs(dir) { return (listing[dir] || { dirs: [] }).dirs || []; }
    beginBatch() {}
    addBatchEntry(path, content, encoding) { captured.entries.push({ path, content, encoding }); }
    addBatchDelete(path) { captured.deletes.push(path); }
    async commitBatch(msg) { captured.commits.push(msg); }
};
const hubCaptured = { files: null };
globalThis.HubStorageAdapter = class {
    constructor(opts) { this.opts = opts; }
    async publishSite(files) { hubCaptured.files = files; return { ok: true, siteUrl: 'https://hub.example/x/', published: files.length }; }
};
globalThis.HubAuth = { refreshUsage: async () => {} };

await import('../../js/exporter.js');
const BookshelfExporter = window.BookshelfExporter;

function makeApp({ ogUnchanged }) {
    const updates = [];
    let buildOpts = null;
    return {
        updates, get buildOpts() { return buildOpts; },
        _isSyncReady: () => true, syncMethod: 'local',
        publishArticleStore: { load: async () => [{ id: 'p1', published: true, publicId: 'pid1' }], update: async (id, patch) => { updates.push({ id, patch }); }, ensurePublicId: async () => 'pid1' },
        publishArticleGenerator: {
            build: async (articles, opts) => {
                buildOpts = opts;
                return {
                    files: [
                        { path: 'index.html', content: 'top' },
                        { path: 'pid1/index.html', content: 'a' },
                        { path: 'pid1/og.png', content: 'iVBORw0KGgo=', encoding: 'base64', ogHash: 'h1', ogUnchanged }
                    ],
                    articles: [{ id: 'p1', slug: 's', publicId: 'pid1', ogHash: 'h1', title: 't', url: 'pid1/', books: 1 }],
                    leak: [], errors: [], ogSkipped: []
                };
            }
        }
    };
}

beforeEach(() => {
    captured.entries = []; captured.deletes = []; captured.commits = [];
    hubCaptured.files = null;
    mockConfig = { github: { token: 'ghu_x', login: 'o' }, publish: { target: 'github', owner: 'o', repo: 'r', branch: 'main' } };
    listing = { '': { files: ['index.html', 'README.md'], dirs: ['pid1'] }, 'pid1': { files: ['index.html', 'og.png'], dirs: [] } };
});

describe('GitHub 経路', () => {
    it('公開時だけ ogImage:true で build する', async () => {
        const app = makeApp({ ogUnchanged: false });
        await new BookshelfExporter(app).export();
        expect(app.buildOpts.ogImage).toBe(true);
    });

    it('og.png が入力不変 (ogUnchanged) で公開先に既にある: blob 書込を省き、削除対象にも入れない', async () => {
        await new BookshelfExporter(makeApp({ ogUnchanged: true })).export();
        expect(captured.entries.map(e => e.path).sort()).toEqual(['index.html', 'pid1/index.html']);   // og.png は書かない
        expect(captured.deletes).not.toContain('pid1/og.png');                                          // 消えない
        expect(captured.deletes).toEqual([]);
    });

    it('入力が変わった (ogUnchanged=false) なら base64 のまま書く (encoding を adapter へ渡す)', async () => {
        await new BookshelfExporter(makeApp({ ogUnchanged: false })).export();
        const og = captured.entries.find(e => e.path === 'pid1/og.png');
        expect(og).toEqual({ path: 'pid1/og.png', content: 'iVBORw0KGgo=', encoding: 'base64' });
        expect(captured.deletes).not.toContain('pid1/og.png');
    });

    it('ogUnchanged でも公開先に og.png が無ければ書く (公開先が空になっていても画像が欠けない)', async () => {
        listing['pid1'] = { files: ['index.html'], dirs: [] };
        await new BookshelfExporter(makeApp({ ogUnchanged: true })).export();
        expect(captured.entries.some(e => e.path === 'pid1/og.png')).toBe(true);
    });

    it('公開後に記事の ogHash を保存する', async () => {
        const app = makeApp({ ogUnchanged: false });
        await new BookshelfExporter(app).export();
        expect(app.updates[0].patch.ogHash).toBe('h1');
        expect(typeof app.updates[0].patch.lastBuiltAt).toBe('number');
    });
});

describe('ハブ経路 (deleteMissing でサーバが集合を置換する)', () => {
    beforeEach(() => {
        mockConfig.publish = { target: 'hub' };
        mockConfig.hub = { key: 'hk_x', apiBase: 'https://hub.example', publicBase: 'https://hub.example/public/sid/', siteId: 'sid' };
    });

    it('ogUnchanged でも og.png は必ず送る (送らないと deleteMissing で消える)', async () => {
        const app = makeApp({ ogUnchanged: true });
        await new BookshelfExporter(app).export();
        const og = hubCaptured.files.find(f => f.path === 'pid1/og.png');
        expect(og).toBeTruthy();
        expect(og.encoding).toBe('base64');
        expect(app.buildOpts.ogImage).toBe(true);
        expect(app.updates[0].patch.ogHash).toBe('h1');
    });
});
