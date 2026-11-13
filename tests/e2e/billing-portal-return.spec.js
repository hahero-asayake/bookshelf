// 支払い管理 (Stripe Billing Portal) から戻った時に、プランを取り直して「解約予約済み」が出る (イシュー#604・J7-PORTAL-1)。
// 門の J7-2 (tests/e2e/gate/j7-billing.spec.js) は「ローカル保存のまま、アカウントにだけログイン」で戻る基本の形。
// ここでは、保存先がハブの時・Webhook が遅れた時・bfcache から戻った時を確かめる。
// chromium に加えて gate-webkit (iPhone 相当) でも流す (playwright.config.js の gateWebkitProjects に足してある)。
// ハブと決済は門と同じ模擬 (tests/e2e/helpers/gate-hub.js) を使う。
//
// 実際の bfcache の復元は Playwright では起きない (chromium・webkit とも、戻るが読み直しになる・イシュー#604 step1 で実測)。
// そのため bfcache の場合は、管理のページへの移動を 204 で止めて (ページはそのまま) pageshow (persisted) を送り、
// 受け口が取り直しを始めることだけを確かめる。本物の bfcache の復元そのものは確かめていない。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { createHubStateForTest, resetHubStateForTest, plusStateForTest, seedHubLoginForTest, mockHubForTest, mockBillingPagesForTest, HUB_BASE, BILLING_BASE } from './helpers/gate-hub.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf-8');
const MB = 1024 * 1024;

// ハブの中の蔵書 (保存先をハブにした時に、空のハブの確認を出さずに起動させるため)。形は tests/e2e/char/publish-hub.spec.js と同じ
function hubFilesForTest() {
    const library = JSON.parse(fixture('fixture-library.json'));
    const userData = JSON.parse(fixture('fixture-userdata.json'));
    return [
        ['private/library.json', JSON.stringify(library)],
        ['private/bookshelves.json', JSON.stringify({ bookshelves: [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }] })],
        ['private/bookshelves/all.json', JSON.stringify({ books: library.books.map((b) => b.asin) })],
        ['private/notes.json', JSON.stringify({ notes: userData.notes || {} })]
    ];
}

// GET /usage の応答 (gate-hub.js と同じ形)
const usageOf = (s) => ({
    plan: s.plan, usedBytes: s.usedBytes, quotaBytes: (s.plan === 'plus' ? 3072 : 100) * MB,
    billingManaged: s.billingManaged, planSource: s.planSource, subStatus: s.subStatus,
    interval: s.interval, currentPeriodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: s.cancelAtPeriodEnd, siteId: s.siteId
});

// Webhook の遅れ: on にした後の stale 回の GET /usage は、解約の前の中身を返す (後から足した route が先に効く)
async function delayWebhookForTest(page, hub, stale) {
    const d = { on: false, n: 0 };
    await page.route(`${HUB_BASE}/usage`, async (route) => {
        if (d.on && d.n < stale) { d.n += 1; return route.fulfill({ json: { ...usageOf(hub), cancelAtPeriodEnd: false } }); }
        return route.fallback();
    });
    return d;
}

// 保存先がハブの時の、ハブからの読み込み (起動の後半) が終わるまで待つ
async function waitForHubStartup(page) {
    await page.waitForFunction(() => {
        const loading = document.getElementById('loading');
        return window.bookshelf && !window.bookshelf._syncChecking && (!loading || loading.style.display === 'none');
    });
}

async function tapToAccountSettings(page) {
    await page.locator('[data-mobile-nav="settings"]').tap();
    await expect(page.locator('#settings-modal')).toBeVisible();
    await page.locator('#settings-master .settings-cat[data-cat="account-section"]').tap();
    await expect(page.locator('#account-email')).toHaveText('taro@example.com');
}

async function startPlus(page, hub, method) {
    resetHubStateForTest(hub, { ...plusStateForTest('monthly'), ...(method === 'hub' ? { files: hubFilesForTest() } : {}) });
    await seedHubLoginForTest(page, hub, { method });
    await mockHubForTest(page, hub);
    await mockBillingPagesForTest(page, hub);
}

