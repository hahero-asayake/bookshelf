// イシュー#770 (#759 の1〜3・切り替え① artSix)。触れるモック (_vault-work/759/harness) で確かめた形をアプリで見る。
//   1：PC (900px超) でも本の引き出しは右の列でなく、開いた時だけ画面の真ん中のシート (幕・×・戻るで閉じる) で出る
//   2：編集状態 (data-art-mode=edit) には引き出しを出さない (本・本棚のブロックの編集の時だけ)
//   3：「＋ ここに追加」をホバーしなくても常に見せる
//   localStorage 'bookshelf.flag.artSix' = '0' で前の形 (右の列・ホバーで出す) に戻る。
// モックで通していなかった3つ (759 report.md「通していない物」：PC で本を選んだ後にシートが閉じる・本棚ブロックを足すとシートが開く・
// ブラウザの戻るで閉じる) もここで見る。
// 390幅の chromium はこのファイルの describe、webkit (iPhone 相当) は playwright.config の webkit / gate-webkit が流す。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { setArtBlocks, getArtBlocks, editArtBlockForSetup, waitForArtTextFsEditor, setArtTextFsEditorValue } from './helpers/art-editor.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// ハブの模擬で起動し (local では「新しい記事」が押せない)、記事エディタを編集状態で開く。flag は artSix の値 (null＝既定)。
async function openEditor(page, { flag = null } = {}) {
    if (flag != null) await page.addInitScript((v) => { try { localStorage.setItem('bookshelf.flag.artSix', v); } catch (_) { /* no-op */ } }, flag);
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await expect(page.locator('#art-edit-view')).toBeVisible();
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible()) await edit.click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
    await setArtBlocks(page, [{ id: 'blk_A', type: 'text', markdown: '## 見出し\n\n本文' }]);
    await expect(page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').first()).toBeAttached();
}

// 「＋ ここに追加」から型を選んで足す (足した直後は本・本棚の全画面＝form)
async function insertBlock(page, type) {
    const frame = page.frameLocator('#art-canvas-frame');
    await expect(async () => {
        await frame.locator('.art-cv-ins-btn').last().click();
        await expect(page.locator(`#art-add-sheet [data-block-type="${type}"]`)).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await page.locator(`#art-add-sheet [data-block-type="${type}"]`).click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
}

// 引き出しの開く transition が止まるのを待つ (止まると位置が動かなくなる)
const waitSheetStill = (page) => expect.poll(() => page.evaluate(() => new Promise((r) => {
    const s = document.getElementById('art-drawer'); const a = s.getBoundingClientRect();
    setTimeout(() => { const b = s.getBoundingClientRect(); r(Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5); }, 150);
}))).toBe(true);

// 「＋ ここに追加」の不透明度 (ホバーしていない時)
const insOpacity = (page) => page.evaluate(() => {
    const d = document.getElementById('art-canvas-frame').contentDocument;
    const b = d.querySelector('.art-cv-ins-btn');
    return b ? Number(getComputedStyle(b).opacity) : null;
});

test.describe('PC 1280: #759 の1〜3 (既定＝on)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('2・3: 編集状態では引き出しが出ず記事の列が真ん中・「＋ ここに追加」はホバー無しで見える', async ({ page }) => {
        await openEditor(page);
        await expect(page.locator('#art-edit-view')).toHaveClass(/is-six/);
        await expect(page.locator('#art-drawer')).toBeHidden();
        const g = await page.evaluate(() => {
            const wrap = document.querySelector('#art-edit-view .art-wrap').getBoundingClientRect();
            const col = document.querySelector('#art-edit-view .art-col').getBoundingClientRect();
            return { left: col.left - wrap.left, right: wrap.right - col.right };
        });
        expect(Math.abs(g.left - g.right), JSON.stringify(g)).toBeLessThanOrEqual(2);
        await page.mouse.move(2, 2); // キャンバスの外 (ホバーしていない)
        await expect.poll(() => insOpacity(page)).toBe(1);
    });

    test('1: 本棚ブロックを足すと真ん中のシートが開き、ブラウザの戻るで閉じる (×・幕あり・畳むボタンなし)', async ({ page }) => {
        await openEditor(page);
        await insertBlock(page, 'shelf');
        const side = page.locator('#art-drawer');
        await expect(side).toHaveClass(/is-open/);
        await expect(side).toBeVisible();
        await waitSheetStill(page);
        const m = await page.evaluate(() => {
            const r = document.getElementById('art-drawer').getBoundingClientRect();
            const sc = getComputedStyle(document.getElementById('art-sheet-scrim'));
            return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, W: innerWidth, H: innerHeight,
                transform: getComputedStyle(document.getElementById('art-drawer')).transform, scrimOpacity: Number(sc.opacity), scrimDisplay: sc.display };
        });
        expect.soft(Math.abs(m.cx - m.W / 2), JSON.stringify(m)).toBeLessThanOrEqual(2);
        expect.soft(Math.abs(m.cy - m.H / 2), JSON.stringify(m)).toBeLessThanOrEqual(2);
        expect.soft(Math.round(m.w)).toBe(Math.min(760, m.W - 64));
        expect.soft(Math.round(m.h)).toBe(Math.round(Math.min(m.H * 0.8, 820)));
        expect.soft(m.transform, 'transform は使わない (#756)').toBe('none');
        expect.soft(m.scrimDisplay).toBe('block');
        await expect.poll(() => page.evaluate(() => Number(getComputedStyle(document.getElementById('art-sheet-scrim')).opacity))).toBe(1);
        await expect(page.locator('#art-sheet-close')).toBeVisible();
        await expect(page.locator('#art-drawer-collapse-btn')).toBeHidden();
        await page.goBack();
        await expect(side).not.toHaveClass(/is-open/);
        await expect(side).toBeHidden();
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form'); // 戻る1回はシートだけ畳む
    });

    test('1: 本ブロックを足す → 真ん中のシートで本を選ぶと、シートが自分で閉じる', async ({ page }) => {
        await openEditor(page);
        await insertBlock(page, 'book');
        // ② artBookBlock (#767-c) が on の既定では、足すとシートが自分で開く (「本を選ぶ」を押さない)
        const side = page.locator('#art-drawer');
        await expect(side).toHaveClass(/is-open/);
        await waitSheetStill(page);
        const item = page.locator('#art-drawer .art-drawer-item').first();
        const asin = await item.getAttribute('data-asin');
        await item.click();
        await expect(side).not.toHaveClass(/is-open/);
        await expect(side).toBeHidden();
        await expect.poll(async () => (await getArtBlocks(page)).find((b) => b.type === 'book')?.asin).toBe(asin);
    });

    test('1: 幕を押すとシートが閉じる', async ({ page }) => {
        await openEditor(page);
        await insertBlock(page, 'shelf');
        await expect(page.locator('#art-drawer')).toHaveClass(/is-open/);
        await waitSheetStill(page);
        await page.mouse.click(10, 400); // シートの外 (幕)
        await expect(page.locator('#art-drawer')).not.toHaveClass(/is-open/);
    });
});

