// UI再設計 P1 (ナビ再編, ADR-047) の回帰テスト
//  - 左ペイン上段は「公開 / プラグイン」だけ (検索/ホーム/本棚管理は撤去)
//  - 検索/ホーム/設定は下部フッターへ集約。フッターは PC でも表示
//  - 下部ナビの現在地ハイライト (.is-active) を配線 (旧: 死にCSS)
//  - 「プラグイン」ボタンは設定のプラグイン節を開く (P3 で専用ページへ)
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

test('P1: 左ペイン上段は公開/プラグインだけ (検索・ホーム・本棚管理は撤去)', async ({ page }) => {
    const errors = await bootApp(page);
    await expect(page.locator('#sidebar-publish')).toBeVisible();
    await expect(page.locator('#sidebar-plugins')).toBeVisible();
    // 撤去された要素は DOM から消えている
    await expect(page.locator('#palette-trigger')).toHaveCount(0);
    await expect(page.locator('.sidebar-nav-item[data-nav="home"]')).toHaveCount(0);
    await expect(page.locator('#manage-bookshelves')).toHaveCount(0);
    await expect(page.locator('#open-settings')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('P1: 下部フッターが PC でも表示され、検索/ホーム/設定が揃う', async ({ page }) => {
    await bootApp(page); // 既定 viewport = デスクトップ
    const nav = page.locator('#mobile-bottom-nav');
    await expect(nav).toBeVisible();
    await expect(nav.locator('[data-mobile-nav="home"]')).toBeVisible();
    await expect(nav.locator('[data-mobile-nav="search"]')).toBeVisible();
    await expect(nav.locator('[data-mobile-nav="settings"]')).toBeVisible();
    // PC では本棚タブは隠す (左ペインのツリーで十分)
    await expect(nav.locator('[data-mobile-nav="shelves"]')).toBeHidden();
});

test('P1: 下部ナビの現在地ハイライト (.is-active) が配線されている', async ({ page }) => {
    await bootApp(page);
    const homeItem = page.locator('#mobile-bottom-nav [data-mobile-nav="home"]');
    // ホーム表示時は home が is-active
    await page.evaluate(() => window.bookshelf._setBodyView('main'));
    await expect(homeItem).toHaveClass(/is-active/);
    // 本棚を開くと home の is-active が外れる
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await expect(homeItem).not.toHaveClass(/is-active/);
});

test('P1: 「プラグイン」ボタンで設定のプラグイン節が開く', async ({ page }) => {
    const errors = await bootApp(page);
    await page.locator('#sidebar-plugins').click();
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await expect(page.locator('#plugins-section')).toHaveJSProperty('open', true);
    expect(errors).toEqual([]);
});

test('P1: 「公開」ボタンで公開ページ管理モーダルが開く', async ({ page }) => {
    const errors = await bootApp(page);
    await page.locator('#sidebar-publish').click();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    expect(errors).toEqual([]);
});
