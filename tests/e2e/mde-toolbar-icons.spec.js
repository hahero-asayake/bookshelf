// イシュー#281 (②決裁2026-10-12「案1」): EasyMDEツールバーの「アイコン+小さいラベル」縦並びを
// 長文メモ・文章ブロックの両方・4場面 (長文メモ390・文章ブロック390・PC右ペイン・長文メモ1280) で確認する。
// _mdeApplyToolbarLabels (js/bookshelf.js) が共通で使われる関数なので、1関数の変更が全場面に効くことを
// 実機で裏取りする (関数の直呼びでなく、実際にモーダル/全画面を開く経路を通す)。
import { test, expect } from './helpers/test-base.js';
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
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        window.HubAuth.renderSignInButton = () => {};
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        adapter.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        adapter.readText = async (p) => (mem.has(p) ? mem.get(p) : null);
        adapter.writeText = async (p, t) => { mem.set(p, t); };
        window.bookshelf._isSyncReady = () => true;
    });
    return errors;
}

// 長文メモをアプリ内エディタで開く (既存の standard-ops.spec.js と同じ経路: _openBookMemoInAppEditor
// 自体が実装の本体で、UIの「長文メモ」ボタンもこの関数を呼ぶだけ)
async function openMemo(page, asin = 'B000000001') {
    await page.evaluate(async (a) => {
        const app = window.bookshelf;
        const book = app.books.find(b => b.asin === a);
        await app._openBookMemoInAppEditor(a, book);
    }, asin);
    await page.waitForSelector('#book-memo-modal.show .editor-toolbar.mde-iconized', { timeout: 8000 });
}

const canvas = (page) => page.frameLocator('#art-canvas-frame');
const LONG = ['## 見出しです', '本文の段落。'.repeat(30)].join('\n\n');

async function newArticleWithTextBlock(page) {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    // 新規記事は閲覧状態で開くことがある (article-pc-pane.spec.js の enterEdit と同じ)
    const editBtn = page.locator('#art-mode-edit');
    if (await editBtn.isVisible()) await editBtn.click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
    await canvas(page).locator('.art-cv-ins-btn').first().click();
    await page.locator('#art-add-sheet [data-block-type="text"]').click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
    await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
    await page.evaluate((m) => window.bookshelf._artTextFsEditor.value(m), LONG);
    await page.waitForSelector('.editor-toolbar.mde-iconized', { timeout: 8000 });
}

// 共通アサーション: ツールバーのボタン全てが svg+ラベルを持ち、1段・44px以上・ラベル非切れであること
async function expectIconizedToolbar(page, toolbarSel, { expectCount } = {}) {
    const toolbar = page.locator(toolbarSel);
    await expect(toolbar).toHaveCount(1);
    const buttons = toolbar.locator('button');
    const count = await buttons.count();
    if (expectCount) expect(count).toBe(expectCount);
    expect(count).toBeGreaterThan(0);

    // 各ボタンが svg (アイコン) とラベル要素を持つ
    for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        await expect(btn.locator('svg')).toHaveCount(1);
        await expect(btn.locator('.mde-tb-lbl')).toHaveCount(1);
    }

    const measured = await page.evaluate((sel) => {
        const btns = [...document.querySelector(sel).querySelectorAll('button')];
        const tops = new Set(btns.map(b => Math.round(b.getBoundingClientRect().top)));
        const dims = btns.map(b => {
            const r = b.getBoundingClientRect();
            const lbl = b.querySelector('.mde-tb-lbl');
            return {
                w: r.width, h: r.height,
                labelOverflow: lbl ? lbl.scrollWidth > lbl.clientWidth + 1 : false,
            };
        });
        return { rows: tops.size, dims };
    }, toolbarSel);

    expect(measured.rows).toBe(1); // 1段に収まっている
    for (const d of measured.dims) {
        expect(d.w).toBeGreaterThanOrEqual(44);
        expect(d.h).toBeGreaterThanOrEqual(44);
        expect(d.labelOverflow).toBe(false); // ラベルが切れていない (scrollWidth<=clientWidth)
    }
}

