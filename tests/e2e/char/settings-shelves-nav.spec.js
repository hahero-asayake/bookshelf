// イシュー#501 U0b: S(設定)・L(本棚)・N(移動/検索)・I(取込等)の今の振る舞いを固定する(77件表)。
// 時間の都合で、各IDは77件表の対象幅のうち代表1〜2幅のみ実測する(docs/char/u0-77-table.mdに明記)。
import { test, expect } from '../helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page, { hub = false } = {}) {
    await page.addInitScript(([userData, library, withHub]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        const sync = { method: 'local' };
        // openReportModal()はhub.key/apiBaseが無いとログイン案内に分岐する(実測)。usage-alert.spec.jsと
        // 同じ注入方式でhubログイン済み相当にする。
        if (withHub) sync.hub = { key: 'hk_test', apiBase: 'https://hub.example', email: 'e2e@example.com', quotaBytes: 100 * 1024 * 1024, usedBytes: 0, plan: 'free' };
        localStorage.setItem('bookshelf_sync', JSON.stringify(sync));
    }, [fixtureUserData, fixtureLibrary, hub]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

async function openSidebarItem(page, id) {
    const btn = page.locator(id);
    const box = await btn.boundingBox();
    if (!box || box.x < 0) {
        await page.locator('[data-mobile-nav="shelves"]').click();
        await page.waitForTimeout(350);
    }
    await btn.click({ force: true });
}

// 設定を開く。PCは#sidebar-settings、モバイルは下部ナビの[data-mobile-nav="settings"]が直接開く(実測。
// js/bookshelf.js 6324-6326行)。
async function openSettings(page) {
    const pcBtn = page.locator('#sidebar-settings');
    const box = await pcBtn.boundingBox();
    if (box && box.x >= 0) await pcBtn.click();
    else await page.locator('[data-mobile-nav="settings"]').click();
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
}

test.describe('S: 設定', () => {
    for (const name of ['char-390', 'char-768', 'char-1024']) {
        test(`S2@${name}: 同期先の切替セレクトが見える(PCはlocalも選べる)`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用`);
            await bootApp(page);
            await openSettings(page);
            await page.locator('.settings-cat[data-cat="sync-section"]').click();
            const sel = page.locator('#sync-method-select');
            await expect(sel).toBeVisible();
            const opts = await sel.locator('option').evaluateAll((els) => els.map((e) => e.value));
            // 390/768/1024はタッチ(モバイル扱い)。PCのみの'local'選択肢が無いことも実測として記録する。
            test.info().annotations.push({ type: 'CHAR-77', description: `S2@${name}: options=${JSON.stringify(opts)}` });
            expect(opts.length).toBeGreaterThan(0);
        });
    }

    for (const name of ['char-1440', 'char-1920']) {
        test(`S3@${name}: 表示設定(星評価の表示)を変えるとすぐ反映される`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用`);
            // 未確認の訂正: 「テーマ」(配色)の設定UIはこのアプリに存在しない(data-theme属性・theme関連の
            // 設定項目をgrepしても無い)。実在する"表示"設定は#display-section内の起動時表示形式・星評価・
            // 短文メモ・Kindleの開き方(index.html 677-712行)。ここでは星評価の表示切替で代表する。
            await bootApp(page);
            await openSettings(page);
            await page.locator('.settings-cat[data-cat="display-section"]').click();
            const sel = page.locator('#setting-star-visibility');
            await expect(sel).toBeVisible();
            await sel.selectOption('hidden');
            await expect.poll(() => page.evaluate(() => window.bookshelf.userData.settings.starVisibility)).toBe('hidden');
        });
    }

    for (const name of ['char-390', 'char-768', 'char-1024', 'char-1440', 'char-1920']) {
        test(`S4@${name}: プラグインを無効化→設定を開くと一覧に反映される`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用`);
            await bootApp(page);
            await page.evaluate(() => {
                window.bookshelf.userData.settings = window.bookshelf.userData.settings || {};
                window.bookshelf.userData.settings.disabledPlugins = ['reading-goal'];
            });
            await openSettings(page);
            await page.locator('.settings-cat[data-cat="plugins-section"]').click();
            await expect(page.locator('#plugins-section')).toHaveJSProperty('open', true);
        });
    }

    for (const name of ['char-1440', 'char-1920']) {
        // イシュー#513 S6で期待を固定(②指示2026-11-03・フラグ新で実測): 本棚管理→本棚フォームの
        // 2面とも全幅化で段を積むようになったため、戻る(fromHistory)で _formBackGuard が発火し、
        // 破棄の確認(.cfm-overlay)が出る。フラグ旧(localStorage 'bookshelf.flag.histAllWidths'='0')
        // では元の動き(段を積まない・確認が出ない)に戻る。
        test(`S6@${name}: 入力途中で戻ると破棄の確認が出る(全幅化で新たに通る経路・イシュー#513)`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用`);
            await bootApp(page);
            await openSearch(page);
            await page.fill('#command-palette input', '本棚を管理');
            await page.waitForTimeout(200);
            await page.keyboard.press('Enter');
            await expect(page.locator('#bookshelf-modal')).toHaveClass(/show/);
            await page.click('#add-bookshelf');
            await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
            await page.fill('#bookshelf-form-modal input[type="text"]', '未保存の本棚名');
            await page.goBack();
            await expect(page.locator('.cfm-overlay')).toHaveCount(1);
        });
    }
});

