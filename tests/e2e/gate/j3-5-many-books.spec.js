// 門のE2E (イシュー#590・仕上げは #629)。観測点 J3-5「多数の蔵書でも詰まらない」。数値 (件数・ms) で判定する。
// 条件は tests/e2e/sort-perf-budget.spec.js と揃える (913冊・390×844・CPU 6倍遅く)。並び順の切替と昇順・降順の
// 切替について、(1) 冊数の表示が 913、(2) 操作してから次の描画まで、(3) 直後に本を押してから次の描画まで、を測る。
// 時間はページの中で測る (前提の recordInPageTimingsForTest が、画面の隠し要素 #gate-timings の data 属性に書き出す。
// 操作 → requestAnimationFrame → setTimeout 0 までの ms)。テスト側の時計は Playwright の往復が数百ms 乗るため
// 使わない (②決定・2026-11-14 #590 step5)。
// 基準は sort-perf-budget.spec.js の BUDGET をそのまま使う ((2) を tFrame、(3) を inputDelay と比べる)。
// 書き方は tests/e2e/gate/README.md。
import { test, expect } from '../helpers/test-base.js';
import { seedManyBooksForTest, bootAppForTest, throttleCpuForTest, recordInPageTimingsForTest } from '../helpers/gate-setup.js';

const N = 913;
const BUDGET = { order: { tFrame: 380, inputDelay: 420 }, direction: { tFrame: 340, inputDelay: 320 } };
const listItems = (page) => page.locator('#bookshelf .book-item');
const detail = (page) => page.locator('#book-detail-pane');
const root = (page) => page.locator('#gate-timings');
// name の記録が count 回目まで済んだ印。記録が済むのは、この locator が1つ見つかることで待つ (toHaveCount)。
// expect(…).toHaveAttribute で待つと、913冊・CPU 6倍の下ではその問い合わせがページを数秒塞ぎ、測る値そのものが
// 遅れる (イシュー#629 で実測: toHaveAttribute は 1645〜5036ms・toHaveCount は 112〜154ms)
const recorded = (page, name, count) => page.locator(`#gate-timings[data-gate-${name}-count="${count}"]`);
// 記録が無い時 (属性が無い = null) は NaN にする (Number(null) は 0 で、基準以内として通ってしまう)
const msOf = async (page, name) => {
    const value = await root(page).getAttribute(`data-gate-${name}-ms`);
    return value === null ? NaN : Number(value);
};

test.use({ viewport: { width: 390, height: 844 } });

test('@gate J3-5 913冊・CPU 6倍遅くでも、並び順と昇順・降順の切替と直後の本の詳細が、ページの中で測って基準時間内に出る', async ({ page }) => {
    await test.step('前提: 913冊を入れてアプリを開き、ページの中の時間を測る仕組みを入れ、CPU を6倍遅くしておく', async () => {
        await seedManyBooksForTest(page, N);
        await recordInPageTimingsForTest(page);
        await bootAppForTest(page);
        await throttleCpuForTest(page, 6);
    });

    await test.step('操作: 下のナビの「本棚」→「すべての本」を開き、「表示」を開く', async () => {
        await page.locator('[data-mobile-nav="shelves"]').click();
        await page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-label').click();
        await expect(listItems(page).first()).toBeVisible();
        await page.locator('#toggle-display').click();
        await expect(page.locator('#sort-order')).toBeVisible();
    });

    await test.step('確認: 冊数の表示が 913', async () => {
        await expect(page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-count')).toHaveText(String(N));
    });

    await test.step('操作: 並び順を「タイトル」に切り替え、直後に先頭の本を押す', async () => {
        await page.locator('#sort-order').selectOption('title');
        await expect(recorded(page, 'sort-order', 1)).toHaveCount(1);
        await page.keyboard.press('Escape');
        await listItems(page).first().click();
        await expect(recorded(page, 'open-detail', 1)).toHaveCount(1);
        await expect(detail(page)).toContainText('物語');
    });

    await test.step('確認: 並び順の切替は 380ms 以内、直後に本を押してからは 420ms 以内 (ページの中で測った値)', async () => {
        const order = await msOf(page, 'sort-order');
        const open = await msOf(page, 'open-detail');
        test.info().annotations.push({ type: 'gate-j3-5-ms', description: JSON.stringify({ order, openAfterOrder: open }) });
        expect.soft(order, `並び順の切替→次の描画 ${order}ms (測れていること)`).toBeGreaterThan(0);
        expect.soft(open, `並び順の切替の直後に本を押す→次の描画 ${open}ms (測れていること)`).toBeGreaterThan(0);
        expect.soft(order, `並び順の切替→次の描画 ${order}ms`).toBeLessThanOrEqual(BUDGET.order.tFrame);
        expect.soft(open, `並び順の切替の直後に本を押す→次の描画 ${open}ms`).toBeLessThanOrEqual(BUDGET.order.inputDelay);
    });

    await test.step('操作: 一覧に戻って「表示」を開き、昇順・降順を切り替え、直後に先頭の本を押す', async () => {
        await page.goBack();
        await page.locator('#toggle-display').click();
        await page.locator('#sort-direction').click();
        await expect(recorded(page, 'sort-direction', 1)).toHaveCount(1);
        await page.keyboard.press('Escape');
        await listItems(page).first().click();
        await expect(recorded(page, 'open-detail', 2)).toHaveCount(1);
        await expect(detail(page)).toContainText('物語');
    });

    await test.step('確認: 昇順・降順の切替は 340ms 以内、直後に本を押してからは 320ms 以内 (ページの中で測った値)', async () => {
        const direction = await msOf(page, 'sort-direction');
        const open = await msOf(page, 'open-detail');
        test.info().annotations.push({ type: 'gate-j3-5-ms', description: JSON.stringify({ direction, openAfterDirection: open }) });
        expect.soft(direction, `昇降の切替→次の描画 ${direction}ms (測れていること)`).toBeGreaterThan(0);
        expect.soft(open, `昇降の切替の直後に本を押す→次の描画 ${open}ms (測れていること)`).toBeGreaterThan(0);
        expect.soft(direction, `昇降の切替→次の描画 ${direction}ms`).toBeLessThanOrEqual(BUDGET.direction.tFrame);
        expect.soft(open, `昇降の切替の直後に本を押す→次の描画 ${open}ms`).toBeLessThanOrEqual(BUDGET.direction.inputDelay);
    });
});
