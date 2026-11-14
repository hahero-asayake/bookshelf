// イシュー#617: 電波が戻った時の送り直しの、門のE2E (gate/j8-4-online-resync.spec.js) で見ていない場面。
// 仕組みは #603 の _watchSyncRecovery (js/bookshelf.js) の1か所。'online' はブラウザの本物を使う (context.setOffline)。
// ハブは tests/e2e/helpers/gate-hub.js の模擬。chromium の setOffline は route の模擬を止めないので、
// ハブに届かない状態は、模擬より手前の route で通信を落として作る (helpers/gate-network.js と同じ理由)。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { HUB_BASE, createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';
import { createMockGitHubForTest, seedGitHubDataForTest, seedGitHubLoginForTest, mockGitHubForTest, waitForGitHubFileContainsForTest } from './helpers/gate-github.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const BOOK = 'フィクスチャの本 1';
const NOTES = 'private/notes.json';

const bookButton = (page) => page.getByRole('button', { name: BOOK, exact: true }).first();
const memoBox = (page) => page.locator('.note-textarea[data-scope="all"]:visible').first();
const statusBar = (page) => page.locator('#app-status-bar');
const hubHas = (hub, text) => { const e = hub.files.get(NOTES); return !!e && String(e.content).includes(text); };

// 見本の library.json には exportDate が無い。アプリが保存した保存先には必ず入っているので、足しておく。
// 無いと、開き直した後の読み込みが「初めて揃える保存先」の扱いになり、手元に未反映の編集があれば、
// 送らずに3択を出して止まる (イシュー#602 の _decideLoadedState。保存先が変わっていなければ手元を書き戻す決まり)
const SEED_EXPORT_DATE = '2026-11-01T00:00:00.000Z';
const withExportDate = (json) => JSON.stringify({ ...JSON.parse(json), exportDate: SEED_EXPORT_DATE });

async function prepareHub(page) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    const lib = hub.files.get('private/library.json');
    hub.files.set('private/library.json', { ...lib, content: withExportDate(lib.content) });
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
    // 読込の失敗の文 (js/sync-failure.js の loadFailure・イシュー#666)
    await expect(statusBar(page)).toContainText('Asayake ハブから読み込めませんでした。この端末の内容を表示しています。通信が戻ったら「再試行」を押してください。', { timeout: 15000 });
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

test('GitHub でも、電波なしのまま開き直した端末は、電波が戻ると読み直して、前の回に書いた短文メモを届ける (イシュー#617 穴1)', async ({ page, context }) => {
    const MEMO = 'GitHub で電波なしの間に書いて、開き直した短文メモ';
    const gh = createMockGitHubForTest();
    seedGitHubDataForTest(gh);
    const libSha = gh.trees.get(gh.commits.get(gh.head).tree).get('private/library.json');
    gh.blobs.set(libSha, withExportDate(gh.blobs.get(libSha)));
    await seedGitHubLoginForTest(page, gh);
    await mockGitHubForTest(page, gh);
    const cut = { on: false, dropped: 0 };
    await context.route('https://api.github.com/**', (route) => {
        if (!cut.on) return route.fallback();
        cut.dropped += 1;
        return route.abort('internetdisconnected');
    });
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);

    // 電波なしの間に書く (GitHub に届かない)
    cut.on = true;
    await context.setOffline(true);
    await writeMemo(page, MEMO);
    await expect.poll(() => cut.dropped, { timeout: 5000 }).toBeGreaterThan(0);

    // 電波なしのまま開き直す (ハブの時と同じ作り方: ブラウザの電波だけ一時的に戻し、GitHub への通信は落としたまま)
    await context.setOffline(false);
    await page.reload();
    // 状態バーの文で待つ (GitHub も toast をやめ、状態バーと設定の同期欄に同じ文を出す・イシュー#666)
    await expect(statusBar(page)).toContainText('GitHub から読み込めませんでした。この端末の内容を表示しています。通信が戻ったら「再試行」を押してください。', { timeout: 15000 });
    await context.setOffline(true);
    await expect(memoBox(page)).toHaveValue(MEMO); // 手元には残っている

    // 電波が戻る (ほかには何もしない)
    cut.on = false;
    await context.setOffline(false);
    await waitForGitHubFileContainsForTest(gh, NOTES, MEMO, 10000);
});

// ===== 二重に送らない・保存中に重ならない (イシュー#617 step3) =====

const failureRow = (page) => page.locator('#app-status-bar .status-row[data-sync-failure]');
const pendingFlag = (page) => page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingSync'));
// ハブの模擬まで届いた、読み込み以外の通信の数 (保存の1回は HEAD で始まり、まとめ書きの POST が続く)
const hubSends = (hub) => hub.requests.filter((r) => r.method !== 'GET').length;
// 保存の予約 (800ms) と、短くした自動の再試行の番をまたいで、落ち着くまで待つ
const settle = (page, ms = 2500) => page.waitForTimeout(ms);

// 自動の再試行の間隔を差し替える (E2E 用の口・js/sync-failure.js)。1回目の再試行はすぐ、その後の番は60秒後にする =
// 知らせが出た後に電波が戻った時、10秒以内に届くのは 'online' の送り直しだけになる
const useRetryDelays = (page, delays = [300, 60000, 60000]) => page.addInitScript((d) => {
    localStorage.setItem('bookshelf.flag.syncRetryDelaysMs', d);
}, JSON.stringify(delays));

