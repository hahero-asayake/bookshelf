// イシュー#634: 開いている本棚、またはその上の本棚 (親・祖父母) を削除すると、一覧は「すべての本」へ切り替わる。
// 見出し・本の数・ツリーで選択中の行・URL が「すべての本」に揃う。戻る用の履歴は積まない (消えた本棚の段を置き換える)
// ので、削除の後に戻るを1回押すと、本棚を開く前のホームへ戻る (消えた本棚の段を経由しない)。
// 消えない本棚を開いていた時は、そのまま開いたまま。
// 起動は tests/e2e/book-detail-shelf-meta.spec.js と同じ型 (fixture を localStorage に入れる)。本棚を開く・
// ツリーの「…」→ 削除 → 確認ダイアログは画面から行う (390 幅は下部ナビの「本棚」でドロワーを開いてから)。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const ASIN = 'B000000001';
const ALL_NAME = 'すべての本'; // fixture の「すべての本」(id: all) の名前
const ALL_COUNT = JSON.parse(fixtureLibrary).books.length;

// fixture に、親 > 子 > 孫 (どれも本1だけ) と、空の無関係の本棚を足す
async function bootApp(page) {
    await page.addInitScript(([userData, library, asin]) => {
        const ud = JSON.parse(userData);
        ud.bookshelves.push({ id: 'e2e-parent', internalId: 'e2eparent01', name: '親の本棚', iconName: 'library', books: [asin], isSpecial: false, parent: 'fixall001' });
        ud.bookshelves.push({ id: 'e2e-child', internalId: 'e2echild01', name: '子の本棚', iconName: 'library', books: [asin], isSpecial: false, parent: 'e2eparent01' });
        ud.bookshelves.push({ id: 'e2e-grand', internalId: 'e2egrand01', name: '孫の本棚', iconName: 'library', books: [asin], isSpecial: false, parent: 'e2echild01' });
        ud.bookshelves.push({ id: 'e2e-other', internalId: 'e2eother01', name: '無関係の本棚', iconName: 'library', books: [], isSpecial: false, parent: 'fixall001' });
        localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        // 戻るで着いた段の URL を記録する。アプリより先に聞く (アプリが着地の後に URL を置き換える前の値を取る)
        window.__e2eLanded = [];
        window.addEventListener('popstate', () => window.__e2eLanded.push(location.hash));
    }, [fixtureUserData, fixtureLibrary, ASIN]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

const treeNode = (page, slug) => page.locator(`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="${slug}"]`);
const isPhone = (page) => (page.viewportSize()?.width || 1280) < 768;

// 390 幅ではツリーはドロワーの中にある。下部ナビの「本棚」で開く (開いていれば何もしない)
async function showTree(page) {
    if (!isPhone(page)) return;
    if (await page.locator('body.drawer-open').count()) return;
    await page.locator('#mobile-bottom-nav [data-mobile-nav="shelves"]').click();
    await expect(page.locator('body')).toHaveClass(/drawer-open/);
    await expect(treeNode(page, 'all')).toBeVisible();
}

// ツリーの「すべての本」と、渡した本棚 (上から順に書く) が畳まれていれば展開する
async function expandTree(page, ancestors = []) {
    for (const key of ['all', ...ancestors]) {
        const toggle = treeNode(page, key).locator('.tree-toggle');
        await expect(toggle).toBeVisible();
        if (await toggle.getAttribute('title') === '展開') await toggle.click();
    }
}

async function openShelf(page, slug, ancestors = []) {
    await showTree(page);
    await expandTree(page, ancestors);
    await treeNode(page, slug).click();
    await expect(page).toHaveURL(new RegExp(`#/bookshelf/${slug}$`));
    await expect(page.locator('body')).not.toHaveClass(/drawer-open/);
}

async function deleteShelf(page, slug, ancestors = []) {
    await showTree(page);
    await expandTree(page, ancestors);
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

// 一覧が「すべての本」を開いた見え方になっている (見出し・本の数・ツリーで選択中の行・URL)
async function expectAllShelf(page) {
    await expect(page.locator('#current-bookshelf-title')).toHaveText(ALL_NAME);
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(ALL_COUNT);
    await expect(page.locator('#sidebar-bookshelf-tree .tree-node.is-active')).toHaveCount(1);
    await expect(treeNode(page, 'all')).toHaveClass(/is-active/);
    await expect(page).toHaveURL(/#\/bookshelf\/all$/);
}

// 削除の後に戻るを1回押すと、本棚を開く前のホームへ戻る。消えた本棚の段に一度着いてからホームへ飛ばされるのではない
// (着いた段がホームの1つだけ)。削除の後の切り替えは履歴を積まず、390 幅ではドロワーを開いた分の段も残さない
async function expectBackToHome(page) {
    await page.evaluate(() => { window.__e2eLanded = []; });
    await page.goBack();
    await expect(page.locator('body')).toHaveClass(/app-view-main/);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
    expect(await page.evaluate(() => window.__e2eLanded)).toEqual(['']);
}

function addCases() {
    test('A: 開いている本棚そのものを削除すると「すべての本」に揃い、戻るでホームへ戻る', async ({ page }) => {
        await bootApp(page);
        await openShelf(page, 'e2e-other');
        await deleteShelf(page, 'e2e-other');
        await expectAllShelf(page);
        await expectBackToHome(page);
    });

    test('B: 子の本棚を開いたまま親を削除すると、子も消えて「すべての本」に揃い、戻るでホームへ戻る', async ({ page }) => {
        await bootApp(page);
        await openShelf(page, 'e2e-child', ['e2e-parent']);
        await expect(page.locator('#current-bookshelf-title')).toHaveText('子の本棚');
        await expect(page.locator('#bookshelf .book-item')).toHaveCount(1);
        await deleteShelf(page, 'e2e-parent');
        await expect(treeNode(page, 'e2e-child')).toHaveCount(0);
        await expectAllShelf(page);
        await expectBackToHome(page);
    });

    test('C: 孫の本棚を開いたまま親を削除すると「すべての本」に揃う', async ({ page }) => {
        await bootApp(page);
        await openShelf(page, 'e2e-grand', ['e2e-parent', 'e2e-child']);
        await expect(page.locator('#current-bookshelf-title')).toHaveText('孫の本棚');
        await deleteShelf(page, 'e2e-parent');
        await expect(treeNode(page, 'e2e-grand')).toHaveCount(0);
        await expectAllShelf(page);
    });

    test('D: 無関係の本棚を開いたまま親を削除しても、開いている本棚はそのまま', async ({ page }) => {
        await bootApp(page);
        await openShelf(page, 'e2e-other');
        await deleteShelf(page, 'e2e-parent');
        await expect(page.locator('#current-bookshelf-title')).toHaveText('無関係の本棚');
        await expect(page.locator('#bookshelf .book-item')).toHaveCount(0);
        await expect(treeNode(page, 'e2e-other')).toHaveClass(/is-active/);
        await expect(page).toHaveURL(/#\/bookshelf\/e2e-other$/);
    });
}

test.describe('PC 幅', () => {
    addCases();
});

test.describe('390 幅 (スマホ)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    addCases();
});
