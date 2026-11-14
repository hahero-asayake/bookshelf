// イシュー#674: 保存先 (ハブ・フォルダ・GitHub) から読んだ本棚で、重複ASINの本を付け直すと本棚所属と並び順が崩れていた。
// 保存先からの読込 (js/bookshelf.js の bookshelves.forEach(b => { bookOrder[b.id] = b.books; })) は、本棚の books と
// bookOrder[本棚] を同じ配列にする。「すべての本」も _ensureAllShelf で bookOrder.all と同じ配列になる (ADR-166)。
// migrateUserData は本棚の books へのコピー (push) と bookOrder の置き換えを別々にかけていたため、同じ配列に2回効き、
// 自作の本棚では下巻 (旧ASINのまま) が外れて新ASINが2回、「すべての本」では新ASINが2回入っていた
// (#484 のコピー化 2026-11-02 から。端末の控えから読む起動は別々の配列なので duplicate-asin-notice.spec.js では見えなかった)。
// 約束 (#484・ADR-166): 付け替えた直後も、もう一方の本の本棚所属は残る。bookOrder は重複2件のうち1件だけ置き換わる。
// フォルダ・GitHub は同じ読込の関数を通るので、ここではハブだけを回す。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { createHubStateForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';

const DUP_ASIN = 'B00I8AT186'; // 上巻・下巻に同じASIN (duplicate-asin-notice.spec.js と同じ実例)
const SOLO_ASIN = 'B0SOLO0001';
const NEW_ASIN = 'BNEWASIN01';
const books = [
    { asin: DUP_ASIN, title: '上巻', authors: '著者A', acquiredTime: 1700000000000, source: 'kindle_import', addedDate: 1700000000000, readStatus: 'UNKNOWN', productImage: '' },
    { asin: DUP_ASIN, title: '下巻', authors: '著者A', acquiredTime: 1700000001000, source: 'kindle_import', addedDate: 1700000001000, readStatus: 'UNKNOWN', productImage: '' },
    { asin: SOLO_ASIN, title: '単独の本', authors: '著者C', acquiredTime: 1700000003000, source: 'kindle_import', addedDate: 1700000003000, readStatus: 'UNKNOWN', productImage: '' },
];

// ハブの中に、アプリがハブに保存する形で蔵書と本棚2つ (「すべての本」と自作の「フィクション」) を置く
function seedHubShelves(hub) {
    const put = (path, data) => { hub.seq += 1; hub.files.set(path, { content: JSON.stringify(data), etag: `"v${hub.seq}"` }); };
    put('private/library.json', { books, metadata: { totalBooks: books.length } });
    put('private/bookshelves.json', { bookshelves: [
        { internalId: 'fixall674', slug: 'all', name: 'すべての本', isSpecial: true },
        { internalId: 'fixfiction674', slug: 'fiction', name: 'フィクション', parent: 'fixall674' },
    ] });
    put('private/bookshelves/all.json', { books: books.map((b) => b.asin) });
    put('private/bookshelves/fiction.json', { books: [DUP_ASIN, SOLO_ASIN] });
    put('private/notes.json', { notes: { [DUP_ASIN]: { memo: '上下巻共通の感想', rating: 4 } } });
}

const shelfState = () => {
    const ud = window.bookshelf.userData;
    const fiction = ud.bookshelves.find((b) => b.id === 'fiction');
    const all = ud.bookshelves.find((b) => b.isSpecial);
    return {
        fictionBooks: fiction.books.slice(),
        fictionOrder: ud.bookOrder.fiction.slice(),
        fictionSameArray: fiction.books === ud.bookOrder.fiction,
        allOrder: ud.bookOrder.all.slice(),
        allSameArray: all.books === ud.bookOrder.all,
        notes: ud.notes,
    };
};
const count = (arr, asin) => arr.filter((a) => a === asin).length;

test('ハブから読んだ本棚で重複ASINの本を付け直しても、もう一方の本は本棚に残り、新ASINは並びに1回だけ入る', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const hub = createHubStateForTest({ plan: 'free' });
    seedHubShelves(hub);
    // 端末の控えは入れない = 蔵書と本棚をハブから読む起動にする
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await page.waitForFunction((n) => window.bookshelf.books.length === n, books.length);

    // 前提: 保存先から読んだ本棚は、books と bookOrder[本棚] が同じ配列 (この形の時に二重に効いていた)
    const before = await page.evaluate(shelfState);
    expect(before.fictionSameArray).toBe(true);
    expect(before.allSameArray).toBe(true);

    // 上巻 (1枚目) を開き、編集モードの「オリジナルASIN」欄に新ASINを入れて保存する (duplicate-asin-notice.spec.js と同じ操作)
    await page.evaluate(() => { window.bookshelf.switchBookshelf('all'); });
    await page.waitForFunction((n) => document.querySelectorAll('#bookshelf > .book-item').length === n, books.length);
    await page.evaluate((a) => { document.querySelectorAll(`#bookshelf > .book-item[data-asin="${a}"]`)[0].click(); }, DUP_ASIN);
    await expect(page.locator('#book-detail-pane .bd-dup-asin-notice')).toBeVisible();
    await page.locator('#book-detail-pane .edit-mode-btn').click();
    await page.locator('#book-detail-pane .edit-original-asin').fill(NEW_ASIN);
    await page.locator('#book-detail-pane .cancel-edit-btn').click();
    await page.waitForFunction((na) => !!(window.bookshelf.userData.notes && window.bookshelf.userData.notes[na]), NEW_ASIN);

    const after = await page.evaluate(shelfState);
    // 自作の本棚: 下巻 (旧ASINのまま) は残り、新ASINは1回だけ (所属はコピー・#484)
    expect(after.fictionBooks).toContain(DUP_ASIN);
    expect(count(after.fictionBooks, NEW_ASIN)).toBe(1);
    expect(after.fictionBooks).toContain(SOLO_ASIN);
    expect(after.fictionBooks.length).toBe(3);
    expect(count(after.fictionOrder, NEW_ASIN)).toBe(1);
    // 「すべての本」: 並びは蔵書と同じ3件で、重複2件のうち1件だけが新ASINに置き換わる (#484・ADR-166)
    expect(after.allOrder.length).toBe(books.length);
    expect(count(after.allOrder, NEW_ASIN)).toBe(1);
    expect(count(after.allOrder, DUP_ASIN)).toBe(1);
    expect(after.allSameArray).toBe(true);
    // メモは両方に残る (コピー)
    expect(after.notes[NEW_ASIN]?.memo).toBe('上下巻共通の感想');
    expect(after.notes[DUP_ASIN]?.memo).toBe('上下巻共通の感想');

    expect(errors).toEqual([]);
});
