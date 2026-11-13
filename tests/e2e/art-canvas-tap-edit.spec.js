// イシュー#580: 記事エディタのキャンバス (編集状態) で、本の入った本棚ブロック・本が決まった本ブロックを
// タップ/クリックすると、そのブロックの編集が開き、引き出しから本を足せること。
// 以前は本文タップで開くのが文章ブロックだけ (article-editor.js のキャンバス click 委譲) で、空の案内が消えた途端に
// 本を足す入口が「⋯→編集」だけになっていた (ハヘロ報告「本や本棚追加操作できないことがある」)。
// 操作は locator.tap()/click() とマウスのみ。結果はキャンバスの DOM (ブロックの中の書名) で確かめる。
// 委譲の優先順位: ⋯ピル・つまみのドラッグはそれぞれの操作になり、ブロックの編集は開かない。
import { test, expect } from './helpers/test-base.js';
import { addBlock, canvas, canvasBlockBlankPosition, waitForCanvasBlockEditReady, waitForArtTextFsEditor, setArtTextFsEditorValue } from './helpers/art-editor.js';
import { mockSyncReady } from './helpers/sync.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page) {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        adapter.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        adapter.readText = async (p) => (mem.has(p) ? mem.get(p) : null);
        adapter.writeText = async (p, t) => { mem.set(p, t); };
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
    });
    await mockSyncReady(page, true);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.waitForSelector('#publish-pages-modal.show', { timeout: 5000 });
    return errors;
}

const editView = (page) => page.locator('#art-edit-view');
const section = (page, i) => canvas(page).locator('section.art-cv-blk').nth(i);

async function press(page, loc, touch, opts = {}) { if (touch) await loc.tap(opts); else await loc.click(opts); }
// ブロックの余白 (左端・縦の中央) を押す。書影・書名リンク等の「クリックできる要素」を避ける = iOS WebKit で
// document の委譲だけだと click が合成されない場所 (イシュー#580 step6)。位置と「押す点に a/img/button が無いこと」は、
// キャンバスの描き直しが落ち着いてから共通ヘルパーで確かめる (描き直しの最中に読むと boundingBox が null になる・イシュー#610)
async function pressBlank(page, sec, touch, side = 'left') {
    const position = await canvasBlockBlankPosition(sec, { side });
    await press(page, sec, touch, { position });
}

async function newArticle(page, touch) {
    await press(page, page.locator('#art-new'), touch);
    await page.fill('#art-title', 'チェック580');
    await press(page, page.locator('#art-mode-edit'), touch);
    await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
}

// 全画面フォームで引き出しを開き (狭幅のみ。PCは常駐)、書名の本を1冊押して「完了」
async function pickAndDone(page, touch, title, opener) {
    const drawerItem = page.locator('#art-drawer-list .art-drawer-item', { hasText: title }).first();
    // 本ブロックは「選ぶ/選び直す」を押した時だけ差し替え対象になる (#166)。本棚は狭幅で引き出しが閉じていれば開く (PCは常駐)
    const narrow = await page.evaluate(() => window.matchMedia('(max-width: 900px)').matches);
    const drawerOpen = await page.locator('#art-drawer.is-open').count();
    if (opener === '.art-book-pick' || (narrow && !drawerOpen)) await press(page, page.locator(`#art-edit-view ${opener}:visible`).first(), touch);
    if (narrow) await expect(page.locator('#art-drawer')).toHaveClass(/is-open/);
    await expect(drawerItem).toBeInViewport();
    await press(page, drawerItem, touch);
    await press(page, page.locator('#art-fs-done'), touch);
    await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
}

