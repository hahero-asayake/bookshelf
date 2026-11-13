// 門のE2E (イシュー#588)。観測点 J5-3「プレビューできる」。
// 利用者と同じ操作だけで、記事を作って本棚ブロックに本を1冊入れ、「プレビュー」を開くと、公開ページと同じ見た目の
// プレビューに記事の題名と本の書名が見えることを確かめる。
// 書き方の決まりは tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';
import { seedLibraryForTest, bootAppForTest, stubStorageForTest } from '../helpers/gate-setup.js';
import { mockSyncReady } from '../helpers/sync.js';

const TITLE = '門のE2E J5-3 プレビューする記事';
const BOOK_1 = 'フィクスチャの本 1';

const editView = (page) => page.locator('#art-edit-view');
const canvas = (page) => page.frameLocator('#art-canvas-frame');
const drawerBook = (page, title) => page.locator('#art-drawer-list .art-drawer-item', { hasText: title }).first();
const articleBar = (page) => page.getByRole('toolbar', { name: '記事の操作' });
const preview = (page) => page.frameLocator('#pp-preview-frame');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('@gate J5-3 記事に本を置いてプレビューを開くと、題名と本の書名が見える', async ({ page }) => {
    await test.step('前提: 蔵書を入れ、保存先をつないだ状態でアプリを開いておく', async () => {
        await seedLibraryForTest(page);
        await bootAppForTest(page);
        await stubStorageForTest(page);
        await mockSyncReady(page, true);
    });

    await test.step('操作: 本棚の引き出しの「公開」から新しい記事を作り、本棚ブロックに本を1冊入れて「完了」する', async () => {
        await page.locator('[data-mobile-nav="shelves"]').tap();
        await page.locator('#sidebar-publish').tap();
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        await page.locator('#art-new').tap();
        await page.locator('#art-title').fill(TITLE);
        await page.locator('#art-mode-edit').tap();
        await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
        // 挿入ボタンのタップがまれに届かない窓がある (#372・見本 J5-2 と同じ)。シートが開くまでだけやり直す
        await expect(async () => {
            await canvas(page).locator('.art-cv-ins-btn').last().tap();
            await expect(page.locator('#art-add-sheet [data-block-type="shelf"]')).toBeVisible({ timeout: 2000 });
        }).toPass({ timeout: 15000 });
        await page.locator('#art-add-sheet [data-block-type="shelf"]').tap();
        await expect(page.locator('#art-drawer')).toHaveClass(/is-open/);
        await expect(drawerBook(page, BOOK_1)).toBeInViewport();
        await drawerBook(page, BOOK_1).tap();
        await page.locator('#art-fs-done').tap();
        await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
        await articleBar(page).getByRole('button', { name: '完了' }).tap();
        await expect(editView(page)).toHaveAttribute('data-art-mode', 'view');
    });

    await test.step('操作: 「その他の操作」→「表示幅を切り替えて見る」でプレビューを開く', async () => {
        // 見出しの「プレビュー」(#art-preview) は記事の画面では出さない (閲覧の状態そのものが公開ページと同じ見た目・
        // イシュー#268。css/bookshelf.css の #art-edit-view[data-art-mode] #art-preview)。別画面のプレビューの入口は⋯の中
        await page.getByRole('button', { name: 'その他の操作' }).tap();
        await page.getByRole('menuitem', { name: '表示幅を切り替えて見る' }).tap();
        await expect(page.locator('#pp-preview-modal')).toBeVisible();
    });

    await test.step('確認: プレビューに記事の題名と本の書名が見える', async () => {
        await expect(preview(page).locator('body')).toContainText(TITLE, { timeout: 15000 });
        await expect(preview(page).locator('body')).toContainText(BOOK_1);
    });
});
