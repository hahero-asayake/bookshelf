// 門のE2E (イシュー#590)。観測点 J2-5「二度押し・再取込で重複しない」。数値 (件数) で判定する。
// 「選択した本を取り込む」を二度押ししても、同じ取込データをもう一度取り込んでも、本棚 (すべての本) の冊数が
// 取込データの冊数 N=3 のまま (重複0件) であることを、画面の冊数の表示と一覧の件数で確かめる。
// 書き方は tests/e2e/gate/README.md。
import { readFileSync } from 'node:fs';
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { stubFolderPickerForTest, connectLocalFolderForTest } from '../helpers/gate-local.js';

const EXPORT_JSON = readFileSync(new URL('../../fixtures/gate-kindle-export.json', import.meta.url), 'utf-8');
const N = 3;
const allShelf = (page) => page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"]');
const listItems = (page) => page.locator('#bookshelf .book-item');

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J2-5 「選択した本を取り込む」の二度押しと、同じデータの再取込で、冊数が N=3 のまま (重複0件)', async ({ page }) => {
    await test.step('前提: 空のフォルダを保存先につないだ状態でアプリを開いておく', async () => {
        await stubFolderPickerForTest(page, 'gate-j2-5');
        await bootAppForTest(page);
        await connectLocalFolderForTest(page);
    });

    await test.step('操作: ホームの案内から取込の画面を開き、取込データを貼って、全て選択して「選択した本を取り込む」を二度押しする', async () => {
        await page.locator('#dashboard-welcome button[data-dw="import"]').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await page.locator('[data-import-action="open-paste"]').click();
        await page.locator('#kindle-paste-input').fill(EXPORT_JSON);
        await page.locator('#import-from-paste').click();
        await expect(page.locator('#book-list .book-selection-item')).toHaveCount(N);
        await page.locator('#select-all-books').click();
        await page.locator('#import-selected-books').dblclick();
        await expect(page.locator('#import-results')).toContainText('取込結果');
        await page.keyboard.press('Escape');
        await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
        await allShelf(page).locator('.bsr-label').click();
    });

    await test.step('確認: 二度押しのあと、冊数の表示も一覧の件数も N=3', async () => {
        await expect(allShelf(page).locator('.bsr-count')).toHaveText(String(N));
        await expect(listItems(page)).toHaveCount(N);
    });

    await test.step('操作: 設定の「蔵書」→「Kindleの本を取り込む」から、同じ取込データをもう一度貼って取り込む', async () => {
        await page.locator('#sidebar-settings').click();
        await page.locator('#settings-master .settings-cat[data-cat="library-section"]').click();
        await page.locator('#import-kindle').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await page.locator('[data-import-action="open-paste"]').click();
        await page.locator('#kindle-paste-input').fill(EXPORT_JSON);
        await page.locator('#import-from-paste').click();
        await expect(page.locator('#book-selection')).toBeVisible();
        await page.locator('#select-all-books').click();
        await page.locator('#import-selected-books').click();
        await expect(page.locator('#import-results')).toContainText('取込結果');
    });

    await test.step('確認: 再取込の取込結果は「新規追加 0」', async () => {
        await expect(page.locator('#import-results .stat-value.success')).toHaveText('0');
    });

    await test.step('操作: 再読込して (保存された中身を読み直す)、左の「すべての本」を開く', async () => {
        // 取込の直後 (1秒以内) に再読込すると、冊数が 0 になる (#622・既知の赤)。待ちを足して通すことはしない
        await page.reload();
        await expect(allShelf(page)).toBeVisible();
        await allShelf(page).locator('.bsr-label').click();
    });

    await test.step('確認: 再取込・再読込のあとも、冊数の表示も一覧の件数も N=3', async () => {
        await expect(allShelf(page).locator('.bsr-count')).toHaveText(String(N));
        await expect(listItems(page)).toHaveCount(N);
    });
});
