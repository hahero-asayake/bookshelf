// PublishArticleStore の CRUD / ブロック正規化 / 配置単位レコード / タグ正規化 / テーマ2軸 / 旧pages.json移行
// (S1 記事モデル, ADR-058・09_公開システム設計 §11)
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../js/publish-article-store.js');
const PublishArticleStore = globalThis.PublishArticleStore;

// メモリ上の storage モック ({readJSON, writeJSON})
function makeStorage(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        _dump: () => Object.fromEntries(store),
        async readJSON(path) { return store.has(path) ? store.get(path) : null; },
        async writeJSON(path, data) { store.set(path, JSON.parse(JSON.stringify(data))); }
    };
}

let storage, as;
beforeEach(async () => {
    storage = makeStorage();
    as = new PublishArticleStore(storage);
    await as.load();
});

describe('create / load 往復', () => {
    it('作成→永続化→新インスタンスで読み戻し一致', async () => {
        const a = await as.create({ title: '私を構成する10冊' });
        expect(a.id).toBeTruthy();
        expect(a.slug).toBe('私を構成する10冊');
        expect(a.blocks).toEqual([]);
        expect(a.tags).toEqual([]);
        expect(a.theme).toEqual({ layout: 'card', color: 'white' }); // 既定テーマ

        const as2 = new PublishArticleStore(storage);
        const articles = await as2.load();
        expect(articles).toHaveLength(1);
        expect(articles[0].title).toBe('私を構成する10冊');
    });

    it('slug の空白/記号は - に畳む', () => {
        expect(PublishArticleStore.slugify('  My Books!! 2024 ')).toBe('my-books-2024');
        expect(PublishArticleStore.slugify('')).toBe('article');
    });

    it('同名タイトルは -2, -3 と連番', async () => {
        const a = await as.create({ title: 'おすすめ' });
        const b = await as.create({ title: 'おすすめ' });
        const c = await as.create({ title: 'おすすめ' });
        expect(a.slug).toBe('おすすめ');
        expect(b.slug).toBe('おすすめ-2');
        expect(c.slug).toBe('おすすめ-3');
    });
});

describe('update / remove / duplicate / published', () => {
    it('update でタイトル・タグ・テーマを差し替え', async () => {
        const a = await as.create({ title: 'x' });
        await as.update(a.id, { title: '新題', tags: ['SF', 'おすすめ'], theme: { layout: 'wall', color: 'black' } });
        const got = as.get(a.id);
        expect(got.title).toBe('新題');
        expect(got.tags).toEqual(['SF', 'おすすめ']);
        expect(got.theme).toEqual({ layout: 'wall', color: 'black' });
    });

    it('remove で消える', async () => {
        const a = await as.create({ title: 'x' });
        expect(await as.remove(a.id)).toBe(true);
        expect(as.articles()).toHaveLength(0);
    });

    it('duplicate は内容を引き継ぎ別 id・別 slug・未公開で始まる', async () => {
        const a = await as.create({ title: '元', tags: ['SF'], published: true });
        const dup = await as.duplicate(a.id);
        expect(dup.id).not.toBe(a.id);
        expect(dup.slug).not.toBe(a.slug);
        expect(dup.tags).toEqual(['SF']);
        expect(dup.published).toBe(false); // 公開状態は引き継がない (旧 PublishPageStore と同じ規約)
        expect(as.articles()).toHaveLength(2);
    });

    it('published は既定 false・update で切替', async () => {
        const a = await as.create({ title: 'x' });
        expect(a.published).toBe(false);
        await as.update(a.id, { published: true });
        expect(as.get(a.id).published).toBe(true);
    });
});