// ハブの模擬の手前に置く見張り。cut の間は通信を落とす。texts のどれかを本文に持つ書き込みは、ハブへ届いた回数
// (delivered) と、同時に流れている数の最大 (maxInFlight) を数え、delayMs があればその分だけ遅らせる
async function watchHub(context, page, texts) {
    const w = { cut: false, dropped: 0, delayMs: 0, inFlight: 0, maxInFlight: 0, delivered: Object.fromEntries(texts.map((t) => [t, 0])) };
    const carried = (req) => { const body = req.postData() || ''; return texts.filter((t) => body.includes(t)); };
    await context.route(`${HUB_BASE}/**`, async (route) => {
        const hit = w.cut ? [] : carried(route.request());
        if (hit.length && w.delayMs) await new Promise((resolve) => setTimeout(resolve, w.delayMs));
        if (w.cut) { w.dropped += 1; return route.abort('internetdisconnected'); }
        hit.forEach((t) => { w.delivered[t] += 1; });
        return route.fallback();
    });
    const carries = (req) => req.url().startsWith(HUB_BASE) && carried(req).length > 0;
    page.on('request', (req) => { if (carries(req)) { w.inFlight += 1; w.maxInFlight = Math.max(w.maxInFlight, w.inFlight); } });
    const done = (req) => { if (carries(req)) w.inFlight -= 1; };
    page.on('requestfinished', done);
    page.on('requestfailed', done);
    return w;
}

// 電波なしの間に短文メモを書き、1回目の自動の再試行も失敗して、知らせが出るところまで進める
async function writeMemoOffline(page, context, w, memo) {
    w.cut = true;
    await context.setOffline(true);
    await writeMemo(page, memo);
    await expect(failureRow(page)).toBeVisible({ timeout: 10000 });
    expect(await pendingFlag(page)).toBe('1');
}

async function expectSettledClean(page) {
    await expect(statusBar(page)).toBeHidden();
    await expect.poll(() => pendingFlag(page), { timeout: 10000 }).toBe(null);
}

test('(a) 電波なしの間に書いた短文メモは、電波が戻ると1回だけ送られ、知らせと保存待ちの印が消える', async ({ page, context }) => {
    const MEMO = '二重に送らないことを見る短文メモ';
    await useRetryDelays(page);
    const hub = await prepareHub(page);
    const w = await watchHub(context, page, [MEMO]);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await writeMemoOffline(page, context, w, MEMO);

    w.cut = false;
    await context.setOffline(false);
    await expect.poll(() => hubHas(hub, MEMO), { timeout: 10000 }).toBe(true);
    await expectSettledClean(page);

    await settle(page);
    expect(w.delivered[MEMO]).toBe(1);
});

test('(b) 電波の切り替えが短い間に2回続いても、送るのは1回だけ', async ({ page, context }) => {
    const MEMO = '切り替えが2回続いた時の短文メモ';
    await useRetryDelays(page);
    const hub = await prepareHub(page);
    const w = await watchHub(context, page, [MEMO]);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await writeMemoOffline(page, context, w, MEMO);

    // 戻る → 切れる → 戻る、を間を置かずに行う
    w.cut = false;
    await context.setOffline(false);
    w.cut = true;
    await context.setOffline(true);
    w.cut = false;
    await context.setOffline(false);
    await expect.poll(() => hubHas(hub, MEMO), { timeout: 10000 }).toBe(true);
    await expectSettledClean(page);

    await settle(page);
    expect(w.delivered[MEMO]).toBe(1);
});

test('(c) 送信中に電波が戻っても同時には送らず、終わった後に、送信中に書き直した分を1回だけ送る', async ({ page, context }) => {
    const FIRST = '送信中の確認で先に書いた短文メモ';
    const SECOND = '送信中の確認で書き直した短文メモ';
    await useRetryDelays(page);
    const hub = await prepareHub(page);
    const w = await watchHub(context, page, [FIRST, SECOND]);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await writeMemoOffline(page, context, w, FIRST);

    // 電波が戻る。短文メモを運ぶ送信は 2.5秒かかる
    w.delayMs = 2500;
    w.cut = false;
    await context.setOffline(false);
    await expect.poll(() => w.inFlight, { timeout: 10000 }).toBe(1);

    // その送信中に、もう一度 電波が切れて戻り (ハブには届く)、短文メモを書き直す
    await context.setOffline(true);
    await context.setOffline(false);
    await memoBox(page).fill(SECOND);
    await expect.poll(() => hubHas(hub, SECOND), { timeout: 15000 }).toBe(true);
    await expectSettledClean(page);

    await settle(page, 4000);
    expect(w.maxInFlight).toBe(1);
    expect(w.delivered[FIRST]).toBe(1);
    expect(w.delivered[SECOND]).toBe(1);
});

test('(d) 保存待ちが無い時は、電波が戻っても何も送らない', async ({ page, context }) => {
    const MEMO = '保存待ちが無い時の確認の短文メモ';
    await useRetryDelays(page);
    const hub = await prepareHub(page);
    const w = await watchHub(context, page, [MEMO]);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);

    // まだ一度も保存に失敗していない端末
    await settle(page);
    let before = hubSends(hub);
    await context.setOffline(true);
    await context.setOffline(false);
    await settle(page);
    expect(hubSends(hub)).toBe(before);

    // 電波なしの間の分を、電波が戻って送り終えた後
    await writeMemoOffline(page, context, w, MEMO);
    w.cut = false;
    await context.setOffline(false);
    await expect.poll(() => hubHas(hub, MEMO), { timeout: 10000 }).toBe(true);
    await expectSettledClean(page);
    await settle(page);
    before = hubSends(hub);
    await context.setOffline(true);
    await context.setOffline(false);
    await settle(page);
    expect(hubSends(hub)).toBe(before);
    expect(w.delivered[MEMO]).toBe(1);
});
