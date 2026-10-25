// イシュー#367 step3: 設定モーダル (大・左に項目一覧・右に中身) とアイコンピッカー (中) の修正前後を
// PC1280・900・390 で撮り、boundingBox と z-index を表にする (shot-367-step2.mjs と同じ型)。
//   前: git archive <前の commit> → tmp/367/before-src を :8001 で配信 ／ 後: 作業ツリー (:8000)
// 出力: tmp/verify-shots/367/step3/{before,after}/<face>-<w>.png・tmp/367/step3-measure.md・tmp/367/step3-compare-<face>.png
import { chromium } from '../../node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SHOT = join(REPO, 'tmp/verify-shots/367/step3');
for (const d of ['before', 'after']) mkdirSync(join(SHOT, d), { recursive: true });
const userData = readFileSync(join(REPO, 'tests/fixtures/fixture-userdata.json'), 'utf-8');
const library = readFileSync(join(REPO, 'tests/fixtures/fixture-library.json'), 'utf-8');

const VERSIONS = [{ label: 'before', base: 'http://localhost:8001' }, { label: 'after', base: 'http://localhost:8000' }];
const WIDTHS = [1280, 900, 390];
const FACES = [
    { name: 'settings', caption: '設定モーダル (PC: 左に項目一覧・右に中身 / 390: 一覧)', box: '#settings-modal .modal-content',
      open: () => { window.bookshelf._openSettingsModal(); } },
    { name: 'settings-publish', caption: '設定モーダル「公開」カテゴリ (PC) / 390 は詳細', box: '#settings-modal .modal-content',
      open: () => { window.bookshelf._openSettingsModal('publish-section'); } },
    { name: 'icon-picker', caption: 'アイコンピッカー (本棚フォームの上・②決裁で中=720px)', box: '#icon-picker-modal .modal-content',
      open: () => { window.bookshelf.showBookshelfForm(null); window.__p = window.bookshelf.openIconPicker({ title: '本棚のアイコンを選択', current: 'library' }); } },
];

async function boot(ctx, base, width) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 800 });
    await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [userData, library]);
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData, null, { timeout: 15000 });
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return page;
}

const COMPOSE_ONLY = process.env.COMPOSE_ONLY === '1';
const rows = COMPOSE_ONLY ? JSON.parse(readFileSync(join(REPO, 'tmp/367/step3-measure.json'), 'utf-8')) : [];
const browser = await chromium.launch();
for (const v of (COMPOSE_ONLY ? [] : VERSIONS)) {
    for (const w of WIDTHS) {
        for (const f of FACES) {
            const ctx = await browser.newContext({ serviceWorkers: 'block' });
            let page;
            try {
                page = await boot(ctx, v.base, w);
                await page.evaluate(f.open);
                await page.waitForSelector(f.box, { timeout: 5000 });
                await page.waitForTimeout(400);
                const m = await page.evaluate((sel) => {
                    const box = document.querySelector(sel);
                    const r = box.getBoundingClientRect();
                    const root = box.closest('.modal, .cfm-overlay') || box;
                    const cs = getComputedStyle(root);
                    const master = document.getElementById('settings-master');
                    const detail = document.getElementById('settings-detail');
                    const mr = master && master.offsetParent ? master.getBoundingClientRect() : null;
                    const dr = detail && detail.offsetParent ? detail.getBoundingClientRect() : null;
                    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
                        centerDx: Math.round((r.x + r.width / 2) - window.innerWidth / 2),
                        z: cs.zIndex, layer: root.dataset.layer ?? '-', ovSize: root.dataset.ovSize ?? '-',
                        rail: mr ? `${Math.round(mr.width)}` : '-', pane: dr ? `${Math.round(dr.width)}` : '-',
                        topIsFace: (() => { const t = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(20, r.height / 2)); return !!(t && box.contains(t)); })() };
                }, f.box);
                const file = join(SHOT, v.label, `${f.name}-${w}.png`);
                await page.screenshot({ path: file });
                rows.push({ version: v.label, width: w, face: f.name, ...m });
                console.log(v.label, w, f.name, JSON.stringify(m));
            } catch (e) {
                rows.push({ version: v.label, width: w, face: f.name, error: String(e).slice(0, 120) });
                console.log(v.label, w, f.name, 'ERROR', String(e).slice(0, 160));
            } finally { await ctx.close(); }
        }
    }
}

if (!COMPOSE_ONLY) {
    let md = `# #367 step3 設定モーダル・アイコンピッカー: 修正前後の実測 (${new Date().toISOString().slice(0, 16)})\n\n`;
    md += '| 面 | 幅 | 版 | 箱 x,y | 箱 w×h | 中心ずれ(px) | z-index | data-layer | ov-size | 左レール幅 | 右ペイン幅 | 最前面=自分 |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n';
    for (const f of FACES) for (const w of WIDTHS) for (const v of VERSIONS) {
        const r = rows.find((x) => x.face === f.name && x.width === w && x.version === v.label);
        if (!r) continue;
        md += r.error ? `| ${f.name} | ${w} | ${v.label} | ERROR ${r.error} |||||||||\n`
            : `| ${f.name} | ${w} | ${v.label} | ${r.x},${r.y} | ${r.w}×${r.h} | ${r.centerDx} | ${r.z} | ${r.layer} | ${r.ovSize} | ${r.rail} | ${r.pane} | ${r.topIsFace ? '✓' : '✗'} |\n`;
    }
    writeFileSync(join(REPO, 'tmp/367/step3-measure.md'), md);
    writeFileSync(join(REPO, 'tmp/367/step3-measure.json'), JSON.stringify(rows, null, 1));
}

// 合成 (HTML をファイルに書いて file:// で goto する・#337 の型)
const page = await browser.newPage();
for (const f of FACES) {
    const cell = (v, w) => {
        const p = join(SHOT, v, `${f.name}-${w}.png`);
        const r = rows.find((x) => x.face === f.name && x.width === w && x.version === v) || {};
        const cap = r.error ? 'ERROR' : `${w}px / 箱 ${r.w}×${r.h} / z ${r.z} / layer ${r.layer}${r.rail !== '-' ? ` / レール ${r.rail}+ペイン ${r.pane}` : ''}`;
        const scale = w === 390 ? 0.45 : 0.36;
        return `<div><div style="font-size:11px;color:#444;margin-bottom:3px">${cap}</div>${existsSync(p) ? `<img src="file://${p}" style="width:${Math.round(w * scale)}px;border:1px solid #ccc">` : '<div style="color:#999">(なし)</div>'}</div>`;
    };
    const row = (v, label, color) => `<div style="margin-bottom:14px"><div style="font-weight:700;color:${color};margin-bottom:6px">${label}</div><div style="display:flex;gap:10px;align-items:flex-start">${WIDTHS.map((w) => cell(v, w)).join('')}</div></div>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;font-family:'Noto Sans CJK JP',sans-serif;background:#fff;width:960px">
        <div style="font-size:15px;font-weight:700;margin-bottom:10px">${f.caption} — 修正前 (d71c19a) / 修正後 (イシュー#367 step3)</div>
        ${row('before', '修正前', '#555')}${row('after', '修正後', '#1455c4')}</body></html>`;
    const htmlPath = join(REPO, 'tmp/367', `_compose3-${f.name}.html`);
    writeFileSync(htmlPath, html);
    await page.goto('file://' + htmlPath, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(REPO, 'tmp/367', `step3-compare-${f.name}.png`), fullPage: true });
}
await browser.close();
console.log('done:', join(REPO, 'tmp/367/step3-measure.md'));
