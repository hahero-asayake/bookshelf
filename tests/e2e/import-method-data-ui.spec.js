// 「取込データを直接渡す」節の UI 整理 (2ブロック化・file input 統一) の機械検証。イシュー#89。
// クリック数据え置き・primary数・英語表記の消滅・未選択時 disabled を実測する。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page) {
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    await page.evaluate(() => window.bookshelf.showImportModal());
    await page.evaluate(() => { document.getElementById('import-method-data').open = true; });
}

const PASTE_JSON = JSON.stringify([
    { title: 'UIの本A', authors: '著者A', acquiredTime: 1700000000000, readStatus: 'UNKNOWN', asin: 'B0UITEST01', productImage: '' }
]);

test('primary 数: 各ブロックの .btn-primary は1つ以下', async ({ page }) => {
    await bootApp(page);
    const blocks = page.locator('#import-method-data .import-method-block');
    await expect(blocks).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
        const count = await blocks.nth(i).locator('.btn-primary').count();
        expect(count).toBeLessThanOrEqual(1);
    }
});

test('英語表記の消滅: Choose File / No file chosen が可視テキストに出ない・file input は視覚露出しない・日本語代替が見える', async ({ page }) => {
    await bootApp(page);
    const section = page.locator('#import-method-data');
    await expect(section).toContainText('ファイルを選択');
    await expect(section).toContainText('選択されていません');
    const visibleText = await section.innerText();
    expect(visibleText).not.toContain('Choose File');
    expect(visibleText).not.toContain('No file chosen');
    // ブラウザ既定 UI の file input 自体が視覚露出していないこと (hidden 属性)
    const box = await page.locator('#kindle-file-input').boundingBox();
    expect(box).toBeNull();
});

test('ファイル未選択時は「ファイルから取り込む」が disabled、選択後に enabled になる', async ({ page }) => {
    await bootApp(page);
    const importBtn = page.locator('#import-from-file');
    await expect(importBtn).toBeDisabled();

    const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('label[for="kindle-file-input"]').click()
    ]);
    await fileChooser.setFiles({ name: 'kindle-export.json', mimeType: 'application/json', buffer: Buffer.from(PASTE_JSON) });

    await expect(importBtn).toBeEnabled();
    await expect(page.locator('#kindle-file-name')).toHaveText('kindle-export.json');
});

test('クリック数実測: クリップボード読み取り経路は1クリックで完結 (readClipboardForImport が読み取り成功時に自動で取込む実装のため)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await bootApp(page);
    await page.evaluate((json) => navigator.clipboard.writeText(json), PASTE_JSON);

    let clicks = 0;
    await page.locator('#read-clipboard-import').click(); clicks++;
    await expect(page.locator('#book-selection')).toBeVisible();
    expect(clicks).toBe(1);
});

test('クリック数実測: 手動貼り付け経路は (テキスト入力+) 1クリックで完結', async ({ page }) => {
    await bootApp(page);
    await page.locator('#kindle-paste-input').fill(PASTE_JSON);

    let clicks = 0;
    await page.locator('#import-from-paste').click(); clicks++;
    await expect(page.locator('#book-selection')).toBeVisible();
    expect(clicks).toBe(1);
});

test('クリック数実測: ファイル経路は2クリックで完結 (据え置き)', async ({ page }) => {
    await bootApp(page);
    let fileClicks = 0;
    const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('label[for="kindle-file-input"]').click()
    ]);
    fileClicks++;
    await fileChooser.setFiles({ name: 'kindle-export.json', mimeType: 'application/json', buffer: Buffer.from(PASTE_JSON) });
    await page.locator('#import-from-file').click(); fileClicks++;
    await expect(page.locator('#book-selection')).toBeVisible();
    expect(fileClicks).toBe(2);
});
