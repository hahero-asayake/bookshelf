// registerActiveFilter (属性プロバイダ) の実機検証。
// プラグインが bookFilter で 0 件に絞り込み、registerActiveFilter で「フィルタ中」を申告すると、
// コアの空状態が「条件に合う本がありません」+「絞り込みを解除」を出し、解除でフィルタが OFF になる。
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

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

test('プラグインの registerActiveFilter で 0 件時の空状態が絞り込み版になり、解除で復帰する', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(3);

    // インラインのテストプラグイン: bookFilter で全件落とし、activeFilter で「フィルタ中」を申告
    await page.evaluate(() => {
        window.__af = { on: true };
        const api = window.bookshelf.pluginAPI.forPlugin('test-active-filter');
        api.registerBookFilter((books) => (window.__af.on ? [] : books));
        api.registerActiveFilter({
            isActive: () => window.__af.on,
            reset: () => { window.__af.on = false; },
            label: 'テストフィルタ'
        });
        window.bookshelf.applyFilters();
    });

    // 0 件 → 空状態は「絞り込み版」(まだ本がありません ではない)
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(0);
    await expect(page.locator('#bookshelf .bookshelf-empty')).toBeVisible();
    await expect(page.locator('#bookshelf .bse-title')).toContainText('条件に合う本がありません');

    // 「絞り込みを解除」→ プラグイン reset で on=false → 3 件に復帰
    await page.locator('#bookshelf .bookshelf-empty .btn').click();
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(3);
    expect(await page.evaluate(() => window.__af.on)).toBe(false);

    expect(errors).toEqual([]);
});

test('元から空の本棚では、フィルタプラグインが有効でも通常の空状態 (絞り込み版でない) になる', async ({ page }) => {
    // 回帰: isAnyFilterActive() はグローバル申告なので、プラグインを ON にしたまま
    // 本が 0 件の本棚を開くと、以前は誤って「条件に合う本がありません」+ 誤解除になった。
    // プラグインフィルタ適用前の件数で「プラグインが畳んで0件」かを区別して防ぐ。
    const errors = await bootApp(page);
    await page.evaluate(() => {
        // フィルタ中を常に申告するプラグイン (bookFilter は素通し = series-grouping が
        // シリーズ未検出の本棚に効いている状況に相当)。
        window.__af2 = { on: true };
        const api = window.bookshelf.pluginAPI.forPlugin('test-passthrough-filter');
        api.registerBookFilter((books) => books);
        api.registerActiveFilter({ isActive: () => window.__af2.on });
        // テスト本棚を空にして開く (元から本が割り当てられていない本棚を再現)
        window.bookshelf.switchBookshelf('fixshelf');
        const sh = window.bookshelf.userData.bookshelves.find((b) => b.id === 'fixshelf');
        sh.books = [];
        window.bookshelf.applyFilters();
    });

    await expect(page.locator('#bookshelf .book-item')).toHaveCount(0);
    await expect(page.locator('#bookshelf .bookshelf-empty')).toBeVisible();
    // 絞り込み版 ('条件に合う本がありません') ではなく、本棚が空の文言＋「すべての本を見る」
    await expect(page.locator('#bookshelf .bse-title')).toContainText('にはまだ本がありません');
    await expect(page.locator('#bookshelf .bookshelf-empty .btn')).toHaveText('すべての本を見る');
    // プラグインは依然 ON のまま (誤解除されていない)
    expect(await page.evaluate(() => window.__af2.on)).toBe(true);

    expect(errors).toEqual([]);
});
