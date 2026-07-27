// 取込ブックマーク主経路 (ADR-054。拡張機能は配布しない)
//  PC: 初回準備 = ブックマーク登録 UI・postMessage 受信で本選択リストが開く
//  スマホ: PC レーンを出さず案内文のみ (デッドエンド解消)
//  about: 問い合わせ導線 (ui-standards §4 導線対称性)
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

test('PC: 初回準備はブックマーク登録 (ドラッグ用リンクに javascript: が入る・クリックは実行しない)', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => window.bookshelf.showImportModal());
    await expect(page.locator('#import-modal')).toHaveClass(/show/);
    // PC ではレーンが見え、スマホ案内は出ない
    await expect(page.locator('#import-lane-pc')).toBeVisible();
    await expect(page.locator('#import-mobile-note')).toBeHidden();
    // 旧・拡張機能 UI は DOM ごと無い
    await expect(page.locator('#kindle-exporter-link')).toHaveCount(0);
    await expect(page.locator('#kindle-exporter-nourl')).toHaveCount(0);
    // 初回準備 = ブックマーク登録
    await expect(page.locator('#import-setup-pc > summary')).toContainText('取込ブックマークを登録');
    const href = await page.locator('#kindle-bookmarklet-link').getAttribute('href');
    expect(href.startsWith('javascript:')).toBe(true);
    expect(decodeURIComponent(href)).toContain('GetContentOwnershipData');
    // クリックしてもこのページ上で実行されない (案内トーストのみ・URL 不変)
    const before = page.url();
    await page.locator('#kindle-bookmarklet-link').click();
    expect(page.url()).toBe(before);
    await expect(page.locator('#import-modal')).toHaveClass(/show/);
});

test('PC: 受信待ち中に postMessage が届くと本選択リストが開く', async ({ page }) => {
    const errors = await bootApp(page);
    // 別タブは開かない (window.open をスタブ)。受信 origin にテスト origin を許可
    await page.evaluate(() => {
        window.open = () => ({ closed: false });
        window.bookshelf.userData.settings.extensionImportOrigins = [location.origin];
        window.bookshelf.showImportModal();
    });
    await page.locator('#open-amazon-for-import').click();
    await expect(page.locator('#import-relay-status')).toBeVisible();
    // ブックマークレットの返送と同じメッセージを注入
    await page.evaluate(() => {
        window.postMessage({
            type: 'kindleBookshelfExport',
            ok: true,
            items: [
                { title: 'ブックマークの本A', authors: '著者A', acquiredTime: 1700000000000, readStatus: 'UNKNOWN', asin: 'B0BMLT0001', productImage: '' },
                { title: 'ブックマークの本B', authors: '著者B', acquiredTime: 1700000001000, readStatus: 'READ', asin: 'B0BMLT0002', productImage: '' }
            ]
        }, location.origin);
    });
    await expect(page.locator('#book-selection')).toBeVisible();
    await expect(page.locator('#book-list .book-selection-item')).toHaveCount(2);
    expect(errors.filter(e => !/accounts\.google|gsi|net::ERR/.test(e))).toEqual([]);
});

test.describe('スマホ表示', () => {
    test.use({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        viewport: { width: 390, height: 844 },
        hasTouch: true
    });

    test('スマホ: PC レーンは出さず「PCで取り込んでください」の案内のみ (デッドエンド解消)', async ({ page }) => {
        await bootApp(page);
        await page.evaluate(() => window.bookshelf.showImportModal());
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await expect(page.locator('#import-mobile-note')).toBeVisible();
        await expect(page.locator('#import-lane-pc')).toBeHidden();
        await expect(page.locator('#open-amazon-for-import')).toBeHidden();
    });
});

test('about: 問い合わせ導線 (メール) がある', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; window.bookshelf._openSettingsModal('about-section'); });
    const mail = page.locator('#about-section a[href^="mailto:asayake.hahero@gmail.com"]');
    await expect(mail).toBeVisible();
    await expect(mail).toContainText('お問い合わせ');
});
