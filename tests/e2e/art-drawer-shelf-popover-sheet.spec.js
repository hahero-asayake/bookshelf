// イシュー#756: スマホ幅 (900px 以下) の記事エディタで、引き出しのシート (.art-side) の中の「本棚の選択」
// (#art-drawer-shelf-popover・position:fixed・_placeAnchoredMenu で置く) が画面の中に出きり、全項目を押せる。
// 開いたシートの transform が translateY(0) だと none ではないので、中の fixed の基準がシートになり、
// 吹き出しがシートの top の分だけ下へずれて画面の外に出ていた (390×844 で top 922)。直しは開いた状態を transform: none にし、
// シートの開く transition の途中で押された時は transitionend で置き直す (ui-standards §2-12)。
// 判定は click({ trial: true }) に頼らない: Playwright は押す前に scrollIntoView をし、overflow:hidden のシートの中身ごと
// 送るので、画面の外にある項目でも chromium では ok になる (scripts/verify/756-results.md §1)。
// 代わりに、押す前の吹き出しの rect・吹き出しの中だけを送った時の項目の中心の elementFromPoint・シートの scrollTop を見る。
// 390幅の chromium はこのファイルの test.use、webkit (iPhone 相当) は playwright.config の webkit / gate-webkit が流す。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { setArtBlocks, openArtSheetInternal, closeArtSheetInternal } from './helpers/art-editor.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SHELF_NAMES = ['小説', 'SF', 'ミステリ', '漫画', 'ビジネス', '技術書', '歴史', '料理', '旅行', '写真'];