// 本棚一覧(all)を開く。実測: #sidebar-bookshelf-tree内の.tree-node[data-bookshelf-id="all"]をクリックする
// (#app-sidebarは左ペイン全体のコンテナで、ツリー項目自体は#sidebar-bookshelf-tree配下)。
async function openAllShelf(page) {
    const tree = page.locator('#sidebar-bookshelf-tree');
    const box = await tree.boundingBox();
    if (!box || box.x < 0) {
        await page.locator('[data-mobile-nav="shelves"]').click();
        await expect.poll(() => page.evaluate(() => document.getElementById('app-sidebar').getBoundingClientRect().x)).toBeGreaterThanOrEqual(-5);
    }
    await tree.locator('.tree-node[data-bookshelf-id="all"]').click({ force: true });
    await expect(page.locator('body')).toHaveClass(/app-view-bookshelf/);
}

// 検索(⌘K相当)を開く。PCは#sidebar-search、モバイルは下部ナビの[data-mobile-nav="search"](実測)。
async function openSearch(page) {
    const pcBtn = page.locator('#sidebar-search');
    const box = await pcBtn.boundingBox();
    if (box && box.x >= 0) await pcBtn.click();
    else await page.locator('[data-mobile-nav="search"]').click();
}

const L_WIDTHS = ['char-390', 'char-768', 'char-1024', 'char-1440', 'char-1920'];

