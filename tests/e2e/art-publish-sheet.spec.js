// イシュー#742: スマホの公開パネルを中身の高さのシートとして下から出す (#733 案Sの後半・ハヘロ採用)。
// 狭幅 (<=900px) は overlays.open の narrow:'fit' → root の data-ov-narrow="fit" で、css が下寄せ・中身の高さ・×をパネルの中の右上にする。
// PC 幅は出し方を変えない。切り替え localStorage 'bookshelf.flag.pubSheet'='0' で前の形 (全画面) に戻る (ハヘロの承認まで残す)。
// 開く・閉じる (×・枠外・戻る)・公開までの通しを、スマホ幅と PC 幅で利用者と同じ操作で通す。保存先と公開先はハブの模擬 (gate-hub.js)。
// webkit project (iPhone 13) でもスマホ幅の件を流す (playwright.config.js の testMatch)。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest } from './helpers/gate-hub.js';

const TITLE = '#742 公開パネルのシート';
const BOOK_1 = 'フィクスチャの本 1';
const PUBLIC_URL_RE = /^https:\/\/bookshelf\.asayake\.org\/hahero\/[^/]+\/$/;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// PC 幅 1280×800 の公開パネルの高さは書体で変わる (イシュー#748): 手元 (homelab・Takao Pゴシック) 548.44 /
// CI と公式コンテナ (WenQuanYi Zen Hei) 547.52。前の版 (b9d95ec) も今も、同じ環境なら同じ値 (scripts/verify/748-results.md §1)。
// そのため PC 幅の件は手元で測った絶対値と比べず、同じ実行の中で前の形 (切り替え '0') と比べる。

const editView = (page) => page.locator('#art-edit-view');
const panel = (page) => page.locator('#art-publish-modal');
const canvas = (page) => page.frameLocator('#art-canvas-frame');
const drawerBook = (page) => page.locator('#art-drawer-list .art-drawer-item', { hasText: BOOK_1 }).first();

async function press(page, loc, touch) { if (touch) await loc.tap(); else await loc.click(); }

