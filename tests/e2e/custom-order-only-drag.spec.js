// ADR-010「手動並び替えは『カスタム順』のときだけ」を確かめる (イシュー#676)。
// 並べ替えの起点は保存済みの bookOrder なので、取得日の順などで動かせると、見た目と反する結果になる (ADR-010 の理由)。
// そのため、カスタム順でない並びでは、本のつまみ (.drag-handle) を押して別の本の上で離しても、ドラッグは始まらない。
// 画面の並び・保存される並び (bookOrder)・並び順の設定も変わらない (js/bookshelf.js の _onBookPointerDown の先頭のガード)。
import { test, expect } from './helpers/test-base.js';
import { setAllShelfBooksForTest } from './helpers/all-shelf.js';
import { waitForListStaged } from './helpers/app-misc.js';

const N = 60;
const books = Array.from({ length: N }, (_, i) => {
    const n = i + 1;
    return {
        asin: `C${String(n).padStart(9, '0')}`, title: `並べ替えの本 第${n}話`, authors: `著者${n % 7}`,
        // 取得日の順が見本の並び (C…001 から) と違うようにする (37 と 60 は互いに素＝取得日は重ならない)
        acquiredTime: 1700000000000 + ((n * 37) % N) * 1000,
        readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000,
    };
});
const ASINS = books.map((b) => b.asin);
const MINE = ASINS.slice(0, 30);
const library = { books, metadata: { totalBooks: N } };
// 自作の本棚は、読込の時と同じく bookOrder[slug] を本棚の books と同じ並びにしておく
const userData = setAllShelfBooksForTest({
    bookshelves: [
        { id: 'all', internalId: 'fixall676', name: 'すべての本', iconName: 'library', isSpecial: true, books: [], notes: {} },
        { id: 'mine', name: '自作の本棚', iconName: 'library', books: [...MINE], notes: {} },
    ],
    notes: {}, settings: { sortOrder: 'acquiredTime', sortDirection: 'desc' }, bookOrder: { mine: [...MINE] }, stats: {}, version: '2.0',
}, ASINS);

async function setup(page, shelfId) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), JSON.stringify(library)]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.books && window.bookshelf.books.length > 0, null, { timeout: 60000 });
    await page.evaluate((id) => window.bookshelf.switchBookshelf(id), shelfId);
    const want = shelfId === 'all' ? N : MINE.length;
    await page.waitForFunction((n) => document.querySelectorAll('#bookshelf > .book-item').length === n, want);
    await waitForListStaged(page);
    return errors;
}

function readState(page, shelfId) {
    return page.evaluate((id) => ({
        dom: Array.from(document.querySelectorAll('#bookshelf > .book-item')).map((el) => el.dataset.asin),
        saved: [...(window.bookshelf.userData.bookOrder[id] || [])],
        sortOrder: window.bookshelf.sortOrder,
        sortSelect: document.getElementById('sort-order').value,
        customCls: document.getElementById('bookshelf').classList.contains('is-custom-order'),
    }), shelfId);
}

for (const [shelfId, label] of [['all', 'すべての本'], ['mine', '自作の本棚']]) {
    test(`${label}: 取得日の順でつまみを押して別の本の上で離しても、ドラッグは始まらず並びは変わらない (ADR-010)`, async ({ page }) => {
        const errors = await setup(page, shelfId);
        const before = await readState(page, shelfId);
        expect(before.sortOrder).toBe('acquiredTime');
        expect(before.customCls).toBe(false);
        // 見本の前提: 画面の並び (取得日の順) と保存済みの並びが違う (同じだと、動いても動かなくても区別できない)
        expect(before.dom).not.toEqual(before.saved);

        const items = page.locator('#bookshelf > .book-item');
        const first = items.nth(0);
        await first.hover();
        const hb = await first.locator('.drag-handle').boundingBox();
        const tb = await items.nth(4).boundingBox();
        expect(hb, 'つまみの位置が取れない').toBeTruthy();
        expect(tb, 'ドロップ先の位置が取れない').toBeTruthy();
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await page.mouse.down();
        await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
        // 離す前 (ドラッグ中ならここで印が付いている) に見る
        const during = await page.evaluate(() => ({
            dragStarted: !!window.bookshelf.draggedElement,
            dragging: document.querySelectorAll('#bookshelf > .book-item.dragging').length,
        }));
        await page.mouse.up();
        expect(during, 'カスタム順でないのにドラッグが始まった (ADR-010)').toEqual({ dragStarted: false, dragging: 0 });

        const after = await readState(page, shelfId);
        expect(after.dom).toEqual(before.dom);
        expect(after.saved).toEqual(before.saved);
        expect(after.sortOrder).toBe('acquiredTime');
        expect(after.sortSelect).toBe(before.sortSelect);
        expect(errors).toEqual([]);
    });
}
