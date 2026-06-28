// UX 監査 (2026-06-25) の Quick Wins の回帰テスト
//  QW2 評価フィルタ中の星変更で再フィルタ / QW3 ⌘K 起動ボタン / QW4 空状態・welcome の取込直行
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

test('QW2: 評価フィルタ中に星を下げると一覧から即座に外れる (表示と条件の食い違い解消)', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
    // ★5 で絞り込む → 2 冊
    await page.locator('#toggle-filter').click();
    await page.locator('#rating-seg .rseg[data-rating="5"]').click();
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(2);
    // 表示中の1冊の評価を 0 に変更 (一覧カードの星クリックと同じ経路: saveRating + _applyRatingEverywhere)
    const asin = await page.locator('#bookshelf .book-item').first().getAttribute('data-asin');
    await page.evaluate((a) => { window.bookshelf.saveRating(a, 0); window.bookshelf._applyRatingEverywhere(a, 0); }, asin);
    // ★5 条件に合わなくなった本が即座に外れる (修正前は居残っていた)
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('QW3: 左ペインの検索ボタンでコマンドパレットが開く', async ({ page }) => {
    // ADR-047 P5: 検索は左ペインへ復帰 (PC フッターは廃止)。PC viewport で検証
    const errors = await bootApp(page);
    const searchBtn = page.locator('#sidebar-search');
    await expect(searchBtn).toBeVisible();
    await searchBtn.click();
    await expect(page.locator('#command-palette')).toBeVisible();
    expect(errors).toEqual([]);
});

test('QW3b: モバイルはフッターの検索ボタンでコマンドパレットが開く', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const errors = await bootApp(page);
    const searchBtn = page.locator('#mobile-bottom-nav [data-mobile-nav="search"]');
    await expect(searchBtn).toBeVisible();
    await searchBtn.click();
    await expect(page.locator('#command-palette')).toBeVisible();
    expect(errors).toEqual([]);
});

test('QW4: 空の本棚の「本を取り込む」で取込モーダルが直接開く', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await page.evaluate(() => { window.bookshelf.books = []; window.bookshelf.applyFilters(); });
    const primary = page.locator('#bookshelf .bookshelf-empty .btn').first();
    await expect(primary).toBeVisible();
    await primary.click();
    await expect(page.locator('#import-modal')).toHaveClass(/show/);
    expect(errors).toEqual([]);
});

test('QW4: welcome の「本を追加・取り込み」で設定でなく取込モーダルが開く', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => {
        window.bookshelf.books = [];
        try { localStorage.removeItem('bookshelf_welcome_dismissed'); } catch (_) {}
        const d = window.bookshelf.dashboard; if (d) d.render();
    });
    await expect(page.locator('#dashboard-welcome')).toBeVisible();
    await page.locator('#dashboard-welcome [data-dw="import"]').click();
    await expect(page.locator('#import-modal')).toHaveClass(/show/);
    // 設定モーダルは開かない (直行できている)
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
    expect(errors).toEqual([]);
});
