// 門のE2E (イシュー#588)。観測点 J6-3「ハブ：保存→別の端末で読める」(G-3)。
// 利用者と同じ操作だけで、端末Aで本の短文メモを書き、別の端末 (2つ目のブラウザコンテキスト＝localStorage を共有しない)
// で同じハブにログインしてアプリを開くと、その短文メモが読めることを確かめる。
// ハブは tests/e2e/helpers/gate-hub.js の模擬 (2台で同じ中身を読み書きする)。保存先の読み書きは差し替えない。
// ハブの保存では「同期済み」の文字が画面に出ない (設定の #obsidian-sync-status はローカルのフォルダの欄の中)。
// そのため、別の端末で開き直して届くのを待つ (最大30秒)。
// 書き方の決まりは tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from '../helpers/gate-hub.js';
import { prepareOtherDeviceForTest, closeOtherDeviceForTest } from '../helpers/gate-device.js';

const BOOK = 'フィクスチャの本 1';
const MEMO = '門のE2E J6-3 端末Aで書いた短文メモ';

const bookButton = (page) => page.getByRole('button', { name: BOOK, exact: true }).first();
const memoBox = (page) => page.locator('.note-textarea[data-scope="all"]:visible').first();

test('@gate J6-3 ハブ：端末Aで書いた短文メモが、別の端末で開くと読める', async ({ page }) => {
    let hub = null;
    let other = null;

    await test.step('前提: ハブに蔵書を置き、端末Aでハブにログインして保存先をハブにした状態でアプリを開く', async () => {
        hub = createHubStateForTest();
        seedHubDataForTest(hub);
        await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
        await mockHubForTest(page, hub);
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
    });

    await test.step('操作: 端末Aで本を開き、短文メモを書いて「保存しました」を待つ', async () => {
        await bookButton(page).click();
        await memoBox(page).fill(MEMO);
        await expect(page.locator('.save-note-status:visible').first()).toContainText('保存しました');
    });

    await test.step('前提: 別の端末を用意する (同じハブにログイン済み・端末内の蔵書は空)', async () => {
        other = await prepareOtherDeviceForTest(page, hub);
    });

    await test.step('操作: 別の端末でアプリを開き、同じ本を開く (ハブへの書き込みが届くまで開き直す)', async () => {
        await expect(async () => {
            await other.goto('index.html');
            await expect(other.locator('#loading')).toBeHidden({ timeout: 10000 });
            await bookButton(other).click({ timeout: 5000 });
            await expect(memoBox(other)).toHaveValue(MEMO, { timeout: 2000 });
        }).toPass({ timeout: 30000 });
    });

    await test.step('確認: 別の端末に、端末Aで書いた短文メモが見える', async () => {
        await expect(memoBox(other)).toHaveValue(MEMO);
    });

    await test.step('前提: 別の端末を閉じる', async () => {
        await closeOtherDeviceForTest(other);
    });
});
