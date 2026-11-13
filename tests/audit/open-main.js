// ホーム・本棚の画面まわり (空の状態・ポップオーバー・メニュー・バナー) の開き方 (書き方は open.js の冒頭を参照)。
import { expect } from '@playwright/test';
import { openDrawer } from '../e2e/helpers/nav.js';

// ヘッダーのポップオーバー: 本棚の画面で、開くボタンを押す
const headerPopover = (btnId, popId) => ({
    after: 'shelf',
    root: `#${popId}`,
    open: async (page) => {
        await page.locator(`#${btnId}`).click();
        await expect(page.locator(`#${popId}`)).toBeVisible();
    },
});

// 左ナビが畳まれている幅 (下部ナビに「本棚」が出る幅) は、先にドロワーを開く
async function showSidebar(page) {
    if (!(await page.locator('[data-mobile-nav="shelves"]').isVisible())) return;
    await openDrawer(page);
    await expect(page.locator('body')).toHaveClass(/drawer-open/);
}

export const OPENERS_MAIN = {
    'home-empty': {
        boot: { data: 'empty' },
        root: '#dashboard-welcome',
        open: async (page) => { await expect(page.locator('#dashboard-welcome')).toBeVisible(); },
    },
    'shelf-empty': {
        boot: { data: 'empty' },
        root: '.bookshelf-empty',
        open: async (page) => {
            await showSidebar(page);
            // 本が0冊のデータにある本棚は1つだけ
            await page.locator('#sidebar-bookshelf-tree .tree-node').first().click();
        },
    },
    'shelf-tree-menu': {
        root: '#tree-node-menu',
        open: async (page, ctx) => {
            await showSidebar(page);
            const tree = page.locator('#sidebar-bookshelf-tree');
            const node = tree.locator(`.tree-node[data-bookshelf-id="${ctx.anchors.shelfId}"]`);
            // 親の段が畳まれていて見えない時は、上の段から順に開く
            for (let k = 0; k < 4 && !(await node.isVisible()); k++) {
                await tree.locator('.tree-node .tree-toggle').nth(k).click();
            }
            await node.locator('.tree-more').click();
        },
    },
    'popover-filter': headerPopover('toggle-filter', 'filter-popover'),
    'popover-display': headerPopover('toggle-display', 'display-popover'),
    'popover-search': headerPopover('toggle-search', 'search-popover'),
    'widget-picker': {
        after: 'home-edit',
        root: '#widget-picker-overlay',
        open: async (page) => { await page.locator('#dashboard-add-widget').click(); },
    },
    // 起動の時に1回だけ「スマホの UA で、showDirectoryPicker が無い」と判定して出る (js/bookshelf.js のモバイル向け案内)。
    // 起動した後に出す操作は無いので、スマホの UA で起動する (boot の ua)。タッチの端末でだけ回す
    'mobile-setup-banner': {
        boot: { ua: 'ios' },
        root: '#mobile-setup-banner',
        applies: (page) => page.evaluate(() => navigator.maxTouchPoints > 0),
        open: async (page) => { await expect(page.locator('#mobile-setup-banner')).toBeVisible(); },
    },
    'bulk-shelf-popover': {
        after: 'shelf',
        root: '#bulk-shelf-popover',
        open: async (page, ctx) => {
            await page.locator('#toggle-select-mode').click();
            await expect(page.locator('body')).toHaveClass(/select-mode/);
            await page.locator(`#bookshelf .book-item[data-asin="${ctx.anchors.asin}"]`).first().click();
            await expect(page.locator('#bulk-bar')).toBeVisible();
            await page.locator('#bulk-add-shelf').click();
        },
    },
};
