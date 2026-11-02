// イシュー#501 U0a: 「PCは段を積まない」ゲートを、本の詳細(exits.spec.jsのP9)以外の面で固定する。
// 出典・前提の注記は exits.spec.js 冒頭と同じ(docs/char/u0-targets.md §4)。
// ここでは _modalHistPush/NavState.open の中央ゲート(js/nav-state.js:413-414、
// js/bookshelf.js:13283-13285)を、設定モーダルと記事の公開パネル管理モーダルの2面で固定する。
// 4か所目は、計画書(499-step3-arch.md §3)の本文が失われていて確認できなかった(未確認・docs/char/u0-targets.md参照)。
import { test, expect } from '../helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../fixtures/fixture-library.json'), 'utf-8');

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

const PC_PROJECTS = ['char-1440', 'char-1920'];

test('pc-backゲート: 設定モーダルを開いてから戻る → アプリの外に出る(今の振る舞い) // CHAR: 直す対象(step2 P9)', async ({ page }, testInfo) => {
    test.skip(!PC_PROJECTS.includes(testInfo.project.name), 'PCの戻るはPC幅(マウス)だけが対象');
    await bootApp(page);
    await page.locator('#sidebar-settings').click();
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await page.goBack();
    // 今の振る舞い: _modalHistPush の !mobile 早期returnで履歴が積まれておらず、戻るでアプリの外に出る。
    await expect.poll(() => page.url()).toBe('about:blank');
});

test('pc-backゲート: 公開ページ管理モーダルを開いてから戻る → アプリの外に出る(今の振る舞い) // CHAR: 直す対象(step2 P9)', async ({ page }, testInfo) => {
    test.skip(!PC_PROJECTS.includes(testInfo.project.name), 'PCの戻るはPC幅(マウス)だけが対象');
    await bootApp(page);
    await page.locator('#sidebar-publish').click();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await page.goBack();
    await expect.poll(() => page.url()).toBe('about:blank');
});