// ハブの模擬で起動し (local では「新しい記事」が押せない)、本棚を10個足して、記事エディタで本棚ブロックを足す。
// スマホ幅では本棚ブロックを足すと引き出しのシートが開く。
async function openEditorWithShelfBlock(page, { mobile }) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await page.evaluate((names) => {
        const ud = window.bookshelf.userData;
        const all = ud.bookshelves.find((b) => b.isSpecial);
        names.forEach((name, i) => ud.bookshelves.push({
            id: 'e756s' + i, internalId: 'e756i' + i, name, parent: i === 1 ? 'e756i0' : all.internalId,
            books: (all.books || []).slice(0, 3), notes: {}, isSpecial: false,
        }));
    }, SHELF_NAMES);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await expect(page.locator('#art-edit-view')).toBeVisible();
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible()) await edit.click();
    await setArtBlocks(page, [{ id: 'blk_A', type: 'text', markdown: '## 見出し\n\n本文' }]);
    const frame = page.frameLocator('#art-canvas-frame');
    await expect(async () => {
        await frame.locator('.art-cv-ins-btn').last().click();
        await expect(page.locator('#art-add-sheet [data-block-type="shelf"]')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await page.locator('#art-add-sheet [data-block-type="shelf"]').click();
    if (mobile) await expect(page.locator('#art-drawer')).toHaveClass(/is-open/);
    else await openArtSheetInternal(page); // PC は畳んだ記憶があれば開く
    await expect(page.locator('#art-drawer-shelf-btn')).toBeVisible();
    // シートの開く transition (0.25s) が止まるのを待つ: 止まると位置が動かなくなる
    await expect.poll(() => page.evaluate(() => new Promise((r) => {
        const s = document.getElementById('art-drawer'); const t0 = s.getBoundingClientRect().top;
        setTimeout(() => r(Math.abs(s.getBoundingClientRect().top - t0) < 0.5), 150);
    }))).toBe(true);
}

// 吹き出しの rect と、全項目の中心に当たる物。吹き出しの中だけを scrollTop で送る (祖先は送らない)。
const probePopover = (page) => page.evaluate(() => {
    const pop = document.getElementById('art-drawer-shelf-popover');
    const btn = document.getElementById('art-drawer-shelf-btn');
    const side = document.getElementById('art-drawer');
    const pr = pop.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const items = [...pop.querySelectorAll('.art-drawer-shelf-item')];
    const hits = items.map((it) => {
        const p = pop.getBoundingClientRect(); const r0 = it.getBoundingClientRect();
        if (r0.bottom > p.bottom) pop.scrollTop += r0.bottom - p.bottom;
        else if (r0.top < p.top) pop.scrollTop -= p.top - r0.top;
        const r = it.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const onScreen = x >= 0 && x < innerWidth && y >= 0 && y < innerHeight;
        const el = onScreen ? document.elementFromPoint(x, y) : null;
        return onScreen && !!el && it.contains(el);
    });
    pop.scrollTop = 0;
    return {
        top: pr.top, bottom: pr.bottom, left: pr.left, right: pr.right, H: innerHeight, W: innerWidth,
        btnTop: br.top, btnBottom: br.bottom, n: items.length, hits, sheetScrollTop: side.scrollTop,
        sheetTransform: getComputedStyle(side).transform,
    };
});

// 吹き出しがボタンに付いている (下に開く＝上端がボタンの下端、上に開く＝下端がボタンの上端)
const attached = (m) => (m.top >= m.btnBottom - 2 && m.top <= m.btnBottom + 10) || (m.bottom <= m.btnTop + 2 && m.bottom >= m.btnTop - 10);

test.describe('スマホ390: 引き出しのシートの中の本棚の選択', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA });

    test('開いたシートの中で、吹き出しが画面の中に出きり、全項目の中心がその項目に当たる', async ({ page }) => {
        await openEditorWithShelfBlock(page, { mobile: true });
        await page.locator('#art-drawer-shelf-btn').click();
        await expect(page.locator('#art-drawer-shelf-popover')).toBeVisible();
        const m = await probePopover(page);
        // soft: 直す前の版で、どの判定が赤を出すかを全部見えるようにする (trial click は赤を出さなかった)
        expect.soft(m.sheetTransform, '開いたシートの transform は none (translateY(0) だと中の fixed の基準がシートになる)').toBe('none');
        expect.soft(m.top, JSON.stringify(m)).toBeGreaterThanOrEqual(0);
        expect.soft(m.bottom, JSON.stringify(m)).toBeLessThanOrEqual(m.H);
        expect.soft(attached(m), JSON.stringify(m)).toBe(true);
        expect.soft(m.n).toBe(SHELF_NAMES.length + 1);
        expect.soft(m.hits, '項目の中心の elementFromPoint').toEqual(Array(m.n).fill(true));
        expect.soft(m.sheetScrollTop, 'シートの中身は送られていない').toBe(0);
        // 補助: 押せること (受け取りの検査だけ・押した後の処理は走らせない)。trial は祖先を送りうるので、判定は上の3つ
        await page.locator('#art-drawer-shelf-popover .art-drawer-shelf-item').last().click({ trial: true });
        // 実際に押すと本棚が変わり、吹き出しが閉じる
        await page.locator('#art-drawer-shelf-popover [data-shelf-internal="e756i3"]').click();
        await expect(page.locator('#art-drawer-shelf-popover')).toBeHidden();
        await expect(page.locator('#art-drawer-shelf-label')).toContainText('漫画');
    });

    test('シートの開く途中で押しても、止まった後は吹き出しがボタンに付き画面の中に出る', async ({ page }) => {
        await openEditorWithShelfBlock(page, { mobile: true });
        await closeArtSheetInternal(page);
        await expect(page.locator('#art-drawer')).not.toHaveClass(/is-open/);
        await page.waitForTimeout(400); // 閉じる transition (0.25s) を終わらせる
        // 開いた直後 (滑っている途中・transition 0.25s) に押す
        await openArtSheetInternal(page);
        const atClick = await page.evaluate(() => {
            const t = getComputedStyle(document.getElementById('art-drawer')).transform;
            document.getElementById('art-drawer-shelf-btn').click();
            return t;
        });
        expect(atClick, '押した時はまだ滑っている途中').not.toBe('none');
        await expect.poll(async () => { const m = await probePopover(page); return attached(m) && m.top >= 0 && m.bottom <= m.H; }, { timeout: 3000 }).toBe(true);
        const m = await probePopover(page);
        expect(m.hits, JSON.stringify(m)).toEqual(Array(m.n).fill(true));
    });

    test('吹き出しが閉じている時は、シートの開閉の transition で置き直さない', async ({ page }) => {
        await openEditorWithShelfBlock(page, { mobile: true });
        // 一度開いて閉じ、置いた位置を覚える
        await page.locator('#art-drawer-shelf-btn').click();
        await expect(page.locator('#art-drawer-shelf-popover')).toBeVisible();
        await page.locator('#art-drawer-shelf-btn').click();
        await expect(page.locator('#art-drawer-shelf-popover')).toBeHidden();
        const before = await page.evaluate(() => { const p = document.getElementById('art-drawer-shelf-popover'); return { top: p.style.top, left: p.style.left, maxH: p.style.maxHeight }; });
        // 閉じる transition と開く transition を通す
        await closeArtSheetInternal(page);
        await page.waitForTimeout(400);
        await openArtSheetInternal(page);
        await page.waitForTimeout(400);
        const after = await page.evaluate(() => { const p = document.getElementById('art-drawer-shelf-popover'); return { hidden: p.hidden, top: p.style.top, left: p.style.left, maxH: p.style.maxHeight }; });
        expect(after.hidden).toBe(true);
        expect({ top: after.top, left: after.left, maxH: after.maxH }).toEqual(before);
    });
});

test.describe('PC1280: 引き出しの本棚の選択 (前と同じ)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('吹き出しがボタンに付いて画面の中に出て、全項目の中心がその項目に当たる', async ({ page }, testInfo) => {
        test.skip(/webkit/.test(testInfo.project.name), 'PC 幅は chromium だけで見る');
        await openEditorWithShelfBlock(page, { mobile: false });
        await page.locator('#art-drawer-shelf-btn').click();
        await expect(page.locator('#art-drawer-shelf-popover')).toBeVisible();
        const m = await probePopover(page);
        expect(attached(m), JSON.stringify(m)).toBe(true);
        expect(m.top).toBeGreaterThanOrEqual(0);
        expect(m.bottom).toBeLessThanOrEqual(m.H);
        expect(m.hits).toEqual(Array(m.n).fill(true));
    });
});
