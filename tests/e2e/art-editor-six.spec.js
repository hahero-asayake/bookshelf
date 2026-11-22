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
import { setArtBlocks, getArtBlocks } from './helpers/art-editor.js';
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

    test('1: 本ブロックで「本を選ぶ」→ 真ん中のシートで本を選ぶと、シートが自分で閉じる', async ({ page }) => {
        await openEditor(page);
        await insertBlock(page, 'book');
        await page.locator('#art-blocks .art-book-pick').first().click();
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
