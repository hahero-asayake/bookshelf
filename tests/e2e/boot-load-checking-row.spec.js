// イシュー#672: 起動の読込が失敗した後、状態バーの「最新のデータを確認しています…」を残さない。
// この行は起動の後半 (finishStartup) が全部終わるまで出る作り。GitHub・通信の失敗では、読込が失敗した後も、公開記事の
// 移行とプラグインの列挙が同じ通信の失敗を2秒ずつ待って読み直すので、toast が出てから約6秒残っていた (672-results.md step1)。
// 基準: 失敗の表示 (ハブ=状態バーの失敗の行・GitHub=toast) が出てから2秒のうちに行が消える。成功の起動でも
// 「保存済み」の後に最大1.11秒残るので、CI の負荷を見込んで2秒にする。守り: 失敗させない起動でも行が出て、読込の後に消える。
// 作り方は boot-load-failure-status.spec.js (#653) と同じ: 1回ふつうに起動してから、模擬より手前の route で通信を落として
// (または 401 を返して) 開き直す。失敗の文は #666 で変わりうるので、文ではなく出る場所 (失敗の行・toast) で見る。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { HUB_BASE, createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';
import { createMockGitHubForTest, seedGitHubDataForTest, seedGitHubLoginForTest, mockGitHubForTest } from './helpers/gate-github.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const CHECKING = '最新のデータを確認しています…';
const LEAVE_MS = 2000;

const checkingRow = (page) => page.locator('#app-status-bar .status-row', { hasText: CHECKING });
const hubFailureRow = (page) => page.locator('#app-status-bar .status-row.status-warn');
const githubToast = (page) => page.locator('.toast-message', { hasText: 'GitHub' });
// 通信の失敗は、GitHub も toast をやめ、状態バーに読込の失敗の行を出す (イシュー#666)。認証切れは今も toast
const loadFailureRow = (page) => page.locator('#app-status-bar [data-load-failure]');
const syncStatus = (page) => page.locator('#obsidian-sync-status');

// 確認中の行が一度でも出たかを、開くたびに画面の側で覚える (1秒ほどで消える行も取りこぼさない。bookshelf._* は読まない)
async function recordCheckingRow(page) {
    await page.addInitScript((text) => {
        window.__checkingRowSeen = false;
        const scan = () => {
            const bar = document.getElementById('app-status-bar');
            if (bar && bar.textContent.includes(text)) window.__checkingRowSeen = true;
        };
        new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true });
    }, CHECKING);
}
const expectCheckingRowSeen = (page) =>
    expect.poll(() => page.evaluate(() => window.__checkingRowSeen), { message: '開き直した後に確認中の行が出た' }).toBe(true);

// 模擬より手前に置く口。cut.mode が null の間は模擬へ回す。'net' は通信の失敗、'auth' は 401 (GitHub の認証切れ)
async function cutBefore(context, pattern, cut) {
    await context.route(pattern, (route) => {
        if (!cut.mode) return route.fallback();
        if (cut.mode === 'auth') return route.fulfill({ status: 401, json: { message: 'Bad credentials' } });
        return route.abort('internetdisconnected');
    });
}

async function bootHub(page, context) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    const cut = { mode: null };
    await cutBefore(context, `${HUB_BASE}/**`, cut);
    await recordCheckingRow(page);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await expect(syncStatus(page)).toContainText('保存済み');
    return { hub, cut };
}

async function bootGitHub(page, context) {
    const gh = createMockGitHubForTest();
    seedGitHubDataForTest(gh);
    await seedGitHubLoginForTest(page, gh);
    await mockGitHubForTest(page, gh);
    const cut = { mode: null };
    await cutBefore(context, 'https://api.github.com/**', cut);
    await recordCheckingRow(page);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await expect(syncStatus(page)).toContainText('保存済み');
    return { gh, cut };
}

test('GitHub: 起動の読込が通信で失敗したら、状態バーの読込の失敗の行が出てから2秒のうちに「最新のデータを確認しています…」が消える', async ({ page, context }) => {
    const { cut } = await bootGitHub(page, context);
    cut.mode = 'net';
    await page.reload();
    await expect(loadFailureRow(page)).toBeVisible({ timeout: 20_000 });
    await expectCheckingRowSeen(page);
    await expect(checkingRow(page), '読込の失敗の行が出た後も「確認しています」が残っている').toHaveCount(0, { timeout: LEAVE_MS });
});

test('ハブ: 起動の読込が通信で失敗したら、状態バーの失敗の行が出てから2秒のうちに「最新のデータを確認しています…」が消える', async ({ page, context }) => {
    const { cut } = await bootHub(page, context);
    cut.mode = 'net';
    await page.reload();
    await expect(hubFailureRow(page)).toBeVisible({ timeout: 20_000 });
    await expectCheckingRowSeen(page);
    await expect(checkingRow(page), '失敗の行が出た後も「確認しています」が残っている').toHaveCount(0, { timeout: LEAVE_MS });
});

test('ハブ: 起動の読込が認証切れで失敗したら、状態バーの失敗の行が出てから2秒のうちに「最新のデータを確認しています…」が消える', async ({ page, context }) => {
    const { hub } = await bootHub(page, context);
    // 古い接続キーが使えない形 (gate-hub.js の模擬が 401 'invalid key' を返す)
    hub.deleted = true;
    await page.reload();
    await expect(hubFailureRow(page)).toBeVisible({ timeout: 20_000 });
    await expectCheckingRowSeen(page);
    await expect(checkingRow(page), '失敗の行が出た後も「確認しています」が残っている').toHaveCount(0, { timeout: LEAVE_MS });
});

test('GitHub: 起動の読込が認証切れで失敗したら、toast が出てから2秒のうちに「最新のデータを確認しています…」が消える', async ({ page, context }) => {
    const { cut } = await bootGitHub(page, context);
    cut.mode = 'auth';
    await page.reload();
    await expect(githubToast(page)).toBeVisible({ timeout: 20_000 });
    await expectCheckingRowSeen(page);
    await expect(checkingRow(page), 'toast が出た後も「確認しています」が残っている').toHaveCount(0, { timeout: LEAVE_MS });
});

// 守り: 失敗させない起動では、今までどおり行が出て、読込が終わった後に消える (直しで行が出なくならない)
test('GitHub: 読込が成功する起動では「最新のデータを確認しています…」が出て、「保存済み」の後に消える', async ({ page, context }) => {
    await bootGitHub(page, context);
    await page.reload();
    await expectCheckingRowSeen(page);
    await expect(syncStatus(page)).toContainText('保存済み');
    await expect(checkingRow(page)).toHaveCount(0);
});

test('ハブ: 読込が成功する起動では「最新のデータを確認しています…」が出て、「保存済み」の後に消える', async ({ page, context }) => {
    await bootHub(page, context);
    await page.reload();
    await expectCheckingRowSeen(page);
    await expect(syncStatus(page)).toContainText('保存済み');
    await expect(checkingRow(page)).toHaveCount(0);
});
