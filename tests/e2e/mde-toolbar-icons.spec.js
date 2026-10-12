// イシュー#281 (②決裁2026-10-12「案1」): EasyMDEツールバーの「アイコン+小さいラベル」縦並びを
// 長文メモ・文章ブロックの両方・4場面 (長文メモ390・文章ブロック390・PC右ペイン・長文メモ1280) で確認する。
// イシュー#282 (②決裁2026-10-13差し戻し): どの画面でも共通8個(見出し・太字・箇条書き・番号付き・
// 引用・リンク・表・プレビュー)に統一。PC全幅だけ区切りの後ろに並べて表示・全画面を追加。
// 見出しは押すと3択メニュー(大見出し/小見出し/見出しを外す)になる(_mdeToggleHeadingMenu)。
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

const COMMON8 = ['見出し', '太字', '箇条書き', '番号付き', '引用', 'リンク', '表', 'プレビュー'];

// 共通アサーション: ツールバーのボタン全てが svg+ラベルを持ち、1段・44px以上・ラベル非切れであること
async function expectIconizedToolbar(page, toolbarSel, { expectCount, expectLabels } = {}) {
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
                label: lbl ? lbl.textContent : '',
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
    if (expectLabels) expect(measured.dims.map(d => d.label)).toEqual(expectLabels);
}

test.describe('EasyMDEツールバー「アイコン+ラベル」縦並び・機能共通化 (イシュー#281/#282)', () => {
    test('長文メモ390: 共通8個・アイコン+ラベル・1段・44px以上・ラベル非切れ', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = await bootApp(page);
        await openMemo(page);
        await expectIconizedToolbar(page, '#book-memo-modal .editor-toolbar.mde-iconized', { expectCount: 8, expectLabels: COMMON8 });
        expect(errors).toEqual([]);
    });

    test('文章ブロック390 (全画面): 共通8個・アイコン+ラベル・1段・44px以上・ラベル非切れ', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = await bootApp(page);
        await newArticleWithTextBlock(page);
        await expect(page.locator('#art-canvas')).toBeHidden(); // 390幅は全画面 (イシュー#278回帰)
        await expectIconizedToolbar(page, '#art-blocks .editor-toolbar.mde-iconized', { expectCount: 8, expectLabels: COMMON8 });
        expect(errors).toEqual([]);
    });

    test('PC右ペイン (文章ブロック,1280幅): 共通8個・アイコン+ラベル・1段・44px以上・ラベル非切れ', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const errors = await bootApp(page);
        await newArticleWithTextBlock(page);
        await expect(page.locator('#art-canvas')).toBeVisible(); // PC900超は右ペイン (イシュー#278)
        await expectIconizedToolbar(page, '#art-blocks .editor-toolbar.mde-iconized', { expectCount: 8, expectLabels: COMMON8 });
        expect(errors).toEqual([]);
    });

    test('長文メモ1280 (PC全幅): 共通8個+区切り+並べて表示/全画面の10個・1段・44px以上・ラベル非切れ', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        const errors = await bootApp(page);
        await openMemo(page);
        await expectIconizedToolbar(page, '#book-memo-modal .editor-toolbar.mde-iconized', { expectCount: 10, expectLabels: [...COMMON8, '並べて表示', '全画面'] });
        const seps = await page.locator('#book-memo-modal .editor-toolbar.mde-iconized i.separator').count();
        expect(seps).toBe(1); // 共通8個の後ろに区切り1本だけ (イシュー#282)
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

// イシュー#282差し戻し: 見出しボタンは押すと3択メニュー(大見出し##/小見出し###/見出しを外す)。
// 現在行のレベルに✓・EasyMDE.toggleHeading2/3を使う(すでにそのレベルなら外す挙動も標準装備)。
test.describe('見出しボタンの3択メニュー (イシュー#282)', () => {
    test('長文メモ390: クリックで3項目がビューポート内に出て、選ぶと実際に見出しが付きパネルは閉じる', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = await bootApp(page);
        await openMemo(page);
        await page.evaluate(() => window.bookshelf._bookMemoEditor.value('本文行'));
        await page.click('#book-memo-modal .editor-toolbar button[title="見出し"]');
        const menu = page.locator('.mde-heading-menu');
        await expect(menu).toBeVisible();
        const labels = await menu.locator('.mde-heading-item').allTextContents();
        expect(labels.map(s => s.trim())).toEqual(['大見出し（##）', '小見出し（###）', '見出しを外す']);
        const box = await menu.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.y + box.height).toBeLessThanOrEqual(844);

        await page.locator('.mde-heading-item', { hasText: '大見出し' }).click();
        expect(await page.evaluate(() => window.bookshelf._bookMemoEditor.value())).toBe('## 本文行');
        await expect(menu).toHaveCount(0);
        await expect(page.locator('#book-memo-modal')).toHaveClass(/show/); // エディタは残る
        expect(errors).toEqual([]);
    });

    test('現在のレベルに✓が付き、同じレベルをもう一度選ぶと見出しが外れる(トグル)', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = await bootApp(page);
        await openMemo(page);
        await page.evaluate(() => window.bookshelf._bookMemoEditor.value('## 本文行'));
        await page.click('#book-memo-modal .editor-toolbar button[title="見出し"]');
        await expect(page.locator('.mde-heading-item.is-current')).toHaveText(/大見出し/);
        await page.locator('.mde-heading-item', { hasText: '大見出し' }).click();
        expect(await page.evaluate(() => window.bookshelf._bookMemoEditor.value())).toBe('本文行');
        expect(errors).toEqual([]);
    });

    test('ESC/枠外クリック: メニューは自分だけ閉じ、エディタは残る (長文メモ・文章ブロック共通)', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = await bootApp(page);
        await openMemo(page);
        await page.click('#book-memo-modal .editor-toolbar button[title="見出し"]');
        await expect(page.locator('.mde-heading-menu')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.mde-heading-menu')).toHaveCount(0);
        await expect(page.locator('#book-memo-modal')).toHaveClass(/show/); // Escが丸ごと完了扱いになっていない
        await page.click('#book-memo-fs-done'); // 次の経路(記事エディタ)を開く前に閉じる(未変更なので確認なし)
        await expect(page.locator('#book-memo-modal')).not.toHaveClass(/show/);

        await newArticleWithTextBlock(page);
        await page.click('#art-blocks .editor-toolbar button[title="見出し"]');
        await expect(page.locator('.mde-heading-menu')).toBeVisible();
        await page.mouse.click(5, 5); // 枠外
        await expect(page.locator('.mde-heading-menu')).toHaveCount(0);
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form'); // 全画面は残る
        expect(errors).toEqual([]);
    });
});

