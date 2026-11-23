// イシュー#771 step5（ハヘロ決裁 2026-11-24）:
// ③ artEntryTitle: 本の詳細「この本で記事を書く」から作った記事は、題の初期値が本の題名（一覧で見分けて消しやすくする）。
//    何も書かずに ← で戻っても、題が本の題名の記事が1件保存先に残る（開いた時点で作る今の動きは残す）。
// ④ artSavedStamp: 送れたら状態欄に「✓ 保存済み H:MM」を残す。
// どちらも切り替え bookshelf.flag.<名>='0' で前の形（無題・「保存しました」）。iPhone 13 の画面・タッチで流す。
import { test, expect } from './helpers/test-base.js';
import { devices } from '@playwright/test';
import { bootAppForTest } from './helpers/gate-setup.js';
import { flushArtSaveAndRemote } from './helpers/art-editor.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';

const { defaultBrowserType: _b, ...iphone } = devices['iPhone 13'];
test.use(iphone);

const ART = 'private/publish/articles.json';
const STAMP = /✓ 保存済み \d{1,2}:\d{2}/;

async function bootHub(page, flags = {}) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    // 起動の後に入れる (#770 の作法)
    await page.evaluate((f) => { for (const [k, v] of Object.entries(f)) localStorage.setItem('bookshelf.flag.' + k, v); }, flags);
    const articles = () => { const f = hub.files.get(ART); try { return f ? (JSON.parse(f.content).articles || []) : []; } catch (_) { return []; } };
    return { articles };
}

// 本の詳細から書き始め、何も書かずに ← で戻る。開いた本の題名を返す
async function writeFromBookAndBack(page) {
    await page.locator('[data-mobile-nav="shelves"]').click();
    await expect(page.locator('body')).toHaveClass(/drawer-open/);
    await page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: 'すべて' }).first().click();
    await expect(page.locator('#bookshelf .book-item').first()).toBeVisible();
    await page.locator('#bookshelf .book-item').first().click();
    const asin = await page.locator('#bookshelf .book-item').first().getAttribute('data-asin');
    const bookTitle = await page.evaluate((a) => ((window.bookshelf.books || []).find((b) => b.asin === a) || {}).title || '', asin);
    await page.locator('.bd-actions .bd-write-article:visible').click();
    await expect(page.locator('#art-edit-view')).toBeVisible();
    return { bookTitle, back: () => page.locator('#art-back').click() };
}

test('#771 ③④: 本の詳細から書き始めると題が本の題名・送れたら「✓ 保存済み H:MM」・何も書かずに戻ると題が本の題名の記事が1件残る', async ({ page }) => {
    test.setTimeout(90_000);
    const { articles } = await bootHub(page);
    const { bookTitle, back } = await writeFromBookAndBack(page);
    expect(bookTitle).not.toBe('');
    await expect(page.locator('#art-title')).toHaveValue(bookTitle);
    // 送る前は「保存中…」(開いた直後に保存を予約する)・送れたら時刻つきの文が残る
    await flushArtSaveAndRemote(page);
    await expect(page.locator('#art-save-status')).toHaveText(STAMP, { timeout: 10000 });
    await back();
    await detailVisible(page); // ② artEntryReturn: 本の詳細へ帰る
    await expect.poll(() => articles().length, { timeout: 10000 }).toBe(1);
    expect(articles()[0].title).toBe(bookTitle);
});

test('#771 ③: 題を人が書き換えたら、そちらが保存される', async ({ page }) => {
    test.setTimeout(90_000);
    const { articles } = await bootHub(page);
    const { back } = await writeFromBookAndBack(page);
    await page.locator('#art-title').fill('自分で付けた題');
    await page.waitForTimeout(800);
    await back();
    await detailVisible(page);
    await expect.poll(() => (articles()[0] || {}).title, { timeout: 10000 }).toBe('自分で付けた題');
});

test("#771 ③④: 切り替え artEntryTitle='0'・artSavedStamp='0' では前の形（無題・「保存しました」）", async ({ page }) => {
    test.setTimeout(90_000);
    const { articles } = await bootHub(page, { artEntryTitle: '0', artSavedStamp: '0' });
    const { back } = await writeFromBookAndBack(page);
    await expect(page.locator('#art-title')).toHaveValue('');
    await flushArtSaveAndRemote(page);
    await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 10000 });
    await back();
    await expect.poll(() => (articles()[0] || {}).title, { timeout: 10000 }).toBe('無題の記事');
});

// ---- ② artEntryReturn・スワイプ artSwipeExit ----
const detailVisible = (page) => expect(page.locator('.bd-actions .bd-write-article:visible')).toBeVisible({ timeout: 10000 });

test('#771 ②: 本の詳細から書き始めた記事は ← で本の詳細へ帰る（公開の一覧は閉じる）', async ({ page }) => {
    test.setTimeout(90_000);
    const { articles } = await bootHub(page);
    const { back } = await writeFromBookAndBack(page);
    await page.locator('#art-title').fill('入口へ帰る題');
    await back();
    await detailVisible(page);
    await expect(page.locator('#publish-pages-modal')).not.toHaveClass(/show/);
    await expect.poll(() => (articles()[0] || {}).title, { timeout: 10000 }).toBe('入口へ帰る題');
});

test('#771 スワイプ: 本の詳細から書き始めた編集画面で戻る1回＝← と同じ（保存して本の詳細へ）', async ({ page }) => {
    test.setTimeout(90_000);
    const { articles } = await bootHub(page);
    await writeFromBookAndBack(page);
    await page.locator('#art-title').fill('スワイプで戻る題');
    await page.goBack();
    await detailVisible(page);
    await expect(page.locator('#publish-pages-modal')).not.toHaveClass(/show/);
    await expect.poll(() => (articles()[0] || {}).title, { timeout: 10000 }).toBe('スワイプで戻る題');
});

test("#771 ②='0': 前の形（← で公開の一覧へ）", async ({ page }) => {
    test.setTimeout(90_000);
    await bootHub(page, { artEntryReturn: '0' });
    const { back } = await writeFromBookAndBack(page);
    await back();
    await expect(page.locator('#art-list-view')).toBeVisible();
});

test('#771 スワイプ: 送れなかった時は編集画面にとどまり、エラーを出したまま（段を積み直す）', async ({ page }) => {
    test.setTimeout(90_000);
    await bootHub(page);
    await writeFromBookAndBack(page);
    await flushArtSaveAndRemote(page);
    await page.route('**/data/private/publish/articles.json*', (route) => (route.request().method() === 'PUT' ? route.abort('failed') : route.fallback()));
    await page.locator('#art-title').fill('送れない題');
    await page.goBack();
    await expect(page.locator('#art-save-status')).toContainText('保存できませんでした', { timeout: 15000 });
    await expect(page.locator('#art-edit-view')).toBeVisible();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
});
