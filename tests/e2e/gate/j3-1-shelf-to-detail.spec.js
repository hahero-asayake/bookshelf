// 門のE2E (イシュー#590)。観測点 J3-1「本棚→本の詳細」。
// 左の本棚ツリーから本棚を開き、一覧の本を押すと、右の詳細に書名と著者が見えることを確かめる。
// 書き方は tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { seedLibraryForTest, bootAppForTest, stubStorageForTest } from '../helpers/gate-setup.js';

const listItems = (page) => page.locator('#bookshelf .book-item');
const detail = (page) => page.locator('#book-detail-pane');

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J3-1 本棚「すべての本」を開いて本を押すと、詳細に書名と著者が見える', async ({ page }) => {
    await test.step('前提: 蔵書を入れた状態でアプリを開いておく', async () => {
        await seedLibraryForTest(page);
        await bootAppForTest(page);
        await stubStorageForTest(page);
    });

    await test.step('操作: 左の本棚ツリーの「すべての本」を押す', async () => {
        await page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-label').click();
    });

    await test.step('確認: 本棚の一覧に本が並ぶ', async () => {
        await expect(page).toHaveURL(/#\/bookshelf\/all$/);
        await expect(listItems(page)).toHaveCount(5);
    });

    await test.step('操作: 一覧の「フィクスチャの本 3」を押す', async () => {
        await listItems(page).filter({ hasText: 'フィクスチャの本 3' }).click();
    });

    await test.step('確認: 詳細に書名と著者が見え、URL がその本になる', async () => {
        await expect(detail(page)).toContainText('フィクスチャの本 3');
        await expect(detail(page)).toContainText('著者B');
        await expect(page).toHaveURL(/#book\/B000000003$/);
    });
});
