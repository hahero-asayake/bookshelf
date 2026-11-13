// 門のE2E (イシュー#590)。観測点 J3-2「本棚を作って本を入れる」。
// 左の本棚ツリーの「本棚を追加」(+) から本棚を作り、一覧の複数選択 →「本棚に追加」で本を入れると、
// その本棚を開いた時に本が見えることを、内部から開かずに確かめる (G-5)。書き方は tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { seedLibraryForTest, bootAppForTest, stubStorageForTest } from '../helpers/gate-setup.js';

const SHELF = '門の本棚';
const tree = (page) => page.locator('#sidebar-bookshelf-tree');
const listItems = (page) => page.locator('#bookshelf .book-item');

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J3-2 「本棚を追加」で本棚を作り、複数選択の「本棚に追加」で本を入れると、その本棚に本が見える', async ({ page }) => {
    await test.step('前提: 蔵書を入れた状態でアプリを開いておく', async () => {
        await seedLibraryForTest(page);
        await bootAppForTest(page);
        await stubStorageForTest(page);
    });

    await test.step('操作: 左の本棚ツリーの「本棚を追加」を押し、名前を入れて保存する', async () => {
        await page.locator('#sidebar-add-bookshelf').click();
        await expect(page.locator('#bookshelf-name')).toBeVisible();
        await page.locator('#bookshelf-name').fill(SHELF);
        await page.locator('#save-bookshelf-form').click();
    });

    await test.step('操作: 本棚ツリーの「すべての本」の開閉ボタンを押して、下の本棚を開く', async () => {
        await tree(page).locator('[data-bookshelf-id="all"] .tree-toggle').click();
    });

    await test.step('確認: 本棚ツリーに新しい本棚が出る (0冊)', async () => {
        await expect(tree(page).locator('.tree-node', { hasText: SHELF })).toHaveCount(1);
        await expect(tree(page).locator('.tree-node', { hasText: SHELF }).locator('.bsr-count')).toHaveText('0');
    });

    await test.step('操作: 「すべての本」を開き、複数選択で2冊を選んで「本棚に追加」→ 新しい本棚を押す', async () => {
        await tree(page).locator('[data-bookshelf-id="all"] .bsr-label').click();
        await expect(listItems(page)).toHaveCount(5);
        await page.locator('#toggle-select-mode').click();
        await listItems(page).filter({ hasText: 'フィクスチャの本 2' }).click();
        await listItems(page).filter({ hasText: 'フィクスチャの本 4' }).click();
        await expect(page.locator('#bulk-count')).toHaveText('2 冊選択中');
        await page.locator('#bulk-add-shelf').click();
        await page.locator('#bulk-shelf-list').getByText(SHELF).click();
    });

    await test.step('確認: 2冊を追加したと知らせが出る', async () => {
        await expect(page.locator('.toast', { hasText: `2 冊を「${SHELF}」に追加しました` })).toBeVisible();
    });

    await test.step('操作: 本棚ツリーの新しい本棚を押す', async () => {
        await page.locator('#toggle-select-mode').click();
        await tree(page).locator('.tree-node', { hasText: SHELF }).locator('.bsr-label').click();
    });

    await test.step('確認: 新しい本棚に、入れた2冊だけが見える', async () => {
        await expect(listItems(page)).toHaveCount(2);
        await expect(listItems(page).filter({ hasText: 'フィクスチャの本 2' })).toHaveCount(1);
        await expect(listItems(page).filter({ hasText: 'フィクスチャの本 4' })).toHaveCount(1);
        await expect(tree(page).locator('.tree-node', { hasText: SHELF }).locator('.bsr-count')).toHaveText('2');
    });
});
