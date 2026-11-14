// 門のE2E (イシュー#588 で書き、#632 で今の出し方に合わせた)。観測点 J6-5「失敗したら知らせる」(G-3)。
// 保存先をハブにした状態で、ハブへの書き込みが失敗する (模擬が 500 を返す) 時に、利用者が本の短文メモを書くと、
// 上部の状態バー (#app-status-bar) に保存の失敗の知らせが出ることを確かめる。出し方は ADR-158:
// js/bookshelf.js の _onSyncFailed が、1回目の失敗では何も出さず、自動の再試行の途中は控えめな行、
// 3回の再試行が尽きたら原因の文と「再試行」を出す。文言の正本は js/sync-failure.js (classify・RETRYING_MESSAGE)。
//   1本目: 既定の間隔 (5秒・15秒・45秒) のまま、控えめな行が出る (利用者と同じ条件)。
//   2本目: 再試行の間隔だけを前提で短くし、尽きた後の原因の文と「再試行」が出る (既定の間隔では約66秒後)。
// ハブは tests/e2e/helpers/gate-hub.js の模擬。保存先の読み書きは差し替えない。範囲はハブの1経路
// (GitHub・ローカルと直らない種類の失敗は、回帰の tests/e2e/save-failure-visible.spec.js が見る)。
// 書き方の決まりは tests/e2e/gate/README.md。npm run lint:e2e-gate が確かめる。
import { test, expect } from '../helpers/test-base.js';
import { bootAppForTest } from '../helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest, failHubWritesForTest } from '../helpers/gate-hub.js';
import { shortenSyncRetryForTest } from '../helpers/gate-sync-retry.js';

const BOOK = 'フィクスチャの本 1';
const MEMO = '門のE2E J6-5 保存に失敗する短文メモ';
const RETRYING = '保存できていない変更があります。自動で再試行しています。';
const FAILED = 'Asayake ハブに保存できませんでした。通信が戻ったら「再試行」を押してください。';

const bookButton = (page) => page.getByRole('button', { name: BOOK, exact: true }).first();
const memoBox = (page) => page.locator('.note-textarea[data-scope="all"]:visible').first();
const statusBar = (page) => page.locator('#app-status-bar');

test('@gate J6-5 ハブへの保存に失敗すると、自動の再試行の間「保存できていない変更があります」と出る', async ({ page }) => {
    let hub = null;

    await test.step('前提: ハブに蔵書を置き、ハブにログインして保存先をハブにした状態でアプリを開く', async () => {
        hub = createHubStateForTest();
        seedHubDataForTest(hub);
        await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
        await mockHubForTest(page, hub);
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
    });

    await test.step('前提: これ以降、ハブへの書き込みが失敗する (500)', async () => {
        failHubWritesForTest(hub);
    });

    await test.step('操作: 本を開き、短文メモを書く', async () => {
        await bookButton(page).click();
        await memoBox(page).fill(MEMO);
    });

    await test.step('確認: 状態バーに「保存できていない変更があります。自動で再試行しています。」が出る', async () => {
        // 1回目の失敗の5秒後の再試行も失敗してから出る (2026-11-14 #632 の実測でメモを書いて +6.1〜6.2秒)。余裕を持たせて15秒待つ
        await expect(statusBar(page).getByText(RETRYING)).toBeVisible({ timeout: 15000 });
    });
});

test('@gate J6-5 ハブへの保存の自動の再試行が尽きると、原因の文と「再試行」が出る', async ({ page }) => {
    let hub = null;

    await test.step('前提: 自動の再試行の間隔を短くする (既定は 5秒・15秒・45秒)', async () => {
        await shortenSyncRetryForTest(page);
    });

    await test.step('前提: ハブに蔵書を置き、ハブにログインして保存先をハブにした状態でアプリを開く', async () => {
        hub = createHubStateForTest();
        seedHubDataForTest(hub);
        await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
        await mockHubForTest(page, hub);
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
    });

    await test.step('前提: これ以降、ハブへの書き込みが失敗する (500)', async () => {
        failHubWritesForTest(hub);
    });

    await test.step('操作: 本を開き、短文メモを書く', async () => {
        await bookButton(page).click();
        await memoBox(page).fill(MEMO);
    });

    await test.step('確認: 状態バーに「Asayake ハブに保存できませんでした…」と「再試行」が出る', async () => {
        // 間隔 [300,300,300] で、メモを書いて +2.0〜2.2秒 (2026-11-14 #632 の実測)。1本目と同じく15秒まで待つ
        await expect(statusBar(page).getByText(FAILED)).toBeVisible({ timeout: 15000 });
        await expect(statusBar(page).getByRole('button', { name: '再試行', exact: true })).toBeVisible();
    });
});
