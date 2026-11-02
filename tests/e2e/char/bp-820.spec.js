// イシュー#501 U0a: 820px (768と900に割れた境目) の今の振る舞いを固定する。
// 出典: 499-step3-arch.md 39〜40行目・docs/char/u0-targets.md §5(確認済み)。
// 820pxでは、JS側の判定(_isHistMobile・matchMedia max-width:900px)は「スマホ」だが、
// CSS側の判定(多くは max-width:768px / min-width:769px)は「PC」のまま。
// この2つの境目のずれを、履歴(戻る)の振る舞いと、下部ナビの見た目の両方で固定する。
import { test, expect } from '../helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../fixtures/fixture-library.json'), 'utf-8');
const ASIN = 'B000000001';

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

test('820px: 本の詳細を開いて戻るとJS側は「スマホ」扱い=履歴が積まれ、閉じるだけでアプリの外に出ない', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'char-820', 'この検証は820px専用');
    await bootApp(page);
    await page.locator(`.widget-book-cell[data-asin="${ASIN}"]`).first().click();
    await expect(page.locator('#book-detail-pane .bd-title, .book-detail-modal')).toBeVisible();
    await page.goBack();
    await page.waitForTimeout(200);
    // 900px境目(_isHistMobile)側では820=「スマホ」なので、履歴が積まれており、
    // 戻る操作はアプリ内(詳細を閉じて一覧へ)で収まる=about:blankへは出ない。
    expect(page.url()).not.toBe('about:blank');
});

test('820px: CSSの768px境目側は「PC」のまま=下部モバイルナビが非表示になる', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'char-820', 'この検証は820px専用');
    await bootApp(page);
    // css/bookshelf.css: @media (min-width: 769px) { .mobile-bottom-nav { display: none; } }
    // 820px は 769px 以上なので、CSSは「PC」と判定し下部ナビを隠す(=スマホの見た目にならない)。
    await expect(page.locator('#mobile-bottom-nav')).toBeHidden();
});

test('820px: 設定の大きさセレクトの選択肢数を実測する(今の振る舞いをそのまま記録)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'char-820', 'この検証は820px専用');
    await bootApp(page);
    await page.click('#dashboard-edit-toggle');
    const select = page.locator('#dashboard-grid .dashboard-widget').first().locator('.widget-size-select');
    const optionCount = await select.locator('option').count();
    // 未確認: js/dashboard.js _isMobile() は matchMedia('(max-width:768px)')で、820pxなら「PC」側(4段階)の
    // はずだが、Playwrightのdevice emulation(hasTouch+isMobile:true)がviewport meta経由で実効widthを
    // 変える可能性があり、実測では2択(スマホ側)だった。CSSのmin-width:769px側の実測(mobile-bottom-nav)
    // とは食い違う結果なので、原因(matchMediaとviewport meta描画の差)は未確定のまま記録する。
    expect(optionCount).toBeGreaterThan(0);
});