describe('ブロック列は文章/本/本棚の3種のみ (§11.2)', () => {
    it('未知の type は捨てる', async () => {
        const a = await as.create({
            title: 'x',
            blocks: [
                { type: 'text', markdown: '# 導入' },
                { type: 'image', url: 'x.png' }, // 未対応ブロック種 (今回のMVP範囲外)
                { type: 'book', asin: 'B001' }
            ]
        });
        expect(a.blocks.map(b => b.type)).toEqual(['text', 'book']);
    });

    it('本ブロックは asin が無ければ捨てる', async () => {
        const a = await as.create({ title: 'x', blocks: [{ type: 'book' }, { type: 'book', asin: 'B001' }] });
        expect(a.blocks).toHaveLength(1);
        expect(a.blocks[0].asin).toBe('B001');
    });

    it('本ブロックは単一配置なのでブロック自身が show を持つ', async () => {
        const a = await as.create({ title: 'x', blocks: [{ type: 'book', asin: 'B001', show: { shortMemo: true, longMemo: false } }] });
        expect(a.blocks[0].show).toEqual({ shortMemo: true, longMemo: false });
    });

    it('全ブロックに id が補完される', async () => {
        const a = await as.create({ title: 'x', blocks: [{ type: 'text', markdown: 'x' }] });
        expect(a.blocks[0].id).toBeTruthy();
    });
});

describe('本棚ブロックの配置単位レコード (多重集合・追補1)', () => {
    it('同じ asin を1記事内に何度でも配置できる', async () => {
        const a = await as.create({
            title: 'x',
            blocks: [{
                type: 'shelf', shelfId: 'shelf-a',
                items: [
                    { asin: 'B001', show: { shortMemo: false, longMemo: false } },
                    { asin: 'B001', show: { shortMemo: true, longMemo: true } } // 同一本を2回配置
                ]
            }]
        });
        const items = a.blocks[0].items;
        expect(items).toHaveLength(2);
        expect(items[0].asin).toBe('B001');
        expect(items[1].asin).toBe('B001');
        // 表示設定の持ち主は「本」ではなく「配置」= 同じ本でも配置ごとに独立して on/off できる
        expect(items[0].show).toEqual({ shortMemo: false, longMemo: false });
        expect(items[1].show).toEqual({ shortMemo: true, longMemo: true });
    });

    it('各配置は {id, blockId, asin, order, show} を持ち、blockId は親ブロックを指す', async () => {
        const a = await as.create({
            title: 'x',
            blocks: [{ type: 'shelf', shelfId: 'shelf-a', items: [{ asin: 'B001' }, { asin: 'B002' }] }]
        });
        const block = a.blocks[0];
        for (const item of block.items) {
            expect(item.id).toBeTruthy();
            expect(item.blockId).toBe(block.id);
            expect(item.asin).toBeTruthy();
            expect(typeof item.order).toBe('number');
            expect(item.show).toEqual({ shortMemo: false, longMemo: false });
        }
    });

    it('order を明示指定すれば維持し、未指定は配列順で補完する', async () => {
        const a = await as.create({
            title: 'x',
            blocks: [{ type: 'shelf', items: [{ asin: 'B001', order: 5 }, { asin: 'B002' }] }]
        });
        expect(a.blocks[0].items[0].order).toBe(5);
        expect(a.blocks[0].items[1].order).toBe(1);
    });

    it('asin の無い配置は捨てる', async () => {
        const a = await as.create({ title: 'x', blocks: [{ type: 'shelf', items: [{}, { asin: 'B001' }] }] });
        expect(a.blocks[0].items).toHaveLength(1);
    });
});

describe('タグ (自由入力 + 正規化キー, §11.6)', () => {
    it('normalizeTagKey は小文字化 + 全角半角統一で同一視する', () => {
        expect(PublishArticleStore.normalizeTagKey('SF')).toBe(PublishArticleStore.normalizeTagKey('sf'));
        expect(PublishArticleStore.normalizeTagKey('SF')).toBe(PublishArticleStore.normalizeTagKey('ＳＦ'));
    });

    it('allTags は正規化キーで集約し、表示は初出表記・使用数つきを返す', async () => {
        await as.create({ title: 'a', tags: ['SF'] });
        await as.create({ title: 'b', tags: ['sf', 'ミステリ'] });
        await as.create({ title: 'c', tags: ['ＳＦ'] });
        const tags = as.allTags();
        const sf = tags.find(t => t.key === PublishArticleStore.normalizeTagKey('SF'));
        expect(sf.label).toBe('SF'); // 初出表記 (最初に作られた記事の表記)
        expect(sf.count).toBe(3);
        const mystery = tags.find(t => t.label === 'ミステリ');
        expect(mystery.count).toBe(1);
    });
});

