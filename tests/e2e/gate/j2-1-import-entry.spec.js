// 門のE2E (イシュー#590)。観測点 J2-1「入口のボタンから開ける」。
// 取込の画面を、利用者が押す2つの入口 (ホームの初回の案内の「本を追加・取り込み」・設定の「蔵書」の
// 「Kindleの本を取り込む」) から開けることを、内部から開かずに確かめる (G-5)。取込は PC 専用 (C-248)。
// 書き方の決まりは tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { stubFolderPickerForTest, connectLocalFolderForTest } from '../helpers/gate-local.js';

const importModal = (page) => page.locator('#import-modal');

test.use({ viewport: { width: 1280, height: 800 } });

test('@gate J2-1 取込の画面を、ホームの案内の「本を追加・取り込み」と、設定の「Kindleの本を取り込む」から開ける', async ({ page }) => {
    await test.step('前提: 空のフォルダを保存先につないだ状態でアプリを開いておく', async () => {
        await stubFolderPickerForTest(page, 'gate-j2-1');
        await bootAppForTest(page);
        await connectLocalFolderForTest(page);
    });

    await test.step('操作: ホームの案内の「本を追加・取り込み」を押す', async () => {
        await page.locator('#dashboard-welcome button[data-dw="import"]').click();
    });

    await test.step('確認: 取込の画面が開き、PC の取込の手順 (取込ブックマーク・Amazon を開く) が見える', async () => {
        await expect(importModal(page)).toHaveClass(/show/);
        await expect(page.locator('#import-lane-pc')).toBeVisible();
        await expect(page.locator('#open-amazon-for-import')).toBeVisible();
        await expect(page.locator('#kindle-paste-input')).toBeVisible();
    });

    await test.step('操作: Esc で閉じ、左の「設定」→ 一覧の「蔵書」→「Kindleの本を取り込む」と押す', async () => {
        await page.keyboard.press('Escape');
        await expect(importModal(page)).not.toHaveClass(/show/);
        await page.locator('#sidebar-settings').click();
        await page.locator('#settings-master .settings-cat[data-cat="library-section"]').click();
        await page.locator('#import-kindle').click();
    });

    await test.step('確認: 取込の画面がもう一度開いている', async () => {
        await expect(importModal(page)).toHaveClass(/show/);
        await expect(page.locator('#import-lane-pc')).toBeVisible();
    });
});
