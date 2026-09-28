// 本棚を開く経路のリグレッション (イシュー#259)。
//
// 原因: スマホ幅でサイドバー(ドロワー)や⌘Kパレットを開いたまま本棚を選ぶと、それらを閉じる
// _closeDrawer/_closePalette が予約する history.back() (_modalHistPop、物理戻るボタンでモーダルを
// 閉じる仕組み) が非同期に処理される一方、switchBookshelf() の router.navigateBookshelf() が
// 同期的に location.hash へ新しい履歴エントリを積む。両者の実行順序がブラウザ/端末の速度依存で
// 確定しないため、back() が「本棚を開いた直後の履歴」を巻き戻し、表示だけホームへ戻ってしまう
// ことがあった (window.bookshelf.currentBookshelf 自体は正しく更新されるため気づきにくい)。
// PC幅はドロワー/パレットの履歴を積まないため元々無関係 (js/bookshelf.js switchBookshelf 参照)。
//
// 修正 (②差し戻し 2026-09-29): setTimeout 等の時間待ちに頼らず、back() 自体を呼ばせない。
// 開いていたドロワー/パレットの履歴エントリをそのまま本棚のハッシュへ replaceState で書き換える
// (履歴の深さを変えない=戻るを1回押せば元のホームへ戻れる)。
//
// 本棚が「すべての本」1つだけの空データでは、開いた本棚名が表示に残るかを区別できない
// (どの経路でも表示は同じ「すべての本」になりうる) ため、親子3階層のデータで
// 子本棚を明示的に開き、その名前がヘッダに残ることを見る。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

// 本棚3つ(all + 親 + 子)・親子階層あり。空データ(all 1つのみ)では成立しない条件を作るための最小データ。
const userData = {
    bookshelves: [
        { id: 'all', internalId: 'op-all-01', name: 'すべての本', iconName: 'library', description: '', isSpecial: true, books: ['B000000001', 'B000000002', 'B000000003'], notes: {} },
        { id: 'op-parent', internalId: 'op-parent-01', name: '親本棚', iconName: 'library', description: '', parent: 'op-all-01', isPublic: false, books: ['B000000001', 'B000000002'], notes: {}, createdAt: '2026-06-12T00:00:00.000Z' },
        { id: 'op-child', internalId: 'op-child-01', name: '子本棚オープン検証', iconName: 'library', description: '', parent: 'op-parent-01', isPublic: false, books: ['B000000001'], notes: {}, createdAt: '2026-06-12T00:00:01.000Z' },
    ],
    notes: {},
    settings: { version: '2.0', defaultView: 'covers', coverSize: 'medium', sortOrder: 'custom', disabledPlugins: [] },
    bookOrder: {},
    stats: { totalBooks: 3, notesCount: 0 },
    version: '2.0',
    _storage: { allInternalId: 'op-all-01', exclusions: [] }
};
const CHILD_NAME = '子本棚オープン検証';
const PARENT_NAME = '親本棚';

async function bootApp(page, { viewport } = {}) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    if (viewport) await page.setViewportSize(viewport);
    await page.addInitScript(([ud, lib]) => {
        localStorage.setItem('virtualBookshelf_userData', ud);
        localStorage.setItem('virtualBookshelf_library', lib);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        // サイドバーツリーの展開状態: 未展開だと子本棚がツリーに現れない仕様 (js/bookshelf.js
        // _renderSidebarTree、roots は byParent.get(null) から辿る)。実ユーザーは前回セッションで
        // 展開済みのため、fixture でも明示的に展開状態を再現する。
        localStorage.setItem('bookshelf_treeExpanded_v1', JSON.stringify(['op-all-01', 'op-parent-01']));
    }, [JSON.stringify(userData), fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

async function expectShelfOpenAndStays(page, name) {
    // 直後(popstate/hashchange等)に表示が巻き戻らず保持されることを見る
    await expect(page.locator('#current-bookshelf-title')).toHaveText(name, { timeout: 5000 });
    await page.waitForTimeout(400);
    await expect(page.locator('body')).toHaveClass(/app-view-bookshelf/);
    await expect(page.locator('#current-bookshelf-title')).toHaveText(name);
}

test.describe('本棚を開く経路 (PC幅・回帰)', () => {
    test('サイドバーから子本棚を開く (PC)', async ({ page }) => {
        const errors = await bootApp(page, { viewport: { width: 1280, height: 800 } });
        await page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: CHILD_NAME }).click();
        await expectShelfOpenAndStays(page, CHILD_NAME);
        expect(errors).toEqual([]);
    });

    test('⌘K(Ctrl+K)から子本棚を開く (PC)', async ({ page }) => {
        const errors = await bootApp(page, { viewport: { width: 1280, height: 800 } });
        await page.keyboard.press('Control+k');
        await expect(page.locator('#cmdk-backdrop')).toBeVisible();
        await page.locator('#cmdk-input').fill(CHILD_NAME);
        await page.waitForTimeout(150);
        await page.keyboard.press('Enter');
        await expectShelfOpenAndStays(page, CHILD_NAME);
        expect(errors).toEqual([]);
    });

    test('ホームの本棚カードから本棚を開く (PC)', async ({ page }) => {
        const errors = await bootApp(page, { viewport: { width: 1280, height: 800 } });
        await page.locator('.bookshelf-preview[data-bookshelf-id="op-parent"]').scrollIntoViewIfNeeded();
        await page.locator('.bookshelf-preview[data-bookshelf-id="op-parent"]').click();
        await expectShelfOpenAndStays(page, PARENT_NAME);
        expect(errors).toEqual([]);
    });
});