describe('テーマ = レイアウト × 配色の直交2軸 (§11.3)', () => {
    it('不正なレイアウト/配色値は既定にフォールバックする', async () => {
        const a = await as.create({ title: 'x', theme: { layout: 'nope', color: 'invisible' } });
        expect(a.theme).toEqual({ layout: 'card', color: 'white' });
    });

    it('レイアウト3種・配色10種の全組み合わせを受理する', async () => {
        for (const layout of ARTICLE_LAYOUTS_TEST) {
            for (const color of ARTICLE_COLORS_TEST) {
                const t = PublishArticleStore.normalizeTheme({ layout, color });
                expect(t).toEqual({ layout, color });
            }
        }
    });
});
const ARTICLE_LAYOUTS_TEST = ['wall', 'count', 'card'];
const ARTICLE_COLORS_TEST = ['red', 'orange', 'pink', 'purple', 'yellow', 'brown', 'green', 'blue', 'black', 'white'];

describe('移行: 旧 pages.json → 記事モデル (非破壊, §11.1)', () => {
    it('1ページ→1記事の機械変換: intro→文章ブロック、shelves→本棚ブロック(スナップショット)、books→本ブロック', () => {
        const pages = [{
            id: 'p1', slug: 'my-page', title: '漫画の本棚', intro: 'よろしくお願いします',
            select: { shelves: ['shelf-a'], books: ['B999'] },
            published: true, createdAt: 111, updatedAt: 222, lastBuiltAt: 333
        }];
        const resolve = (shelfKey) => (shelfKey === 'shelf-a' ? ['B001', 'B002'] : []);
        const [article] = PublishArticleStore.migrateFromPages(pages, resolve);

        expect(article.slug).toBe('my-page');
        expect(article.title).toBe('漫画の本棚');
        expect(article.published).toBe(true);
        expect(article.createdAt).toBe(111);
        expect(article.tags).toEqual([]);
        expect(article.theme).toEqual({ layout: 'card', color: 'white' });

        expect(article.blocks[0].type).toBe('text');
        expect(article.blocks[0].markdown).toBe('よろしくお願いします');

        const shelfBlock = article.blocks.find(b => b.type === 'shelf');
        expect(shelfBlock.shelfId).toBe('shelf-a');
        expect(shelfBlock.items.map(i => i.asin)).toEqual(['B001', 'B002']);
        // 蔵書更新を自動反映しない、という記事モデルの不変条件に合わせ、移行時点でスナップショット展開する
        expect(shelfBlock.items.every(i => i.blockId === shelfBlock.id)).toBe(true);

        const bookBlock = article.blocks.find(b => b.type === 'book');
        expect(bookBlock.asin).toBe('B999');
    });

    it('intro が空なら文章ブロックを追加しない', () => {
        const pages = [{ id: 'p1', title: 'x', select: {} }];
        const [article] = PublishArticleStore.migrateFromPages(pages, () => []);
        expect(article.blocks).toEqual([]);
    });

    it('migrateFromLegacyIfNeeded は pages.json を書き換えず articles.json だけ書く', async () => {
        await storage.writeJSON('private/publish/pages.json', {
            pages: [{ id: 'p1', slug: 'x', title: 'x', select: { shelves: [], books: ['B1'] }, published: false }]
        });
        const as2 = new PublishArticleStore(storage);
        const result = await as2.migrateFromLegacyIfNeeded(() => []);
        expect(result.migrated).toBe(1);
        expect(as2.articles()).toHaveLength(1);
        expect(as2.articles()[0].blocks[0].asin).toBe('B1');

        const legacyStillThere = await storage.readJSON('private/publish/pages.json');
        expect(legacyStillThere.pages).toHaveLength(1); // 非破壊
    });

    it('migrateFromLegacyIfNeeded は既に記事があれば何もしない (idempotent)', async () => {
        await as.create({ title: '既存記事' });
        await storage.writeJSON('private/publish/pages.json', { pages: [{ id: 'p1', title: 'x', select: {} }] });
        const result = await as.migrateFromLegacyIfNeeded(() => []);
        expect(result.skipped).toBe(true);
        expect(as.articles()).toHaveLength(1);
        expect(as.articles()[0].title).toBe('既存記事');
    });
});
