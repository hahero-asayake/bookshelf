// 門のE2E: J8 オフライン (イシュー#589)。Service Worker を動かし、電波なし (context.setOffline) で確かめる。
// 書き方の決まりは tests/e2e/gate/README.md。前提は helpers/gate-offline.js (SW を動かす実行の前提)。
// webkit (gate-webkit) では流さない: Playwright の WebKit は、電波なしの間は SW のキャッシュからも読めない
// (最小の SW でも再読込が「WebKit encountered an internal error」になる・step2 で実測)。iPhone の電波なしは人の実機 H1 で見る。
import { test, expect } from '../helpers/test-base.js';
import { seedLibraryOnceForTest, openAppForTest, reopenAppForTest } from '../helpers/gate-offline.js';

const BOOK_ASIN = 'B000000002';
const BOOK_TITLE = 'フィクスチャの本 2';
const MEMO = '電波なしで書いた短文メモ';

const bookItem = (page) => page.locator(`#bookshelf .book-item[data-asin="${BOOK_ASIN}"]`).first();
const memoBox = (page) => page.locator('#bd-sections .note-textarea').first();

// 下のナビの「本棚」→「すべての本」→ 本をタップして、本の詳細を開く (利用者の操作だけ)
async function tapToBookDetail(page) {
    await page.locator('[data-mobile-nav="shelves"]').tap();
    await page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: 'すべての本' }).first().tap();
    await bookItem(page).tap();
    await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'allow' });

test('@gate J8-1 1回開いただけの端末でも、電波なしで開き直すとアプリが起動する', async ({ page, context }) => {
    await test.step('前提: 電波がある時に、アプリを1回だけ開いておく', async () => {
        await seedLibraryOnceForTest(page);
        await openAppForTest(page);
    });

    await test.step('操作: 電波を切って、アプリを開き直す', async () => {
        await context.setOffline(true);
        await page.reload();
    });

    await test.step('確認: アプリの画面 (下のナビ) が出る', async () => {
        await expect(page).toHaveTitle(/AsayakeBookshelf/);
        await expect(page.locator('[data-mobile-nav="shelves"]')).toBeVisible();
    });
});

// J8-1 の ID はここに付けない = 1回開いただけの端末 (上の J8-1) が赤の間に、この緑で J8-1 が埋まって見えないようにする
test('@gate J8-2 2回開いた端末は、電波なしで起動し、本棚から本の詳細を開ける', async ({ page, context }) => {
    await test.step('前提: 電波がある時に、アプリを2回開いておく', async () => {
        await seedLibraryOnceForTest(page);
        await openAppForTest(page);
        await reopenAppForTest(page);
    });

    await test.step('操作: 電波を切って、アプリを開き直す', async () => {
        await context.setOffline(true);
        await page.reload();
    });

    await test.step('確認: アプリの画面 (下のナビ) が出る', async () => {
        await expect(page.locator('[data-mobile-nav="shelves"]')).toBeVisible();
    });

    await test.step('操作: 下のナビの「本棚」から「すべての本」を開き、本をタップする', async () => {
        await tapToBookDetail(page);
    });

    await test.step('確認: 本の詳細に書名が見える', async () => {
        await expect(page.locator('#book-detail-pane .bd-title')).toHaveText(BOOK_TITLE);
    });
});

test('@gate J8-3 電波なしで書いた短文メモは、電波なしのまま開き直しても残っている', async ({ page, context }) => {
    await test.step('前提: 電波がある時に、アプリを2回開いておく', async () => {
        await seedLibraryOnceForTest(page);
        await openAppForTest(page);
        await reopenAppForTest(page);
    });

    await test.step('操作: 電波を切り、本の詳細で短文メモを書いて、保存の表示を待つ', async () => {
        await context.setOffline(true);
        await tapToBookDetail(page);
        await memoBox(page).fill(MEMO);
        await expect(page.locator(`.save-note-status[data-asin="${BOOK_ASIN}"]`)).toHaveText('保存しました');
    });

    // 本の詳細は URL (#book/<asin>) に載っているので、開き直すと同じ本の詳細が開いた状態で戻る (step2 の1回目で実測)
    await test.step('操作: 電波なしのまま、アプリを開き直す', async () => {
        await page.reload();
    });

    await test.step('確認: 同じ本の詳細に、書いた短文メモが残っている', async () => {
        await expect(page.locator('#book-detail-pane .bd-title')).toHaveText(BOOK_TITLE);
        await expect(memoBox(page)).toHaveValue(MEMO);
    });
});