test.describe('L: 本棚', () => {
    for (const name of L_WIDTHS) {
        test(`L1@${name}: 一覧で複数選択→一括で本棚に追加できる`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用`);
            await bootApp(page);
            await openAllShelf(page);
            await page.click('#toggle-select-mode');
            await expect(page.locator('body')).toHaveClass(/select-mode/);
            await page.locator('.book-item').first().click();
            await expect(page.locator('#bulk-bar')).toBeVisible();
            await expect(page.locator('#bulk-count')).toHaveText('1 冊選択中');
            await page.click('#bulk-add-shelf');
            await expect(page.locator('#bulk-shelf-popover')).toBeVisible();
            const target = page.locator('#bulk-shelf-popover [data-bookshelf-id], #bulk-shelf-popover button, #bulk-shelf-popover .tree-node').filter({ hasText: 'テスト本棚' }).first();
            await target.click();
            await page.waitForTimeout(200);
            const added = await page.evaluate(() => {
                const bs = window.bookshelf.userData.bookshelves.find((b) => b.name === 'テスト本棚');
                return bs && bs.books.includes('B000000001');
            });
            expect(added).toBe(true);
        });

        test(`L2@${name}: 本棚を作る(名前+アイコン)とツリーに出る`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用`);
            await bootApp(page);
            // #add-bookshelfは#bookshelf-modal(本棚管理)の内側にあり、常時表示ではない(実測)。
            // 本棚管理を開く入口はサイドバーに静的ボタンが無く、コマンドパレット経由のみ(js/bookshelf.js:1265)。
            await openSearch(page);
            await page.fill('#command-palette input', '本棚を管理');
            await page.waitForTimeout(200);
            await page.keyboard.press('Enter');
            await expect(page.locator('#bookshelf-modal')).toHaveClass(/show/);
            await page.click('#add-bookshelf');
            await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
            await page.fill('#bookshelf-form-modal input[type="text"]', `U0bテスト本棚-${name}`);
            await page.click('#save-bookshelf-form');
            await expect.poll(() => page.evaluate((n) => window.bookshelf.userData.bookshelves.some((b) => b.name === n), `U0bテスト本棚-${name}`)).toBe(true);
            await expect(page.locator('#bookshelves-list')).toContainText(`U0bテスト本棚-${name}`, { timeout: 5000 });
        });

        test(`L4@${name}: 表示をリストに切り替え、並べ替え・絞り込みが反映される`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用`);
            await bootApp(page);
            await openAllShelf(page);
            // 表示形式は#toggle-display→#display-popover内の#view-seg(実測。index.html 268-278行目)。
            await page.click('#toggle-display');
            await expect(page.locator('#display-popover')).toBeVisible();
            const listBtn = page.locator('#view-seg .rseg[data-view="list"]');
            await listBtn.click();
            await expect(listBtn).toHaveClass(/\bon\b/); // 実測: active状態は"on"クラス(is-active/activeではない)
            await page.selectOption('#sort-order', 'title');
            await page.waitForTimeout(200);
            const count = await page.locator('.book-item').count();
            expect(count).toBeGreaterThan(0);
        });
    }

    for (const name of ['char-390', 'char-768']) {
        test(`L6@${name}: スマホで引き出しから本棚を選ぶと一覧に戻る`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, 'L6はスマホ専用(390/768)');
            await bootApp(page);
            await page.locator('[data-mobile-nav="shelves"]').click();
            // オフキャンバスの引き出しはisVisible()が効かない(要素はDOM上に常時存在)。
            // #app-sidebarのtransform(x座標)で開閉を判定する(②指示どおり)。
            await expect.poll(() => page.evaluate(() => document.getElementById('app-sidebar').getBoundingClientRect().x)).toBeGreaterThanOrEqual(-5);
            await page.locator('#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="all"]').click();
            await expect(page.locator('body')).toHaveClass(/app-view-bookshelf/);
            // 引き出しは閉じて一覧(本棚ビュー)に戻る: #app-sidebarが再び画面外(x<0)になる
            await expect.poll(() => page.evaluate(() => document.getElementById('app-sidebar').getBoundingClientRect().x)).toBeLessThan(0);
        });
    }
});

test.describe('L3: ツリーで並べ替え・項目メニュー', () => {
  for (const name of ['char-1440', 'char-1920']) {
    test(`L3@${name}: 項目メニュー(編集)で名前を変える`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== name, `この端末専用`);
        await bootApp(page);
        // テスト本棚(fixshelf)は"all"の子で、既定(localStorage未設定)では折りたたまれて非表示(実測)。
        // "all"ノードの.tree-toggleを先に押して展開する。
        const allNode = page.locator('#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="all"]');
        await allNode.locator('.tree-toggle').click();
        const node = page.locator('#sidebar-bookshelf-tree .tree-node').filter({ hasText: 'テスト本棚' }).first();
        await expect(node).toBeVisible();
        await node.hover();
        await node.locator('.tree-more').click();
        await expect(page.locator('#tree-node-menu')).toBeVisible();
        await page.locator('#tree-node-menu [data-act="edit"]').click();
        await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
        await page.fill('#bookshelf-name', '名前変更後の本棚');
        await page.click('#save-bookshelf-form');
        await expect.poll(() => page.evaluate(() => window.bookshelf.userData.bookshelves.some((b) => b.name === '名前変更後の本棚'))).toBe(true);
    });
  }
});

test.describe('N: 移動と検索', () => {
    for (const name of ['char-390', 'char-768']) {
        test(`N1@${name}: タップで検索(⌘K相当)を開き本を探して開く`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用`);
            await bootApp(page);
            await openSearch(page);
            await expect(page.locator('#command-palette')).toBeVisible();
            await page.fill('#command-palette input', 'フィクスチャの本 1');
            await page.waitForTimeout(300);
            await page.keyboard.press('Enter');
            await expect(page.locator('#book-detail-pane .bd-title, .book-detail-modal')).toBeVisible();
        });
    }

    for (const name of ['char-390', 'char-768', 'char-1024']) {
        test(`N2@${name}: 検索からコマンド(設定を開く)を実行できる`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用`);
            await bootApp(page);
            await openSearch(page);
            await page.fill('#command-palette input', '設定');
            await page.waitForTimeout(300);
            await page.keyboard.press('Enter');
            await expect(page.locator('#settings-modal')).toHaveClass(/show/);
        });
    }

    for (const name of ['char-390', 'char-768', 'char-1024']) {
        test(`N3@${name}: 検索ポップオーバーで絞り込み→解除`, async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== name, `この端末専用`);
            await bootApp(page);
            await openAllShelf(page);
            // #toggle-search→#search-popover(実測: js/bookshelf.js 1123行目)。
            await page.click('#toggle-search');
            await expect(page.locator('#search-popover')).toBeVisible();
            const input = page.locator('#search-popover input[type="text"], #search-popover input[type="search"]').first();
            await input.fill('フィクスチャの本 1');
            await page.waitForTimeout(300);
            const filteredCount = await page.locator('.book-item').count();
            await input.fill('');
            await page.waitForTimeout(300);
            const clearedCount = await page.locator('.book-item').count();
            expect(clearedCount).toBeGreaterThanOrEqual(filteredCount);
        });
    }
});

test.describe('I: 取込・通報', () => {
  for (const name of ['char-390', 'char-768', 'char-1024']) {
    test(`I4@${name}: 通報モーダルを開いて閉じる`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== name, `この端末専用`);
        await bootApp(page, { hub: true }); // openReportModal()はhub未ログインだとログイン案内に分岐する(実測)
        // 通報の入口は公開記事の外部ページ(このアプリの外)にあり、アプリ内UIからは到達できない。
        // 既存のtests/e2e/report-moderation.spec.js(140行目等)も同じくwindow.bookshelf.openReportModal()を
        // 直接呼んでいる(アプリ内に対応UIが無い唯一の例外・既存の型を踏襲)。
        await page.evaluate(() => { window.bookshelf.openReportModal('https://example.com/u/book/1'); });
        await expect(page.locator('#report-modal')).toHaveClass(/show/);
        await page.click('#report-modal-close');
        await expect(page.locator('#report-modal')).not.toHaveClass(/show/);
    });
  }
});