// イシュー#282差し戻し: 長文メモ・記事エディタのヘッダーのタイトルは1行+末尾省略。
test.describe('ヘッダーのタイトル1行省略 (イシュー#282)', () => {
    test('長文メモ390: 60字級の書名でも1行のまま省略され、ボタンは押し出されず縦中心差1px以内', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = await bootApp(page);
        const LONG_TITLE = 'ハリー・ポッターと賢者の石　ハリー・ポッターシリーズ第一巻　完全版（静山社ペガサス文庫・携書サイズ・新装版・限定カバー）';
        await page.evaluate(async (title) => {
            const app = window.bookshelf;
            await app._openBookMemoInAppEditor('B000000001', { title });
        }, LONG_TITLE);
        await page.waitForSelector('#book-memo-modal.show .editor-toolbar', { timeout: 8000 });
        const r = await page.evaluate(() => {
            const title = document.getElementById('book-memo-fs-title');
            const cancel = document.querySelector('#book-memo-modal .btn-secondary');
            const done = document.querySelector('#book-memo-modal .btn-primary');
            const titleCol = cancel.nextElementSibling;
            const rc = (el) => el.getBoundingClientRect();
            const cy = (el) => { const b = rc(el); return b.top + b.height / 2; };
            return {
                isTruncated: title.scrollWidth > title.clientWidth,
                isSingleLine: rc(title).height < 30,
                centerYDiffMax: Math.max(Math.abs(cy(cancel) - cy(titleCol)), Math.abs(cy(cancel) - cy(done)), Math.abs(cy(titleCol) - cy(done))),
                doneRight: rc(done).right,
                cancelLeft: rc(cancel).left,
            };
        });
        expect(r.isTruncated).toBe(true);
        expect(r.isSingleLine).toBe(true);
        expect(r.centerYDiffMax).toBeLessThanOrEqual(1);
        expect(r.cancelLeft).toBeGreaterThanOrEqual(0);
        expect(r.doneRight).toBeLessThanOrEqual(390);
        expect(errors).toEqual([]);
    });
});
