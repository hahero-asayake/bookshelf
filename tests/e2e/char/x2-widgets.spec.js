// イシュー#521 X2: ホームの「＋ここに追加」枠・小の隣に小・選んで置く・キーボード・保存データの形。
// char の端末 (390・768・820・1024 はタッチ、1440・1920) で、利用者の操作 (クリック・キー・ドラッグ) だけで書く。
// 設計: docs/char/x2-design.md
import { test, expect } from '../helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../../fixtures/fixture-library.json'), 'utf-8');
const savedLayout = JSON.parse(readFileSync(join(here, '../../fixtures/x2-saved-layout.json'), 'utf-8'));

async function bootApp(page, userDataJson = fixtureUserData) {
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [userDataJson, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.__saves = 0; window.bookshelf.saveUserData = async () => { window.__saves++; }; });
}

async function enterEditMode(page) {
    await page.click('#dashboard-edit-toggle');
    await expect(page.locator('#dashboard-grid.is-edit-mode')).toBeVisible();
}

const widgetIds = (page) => page.locator('#dashboard-grid .dashboard-widget').evaluateAll((els) => els.map((e) => e.dataset.widgetId.split('#')[0]));
const rowYs = (page) => page.locator('#dashboard-grid .dashboard-widget').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
const isNarrow = (testInfo) => (testInfo.project.use.viewport?.width || 1280) <= 900;

test.describe('X2: 空きの枠と、小の隣に小 (2手以内)', () => {
    test('編集モードでは「＋ここに追加」の枠が常に見え、枠を足しても部品の位置は変わらない', async ({ page }, testInfo) => {
        await bootApp(page);
        await enterEditMode(page);
        const holes = page.locator('#dashboard-grid .widget-hole');
        await expect(holes).toHaveCount(isNarrow(testInfo) ? 1 : 2); // 実測 (x2-design.md §2)
        for (const h of await holes.all()) await expect(h).toBeVisible();
        // 表紙の画像で高さが変わる前に比べると誤って落ちる (step2 で実測) ため、読み込みを待つ
        await page.waitForLoadState('networkidle');
        await page.waitForFunction(() => [...document.images].every((i) => i.complete));
        const rect = () => page.locator('#dashboard-grid .dashboard-widget').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)]; }));
        const withHoles = await rect();
        await page.evaluate(() => document.querySelectorAll('.widget-hole').forEach((h) => { h.style.display = 'none'; }));
        expect(await rect()).toEqual(withHoles);
    });

    test('W2: 枠を押す→候補を押す (2手) で、その空きに入る。候補は空きに入る大きさの部品だけ', async ({ page }, testInfo) => {
        await bootApp(page);
        await enterEditMode(page);
        const before = await widgetIds(page);
        await page.locator('#dashboard-grid .widget-hole').first().click();                 // 1手目
        await expect(page.locator('.widget-picker-panel')).toBeVisible();
        await expect(page.locator('.widget-picker-head')).toContainText('この空きに追加');
        const shown = await page.locator('.widget-picker-item:not(.is-unfit)').evaluateAll((els) => els.map((e) => e.dataset.wid));
        expect(shown).not.toContain('heading'); // 全幅だけの見出しは空きに入らない
        await page.click('.widget-picker-item[data-wid="counter-unrated"]');                 // 2手目
        const after = await widgetIds(page);
        expect(after.length).toBe(before.length + 1);
        const pos = after.indexOf('counter-unrated', 4);
        expect(after[pos - 1]).toBe(isNarrow(testInfo) ? 'today-pick' : 'recent-books');
        const ys = await rowYs(page);
        expect(ys[pos]).toBe(ys[pos - 1]); // 空いていた行に入る
    });

    test('W1: 小の＋→候補 (2手) で、既存の小の隣に新しい小が入る', async ({ page }) => {
        await bootApp(page);
        await enterEditMode(page);
        // 2列の端末では小の行が2つで埋まるので、行の頭の小 (先頭) の後ろに入れる (どの端末でも同じ行の隣になる)
        await page.locator('#dashboard-grid .dashboard-widget').nth(0).locator('.widget-insert-btn').click(); // 1手目
        await page.click('.widget-picker-item[data-wid="counter-this-month"]');                              // 2手目
        const after = await widgetIds(page);
        expect(after.slice(0, 3)).toEqual(['counter-total', 'counter-this-month', 'counter-shelves']);
        const ys = await rowYs(page);
        expect(ys[1]).toBe(ys[0]); // 隣の小と同じ行
    });

    test('選んで置く: つまみ→置きたい部品で、その前へ移る。Esc は取り消しだけ (編集モードは続く)', async ({ page }) => {
        await bootApp(page);
        await enterEditMode(page);
        const cards = page.locator('#dashboard-grid .dashboard-widget');
        await cards.nth(3).locator('.widget-grip').click();
        await expect(cards.nth(3)).toHaveClass(/is-picked/);
        await cards.nth(0).locator('.widget-title').click();
        expect((await widgetIds(page)).slice(0, 2)).toEqual(['counter-unrated', 'counter-total']);
        const now = await widgetIds(page);
        await cards.nth(1).locator('.widget-grip').click();
        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-grid.is-picking')).toHaveCount(0);
        await expect(page.locator('#dashboard-grid.is-edit-mode')).toHaveCount(1);
        expect(await widgetIds(page)).toEqual(now);
    });
});