test.describe('PC 1280: artSix=0 で前の形', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('編集状態で右の列に引き出しが出て、「＋ ここに追加」はホバーまで隠れる', async ({ page }) => {
        await openEditor(page, { flag: '0' });
        await expect(page.locator('#art-edit-view')).not.toHaveClass(/is-six/);
        // 前の形は畳んだ記憶が無ければ右の列 (編集状態でも見える)
        await expect(page.locator('#art-drawer')).toBeVisible();
        const m = await page.evaluate(() => {
            const r = document.getElementById('art-drawer').getBoundingClientRect();
            const col = document.querySelector('#art-edit-view .art-col').getBoundingClientRect();
            return { sideLeft: r.left, colRight: col.right, pos: getComputedStyle(document.getElementById('art-drawer')).position };
        });
        expect(m.sideLeft, JSON.stringify(m)).toBeGreaterThanOrEqual(m.colRight);
        expect(m.pos).not.toBe('fixed');
        await page.mouse.move(2, 2);
        // 前の形はホバーできる端末 (hover:hover・pointer:fine) だけ隠す。webkit の列 (iPhone 13・タッチ) では前から常に見える
        const fine = await page.evaluate(() => matchMedia('(hover:hover) and (pointer:fine)').matches);
        await expect.poll(() => insOpacity(page)).toBe(fine ? 0 : 1);
    });
});

test.describe('スマホ390: #759 の1〜3 (既定＝on)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA });

    test('編集状態ではシートが閉じていて、本棚ブロックを足すと下からのシートが開き、戻るで閉じる', async ({ page }) => {
        await openEditor(page);
        await expect(page.locator('#art-drawer')).not.toHaveClass(/is-open/);
        expect(await insOpacity(page)).toBe(1);
        await insertBlock(page, 'shelf');
        const side = page.locator('#art-drawer');
        await expect(side).toHaveClass(/is-open/);
        await waitSheetStill(page);
        const m = await page.evaluate(() => {
            const r = document.getElementById('art-drawer').getBoundingClientRect();
            return { bottom: r.bottom, H: innerHeight, w: r.width, W: innerWidth };
        });
        expect.soft(Math.abs(m.bottom - m.H), JSON.stringify(m)).toBeLessThanOrEqual(2); // 下から (スマホの形は変えない)
        expect.soft(Math.round(m.w)).toBe(m.W);
        await page.goBack();
        await expect(side).not.toHaveClass(/is-open/);
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
    });
});

// ---- #759 の4〜6 (step2)

