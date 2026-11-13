// ダイアログ・長文メモ・プラグイン・本棚フォームの中の面の開き方 (書き方は open.js の冒頭を参照)。
import { expect } from '@playwright/test';
import { renderUsageAlertForTest, openPluginSettingsByClick } from '../e2e/helpers/settings.js';
import { openBookMemoInAppEditor } from '../e2e/helpers/book-memo.js';
import { mockPublishAdapter } from './app.js';

export const OPENERS_DIALOGS = {
    confirm: {
        root: '.cfm-overlay',
        // 戻り値の Promise は閉じるまで解決しないので待たない
        open: async (page) => { await page.evaluate(() => { window.confirmDialog({ title: '確認', message: '監査の巡回で開いた確認です' }); }); },
    },
    'usage-alert': {
        root: '#usage-alert-banner',
        open: async (page) => {
            await renderUsageAlertForTest(page, { key: 'hk_test', apiBase: 'https://hub.example', usedBytes: 150 * 1024 * 1024, quotaBytes: 100 * 1024 * 1024, plan: 'free' });
        },
    },
    'book-memo': {
        root: '#book-memo-modal',
        open: async (page, ctx) => {
            // 長文メモは保存先から本文を読むので、保存先の読み書きをメモリへ差し替えてから開く (e2e の bootApp と同じ型)
            await mockPublishAdapter(page);
            await page.evaluate(() => {
                const mem = new Map();
                const adapter = window.bookshelf.storage.adapter;
                adapter.readText = async (p) => (mem.has(p) ? mem.get(p) : null);
                adapter.writeText = async (p, t) => { mem.set(p, t); };
            });
            await openBookMemoInAppEditor(page, ctx.anchors.asin);
            await expect(page.locator('#book-memo-modal .editor-toolbar')).toBeVisible();
        },
    },
    'mde-heading-menu': {
        after: 'book-memo',
        root: '.mde-heading-menu',
        open: async (page) => { await page.click('#book-memo-modal .editor-toolbar button[title="見出し"]'); },
    },
    'icon-picker': {
        after: 'shelf-form',
        root: '#icon-picker-modal',
        open: async (page) => { await page.click('#bookshelf-icon-trigger'); },
    },
    'descendants-pick': {
        root: '#descendants-pick-modal',
        // 子を持つ本棚を用意し、本の詳細 (編集) の「本棚を追加」でその親の本棚を選んで追加を押す
        open: async (page, ctx) => {
            await page.evaluate((asin) => {
                const bs = window.bookshelf;
                bs.bookshelfManager.create({ slug: 'audit-parent', name: '監査の親本棚' });
                bs.bookshelfManager.create({ slug: 'audit-child', name: '監査の子本棚', parent: bs.bookshelfManager.getBySlug('audit-parent').internalId });
                bs.showBookDetail(bs.books.find((b) => b.asin === asin), true);
            }, ctx.anchors.asin);
            await page.locator(`.bookshelf-select[data-asin="${ctx.anchors.asin}"]`).first().selectOption('audit-parent');
            await page.locator(`.add-to-bookshelf[data-asin="${ctx.anchors.asin}"]`).first().click();
        },
    },
    report: {
        root: '#report-modal',
        // 通報はハブにログイン済みの時だけ開く。接続情報を仕込んでから公開の窓口で開く (戻り値の Promise は閉じるまで解決しないので待たない)
        open: async (page) => {
            await page.evaluate((url) => {
                const cfg = JSON.parse(localStorage.getItem('bookshelf_sync') || '{}');
                cfg.hub = { key: 'hk_test', apiBase: 'https://hub.example', email: 'test@example.com', plan: 'free', isAdmin: false, siteId: 'sid' };
                localStorage.setItem('bookshelf_sync', JSON.stringify(cfg));
                window.bookshelf.openReportModal(url);
            }, 'https://bookshelf.asayake.org/alice/AbCdEfGhIj/');
        },
    },
    'plugin-settings': {
        root: '.plugin-settings-modal',
        open: async (page) => { await openPluginSettingsByClick(page, 'dark-theme'); },
    },
};
