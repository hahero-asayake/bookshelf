// U-4: 罫線色トークン (--line/--line2) を文字色に流用していた6箇所の再発防止回帰テスト
//  - コントラスト比は目視ではなく getComputedStyle(実背景/実文字色) から WCAG 相対輝度式で実測する
//  - ライト(既定)とダーク(dark-theme プラグイン)の両方で検証する (片方だけ通る配色が典型的な穴)
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

const TEXT_MIN = 4.5; // WCAG AA 本文
const UI_MIN = 3.0;   // WCAG AA UI部品・装飾アイコン

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
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

// getComputedStyle の color を実際の背景 (親を遡って最初の不透明背景) に対して比較し、
// WCAG 相対輝度式でコントラスト比を返す。
async function contrastOf(locator) {
    return locator.evaluate((el) => {
        const parseRgb = (str) => {
            const m = str.match(/rgba?\(([^)]+)\)/);
            if (!m) return null;
            const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
            return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
        };
        const relLum = ({ r, g, b }) => {
            const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const ratio = (c1, c2) => {
            const L1 = relLum(c1), L2 = relLum(c2);
            const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
            return (hi + 0.05) / (lo + 0.05);
        };
        const findBg = (start) => {
            let node = start;
            while (node) {
                const bg = parseRgb(getComputedStyle(node).backgroundColor);
                if (bg && bg.a > 0) return bg;
                node = node.parentElement;
            }
            return { r: 255, g: 255, b: 255, a: 1 }; // フォールバック (通常到達しない)
        };
        const color = parseRgb(getComputedStyle(el).color);
        const bg = findBg(el.parentElement || el);
        return Number(ratio(color, bg).toFixed(2));
    });
}

async function enableDarkTheme(page) {
    // dark-theme は標準同梱プラグイン (STANDARD_PLUGIN_IDS)。実際の CSS 変数上書き注入経路を通すため
    // プラグインモジュールを動的 import し、実 activate() を呼んで body.plugin-dark を有効化する。
    await page.evaluate(async () => {
        const mod = await import('/plugins-sample/dark-theme/index.js');
        const api = window.bookshelf.pluginAPI.forPlugin('dark-theme');
        mod.activate(api, { id: 'dark-theme' });
        localStorage.setItem('plugin-dark-theme:on', '1');
        document.body.classList.add('plugin-dark');
    });
    await expect(page.locator('body')).toHaveClass(/plugin-dark/);
    // .icon-picker-cell 等は `transition: background 0.1s` を持つため、変数切替直後は
    // getComputedStyle().backgroundColor がまだ旧値を返す (トランジション未開始分)。実測前に待つ。
    await page.waitForTimeout(150);
}

test.describe('U-4: --line/--line2 文字色流用の再発防止 (実測)', () => {

    test('detail-placeholder: 右ペイン初期表示のテキストが AA(4.5) を満たす (ライト/ダーク)', async ({ page }) => {
        await bootApp(page);
        const placeholder = page.locator('.detail-placeholder p').last();
        await expect(placeholder).toBeVisible();
        const light = await contrastOf(placeholder);
        expect(light, `light detail-placeholder=${light}`).toBeGreaterThanOrEqual(TEXT_MIN);

        await enableDarkTheme(page);
        const dark = await contrastOf(placeholder);
        expect(dark, `dark detail-placeholder=${dark}`).toBeGreaterThanOrEqual(TEXT_MIN);
    });

    test('icon-picker-direct-hint / icon-picker-cell-name: アイコンピッカー内テキストが AA(4.5) を満たす (通常/hover・ライト/ダーク)', async ({ page }) => {
        await bootApp(page);

        // 実際のユーザ経路: 本棚を新規作成→アイコン選択トリガをクリックしてピッカーを開く
        await page.locator('#sidebar-add-bookshelf').click();
        await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
        await page.locator('#bookshelf-icon-trigger').click();
        const modal = page.locator('#icon-picker-modal');
        await expect(modal).toHaveClass(/show/);

        const hint = page.locator('.icon-picker-direct-hint').first();
        await expect(hint).toBeVisible();
        const cellName = page.locator('.icon-picker-cell-name').first();
        await expect(cellName).toBeVisible();

        // ライト・通常状態
        let hintRatio = await contrastOf(hint);
        let cellRatio = await contrastOf(cellName);
        expect(hintRatio, `light hint=${hintRatio}`).toBeGreaterThanOrEqual(TEXT_MIN);
        expect(cellRatio, `light cell-name normal=${cellRatio}`).toBeGreaterThanOrEqual(TEXT_MIN);

        // ライト・hover状態 (背景が --line2 に変わる面)
        await cellName.locator('..').hover();
        cellRatio = await contrastOf(cellName);
        expect(cellRatio, `light cell-name hover=${cellRatio}`).toBeGreaterThanOrEqual(TEXT_MIN);

        // ダークに切替 (モーダルは開いたまま body.plugin-dark を付与)
        await enableDarkTheme(page);
        hintRatio = await contrastOf(hint);
        expect(hintRatio, `dark hint=${hintRatio}`).toBeGreaterThanOrEqual(TEXT_MIN);
        cellRatio = await contrastOf(cellName);
        expect(cellRatio, `dark cell-name normal=${cellRatio}`).toBeGreaterThanOrEqual(TEXT_MIN);
        await cellName.locator('..').hover();
        cellRatio = await contrastOf(cellName);
        expect(cellRatio, `dark cell-name hover=${cellRatio}`).toBeGreaterThanOrEqual(TEXT_MIN);
    });

    test('widget-grip: ダッシュボード編集モードのグリップが UI部品基準(3.0)を満たす (ライト/ダーク)', async ({ page }) => {
        await bootApp(page);
        await page.locator('#dashboard-edit-toggle').click();
        const grip = page.locator('.widget-grip').first();
        await expect(grip).toBeVisible();

        const light = await contrastOf(grip);
        expect(light, `light widget-grip=${light}`).toBeGreaterThanOrEqual(UI_MIN);

        await enableDarkTheme(page);
        const dark = await contrastOf(grip);
        expect(dark, `dark widget-grip=${dark}`).toBeGreaterThanOrEqual(UI_MIN);
    });

    test('bookshelf-empty .bse-icon: 0冊本棚の装飾アイコンが装飾基準(3.0)を満たす (ライト/ダーク)', async ({ page }) => {
        await bootApp(page);

        // 実際のユーザ経路: 新規本棚を作成 (0冊) → そのまま画面遷移して空状態を表示
        await page.locator('#sidebar-add-bookshelf').click();
        await page.locator('#bookshelf-name').fill('U4空本棚');
        await page.locator('#save-bookshelf-form').click();
        await expect(page.locator('#bookshelf-form-modal')).not.toHaveClass(/show/);

        // 新規本棚は「すべての本」の子として作られる。ツリーは既定で折りたたまれているため展開する。
        await page.locator('#sidebar-bookshelf-tree .tree-toggle').first().click();
        await page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: 'U4空本棚' }).click();
        const icon = page.locator('.bookshelf-empty .bse-icon');
        await expect(icon).toBeVisible();

        const light = await contrastOf(icon);
        expect(light, `light bse-icon=${light}`).toBeGreaterThanOrEqual(UI_MIN);

        await enableDarkTheme(page);
        const dark = await contrastOf(icon);
        expect(dark, `dark bse-icon=${dark}`).toBeGreaterThanOrEqual(UI_MIN);
    });

});
