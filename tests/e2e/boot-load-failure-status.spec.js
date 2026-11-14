// イシュー#653: ハブ・GitHub の起動の読込が失敗した時、設定の同期欄 (#obsidian-sync-status) に、保存の失敗の文
// 「保存できませんでした」(updateSyncStatus の既定の文) を出さない。出すのは、同じ失敗で状態バー (ハブ)・toast (GitHub) に
// もう出している読込の失敗の文 (案A)。path (#obsidian-sync-path) の「（要再接続）」は認証切れの時だけ付ける
// (通信の失敗は電波が戻れば自動で読み直す＝#617。保存の失敗の catch と同じ決め方)。
// 守り: 本当の保存の失敗では、今までどおり「…に保存できませんでした。…」を出す (js/sync-failure.js の文)。
// 作り方は online-resync.spec.js (#617) と同じ: 1回ふつうに起動してから、模擬より手前の route で通信を落とす
// (または 401 を返す) 形にして開き直す。chromium の setOffline は route の模擬を止めないので使わない。
// ハブ・GitHub を選んでいる間、同期欄は「この端末のフォルダ」の欄ごと隠れている (#648) ので、文字は textContent で見る。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { HUB_BASE, createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';
import { createMockGitHubForTest, seedGitHubDataForTest, seedGitHubLoginForTest, mockGitHubForTest } from './helpers/gate-github.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const BOOK = 'フィクスチャの本 1';
const SAVE_FAILED = '保存できませんでした';
const HUB_LABEL = 'Asayake ハブ';

const syncStatus = (page) => page.locator('#obsidian-sync-status');
const syncPath = (page) => page.locator('#obsidian-sync-path');
const statusBar = (page) => page.locator('#app-status-bar');
const ghLabel = (gh) => `${gh.owner}/${gh.repo}@${gh.branch}`;

// 模擬より手前に置く口。cut.mode が null の間は模擬へ回す。'net' は通信の失敗、'auth' は 401 (GitHub の認証切れ)。
// cut.onlyWrites の間は、読み込み (GET) は通して書き込みだけを落とす (保存の失敗の守り)
async function cutBefore(context, pattern, cut) {
    await context.route(pattern, (route) => {
        if (!cut.mode || (cut.onlyWrites && route.request().method() === 'GET')) return route.fallback();
        if (cut.mode === 'auth') return route.fulfill({ status: 401, json: { message: 'Bad credentials' } });
        return route.abort('internetdisconnected');
    });
}

async function bootHub(page, context) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    const cut = { mode: null, onlyWrites: false };
    await cutBefore(context, `${HUB_BASE}/**`, cut);
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
    const cut = { mode: null, onlyWrites: false };
    await cutBefore(context, 'https://api.github.com/**', cut);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await expect(syncStatus(page)).toContainText('保存済み');
    return { gh, cut };
}

// 同期欄に保存の失敗の文が無く、決めた文と path が出ている (どれが違うかを1回で全部見るため soft にする)
async function expectSyncField(page, { status, path }) {
    await expect.soft(syncStatus(page), '同期欄に保存の失敗の文を出さない').not.toContainText(SAVE_FAILED);
    await expect.soft(syncStatus(page), '同期欄は読込の失敗の文').toHaveText(status);
    await expect.soft(syncPath(page), 'path').toHaveText(path);
}

async function writeMemo(page, memo) {
    await page.getByRole('button', { name: BOOK, exact: true }).first().click();
    await page.locator('.note-textarea[data-scope="all"]:visible').first().fill(memo);
    await expect(page.locator('.save-note-status:visible').first()).toContainText('保存しました');
}

test('ハブ: 起動の読込が通信で失敗した時、同期欄は状態バーと同じ読込の失敗の文を出し、path に「（要再接続）」を付けない', async ({ page, context }) => {
    const { cut } = await bootHub(page, context);
    cut.mode = 'net';
    await page.reload();
    await expect(statusBar(page)).toContainText('Asayake ハブ からの読み込みに失敗しました。', { timeout: 20_000 });
    await expectSyncField(page, { status: 'Asayake ハブ からの読み込みに失敗しました。', path: HUB_LABEL });
});

test('ハブ: 起動の読込が認証切れで失敗した時、同期欄は状態バーと同じ認証切れの文を出し、path に「（要再接続）」を付ける', async ({ page, context }) => {
    const { hub } = await bootHub(page, context);
    // 古い接続キーが使えない形 (gate-hub.js の模擬が 401 'invalid key' を返す)
    hub.deleted = true;
    await page.reload();
    await expect(statusBar(page)).toContainText('Asayake ハブ の認証が切れました。設定から再接続してください。', { timeout: 20_000 });
    await expectSyncField(page, { status: 'Asayake ハブ の認証が切れました。設定から再接続してください。', path: `${HUB_LABEL}（要再接続）` });
});

test('GitHub: 起動の読込が通信で失敗した時、同期欄は toast と同じ読込の失敗の文を出し、path に「（要再接続）」を付けない', async ({ page, context }) => {
    const { gh, cut } = await bootGitHub(page, context);
    cut.mode = 'net';
    await page.reload();
    await expect(page.locator('.toast-message', { hasText: 'GitHub からの読み込みに失敗しました。' })).toBeVisible({ timeout: 20_000 });
    await expectSyncField(page, { status: 'GitHub からの読み込みに失敗しました。', path: ghLabel(gh) });
});

test('GitHub: 起動の読込が認証切れで失敗した時、同期欄は toast と同じ認証切れの文を出し、path に「（要再接続）」を付ける', async ({ page, context }) => {
    const { gh, cut } = await bootGitHub(page, context);
    cut.mode = 'auth';
    await page.reload();
    await expect(page.locator('.toast-message', { hasText: 'GitHub との接続に失敗しました。' })).toBeVisible({ timeout: 20_000 });
    await expectSyncField(page, {
        status: 'GitHub との接続に失敗しました。「切断」してから、もう一度「GitHub に接続」をお試しください。',
        path: `${ghLabel(gh)}（要再接続）`
    });
});

test('守り ハブ: 保存の書き込みが通信で失敗した時は、今までどおり同期欄に「Asayake ハブに保存できませんでした。…」を出す', async ({ page, context }) => {
    const { cut } = await bootHub(page, context);
    cut.mode = 'net';
    cut.onlyWrites = true;
    await writeMemo(page, 'ハブへの保存が通信で失敗する短文メモ');
    await expect(syncStatus(page)).toHaveText('Asayake ハブに保存できませんでした。通信が戻ったら「再試行」を押してください。', { timeout: 15_000 });
    await expect(syncPath(page)).toHaveText(HUB_LABEL);
});

test('守り GitHub: 保存の書き込みが通信で失敗した時は、今までどおり同期欄に「GitHub に保存できませんでした。…」を出す', async ({ page, context }) => {
    const { gh, cut } = await bootGitHub(page, context);
    cut.mode = 'net';
    cut.onlyWrites = true;
    await writeMemo(page, 'GitHub への保存が通信で失敗する短文メモ');
    await expect(syncStatus(page)).toHaveText('GitHub に保存できませんでした。通信が戻ったら「再試行」を押してください。', { timeout: 15_000 });
    await expect(syncPath(page)).toHaveText(ghLabel(gh));
});
