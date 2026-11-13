// 画面IDごとの開き方 (docs/audit/machine-checks.md §1-1)。画面の一覧は screens.js。
// 開き方は ①利用者の操作 ②tests/e2e/helpers/ の関数 ③公開の窓口 (先頭に _ の無いメソッド) の順で書く。
//   after  前の画面を開いた状態から続けて開く時の、前の画面ID
//   root   開いたことを確かめる要素
import { expect } from '@playwright/test';
import { openSettingsByClick } from '../e2e/helpers/settings.js';
import { addBlock } from '../e2e/helpers/art-editor.js';
import { mockPublishAdapter } from './app.js';

export const OPENERS = {
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
        open: async (page) => {
            await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
            await expect(page.locator('#bookshelf .book-item')).toHaveCount(3);
        },
    },
    'book-detail': {
        after: 'shelf',
        root: '#book-detail-pane',
        open: async (page) => {
            await page.locator('#bookshelf .book-item[data-asin="B000000002"]').click();
            await expect(page.locator('#book-detail-pane')).toContainText('フィクスチャの本 2');
        },
    },
    settings: {
        root: '#settings-modal',
        open: async (page) => { await openSettingsByClick(page); },
    },
    'settings-cat': {
        root: '#sync-method-select',
        open: async (page) => { await openSettingsByClick(page, 'sync-method-select'); },
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
};