// ハブにログインした状態で開き、新しい記事を作って本棚ブロックに本を1冊入れ、編集の状態にする
async function setup(page, { touch, flag } = {}) {
    if (flag !== undefined) await page.addInitScript((f) => localStorage.setItem('bookshelf.flag.pubSheet', f), flag);
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
    await mockHubForTest(page, hub);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await press(page, page.locator('#art-new'), touch);
    await page.locator('#art-title').fill(TITLE);
    await press(page, page.locator('#art-mode-edit'), touch);
    await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
    await expect(async () => {
        await press(page, canvas(page).locator('.art-cv-ins-btn').last(), touch);
        await expect(page.locator('#art-add-sheet [data-block-type="shelf"]')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await press(page, page.locator('#art-add-sheet [data-block-type="shelf"]'), touch);
    await expect(drawerBook(page)).toBeVisible();
    await press(page, drawerBook(page), touch);
    const done = page.locator('#art-fs-done');
    if (await done.isVisible()) await press(page, done, touch);
    await expect(editView(page)).toHaveAttribute('data-art-mode', 'edit');
}

async function openPanel(page, touch) {
    if (touch) await page.getByRole('toolbar', { name: '記事の操作' }).getByRole('button', { name: '公開' }).tap();
    else await page.locator('#art-publish-header').click();
    await expect(panel(page)).toHaveClass(/show/);
    await expect(page.locator('#art-pub-go')).toBeVisible();
}

// パネル・×・下のボタンの列の矩形と、パネルより上の点が何に当たるか
async function geom(page) {
    return page.evaluate(() => {
        const m = document.getElementById('art-publish-modal');
        const c = m.querySelector('.modal-content').getBoundingClientRect();
        const x = document.getElementById('art-pub-close').getBoundingClientRect();
        const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
        const above = c.top > 10 ? document.elementFromPoint(Math.round(c.left + c.width / 2), Math.round(c.top / 2)) : null;
        return {
            vw: window.innerWidth, vh: window.innerHeight, narrow: m.dataset.ovNarrow || null,
            panel: { top: c.top, bottom: c.bottom, left: c.left, right: c.right, height: c.height },
            close: { top: x.top, bottom: x.bottom, left: x.left, right: x.right, position: getComputedStyle(document.getElementById('art-pub-close')).position },
            cancel: r(document.getElementById('art-pub-cancel')), go: r(document.getElementById('art-pub-go')),
            aboveIsRoot: above === m,
        };
    });
}

// geom を 150ms ごとに読み、パネルの矩形が2回続けて同じになったら返す (開いた直後の揺れを拾わない)
async function stableGeom(page) {
    let prev = null;
    let cur = null;
    await expect.poll(async () => {
        prev = cur;
        cur = await geom(page);
        return prev !== null && JSON.stringify(prev.panel) === JSON.stringify(cur.panel);
    }, { timeout: 5000, intervals: [150] }).toBe(true);
    return cur;
}

async function expectOnlyPanelClosed(page, how) {
    await expect(panel(page), how).not.toHaveClass(/show/);
    await expect(page.locator('#publish-pages-modal'), how).toHaveClass(/show/);
    await expect(editView(page), how).toBeVisible();
}

// 物理/ジェスチャーの戻る相当 (back-nav-matrix.spec.js と同じ)
async function back(page) {
    await page.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
}

test.describe('スマホ幅 (390×844): 中身の高さで下から出す', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA });

    test('開く: 下端は画面の下端・上に後ろが見える・×はパネルの中の右上・ボタンは画面内', async ({ page }) => {
        await setup(page, { touch: true });
        await openPanel(page, true);
        const g = await geom(page);
        expect(g.narrow).toBe('fit');
        expect(Math.abs(g.panel.bottom - g.vh)).toBeLessThanOrEqual(1);
        expect(g.panel.top).toBeGreaterThanOrEqual(48);
        expect(g.panel.height).toBeLessThan(g.vh);
        expect(g.aboveIsRoot, 'パネルより上は暗い所 (.modal の root)').toBe(true);
        // ×はパネルの矩形の中で右上
        expect(g.close.top).toBeGreaterThanOrEqual(g.panel.top);
        expect(g.close.top - g.panel.top).toBeLessThanOrEqual(32);
        expect(g.close.right).toBeLessThanOrEqual(g.panel.right);
        expect(g.panel.right - g.close.right).toBeLessThanOrEqual(24);
        expect(g.close.position).toBe('absolute');
        for (const b of [g.cancel, g.go]) {
            expect(b.top).toBeGreaterThanOrEqual(g.panel.top);
            expect(b.bottom).toBeLessThanOrEqual(g.vh);
        }
    });

    test('閉じる: ×・枠外 (上の暗い所)・戻るで、パネルだけ閉じてエディタは残る', async ({ page }) => {
        await setup(page, { touch: true });
        for (const how of ['x', 'outside', 'back']) {
            await openPanel(page, true);
            if (how === 'x') await page.locator('#art-pub-close').tap();
            if (how === 'outside') {
                const g = await geom(page);
                await page.touchscreen.tap(Math.round(g.vw / 2), Math.round(g.panel.top / 2));
            }
            if (how === 'back') await back(page);
            await expectOnlyPanelClosed(page, how);
        }
    });

    test('公開までの通し: 公開すると公開URLの行が画面内に出て、パネルの下端は画面の下端のまま', async ({ page }) => {
        await setup(page, { touch: true });
        await openPanel(page, true);
        await page.locator('#art-pub-go').tap();
        await page.getByRole('button', { name: '同意して公開' }).tap();
        await expect(page.locator('#art-pub-done')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#art-pub-url')).toHaveText(PUBLIC_URL_RE);
        await expect(page.locator('#art-pub-url')).toBeInViewport();
        const g = await geom(page);
        expect(Math.abs(g.panel.bottom - g.vh)).toBeLessThanOrEqual(1);
        expect(g.panel.top).toBeGreaterThanOrEqual(48);
    });

    test("切り替え: localStorage bookshelf.flag.pubSheet='0' なら前の形 (全画面・×は画面に固定)", async ({ page }) => {
        await setup(page, { touch: true, flag: '0' });
        await openPanel(page, true);
        const g = await geom(page);
        expect(g.narrow).toBe(null);
        expect(Math.abs(g.panel.top)).toBeLessThanOrEqual(1);
        expect(Math.abs(g.panel.height - g.vh)).toBeLessThanOrEqual(1);
        expect(g.close.position).toBe('fixed');
    });
});

test.describe('スマホ幅 (390×844): キーボード中は全画面の形に広げる', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA });

    test('タグの欄でキーボードが出ると全画面になり欄は可視域の中・閉じると中身の高さに戻る', async ({ page }) => {
        // 実キーボードは headless で開かないため、差し替え可能な visualViewport を仕込んで resize を模す
        // (publish-article-editor.spec.js の K-B と同じ作り。_artBindViewportScroll は初回表示時に1度だけ捕まえるので goto より前に置く)
        await page.addInitScript(() => {
            class FakeVisualViewport extends EventTarget {
                constructor() { super(); this.height = window.innerHeight; this.offsetTop = 0; this.width = window.innerWidth; }
            }
            Object.defineProperty(window, 'visualViewport', { value: new FakeVisualViewport(), configurable: true });
        });
        await setup(page, { touch: true });
        await openPanel(page, true);
        const before = await geom(page);
        expect(before.panel.height).toBeLessThan(before.vh);
        await page.locator('#art-tag-input').focus();
        await page.evaluate(() => {
            const vv = window.visualViewport;
            vv.height = Math.round(window.innerHeight * 0.55);
            vv.dispatchEvent(new Event('resize'));
        });
        await expect(panel(page)).toHaveAttribute('data-ov-kb-open', '');
        await expect.poll(async () => (await geom(page)).panel.height).toBeGreaterThanOrEqual(before.vh - 1);
        await expect.poll(() => page.evaluate(() => {
            const vv = window.visualViewport;
            return vv.height + vv.offsetTop - document.getElementById('art-tag-input').getBoundingClientRect().bottom;
        })).toBeGreaterThanOrEqual(0);
        // キーボードを閉じる (フォーカスを外し可視域を戻す)
        await page.evaluate(() => {
            document.activeElement.blur();
            const vv = window.visualViewport;
            vv.height = window.innerHeight;
            vv.dispatchEvent(new Event('resize'));
        });
        await expect(panel(page)).not.toHaveAttribute('data-ov-kb-open', /.*/);
        await expect.poll(async () => Math.round((await geom(page)).panel.height)).toBe(Math.round(before.panel.height));
    });
});

