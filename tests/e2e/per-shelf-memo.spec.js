// per-shelf-memo プラグインのフルアプリ実機スモーク (headless chromium)。
// localStorage フィクスチャで本体を起動 (同期フォルダ不要) し、実コードのプラグインを
// 動的 import して有効化。本棚から本を開いたときに detailSection の ctx.bookshelf が
// 実アプリから正しく配線されること (今回の追加点) と、合成表示・保存・本棚文脈なしの分岐を検証する。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

/** フィクスチャ起動 + 同期をインメモリにスタブ + per-shelf-memo を有効化 */
async function boot(page) {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    // writePluginFile/readPluginFile が動くよう同期先をインメモリにスタブ
    await page.evaluate(() => {
        const s = (window.__store = {});
        window.bookshelf.storage = {
            async syncBatch(entries) { for (const e of entries) s[e.path] = e.data; },
            async readText(path) { return path in s ? s[path] : null; },
        };
        window.bookshelf._isSyncReady = () => true;
    });
    // プラグインを実コードのまま動的 import して有効化 (webServer がリポジトリを配信)
    await page.evaluate(async () => {
        const mod = await import('/plugins-sample/per-shelf-memo/index.js');
        mod.activate(window.bookshelf.pluginAPI.forPlugin('per-shelf-memo'), { id: 'per-shelf-memo' });
    });
    return errors;
}

test('本棚から本を開くと ctx.bookshelf が配線され、本棚別メモを保存→再表示できる', async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
    await page.locator('#bookshelf .book-item[data-asin="B000000002"]').click();

    const sec = page.locator('#book-detail-pane .plugin-detail-section[data-plugin-section="per-shelf-memo"]');
    await expect(sec).toBeVisible();
    // ctx.bookshelf が実アプリの文脈本棚として渡っている (タイトルに本棚名)
    await expect(sec.locator('.pds-title')).toContainText('テスト本棚');
    const ta = sec.locator('.psm-textarea');
    await expect(ta).toBeVisible();

    // 入力 → 専用ストアへ保存
    await ta.fill('テスト本棚だけのメモ');
    await expect(sec.locator('.psm-status')).toHaveText('保存しました', { timeout: 3000 });
    const saved = await page.evaluate(() => window.__store['plugins/per-shelf-memo/data/fixshelf.json']);
    expect(JSON.parse(saved).B000000002).toBe('テスト本棚だけのメモ');

    // 別の本へ → 戻ると保存値が残る
    await page.locator('#bookshelf .book-item[data-asin="B000000001"]').click();
    await expect(sec.locator('.psm-textarea')).toHaveValue('');
    await page.locator('#bookshelf .book-item[data-asin="B000000002"]').click();
    await expect(sec.locator('.psm-textarea')).toHaveValue('テスト本棚だけのメモ');

    expect(errors).toEqual([]);
});

test('特殊本棚(すべて)から開くと編集UIは出さず案内を表示する', async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await page.locator('#bookshelf .book-item[data-asin="B000000002"]').click();

    const sec = page.locator('#book-detail-pane .plugin-detail-section[data-plugin-section="per-shelf-memo"]');
    await expect(sec).toBeVisible();
    await expect(sec.locator('.pds-empty')).toContainText('本棚を開いた状態');
    await expect(sec.locator('.psm-textarea')).toHaveCount(0);
    expect(errors).toEqual([]);
});
