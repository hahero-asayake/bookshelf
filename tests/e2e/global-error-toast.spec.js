// グローバル例外 → toast (#339: ローンチ前漏れ精査「判断不要」修正4点のうちアプリ側エラー監視)。
// js/ui-feedback.js の window 'error'/'unhandledrejection' リスナが、既存の toast(type:'error') で
// 利用者に気づかせることを確認する。
//  - 同期エラー (setTimeout 内 throw) と未処理の Promise rejection のどちらでも1回出る
//  - 短時間の連続発火は1件に抑制される (連打防止)
//  - 書影 <img> の読み込み失敗は対象外 (既存の document capture リスナ・js/bookshelf.js:1520
//    付近の _setupCoverFallback と干渉しない。img の error は bubble しないため window まで届かない)
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

// smoke.spec.js の bootApp と同じ起動手順。本テストは意図的に例外を起こすため console error の収集はしない。
async function bootApp(page) {
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

const MSG = '予期しないエラーが発生しました。しばらくしてからもう一度お試しください。';

test('window の同期エラーで toast(type:error) が出る', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => { setTimeout(() => { throw new Error('boom-sync'); }); });
    const errToast = page.locator('.toast-error', { hasText: MSG });
    await expect(errToast).toBeVisible();
    await expect(errToast).toHaveCount(1);
});

test('未処理の Promise rejection で toast(type:error) が出る', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => { Promise.reject(new Error('boom-reject')); });
    const errToast = page.locator('.toast-error', { hasText: MSG });
    await expect(errToast).toBeVisible();
    await expect(errToast).toHaveCount(1);
});

test('短時間に連続発火しても1件に抑制される (連打防止)', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => {
        for (let i = 0; i < 5; i++) setTimeout(() => { throw new Error('boom-burst-' + i); });
        Promise.reject(new Error('boom-burst-reject'));
    });
    const errToast = page.locator('.toast-error', { hasText: MSG });
    await expect(errToast).toBeVisible();
    await page.waitForTimeout(300); // 全setTimeout/rejectionが発火しきるのを待つ
    await expect(errToast).toHaveCount(1);
});

test('壊れた書影 <img> では toast を出さない (既存の書影フォールバックは働く)', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => {
        const img = document.createElement('img');
        img.dataset.coverFallback = 'テスト本';
        img.src = '/does-not-exist-404.png';
        document.body.appendChild(img);
    });
    // 既存フォールバック: 壊れた <img> は生成表紙 (.book-cover-placeholder.cover-fallback) に差し替わる
    await expect(page.locator('.book-cover-placeholder.cover-fallback', { hasText: 'テスト本' })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator('.toast-error', { hasText: MSG })).toHaveCount(0);
});
