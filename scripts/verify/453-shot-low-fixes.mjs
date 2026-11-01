// イシュー#453 step2: 低い違反2件(.import-fallback-note / .pcard-head)の修正後を撮る
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8153';
const SHOT_DIR = 'tmp/453';
mkdirSync(SHOT_DIR, { recursive: true });
const fixtureUserData = readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8');
const fixtureLibrary = readFileSync('tests/fixtures/fixture-library.json', 'utf-8');

async function newPage(ctx) {
    const page = await ctx.newPage();
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto(`${BASE}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    return page;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 900, height: 700 } });

// 取込モーダル: import-fallback-note
{
    const page = await newPage(ctx);
    await page.evaluate(() => window.bookshelf.showImportModal());
    await page.waitForTimeout(200);
    const note = page.locator('.import-fallback-note');
    await note.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOT_DIR, '453-import-fallback-note-after.png') });
    const box = await note.boundingBox();
    console.log('import-fallback-note box', JSON.stringify(box));
    await page.close();
}

// プラグイン一覧: pcard-head
{
    const page = await newPage(ctx);
    await page.evaluate(() => window.bookshelf._openSettingsModal && window.bookshelf._openSettingsModal('plugins-section'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOT_DIR, '453-pcard-head-after.png') });
    await page.close();
}

await browser.close();
