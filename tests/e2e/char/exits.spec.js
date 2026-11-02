// イシュー#501 U0a: 出口 P9〜P11 と「PCの戻る」の今の振る舞いを固定する。
// 出典: 499-step3-arch.md §5-1(121〜122・128行目)。ただし同文書の§3(実測の列挙)は
// `TESTS_PLACEHOLDER` のまま=recovered文書で本文が失われている(docs/char/u0-targets.md §4)。
// そのため「4か所」の内訳は、コードを実際にgrepして見つけた3つのゲートで代表する:
//   1) js/nav-state.js:413-414 NavState.open() の `if (!mobile) return` (設定モーダル等の汎用面)
//   2) js/bookshelf.js:13283-13285 _modalHistPush() の `if (!mobile) return`(直呼び約30か所の中央ゲート)
//   3) js/nav-state.js:277-279 reduce3 の openBook3 分岐(本の詳細)
// 根は js/bookshelf.js:13185 _isHistMobile()(matchMedia max-width:900px)。
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

// PC幅(char-1440/char-1920)だけが対象。390/768/820/1024はタッチ=スマホ側の挙動になるため対象外。
const PC_PROJECTS = ['char-1440', 'char-1920'];

test.describe('P9/pc-back ゲート1: 本の詳細を開く (reduce3 openBook3分岐)', () => {
    // 未確認: ホームのウィジェット(.widget-book-cell)から本の詳細を開く経路は、実測で
    // history.length が2→3に増える(履歴が積まれる)ことを確認した。これは
    // docs/char/u0-targets.md §4 で読んだコード(reduce3のopenBook3分岐・mobile=falseなら
    // facesに追加しない)から予想した「PCでは積まない」と食い違う。別の経路(router経由の
    // adopt等)がPC幅でも押し込んでいる可能性があり、このrun内では原因を特定できなかった。
    // 誤った期待を固定しないよう、ここでは実行せず次段(U0b or 追調査)に回す。
    test.skip('PC幅で本の詳細を開いてから戻る (ホームのウィジェット入口) — 実測が想定と食い違うため今回は見送り。要追加調査', () => {});
});

test.describe('P11: PCの本の詳細は×とEscで閉じる(手元の資料・イシュー#511 X1)', () => {
    test('PC幅で本の詳細を開いてEscを押すと閉じる // CHAR: 直す対象(step2 P11)', async ({ page }, testInfo) => {
        test.skip(!PC_PROJECTS.includes(testInfo.project.name), 'P11はPC幅の右ペインの話');
        await bootApp(page);
        await page.locator(`.widget-book-cell[data-asin="${ASIN}"]`).first().click();
        await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
        await expect(page.locator('#book-detail-pc-close')).toBeVisible();
        await page.keyboard.press('Escape');
        // 新しい振る舞い: Esc で閉じ、プレースホルダ表示に戻る(イシュー#511 X1・_exitBookDetail)
        await expect(page.locator('#book-detail-pane .detail-placeholder')).toBeVisible();
        await expect(page.locator('body')).not.toHaveClass(/book-detail-pinned/);
    });

    test('PC幅で本の詳細を開いて×を押すと閉じる // CHAR: 直す対象(step2 P11)', async ({ page }, testInfo) => {
        test.skip(!PC_PROJECTS.includes(testInfo.project.name), 'P11はPC幅の右ペインの話');
        await bootApp(page);
        await page.locator(`.widget-book-cell[data-asin="${ASIN}"]`).first().click();
        await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
        await page.locator('#book-detail-pc-close').click();
        await expect(page.locator('#book-detail-pane .detail-placeholder')).toBeVisible();
        await expect(page.locator('body')).not.toHaveClass(/book-detail-pinned/);
    });
});

test.describe('P10: 1024幅で手動追加の破棄確認が出ない', () => {
    test('1024(タッチ)で本を手動追加→入力→戻る。破棄の確認(.cfm-overlay)が出ない(今の振る舞い) // CHAR: 直す対象(step2 P10)', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'char-1024', 'P10は1024幅が対象(499-step4-plan.md 198行目)');
        await bootApp(page);
        // ⌘K から「本を手動追加」を実行(クリック+入力のみ。内部メソッド不使用)
        await page.locator('#sidebar-search').click();
        await page.fill('#command-palette input', '本を手動追加');
        await page.waitForTimeout(200);
        await page.keyboard.press('Enter');
        await expect(page.locator('#add-book-modal')).toHaveClass(/show/);
        const titleInput = page.locator('#add-book-modal input[name="title"], #add-book-modal #manual-title');
        if (await titleInput.count() > 0) await titleInput.first().fill('未保存のタイトル');
        await page.goBack();
        await page.waitForTimeout(200);
        // 今の振る舞い: 1024はmobile=false(_isHistMobile:900px境目)のため、モーダルは
        // 履歴に積まれておらず、戻るで破棄の確認(.cfm-overlay)が出ないまま遷移する。
        await expect(page.locator('.cfm-overlay')).toHaveCount(0);
    });
});
