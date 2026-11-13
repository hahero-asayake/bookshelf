// Esc とフォーカスの戻し先の一本化 (イシュー#565・#556 報告の2と4)
// - Esc は共通の処理が最前面の1枚だけを閉じる (引き出しの上の面を Esc で閉じても引き出しは残る=1段だけ戻る)
// - ⌘K パレットは結果欄へ Tab で移った後も Esc で閉じる
// - 面を閉じたらフォーカスは開いた元へ戻る (js/overlay-manager.js _restoreFocus)
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDrawer } from './helpers/nav.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page) {
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && (window.bookshelf.books || []).length > 0);
}

const palette = (page) => page.locator('#command-palette');
const drawerOpen = (page) => page.evaluate(() => document.body.classList.contains('drawer-open'));

test.describe('⌘K パレットの Esc (PC)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('Tab で結果欄へ移った後も Esc で閉じる', async ({ page }) => {
        await bootApp(page);
        await page.keyboard.press('Control+k');
        await expect(palette(page)).toBeVisible();
        // 検索欄の外へフォーカスを出す (旧: ここで Esc を誰も拾わなかった)。イシュー#568 で背後が inert になり、
        // パレットに検索欄の他の操作要素が無い時は Tab がページの外へ抜けるだけになったので、blur で検索欄から外す
        await page.keyboard.press('Tab');
        await page.evaluate(() => { const i = document.getElementById('cmdk-input'); if (document.activeElement === i) i.blur(); });
        expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).not.toBe('cmdk-input');
        await page.keyboard.press('Escape');
        await expect(palette(page)).toBeHidden();
        expect(await page.evaluate(() => document.body.classList.contains('cmdk-open'))).toBe(false);
    });

    test('閉じたらフォーカスが開いたボタンへ戻る', async ({ page }) => {
        await bootApp(page);
        const trigger = page.locator('#palette-trigger');
        test.skip(!(await trigger.isVisible()), '#palette-trigger が見えない幅');
        await trigger.focus();
        await page.keyboard.press('Enter');
        await expect(palette(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(palette(page)).toBeHidden();
        await expect(trigger).toBeFocused();
    });

    test('設定を閉じたらフォーカスが開いたボタンへ戻る', async ({ page }) => {
        await bootApp(page);
        const btn = page.locator('#sidebar-settings');
        await btn.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#settings-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#settings-modal')).toBeHidden();
        await expect(btn).toBeFocused();
    });
});

test.describe('引き出しの上の面を Esc で閉じる (幅900px以下 Chromium)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('Esc で上の面だけ閉じ、引き出しは残る→戻る1回でアプリの外へ出ない→進むで再び開く', async ({ page }) => {
        await bootApp(page);
        const appUrl = page.url().split('#')[0];
        await openDrawer(page);
        expect(await drawerOpen(page)).toBe(true);
        await page.keyboard.press('Control+k');
        await expect(palette(page)).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(palette(page)).toBeHidden();
        // 1段だけ戻る (旧: 引き出しの Esc も動いて2段戻り、アプリの外の手前まで行っていた)
        await page.waitForTimeout(300);
        expect(await drawerOpen(page)).toBe(true);

        // OS の戻る1回: 引き出しが閉じ、アプリの中に留まる
        await page.goBack();
        await expect.poll(() => drawerOpen(page)).toBe(false);
        expect(page.url().split('#')[0]).toBe(appUrl);
        expect(await page.evaluate(() => !!window.bookshelf)).toBe(true);

        // 進むで引き出しが再び開く
        await page.goForward();
        await expect.poll(() => drawerOpen(page)).toBe(true);
    });

    test('引き出しは Esc 1回で閉じ、アプリに留まる', async ({ page }) => {
        await bootApp(page);
        const appUrl = page.url().split('#')[0];
        await openDrawer(page);
        await page.keyboard.press('Escape');
        await expect.poll(() => drawerOpen(page)).toBe(false);
        await page.waitForTimeout(300);
        expect(page.url().split('#')[0]).toBe(appUrl);
        expect(await page.evaluate(() => !!window.bookshelf)).toBe(true);
    });
});
