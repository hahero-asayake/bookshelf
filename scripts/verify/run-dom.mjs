// ハヘロと同じ手順を DOM クリックだけで再現する（コードから直接開かない）。
// 公開ボタン → 記事一覧の行 → プレビュー の順に実クリックする。
//
// イシュー#160: goto→reload の2段ロードは reload によるナビゲーション中断で
// hub.asayake.org へのリクエストが net::ERR_ABORTED になるレースコンディションがあった。
// addInitScript で1回のロードに変更している。
//
// 実行例: BOOKSHELF_VERIFY_DATA_DIR=/path/to/private/data node scripts/verify/run-dom.mjs 1024x768
import { chromium } from '@playwright/test';
import { resolveBase, requireDataRoot, logLoadedVersion, defaultSyncConfig, installHubMock } from './verify-common.mjs';

const ROOT = requireDataRoot();
const [w, h] = (process.argv[2] || '2560x1080').split('x').map(Number);
const BASE = resolveBase(process.argv[3]);

const cfg = defaultSyncConfig();

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: w, height: h } });
const page = await ctx.newPage();

await installHubMock(ctx, ROOT, cfg);
await ctx.route('**unpkg.com/**', r => r.fulfill({ status: 404, body: '' }));

page.on('console', m => { const t = m.text(); if (/記事プレビュー|プレビュー|生成|stall|Error|error/i.test(t)) console.log('  [c]', t.slice(0, 180)); });
page.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 180)));

await ctx.addInitScript((c) => { localStorage.setItem('bookshelf_sync', JSON.stringify(c)); }, cfg);
await page.goto(BASE, { waitUntil: 'load' });
await logLoadedVersion(page);
await page.waitForTimeout(6000);

// 1) 公開ボタン
await page.click('#sidebar-publish', { timeout: 15000 }).catch(e => console.log('公開ボタン失敗:', e.message.slice(0, 80)));
await page.waitForTimeout(3000);
const rows = await page.locator('li.pp-row').count();
console.log(`== 記事一覧の行数=${rows}`);
if (!rows) { console.log('行が無い'); await b.close(); process.exit(0); }

// 2) 1行目を開く（行内のタイトル/編集ボタンを順に試す）
const row = page.locator('li.pp-row').first();
const html = await row.innerHTML();
const acts = [...html.matchAll(/data-act="([a-z-]+)"/g)].map(m => m[1]);
console.log('== 1行目の操作ボタン:', JSON.stringify(acts));
let openedBy = null;
for (const sel of ['[data-act="edit"]', '.pp-row-title', '.pp-row-main']) {
    const el = row.locator(sel).first();
    if (await el.count()) { await el.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500);
        const vis = await page.locator('#art-preview').isVisible().catch(() => false);
        if (vis) { openedBy = sel; break; } }
}
console.log('== エディタを開いた手段:', openedBy || '(開けなかった)');
if (!openedBy) { await b.close(); process.exit(0); }

// 3) プレビューを実クリック
const t0 = Date.now();
await page.click('#art-preview', { timeout: 10000 });
for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const txt = await page.evaluate(() => {
        const f = document.getElementById('pp-preview-frame');
        const d = f && f.contentDocument;
        return d && d.body ? d.body.innerText.slice(0, 70).replace(/\s+/g, ' ') : '(none)';
    });
    console.log(`  +${i + 1}s: ${txt}`);
    if (txt && !txt.includes('生成中') && txt !== '(none)') { console.log('→ 完走'); break; }
}
console.log('== 経過', Date.now() - t0, 'ms');
console.log('== trace:', JSON.stringify(await page.evaluate(() => (window.bookshelf._artPreviewTrace || []).map(t => `${t.stage}:${t.phase || ''}`))));
await b.close();
