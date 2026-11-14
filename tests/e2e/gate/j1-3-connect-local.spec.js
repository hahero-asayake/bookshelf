// 門のE2E (イシュー#590)。観測点 J1-3「接続が完了したと分かる」・J1-4「再読込しても保存先が残る」の、
// 保存先「この端末のフォルダ」(PC) の分。初回の案内の「保存先を選ぶ」から、ボタン操作だけでフォルダにつなぎ、
// つながったと画面で分かること・再読込してもその保存先のままであることを確かめる。
// フォルダを選ぶ画面だけを模擬し (helpers/gate-local.js)、保存・読み直しはアプリの本物のコードを通す。
// 書き方の決まりは tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { stubFolderPickerForTest } from '../helpers/gate-local.js';

const FOLDER = 'gate-j1-folder';
const methodSelect = (page) => page.locator('#sync-method-select');
const welcomeSyncBtn = (page) => page.locator('#dashboard-welcome button[data-dw="sync"]');

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J1-3 J1-4 PC で保存先を「この端末のフォルダ」にしてつなぐと、つながったと分かり、再読込しても残る', async ({ page }) => {
    await test.step('前提: フォルダを選ぶ画面の応答を模擬し、何も入っていない状態のアプリを開いておく', async () => {
        await stubFolderPickerForTest(page, FOLDER);
        await bootAppForTest(page);
    });

    await test.step('操作: 案内の「保存先を選ぶ」→「この端末のフォルダ」→「フォルダを選ぶ」と押す', async () => {
        await welcomeSyncBtn(page).click();
        await expect(methodSelect(page)).toBeVisible();
        await methodSelect(page).selectOption('local');
        await page.locator('#obsidian-sync-btn').click();
    });

    await test.step('確認: 選んだフォルダの名前と「同期済み」が見え、初期化したと知らせが出る', async () => {
        await expect(page.locator('#obsidian-sync-path')).toHaveText(FOLDER);
        await expect(page.locator('#obsidian-sync-status')).toContainText('同期済み');
        await expect(page.locator('.toast', { hasText: `「${FOLDER}」に新ファイル構造で初期化しました。` })).toBeVisible();
    });

    await test.step('操作: Esc で設定を閉じてホームに戻る', async () => {
        await page.keyboard.press('Escape');
        await expect(methodSelect(page)).toBeHidden();
    });

    await test.step('確認: ホームの案内の1つめの手順が「設定済み」になっている', async () => {
        await expect(welcomeSyncBtn(page)).toHaveText('設定済み');
    });

    await test.step('操作: 再読込して、案内の1つめの手順のボタンを押して設定を開く', async () => {
        await page.reload();
        await expect(welcomeSyncBtn(page)).toBeVisible();
        await welcomeSyncBtn(page).click();
        await expect(methodSelect(page)).toBeVisible();
    });

    await test.step('確認: 保存先は「この端末のフォルダ」のままで、同じフォルダにつながっている', async () => {
        await expect(page.locator('#obsidian-sync-path')).toHaveText(FOLDER);
        await expect(page.locator('#obsidian-sync-status')).toContainText('同期済み');
        await expect(methodSelect(page)).toHaveValue('local');
    });
});