for (const v of [{ name: 'タッチ390', viewport: { width: 390, height: 844 }, touch: true }, { name: 'PC1440', viewport: { width: 1440, height: 900 }, touch: false }]) {
    test.describe(`イシュー#580 キャンバスで中身のあるブロックを押すと編集が開き本を足せる (${v.name})`, () => {
        test.use({ viewport: v.viewport, hasTouch: v.touch });
        // webkit project (BACKNAV_WEBKIT=1・iPhone 13) ではタッチ390だけを流す (PC幅はchromiumで見る)
        test.skip(({ browserName }) => browserName === 'webkit' && !v.touch, 'webkitはタッチ390のみ');

        test('本の入った本棚ブロックを押す→引き出しから本を足す→そのブロックに入る', async ({ page }) => {
            const errors = await bootApp(page);
            await newArticle(page, v.touch);
            await addBlock(page, 'shelf', 'last');
            await pickAndDone(page, v.touch, 'フィクスチャの本 1', '.art-shelf-add');
            await expect(section(page, 0)).toContainText('フィクスチャの本 1');
            await expect(canvas(page).locator('.art-cv-empty-guide')).toHaveCount(0); // 空の案内は無い=本文を押すしかない状態

            await pressBlank(page, section(page, 0), v.touch, 'right'); // 書影を避けた余白 (1冊の本棚は右側が空き)
            await expect(editView(page)).toHaveAttribute('data-art-mode', 'form');
            await pickAndDone(page, v.touch, 'フィクスチャの本 2', '.art-shelf-add');
            await expect(section(page, 0)).toContainText('フィクスチャの本 1');
            await expect(section(page, 0)).toContainText('フィクスチャの本 2');
            expect(errors).toEqual([]);
        });

        test('本が決まった本ブロックを押す→選び直す→そのブロックの本が替わる', async ({ page }) => {
            const errors = await bootApp(page);
            await newArticle(page, v.touch);
            await addBlock(page, 'book', 'last');
            await pickAndDone(page, v.touch, 'フィクスチャの本 1', '.art-book-pick');
            await expect(section(page, 0)).toContainText('フィクスチャの本 1');

            await pressBlank(page, section(page, 0), v.touch);
            await expect(editView(page)).toHaveAttribute('data-art-mode', 'form');
            await pickAndDone(page, v.touch, 'フィクスチャの本 3', '.art-book-pick');
            await expect(section(page, 0)).toContainText('フィクスチャの本 3');
            await expect(section(page, 0)).not.toContainText('フィクスチャの本 1');
            expect(errors).toEqual([]);
        });

        test('本文の入った文章ブロックの本文を押す→全画面の文章編集が開く', async ({ page }) => {
            const errors = await bootApp(page);
            await newArticle(page, v.touch);
            await addBlock(page, 'text', 'last');
            await waitForArtTextFsEditor(page);
            await setArtTextFsEditorValue(page, '本文580'); // 前提づくり (本文の入力自体は検証対象外)
            await press(page, page.locator('#art-fs-done'), v.touch);
            await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
            await expect(section(page, 0)).toContainText('本文580');
            await waitForCanvasBlockEditReady(section(page, 0)); // 「完了」後の描き直しが済んでから押す (イシュー#610)
            await press(page, section(page, 0).locator('p').first(), v.touch);
            await expect(editView(page)).toHaveAttribute('data-art-mode', 'form');
            await expect(page.locator('#art-edit-view .CodeMirror').first()).toBeVisible();
            expect(errors).toEqual([]);
        });

        test('⋯ピルを押すとブロックメニューが開き、編集は開かない (委譲の優先順位)', async ({ page }) => {
            await bootApp(page);
            await newArticle(page, v.touch);
            await addBlock(page, 'shelf', 'last');
            await pickAndDone(page, v.touch, 'フィクスチャの本 1', '.art-shelf-add');
            await press(page, canvas(page).locator('.art-cv-more[data-blk-idx="0"]'), v.touch);
            await expect(page.locator('#art-blk-menu')).toBeVisible();
            await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
        });
    });
}

test.describe('イシュー#580 つまみのドラッグの後に編集が開かない (PC1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test.skip(({ browserName }) => browserName === 'webkit', 'マウスのドラッグはchromiumで見る');

    async function rectIn(page, sel, i = 0) {
        const f = await page.locator('#art-canvas-frame').boundingBox();
        const r = await page.evaluate(([s, k]) => { const el = document.getElementById('art-canvas-frame').contentDocument.querySelectorAll(s)[k]; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, [sel, i]);
        return { x: f.x + r.x, y: f.y + r.y, w: r.w, h: r.h };
    }

    test('ブロックの中でつまみを動かして離しても (click が section に届いても) 編集は開かない', async ({ page }) => {
        await bootApp(page);
        await newArticle(page, false);
        await addBlock(page, 'shelf', 'last');
        await pickAndDone(page, false, 'フィクスチャの本 1', '.art-shelf-add');
        await addBlock(page, 'shelf', 'last'); // つまみはブロックが2つ以上の時に出る
        await pickAndDone(page, false, 'フィクスチャの本 2', '.art-shelf-add');
        await expect(canvas(page).locator('.art-cv-grip')).toHaveCount(2);
        const g = await rectIn(page, '.art-cv-grip', 0);
        const s = await rectIn(page, 'section.art-cv-blk', 0);
        // つまみ→同じブロックの中ほどで離す: pointerdown と pointerup の共通祖先 = section に click が届く
        await page.mouse.move(g.x + g.w / 2, g.y + g.h / 2);
        await page.mouse.down();
        await page.mouse.move(s.x + s.w / 2, s.y + s.h / 2, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
        // ドラッグから時間が経った後の普通のクリックでは開く (ガードが効きっぱなしでない)
        await page.waitForTimeout(500);
        await section(page, 0).click();
        await expect(editView(page)).toHaveAttribute('data-art-mode', 'form');
    });
});
