// 記事エディタと公開まわりの画面の開き方 (書き方は open.js の冒頭を参照)。
import { expect } from '@playwright/test';
import { canvas, closeArtSheet, openArtPreview } from '../e2e/helpers/art-editor.js';

// 600px以下は「見た目」「公開」がヘッダーでなく下のバーに出る (前例: tests/e2e/standard-ops.spec.js)
async function clickHeaderOrBar(page, header, bar) {
    const h = page.locator(header);
    if (await h.isVisible()) await h.click();
    else await page.click(bar);
}

// 本棚ブロックの全画面 (art-drawer) を「完了」で閉じて編集状態へ戻る。
// 900px以下は引き出しが開いたまま全画面を覆うので、先に引き出しを閉じる (#529)
async function finishBlockForm(page) {
    await closeArtSheet(page);
    const done = page.locator('#art-fs-done');
    if (await done.isVisible()) await done.click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
}

export const OPENERS_ARTICLE = {
    'publish-settings': {
        after: 'publish-list',
        root: '#publish-settings-modal',
        open: async (page) => { await page.locator('#art-settings-open').click(); },
    },
    'art-edit': {
        after: 'art-viewing',
        root: '#art-edit-view[data-art-mode="edit"]',
        open: async (page) => {
            await page.locator('#art-mode-edit').click();
            await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
            await canvas(page).locator('.art-cv-ins-btn').last().waitFor();
        },
    },
    'art-more-menu': {
        after: 'art-viewing',
        root: '#art-more-menu',
        open: async (page) => { await page.click('#art-more-btn'); },
    },
    // プレビューはブロックが1つ以上ある時だけ開く。本棚ブロックを足した art-drawer の続きで開く
    'art-preview': {
        after: 'art-drawer',
        root: '#pp-preview-modal',
        open: async (page) => {
            await finishBlockForm(page);
            await openArtPreview(page);
        },
    },
    'art-look-sheet': {
        after: 'art-edit',
        root: '#art-look-sheet',
        open: async (page) => { await clickHeaderOrBar(page, '#art-look-btn', '#art-bar-look'); },
    },
    'art-publish': {
        after: 'art-edit',
        root: '#art-publish-modal',
        open: async (page) => {
            await clickHeaderOrBar(page, '#art-publish-header', '#art-bar-publish');
            await expect(page.locator('#art-publish-modal')).toHaveClass(/show/);
        },
    },
    'art-add-sheet': {
        after: 'art-edit',
        root: '#art-add-sheet',
        open: async (page) => {
            // ＋ のクリックがまれに届かない窓がある (#372)。シートが開くまでだけ繰り返す
            await expect(async () => {
                await canvas(page).locator('.art-cv-ins-btn').last().click();
                await expect(page.locator('#art-add-sheet [data-block-type="text"]')).toBeVisible({ timeout: 2000 });
            }).toPass({ timeout: 10000 });
        },
    },
    'art-fs': {
        after: 'art-add-sheet',
        root: '#art-fs-done',
        open: async (page) => {
            await page.locator('#art-add-sheet [data-block-type="text"]').click();
            await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
            // 書式つきエディタの準備が済むと、元の textarea は隠れる。済む前に測ると、検出が実行ごとに揺れる
            await expect(page.locator('#art-text-fs-textarea')).toBeHidden({ timeout: 10000 });
        },
    },
    'art-blk-menu': {
        after: 'art-drawer',
        root: '#art-blk-menu',
        open: async (page) => {
            await finishBlockForm(page);
            await canvas(page).locator('.art-cv-more').first().click();
        },
    },
    'art-drawer-shelf-popover': {
        after: 'art-drawer',
        root: '#art-drawer-shelf-popover',
        open: async (page) => { await page.locator('#art-drawer-shelf-btn').click(); },
    },
};