// 本棚ブロックを足し、引き出しから n 冊入れて、シートを閉じる (本棚の全画面に一覧が出る)
async function shelfBlockWithBooks(page, n = 2) {
    await insertBlock(page, 'shelf');
    await expect(page.locator('#art-drawer')).toHaveClass(/is-open/);
    await waitSheetStill(page);
    for (let k = 0; k < n; k++) {
        await page.locator('#art-drawer .art-drawer-item').nth(k).click();
        await expect(page.locator('#art-blocks .art-fs-row')).toHaveCount(k + 1);
    }
    await page.locator('#art-sheet-close').click();
    await expect(page.locator('#art-drawer')).not.toHaveClass(/is-open/);
}
const shelfShows = (page, key) => getArtBlocks(page).then((bs) => (bs.find((b) => b.type === 'shelf')?.items || []).map((it) => !!(it.show && it.show[key])));

// 空の文章ブロックを1つだけ置いた記事 (編集状態)
async function emptyTextArticle(page, flag) {
    await openEditor(page, { flag });
    await setArtBlocks(page, [{ id: 'blk_T', type: 'text', markdown: '' }]);
    await expect(page.frameLocator('#art-canvas-frame').locator('.art-cv-empty-guide')).toBeVisible();
}

// 文章ブロックの全画面 (PC は右の欄) を開き、md エディタのツールバーが出るまで待つ
async function openTextFs(page) {
    await editArtBlockForSetup(page, 'blk_T');
    await waitForArtTextFsEditor(page);
    await expect(page.locator('#art-blocks .editor-toolbar.mde-iconized')).toBeVisible();
}
// 文章の全画面の md エディタ (CodeMirror の DOM が持つ本体) の中身・選ばれている字 (内部参照を増やさない)
const fsCm = (page, fn) => page.evaluate((f) => { const cm = document.querySelector('#art-blocks .CodeMirror').CodeMirror; return f === 'sel' ? cm.getSelection() : cm.getValue(); }, fn);
const fsValue = (page) => fsCm(page, 'val');

for (const dev of [
    { name: 'PC 1280', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'スマホ390', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA } },
]) {
    test.describe(`${dev.name}: #759 の4〜6 (既定＝on)`, () => {
        test.use(dev.use);

        test('4: 本棚の全画面の一覧の上に「全部の本で」の段があり、押すと全部の本の短文メモがそろう (一部なら混在)', async ({ page }) => {
            await openEditor(page);
            await shelfBlockWithBooks(page, 2);
            const row = page.locator('#art-blocks .art-fs-bulk');
            await expect(row).toBeVisible();
            await expect(row).toContainText('全部の本で：');
            // 段は一覧より上
            const order = await page.evaluate(() => {
                const r = document.querySelector('#art-blocks .art-fs-bulk').getBoundingClientRect();
                const l = document.querySelector('#art-blocks .art-fs-list').getBoundingClientRect();
                return r.bottom <= l.top + 1;
            });
            expect(order).toBe(true);
            const memoChip = () => page.locator('#art-blocks .art-bulk-chip[data-show-key="shortMemo"]');
            await expect(memoChip()).toHaveAttribute('aria-pressed', 'false');
            await memoChip().click();
            await expect.poll(() => shelfShows(page, 'shortMemo')).toEqual([true, true]);
            await expect(memoChip()).toHaveAttribute('aria-pressed', 'true');
            // 1冊だけ外すと混在
            await page.locator('#art-blocks .art-fs-row').first().locator('.art-item-show-toggle[data-show-key="shortMemo"]').click();
            await expect(memoChip()).toHaveAttribute('aria-pressed', 'mixed');
            // 混在で押すと全部 on・全部 on で押すと全部 off
            await memoChip().click();
            await expect.poll(() => shelfShows(page, 'shortMemo')).toEqual([true, true]);
            await memoChip().click();
            await expect.poll(() => shelfShows(page, 'shortMemo')).toEqual([false, false]);
            await page.locator('#art-blocks .art-bulk-chip[data-show-key="rating"]').click();
            await expect.poll(() => shelfShows(page, 'rating')).toEqual([true, true]);
        });

        test('5: 空の文章ブロックは地と角丸だけ (灰色の点線なし) で、案内は「ここに文章（タップして書く）」', async ({ page }) => {
            await emptyTextArticle(page);
            const f = page.frameLocator('#art-canvas-frame');
            await expect(f.locator('.art-cv-empty-guide')).toHaveText('ここに文章（タップして書く）');
            const st = await page.evaluate(() => {
                const d = document.getElementById('art-canvas-frame').contentDocument;
                const sec = d.querySelector('.art-cv-empty');
                const cs = getComputedStyle(sec);
                return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, border: cs.borderTopStyle, outline: cs.outlineStyle };
            });
            expect.soft(st.bg).toBe('rgba(61, 82, 255, 0.035)');
            expect.soft(st.radius).toBe('8px');
            expect.soft(st.border, '灰色の点線は付けない (案B)').toBe('none');
            expect.soft(st.outline, '線は .art-cv-blk の青い点線の1本').toBe('dashed');
        });

        test('6: 表のボタンで行と列を選んで入れる・欄を開いたまま見出しを押すと欄は1つ・Esc で欄だけ閉じる', async ({ page }) => {
            await emptyTextArticle(page);
            await openTextFs(page);
            const tb = page.locator('#art-blocks .editor-toolbar');
            await tb.locator('button.mde-table-btn').click();
            const menu = page.locator('.mde-table-menu');
            await expect(menu).toBeVisible();
            await expect(menu.locator('[data-v="r"]')).toHaveText('3');
            await expect(menu.locator('[data-v="c"]')).toHaveText('2');
            // 欄を開いたまま見出しを押す → 見出しのメニューだけ
            await tb.locator('button[title="見出し"]').click();
            await expect(page.locator('.mde-table-menu')).toHaveCount(0);
            await expect(page.locator('.mde-heading-menu')).toHaveCount(1);
            await page.keyboard.press('Escape');
            await expect(page.locator('.mde-heading-menu')).toHaveCount(0);
            // 表の欄を開いて Esc → 欄だけ閉じ、全画面は残る
            await tb.locator('button.mde-table-btn').click();
            await expect(menu).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.locator('.mde-table-menu')).toHaveCount(0);
            await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
            // 行を1つ・列を1つ増やして入れる (4行×3列・見出しの行を含む)
            await tb.locator('button.mde-table-btn').click();
            await menu.locator('[aria-label="行を増やす"]').click();
            await menu.locator('[aria-label="列を増やす"]').click();
            await expect(menu.locator('[data-v="r"]')).toHaveText('4');
            await menu.locator('.mde-tm-insert').click();
            await expect(page.locator('.mde-table-menu')).toHaveCount(0);
            await expect.poll(() => fsValue(page)).toBe('| 見出し1 | 見出し2 | 見出し3 |\n| --- | --- | --- |\n|   |   |   |\n|   |   |   |\n|   |   |   |\n');
            const sel = await fsCm(page, 'sel');
            expect(sel).toBe('見出し1');
        });
    });
}

