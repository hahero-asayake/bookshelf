// イシュー#666: ハブ・GitHub の起動の読込が通信で失敗した時の文に「次にどうすればよいか」を入れ、出す場所を揃える
// (ui-standards §2-11「何が起きたか＋次にどうすればよいか」)。決めたこと (step1 の tp・案A＋(b)):
//   - 文は「〈保存先〉から読み込めませんでした。この端末の内容を表示しています。通信が戻ったら「再試行」を押してください。」
//   - 状態バーと設定の同期欄の2か所に同じ文と「再試行」を出す。GitHub の toast はやめる (ハブは今も出していない)
//   - 「再試行」を押すと読み直し、読めたら状態バーの行が消えて同期欄が「保存済み」になる。素早く2回押しても読み直しは1回
// 認証切れの文は対象外 (#653 で決めた文のまま)。作り方は boot-load-failure-status.spec.js (#653)・online-resync.spec.js (#617) と同じ:
// 1回ふつうに起動してから、模擬より手前の route で起動の読込を落として開き直す。
// 同期欄は設定の中にあり、設定を開いていない間は見えない。文字は textContent で見て、見えるかどうかは問わない。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { HUB_BASE, createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';
import { createMockGitHubForTest, seedGitHubDataForTest, seedGitHubLoginForTest, mockGitHubForTest } from './helpers/gate-github.js';
import { openSettingsByClick } from './helpers/settings.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const HUB_MSG = 'Asayake ハブから読み込めませんでした。この端末の内容を表示しています。通信が戻ったら「再試行」を押してください。';
const GH_MSG = 'GitHub から読み込めませんでした。この端末の内容を表示しています。通信が戻ったら「再試行」を押してください。';
const HUB_LABEL = 'Asayake ハブ';
// 認証切れの文 (#653 で決めた文・このイシューでは変えない)
const HUB_AUTH = 'Asayake ハブ の認証が切れました。設定から再接続してください。';
const GH_AUTH_TOAST = 'GitHub との接続に失敗しました。';
const GH_AUTH_FIELD = 'GitHub との接続に失敗しました。「切断」してから、もう一度「GitHub に接続」をお試しください。';

const syncStatus = (page) => page.locator('#obsidian-sync-status');
const syncPath = (page) => page.locator('#obsidian-sync-path');
const statusBar = (page) => page.locator('#app-status-bar');
const barMessages = (page) => page.locator('#app-status-bar .status-row .status-msg');
const barRow = (page, msg) => page.locator('#app-status-bar .status-row', { has: page.locator('.status-msg', { hasText: msg }) });
const syncRetry = (page) => page.locator('#sync-state-actions button', { hasText: '再試行' });
// 読込の失敗の toast (直す前の文・決めた文のどちらでも当たる)
const loadFailToast = (page) => page.locator('.toast-message', { hasText: /から読み込めませんでした|からの読み込みに失敗しました/ });
const ghLabel = (gh) => `${gh.owner}/${gh.repo}@${gh.branch}`;

// 模擬より手前に置く口。cut.mode が null の間は模擬へ回す (cut.counting の間は読み込みの GET を数える)。
// 'net' は通信の失敗、'auth' は 401 (GitHub の認証切れ)
async function cutBefore(context, pattern, cut) {
    await context.route(pattern, (route) => {
        if (!cut.mode) {
            if (cut.counting && route.request().method() === 'GET') cut.gets += 1;
            return route.fallback();
        }
        if (cut.mode === 'auth') return route.fulfill({ status: 401, json: { message: 'Bad credentials' } });
        return route.abort('internetdisconnected');
    });
}

async function bootHub(page, context) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    const cut = { mode: null, counting: false, gets: 0 };
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
    const cut = { mode: null, counting: false, gets: 0 };
    await cutBefore(context, 'https://api.github.com/**', cut);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await expect(syncStatus(page)).toContainText('保存済み');
    return { gh, cut };
}

// 起動の読込の catch まで届いた (同期欄が、空・読み込み中・保存済みのどれでもない文になった) のを待つ。文そのものは後で見る
async function waitLoadSettled(page) {
    await expect(syncStatus(page)).not.toHaveText(/^$|読み込み中|保存済み/, { timeout: 20_000 });
}

// 決めた2か所に同じ文と「再試行」があり、toast は出ていない (どれが違うかを1回で全部見るため soft にする)
async function expectLoadFailure(page, { msg, path }) {
    await waitLoadSettled(page);
    // toast は10秒で消えるので、ほかの soft の待ちより先に見る (同期欄の文と同じ catch の中で出す＝出るならもう出ている)
    await expect.soft(loadFailToast(page), '読込の失敗の toast は出さない').toHaveCount(0);
    await expect.soft(syncStatus(page), '同期欄は決めた文').toHaveText(msg);
    await expect.soft(barMessages(page), '状態バーの行の文 (全部)').toContainText([msg]);
    await expect.soft(barRow(page, msg).locator('.status-msg'), '状態バーの行は決めた文とちょうど同じ').toHaveText(msg);
    await expect.soft(barRow(page, msg).getByRole('button', { name: '再試行' }), '状態バーの行に「再試行」').toHaveCount(1);
    await expect.soft(syncRetry(page), '同期欄に「再試行」').toHaveCount(1);
    await expect.soft(syncPath(page), 'path に「（要再接続）」を付けない (#653)').toHaveText(path);
}

