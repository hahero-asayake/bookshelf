// イシュー#278: 記事エディタのPC改善 (本文幅860・文章ブロックの右ペイン編集)。
// 本文幅は公開生成器の .article と同値＝閲覧状態のキャンバスと公開ページが1px単位で一致することを実測する。
// 文章ブロックは 900px 超で右ペイン (引き出しの列を置き換え・左に記事を出したまま入力に追従)、
// 390 では従来どおり全画面。閉じ方の規則 (ESC=完了・キャンセル=変更ありなら確認・枠外クリックで閉じない) は共通。
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
        window.bookshelf._isSyncReady = () => true;
    });
    return errors;
}

// 新規記事が閲覧状態で開いた時は「編集」を押して編集状態へ (addBlock ヘルパーと同じ)
async function enterEdit(page) {
    await expect(page.locator('#art-edit-view')).toBeVisible();
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible()) await edit.click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
}
const canvas = (page) => page.frameLocator('#art-canvas-frame');
const LONG = ['## 見出しです', '本文の段落。'.repeat(30), '### 小見出し', '- 項目1\n- 項目2', '最後の段落。'.repeat(20)].join('\n\n');

// 新規記事を作り、文章ブロックを1つ置いて本文を入れて編集状態へ戻す
async function newArticleWithText(page, md = LONG) {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await enterEdit(page);
    await canvas(page).locator('.art-cv-ins-btn').first().click();
    await page.locator('#art-add-sheet [data-block-type="text"]').click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
    await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
    await page.evaluate((m) => window.bookshelf._artTextFsEditor.value(m), md);
    await page.click('#art-fs-done');
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
}

async function openTextBlock(page) {
    await canvas(page).locator('section[data-art-idx="0"]').click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
    await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
}

const box = async (loc) => { const b = await loc.boundingBox(); expect(b).not.toBeNull(); return b; };
const articleWidth = (page) => page.evaluate(() => document.getElementById('art-canvas-frame').contentDocument.querySelector('.article').getBoundingClientRect().width);

