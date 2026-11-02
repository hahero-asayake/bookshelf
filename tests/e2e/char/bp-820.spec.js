// イシュー#501 U0a: 820px (768と900に割れた境目) の今の振る舞いを固定する。
// 出典: 499-step3-arch.md 39〜40行目・docs/char/u0-targets.md §5(確認済み)。
// 820pxでは、JS側の判定(_isHistMobile・matchMedia max-width:900px)は「スマホ」だが、
// CSS側の判定(多くは max-width:768px / min-width:769px)は「PC」のまま。
// この2つの境目のずれを、履歴(戻る)の振る舞いと、下部ナビの見た目の両方で固定する。
//
// // CHAR→U2 (イシュー#505・2026-11-03): 境目をjs/ui/viewport.js(900px)の1組に統一した。
// 820pxはJS・CSSとも「スマホ」側になり、上の食い違いは解消済み。以下の期待のうち、
// 旧い768px境目を前提にしていたものを新しい振る舞いへ書き換えた(該当行に目印を付けた)。
// 820pxでdashboardカードが重なりクリックが通らない件(旧称「W5」→BP-820。docs/char/
// u0-findings.md §2参照)の解消を確かめるテストを足した。
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

test('820px: 境目を900pxに統一=下部モバイルナビが表示される(スマホ扱い)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'char-820', 'この検証は820px専用');
    await bootApp(page);
    // css/bookshelf.css: @media (min-width: 901px) { .mobile-bottom-nav { display: none; } }
    // 820px は 901px 未満なので、CSSも「スマホ」と判定し下部ナビを出す
    // (旧実装は min-width:769px で隠していた=820pxだけPCの見た目になっていた)。
    await expect(page.locator('#mobile-bottom-nav')).toBeVisible(); // CHAR→U2
});

test('820px: 境目を900pxに統一=設定の大きさセレクトはスマホの2択(半分/全幅)になる', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'char-820', 'この検証は820px専用');
    await bootApp(page);
    await page.click('#dashboard-edit-toggle');
    const select = page.locator('#dashboard-grid .dashboard-widget').first().locator('.widget-size-select');
    const optionLabels = await select.locator('option').allTextContents();
    // js/dashboard.js _isMobile() は window.viewport.isNarrow() (900px以下) を見るようになり、
    // 820pxは常に「スマホ」側=半分/全幅の2択になる(旧実装はmatchMedia('(max-width:768px)')で
    // 「PC」側のはずなのに実測2択という食い違いがあったが、900pxに統一したことで解消した)。
    expect(optionLabels).toEqual(['半分', '全幅']); // CHAR→U2
});

test('820px(BP-820): dashboardウィジェットの重なりが解消し、カードのクリック→サイズ変更が通る', async ({ page }, testInfo) => {
    // CHAR→U2: 旧称「W5」(docs/char/u0-findings.md §2で確認済みの誤記)の解消を確かめる新規テスト。
    // 旧実装は.container.app-shellが3ペイン常駐のまま(769-900pxでも単一ペイン化しない)で、
    // 中央ペインが280pxまで圧縮されdashboardカードが48px幅になり、隣のカードのクリックを
    // 奪っていた(intercepts pointer events)。境目を900pxに統一した結果、820pxで単一ペイン化
    // し圧縮が無くなったことを、2番目のカードの実クリック(インターセプトされれば失敗する)と
    // サイズ変更の反映で確かめる。
    test.skip(testInfo.project.name !== 'char-820', 'この検証は820px専用');
    await bootApp(page);
    await page.click('#dashboard-edit-toggle');
    const cards = page.locator('#dashboard-grid .dashboard-widget');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(1); // CHAR→U2

    // 2番目のカードのセレクトをクリック(1番目のカードに奪われず自身に届くこと)。
    const second = cards.nth(1);
    const select = second.locator('.widget-size-select');
    await select.click(); // CHAR→U2: interceptされればPlaywrightがタイムアウトして失敗する
    await expect(select).toBeFocused(); // CHAR→U2

    // サイズ変更が実際に反映される(select→m-half/m-fullのクラスが変わる)。
    const before = await second.getAttribute('class');
    const target = before.includes('m-full') ? 'half' : 'full';
    await select.selectOption(target);
    await expect(page.locator('#dashboard-grid .dashboard-widget').nth(1)).toHaveClass(new RegExp(`m-${target}\\b`)); // CHAR→U2
});