// 読み込みの GET の数が落ち着く (0.7秒あけて2回同じ) まで待ち、その数を返す
async function settledGets(cut) {
    let last = -1;
    await expect.poll(() => {
        const same = cut.gets === last;
        last = cut.gets;
        return same;
    }, { intervals: [700], timeout: 15_000 }).toBe(true);
    return cut.gets;
}

test('ハブ: 起動の読込が通信で失敗した時、状態バーと同期欄に同じ文と「再試行」を出し、toast は出さない', async ({ page, context }) => {
    const { cut } = await bootHub(page, context);
    cut.mode = 'net';
    await page.reload();
    await expectLoadFailure(page, { msg: HUB_MSG, path: HUB_LABEL });
});

test('GitHub: 起動の読込が通信で失敗した時、状態バーと同期欄に同じ文と「再試行」を出し、toast は出さない', async ({ page, context }) => {
    const { gh, cut } = await bootGitHub(page, context);
    cut.mode = 'net';
    await page.reload();
    await expectLoadFailure(page, { msg: GH_MSG, path: ghLabel(gh) });
});

test('ハブ: 通信が戻ってから状態バーの「再試行」を押すと読み直し、行が消えて同期欄が「保存済み」になる', async ({ page, context }) => {
    const { cut } = await bootHub(page, context);
    cut.mode = 'net';
    await page.reload();
    const retry = barRow(page, HUB_MSG).getByRole('button', { name: '再試行' });
    await expect(retry, '状態バーの読込の失敗の行に「再試行」').toBeVisible({ timeout: 20_000 });
    cut.mode = null;
    await retry.click();
    await expect(syncStatus(page)).toContainText('保存済み', { timeout: 15_000 });
    await expect(barRow(page, HUB_MSG), '読めたら状態バーの行は消える').toHaveCount(0);
    await expect(syncRetry(page), '読めたら同期欄の「再試行」も消える').toHaveCount(0);
});

test('GitHub: 通信が戻ってから設定の同期欄の「再試行」を押すと読み直し、同期欄が「保存済み」になり状態バーの行も消える', async ({ page, context }) => {
    const { cut } = await bootGitHub(page, context);
    cut.mode = 'net';
    await page.reload();
    await waitLoadSettled(page);
    await expect(syncStatus(page), '同期欄は決めた文').toHaveText(GH_MSG);
    cut.mode = null;
    await openSettingsByClick(page, 'sync-section');
    const retry = page.locator('#sync-state-actions').getByRole('button', { name: '再試行' });
    await expect(retry, '同期欄に「再試行」が見える').toBeVisible();
    await retry.click();
    await expect(syncStatus(page)).toContainText('保存済み', { timeout: 15_000 });
    await expect(syncRetry(page), '読めたら同期欄の「再試行」は消える').toHaveCount(0);
    await expect(barRow(page, GH_MSG), '読めたら状態バーの行も消える').toHaveCount(0);
});

test('ハブ: 「再試行」を素早く2回押しても、読み直しの GET は1回押した時と同じ数 (読み直しは1回だけ)', async ({ page, context }) => {
    const { cut } = await bootHub(page, context);
    const retry = barRow(page, HUB_MSG).getByRole('button', { name: '再試行' });
    // 1回押した時の読み直しの GET の数を、同じテストの中で測る
    cut.mode = 'net';
    await page.reload();
    await expect(retry, '状態バーの読込の失敗の行に「再試行」').toBeVisible({ timeout: 20_000 });
    cut.mode = null;
    cut.counting = true;
    cut.gets = 0;
    await retry.click();
    await expect(syncStatus(page)).toContainText('保存済み', { timeout: 15_000 });
    const once = await settledGets(cut);
    expect(once, '1回押しで読み直しの GET が出ている').toBeGreaterThan(0);
    // もう一度落として、今度は素早く2回押す
    cut.counting = false;
    cut.mode = 'net';
    await page.reload();
    await expect(retry).toBeVisible({ timeout: 20_000 });
    cut.mode = null;
    cut.counting = true;
    cut.gets = 0;
    await retry.dblclick();
    await expect(syncStatus(page)).toContainText('保存済み', { timeout: 15_000 });
    const twice = await settledGets(cut);
    expect(twice, `素早く2回押した時の GET の数 (1回押しは ${once})`).toBe(once);
});

test('守り ハブ: 起動の読込が認証切れで失敗した時の文は、#653 で決めた文のまま', async ({ page, context }) => {
    const { hub } = await bootHub(page, context);
    // 古い接続キーが使えない形 (gate-hub.js の模擬が 401 'invalid key' を返す)
    hub.deleted = true;
    await page.reload();
    await expect(statusBar(page)).toContainText(HUB_AUTH, { timeout: 20_000 });
    await expect(syncStatus(page)).toHaveText(HUB_AUTH);
    await expect(syncPath(page)).toHaveText(`${HUB_LABEL}（要再接続）`);
});

test('守り GitHub: 起動の読込が認証切れで失敗した時の文は、#653 で決めた文のまま', async ({ page, context }) => {
    const { gh, cut } = await bootGitHub(page, context);
    cut.mode = 'auth';
    await page.reload();
    await expect(page.locator('.toast-message', { hasText: GH_AUTH_TOAST })).toBeVisible({ timeout: 20_000 });
    await expect(syncStatus(page)).toHaveText(GH_AUTH_FIELD);
    await expect(syncPath(page)).toHaveText(`${ghLabel(gh)}（要再接続）`);
});
