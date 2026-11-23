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
    await expect(page.locator('#art-list-view')).toBeVisible();
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
    await expect(page.locator('#art-list-view')).toBeVisible();
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