test.describe('PC 幅 (1280×800): 出し方は変えない', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test.beforeEach(({}, testInfo) => {
        test.skip(testInfo.project.name === 'webkit', 'webkit project は iPhone 13 (スマホ幅の件だけ流す)');
    });

    // 前の形 = 切り替え localStorage 'bookshelf.flag.pubSheet'='0' (_artPubSheetOn は開くたびに読む)。
    // PC 幅では '0' の形は #742 より前の版 (b9d95ec) と同じ出し方 (#742 の css は全部 max-width:900px の中)。
    // 切り替えを撤去する時は、この件の比べる相手が無くなる = 下の「書体に依らない形の検査」だけにするか、
    // 公式コンテナの画像比較 (tests/visual) へ移す (#748)。
    test("開く: パネルの矩形が前の形 (切り替え '0') と同じ", async ({ page }) => {
        await setup(page, { touch: false });
        await page.evaluate(() => localStorage.setItem('bookshelf.flag.pubSheet', '0'));
        await openPanel(page, false);
        const before = await stableGeom(page);
        expect(before.narrow).toBe(null);
        await page.locator('#art-pub-close').click();
        await expect(panel(page)).not.toHaveClass(/show/);
        await page.evaluate(() => localStorage.removeItem('bookshelf.flag.pubSheet'));
        await openPanel(page, false);
        const g = await stableGeom(page);
        expect(g.narrow).toBe('fit');
        // 同じ実行の中で前の形と比べる (書体の差を受けない)
        for (const k of ['top', 'bottom', 'left', 'right', 'height']) expect(g.panel[k], `panel.${k}`).toBeCloseTo(before.panel[k], 1);
        for (const k of ['top', 'right']) expect(g.close[k], `close.${k}`).toBeCloseTo(before.close[k], 1);
        // 書体に依らない形の検査: 幅は ov-md 720px で左右の中央・上下の中央寄せ (下寄せのシートになっていない)
        expect(g.panel.left).toBeCloseTo(280, 0);
        expect(g.panel.right).toBeCloseTo(1000, 0);
        expect(Math.abs(g.panel.top - (g.vh - g.panel.bottom))).toBeLessThanOrEqual(1);
        expect(g.close.position).toBe('absolute');
        expect(g.aboveIsRoot).toBe(true);
    });

    test('閉じる: ×・枠外・戻るで、パネルだけ閉じてエディタは残る', async ({ page }) => {
        await setup(page, { touch: false });
        for (const how of ['x', 'outside', 'back']) {
            await openPanel(page, false);
            if (how === 'x') await page.locator('#art-pub-close').click();
            if (how === 'outside') await page.mouse.click(5, 5);
            if (how === 'back') await back(page);
            await expectOnlyPanelClosed(page, how);
        }
    });

    test('公開までの通し: 公開すると公開URLの行が出る', async ({ page }) => {
        await setup(page, { touch: false });
        await openPanel(page, false);
        await page.locator('#art-pub-go').click();
        await page.getByRole('button', { name: '同意して公開' }).click();
        await expect(page.locator('#art-pub-done')).toBeVisible({ timeout: 15000 });
        await expect(page.locator('#art-pub-url')).toHaveText(PUBLIC_URL_RE);
        await expect(page.locator('#art-pub-url')).toBeInViewport();
    });
});