// 管理のページで解約して、「アプリへ戻る」で戻る。beforeReturn は戻る直前に呼ぶ
async function cancelInPortalAndReturn(page, beforeReturn = () => {}) {
    await page.locator('#account-manage-billing').tap();
    await expect(page.getByRole('heading', { name: 'プランの管理（模擬）' })).toBeVisible();
    await page.getByRole('link', { name: '解約する' }).tap();
    await expect(page.getByRole('heading', { name: '解約を予約しました（模擬）' })).toBeVisible();
    beforeReturn();
    await page.getByRole('link', { name: 'アプリへ戻る' }).tap();
    await expect(page.getByText('フィクスチャの本 1').first()).toBeVisible();
}

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('保存先がハブでも、支払い管理で解約して戻ると、解約予約済みと表示される', async ({ page }) => {
    const hub = createHubStateForTest();
    await startPlus(page, hub, 'hub');
    await bootAppForTest(page);
    await waitForHubStartup(page);
    await tapToAccountSettings(page);
    await expect(page.locator('#account-plan-period')).toContainText('月額 ・ 次回更新');
    await cancelInPortalAndReturn(page);
    await waitForHubStartup(page);
    await tapToAccountSettings(page);
    await expect(page.locator('#account-plan-period')).toContainText('解約予約済み');
    await expect(page.locator('#account-plan-cancel')).toContainText('無料プランに戻ります');
});

for (const [method, stale] of [['local', 2], ['hub', 3]]) {
    // 戻った直後の取り直し (起動時の1回と、印を見た1回目。ハブ保存は読み込み後の1回も) が、まだ解約前の中身を受け取る形
    test(`Webhook が遅れても、支払い管理から戻った後に取り直して解約予約済みと表示される (保存先 ${method})`, async ({ page }) => {
        const hub = createHubStateForTest();
        await startPlus(page, hub, method);
        const delay = await delayWebhookForTest(page, hub, stale);
        await bootAppForTest(page);
        if (method === 'hub') await waitForHubStartup(page);
        await tapToAccountSettings(page);
        await expect(page.locator('#account-plan-period')).toContainText('月額 ・ 次回更新');
        await cancelInPortalAndReturn(page, () => { delay.on = true; });
        if (method === 'hub') await waitForHubStartup(page);
        await tapToAccountSettings(page);
        // 間隔を空けた取り直し (0・2・4・8・16 秒) のどれかで Webhook の後の中身が届く
        await expect(page.locator('#account-plan-period')).toContainText('解約予約済み', { timeout: 20000 });
        expect(delay.n).toBe(stale);
    });
}

test('bfcache から戻った時 (pageshow persisted) も、支払い管理の印を見てプランを取り直す', async ({ page }) => {
    const hub = createHubStateForTest();
    resetHubStateForTest(hub, plusStateForTest('monthly'));
    await seedHubLoginForTest(page, hub);
    await mockHubForTest(page, hub);
    // 管理のページへの移動を 204 で止める (ページは変わらず、起動の処理も走らない)。止めた時点で解約されたことにする
    await page.route(`${BILLING_BASE}/**`, (route) => { hub.cancelAtPeriodEnd = true; return route.fulfill({ status: 204, body: '' }); });
    await bootAppForTest(page);
    await tapToAccountSettings(page);
    await expect(page.locator('#account-plan-period')).toContainText('月額 ・ 次回更新');
    await page.locator('#account-manage-billing').tap();
    await expect.poll(() => hub.cancelAtPeriodEnd).toBe(true);
    // まだ取り直していない (戻りの入口が走っていない)
    await page.waitForTimeout(500);
    await expect(page.locator('#account-plan-period')).toContainText('月額 ・ 次回更新');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(page.locator('#account-plan-period')).toContainText('解約予約済み');
});
