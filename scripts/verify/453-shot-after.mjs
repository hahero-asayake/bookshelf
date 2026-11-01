// イシュー#453 step2: 案A実装後の本の詳細(.bd-meta-edit 撤去・topbar sticky化)を実アプリの JS で撮り直す。
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8153';
const SHOT_DIR = 'tmp/453';
mkdirSync(SHOT_DIR, { recursive: true });

const fixtureUserData = readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8');
const fixtureLibrary = readFileSync('tests/fixtures/fixture-library.json', 'utf-8');
const ASIN = 'B000000001';

async function newLoggedInPage(ctx) {
    const page = await ctx.newPage();
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto(`${BASE}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return page;
}

async function openBookEdit(page) {
    await page.evaluate((asin) => {
        const book = window.bookshelf.books.find(b => b.asin === asin);
        window.bookshelf.showBookDetail(book, true);
    }, ASIN);
    await page.waitForTimeout(150);
}

async function inspect(page) {
    return page.evaluate(() => {
        const pane = document.getElementById('book-detail-pane');
        const leaks = [];
        const overlaps = [];
        const nodes = [...pane.querySelectorAll('*')];
        nodes.forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            if (r.right > window.innerWidth + 1 || r.left < -1) {
                leaks.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 50) });
            }
        });
        pane.querySelectorAll('.bd-meta, .bd-meta-edit-inline, .bd-topbar').forEach(container => {
            const kids = [...container.children].filter(k => {
                const r = k.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            });
            for (let i = 0; i < kids.length; i++) {
                for (let j = i + 1; j < kids.length; j++) {
                    const a = kids[i].getBoundingClientRect();
                    const b = kids[j].getBoundingClientRect();
                    const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
                    const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
                    if (overlapX > 2 && overlapY > 2) overlaps.push({ a: kids[i].className?.toString().slice(0, 30), b: kids[j].className?.toString().slice(0, 30) });
                }
            }
        });
        return { leakCount: leaks.length, leaks: leaks.slice(0, 5), overlapCount: overlaps.length, overlaps: overlaps.slice(0, 5), hasDetailsElement: !!pane.querySelector('.bd-meta-edit'), hasInlineFields: !!pane.querySelector('.bd-meta-edit-inline'), hasOldActions: !!pane.querySelector('.bd-meta-edit-actions'), hasOldSaveBtn: !!pane.querySelector('.save-book-changes') };
    });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const results = {};

for (const [label, viewport] of [['after-pc', { width: 1920, height: 1080 }], ['after-390', { width: 390, height: 844 }]]) {
    const page = await newLoggedInPage(ctx);
    await page.setViewportSize(viewport);
    await openBookEdit(page);
    const m = await inspect(page);
    await page.screenshot({ path: join(SHOT_DIR, `453-${label}.png`) });
    console.log('→', label, JSON.stringify(m));
    results[label] = m;
    await page.close();
}

// 390: キーボード近似(viewport55%)でASIN欄フォーカス時のtopbar✓の可視性(sticky確認)
{
    const page = await newLoggedInPage(ctx);
    await page.setViewportSize({ width: 390, height: 844 });
    await openBookEdit(page);
    await page.click(`.edit-original-asin[data-asin="${ASIN}"]`);
    await page.setViewportSize({ width: 390, height: Math.round(844 * 0.55) });
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(SHOT_DIR, '453-after-390-asin-focused-kb.png') });
    const box = await page.locator('.bd-edit-toggle.cancel-edit-btn').boundingBox();
    results['after-390-kb-sticky'] = { box, visible: box && box.y >= 0 && (box.y + box.height) <= Math.round(844 * 0.55) };
    console.log('→ after-390-kb-sticky', JSON.stringify(results['after-390-kb-sticky']));
    await page.close();
}

await browser.close();
writeFileSync(join(SHOT_DIR, '453-shot-after-metrics.json'), JSON.stringify(results, null, 2));
console.log('\n=== metrics written to tmp/453/453-shot-after-metrics.json ===');
