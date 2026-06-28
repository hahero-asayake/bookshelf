// UI再設計 P1→P5 (ナビ再編, ADR-047) の回帰テスト
//  - 左ペインは PC/モバイル 共通構成。上段=公開/プラグイン、その下に検索/設定 (P5)
//  - PC のフッターは廃止 (#mobile-bottom-nav は PC で非表示)。モバイルのみ残す
//  - ブランド (アプリ名) クリックでホームへ遷移
//  - 下部ナビ (モバイル) の現在地ハイライト (.is-active) を配線
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

test('P5: 左ペインは 公開/プラグイン + 検索/設定 (撤去要素は無い)', async ({ page }) => {
    const errors = await bootApp(page);
    await expect(page.locator('#sidebar-publish')).toBeVisible();
    await expect(page.locator('#sidebar-plugins')).toBeVisible();
    // 検索・設定は左ペインに集約 (PC フッター廃止の受け皿)
    await expect(page.locator('#sidebar-search')).toBeVisible();
    await expect(page.locator('#sidebar-settings')).toBeVisible();
    // 撤去された旧要素は DOM から消えている
    await expect(page.locator('#palette-trigger')).toHaveCount(0);
    await expect(page.locator('.sidebar-nav-item[data-nav="home"]')).toHaveCount(0);
    await expect(page.locator('#manage-bookshelves')).toHaveCount(0);
    await expect(page.locator('#open-settings')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('P5: PC では下部フッターを廃止 (非表示)', async ({ page }) => {
    await bootApp(page); // 既定 viewport = デスクトップ
    // フッター DOM は残る (モバイル用) が PC では CSS で非表示
    await expect(page.locator('#mobile-bottom-nav')).toBeHidden();
});

test('P5: モバイルでは下部フッターが表示され 検索/設定 が揃う', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await bootApp(page);
    const nav = page.locator('#mobile-bottom-nav');
    await expect(nav).toBeVisible();
    await expect(nav.locator('[data-mobile-nav="home"]')).toBeVisible();
    await expect(nav.locator('[data-mobile-nav="search"]')).toBeVisible();
    await expect(nav.locator('[data-mobile-nav="settings"]')).toBeVisible();
});

test('P5: ブランド (アプリ名) クリックでホームへ遷移', async ({ page }) => {
    await bootApp(page);
    // まず本棚を開く (body は app-view-bookshelf)
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await expect(page.locator('body')).toHaveClass(/app-view-bookshelf/);
    // ブランドをクリック → main (ホーム) ビューへ
    await page.locator('.sidebar-brand').click();
    await expect(page.locator('body')).toHaveClass(/app-view-main/);
});

test('P5: モバイル下部ナビの現在地ハイライト (.is-active) が配線されている', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
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
