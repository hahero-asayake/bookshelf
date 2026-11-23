// イシュー#771: 本の詳細「この本で記事を書く」から書き始め、タブが裏に回った時の保存の応答が消える（iPhone が裏で止まる・
// Load failed 相当）と、自分の書いた版を「この記事は他の場所で更新されています」と見誤っていた（H1・step1 で再現）。
// 直した後は出ない・入れた題が保存先へ届く（ハブ・GitHub）。切り替え bookshelf.flag.ownWriteMatch='0' で前の形（出る）。
// iPhone 13 の画面・タッチで流す（ブラウザは project が決める。webkit は playwright.config の webkit / gate-webkit が流す）。
import { test, expect } from './helpers/test-base.js';
import { devices } from '@playwright/test';
import { bootAppForTest } from './helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';
import { createMockGitHubForTest, seedGitHubDataForTest, seedGitHubLoginForTest, mockGitHubForTest } from './helpers/gate-github.js';

const { defaultBrowserType: _b, ...iphone } = devices['iPhone 13'];
test.use(iphone);

const ART = 'private/publish/articles.json';
const OLD = { articles: [{ id: 'old1', slug: 'old1', title: '前からある記事', blocks: [], status: 'draft', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' }] };
const TITLE = '裏から戻って書いた題';

// ---- ハブ: 記事のファイルの PUT を1回だけ「保存先へ入れてから応答を消す」 ----
async function bootHub(page) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    hub.seq += 1;
    hub.files.set(ART, { content: JSON.stringify(OLD), etag: `"v${hub.seq}"` });
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    const st = { dropPuts: 0 };
    await page.route(`**/data/${ART}*`, async (route) => {
        const req = route.request();
        const im = req.headers()['if-match'];
        const cur = hub.files.get(ART);
        if (req.method() === 'PUT' && st.dropPuts > 0 && !(cur && im && im !== cur.etag)) {
            st.dropPuts -= 1;
            hub.seq += 1;
            hub.files.set(ART, { content: req.postData(), etag: `"v${hub.seq}"` });
            return route.abort('failed');
        }
        return route.fallback();
    });
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    return { st, saved: () => { const f = hub.files.get(ART); return f ? f.content : ''; } };
}

// ---- GitHub: contents の PUT を1回だけ「main に積んでから応答を消す」（gate-github.js の commitFile と同じ積み方） ----
function ghCommit(state, path, content) {
    const next = (p) => { state.seq += 1; return `${p}${String(state.seq).padStart(39, '0')}`; };
    const map = new Map(state.trees.get(state.commits.get(state.head).tree));
    const b = next('b'); state.blobs.set(b, content); map.set(path, b);
    const t = next('t'); state.trees.set(t, map);
    const c = next('c'); state.commits.set(c, { tree: t, parents: [state.head] });
    state.head = c;
}
const ghCur = (state, path) => state.trees.get(state.commits.get(state.head).tree).get(path) || null;

async function bootGitHub(page) {
    const gh = createMockGitHubForTest();
    seedGitHubDataForTest(gh);
    ghCommit(gh, ART, JSON.stringify(OLD));
    await seedGitHubLoginForTest(page, gh);
    await mockGitHubForTest(page, gh);
    const st = { dropPuts: 0 };
    await page.route(`https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/private/publish/articles.json*`, async (route) => {
        const req = route.request();
        if (req.method() === 'PUT' && st.dropPuts > 0) {
            const body = JSON.parse(req.postData() || '{}');
            const cur = ghCur(gh, ART);
            if (cur && body.sha === cur) {
                st.dropPuts -= 1;
                ghCommit(gh, ART, Buffer.from(body.content, 'base64').toString('utf-8'));
                return route.abort('failed');
            }
        }
        return route.fallback();
    });
    await bootAppForTest(page);
    await waitForHubStartupForTest(page); // 起動の待ちはハブと同じ (画面の表示で判定・j6-2 と同じ)
    return { st, saved: () => { const s = ghCur(gh, ART); return s ? gh.blobs.get(s) : ''; } };
}

async function openFromBookAndLoseResponse(page, st) {
    await page.locator('[data-mobile-nav="shelves"]').click();
    await expect(page.locator('body')).toHaveClass(/drawer-open/);
    await page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: 'すべて' }).first().click();
    await expect(page.locator('#bookshelf .book-item').first()).toBeVisible();
    await page.locator('#bookshelf .book-item').first().click();
    await page.locator('.bd-actions .bd-write-article:visible').click();
    await expect(page.locator('#art-edit-view')).toBeVisible();
    await page.waitForTimeout(1000); // 600ms でメモリに記事ができる（送るのは裏へ回した時）
    st.dropPuts = 1;
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('pagehide'));
    });
    await expect.poll(() => st.dropPuts, { timeout: 10000 }).toBe(0); // 保存先へ入り、応答が消えた
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('pageshow'));
    });
    await page.locator('#art-title').fill(TITLE);
    await page.waitForTimeout(800);
    await page.locator('#art-back').click();
}

const CONFLICT = '他の場所で更新されています';

for (const [name, boot] of [['ハブ', bootHub], ['GitHub', bootGitHub]]) {
    test(`#771 ${name}: 裏に回った時の保存の応答が消えても「${CONFLICT}」が出ず、入れた題が保存先へ届く`, async ({ page }) => {
        test.setTimeout(90_000);
        const { st, saved } = await boot(page);
        await openFromBookAndLoseResponse(page, st);
        await expect.poll(saved, { timeout: 15000 }).toContain(TITLE);
        await expect(page.locator('body')).not.toContainText(CONFLICT);
        await expect(page.locator('#art-save-status')).not.toContainText(CONFLICT);
    });

    test(`#771 ${name}: 切り替え ownWriteMatch='0' では前の形（「${CONFLICT}」が出る）`, async ({ page }) => {
        test.setTimeout(90_000);
        const { st } = await boot(page);
        await page.evaluate(() => localStorage.setItem('bookshelf.flag.ownWriteMatch', '0')); // 起動の後に入れる (#770 の作法)
        await openFromBookAndLoseResponse(page, st);
        await expect(page.locator('#art-save-status')).toContainText(CONFLICT, { timeout: 15000 });
    });
}
