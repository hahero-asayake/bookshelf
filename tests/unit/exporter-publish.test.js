// BookshelfExporter の「公開はオプトイン」不変条件テスト (T09 / 朝レビュー修正)
//
// 重要なプライバシー不変条件:
//   - all (全蔵書) は isSpecial でも無条件には公開されない
//   - 公開されるのは isPublic を立てたユーザ本棚の本の和集合だけ
//   - 公開先リポジトリ未設定なら公開しない (勝手に bookshelf-public を作らない)
import { describe, it, expect, beforeEach } from 'vitest';

// exporter.js が参照するグローバルをスタブ
let mockConfig;
globalThis.SyncConfigManager = {
    load: () => mockConfig
};
globalThis.GitHubAdapter = class {
    constructor(opts) { this.opts = opts; }
    async listFiles() { return []; }
    async listDirs() { return []; }
    beginBatch() {}
    addBatchEntry() {}
    addBatchDelete() {}
    async commitBatch() {}
};

await import('../../js/exporter.js');
const BookshelfExporter = window.BookshelfExporter;

// 漫画(公開) / 小説(非公開) / all(全蔵書) を持つ蔵書状態
function makeState() {
    return {
        library: { books: [
            { asin: 'M1', title: '漫画1' },
            { asin: 'M2', title: '漫画2' },
            { asin: 'N1', title: '小説1' }
        ]},
        bookshelvesMeta: { bookshelves: [
            { internalId: 'allid', slug: 'all', name: 'すべての本', iconName: 'library', isSpecial: true, isPublic: false },
            { internalId: 'mid', slug: 'manga', name: '漫画', isPublic: true },
            { internalId: 'nid', slug: 'novel', name: '小説', isPublic: false }
        ]},
        bookshelfFiles: {
            mid: { internalId: 'mid', slug: 'manga', books: ['M1', 'M2'], notes: { M2: { memo: 'おすすめ' } } },
            nid: { internalId: 'nid', slug: 'novel', books: ['N1'], notes: {} }
        },
        allBookshelf: { internalId: 'allid', slug: 'all', books: ['M1', 'M2', 'N1'] },
        notes: { M1: { memo: 'メモM1', rating: 5 }, N1: { memo: 'メモN1', rating: 3 } },
        privateSettings: { affiliateId: 'secret-affi', displayName: 'hahero' }
    };
}

function makeApp(state) {
    return {
        syncMethod: 'local',
        _isSyncReady: () => true,
        storage: {
            loadAll: async () => state,
            listDirs: async () => [],   // plugins なし
            readJSON: async () => null,
            readText: async () => null,
            readBookMemo: async () => null,
            bookMemoFileName: (asin, title) => `${asin}__${title}.md`
        }
    };
}

let exporter, state;
beforeEach(() => {
    state = makeState();
    mockConfig = {
        github: { token: 'ghu_xxx', login: 'hahero' },
        publish: { owner: 'hahero', repo: 'bookshelf-public', branch: 'main' }
    };
    exporter = new BookshelfExporter(makeApp(state));
});

describe('公開はオプトイン (全蔵書を漏らさない)', () => {
    it('公開されるのは isPublic 本棚の本だけ (all 全蔵書は含めない)', async () => {
        const r = await exporter.export({ dryRun: true });
        expect(r.dryRun).toBe(true);
        // 漫画の 2 冊だけ。小説 N1 は publishAsins に入らない
        expect(r.exported).toBe(2);
        expect(r.publicBookshelves).toEqual(['漫画']);
    });

    it('write エントリに公開本棚のファイルだけが出て、非公開本棚は出ない', async () => {
        const r = await exporter.export({ dryRun: true });
        expect(r.writeEntries).toContain('bookshelves/manga.json');
        expect(r.writeEntries).toContain('bookshelves/all.json');
        expect(r.writeEntries).not.toContain('bookshelves/novel.json');
    });

    it('個人情報 (affiliateId 等) は公開データに混入しない', async () => {
        const r = await exporter.export({ dryRun: true });
        expect(r.privateLeak).toEqual([]);
    });

    it('合成 all.json には公開本の和集合だけが入る (全蔵書ではない)', async () => {
        // GitHubAdapter.addBatchEntry を捕捉して実 push データを検査
        const written = {};
        globalThis.GitHubAdapter.prototype.addBatchEntry = function (path, content) {
            written[path] = content;
        };
        await exporter.export({ dryRun: false });
        const all = JSON.parse(written['bookshelves/all.json']);
        expect(all.books.sort()).toEqual(['M1', 'M2']); // N1 は無い
        const lib = JSON.parse(written['library.json']);
        expect(lib.books.map(b => b.asin).sort()).toEqual(['M1', 'M2']);
        // 非公開本棚のメモが漏れていない
        expect(JSON.stringify(written)).not.toContain('メモN1');
    });
});

describe('公開のガード', () => {
    it('公開先リポジトリ未設定なら公開しない', async () => {
        mockConfig.publish = { owner: '', repo: '', branch: 'main' };
        await expect(exporter.export({ dryRun: true })).rejects.toThrow(/公開先リポジトリ/);
    });

    it('公開対象の本棚が 1 つも無ければ中止', async () => {
        state.bookshelvesMeta.bookshelves.forEach(m => { if (!m.isSpecial) m.isPublic = false; });
        await expect(exporter.export({ dryRun: true })).rejects.toThrow(/公開対象の本がありません/);
    });
});
