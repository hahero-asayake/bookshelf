// イシュー#699 step1 の記録用 (門のE2Eではない・commit する spec ではない)。
// 記事エディタのプレビュー (#pp-preview-frame) で本の表紙と題名を押した時の動き (href・新しいタブの有無) を記録する。
// 流し方: tests/e2e/gate/ へ一時的に写して流す (playwright の testDir が tests/e2e のため)。
//   cp scripts/verify/699-preview-probe.spec.js tests/e2e/gate/zz-699-preview-probe.spec.js
//   PORT=8199 GATE_WEBKIT=1 npx playwright test tests/e2e/gate/zz-699-preview-probe.spec.js --project=chromium --project=gate-webkit
// 前提の作り方は j5-3-article-preview.spec.js (保存先ローカル) と j5-4-publish-read-url.spec.js (保存先・公開先ハブ) の写し。
import { test, expect } from '../helpers/test-base.js';
import { seedLibraryForTest, bootAppForTest, stubStorageForTest } from '../helpers/gate-setup.js';
import { mockSyncReady } from '../helpers/sync.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from '../helpers/gate-hub.js';

const BOOK_1 = 'フィクスチャの本 1';
const editView = (page) => page.locator('#art-edit-view');
const canvas = (page) => page.frameLocator('#art-canvas-frame');
const drawerBook = (page, title) => page.locator('#art-drawer-list .art-drawer-item', { hasText: title }).first();
const articleBar = (page) => page.getByRole('toolbar', { name: '記事の操作' });
const preview = (page) => page.frameLocator('#pp-preview-frame');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function makeArticleAndOpenPreview(page, title) {
    await page.locator('[data-mobile-nav="shelves"]').tap();
    await page.locator('#sidebar-publish').tap();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await page.locator('#art-new').tap();
    await page.locator('#art-title').fill(title);
    await page.locator('#art-mode-edit').tap();
    await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
    await expect(async () => {
        await canvas(page).locator('.art-cv-ins-btn').last().tap();
        await expect(page.locator('#art-add-sheet [data-block-type="shelf"]')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await page.locator('#art-add-sheet [data-block-type="shelf"]').tap();
    await expect(page.locator('#art-drawer')).toHaveClass(/is-open/);
    await expect(drawerBook(page, BOOK_1)).toBeInViewport();
    await drawerBook(page, BOOK_1).tap();
    await page.locator('#art-fs-done').tap();
    await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
    await articleBar(page).getByRole('button', { name: '完了' }).tap();
    await expect(editView(page)).toHaveAttribute('data-art-mode', 'view');
    await page.getByRole('button', { name: 'その他の操作' }).tap();
    await page.getByRole('menuitem', { name: '表示幅を切り替えて見る' }).tap();
    await expect(page.locator('#pp-preview-modal')).toBeVisible();
    await expect(preview(page).locator('body')).toContainText(BOOK_1, { timeout: 15000 });
}

async function probe(page, label, consoleMsgs, testInfo) {
    const out = { label, project: testInfo.project.name, sandbox: await page.locator('#pp-preview-frame').getAttribute('sandbox'), links: {}, taps: [] };
    for (const [kind, sel] of [['cover', 'a.bk-cover-link'], ['title', '.bk-title a']]) {
        const loc = preview(page).locator(sel).first();
        out.links[kind] = await loc.evaluate((a) => ({ hrefAttr: a.getAttribute('href'), resolved: a.href, target: a.target, rel: a.rel, baseURI: document.baseURI }));
        const popupP = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
        await loc.tap();
        const popup = await popupP;
        const rec = { kind, opened: !!popup };
        if (popup) { await popup.waitForLoadState('domcontentloaded').catch(() => {}); rec.url = popup.url(); await popup.close(); }
        rec.previewStillVisible = await page.locator('#pp-preview-modal').isVisible();
        rec.previewStillHasBook = await preview(page).locator('body').innerText().then(t => t.includes(BOOK_1)).catch(() => false);
        out.taps.push(rec);
    }
    out.console = consoleMsgs.filter(m => /sandbox|popup|Blocked/i.test(m)).slice(0, 4);
    console.log('PROBE699 ' + JSON.stringify(out));
}

test('#699 記録: プレビューで本を押した時の動き (保存先ローカル)', async ({ page }, testInfo) => {
    const consoleMsgs = [];
    page.on('console', (m) => consoleMsgs.push(m.text()));
    await page.context().route('https://www.amazon.co.jp/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>amazon stub</title>' }));
    await seedLibraryForTest(page);
    await bootAppForTest(page);
    await stubStorageForTest(page);
    await mockSyncReady(page, true);
    await makeArticleAndOpenPreview(page, '#699 プレビューの記録 (ローカル)');
    await probe(page, 'local', consoleMsgs, testInfo);
});

test('#699 記録: プレビューで本を押した時の動き (保存先・公開先ハブ)', async ({ page }, testInfo) => {
    const consoleMsgs = [];
    page.on('console', (m) => consoleMsgs.push(m.text()));
    await page.context().route('https://www.amazon.co.jp/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>amazon stub</title>' }));
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await makeArticleAndOpenPreview(page, '#699 プレビューの記録 (ハブ)');
    await probe(page, 'hub', consoleMsgs, testInfo);
});
