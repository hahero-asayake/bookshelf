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
