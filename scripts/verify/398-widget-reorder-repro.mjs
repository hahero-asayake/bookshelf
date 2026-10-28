// イシュー#398 step3: スマホ(390px・タッチ)でのウィジェット並べ替えの再現 + 案A/B/Cのモック画像。
// sort-persist.spec.js と同じ boot() の型(同期adapterを無害化してswitchBookshelf)を流用。
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'tmp/verify-shots/398';
mkdirSync(OUT, { recursive: true });

const userData = {
    bookshelves: [{ id: 'all', name: 'すべての本', isSpecial: true, books: [], internalId: 'all' }],
    notes: {}, settings: {}, bookOrder: {}, stats: {}, version: 2,
    _storage: { main: { home: { widgets: [
        { id: 'counter-total', uid: 'w1', span: 3 },
        { id: 'counter-shelves', uid: 'w2', span: 3 },
        { id: 'recent-books', uid: 'w3', span: 6 },
        { id: 'reading-stats', uid: 'w4', span: 12 },
    ] } } },
};
const library = { books: [], metadata: { totalBooks: 0 } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
const page = await ctx.newPage();
await page.addInitScript(([u, l]) => {
    localStorage.setItem('virtualBookshelf_userData', u);
    localStorage.setItem('virtualBookshelf_library', l);
    localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
}, [JSON.stringify(userData), JSON.stringify(library)]);
await page.goto('http://localhost:8000/index.html');
await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books, null, { timeout: 15000 });
await page.evaluate(() => {
    const bs = window.bookshelf; const a = bs.storage.adapter;
    a.beginBatch = () => {}; a.addBatchEntry = () => {}; a.addBatchDelete = () => {}; a.discardBatch = () => {};
    a.commitBatch = async () => ({}); a.fileExists = async () => false; a.readJSON = async () => null;
    a.writeJSON = async () => {}; a.writeText = async () => {};
    bs.storage.detectFormat = async () => 'new';
    bs.syncMethod = 'hub'; bs._isSyncReady = () => true; bs._ensureFreshGitHubToken = async () => true; bs.obsidianDirHandle = null;
});
// 編集モードに入る (ツールバーの「レイアウト編集」)
await page.click('#dashboard-edit-toggle');
await page.waitForTimeout(150);

// ===== 0. 現状の再現: つまみ実寸・ドラッグ対象領域・HTML5 DnDがタッチで発火しないこと =====
const metrics = await page.evaluate(() => {
    const grip = document.querySelector('.widget-grip');
    const card = document.querySelector('.dashboard-widget');
    const g = grip.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    return {
        grip: { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.width), h: Math.round(g.height) },
        card: { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.width), h: Math.round(c.height) },
    };
});
console.log('metrics', JSON.stringify(metrics));

// dragstartが実際に発火するか計測用カウンタを仕込む
await page.evaluate(() => {
    window.__dragstartCount = 0;
    document.getElementById('dashboard-grid').addEventListener('dragstart', () => { window.__dragstartCount++; });
});
// タッチでの並べ替え試行(touchstart→touchmove→touchend)。HTML5 DnDはこれでは開始されない実装。
const cards = await page.$$('.dashboard-widget');
const box1 = await cards[0].boundingBox();
const box3 = await cards[2].boundingBox();
await page.touchscreen.tap(box1.x + box1.width / 2, box1.y + box1.height / 2);
await page.waitForTimeout(50);
// pointer経由でも長押し相当を試す(タッチのdispatchEvent)
await page.evaluate(({ x, y, tx, ty }) => {
    const el = document.elementFromPoint(x, y);
    const mk = (type, cx, cy) => new PointerEvent(type, { clientX: cx, clientY: cy, pointerType: 'touch', bubbles: true });
    el.dispatchEvent(mk('pointerdown', x, y));
    el.dispatchEvent(mk('pointermove', tx, ty));
    el.dispatchEvent(mk('pointerup', tx, ty));
}, { x: box1.x + box1.width / 2, y: box1.y + box1.height / 2, tx: box3.x + box3.width / 2, ty: box3.y + box3.height / 2 });
await page.waitForTimeout(100);
const afterOrder = await page.evaluate(() => Array.from(document.querySelectorAll('.dashboard-widget')).map(c => c.dataset.widgetId));
const dragstartCount = await page.evaluate(() => window.__dragstartCount);
console.log('order after touch attempt:', afterOrder.join(','), 'dragstartCount:', dragstartCount);

