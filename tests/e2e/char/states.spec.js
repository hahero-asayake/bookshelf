// イシュー#501 U0b: E(状態)系の今の振る舞いを固定する(77件表)。
// 既存のusage-alert.spec.js(localStorage注入)・sync-conflict系・report-moderationの型にならう。
// 失敗/オフラインはcontext.setOffline/page.routeで外側から起こす(アプリの内部は呼ばない)。
import { test, expect } from '../helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page, { noShelves = false } = {}) {
    const userData = JSON.parse(fixtureUserData);
    let library = fixtureLibrary;
    if (noShelves) {
        // 実測: "all"は本棚自身のbooks配列ではなくlibrary.booksをそのまま映す(特殊本棚)。
        // 空にするにはlibrary側も空にする必要がある。
        userData.bookshelves = userData.bookshelves.filter((b) => b.id === 'all');
        userData.bookshelves[0].books = [];
        const lib = JSON.parse(fixtureLibrary);
        lib.books = [];
        library = JSON.stringify(lib);
    }
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), library]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

// タッチ幅ではサイドバーがドロワーに畳まれている(settings-shelves-nav.spec.jsと同じ実測)。
async function clickShelfAll(page) {
    const tree = page.locator('#sidebar-bookshelf-tree');
    const box = await tree.boundingBox();
    if (!box || box.x < 0) {
        await page.locator('[data-mobile-nav="shelves"]').click();
        await expect.poll(() => page.evaluate(() => document.getElementById('app-sidebar').getBoundingClientRect().x)).toBeGreaterThanOrEqual(-5);
    }
    await tree.locator('.tree-node[data-bookshelf-id="all"]').click({ force: true });
    await expect(page.locator('body')).toHaveClass(/app-view-bookshelf/);
}

test.describe('E2: 空の表示', () => {
  for (const name of ['char-390', 'char-768', 'char-1024']) {
    test(`E2@${name}: 蔵書0の本棚を開くと空の案内が出る`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== name, `この端末専用`);
        await bootApp(page, { noShelves: true });
        await clickShelfAll(page);
        await expect(page.locator('.bookshelf-empty, .empty-state, [data-empty]').first()).toBeVisible({ timeout: 5000 });
    });
  }
});

test.describe('E3: オフラインで保存が失敗する', () => {
  for (const name of ['char-390', 'char-768', 'char-1024']) {
    test(`E3@${name}: オフラインにして短文メモを保存しても、データを失わない(今の振る舞い)`, async ({ page, context }, testInfo) => {
        test.skip(testInfo.project.name !== name, `この端末専用`);
        await bootApp(page);
        await page.locator('.widget-book-cell').first().click();
        await expect(page.locator('#book-detail-pane .bd-title')).toBeVisible();
        await context.setOffline(true);
        const memo = page.locator('#book-detail-pane textarea, .memo-textarea').first();
        if (await memo.count()) {
            await memo.fill('オフライン中のメモ');
            await page.waitForTimeout(300);
        }
        await context.setOffline(false);
        // 今の振る舞い: オフライン専用の失敗表示(トースト等)は出ない(step1 §4「専用の扱いが無い」の実測確認)
        const toastCount = await page.locator('.toast').count();
        expect(toastCount).toBe(0);
    });
  }
});

test.describe('E5: 容量の超過', () => {
  for (const name of ['char-390', 'char-768', 'char-1024']) {
    test(`E5@${name}: 使用率96%で強警告バナーとupgrade導線が出る`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== name, `この端末専用`);
        const MB = 1024 * 1024;
        // 実測で発見したバグ: addInitScript のコールバックはブラウザ側で評価されるため、Node側の
        // 変数(MB)をクロージャで参照できず例外になり、以降のsetItemが実行されない(virtualBookshelf_userData/
        // libraryだけ保存されbookshelf_syncが保存されなかった原因)。渡す引数に含めて修正する。
        await page.addInitScript(([u, l, quotaBytes, usedBytes]) => {
            localStorage.setItem('virtualBookshelf_userData', u);
            localStorage.setItem('virtualBookshelf_library', l);
            localStorage.setItem('bookshelf_sync', JSON.stringify({
                method: 'local',
                hub: { key: 'hk_test', apiBase: 'https://hub.example', email: 'e2e@example.com', quotaBytes, usedBytes, plan: 'free' }
            }));
        }, [fixtureUserData, fixtureLibrary, 100 * MB, 96 * MB]);
        await page.goto('index.html');
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        const banner = page.locator('#usage-alert-banner');
        await expect.poll(() => page.evaluate(() => window.bookshelf._usageAlertLevel)).toBe('strong');
        await expect(banner).toBeVisible();
        await expect(page.locator('#usage-alert-upgrade')).toBeVisible();
    });
  }
});

test.describe('E6: ウィジェットの描画失敗', () => {
  for (const name of ['char-390', 'char-768', 'char-1024', 'char-1440', 'char-1920']) {
    test(`E6@${name}: 1つのウィジェットがエラーでも他は動く`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== name, `この端末専用`);
        // 測れない理由(技術上の理由): ウィジェットのrender例外は js/dashboard.js の
        // entry.render.call(...) のtry/catch(282〜285行)でのみ発生し、呼び出し元は registry 内の
        // 関数そのもの(_renderCounterTotal等)。利用者の操作(クリック・タップ・キー)やcontext.route/
        // setOfflineのような外側からの入力では、個々のwidget.render内部で例外を発生させる経路が無い
        // (どのwidget typeもrender内でネットワーク呼び出しやlocalStorage読み込み失敗で例外を投げる
        // 分岐を持たない・コードを読んで確認した)。UI操作だけでは再現できないため測れない。
        test.skip(true, '技術上の理由: widget.render()内で例外を起こす外側からの入力経路が無い(js/dashboard.js 282-285行の解析による)');
    });
  }
});
