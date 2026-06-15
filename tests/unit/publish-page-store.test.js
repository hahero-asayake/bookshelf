// PublishPageStore の CRUD / slug 一意 / published テスト (P1-1, ADR-030)
// ※ 公開項目はスタイル固定 (publish-styles の declare().shows) のため select.fields は持たない
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../js/publish-page-store.js');
const PublishPageStore = globalThis.PublishPageStore;

// メモリ上の storage モック ({readJSON, writeJSON})
function makeStorage(initial = null) {
    let store = initial;
    return {
        _dump: () => store,
        async readJSON(path) { return path === 'private/publish/pages.json' ? store : null; },
        async writeJSON(path, data) { if (path === 'private/publish/pages.json') store = JSON.parse(JSON.stringify(data)); }
    };
}

let storage, ps;
beforeEach(async () => {
    storage = makeStorage();
    ps = new PublishPageStore(storage);
    await ps.load();
});

describe('create / load 往復', () => {
    it('作成→永続化→新インスタンスで読み戻し一致', async () => {
        const p = await ps.create({ title: '漫画の本棚', styleId: 'shelf-sections' });
        expect(p.id).toBeTruthy();
        expect(p.slug).toBe('漫画の本棚');
        expect(p.select).toEqual({ shelves: [], books: [] }); // fields は持たない (スタイル固定)

        const ps2 = new PublishPageStore(storage);
        const pages = await ps2.load();
        expect(pages).toHaveLength(1);
        expect(pages[0].title).toBe('漫画の本棚');
    });

    it('select は shelves / books のみ保持する', async () => {
        const p = await ps.create({ title: 'x', select: { shelves: ['s1'], books: ['B1'] } });
        expect(p.select).toEqual({ shelves: ['s1'], books: ['B1'] });
        expect(p.select.fields).toBeUndefined();
    });
});

describe('slug の一意化', () => {
    it('同名タイトルは -2, -3 と連番', async () => {
        const a = await ps.create({ title: 'おすすめ' });
        const b = await ps.create({ title: 'おすすめ' });
        const c = await ps.create({ title: 'おすすめ' });
        expect(a.slug).toBe('おすすめ');
        expect(b.slug).toBe('おすすめ-2');
        expect(c.slug).toBe('おすすめ-3');
    });

    it('空白/記号は - に畳む', () => {
        expect(PublishPageStore.slugify('  My Books!! 2024 ')).toBe('my-books-2024');
        expect(PublishPageStore.slugify('')).toBe('page');
    });
});

describe('update / remove / duplicate', () => {
    it('update で対象選択とスタイルを差し替え', async () => {
        const p = await ps.create({ title: 'x' });
        await ps.update(p.id, { styleId: 'book-feature', select: { books: ['B001'], shelves: [] } });
        const got = ps.get(p.id);
        expect(got.styleId).toBe('book-feature');
        expect(got.select.books).toEqual(['B001']);
    });

    it('remove で消える', async () => {
        const p = await ps.create({ title: 'x' });
        expect(await ps.remove(p.id)).toBe(true);
        expect(ps.pages()).toHaveLength(0);
    });

    it('duplicate は内容を引き継ぎ別 id・別 slug', async () => {
        const p = await ps.create({ title: '元', styleId: 's1', select: { books: ['B1'] } });
        const dup = await ps.duplicate(p.id);
        expect(dup.id).not.toBe(p.id);
        expect(dup.slug).not.toBe(p.slug);
        expect(dup.styleId).toBe('s1');
        expect(dup.select.books).toEqual(['B1']);
        expect(ps.pages()).toHaveLength(2);
    });
});

describe('published (ページ単位公開, ADR-030)', () => {
    it('作成時の既定は未公開、update で公開状態を切替', async () => {
        const p = await ps.create({ title: 'x', styleId: 's1' });
        expect(p.published).toBe(false);
        await ps.update(p.id, { published: true });
        expect(ps.get(p.id).published).toBe(true);
        await ps.update(p.id, { published: false });
        expect(ps.get(p.id).published).toBe(false);
    });

    it('複製は未公開で始まる (公開状態は引き継がない)', async () => {
        const p = await ps.create({ title: '元', styleId: 's1', published: true });
        expect(p.published).toBe(true);
        const dup = await ps.duplicate(p.id);
        expect(dup.published).toBe(false);
    });
});
