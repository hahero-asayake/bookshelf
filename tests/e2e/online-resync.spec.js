// イシュー#617: 電波が戻った時の送り直しの、門のE2E (gate/j8-4-online-resync.spec.js) で見ていない場面。
// 仕組みは #603 の _watchSyncRecovery (js/bookshelf.js) の1か所。'online' はブラウザの本物を使う (context.setOffline)。
// ハブは tests/e2e/helpers/gate-hub.js の模擬。chromium の setOffline は route の模擬を止めないので、
// ハブに届かない状態は、模擬より手前の route で通信を落として作る (helpers/gate-network.js と同じ理由)。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { HUB_BASE, createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const BOOK = 'フィクスチャの本 1';
const NOTES = 'private/notes.json';

const bookButton = (page) => page.getByRole('button', { name: BOOK, exact: true }).first();
const memoBox = (page) => page.locator('.note-textarea[data-scope="all"]:visible').first();
const statusBar = (page) => page.locator('#app-status-bar');
const hubHas = (hub, text) => { const e = hub.files.get(NOTES); return !!e && String(e.content).includes(text); };

async function prepareHub(page) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    return hub;
}

async function writeMemo(page, memo) {
    await bookButton(page).click();
    await memoBox(page).fill(memo);
    await expect(page.locator('.save-note-status:visible').first()).toContainText('保存しました');
}

test('電波なしのまま開き直した端末でも、電波が戻ると、前の回に書いた短文メモがハブに届く (イシュー#617 穴1)', async ({ page, context }) => {
    const MEMO = '電波なしの間に書いて、開き直した短文メモ';
    const hub = await prepareHub(page);
    const cut = { on: false, dropped: 0 };
    await context.route(`${HUB_BASE}/**`, (route) => {
        if (!cut.on) return route.fallback();
        cut.dropped += 1;
        return route.abort('internetdisconnected');
    });
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);

    // 電波なしの間に書く (1回目の送信は失敗し、保存待ちの印が端末に残る)
    cut.on = true;
    await context.setOffline(true);
    await writeMemo(page, MEMO);
    await expect.poll(() => cut.dropped, { timeout: 5000 }).toBeGreaterThan(0);
    expect(hubHas(hub, MEMO)).toBe(false);

    // 電波なしのまま開き直す。SW を止めた実行では電波なしの間にアプリのファイルを読めないので、ブラウザの電波だけ
    // 一時的に戻して再読込する。ハブへの通信は落としたまま = アプリから見れば、起動の間ずっとハブに届かない
    await context.setOffline(false);
    await page.reload();
    await expect(statusBar(page)).toContainText('読み込みに失敗しました', { timeout: 15000 });
    await context.setOffline(true);
    await expect(memoBox(page)).toHaveValue(MEMO); // 手元には残っている (再読込で本の詳細は開き直される)
    expect(hubHas(hub, MEMO)).toBe(false);

    // 電波が戻る (ほかには何もしない)
    cut.on = false;
    await context.setOffline(false);
    await expect.poll(() => hubHas(hub, MEMO), { timeout: 10000 }).toBe(true);
    await expect(statusBar(page)).toBeHidden();
});

test('最後の自動の再試行の送信中に電波が戻っても、その送信が失敗で終わった後に送り直す (イシュー#617 穴2)', async ({ page, context }) => {
    const MEMO = '最後の再試行の送信中に電波が戻った短文メモ';
    // 自動の再試行の間隔を短くして、3回の再試行をすぐに使い切らせる (E2E 用の口・js/sync-failure.js)
    await page.addInitScript(() => localStorage.setItem('bookshelf.flag.syncRetryDelaysMs', '[300,300,300]'));
    const hub = await prepareHub(page);
    // 読み込み (GET) は通し、それ以外 (保存の1回ごとの最初の通信は HEAD) を通信エラーで落とす。4回目 = 最後の再試行は握っておく
    const net = { failing: false, attempts: 0, release: null };
    let markHeld;
    const held = new Promise((resolve) => { markHeld = resolve; });
    await context.route(`${HUB_BASE}/**`, async (route) => {
        if (!net.failing || route.request().method() === 'GET') return route.fallback();
        net.attempts += 1;
        if (net.attempts === 4) await new Promise((resolve) => { net.release = resolve; markHeld(); });
        return route.abort('internetdisconnected');
    });
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);

    net.failing = true;
    await context.setOffline(true);
    await writeMemo(page, MEMO);
    await held; // 4回目 (最後の再試行) の送信中

    // 送信中に電波が戻る。握っていた送信は、その後に失敗で終わる (届かなかった)
    await context.setOffline(false);
    net.failing = false;
    net.release();

    await expect.poll(() => hubHas(hub, MEMO), { timeout: 10000 }).toBe(true);
    await expect(statusBar(page)).toBeHidden();
    expect(net.attempts).toBe(4); // 落とした送信は4回だけ = 電波が戻った後の送り直しは1回で届いた
});