for (const vp of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
    test.describe(`記事エディタ PC ${vp.width}幅 (イシュー#278)`, () => {
        test.use({ viewport: vp });

        test('本文幅860: 閲覧状態と公開ページが1px単位で一致し、編集状態でも860が入る', async ({ page, context }) => {
            const errors = await bootApp(page);
            await newArticleWithText(page);
            // 編集状態 (引き出しの横) でも 860 が入る＝モーダルが広がっている
            await expect.poll(() => articleWidth(page)).toBe(860);
            const modal = await box(page.locator('#publish-pages-modal .art-modal-content'));
            expect(modal.width).toBeGreaterThan(1080);
            const side = await box(page.locator('.art-side'));
            const frame = await box(page.locator('#art-canvas-frame'));
            expect(frame.x + frame.width).toBeLessThanOrEqual(side.x);

            // 閲覧状態
            await page.click('#art-mode-done');
            await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'view');
            // 閲覧状態の描き直し (編集の枠・＋が外れた版) を待つ
            await expect(canvas(page).locator('.art-cv-ui')).toHaveCount(0);
            await expect(canvas(page).locator('h2', { hasText: '見出しです' })).toHaveCount(1);
            await expect.poll(() => articleWidth(page)).toBe(860);
            const frameW = await page.evaluate(() => document.getElementById('art-canvas-frame').contentDocument.documentElement.clientWidth);
            const rects = (doc) => [...doc.querySelectorAll('.article, .article h1, .article h2, .article h3, .article p, .article li')]
                .map(el => { const r = el.getBoundingClientRect(); return [el.tagName, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; });
            const inCanvas = await page.evaluate(`(${rects.toString()})(document.getElementById('art-canvas-frame').contentDocument)`);

            // 公開ページ: 公開生成器 (markBlocks なし) の出力を、キャンバスと同じ幅のビューポートで開く
            const html = await page.evaluate(async () => {
                const app = window.bookshelf;
                const a = { ...app._artDraft, id: app._artDraft.id || '_p', slug: 'p', publicId: 'p' };
                const r = await app.publishArticleGenerator.build([a], { state: app._artBuildPreviewState() });
                return r.files.find(f => f.path.endsWith('index.html') && f.content.includes('class="article"')).content;
            });
            const pub = await context.newPage();
            await pub.setViewportSize({ width: frameW, height: vp.height });
            await pub.setContent(html);
            const inPublic = await pub.evaluate(`(${rects.toString()})(document)`);
            expect(inPublic.length).toBeGreaterThan(5);
            expect(inCanvas).toEqual(inPublic);
            await pub.close();
            expect(errors).toEqual([]);
        });

        test('文章ブロックは右ペインで開き、引き出しの列を置き換え、左の記事が入力に追従する', async ({ page }) => {
            const errors = await bootApp(page);
            await newArticleWithText(page);
            const sideBefore = await box(page.locator('.art-side'));
            await openTextBlock(page);
            const pane = await box(page.locator('#art-blocks .EasyMDEContainer'));
            const frame = await box(page.locator('#art-canvas-frame'));
            // 記事 (キャンバス) は見えたまま・ペインはその右で重ならない
            await expect(page.locator('#art-canvas-frame')).toBeVisible();
            expect(frame.x + frame.width).toBeLessThanOrEqual(pane.x);
            // 引き出しは隠れ、ペインはその列 (右端) に来る
            await expect(page.locator('.art-side')).toBeHidden();
            expect(Math.abs((pane.x + pane.width) - (sideBefore.x + sideBefore.width))).toBeLessThanOrEqual(1);
            // 対象ブロックを左の記事で枠表示
            await expect(canvas(page).locator('section[data-art-idx="0"].art-cv-fs-target')).toHaveCount(1);
            // 入力に追従
            await page.evaluate(() => window.bookshelf._artTextFsEditor.value('## 追従テスト見出し\n\n本文'));
            await expect(canvas(page).locator('h2', { hasText: '追従テスト見出し' })).toHaveCount(1);
            // 枠外 (左の記事) をクリックしても閉じない
            await canvas(page).locator('h2', { hasText: '追従テスト見出し' }).click();
            await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
            // キャンセル: 変更ありなら確認→「編集を続ける」で閉じない→「変更を破棄」で元に戻り記事も戻る
            await page.click('#art-fs-cancel');
            await page.click('.cfm-cancel');
            await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
            await page.click('#art-fs-cancel');
            await page.click('.cfm-ok');
            await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
            await expect(canvas(page).locator('h2', { hasText: '見出しです' })).toHaveCount(1);
            await expect(canvas(page).locator('h2', { hasText: '追従テスト見出し' })).toHaveCount(0);
            await expect(page.locator('.art-side')).toBeVisible();
            // ESC = 完了 (確定)
            await openTextBlock(page);
            await page.evaluate(() => window.bookshelf._artTextFsEditor.value('## ESCで確定\n\n本文'));
            await canvas(page).locator('h2', { hasText: 'ESCで確定' }).click(); // フォーカスを iframe 内へ
            await page.keyboard.press('Escape');
            await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
            await expect(canvas(page).locator('h2', { hasText: 'ESCで確定' })).toHaveCount(1);
            expect(errors).toEqual([]);
        });
    });
}

test.describe('記事エディタ 390幅は従来どおり全画面 (イシュー#278 回帰)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('文章ブロックは全画面で開き、記事 (キャンバス) は出ない', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await enterEdit(page);
        await canvas(page).locator('.art-cv-ins-btn').first().click();
        await page.locator('#art-add-sheet [data-block-type="text"]').click();
        await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
        await expect(page.locator('#art-canvas')).toBeHidden();
        const ed = await box(page.locator('#art-blocks .EasyMDEContainer'));
        expect(ed.x).toBeLessThanOrEqual(12);
        expect(ed.x + ed.width).toBeGreaterThanOrEqual(390 - 12);
        expect(errors).toEqual([]);
    });
});