test.describe('EasyMDEツールバー「アイコン+ラベル」縦並び (イシュー#281)', () => {
    test('長文メモ390: 8ボタン(よく使う7個+その他)・アイコン+ラベル・1段・44px以上・ラベル非切れ', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = await bootApp(page);
        await openMemo(page);
        await expectIconizedToolbar(page, '#book-memo-modal .editor-toolbar.mde-iconized', { expectCount: 8 });
        expect(errors).toEqual([]);
    });

    test('文章ブロック390 (全画面): 8ボタン(よく使う7個+その他)・アイコン+ラベル・1段・44px以上・ラベル非切れ', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = await bootApp(page);
        await newArticleWithTextBlock(page);
        await expect(page.locator('#art-canvas')).toBeHidden(); // 390幅は全画面 (イシュー#278回帰)
        await expectIconizedToolbar(page, '#art-blocks .editor-toolbar.mde-iconized', { expectCount: 8 });
        expect(errors).toEqual([]);
    });

    test('PC右ペイン (文章ブロック,1280幅): 8ボタン(よく使う7個+その他)・アイコン+ラベル・1段・44px以上・ラベル非切れ', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const errors = await bootApp(page);
        await newArticleWithTextBlock(page);
        await expect(page.locator('#art-canvas')).toBeVisible(); // PC900超は右ペイン (イシュー#278)
        await expectIconizedToolbar(page, '#art-blocks .editor-toolbar.mde-iconized', { expectCount: 8 });
        expect(errors).toEqual([]);
    });

    test('長文メモ1280 (PC全幅): 14ボタン+区切り・アイコン+ラベル・1段・44px以上・ラベル非切れ', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const errors = await bootApp(page);
        await openMemo(page);
        await expectIconizedToolbar(page, '#book-memo-modal .editor-toolbar.mde-iconized', { expectCount: 14 });
        // 区切り (`<i class="separator">`) が4本 (_mdeToolbarConfig の '|' も4個・js/bookshelf.js)
        const seps = await page.locator('#book-memo-modal .editor-toolbar.mde-iconized i.separator').count();
        expect(seps).toBe(4);
        expect(errors).toEqual([]);
    });

    test('長文メモと文章ブロックで同じ見た目になる (太字ボタンの内側構造が一致)', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = await bootApp(page);
        await openMemo(page);
        const memoBtnHtml = await page.evaluate(() => window.bookshelf._bookMemoEditor.toolbarElements.bold.innerHTML);
        await page.click('#book-memo-fs-done'); // 未変更なので確認なしで保存して閉じる (イシュー#282・_bookMemoFsDone)
        await expect(page.locator('#book-memo-modal')).not.toHaveClass(/show/);

        await newArticleWithTextBlock(page);
        const blockBtnHtml = await page.evaluate(() => window.bookshelf._artTextFsEditor.toolbarElements.bold.innerHTML);
        expect(blockBtnHtml).toBe(memoBtnHtml);
        expect(errors).toEqual([]);
    });
});

// イシュー#282: compact構成(スマホ・PC右ペイン)の「⋯その他」パネル。実体はEasyMDEの本物の
// ボタン(_mdeSetupOverflowMenu が移動)なので、中身を動かすと実際に書式が変わることまで確認する
// (アイコン化の見た目だけでなく機能も揃っていることの裏取り)。
test.describe('書式ツールバーの「⋯その他」(イシュー#282)', () => {
    test('長文メモ390: その他を開くと5項目(斜体/画像/表/区切り線/ガイド)がビューポート内に出る', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = await bootApp(page);
        await openMemo(page);
        await page.click('#book-memo-modal .mde-overflow-btn');
        const panel = page.locator('.mde-overflow-menu');
        await expect(panel).toBeVisible();
        const labels = await panel.locator('.mde-tb-lbl').allTextContents();
        expect(labels).toEqual(['斜体', '画像', '表', '区切り線', 'ガイド']);
        const box = await panel.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.y + box.height).toBeLessThanOrEqual(844);
        expect(errors).toEqual([]);
    });

    test('長文メモ390: 斜体を選ぶと実際に本文へ反映され、パネルは閉じる(エディタは開いたまま)', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = await bootApp(page);
        await openMemo(page);
        const before = await page.evaluate(() => window.bookshelf._bookMemoEditor.value());
        await page.click('#book-memo-modal .mde-overflow-btn');
        await page.locator('.mde-overflow-menu button', { hasText: '斜体' }).click();
        const after = await page.evaluate(() => window.bookshelf._bookMemoEditor.value());
        expect(after).not.toBe(before); // 実物のEasyMDEアクションが動いている (移植後も機能が保たれている)
        await expect(page.locator('.mde-overflow-menu')).toBeHidden();
        await expect(page.locator('#book-memo-modal')).toHaveClass(/show/); // エディタ自体は閉じない
        expect(errors).toEqual([]);
    });

    test('ESC/枠外クリック: その他パネルは自分だけ閉じ、エディタは残る (長文メモ・文章ブロック共通)', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = await bootApp(page);
        await openMemo(page);
        await page.click('#book-memo-modal .mde-overflow-btn');
        await expect(page.locator('.mde-overflow-menu')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.mde-overflow-menu')).toBeHidden();
        await expect(page.locator('#book-memo-modal')).toHaveClass(/show/); // Escが丸ごと完了扱いになっていない
        await page.click('#book-memo-fs-done'); // 次の経路(記事エディタ)を開く前に閉じる(未変更なので確認なし)
        await expect(page.locator('#book-memo-modal')).not.toHaveClass(/show/);

        await newArticleWithTextBlock(page);
        await page.click('#art-blocks .mde-overflow-btn');
        await expect(page.locator('.mde-overflow-menu')).toBeVisible();
        await page.mouse.click(5, 5); // 枠外
        await expect(page.locator('.mde-overflow-menu')).toBeHidden();
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form'); // 全画面は残る
        expect(errors).toEqual([]);
    });

    test('PC全幅(長文メモ1280): その他は出ない(12機能+表示切替2個が既に1段)', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const errors = await bootApp(page);
        await openMemo(page);
        await expect(page.locator('#book-memo-modal .mde-overflow-btn')).toHaveCount(0);
        expect(errors).toEqual([]);
    });
});
