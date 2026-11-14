// イシュー#635: 衝突の2つのダイアログ (書き込み時 #sync-conflict-dialog・読込時 #load-conflict-dialog) を
// 390×844 と 1280×800 で撮る。変更前 (step1)・変更後 (step2/step4) で同じスクリプトを使う。
//   使い方: PORT=8135 node scripts/verify/635-shots.mjs <label>   (label = before | after など)
//   出力: _local/635/<label>-<face>-<w>.png と、ボタンの位置・最初のフォーカスの表 _local/635/<label>-measure.json
// ダイアログは内部の関数で直接出す (見た目を撮るためだけ。動きの確認は E2E が画面の操作から見る)
import { chromium } from '../../node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const OUT = join(REPO, '_local/635');
const LABEL = process.argv[2] || 'before';
const BASE = `http://localhost:${process.env.PORT || '8135'}`;
const userData = readFileSync(join(REPO, 'tests/fixtures/fixture-userdata.json'), 'utf-8');
const library = readFileSync(join(REPO, 'tests/fixtures/fixture-library.json'), 'utf-8');

const SIZES = [{ w: 390, h: 844 }, { w: 1280, h: 800 }];
const FACES = [
    { name: 'write', caption: '書き込み時 (#616)', box: '#sync-conflict-dialog',
      open: () => { window.__p = window.bookshelf._showConflictDialog('Asayake ハブ'); } },
    { name: 'load', caption: '読込時 (#602)', box: '#load-conflict-dialog',
      open: () => { window.__p = window.bookshelf._showLoadConflictDialog('Asayake ハブ'); } },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const rows = [];
for (const s of SIZES) {
    for (const f of FACES) {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: s.w, height: s.h }, ...(s.w <= 390 ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
        const page = await ctx.newPage();
        await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
        await page.addInitScript(([u, l]) => {
            localStorage.setItem('virtualBookshelf_userData', u);
            localStorage.setItem('virtualBookshelf_library', l);
            localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', methodChosen: true }));
        }, [userData, library]);
        await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData, null, { timeout: 15000 });
        await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
        await page.waitForTimeout(800);
        await page.evaluate(f.open);
        await page.waitForSelector(f.box, { timeout: 5000 });
        await page.waitForTimeout(400);
        const m = await page.evaluate((sel) => {
            const box = document.querySelector(sel);
            const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
            return {
                box: r(box),
                title: box.querySelector('.cfm-title')?.textContent,
                message: box.querySelector('.cfm-message')?.textContent,
                buttons: [...box.querySelectorAll('.cfm-actions button')].map((b) => ({ text: b.textContent, cls: b.className, rect: r(b) })),
                focused: document.activeElement && document.activeElement.textContent
            };
        }, f.box);
        rows.push({ label: LABEL, face: f.name, caption: f.caption, width: s.w, ...m });
        await page.screenshot({ path: join(OUT, `${LABEL}-${f.name}-${s.w}.png`) });
        await ctx.close();
    }
}
await browser.close();
writeFileSync(join(OUT, `${LABEL}-measure.json`), JSON.stringify(rows, null, 2));
for (const r of rows) console.log(`${r.face} ${r.width}: focus=${r.focused} / ${r.buttons.map((b) => `${b.text}@${b.rect.x},${b.rect.y}`).join(' | ')}`);
