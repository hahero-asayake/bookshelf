// PublishGenerator: データ解決 / 公開項目取捨 / プライバシー / スタイル の検証 (P1-4, ADR-030)
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../js/publish-page-store.js');
await import('../../js/publish-styles.js');
await import('../../js/publish-generator.js');
const { PublishGenerator, createPublishStyleRegistry } = globalThis;

function makeState() {
    return {
        library: { books: [
            { asin: 'M1', title: '漫画1', authors: '作者A', productImage: 'http://img/M1.jpg' },
            { asin: 'M2', title: '漫画2', authors: '作者B', productImage: 'http://img/M2.jpg' },
            { asin: 'N1', title: '小説1', authors: '作者C', productImage: 'http://img/N1.jpg' }
        ]},
        bookshelvesMeta: { bookshelves: [
            { internalId: 'allid', slug: 'all', name: 'すべて', isSpecial: true },
            { internalId: 'mid', slug: 'manga', name: '漫画', description: 'お気に入りの漫画' },
            { internalId: 'nid', slug: 'novel', name: '小説' }
        ]},
        allBookshelf: { books: ['M1', 'M2', 'N1'] },
        bookshelfFiles: {
            mid: { books: ['M1', 'M2'], notes: { M2: { memo: '本棚overrideメモ' } } },
            nid: { books: ['N1'], notes: {} }
        },
        notes: {
            M1: { rating: 5, memo: 'ALLメモM1', hasDetailMemo: true },
            M2: { rating: 4 },
            N1: { rating: 3, memo: 'ALLメモN1' }
        },
        privateSettings: { affiliateId: 'aff-xyz', obsidianVaultName: 'MySecretVault', publicDisplayName: 'hahero' }
    };
}

function makeApp(state) {
    return {
        storage: {
            loadAll: async () => state,
            readBookMemo: async (asin) => asin === 'M1' ? '---\nupdated: 2026\n---\n長文メモ本文M1' : null
        }
    };
}

let gen;
beforeEach(() => {
    gen = new PublishGenerator(makeApp(makeState()), createPublishStyleRegistry());
});

const fields = () => globalThis.PublishPageStore.defaultFields();

describe('本棚セクション型', () => {
    it('選んだ本棚の本だけ・override メモ・Amazon tag が出る / 非選択本は出ない', async () => {
        const page = { id: 'a', slug: 'manga-page', title: '漫画ページ', intro: 'よろしく', styleId: 'shelf-sections', styleParams: {}, select: { shelves: ['mid'], books: [], fields: fields() } };
        const r = await gen.build([page]);
        const html = r.files.find(f => f.path === 'manga-page/index.html').content;
        expect(html).toContain('漫画1');
        expect(html).toContain('漫画2');
        expect(html).toContain('本棚overrideメモ');     // M2 は override 優先
        expect(html).toContain('ALLメモM1');            // M1 は ALL memo
        expect(html).toContain('tag=aff-xyz');           // アフィリエイト tag 付き
        expect(html).not.toContain('小説1');             // 非選択本棚は出ない
        expect(r.errors).toEqual([]);
    });

    it('プライバシー: vault 名が出力に混入しない (leak 検出 0)', async () => {
        const page = { id: 'a', slug: 'p', title: 'P', intro: '', styleId: 'shelf-sections', styleParams: {}, select: { shelves: ['mid'], books: [], fields: fields() } };
        const r = await gen.build([page]);
        const all = r.files.map(f => f.content).join('');
        expect(all).not.toContain('MySecretVault');
        expect(r.leak).toEqual([]);
    });

    it('公開項目を OFF にすると出力から消える (amazon/memo)', async () => {
        const f = { ...fields(), amazon: false, memo: false };
        const page = { id: 'a', slug: 'p', title: 'P', intro: '', styleId: 'shelf-sections', styleParams: {}, select: { shelves: ['mid'], books: [], fields: f } };
        const r = await gen.build([page]);
        const html = r.files.find(f => f.path === 'p/index.html').content;
        expect(html).not.toContain('amazon.co.jp');
        expect(html).not.toContain('本棚overrideメモ');
    });
});

describe('本単体じっくり型 + detailMemo', () => {
    it('長文メモを frontmatter 除去して出す', async () => {
        const page = { id: 'b', slug: 'feature', title: '特集', intro: '', styleId: 'book-feature', styleParams: {}, select: { shelves: [], books: ['M1'], fields: fields() } };
        const r = await gen.build([page]);
        const html = r.files.find(f => f.path === 'feature/index.html').content;
        expect(html).toContain('長文メモ本文M1');
        expect(html).not.toContain('updated: 2026'); // frontmatter は除去
        expect(html).toContain('漫画1');
    });
});

