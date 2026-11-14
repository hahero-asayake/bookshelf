// イシュー#663: 開いている本棚が別の端末で削除された後に、保存先から読み直すと (再読込した時の起動の読込)、一覧は「すべての本」へ
// 切り替わる。見出し・本の数 (全件)・ツリーで選択中の行・URL が「すべての本」に揃い、戻る用の履歴は積まない (消えた本棚の段を置き換える)。
// 消えない本棚を開いていた時は、そのまま開いたまま。
// 保存先はハブの模擬 (tests/e2e/helpers/gate-hub.js)。別の端末 (tests/e2e/helpers/gate-device.js) でツリーの「…」→ 削除 → 確認を
// 画面から行い、ハブに届いてから端末Aを再読込する。端末Aの手元には消えた本棚が残っているので、起動は先にその本棚を描き、
// その後に保存先から読み直す (js/bookshelf.js の起動で startRouter が initSync より前)。
// 本棚を開く・削除する手順と、揃ったかの見方は tests/e2e/shelf-delete-open-descendant.spec.js (イシュー#634) と同じ。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';
import { prepareOtherDeviceForTest, closeOtherDeviceForTest } from './helpers/gate-device.js';

const here = dirname(fileURLToPath(import.meta.url));
const ASINS = JSON.parse(readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8')).books.map((b) => b.asin);
const ALL_NAME = 'すべての本';
const ALL_COUNT = ASINS.length; // 5冊 (全件)
const X = { slug: 'e2e-reload-x', name: '本棚X', books: ASINS.slice(0, 2) };
const Y = { slug: 'e2e-reload-y', name: '本棚Y', books: ASINS.slice(2, 3) };

// ハブに蔵書の見本 (5冊) と、本棚X (本 1・2)・本棚Y (本 3) を置く
function seedHub() {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    const put = (path, data) => { hub.seq += 1; hub.files.set(path, { content: JSON.stringify(data), etag: `"v${hub.seq}"` }); };
    put('private/bookshelves.json', { bookshelves: [
        { internalId: 'fixall001', slug: 'all', name: ALL_NAME, isSpecial: true },
        { internalId: 'e2ereloadx01', slug: X.slug, name: X.name, parent: 'fixall001' },
        { internalId: 'e2ereloady01', slug: Y.slug, name: Y.name, parent: 'fixall001' }
    ] });
    put(`private/bookshelves/${X.slug}.json`, { books: X.books });
    put(`private/bookshelves/${Y.slug}.json`, { books: Y.books });
    return hub;
}

const treeNode = (page, slug) => page.locator(`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="${slug}"]`);
const isPhone = (page) => (page.viewportSize()?.width || 1280) < 768;
const historyLength = (page) => page.evaluate(() => history.length);

// 390 幅ではツリーはドロワーの中にある。下部ナビの「本棚」で開く (開いていれば何もしない)
async function showTree(page) {
    if (!isPhone(page)) return;
    if (await page.locator('body.drawer-open').count()) return;
    await page.locator('#mobile-bottom-nav [data-mobile-nav="shelves"]').click();
    await expect(page.locator('body')).toHaveClass(/drawer-open/);
    await expect(treeNode(page, 'all')).toBeVisible();
}

// ツリーの「すべての本」が畳まれていれば展開する
async function expandAll(page) {
    const toggle = treeNode(page, 'all').locator('.tree-toggle');
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute('title') === '展開') await toggle.click();
}

async function openShelf(page, slug) {
    await showTree(page);
    await expandAll(page);
    await treeNode(page, slug).click();
    await expect(page).toHaveURL(new RegExp(`#/bookshelf/${slug}$`));
    await expect(page.locator('body')).not.toHaveClass(/drawer-open/);
}

async function deleteShelf(page, slug) {
    await showTree(page);
    await expandAll(page);
    const node = treeNode(page, slug);
    if (!isPhone(page)) await node.hover();
    await node.locator('.tree-more').click();
    await page.locator('#tree-node-menu [data-act="delete"]').click();
    const cfm = page.locator('.cfm-overlay');
    await expect(cfm).toBeVisible();
    await cfm.locator('.cfm-ok').click();
    await expect(cfm).toBeHidden();
    await expect(treeNode(page, slug)).toHaveCount(0);
}

// 端末A: ハブにログインした端末で、ツリーから本棚Xを開く
async function openXOnDeviceA(page, hub) {
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await page.goto('index.html');
    await waitForHubStartupForTest(page);
    await openShelf(page, X.slug);
    await expect(page.locator('#current-bookshelf-title')).toHaveText(X.name);
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(X.books.length);
}

// 別の端末で本棚を画面から削除し、ハブに届く (bookshelves.json から消える) まで待つ
async function deleteOnOtherDevice(page, hub, slug) {
    const other = await prepareOtherDeviceForTest(page, hub);
    await other.goto('index.html');
    await waitForHubStartupForTest(other);
    await deleteShelf(other, slug);
    await expect.poll(() => (hub.files.get('private/bookshelves.json')?.content || '').includes(`"${slug}"`), { timeout: 20000 }).toBe(false);
    await closeOtherDeviceForTest(other);
}

// 端末Aを再読込し、保存先からの読み直しが終わるまで待つ (読み直しの後の描き直しまで済んだ状態を見る)
async function reloadDeviceA(page) {
    await page.reload();
    await waitForHubStartupForTest(page);
}

// 失敗した時だけ、開いている本棚の値 (currentBookshelf) を添付する (判定には使わない)
test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    const cur = await page.evaluate(() => window.bookshelf && window.bookshelf.currentBookshelf).catch((e) => `読めない: ${e.message}`);
    await testInfo.attach('currentBookshelf', { body: String(cur), contentType: 'text/plain' });
});

function addCases() {
    test('ケース1: 開いている本棚Xが別の端末で削除され、再読込で読み直すと「すべての本」に揃い、履歴は積まない', async ({ page }) => {
        const hub = seedHub();
        await openXOnDeviceA(page, hub);
        await deleteOnOtherDevice(page, hub, X.slug);
        const before = await historyLength(page);
        await reloadDeviceA(page);
        await expect(page.locator('#current-bookshelf-title')).toHaveText(ALL_NAME);
        await expect(page).toHaveURL(/#\/bookshelf\/all$/);
        await expect(page.locator('#sidebar-bookshelf-tree .tree-node.is-active')).toHaveCount(1);
        await expect(treeNode(page, 'all')).toHaveClass(/is-active/);
        await expect(page.locator('#bookshelf .book-item')).toHaveCount(ALL_COUNT);
        await expect.poll(() => historyLength(page)).toBe(before);
    });

    test('ケース2: 開いていない本棚Yが別の端末で削除されても、再読込で読み直した後も本棚Xのまま', async ({ page }) => {
        const hub = seedHub();
        await openXOnDeviceA(page, hub);
        await deleteOnOtherDevice(page, hub, Y.slug);
        const before = await historyLength(page);
        await reloadDeviceA(page);
        await expect(page.locator('#current-bookshelf-title')).toHaveText(X.name);
        await expect(page).toHaveURL(new RegExp(`#/bookshelf/${X.slug}$`));
        await expect(page.locator('#sidebar-bookshelf-tree .tree-node.is-active')).toHaveCount(1);
        await expect(treeNode(page, X.slug)).toHaveClass(/is-active/);
        await expect(page.locator('#bookshelf .book-item')).toHaveCount(X.books.length);
        await expect.poll(() => historyLength(page)).toBe(before);
    });
}

test.describe('PC 幅', () => {
    addCases();
});

test.describe('390 幅 (スマホ)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    addCases();
});