test.describe('PC 1280: #759-5 文章の全画面で空の時の仮の section', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('左のキャンバスに「ここに文章が入ります」(地＋青い outline・灰色の点線なし) が出て、字を入れると消える', async ({ page }) => {
        await emptyTextArticle(page);
        await openTextFs(page);
        const f = page.frameLocator('#art-canvas-frame');
        const ph = f.locator('.art-cv-text-ph');
        await expect(ph).toHaveText('ここに文章が入ります');
        const st = await page.evaluate(() => {
            const d = document.getElementById('art-canvas-frame').contentDocument;
            const cs = getComputedStyle(d.querySelector('.art-cv-text-ph'));
            return { bg: cs.backgroundColor, outline: `${cs.outlineStyle} ${cs.outlineWidth}`, border: cs.borderTopStyle };
        });
        expect.soft(st.bg).toBe('rgba(61, 82, 255, 0.035)');
        expect.soft(st.outline).toBe('solid 2px');
        expect.soft(st.border).toBe('none');
        await setArtTextFsEditorValue(page, '本文です');
        await expect(ph).toHaveCount(0);
    });
});

test.describe('PC 1280: artSix=0 で 5・6 も前の形', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('案内は前の字・仮の section なし・表のボタンは押すとすぐ表が入る', async ({ page }) => {
        await emptyTextArticle(page, '0');
        const f = page.frameLocator('#art-canvas-frame');
        await expect(f.locator('.art-cv-empty-guide')).toHaveText('タップして文章を書く');
        await openTextFs(page);
        await expect(f.locator('.art-cv-text-ph')).toHaveCount(0);
        const tb = page.locator('#art-blocks .editor-toolbar');
        await expect(tb.locator('button.mde-table-btn')).toHaveCount(0);
        await tb.locator('button[title="表"]').click();
        await expect(page.locator('.mde-table-menu')).toHaveCount(0);
        await expect.poll(() => fsValue(page)).toContain('| Column 1 | Column 2 | Column 3 |'); // EasyMDE の既定の表
    });
});

test.describe('スマホ390: artSix=0 で 4 も前の形', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA });

    test('本棚の全画面に「全部の本で」の段が出ない', async ({ page }) => {
        await openEditor(page, { flag: '0' });
        await shelfBlockWithBooks(page, 2);
        await expect(page.locator('#art-blocks .art-fs-row')).toHaveCount(2);
        await expect(page.locator('#art-blocks .art-fs-bulk')).toHaveCount(0);
    });
});
