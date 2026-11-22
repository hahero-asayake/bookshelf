// イシュー#770 (切り替え④ detailTopbarFloat＝#768 の 8c)。触れるモック (_vault-work/754/inject/two768.css・台本 _vault-work/768/harness/check8c.mjs)
// で確かめた形をアプリで見る。
//   閲覧の時：帯 (.bd-topbar) の行が無く (高さ0)、鉛筆は .bd の右上 (表紙の段の右上) に重なり、頁と一緒に流れる (sticky ではない)
//   編集中：今のまま帯が付いてくる (sticky・#453 の決裁＝✓ (保存) が見える)
//   localStorage 'bookshelf.flag.detailTopbarFloat' = '0' で前の形 (閲覧でも帯の行がある)。
// 390幅 (iPhone 相当) の webkit は playwright.config の webkit / gate-webkit が流す。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SHELF_NAME = 'テスト本棚';
const SHELF_KEY = 'fixshelf01';

async function boot(page, { flag = null } = {}) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    // 自作の本棚を1つ足す (ハブの見本は「すべて」だけ)。本は蔵書の先頭3冊
    const all = JSON.parse(hub.files.get('private/bookshelves/all.json').content).books;
    const put = (path, data) => { hub.seq += 1; hub.files.set(path, { content: JSON.stringify(data), etag: `"v${hub.seq}"` }); };
    put('private/bookshelves.json', { bookshelves: [
        { internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true },
        { internalId: SHELF_KEY, slug: 'fixshelf', name: SHELF_NAME, parent: 'fixall001' },
    ] });
    put('private/bookshelves/fixshelf.json', { books: all.slice(0, 3) });
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    if (flag != null) await page.evaluate((v) => localStorage.setItem('bookshelf.flag.detailTopbarFloat', v), flag);
}

// 左ナビ (スマホは引き出し) の木から本棚を開く
async function openShelf(page, name) {
    const narrow = await page.evaluate(() => window.matchMedia('(max-width: 900px)').matches);
    if (narrow) {
        await page.locator('[data-mobile-nav="shelves"]').click();
        await expect(page.locator('body')).toHaveClass(/drawer-open/);
    }
    const node = page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: name }).first();
    // 子の本棚は「すべて」の下に畳まれている時がある＝開く
    if (!(await node.isVisible())) await page.locator('#sidebar-bookshelf-tree .tree-node.lv0 .tree-toggle').first().click();
    await node.click();
    await expect(page.locator('#current-bookshelf-title')).toContainText(name);
    await expect(page.locator('#bookshelf .book-item').first()).toBeVisible();
}

// 本棚の画面から1冊目の本の詳細を開く
async function openDetail(page, flag = null) {
    await boot(page, { flag });
    await openShelf(page, SHELF_NAME);
    const asin = await page.locator('#bookshelf .book-item').first().getAttribute('data-asin');
    await page.locator(`#bookshelf .book-item[data-asin="${asin}"]`).first().click();
    await expect(page.locator('.bd:visible .bd-edit-toggle')).toBeVisible();
}

// .bd・帯・鉛筆・表紙の段の矩形と帯の position
const geo = (page) => page.evaluate(() => {
    const bd = [...document.querySelectorAll('.bd')].find((e) => e.getClientRects().length);
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, height: b.height }; };
    const bar = bd.querySelector('.bd-topbar');
    return { bd: r(bd), bar: r(bar), pos: getComputedStyle(bar).position, btn: r(bar.querySelector('.bd-edit-toggle')), cover: r(bd.querySelector('.bd-cover-wrap')), float: bd.classList.contains('is-topbar-float') };
});

for (const dev of [
    { name: 'PC 1280', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'スマホ390', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA } },
]) {
    test.describe(`${dev.name}: 本の詳細の帯 8c (既定＝on)`, () => {
        test.use(dev.use);

        test('閲覧では帯の行が無く鉛筆が表紙の段の右上・頁と一緒に流れる／編集では帯が付いてきて ✓ が見える', async ({ page }) => {
            await openDetail(page);
            const g = await geo(page);
            expect(g.float).toBe(true);
            expect(g.pos).toBe('absolute');
            expect(g.bar.height, JSON.stringify(g)).toBeLessThanOrEqual(1);
            // 鉛筆は .bd の右上 (右端にそろい、上端の近く)・表紙の段は帯の行の分だけ上に詰まる (鉛筆と同じ高さに重なる)
            expect(Math.abs(g.btn.right - g.bd.right), JSON.stringify(g)).toBeLessThanOrEqual(1);
            expect(g.btn.top - g.bd.top, JSON.stringify(g)).toBeLessThanOrEqual(2);
            expect(g.cover.top, JSON.stringify(g)).toBeLessThan(g.btn.bottom);
            // 編集へ
            await page.locator('.bd:visible .edit-mode-btn').click();
            await expect(page.locator('.bd:visible .cancel-edit-btn')).toBeVisible();
            const e = await geo(page);
            expect(e.float).toBe(false);
            expect(e.pos).toBe('sticky');
            // 中を一番下まで送っても ✓ は見えている
            await page.evaluate(() => {
                let el = [...document.querySelectorAll('.bd')].find((x) => x.getClientRects().length);
                while (el && !(el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
                if (el) el.scrollTop = el.scrollHeight;
            });
            await expect(page.locator('.bd:visible .cancel-edit-btn')).toBeInViewport();
        });
    });
}

test.describe('PC 1280: detailTopbarFloat=0 で前の形', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('閲覧でも帯の行があり sticky', async ({ page }) => {
        await openDetail(page, '0');
        const g = await geo(page);
        expect(g.float).toBe(false);
        expect(g.pos).toBe('sticky');
        expect(g.bar.height).toBeGreaterThan(20);
        expect(g.cover.top).toBeGreaterThanOrEqual(g.btn.bottom - 1);
    });
});
