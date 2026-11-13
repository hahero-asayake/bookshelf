// 門のE2E (イシュー#590)。観測点 J2-4「ブックマークレットで増える」。
// 取込の画面の「Amazon を開く」で開いた Amazon の蔵書一覧 (模擬) で取込ブックマークを押すと、アプリに本の選択が
// 出て、取り込むと本棚の冊数が増えることを確かめる。模擬するのは Amazon 側の応答だけで (helpers/gate-amazon.js)、
// 取込ブックマークの中身 (アプリが作る本物)・アプリへの受け渡し (window.opener への postMessage) は本物が通る。
// 書き方は tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { stubFolderPickerForTest, connectLocalFolderForTest } from '../helpers/gate-local.js';
import { mockAmazonLibraryForTest } from '../helpers/gate-amazon.js';

const AMAZON_ITEMS = [
    { title: 'ブックマークの本 1', authors: '印 一子', acquiredTime: 1700000005000, readStatus: 'READ', asin: 'B0GATEBML1', productImage: '' },
    { title: 'ブックマークの本 2', authors: '印 二子', acquiredTime: 1700000004000, readStatus: 'UNKNOWN', asin: 'B0GATEBML2', productImage: '' }
];
const allShelf = (page) => page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"]');
const listItems = (page) => page.locator('#bookshelf .book-item');

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J2-4 Amazon の蔵書一覧で取込ブックマークを押すと、アプリに本の選択が出て、取り込むと本棚の冊数が増える', async ({ page }) => {
    await test.step('前提: Amazon 側の応答を模擬し、空のフォルダを保存先につないだ状態でアプリを開いておく', async () => {
        await mockAmazonLibraryForTest(page, AMAZON_ITEMS);
        await stubFolderPickerForTest(page, 'gate-j2-4');
        await bootAppForTest(page);
        await connectLocalFolderForTest(page);
    });

    await test.step('操作: ホームの案内から取込の画面を開き、「Amazon を開く」を押して、開いた蔵書一覧で取込ブックマークを押す', async () => {
        await page.locator('#dashboard-welcome button[data-dw="import"]').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        const popup = page.waitForEvent('popup');
        await page.locator('#open-amazon-for-import').click();
        const amazon = await popup;
        await expect(page.locator('#import-relay-status')).toBeVisible();
        await amazon.locator('#gate-bookmarklet').click();
    });

    await test.step('確認: アプリに本の選択が出て、Amazon の2冊が並ぶ', async () => {
        await expect(page.locator('#book-selection')).toBeVisible();
        await expect(page.locator('#book-list .book-selection-item')).toHaveCount(2);
        await expect(page.locator('#book-list')).toContainText('ブックマークの本 1');
    });

    await test.step('操作: 全て選択して「選択した本を取り込む」を押し、取込の画面を閉じて「すべての本」を開く', async () => {
        await page.locator('#select-all-books').click();
        await page.locator('#import-selected-books').click();
        await expect(page.locator('#import-results .stat-value.success')).toHaveText('2');
        await page.keyboard.press('Escape');
        await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
        await allShelf(page).locator('.bsr-label').click();
    });

    await test.step('確認: 本棚の冊数が2になり、一覧に2冊の書名が見える', async () => {
        // 取込の直後は、左の「すべての本」の冊数がアプリの不具合で 0 のまま (#590 不具合2・再読込で直る)。
        // ほかの確かめも続けて見るため、この1つだけ expect.soft にする (外れればテストは赤)
        await expect.soft(allShelf(page).locator('.bsr-count')).toHaveText('2');
        await expect(listItems(page)).toHaveCount(2);
        await expect(listItems(page).filter({ hasText: 'ブックマークの本 2' })).toHaveCount(1);
    });
});