test.describe('本棚を開く経路 (スマホ幅・イシュー#259の本命)', () => {
    test('サイドバー(ドロワー)から子本棚を開いても表示が残る (SP)', async ({ page }) => {
        const errors = await bootApp(page, { viewport: { width: 390, height: 844 } });
        await page.locator('[data-mobile-nav="shelves"]').click();
        await expect(page.locator('body')).toHaveClass(/drawer-open/);
        await page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: CHILD_NAME }).click();
        await expectShelfOpenAndStays(page, CHILD_NAME);
        expect(errors).toEqual([]);
    });

    test('⌘K(Ctrl+K)から本棚を開いても表示が残る (SP)', async ({ page }) => {
        const errors = await bootApp(page, { viewport: { width: 390, height: 844 } });
        await page.keyboard.press('Control+k');
        await expect(page.locator('#cmdk-backdrop')).toBeVisible();
        await page.locator('#cmdk-input').fill(CHILD_NAME);
        await page.waitForTimeout(150);
        await page.keyboard.press('Enter');
        await expectShelfOpenAndStays(page, CHILD_NAME);
        expect(errors).toEqual([]);
    });

    // ②差し戻し: setTimeout(0)は実機の遅い端末で順序保証がないため不採用にした。
    // CPUを重くしても(=タイマー/イベントの処理が遅延しても)back()自体を呼ばない実装なら
    // 競合しないはずのことを、CDPのCPUスロットリングで裏付ける。
    test('CPU 4倍スロットリング下でもサイドバー/⌘Kから本棚を開いても表示が残る (SP)', async ({ page, context }) => {
        const errors = await bootApp(page, { viewport: { width: 390, height: 844 } });
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        try {
            await page.locator('[data-mobile-nav="shelves"]').click();
            await page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: CHILD_NAME }).click();
            await expectShelfOpenAndStays(page, CHILD_NAME);

            await page.evaluate(() => window.bookshelf.router.navigateMain());
            await page.waitForTimeout(100);
            await page.keyboard.press('Control+k');
            await expect(page.locator('#cmdk-backdrop')).toBeVisible();
            await page.locator('#cmdk-input').fill(CHILD_NAME);
            await page.waitForTimeout(150);
            await page.keyboard.press('Enter');
            await expectShelfOpenAndStays(page, CHILD_NAME);
        } finally {
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        }
        expect(errors).toEqual([]);
    });

    test('ドロワーから本棚を開いた後、ブラウザの戻るを1回押すとホームへ戻る (SP)', async ({ page }) => {
        const errors = await bootApp(page, { viewport: { width: 390, height: 844 } });
        await page.locator('[data-mobile-nav="shelves"]').click();
        await page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: CHILD_NAME }).click();
        await expectShelfOpenAndStays(page, CHILD_NAME);

        await page.goBack();
        await expect(page.locator('body')).toHaveClass(/app-view-main/, { timeout: 3000 });
        expect(errors).toEqual([]);
    });

    test('⌘Kから本棚を開いた後、ブラウザの戻るを1回押すとホームへ戻る (SP)', async ({ page }) => {
        const errors = await bootApp(page, { viewport: { width: 390, height: 844 } });
        await page.keyboard.press('Control+k');
        await expect(page.locator('#cmdk-backdrop')).toBeVisible();
        await page.locator('#cmdk-input').fill(CHILD_NAME);
        await page.waitForTimeout(150);
        await page.keyboard.press('Enter');
        await expectShelfOpenAndStays(page, CHILD_NAME);

        await page.goBack();
        await expect(page.locator('body')).toHaveClass(/app-view-main/, { timeout: 3000 });
        expect(errors).toEqual([]);
    });
});
