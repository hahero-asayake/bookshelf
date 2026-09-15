// ハヘロと同じ手順を DOM クリックだけで再現する（コードから直接開かない）。
// 公開ボタン → 記事一覧の行 → 記事編集画面 の順に実クリックし、スクショを撮る。
//
// イシュー#160: goto→reload の2段ロードは reload によるナビゲーション中断で
// hub.asayake.org へのリクエストが net::ERR_ABORTED になるレースコンディションがあった。
// addInitScript で1回のロードに変更している。
//
// 実行例: BOOKSHELF_VERIFY_DATA_DIR=/path/to/private/data node scripts/verify/shot-editor.mjs 390x844
import { chromium } from '@playwright/test';
import { resolveBase, requireDataRoot, resolveShotDir, logLoadedVersion, defaultSyncConfig, installHubMock } from './verify-common.mjs';

const ROOT = requireDataRoot();
const SHOT_DIR = resolveShotDir();
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

// イシュー#166 (②実測・#164 step1由来): 768px以下は #app-sidebar が
// position:fixed; transform:translateX(-100%) でドロワー化され初期状態で画面外。
// [data-mobile-nav="shelves"] (下部ナビ「本棚」) → _openDrawer() で body.drawer-open が
// 付いて初めて #sidebar-publish がクリック可能になる。
if (w <= 768) {
    await page.click('[data-mobile-nav="shelves"]', { timeout: 8000 }).catch(e => console.log('下部ナビ失敗:', e.message.slice(0, 80)));
    await page.waitForTimeout(500);
}

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

// 3) スクショを撮る（記事編集画面）
const shotPath = `${SHOT_DIR}/shot-editor-${w}x${h}.png`;
await page.screenshot({ path: shotPath, fullPage: false });
console.log(`== スクショ保存: ${shotPath}`);
// 画面外へはみ出している要素を数値で洗う
const overflow = await page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    document.querySelectorAll('#publish-pages-modal *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.right > vw + 1 || r.left < -1) {
            out.push({ sel: (el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0]),
                       left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) });
        }
    });
    return { vw, count: out.length, items: out.slice(0, 12) };
});
console.log('== はみ出し:', JSON.stringify(overflow, null, 1));
const scroll = await page.evaluate(() => {
    const m = document.getElementById('publish-pages-modal');
    return { docScrollW: document.documentElement.scrollWidth, inner: window.innerWidth,
             modalScrollH: m ? m.scrollHeight : 0, modalClientH: m ? m.clientHeight : 0 };
});
console.log('== スクロール:', JSON.stringify(scroll));
await b.close(); process.exit(0);