// イシュー#278 step3: PCのブロック並べ替え (つまみのドラッグ・Alt+↑↓・aria-live・Undo)。
// 並べ替え対象の3ブロックは下書きへ直接置く (準備だけ)。並べ替え操作そのものは実マウス/実キー入力で打つ。
async function setupThreeBlocks(page) {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await enterEdit(page);
    await page.evaluate(() => {
        const app = window.bookshelf;
        app._artDraft.blocks = ['A', 'B', 'C'].map(t => ({ id: 'blk_' + t, type: 'text', markdown: `## 見出し${t}\n\n本文${t}` }));
        app._artRenderBlocks();
    });
    await expect(canvas(page).locator('.art-cv-grip')).toHaveCount(3);
}
const order = (page) => page.evaluate(() => window.bookshelf._artDraft.blocks.map(b => b.id.replace('blk_', '')).join(''));
// iframe 内要素の rect をページ座標へ (frame の位置を足す)
async function rectIn(page, sel, i = 0) {
    const f = await page.locator('#art-canvas-frame').boundingBox();
    const r = await page.evaluate(([s, k]) => { const el = document.getElementById('art-canvas-frame').contentDocument.querySelectorAll(s)[k]; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, [sel, i]);
    return { x: f.x + r.x, y: f.y + r.y, w: r.w, h: r.h };
}

test.describe('記事エディタ PC 1280幅: ブロックの並べ替え (イシュー#278)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('つまみはブロック左端に揃い、ドラッグ中はブロック間の中央に挿入線が出て、離すと順序が変わり Undo で戻る', async ({ page }) => {
        const errors = await bootApp(page);
        await setupThreeBlocks(page);
        // 整列: つまみは右上の⋯と左右対称 (上端が同じ・ブロック左端からの距離=ブロック右端から⋯までの距離。1px以内)
        for (let i = 0; i < 3; i++) {
            const g = await rectIn(page, '.art-cv-grip', i);
            const m = await rectIn(page, '.art-cv-more', i);
            const s = await rectIn(page, 'section.art-cv-blk', i);
            expect(Math.abs(g.y - m.y)).toBeLessThanOrEqual(1);
            expect(Math.abs((g.x - s.x) - ((s.x + s.w) - (m.x + m.w)))).toBeLessThanOrEqual(1);
            expect(Math.abs(g.h - m.h)).toBeLessThanOrEqual(1);
            expect(g.x).toBeGreaterThanOrEqual((await page.locator('#art-canvas-frame').boundingBox()).x); // キャンバスの外へはみ出さない
        }
        const g0 = await rectIn(page, '.art-cv-grip', 0);
        const s0 = await rectIn(page, 'section.art-cv-blk', 0);
        const endIns = await rectIn(page, '.art-cv-ins', 3); // 最後のブロックの後ろ
        await page.mouse.move(g0.x + g0.w / 2, g0.y + g0.h / 2);
        await page.mouse.down();
        await page.mouse.move(g0.x + g0.w / 2, endIns.y + endIns.h / 2, { steps: 8 });
        // 挿入線: 縦はブロック間 (「ここに追加」行) の中央・横はブロックと同じ左端と幅 (1px以内)
        // (下端近くでは外側が自動スクロールするため、比較する座標は線と同じ時点で測り直す)
        const line = await rectIn(page, '.art-cv-dropline');
        const endNow = await rectIn(page, '.art-cv-ins', 3);
        const s0Now = await rectIn(page, 'section.art-cv-blk', 0);
        expect(Math.abs((line.y + line.h / 2) - (endNow.y + endNow.h / 2))).toBeLessThanOrEqual(1);
        expect(Math.abs(line.x - s0Now.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(line.w - s0.w)).toBeLessThanOrEqual(1);
        await page.mouse.up();
        await expect.poll(() => order(page)).toBe('BCA');
        await expect(canvas(page).locator('.art-cv-dropline')).toHaveCount(0);
        const undoBtn = page.locator('.toast .toast-action');
        await expect(undoBtn).toHaveText('元に戻す');
        await undoBtn.click();
        await expect.poll(() => order(page)).toBe('ABC');
        expect(errors).toEqual([]);
    });

    test('つまみにフォーカスして Alt+↓/↑ で1つずつ動き、aria-live で読み上げ、フォーカスが追従する', async ({ page }) => {
        const errors = await bootApp(page);
        await setupThreeBlocks(page);
        await canvas(page).locator('.art-cv-grip[data-blk-idx="0"]').focus();
        await page.keyboard.press('Alt+ArrowDown');
        await expect.poll(() => order(page)).toBe('BAC');
        await expect(page.locator('#art-live')).toHaveAttribute('aria-live', 'polite');
        await expect(page.locator('#art-live')).toHaveText('文章ブロックを2番目に移動しました（全3ブロック）');
        // フォーカスは移動先 (2番目) のつまみへ追従 → もう一度 Alt+↓ で3番目へ
        await expect.poll(() => page.evaluate(() => document.getElementById('art-canvas-frame').contentDocument.activeElement?.dataset?.blkIdx)).toBe('1');
        await page.keyboard.press('Alt+ArrowDown');
        await expect.poll(() => order(page)).toBe('BCA');
        await expect(page.locator('#art-live')).toHaveText('文章ブロックを3番目に移動しました（全3ブロック）');
        await page.keyboard.press('Alt+ArrowUp');
        await expect.poll(() => order(page)).toBe('BAC');
        // Undo は直前の1回分 (BCA→BAC) を戻す
        await page.locator('.toast .toast-action').last().click();
        await expect.poll(() => order(page)).toBe('BCA');
        expect(errors).toEqual([]);
    });
});

