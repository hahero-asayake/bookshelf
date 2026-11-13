// 画面IDごとの開き方 (docs/audit/machine-checks.md §1-1)。画面の一覧は screens.js。
// 開き方は ①利用者の操作 ②tests/e2e/helpers/ の関数 ③公開の窓口 (先頭に _ の無いメソッド) の順で書く。
//   open(page, ctx)   画面を開く。ctx = { data, theme, anchors: { shelfId, asin } } (app.js の bootApp が返す)
//   root              開いたことを確かめる要素
//   after             前の画面を開いた状態から続けて開く時の、前の画面ID
//   applies(page)     この幅で出る画面かどうか (省略時は全部の幅で出る)
//   boot              起動の指定 (列の先頭の画面だけ。例 { data: 'empty' }・{ ua: 'ios' })。指定のある列は、その起動で1回だけ回す
//   each(page, visit, ctx)  中に段がある画面。段を1つ開くたびに visit(段の名前) を呼ぶ
import { expect } from '@playwright/test';
import { openSettingsByClick } from '../e2e/helpers/settings.js';
import { addBlock } from '../e2e/helpers/art-editor.js';
import { openDrawer, openCommandPalette } from '../e2e/helpers/nav.js';
import { showConflictDialogForTest } from '../e2e/helpers/sync.js';
import { mockPublishAdapter } from './app.js';
import { OPENERS_ARTICLE } from './open-article.js';
import { OPENERS_MAIN } from './open-main.js';
import { OPENERS_DIALOGS } from './open-dialogs.js';

const BASE = {
    home: {
        root: '#dashboard',
        open: async (page) => { await expect(page.locator('#dashboard .dashboard-widget').first()).toBeVisible(); },
    },
    'home-edit': {
        after: 'home',
        root: '#dashboard-grid',
        open: async (page) => {
            await page.locator('#dashboard-edit-toggle').click();
            await expect(page.locator('#dashboard-grid')).toHaveClass(/is-edit-mode/);
        },
    },
    shelf: {
        root: '#bookshelf',
        open: async (page, ctx) => {
            await page.evaluate((id) => window.bookshelf.switchBookshelf(id), ctx.anchors.shelfId);
            await expect(page.locator('#bookshelf .book-item').first()).toBeVisible();
        },
    },
    'book-detail': {
        after: 'shelf',
        root: '#book-detail-pane',
        open: async (page, ctx) => { await page.locator(`#bookshelf .book-item[data-asin="${ctx.anchors.asin}"]`).first().click(); },
    },
    settings: {
        root: '#settings-modal',
        open: async (page) => { await openSettingsByClick(page); },
    },
    'settings-cat': {
        after: 'settings',
        root: '#settings-modal',
        // 設定の節を、画面にあるものを全部、1つずつ開く
        each: async (page, visit) => {
            // hidden の節 (運営者だけに出る管理の節) は、今の利用者には出ないので回さない
            const cats = await page.locator('#settings-master .settings-cat[data-cat]').evaluateAll((els) => els.filter((el) => !el.hidden).map((el) => el.dataset.cat));
            expect(cats.length).toBeGreaterThan(0);
            const mobile = page.viewportSize().width <= 900;
            for (const cat of cats) {
                await page.locator(`#settings-master .settings-cat[data-cat="${cat}"]`).click();
                await visit(cat);
                if (mobile) {
                    // スマホの幅は「一覧 → 節」の2段。戻るで一覧へ戻る
                    await page.goBack();
                    await expect(page.locator(`#settings-master .settings-cat[data-cat="${cat}"]`)).toBeVisible();
                }
            }
        },
    },
    'publish-list': {
        root: '#art-new',
        open: async (page) => {
            await mockPublishAdapter(page);
            await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        },
    },
    'art-viewing': {
        after: 'publish-list',
        root: '#art-edit-view',
        open: async (page) => { await page.click('#art-new'); },
    },
    'art-drawer': {
        after: 'art-viewing',
        root: '#art-drawer',
        open: async (page) => { await addBlock(page, 'shelf', 'first'); },
    },
    drawer: {
        root: '#app-sidebar',
        applies: (page) => page.locator('[data-mobile-nav="shelves"]').isVisible(),
        open: async (page) => {
            await openDrawer(page);
            await expect(page.locator('body')).toHaveClass(/drawer-open/);
        },
    },
    'command-palette': {
        root: '#command-palette',
        open: async (page) => { await openCommandPalette(page); },
    },
    import: {
        root: '#import-modal',
        open: async (page) => { await page.evaluate(() => window.bookshelf.showImportModal()); },
        // 中の段: 最初の表示と、折りたたみ (details) を全部開いた状態
        each: async (page, visit) => {
            await visit('最初の表示');
            const closed = page.locator('#import-modal details:not([open]) > summary:visible');
            for (let guard = 0; guard < 20 && await closed.count() > 0; guard++) await closed.first().click();
            await visit('折りたたみを全部開く');
        },
    },
    'add-book': {
        root: '#add-book-modal',
        open: async (page) => { await page.evaluate(() => window.bookshelf.showAddBookModal()); },
    },
    exclusions: {
        root: '#exclusions-modal',
        open: async (page) => { await page.evaluate(() => window.bookshelf.showExclusionsModal()); },
    },
    'shelves-manage': {
        root: '#bookshelf-modal',
        open: async (page) => { await page.evaluate(() => window.bookshelf.showBookshelfManager()); },
    },
    'shelf-form': {
        root: '#bookshelf-form-modal',
        open: async (page) => { await page.evaluate(() => window.bookshelf.showBookshelfForm()); },
    },
    'sync-conflict': {
        root: '#sync-conflict-dialog',
        open: async (page) => { await showConflictDialogForTest(page, 'GitHub'); },
    },
};

export const OPENERS = { ...BASE, ...OPENERS_ARTICLE, ...OPENERS_MAIN, ...OPENERS_DIALOGS };
