// 門のE2E (イシュー#590)。観測点 J2-3「ファイルで増える」。
// 取込の画面で取込データのファイル (tests/fixtures/gate-kindle-export.json) を選んで取り込むと、本棚の冊数が増えて
// 一覧に書名が出ることを確かめる。書き方は tests/e2e/gate/README.md。
import { fileURLToPath } from 'node:url';
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { stubFolderPickerForTest, connectLocalFolderForTest } from '../helpers/gate-local.js';

const EXPORT_FILE = fileURLToPath(new URL('../../fixtures/gate-kindle-export.json', import.meta.url));
const TITLES = ['門の取込の本 1', '門の取込の本 2', '門の取込の本 3'];
const allShelf = (page) => page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"]');
const listItems = (page) => page.locator('#bookshelf .book-item');

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J2-3 取込データのファイルを選んで取り込むと、本棚の冊数が増え、一覧に書名が見える', async ({ page }) => {
    await test.step('前提: 空のフォルダを保存先につないだ状態でアプリを開いておく', async () => {
        await stubFolderPickerForTest(page, 'gate-j2-3');
        await bootAppForTest(page);
        await connectLocalFolderForTest(page);
    });

    await test.step('操作: ホームの案内から取込の画面を開き、「ファイルを選ぶ」で取込データを選んで「ファイルから取り込む」→ 全て選択 →「選択した本を取り込む」', async () => {
        await page.locator('#dashboard-welcome button[data-dw="import"]').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        const chooser = page.waitForEvent('filechooser');
        await page.locator('label[for="kindle-file-input"]').click();
        await (await chooser).setFiles(EXPORT_FILE);
        await expect(page.locator('#kindle-file-name')).toHaveText('gate-kindle-export.json');
        await page.locator('#import-from-file').click();
        await expect(page.locator('#book-list .book-selection-item')).toHaveCount(3);
        await page.locator('#select-all-books').click();
        await page.locator('#import-selected-books').click();
    });

    await test.step('確認: 取込結果に「新規追加 3」が出る', async () => {
        await expect(page.locator('#import-results .stat-value.success')).toHaveText('3');
    });

    await test.step('操作: 取込の画面を閉じ、左の「すべての本」を開く', async () => {
        await page.keyboard.press('Escape');
        await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
        await allShelf(page).locator('.bsr-label').click();
    });

    await test.step('確認: 本棚の冊数が3になり、一覧に3冊の書名が見える', async () => {
        // 取込の直後は、左の「すべての本」の冊数がアプリの不具合で 0 のまま (#590 不具合2・再読込で直る)。
        // ほかの確かめも続けて見るため、この1つだけ expect.soft にする (外れればテストは赤)
        await expect.soft(allShelf(page).locator('.bsr-count')).toHaveText('3');
        await expect(listItems(page)).toHaveCount(3);
        for (const t of TITLES) await expect(listItems(page).filter({ hasText: t })).toHaveCount(1);
    });
});
