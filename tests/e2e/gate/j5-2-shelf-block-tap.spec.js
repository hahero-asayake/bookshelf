// 門のE2E の見本 (イシュー#583)。観測点 J5-2「本と本棚を置ける」。
// 利用者と同じ操作 (タップ・入力) だけで、記事に本棚ブロックを置き、キャンバスのブロックをタップして本を足せることを
// 確かめる。#580 で直した動き (本の入った本棚ブロックをタップすると編集が開く) を、内部を呼ばずに通す。
// 書き方の決まり (前提/操作/確認の区間・許すもの・禁止のもの) は tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';
import { seedLibraryForTest, bootAppForTest, stubStorageForTest } from '../helpers/gate-setup.js';
import { mockSyncReady } from '../helpers/sync.js';

const BOOK_1 = 'フィクスチャの本 1';
const BOOK_2 = 'フィクスチャの本 2';

const editView = (page) => page.locator('#art-edit-view');
const canvas = (page) => page.frameLocator('#art-canvas-frame');
const shelfBlock = (page) => canvas(page).locator('section.art-cv-blk').first();
const drawerBook = (page, title) => page.locator('#art-drawer-list .art-drawer-item', { hasText: title }).first();

// 開いている引き出しの本を1冊タップして「完了」する
async function pickBookAndFinish(page, title) {
    await expect(page.locator('#art-drawer')).toHaveClass(/is-open/);
    await expect(drawerBook(page, title)).toBeInViewport();
    await drawerBook(page, title).tap();
    await page.locator('#art-fs-done').tap();
    await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('@gate J5-2 記事に本棚ブロックを置き、キャンバスのブロックをタップして本を足せる', async ({ page }) => {
    await test.step('前提: 蔵書を入れ、保存先をつないだ状態でアプリを開いておく', async () => {
        await seedLibraryForTest(page);
        await bootAppForTest(page);
        await stubStorageForTest(page);
        await mockSyncReady(page, true);
    });

    await test.step('操作: 本棚の引き出しの「公開」から、新しい記事を作る', async () => {
        await page.locator('[data-mobile-nav="shelves"]').tap();
        await page.locator('#sidebar-publish').tap();
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        await page.locator('#art-new').tap();
        await page.locator('#art-title').fill('門のE2Eの見本');
        await page.locator('#art-mode-edit').tap();
        await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
    });

    await test.step('操作: 挿入ボタンから本棚ブロックを足し、開いた引き出しの本を1冊入れる', async () => {
        // 挿入ボタンのタップがまれに届かない窓がある (#372)。シートが開くまでだけやり直し、項目のタップは1回だけ行う
        await expect(async () => {
            await canvas(page).locator('.art-cv-ins-btn').last().tap();
            await expect(page.locator('#art-add-sheet [data-block-type="shelf"]')).toBeVisible({ timeout: 2000 });
        }).toPass({ timeout: 15000 });
        await page.locator('#art-add-sheet [data-block-type="shelf"]').tap();
        await expect(editView(page)).toHaveAttribute('data-art-mode', 'form');
        // 本棚ブロックを足した直後は、引き出しが開いたままになっている (#529)
        await pickBookAndFinish(page, BOOK_1);
    });

    await test.step('確認: キャンバスの本棚ブロックに1冊目の書名が見える', async () => {
        await expect(shelfBlock(page)).toContainText(BOOK_1);
    });

    await test.step('操作: キャンバスの本棚ブロックをタップし、「本を追加」からもう1冊入れる', async () => {
        // ブロックの右側の余白をタップする (1冊だけの本棚は右側が空いている)。#580 で直した入口
        const box = await shelfBlock(page).boundingBox();
        await shelfBlock(page).tap({ position: { x: Math.round(box.width - 24), y: Math.round(box.height / 2) } });
        await expect(editView(page)).toHaveAttribute('data-art-mode', 'form');
        await page.locator('#art-edit-view .art-shelf-add:visible').first().tap();
        await pickBookAndFinish(page, BOOK_2);
    });

    await test.step('確認: キャンバスの本棚ブロックに2冊の書名が見える', async () => {
        await expect(shelfBlock(page)).toContainText(BOOK_1);
        await expect(shelfBlock(page)).toContainText(BOOK_2);
    });
});
