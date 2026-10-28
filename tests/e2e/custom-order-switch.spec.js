// イシュー#402: カスタム順への切替・カスタム順からの切替で一覧を全件作り直さない。
// 以前は container の class (is-custom-order) が変わるだけで差分描画を通らず、913冊を全件作り直していた
// (chromium CPU x6 で固まる時間が 1.1〜1.2秒)。カードの中身はカスタム順かどうかに依存しないので、
// class を付け替えて差分描画に回す。次を UI 経由 (並び順セレクトの change) で確かめる:
//   1. 切替の前後で同じカード要素が使い回される (全件作り直しでない)
//   2. is-custom-order が付く/外れる
//   3. 置き終えた DOM の並びが、カスタム順 (bookOrder) / 書名順どおり・全件・重複なし
import { test, expect } from './helpers/test-base.js';

const N = 913;
const books = Array.from({ length: N }, (_, i) => {
    const n = i + 1;
    return {
        asin: `C${String(n).padStart(9, '0')}`, title: `カスタム順の本 ${String(n).padStart(4, '0')}`, authors: `著者${n % 13}`,
        acquiredTime: 1700000000000 + ((n * 104729) % N) * 1000,
        readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000,
    };
});
// カスタム順は書名順の逆 (末尾の 13 冊は bookOrder に入れない＝末尾に回る)
const customOrder = books.map((b) => b.asin).reverse().slice(13);
const library = { books, metadata: { totalBooks: books.length } };
const userData = {
    bookshelves: [{ id: 'all', internalId: 'fixall402', name: 'すべての本', iconName: 'library', isSpecial: true, books: books.map((b) => b.asin), notes: {} }],
    notes: {}, settings: { sortOrder: 'title', sortDirection: 'asc' }, bookOrder: { all: customOrder }, stats: {}, version: '2.0',
};

async function setup(page) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
    await page.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), JSON.stringify(library)]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.books && window.bookshelf.books.length > 0, null, { timeout: 60000 });
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        window.bookshelf.switchBookshelf('all');
    });
    await page.waitForFunction((n) => document.querySelectorAll('#bookshelf > .book-item').length === n, N);
    return errors;
}

// 並び順セレクトを UI と同じ change で切り替え、段階描画の後追いまで置き終えるのを待つ
async function chooseOrder(page, value) {
    await page.evaluate((v) => {
        const sel = document.getElementById('sort-order');
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await page.waitForFunction((n) => document.querySelectorAll('#bookshelf > .book-item').length === n, N);
    await page.waitForTimeout(300);
    await page.waitForFunction((n) => document.querySelectorAll('#bookshelf > .book-item').length === n, N);
}

const domAsins = (page) => page.evaluate(() => [...document.querySelectorAll('#bookshelf > .book-item')].map((e) => e.dataset.asin));

test('カスタム順への切替/カスタム順からの切替は全件作り直しにせず、並びは正しい (#402)', async ({ page }) => {
    const errors = await setup(page);
    const titleOrder = books.map((b) => b.asin); // 書名は番号の0埋めなので asin 順と同じ
    expect(await domAsins(page)).toEqual(titleOrder);

    // 全カードに印を付ける (作り直されると印の無い新しい要素になる)
    await page.evaluate(() => document.querySelectorAll('#bookshelf > .book-item').forEach((e) => { e.__mark402 = true; }));

    await chooseOrder(page, 'custom');
    const expectedCustom = [...customOrder, ...books.map((b) => b.asin).filter((a) => !customOrder.includes(a))];
    expect(await domAsins(page)).toEqual(expectedCustom);
    expect(await page.evaluate(() => document.getElementById('bookshelf').classList.contains('is-custom-order'))).toBe(true);
    const keptToCustom = await page.evaluate(() => [...document.querySelectorAll('#bookshelf > .book-item')].filter((e) => e.__mark402).length);
    expect(keptToCustom).toBe(N);

    await chooseOrder(page, 'title');
    expect(await domAsins(page)).toEqual(titleOrder);
    expect(await page.evaluate(() => document.getElementById('bookshelf').classList.contains('is-custom-order'))).toBe(false);
    const keptBack = await page.evaluate(() => [...document.querySelectorAll('#bookshelf > .book-item')].filter((e) => e.__mark402).length);
    expect(keptBack).toBe(N);

    expect(errors).toEqual([]);
});
