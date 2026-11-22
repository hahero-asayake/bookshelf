// イシュー#770 (切り替え③ artLookList＝#769・#741 案B)。触れるモック (_vault-work/769/harness/e2e769.mjs・form769.mjs) で
// 確かめた形をアプリで見る。記事の「見た目」の選択肢 (#art-look-sheet) を縦一列にする。押した時の処理は今のまま。
//   スマホ：下に付き、画面の約45%まで (中で送る)
//   PC：記事の列と本の引き出しの間の空きに置く。空きが200px未満なら記事の列の右端に重ねる (幅228・top 53)
//   localStorage 'bookshelf.flag.artLookList' = '0' で前の形 (テンプレ横並び・配色4列) に戻る。
// 390幅 (iPhone 相当) の webkit は playwright.config の webkit / gate-webkit が流す。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { getArtDraft } from './helpers/art-editor.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

// ハブの模擬で起動し、記事エディタを開いて見た目のシートを開く。flag は起動の後に入れる (addInitScript は使わない)。
async function openLook(page, { flag = null } = {}) {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    if (flag != null) await page.evaluate((v) => localStorage.setItem('bookshelf.flag.artLookList', v), flag);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await expect(page.locator('#art-edit-view')).toBeVisible();
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible()) await edit.click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
    const btn = (await page.locator('#art-bar-look').isVisible()) ? '#art-bar-look' : '#art-look-btn';
    await page.locator(btn).click();
    await expect(page.locator('#art-look-sheet')).toBeVisible();
    await expect(page.locator('#art-look-sheet .art-lk-col').first()).toBeVisible();
}

// 行の矩形と、パネル・記事の列・引き出しの矩形
const measure = (page) => page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
    const rows = [...document.querySelectorAll('#art-look-sheet .art-lk-lay, #art-look-sheet .art-lk-col')].map((el) => ({
        r: r(el), kind: el.dataset.lookKind, checked: el.getAttribute('aria-checked'), after: getComputedStyle(el, '::after').content,
    }));
    const dr = document.getElementById('art-drawer');
    return {
        rows, vw: innerWidth, vh: innerHeight,
        panel: r(document.querySelector('#art-look-sheet .art-add-sheet-panel')),
        col: r(document.querySelector('#art-edit-view .art-col')),
        drawer: dr && dr.getClientRects().length ? r(dr) : null,
        docSW: document.documentElement.scrollWidth,
    };
});

// 縦一列：全行の左端・右端がそろい、上から下へ1行に1つ・選ばれた2行に ✓
function expectVertical(s) {
    const L = s.rows.map((x) => x.r.left); const R = s.rows.map((x) => x.r.right);
    expect(s.rows.length).toBeGreaterThan(3);
    expect(Math.max(...L) - Math.min(...L), JSON.stringify(L)).toBeLessThanOrEqual(0.5);
    expect(Math.max(...R) - Math.min(...R), JSON.stringify(R)).toBeLessThanOrEqual(0.5);
    s.rows.forEach((x, i) => { if (i) expect(x.r.top).toBeGreaterThanOrEqual(s.rows[i - 1].r.bottom - 0.5); });
    const ck = s.rows.filter((x) => x.checked === 'true');
    expect(ck).toHaveLength(2);
    ck.forEach((x) => expect(x.after).toBe('"✓"'));
    expect(s.docSW).toBeLessThanOrEqual(s.vw);
    expect(s.panel.left).toBeGreaterThanOrEqual(-0.5);
    expect(s.panel.right).toBeLessThanOrEqual(s.vw + 0.5);
}

// 押すと見た目が変わり、シートは開いたまま (押した時の処理は今のまま)
async function expectPickChangesTheme(page) {
    const loc = page.locator('#art-look-sheet .art-lk-col:not([aria-checked="true"])').nth(2);
    const id = await loc.getAttribute('data-look-id');
    await loc.click();
    await expect.poll(() => getArtDraft(page).then((d) => d.theme && d.theme.color)).toBe(id);
    await expect(page.locator(`#art-look-sheet .art-lk-col[data-look-id="${id}"]`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#art-look-sheet')).toBeVisible();
}

test.describe('スマホ390: 見た目の縦一列 (既定＝on)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA });

    test('縦一列・下に付いて画面の45%まで・押すと見た目が変わる', async ({ page }) => {
        await openLook(page);
        await expect(page.locator('#art-look-sheet')).toHaveClass(/is-look-list/);
        await expect.poll(async () => (await measure(page)).panel.bottom).toBeGreaterThan(0);
        // 開く transition が止まってから測る
        await expect.poll(async () => { const s = await measure(page); return Math.abs(s.panel.bottom - s.vh) <= 1; }).toBe(true);
        const s = await measure(page);
        expectVertical(s);
        expect(s.panel.height, JSON.stringify(s.panel)).toBeLessThanOrEqual(s.vh * 0.45 + 1);
        await expectPickChangesTheme(page);
    });
});

test.describe('PC 1280: 見た目の縦一列 (既定＝on)', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('縦一列・記事の列と引き出しの間 (空きが無ければ記事の列の右端に重ねる)・top 53・押すと見た目が変わる', async ({ page }) => {
        await openLook(page);
        const s = await measure(page);
        expectVertical(s);
        expect(Math.round(s.panel.top)).toBe(53);
        const drLeft = s.drawer && s.drawer.width ? s.drawer.left : s.vw - 16;
        const gap = drLeft - s.col.right;
        if (gap >= 200) {
            expect(Math.round(s.panel.left)).toBe(Math.round(s.col.right + 8));
            expect(Math.round(s.panel.width)).toBe(Math.round(gap - 16));
        } else {
            expect(Math.round(s.panel.width)).toBe(228);
            expect(Math.round(s.panel.right)).toBe(Math.round(drLeft - 8));
        }
        expect(s.panel.bottom).toBeLessThanOrEqual(s.vh + 0.5);
        await expectPickChangesTheme(page);
    });

    test('画面の幅を変えると置き場を計り直す', async ({ page }) => {
        await openLook(page);
        const before = await page.locator('#art-look-sheet .art-add-sheet-panel').getAttribute('data-look-place');
        await page.setViewportSize({ width: 1000, height: 800 });
        await expect.poll(() => page.locator('#art-look-sheet .art-add-sheet-panel').getAttribute('data-look-place')).not.toBe(before);
        const s = await measure(page);
        expect(s.panel.right).toBeLessThanOrEqual(s.vw + 0.5);
        expect(Math.round(s.panel.top)).toBe(53);
    });
});

test.describe('PC 1280: artLookList=0 で前の形', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('配色は横に並ぶ (縦一列ではない)・置き場の印は無い', async ({ page }) => {
        await openLook(page, { flag: '0' });
        await expect(page.locator('#art-look-sheet')).not.toHaveClass(/is-look-list/);
        const s = await measure(page);
        const cols = s.rows.filter((x) => x.kind === 'color'); // 配色の行
        expect(new Set(cols.slice(0, 4).map((x) => Math.round(x.r.top))).size).toBe(1);
        await expect(page.locator('#art-look-sheet .art-add-sheet-panel')).not.toHaveAttribute('data-look-place', /./);
    });
});
