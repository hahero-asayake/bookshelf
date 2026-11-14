// イシュー#677: 起動の読込が通信で失敗した後の、起動の後半 (公開記事の移行・プラグインの読み込み) の扱い。
// 今は、読込が失敗した後も後半が流れ、同じ通信の失敗を GitHub の読み込みの再試行 (2秒) で3回待つ。端末にデータが無い起動では、
// 失敗の知らせ (#666 の前は toast) が出てから約6秒、#loading の覆いが残る (677-results.md §1)。後半は全部失敗するので、有効になるプラグインは0個で、
// 通信が戻っても読み直されない (開き直すまで0個のまま)。
// 決まり (②承認の案 (iii)): 起動の後半は、読込が通った後に1回だけ流す。失敗した起動では流さず、後で読込が通った時に1回流す。
// 基準: 読込の失敗の行が出てから2秒のうちに覆い・確認中の行が消える (#672 と同じ LEAVE_MS)。通信を戻してから5秒のうちに標準機能5個が有効になる。
// 守り: 失敗させない起動では、後半 (ensureStandardPlugins・loadEnabledPlugins) が1回ずつだけ流れる (プラグインの一覧の要求が2本)。
// プラグインの数はハブの模擬で見る (GitHub で標準機能5個が有効になることは github-standard-plugins.spec.js が見る・イシュー#683)。
// 作り方は boot-load-checking-row.spec.js (#672) と同じ: 模擬より手前の route で通信を落とす。失敗の文は #666 で変わりうるので、
// 文ではなく出る場所 (状態バーの読込の失敗の行 [data-load-failure]) で見る。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { HUB_BASE, createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';
import { createMockGitHubForTest, seedGitHubDataForTest, seedGitHubLoginForTest, mockGitHubForTest } from './helpers/gate-github.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const CHECKING = '最新のデータを確認しています…';
const LEAVE_MS = 2000;
const PLUGINS_AFTER_ONLINE_MS = 5000;
const STANDARD_IDS = ['author-grouping', 'dark-theme', 'highlights-builtin', 'series-grouping', 'memo-templates'].sort();

const loading = (page) => page.locator('#loading');
const checkingRow = (page) => page.locator('#app-status-bar .status-row', { hasText: CHECKING });
// 起動の読込の失敗の行 (ハブ・GitHub とも。#666 で GitHub の toast をやめて、状態バーのこの行にそろえた)
const loadFailureRow = (page) => page.locator('#app-status-bar [data-load-failure]');
const syncStatus = (page) => page.locator('#obsidian-sync-status');
// plugin-seed.spec.js と同じ読み方 (bookshelf._* ではない)
const loadedPluginIds = (page) => page.evaluate(() => {
    const l = window.bookshelf && window.bookshelf.pluginLoader;
    return l ? [...l.loaded.keys()].sort() : [];
});

// 模擬より手前に置く口。cut.mode が null の間は模擬へ回す。'net' は通信の失敗
async function cutBefore(context, pattern, cut) {
    await context.route(pattern, (route) => (cut.mode ? route.abort('internetdisconnected') : route.fallback()));
}

// プラグインの一覧の要求 (ensureStandardPlugins と loadEnabledPlugins が1回ずつ読む) を数える
function countPluginListing(page, isListing) {
    const seen = { n: 0 };
    page.on('request', (req) => { if (req.method() === 'GET' && isListing(new URL(req.url()))) seen.n += 1; });
    return seen;
}

async function setupGitHub(page, context, mode = null) {
    const gh = createMockGitHubForTest();
    seedGitHubDataForTest(gh);
    await seedGitHubLoginForTest(page, gh);
    await mockGitHubForTest(page, gh);
    const cut = { mode };
    await cutBefore(context, 'https://api.github.com/**', cut);
    return { gh, cut };
}

async function setupHub(page, context, mode = null) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    const cut = { mode };
    await cutBefore(context, `${HUB_BASE}/**`, cut);
    return { hub, cut };
}

test('GitHub: 端末にデータが無い起動で読込が通信で失敗したら、読込の失敗の行が出てから2秒のうちに #loading の覆いが消える', async ({ page, context }) => {
    await setupGitHub(page, context, 'net');
    await page.goto('index.html');
    await expect(loadFailureRow(page)).toBeVisible({ timeout: 20_000 });
    await expect(loading(page), '読込の失敗の行が出た後も読み込み中の覆いが残っている (起動の後半が同じ失敗を待っている)').toBeHidden({ timeout: LEAVE_MS });
});

test('ハブ: 端末にデータが無い起動で読込が通信で失敗したら、読込の失敗の行が出てから2秒のうちに #loading の覆いが消える', async ({ page, context }) => {
    await setupHub(page, context, 'net');
    await page.goto('index.html');
    await expect(loadFailureRow(page)).toBeVisible({ timeout: 20_000 });
    await expect(loading(page), '読込の失敗の行が出た後も読み込み中の覆いが残っている').toBeHidden({ timeout: LEAVE_MS });
});