// つまみに赤枠・card検知矩形に青枠を重ねて実寸を視覚化
await page.evaluate(({ g, c }) => {
    const mark = (r, color, label) => {
        const d = document.createElement('div');
        d.className = 'mark-overlay-398';
        d.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border:2px solid ${color};z-index:99999;pointer-events:none;box-sizing:border-box;`;
        document.body.appendChild(d);
        const t = document.createElement('div');
        t.className = 'mark-overlay-398';
        t.textContent = label;
        t.style.cssText = `position:fixed;left:${r.x}px;top:${r.y + r.h + 2}px;color:${color};font:bold 11px sans-serif;z-index:99999;background:#fff;padding:1px 3px;`;
        document.body.appendChild(t);
    };
    mark(g, '#e11d48', `grip ${g.w}×${g.h}px`);
    mark(c, '#2563eb', `カード全体(ドラッグ開始域=スクロール域と同じ) ${c.w}×${c.h}px`);
}, { g: metrics.grip, c: metrics.card });
await page.screenshot({ path: `${OUT}/0-current-annotated.png` });

// ===== A. 案A: _bindPointerReorder に揃える(長押し・カード全体が対象・プラグイン一覧と同じ操作) =====
await page.evaluate(() => {
    document.querySelectorAll('.mark-overlay-398').forEach(el => el.remove());
    const card = document.querySelector('.dashboard-widget');
    card.classList.add('mock-pointer-press');
    const style = document.createElement('style');
    style.textContent = `.mock-pointer-press { transform: scale(1.03); box-shadow: 0 8px 24px rgba(0,0,0,.25) !important; opacity: .92; border-color: var(--accent) !important; }
        .mock-a-badge { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(61,82,255,.08); border-radius:9px; pointer-events:none; }
        .mock-a-badge span { background:#3d52ff; color:#fff; font-size:11px; font-weight:700; padding:3px 8px; border-radius:999px; }`;
    document.head.appendChild(style);
    const badge = document.createElement('div');
    badge.className = 'mock-a-badge';
    badge.innerHTML = '<span>長押し中…（カードのどこを押しても開始）</span>';
    card.style.position = 'relative';
    card.appendChild(badge);
});
await page.screenshot({ path: `${OUT}/A-pointerreorder.png` });

// ===== B. 案B: 上下移動ボタン =====
await page.evaluate(() => {
    document.querySelector('.mock-a-badge')?.remove();
    document.querySelector('.dashboard-widget')?.classList.remove('mock-pointer-press');
    document.querySelectorAll('.widget-header').forEach((h, i) => {
        const wrap = document.createElement('span');
        wrap.className = 'mock-b-updown';
        wrap.style.cssText = 'display:inline-flex;gap:2px;margin-left:auto;';
        wrap.innerHTML = `
            <button type="button" style="width:32px;height:32px;border:1px solid var(--line);border-radius:6px;background:var(--panel);display:flex;align-items:center;justify-content:center;">↑</button>
            <button type="button" style="width:32px;height:32px;border:1px solid var(--line);border-radius:6px;background:var(--panel);display:flex;align-items:center;justify-content:center;">↓</button>`;
        const actions = h.querySelector('.widget-actions');
        if (actions) actions.insertBefore(wrap, actions.firstChild); else h.appendChild(wrap);
    });
});
await page.screenshot({ path: `${OUT}/B-updown.png` });

// ===== C. 案C: 並べ替え専用シート(大きいつまみ) =====
await page.evaluate(() => {
    document.querySelectorAll('.mock-b-updown').forEach(el => el.remove());
    const names = { 'counter-total': '蔵書数', 'counter-shelves': '本棚数', 'recent-books': '最近追加した本', 'reading-stats': '読書統計' };
    const sheet = document.createElement('div');
    sheet.style.cssText = 'position:fixed;inset:0;background:var(--panel,#fff);z-index:99999;display:flex;flex-direction:column;';
    sheet.innerHTML = `
        <div style="display:flex;align-items:center;gap:.5rem;padding:1rem;border-bottom:1px solid var(--line);font-weight:700;">並べ替え<span style="margin-left:auto;color:var(--accent);font-weight:600;">完了</span></div>
        <div style="flex:1;overflow:auto;">
            ${Object.entries(names).map(([id, label]) => `
                <div style="display:flex;align-items:center;gap:.8rem;padding:.9rem 1rem;border-bottom:1px solid var(--line2);">
                    <span style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:22px;border-radius:8px;background:var(--surface-2,#f4f1f7);">⠿</span>
                    <span style="font-size:1rem;flex:1;">${label}</span>
                </div>`).join('')}
        </div>`;
    document.body.appendChild(sheet);
});
await page.screenshot({ path: `${OUT}/C-sheet.png` });

await browser.close();
console.log('DONE');