describe('トップ index と HTML 妥当性', () => {
    it('index.html に各ページへのリンクが出る / doctype 付き', async () => {
        const pages = [
            { id: 'a', slug: 'manga-page', title: '漫画ページ', intro: '', styleId: 'shelf-sections', styleParams: {}, select: { shelves: ['mid'], books: [], fields: fields() } },
            { id: 'b', slug: 'feature', title: '特集', intro: '', styleId: 'book-feature', styleParams: {}, select: { shelves: [], books: ['M1'], fields: fields() } }
        ];
        const r = await gen.build(pages);
        const idx = r.files.find(f => f.path === 'index.html').content;
        expect(idx.startsWith('<!doctype html>')).toBe(true);
        expect(idx).toContain('href="./manga-page/"');
        expect(idx).toContain('href="./feature/"');
        expect(r.pages.map(p => p.slug).sort()).toEqual(['feature', 'manga-page']);
    });

    it('不明スタイルは errors に積みファイルは作らない', async () => {
        const page = { id: 'x', slug: 'x', title: 'X', intro: '', styleId: 'no-such', styleParams: {}, select: { shelves: ['mid'], books: [], fields: fields() } };
        const r = await gen.build([page]);
        expect(r.errors.length).toBe(1);
        expect(r.files.find(f => f.path === 'x/index.html')).toBeUndefined();
    });
});

describe('プライバシー誤検知ガード (leak)', () => {
    it('extensionImportOrigins にアプリ公開 origin があっても footer の Powered by リンクで誤検知しない', async () => {
        const state = makeState();
        // 取込元 origin にアプリ自身の公開 origin（footer のリンクと部分一致する）が入っているケース
        state.privateSettings.extensionImportOrigins = ['http://localhost:*', 'https://hahero-asayake.github.io'];
        const g = new PublishGenerator(makeApp(state), createPublishStyleRegistry());
        const page = { id: 'a', slug: 'p', title: 'P', intro: '', styleId: 'shelf-sections', styleParams: {}, select: { shelves: ['mid'], books: [], fields: fields() } };
        const r = await g.build([page]);
        // footer に https://hahero-asayake.github.io/bookshelf が必ず入る（正当）
        expect(r.files.some(f => f.content.includes('hahero-asayake.github.io'))).toBe(true);
        // それでも leak は 0（取込元 origin は needle にしない）
        expect(r.leak).toEqual([]);
    });

    it('vault サブパスが出力に混入した場合は leak として検出する', async () => {
        const state = makeState();
        state.privateSettings.obsidianVaultName = 'obsidian';
        state.privateSettings.obsidianSubPath = '40_reading_secret';
        // メモにうっかりローカルパスが混入したと仮定
        state.bookshelfFiles.mid.notes.M1 = { memo: 'メモ see obsidian/40_reading_secret' };
        const g = new PublishGenerator(makeApp(state), createPublishStyleRegistry());
        const page = { id: 'a', slug: 'p', title: 'P', intro: '', styleId: 'shelf-sections', styleParams: {}, select: { shelves: ['mid'], books: [], fields: fields() } };
        const r = await g.build([page]);
        expect(r.leak.length).toBeGreaterThan(0);
    });
});

describe('全標準スタイルの機能検証 (P1-6)', () => {
    it('5スタイルが本棚(slug)+本選択で例外なく生成・個人情報非漏洩・非選択本は出ない', async () => {
        const reg = createPublishStyleRegistry();
        expect(reg.list().length).toBe(5);
        for (const style of reg.list()) {
            const g = new PublishGenerator(makeApp(makeState()), reg);
            const page = {
                id: style.id, slug: 'p-' + style.id, title: style.name, intro: '紹介',
                styleId: style.id, styleParams: { lead: 'リード文', note: '本文ノート' },
                select: { shelves: ['manga'], books: ['M1'], fields: fields() }
            };
            const r = await g.build([page]);
            const file = r.files.find(f => f.path === `p-${style.id}/index.html`);
            expect(file, style.id).toBeTruthy();
            expect(file.content.startsWith('<!doctype html>'), style.id).toBe(true);
            expect(r.errors, style.id).toEqual([]);
            expect(r.leak, style.id).toEqual([]);
            expect(file.content, style.id).not.toContain('小説1'); // 非選択本棚 (novel) は出ない
            expect(file.content, style.id).not.toContain('MySecretVault');
        }
    });
});
