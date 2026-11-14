// 門のE2E (イシュー#588)。観測点 J5-1「入口のボタンから作れる」。
// 利用者と同じ入口 (下のナビ「本棚」→ 引き出しの「公開」→「新規作成」) から記事を作り、題名を入れて
// 「記事の一覧」で戻ると、その題名の記事が一覧に並ぶことを確かめる。直リンク (index.html#/publish) は使わない。
// 書き方の決まり (前提/操作/確認の区間・許すもの・禁止のもの) は tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';
import { seedLibraryForTest, bootAppForTest, stubStorageForTest } from '../helpers/gate-setup.js';
import { mockSyncReady } from '../helpers/sync.js';

const TITLE = '門のE2E J5-1 の記事';

const articleRow = (page, title) => page.locator('#art-list .pp-row', { hasText: title });

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('@gate J5-1 入口のボタンから記事を作り、題名を入れて一覧へ戻ると一覧に並ぶ', async ({ page }) => {
    await test.step('前提: 蔵書を入れ、保存先をつないだ状態でアプリを開いておく', async () => {
        await seedLibraryForTest(page);
        await bootAppForTest(page);
        await stubStorageForTest(page);
        await mockSyncReady(page, true);
    });

    await test.step('操作: 下のナビ「本棚」→ 引き出しの「公開」で記事の一覧を開く', async () => {
        await page.locator('[data-mobile-nav="shelves"]').tap();
        await page.locator('#sidebar-publish').tap();
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    });

    await test.step('確認: その題名の記事はまだ無く、「新規作成」が押せる', async () => {
        await expect(page.locator('#art-list-view')).toBeVisible();
        await expect(articleRow(page, TITLE)).toHaveCount(0);
        await expect(page.locator('#art-new')).toBeEnabled();
    });

    await test.step('操作: 「新規作成」を押して題名を入れ、「記事の一覧」で戻る', async () => {
        await page.locator('#art-new').tap();
        await expect(page.locator('#art-edit-view')).toBeVisible();
        await page.locator('#art-title').fill(TITLE);
        await page.locator('#art-back').tap();
        await expect(page.locator('#art-list-view')).toBeVisible();
    });

    await test.step('確認: 一覧にその題名の記事が1件並び、「○ 未公開」と出る', async () => {
        await expect(articleRow(page, TITLE)).toHaveCount(1);
        await expect(articleRow(page, TITLE)).toContainText('○ 未公開');
    });
});
