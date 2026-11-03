// イシュー#501 U0a: 「PCは段を積まない」ゲートを、本の詳細(exits.spec.jsのP9)以外の面で固定していた。
// 出典・前提の注記は exits.spec.js 冒頭と同じ(docs/char/u0-targets.md §4)。
// イシュー#513 S6で期待を書き換え(②承認済み): 全幅化のフラグ(既定=新しい動き)で、設定・公開ページ
// 管理モーダルを開いてから戻ると、アプリの外(about:blank)ではなく1段だけ戻ってモーダルが閉じる。
// フラグ旧(localStorage 'bookshelf.flag.histAllWidths'='0')では元の動き(about:blank)を維持する
// ことも併せて固定する(docs/char/s6-scope.md §3・#509実測の公開routeの解消も含む)。
import { test, expect } from '../helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page, { histFlagOld = false } = {}) {
    await page.addInitScript(([userData, library, old]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        if (old) localStorage.setItem('bookshelf.flag.histAllWidths', '0');
    }, [fixtureUserData, fixtureLibrary, histFlagOld]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

const PC_PROJECTS = ['char-1440', 'char-1920'];

test('pc-backゲート: 設定モーダルを開いてから戻る → 1段戻ってモーダルが閉じる(アプリ内に留まる) // CHAR: 新しい振る舞い(S6・旧はP9)', async ({ page }, testInfo) => {
    test.skip(!PC_PROJECTS.includes(testInfo.project.name), 'PCの戻るはPC幅(マウス)だけが対象');
    await bootApp(page);
    await page.locator('#sidebar-settings').click();
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await page.goBack();
    // 新しい振る舞い(イシュー#513 S6): 全幅化で段を積むため、戻るはアプリの外へ出ずモーダルを閉じるだけ。
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
    await expect.poll(() => page.url()).not.toBe('about:blank');
});

test('pc-backゲート: 公開ページ管理モーダルを開いてから戻る → 1段戻ってモーダルが閉じる(アプリ内に留まる) // CHAR: 新しい振る舞い(S6・旧はP9)', async ({ page }, testInfo) => {
    test.skip(!PC_PROJECTS.includes(testInfo.project.name), 'PCの戻るはPC幅(マウス)だけが対象');
    await bootApp(page);
    await page.locator('#sidebar-publish').click();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    // #509実測(docs/arch/surface.md §5)の「PCでhashが空になる」も、全幅化のフラグ新で解消している
    // ことを併せて確認する(route処理の早期returnがmobile判定の後ろにあったため・s6-scope.md §2)。
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/publish');
    await page.goBack();
    await expect(page.locator('#publish-pages-modal')).not.toHaveClass(/show/);
    await expect.poll(() => page.url()).not.toBe('about:blank');
});

test('pc-backゲート(フラグ旧): 設定モーダルを開いてから戻る → アプリの外に出る(元の振る舞いを維持) // CHAR: 直す対象(step2 P9)の原文を保存', async ({ page }, testInfo) => {
    test.skip(!PC_PROJECTS.includes(testInfo.project.name), 'PCの戻るはPC幅(マウス)だけが対象');
    await bootApp(page, { histFlagOld: true });
    await page.locator('#sidebar-settings').click();
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await page.goBack();
    // フラグ旧(localStorage 'bookshelf.flag.histAllWidths'='0'): _navMobile()が_isHistMobile()(幅判定)に
    // フォールバックし、PCでは元の振る舞い(段を積まず、戻るでアプリの外に出る)のまま。
    await expect.poll(() => page.url()).toBe('about:blank');
});

test('pc-backゲート(フラグ旧): 公開ページ管理モーダルを開いてから戻る → アプリの外に出る(元の振る舞いを維持) // CHAR: 直す対象(step2 P9)の原文を保存', async ({ page }, testInfo) => {
    test.skip(!PC_PROJECTS.includes(testInfo.project.name), 'PCの戻るはPC幅(マウス)だけが対象');
    await bootApp(page, { histFlagOld: true });
    await page.locator('#sidebar-publish').click();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await page.goBack();
    await expect.poll(() => page.url()).toBe('about:blank');
});
