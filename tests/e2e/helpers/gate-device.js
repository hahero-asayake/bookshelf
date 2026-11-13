// 門のE2E (テスト名に `@gate` と観測点ID) の「前提」で使う、別の端末 (2つ目のブラウザコンテキスト) (イシュー#588)。
// 書き方の決まりは tests/e2e/gate/README.md。別の端末は、localStorage・IndexedDB・Cookie を1台目と共有しない
// 新しいコンテキストで作り、同じハブの模擬 (tests/e2e/helpers/gate-hub.js の state) を読み書きさせる。
//
// 使う順番 (1台目のアプリを開いた後):
//   await test.step('前提: 別の端末を用意する', async () => { other = await prepareOtherDeviceForTest(page, hub); });
//   await test.step('操作: 別の端末でアプリを開く', async () => { await other.goto('index.html'); … });
//   …
//   await test.step('前提: 別の端末を閉じる', async () => { await closeOtherDeviceForTest(other); });
//
// browser.newContext() で作ったコンテキストには、playwright.config.js の use (baseURL・viewport・serviceWorkers) も
// tests/e2e/helpers/test-base.js の fixture (GIS の模擬・広告と書影の遮断) も掛からない。ここで同じ物を明示して掛ける。
import { blockExternalForTest } from './test-base.js';
import { seedHubLoginForTest, mockHubForTest } from './gate-hub.js';
import { seedGitHubLoginForTest, mockGitHubForTest } from './gate-github.js';

/** 別の端末 (2つ目のコンテキスト) を用意し、同じ保存先にログイン済み・端末内の蔵書は空のページを返す。
 * 保存先は渡した状態で決まる: gate-github.js の createMockGitHubForTest の状態 (kind: 'github') なら同じリポジトリ、
 * それ以外 (gate-hub.js の createHubStateForTest の状態) なら同じハブ。
 * まだアプリは開かない (開くのは操作の区間で other.goto('index.html'))。
 * @param {import('@playwright/test').Page} page 1台目のページ (ブラウザ・URL の起点・画面の大きさを借りる)
 * @param {object} store 1台目と同じ保存先の状態 (ハブまたは GitHub)
 * @returns {Promise<import('@playwright/test').Page>} */
export async function prepareOtherDeviceForTest(page, store) {
    const origin = new URL(page.url()).origin;
    const context = await page.context().browser().newContext({
        baseURL: `${origin}/`, viewport: page.viewportSize(), serviceWorkers: 'block'
    });
    await blockExternalForTest(context);
    const other = await context.newPage();
    if (store.kind === 'github') {
        await seedGitHubLoginForTest(other, store);
        await mockGitHubForTest(other, store);
    } else {
        await seedHubLoginForTest(other, store, { method: 'hub', library: false });
        await mockHubForTest(other, store);
    }
    return other;
}

/** 別の端末を閉じる (コンテキストごと)。
 * @param {import('@playwright/test').Page} other prepareOtherDeviceForTest が返したページ */
export async function closeOtherDeviceForTest(other) {
    await other.context().close();
}
