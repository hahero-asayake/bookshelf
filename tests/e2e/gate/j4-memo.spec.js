// 門のE2E (イシュー#590)。観測点 J4-1「短文を保存できる」・J4-2「長文を保存できる」・
// J4-3「再読込・別の画面から開いても同じ内容」。
// 保存先のフォルダにつないで本を入れた状態で、本の詳細から短文メモを書き、「長文メモを書く」からアプリ内の
// エディタで長文メモを書いて「完了」する。再読込のあと、検索 (⌘K) という別の入口から同じ本を開いても、
// 短文と長文が同じ内容で見えることを確かめる (内部から開かない・G-5)。書き方は tests/e2e/gate/README.md。
import { readFileSync } from 'node:fs';
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { stubFolderPickerForTest, connectLocalFolderForTest, fillFolderWithBooksForTest } from '../helpers/gate-local.js';

const EXPORT_JSON = readFileSync(new URL('../../fixtures/gate-kindle-export.json', import.meta.url), 'utf-8');
const BOOK = '門の取込の本 2';
const SHORT = '門の短文メモ：二章が良かった';
const LONG_1 = '門の長文メモ 1行目';
const LONG_2 = '2行目：読み返したい場面';
const detail = (page) => page.locator('#book-detail-pane');
const shortMemo = (page) => detail(page).locator('.note-textarea');
const longMemoBtn = (page) => detail(page).locator('.memo-file-btn');
const memoModal = (page) => page.locator('#book-memo-modal');
const memoEditor = (page) => memoModal(page).locator('.CodeMirror');
const openBookFromAllShelf = async (page, title) => {
    await page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-label').click();
    await page.locator('#bookshelf .book-item', { hasText: title }).click();
};

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J4-1 J4-2 J4-3 本の詳細で短文メモと長文メモを書いて保存すると、再読込して検索から開いても同じ内容で見える', async ({ page }) => {
    await test.step('前提: フォルダを保存先につなぎ、本を入れた状態でアプリを開いておく', async () => {
        await stubFolderPickerForTest(page, 'gate-j4');
        await bootAppForTest(page);
        await connectLocalFolderForTest(page);
        await fillFolderWithBooksForTest(page, EXPORT_JSON, 'gate-j4');
    });

    await test.step('操作: [J4-1] 「すべての本」から本を開き、詳細の短文メモ欄に書く', async () => {
        await openBookFromAllShelf(page, BOOK);
        await expect(detail(page)).toContainText(BOOK);
        await shortMemo(page).fill(SHORT);
    });

    await test.step('確認: [J4-1] 保存されたと分かり、欄に書いた内容が見える', async () => {
        await expect(detail(page).locator('.bd-save-status')).toContainText('保存');
        await expect(shortMemo(page)).toHaveValue(SHORT);
    });

    await test.step('操作: [J4-2] 「長文メモを書く」を押し、エディタに2行書いて「完了」を押す', async () => {
        await expect(longMemoBtn(page)).toHaveText(/長文メモを書く/);
        await longMemoBtn(page).click();
        await expect(memoEditor(page)).toBeVisible();
        await memoEditor(page).click();
        await page.keyboard.type(LONG_1);
        await page.keyboard.press('Enter');
        await page.keyboard.type(LONG_2);
        await page.locator('#book-memo-fs-done').click();
        await expect(memoModal(page)).toBeHidden();
    });

    // 「完了」の直後は、詳細のボタンが「長文メモを書く」のまま (#590 不具合3の候補・調査中)。ほかの確かめも続けて見るため soft にする
    await test.step('確認: [J4-2] 詳細のボタンが「長文メモを開く」に変わる', async () => {
        await expect.soft(longMemoBtn(page)).toHaveText(/長文メモを開く/);
    });

    await test.step('操作: [J4-2] 「長文メモを開く」で開き直す', async () => {
        await longMemoBtn(page).click();
        await expect(memoEditor(page)).toBeVisible();
    });

    await test.step('確認: [J4-2] 書いた2行が見える', async () => {
        await expect(memoEditor(page)).toContainText(LONG_1);
        await expect(memoEditor(page)).toContainText(LONG_2);
    });

    await test.step('操作: [J4-3] エディタを閉じて再読込し、左の「検索」から書名で同じ本を開く', async () => {
        await page.locator('#book-memo-fs-done').click();
        await expect(memoModal(page)).toBeHidden();
        await page.reload();
        await expect(page.locator('#sidebar-search')).toBeVisible();
        await page.locator('#sidebar-search').click();
        await page.locator('#cmdk-input').fill(BOOK);
        await page.locator('#cmdk-results .cmdk-item', { hasText: BOOK }).first().click();
    });

    await test.step('確認: [J4-3] 詳細に同じ本が出て、短文メモが同じ内容で見える', async () => {
        await expect(detail(page)).toContainText(BOOK);
        await expect(shortMemo(page)).toHaveValue(SHORT);
        await expect(longMemoBtn(page)).toHaveText(/長文メモを開く/);
    });

    await test.step('操作: [J4-3] 「長文メモを開く」を押す', async () => {
        await longMemoBtn(page).click();
        await expect(memoEditor(page)).toBeVisible();
    });

    await test.step('確認: [J4-3] 長文メモも同じ2行が見える', async () => {
        await expect(memoEditor(page)).toContainText(LONG_1);
        await expect(memoEditor(page)).toContainText(LONG_2);
    });
});
