// 門のE2E (イシュー#590)。観測点 J2-2「貼り付けで増える」・J2-6「再読込しても残る」。
// 取込の画面に取込データ (tests/fixtures/gate-kindle-export.json と同じ中身) を貼って取り込むと、
// 本棚 (すべての本) の冊数が増えて一覧に書名が出ること、再読込しても同じ冊数と書名が見えることを確かめる。
// 保存先は空のフォルダにつないでおき、保存と読み直しはアプリの本物のコードが行う。書き方は tests/e2e/gate/README.md。
import { readFileSync } from 'node:fs';
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { stubFolderPickerForTest, connectLocalFolderForTest } from '../helpers/gate-local.js';

const EXPORT_JSON = readFileSync(new URL('../../fixtures/gate-kindle-export.json', import.meta.url), 'utf-8');
const TITLES = ['門の取込の本 1', '門の取込の本 2', '門の取込の本 3'];
const allShelf = (page) => page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"]');
const listItems = (page) => page.locator('#bookshelf .book-item');

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J2-2 J2-6 取込データを貼って取り込むと本棚の冊数が増え、再読込しても同じ冊数と書名が見える', async ({ page }) => {
    await test.step('前提: 空のフォルダを保存先につないだ状態でアプリを開いておく', async () => {
        await stubFolderPickerForTest(page, 'gate-j2-2');
        await bootAppForTest(page);
        await connectLocalFolderForTest(page);
    });

    await test.step('確認: 取り込む前の本棚 (すべての本) は0冊', async () => {
        await expect(allShelf(page).locator('.bsr-count')).toHaveText('0');
    });

    await test.step('操作: ホームの案内から取込の画面を開き、取込データを貼って「貼り付けた内容で取り込む」→ 全て選択 →「選択した本を取り込む」', async () => {
        await page.locator('#dashboard-welcome button[data-dw="import"]').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await page.locator('[data-import-action="open-paste"]').click();
        await page.locator('#kindle-paste-input').fill(EXPORT_JSON);
        await page.locator('#import-from-paste').click();
        await expect(page.locator('#book-list .book-selection-item')).toHaveCount(3);
        await page.locator('#select-all-books').click();
        await page.locator('#import-selected-books').click();
    });

    await test.step('確認: 取込結果に「新規追加 3」が出る', async () => {
        await expect(page.locator('#import-results')).toContainText('新規追加');
        await expect(page.locator('#import-results .stat-value.success')).toHaveText('3');
    });

    await test.step('操作: 取込の画面を閉じ、左の「すべての本」を開く', async () => {
        await page.keyboard.press('Escape');
        await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
        await allShelf(page).locator('.bsr-label').click();
    });

    await test.step('確認: 本棚の冊数が 0 → 3 に増え、一覧に3冊の書名が見える', async () => {
        // 取込の直後は、左の「すべての本」の冊数がアプリの不具合で 0 のまま (#590 不具合2・再読込で直る)。
        // ほかの確かめも続けて見るため、この1つだけ expect.soft にする (外れればテストは赤)
        await expect.soft(allShelf(page).locator('.bsr-count')).toHaveText('3');
        await expect(listItems(page)).toHaveCount(3);
        for (const t of TITLES) await expect(listItems(page).filter({ hasText: t })).toHaveCount(1);
    });

    await test.step('操作: 再読込し、左の「すべての本」を開く', async () => {
        await page.reload();
        await expect(allShelf(page)).toBeVisible();
        await allShelf(page).locator('.bsr-label').click();
    });

    await test.step('確認: 再読込のあとも 3冊で、同じ書名が見える', async () => {
        await expect(allShelf(page).locator('.bsr-count')).toHaveText('3');
        await expect(listItems(page)).toHaveCount(3);
        for (const t of TITLES) await expect(listItems(page).filter({ hasText: t })).toHaveCount(1);
    });
});