test('GitHub: 端末にデータがある起動で読込が通信で失敗したら、読込の失敗の行が出てから2秒のうちに「最新のデータを確認しています…」が消える', async ({ page, context }) => {
    const { cut } = await setupGitHub(page, context);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await expect(syncStatus(page)).toContainText('保存済み');
    cut.mode = 'net';
    await page.reload();
    await expect(loadFailureRow(page)).toBeVisible({ timeout: 20_000 });
    await expect(loading(page)).toBeHidden();
    await expect(checkingRow(page), '読込の失敗の行が出た後も「確認しています」が残っている').toHaveCount(0, { timeout: LEAVE_MS });
});

// 守り: 失敗させない起動では、#loading が消えた時に標準機能5個が有効で、読込も済んでいる
test('ハブ: 読込が成功する起動 (端末にデータ無し) では、#loading が消えた時に標準機能5個が有効になっている', async ({ page, context }) => {
    await setupHub(page, context);
    await page.goto('index.html');
    await expect(loading(page)).toBeHidden({ timeout: 20_000 });
    expect(await loadedPluginIds(page), '#loading が消えた時に標準機能が有効になっていない').toEqual(STANDARD_IDS);
    await expect(syncStatus(page)).toContainText('保存済み');
});

// 守り (②の指示 2): 初めから成功する起動では、起動の後半が1回だけ流れる (読込の成功の側に置く口で2回流さない)
test('ハブ: 読込が成功する起動では、プラグインの一覧を読むのは ensureStandardPlugins と loadEnabledPlugins の1回ずつ (2本) だけ', async ({ page, context }) => {
    const listing = countPluginListing(page, (u) => u.origin === HUB_BASE && u.pathname === '/data/plugins');
    await setupHub(page, context);
    await page.goto('index.html');
    await expect(loading(page)).toBeHidden({ timeout: 20_000 });
    await expect.poll(() => loadedPluginIds(page)).toEqual(STANDARD_IDS);
    // 2回流れるなら、1回目の後すぐに続く。少し待ってから数える
    await page.waitForTimeout(1500);
    expect(listing.n, 'プラグインの一覧の要求の本数 (起動の後半が2回流れると4本になる)').toBe(2);
});

test('GitHub: 読込が成功する起動では、プラグインの一覧を読むのは ensureStandardPlugins と loadEnabledPlugins の1回ずつ (2本) だけ', async ({ page, context }) => {
    const listing = countPluginListing(page, (u) => u.hostname === 'api.github.com' && /\/contents\/plugins$/.test(u.pathname));
    await setupGitHub(page, context);
    await page.goto('index.html');
    await expect(loading(page)).toBeHidden({ timeout: 20_000 });
    await expect(syncStatus(page)).toContainText('保存済み');
    await expect.poll(() => listing.n).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1500);
    expect(listing.n, 'プラグインの一覧の要求の本数 (起動の後半が2回流れると4本になる)').toBe(2);
});

// 案 (iii) の挙動: 失敗した起動では後半を流さず、通信が戻って読込が通った時に1回流す
test('ハブ: 読込が通信で失敗した起動の後に通信が戻ると、5秒のうちに標準機能5個が有効になる', async ({ page, context }) => {
    const { cut } = await setupHub(page, context);
    const hubNet = { last: Date.now() };
    page.on('request', (req) => { if (req.url().startsWith(HUB_BASE)) hubNet.last = Date.now(); });
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await expect.poll(() => loadedPluginIds(page), { message: '最初の起動で標準機能が有効になる' }).toEqual(STANDARD_IDS);
    cut.mode = 'net';
    await page.reload();
    await expect(loadFailureRow(page)).toBeVisible({ timeout: 20_000 });
    // 失敗した起動の後半 (直す前はここで流れて失敗する) が済むまで待ってから通信を戻す。待たずに戻すと、後半の残りの要求が
    // 戻った通信で通ってしまい、「戻った時に読み直したか」を見られない (ハブの後半は失敗の行から約50msで終わる・677-results §1)
    await expect.poll(() => Date.now() - hubNet.last, { timeout: 10_000, message: 'ハブへの要求が静まる' }).toBeGreaterThan(800);
    expect(await loadedPluginIds(page), '読込が失敗した起動ではプラグインは有効にならない').toEqual([]);
    // 通信を戻して 'online' を起こす (online-resync.spec.js と同じく、ブラウザの電波を一度落として戻す)
    cut.mode = null;
    await context.setOffline(true);
    await context.setOffline(false);
    await expect(syncStatus(page)).toContainText('保存済み', { timeout: 10_000 });
    await expect.poll(() => loadedPluginIds(page), {
        timeout: PLUGINS_AFTER_ONLINE_MS,
        message: '通信が戻って読込が通った後も、標準機能が有効にならない'
    }).toEqual(STANDARD_IDS);
});