test.describe('記事エディタ 390幅: つまみは出ない (イシュー#278 回帰)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('スマホは⋯→上へ/下へのまま (つまみ無し・上へ/下へで Undo トーストは出ない)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await enterEdit(page);
        await page.evaluate(() => {
            const app = window.bookshelf;
            app._artDraft.blocks = ['A', 'B'].map(t => ({ id: 'blk_' + t, type: 'text', markdown: `## 見出し${t}` }));
            app._artRenderBlocks();
        });
        await expect(canvas(page).locator('.art-cv-more')).toHaveCount(2);
        await expect(canvas(page).locator('.art-cv-grip')).toHaveCount(0);
        await canvas(page).locator('.art-cv-more[data-blk-idx="0"]').click();
        await page.locator('#art-blk-menu [data-blk-act="down"]').click();
        await expect.poll(() => order(page)).toBe('BA');
        await expect(page.locator('.toast .toast-action')).toHaveCount(0);
        expect(errors).toEqual([]);
    });
});

// イシュー#278 ②指摘 (push前): つまみは枠の上辺の線の上 (⋯と同じ縦位置) で本文の文字と交差しない／右ペインのツールバーは7ボタン1段
test.describe('記事エディタ PC 1280幅: ②指摘の2点 (イシュー#278)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('つまみと⋯は同じ縦位置でブロック枠の上辺に乗り、ブロック内の最初のテキスト要素と交差しない', async ({ page }) => {
        const errors = await bootApp(page);
        await setupThreeBlocks(page);
        for (let i = 0; i < 3; i++) {
            const r = await page.evaluate((k) => {
                const d = document.getElementById('art-canvas-frame').contentDocument;
                const sec = d.querySelectorAll('section.art-cv-blk')[k];
                const g = sec.querySelector('.art-cv-grip').getBoundingClientRect();
                const m = sec.querySelector('.art-cv-more').getBoundingClientRect();
                const s = sec.getBoundingClientRect();
                const t = sec.querySelector('h1,h2,h3,h4,p,li').getBoundingClientRect();
                const hit = !(g.right <= t.left || t.right <= g.left || g.bottom <= t.top || t.bottom <= g.top);
                return { gTop: g.top, mTop: m.top, gBottom: g.bottom, secTop: s.top, hit };
            }, i);
            expect(Math.abs(r.gTop - r.mTop)).toBeLessThanOrEqual(1);
            expect(r.hit).toBe(false);
            expect(Math.abs(r.gBottom - (r.secTop - 4))).toBeLessThanOrEqual(1); // 下端=枠線 (outline-offset 4px)
        }
        expect(errors).toEqual([]);
    });

    test('右ペインの EasyMDE ツールバーは8ボタン(よく使う7個+その他)で1段 (全ボタンの top が同じ・イシュー#282)', async ({ page }) => {
        const errors = await bootApp(page);
        await newArticleWithText(page);
        await openTextBlock(page);
        const tops = await page.evaluate(() => [...document.querySelectorAll('#art-blocks .editor-toolbar button')].map(b => Math.round(b.getBoundingClientRect().top)));
        expect(tops.length).toBe(8);
        expect(new Set(tops).size).toBe(1);
        expect(errors).toEqual([]);
    });
});
