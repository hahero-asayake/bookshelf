// 門のE2E (イシュー#617)。観測点 J8-4「電波が戻ると同期される」。
// 利用者と同じ操作だけで、電波なしの間に端末Aで書いた短文メモが、電波が戻ると (ほかに何もしなくても) ハブに届き、
// 別の端末 (2つ目のブラウザコンテキスト＝localStorage を共有しない) で同じハブを開くと読めることを確かめる。
// ハブは tests/e2e/helpers/gate-hub.js の模擬。Service Worker は止めたまま (playwright.config.js の既定) =
// アプリは開いたままで電波だけが切れる場面。webkit でも模擬が効く (README「webkit で流す」)。
// 電波なしの間は、模擬のハブにも届かないようにする (helpers/gate-network.js・chromium の setOffline は模擬を止めないため)。
// 電波が戻った後の送り直しは、自動の再試行の次の番 (15秒後) を待たずに起きることを、知らせが5秒以内に消えることで見る。
// 書き方の決まりは tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { HUB_BASE, createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from '../helpers/gate-hub.js';
import { prepareOtherDeviceForTest, closeOtherDeviceForTest } from '../helpers/gate-device.js';
import { prepareOfflineForTest, goOfflineForTest, goOnlineForTest } from '../helpers/gate-network.js';

// chromium と webkit (iPhone 13) で同じ入口・同じ画面にする (幅を決めないと chromium は PC 幅で流れる)
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const BOOK = 'フィクスチャの本 1';
const MEMO = '門のE2E J8-4 電波なしの間に書いた短文メモ';

const bookButton = (page) => page.getByRole('button', { name: BOOK, exact: true }).first();
const memoBox = (page) => page.locator('.note-textarea[data-scope="all"]:visible').first();
// 状態バーの「保存できていない」知らせ (自動の再試行の途中・再試行が尽きた後のどちらも)
const unsavedNotice = (page) => page.locator('#app-status-bar .status-row[data-sync-failure]');

test('@gate J8-4 電波なしの間に書いた短文メモは、電波が戻ると、何もしなくても別の端末で読める', async ({ page, context }) => {
    let hub = null;
    let other = null;

    await test.step('前提: ハブに蔵書を置き、保存先をハブにしてアプリを開く (電波なしの間はハブに届かないようにしておく)', async () => {
        hub = createHubStateForTest();
        seedHubDataForTest(hub);
        await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
        await mockHubForTest(page, hub);
        await prepareOfflineForTest(context, `${HUB_BASE}/**`);
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
    });

    await test.step('操作: 電波を切り、本を開いて短文メモを書き、「保存しました」を待つ', async () => {
        await goOfflineForTest(context);
        await bookButton(page).click();
        await memoBox(page).fill(MEMO);
        await expect(page.locator('.save-note-status:visible').first()).toContainText('保存しました');
    });

    await test.step('確認: 電波なしの間は、保存できていない知らせが状態バーに出る', async () => {
        await expect(unsavedNotice(page)).toBeVisible({ timeout: 15000 });
    });

    await test.step('操作: 電波を戻す (ほかには何もしない)', async () => {
        await goOnlineForTest(context);
    });

    await test.step('確認: 保存できていない知らせが消える', async () => {
        await expect.soft(unsavedNotice(page)).toBeHidden();
    });

    await test.step('前提: 別の端末を用意する (同じハブにログイン済み・端末内の蔵書は空)', async () => {
        other = await prepareOtherDeviceForTest(page, hub);
    });

    await test.step('操作: 別の端末でアプリを開き、同じ本を開く', async () => {
        await other.goto('index.html');
        await expect(other.locator('#loading')).toBeHidden({ timeout: 10000 });
        await bookButton(other).click();
    });

    await test.step('確認: 別の端末に、電波なしの間に書いた短文メモが見える', async () => {
        await expect(memoBox(other)).toHaveValue(MEMO);
    });

    await test.step('前提: 別の端末を閉じる', async () => {
        await closeOtherDeviceForTest(other);
    });
});