test.describe('X2: W6 キーボードだけで並べ替える', () => {
    test('Tab でつまみまで行き、↓で後ろへ・Alt+↑で前へ。フォーカスはつまみに残る', async ({ page }, testInfo) => {
        test.skip(!!testInfo.project.use.hasTouch, 'キーボードは PC の端末で確かめる');
        await bootApp(page);
        await enterEditMode(page);
        const before = await widgetIds(page);
        // 完了ボタンから Tab だけでつまみへ (マウスを使わない)
        await page.locator('#dashboard-edit-done').focus();
        let reached = false;
        for (let i = 0; i < 40 && !reached; i++) {
            await page.keyboard.press('Tab');
            reached = await page.evaluate(() => !!document.activeElement?.classList.contains('widget-grip'));
        }
        expect(reached).toBe(true);
        const startIdx = Number(await page.evaluate(() => document.activeElement.closest('.dashboard-widget').dataset.widgetIndex));
        await page.keyboard.press('ArrowDown');
        let after = await widgetIds(page);
        expect(after[startIdx + 1]).toBe(before[startIdx]);
        expect(await page.evaluate(() => document.activeElement.closest('.dashboard-widget')?.dataset.widgetIndex)).toBe(String(startIdx + 1));
        await page.keyboard.press('Alt+ArrowUp');
        after = await widgetIds(page);
        expect(after).toEqual(before);
        // Enter で「選んで置く」も始められる (つまみは button)
        await page.keyboard.press('Enter');
        await expect(page.locator('#dashboard-grid.is-picking')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('#dashboard-grid.is-picking')).toHaveCount(0);
    });
});

test.describe('X2: 保存データの形は変わらない', () => {
    test('既存の保存データ (古い span 4/8・spanMobile・config・廃止 id) をそのまま読み、保存し直しても形が同じ', async ({ page }) => {
        const ud = JSON.parse(fixtureUserData);
        ud._storage = ud._storage || {};
        ud._storage.main = { ...(ud._storage.main || {}), home: { widgets: savedLayout.widgets } };
        await bootApp(page, JSON.stringify(ud));
        expect(await widgetIds(page)).toEqual([
            'counter-total', 'counter-shelves', 'counter-unrated', 'heading', 'recent-books',
            'today-pick', 'pinned-memo', 'reading-stats', 'reading-stats',
        ]);
        const cls = await page.locator('#dashboard-grid .dashboard-widget').evaluateAll((els) => els.map((e) => e.className));
        expect(cls[5]).toContain('span-4');
        expect(cls[6]).toMatch(/span-8 m-half/);
        expect(cls[1]).toContain('m-full');
        // 編集モードで動かして戻す (↓→↑) と保存が走る。保存の形は {id, span, spanMobile?, config?} のまま
        await enterEditMode(page);
        const grip = page.locator('#dashboard-grid .dashboard-widget').first().locator('.widget-grip');
        await grip.focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowUp');
        expect(await page.evaluate(() => window.__saves)).toBeGreaterThan(0);
        const saved = await page.evaluate(() => window.bookshelf.userData._storage.main.home.widgets);
        expect(saved).toEqual([
            { id: 'counter-total', span: 3 },
            { id: 'counter-shelves', span: 3, spanMobile: 'full' },
            { id: 'counter-unrated', span: 3 },
            { id: 'heading', span: 12, config: { text: '読書' } },
            { id: 'recent-books', span: 9, config: { limit: 12 } },
            { id: 'today-pick', span: 4 },
            { id: 'pinned-memo', span: 8, spanMobile: 'half', config: { limit: 80 } },
            { id: 'reading-stats', span: 6 }, // 廃止 id (heatmap) は読み込み時に読書統計へ寄せる (今までどおり)
            { id: 'reading-stats', span: 6 },
        ]);
    });
});
