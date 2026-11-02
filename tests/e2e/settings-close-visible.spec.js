// イシュー#497 step0 → イシュー#511 X1 で決まりの形に更新。
// 決まり(docs/ui-standards.md §7c§3・x1-exits.md §4-2)：PC(901px以上)は設定が「行き先」の1つなので
// ←もhidden×も出さない(左ナビ/戻るで出る)。狭い幅(900px以下)は一覧=← ホーム・詳細=← 設定を出す。
// それを押すと実際に閉じて #/settings から抜けることを経路どおりに確かめる。
// ESC・戻る操作(history.back)で閉じることも ui-standards §1 の期待表どおり確かめる。
import { test, expect } from './helpers/test-base.js';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const SHOT_DIR = process.env.SHOT_DIR_497 || '';

const WIDTHS = [390, 768, 1024, 1440, 1920];

async function bootApp(page) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

// 画面内(viewportの内側)に完全に収まって見えているか
async function inViewport(page, locator) {
    if (!(await locator.isVisible())) return false;
    const box = await locator.boundingBox();
    const vp = page.viewportSize();
    return !!box && box.width > 0 && box.height > 0
        && box.x >= 0 && box.y >= 0
        && box.x + box.width <= vp.width && box.y + box.height <= vp.height;
}

// 設定画面を開く。一覧(master)はスマホ幅だけにある(PCは常に左の項目一覧+右の中身)
async function openSettings(page, view) {
    await page.evaluate((v) => window.bookshelf._openSettingsModal(v === 'detail' ? 'sync-section' : undefined), view);
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    // 注: PC幅では重なる面を履歴に積まない仕様(_modalHistPush の `if (!mobile) return`)のため #/settings が付かない。
    // スマホ幅では #/settings になる。ここでは閉じた後に #/settings でないことだけ見る(作法の統一は#497の設計で扱う)
}

for (const width of WIDTHS) {
    for (const view of ['master', 'detail']) {
        const narrow = width <= 900; // js/ui/viewport.js の境目(900px)と揃える(イシュー#505)
        test(`#511 幅${width} ${view}: 決まりどおりの閉じる手段が画面内に見え、押すと閉じて#/settingsから抜ける`, async ({ page }) => {
            await page.setViewportSize({ width, height: width <= 768 ? 844 : 1080 });
            const errors = await bootApp(page);
            await openSettings(page, view);
            const mobile = width <= 768;
            const content = page.locator('.settings-modal-content');
            if (mobile) await expect(content).toHaveAttribute('data-settings-view', view);
            const close = page.locator('#settings-modal-close'); // 狭い幅の一覧だけ「← ホーム」
            const back = page.locator('#settings-back'); // 狭い幅の詳細だけ「← 設定」
            const shouldShowClose = narrow && view === 'master';
            const shouldShowBack = narrow && view === 'detail';
            expect(await inViewport(page, close)).toBe(shouldShowClose);
            expect(await inViewport(page, back)).toBe(shouldShowBack);
            if (SHOT_DIR && (width === 390 || width === 1920)) {
                mkdirSync(SHOT_DIR, { recursive: true });
                await page.screenshot({ path: join(SHOT_DIR, `497-step0-settings-${width}-${view}.png`) });
            }
            // PCは左ナビ(サイドバー)かブラウザの戻るで出る。この経路の自動打鍵はP2(ux-p2-settings.spec.js)が持つため、
            // ここでは「見える手段」で閉じられることだけを、見える手段がある幅/状態のときに確かめる
            if (shouldShowClose) await close.click();
            else if (shouldShowBack) { await back.click(); await expect(content).toHaveAttribute('data-settings-view', 'master'); return; }
            else return; // PC: 画面内に閉じる手段が無い(決まりどおり)。経路の確認はP2側
            await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
            await expect.poll(() => page.evaluate(() => location.hash)).not.toContain('settings');
            expect(errors).toEqual([]);
        });
    }
}

for (const width of [390, 1920]) {
    test(`#497 幅${width}: ESCで閉じて#/settingsから抜ける`, async ({ page }) => {
        await page.setViewportSize({ width, height: width <= 768 ? 844 : 1080 });
        const errors = await bootApp(page);
        await openSettings(page, 'master');
        await page.keyboard.press('Escape');
        await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
        await expect.poll(() => page.evaluate(() => location.hash)).not.toContain('settings');
        expect(errors).toEqual([]);
    });
}

// スマホの戻る操作(PC幅は履歴に積まない仕様のため対象外)
test(`#497 幅390: 戻る操作(history.back)で閉じて#/settingsから抜ける`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = await bootApp(page);
    await openSettings(page, 'master');
    await page.evaluate(() => history.back());
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
    await expect.poll(() => page.evaluate(() => location.hash)).not.toContain('settings');
    expect(errors).toEqual([]);
});
