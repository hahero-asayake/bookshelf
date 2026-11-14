// イシュー#649 step1: ツリーで本棚をドラッグして落とした後に click が出て、掴んだ本棚の一覧が開くか
// (ホームを離れるか) を、場面ごとに記録する。アプリは変えない。
//   - window の capture で pointerdown・pointerup・mouseup・click を記録する (種類・一番近い .tree-node・isConnected・isTrusted・時刻)
//   - bookshelf.switchBookshelf を包んで呼び出しを記録する (記録してから元を呼ぶ)
//   - saveUserData だけ何もしない関数に差し替える (tests/e2e/book-detail-shelf-meta.spec.js と同じ作法)
// 使い方: node scripts/verify/649-click-probe.mjs [chromium|webkit|all] [出力JSONのパス]
//   PORT (既定 8149) で python3 -m http.server を自分で起こし、終わったら止める。
import { chromium, webkit } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8149);
const BASE = `http://localhost:${PORT}`;
const which = process.argv[2] || 'all';
const outPath = process.argv[3] || null;

const fixtureUserData = readFileSync(join(root, 'tests/fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(root, 'tests/fixtures/fixture-library.json'), 'utf-8');
const ASIN = 'B000000001';

// all と p649 を展開した時のツリーの並び: all / fixshelf / p649 / c649 (p649 の子) / s649a / s649b / s649c
const SHELVES = [
    { id: 'p649', internalId: 'p649iid01', name: '親P', parent: 'fixall001', books: [ASIN] },
    { id: 'c649', internalId: 'c649iid01', name: '子C', parent: 'p649iid01', books: [ASIN] },
    { id: 's649a', internalId: 's649aiid01', name: '兄弟A', parent: 'fixall001', books: [ASIN] },
    { id: 's649b', internalId: 's649biid01', name: '兄弟B', parent: 'fixall001', books: [ASIN] },
    { id: 's649c', internalId: 's649ciid01', name: '兄弟C', parent: 'fixall001', books: [ASIN] },
];

const treeNode = (page, slug) => page.locator(`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="${slug}"]`);

async function boot(page) {
    await page.goto(`${BASE}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => {
        const app = window.bookshelf;
        app.saveUserData = async () => {};
        window.__sw = [];
        const orig = app.switchBookshelf.bind(app);
        app.switchBookshelf = (id) => { window.__sw.push({ id, t: Math.round(performance.now()) }); return orig(id); };
    });
    // 展開の印 (localStorage) が効いていなければ、spec の expandTree と同じく押して開く
    for (const key of ['all', 'p649']) {
        const toggle = treeNode(page, key).locator('.tree-toggle');
        await toggle.waitFor({ state: 'visible', timeout: 10000 });
        if (await toggle.getAttribute('title') === '展開') await toggle.click();
    }
    await treeNode(page, 's649c').waitFor({ state: 'visible', timeout: 10000 });
    await treeNode(page, 'c649').waitFor({ state: 'visible', timeout: 10000 });
}

const state = (page, slug) => page.evaluate((s) => {
    const bs = window.bookshelf.userData.bookshelves.find((b) => b.id === s);
    return {
        home: document.body.classList.contains('app-view-main'),
        hash: location.hash,
        current: window.bookshelf.currentBookshelf || null,
        parent: bs ? (bs.parent || null) : null,
        order: window.bookshelf.userData.bookshelves.filter((b) => !b.isSpecial).map((b) => b.id).join(','),
        cfm: !!document.querySelector('.cfm-overlay .cfm-ok'),
        toast: Array.from(document.querySelectorAll('.toast')).map((x) => x.textContent.trim()).slice(-2),
    };
}, slug);

// tests/e2e/shelf-structure-home-refresh.spec.js L100-110 (#623 (j) と同じ手順) そのまま
async function mouseDrag(page, fromBox, toPoint) {
    const x0 = fromBox.x + fromBox.width / 2, y0 = fromBox.y + fromBox.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0, y0 + 5, { steps: 3 });
    await page.mouse.move(toPoint.x, toPoint.y, { steps: 5 });
    await page.waitForTimeout(100);
    await page.mouse.move(toPoint.x, toPoint.y);
    await page.waitForTimeout(80);
    await page.mouse.up();
}

// 遠くへ運ぶ時の形: 元の行の中で横へ 10px 動かしてドラッグを始めてから運ぶ (#638 の落とし穴を避ける)。esc なら離す前に Esc
async function mouseDragFar(page, fromBox, toPoint, { esc = false } = {}) {
    const x0 = fromBox.x + fromBox.width / 2, y0 = fromBox.y + fromBox.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 10, y0, { steps: 4 });
    await page.mouse.move(toPoint.x, toPoint.y, { steps: 5 });
    await page.waitForTimeout(100);
    await page.mouse.move(toPoint.x, toPoint.y);
    await page.waitForTimeout(80);
    const dragging = await page.evaluate(() => !!document.querySelector('.tree-node.tree-dragging'));
    if (esc) { await page.keyboard.press('Escape'); await page.waitForTimeout(50); }
    await page.mouse.up();
    return dragging;
}

const box = async (page, slug) => treeNode(page, slug).boundingBox();
const at = (b, ratio) => ({ x: b.x + b.width / 2, y: b.y + b.height * ratio });

// 場面: { key, label, slug (見る本棚), run(page) }
const CASES = [
    { key: 'a', label: '真ん中へ落とす (s649b → s649c の子・確認あり)', slug: 's649b',
        run: async (page) => mouseDrag(page, await box(page, 's649b'), at(await box(page, 's649c'), 0.5)) },
    { key: 'b1', label: '同じ親の上の端 (s649b → s649a の前・確認なし)', slug: 's649b',
        run: async (page) => mouseDrag(page, await box(page, 's649b'), at(await box(page, 's649a'), 0.15)) },
    { key: 'b2', label: '同じ親の下の端 (s649b → s649c の後ろ・確認なし)', slug: 's649b',
        run: async (page) => mouseDrag(page, await box(page, 's649b'), at(await box(page, 's649c'), 0.85)) },
    { key: 'c', label: '別の親の本棚の下の端 (s649a → c649 の後ろ＝p649 の子・確認あり)', slug: 's649a',
        run: async (page) => mouseDrag(page, await box(page, 's649a'), at(await box(page, 'c649'), 0.85)) },
    { key: 'd', label: 'ツリーの外 (メインの領域) へ落とす (onDrop は呼ばれない)', slug: 's649b',
        run: async (page) => mouseDragFar(page, await box(page, 's649b'), { x: 800, y: 450 }) },
    { key: 'e', label: 'ドラッグ中に Esc で取り消してから離す (s649b を s649c の真ん中の上で)', slug: 's649b',
        run: async (page) => mouseDragFar(page, await box(page, 's649b'), at(await box(page, 's649c'), 0.5), { esc: true }) },
    { key: 'f', label: '親を自分の子の真ん中へ (p649 → c649・循環の toast)', slug: 'p649',
        run: async (page) => mouseDrag(page, await box(page, 'p649'), at(await box(page, 'c649'), 0.5)) },
    { key: 'g', label: '対照1: dispatchEvent で合成した pointer イベントだけで (a) と同じ所へ運ぶ', slug: 's649b',
        run: async (page) => page.evaluate(() => {
            const q = (s) => document.querySelector(`#sidebar-bookshelf-tree .tree-node[data-bookshelf-id="${s}"]`);
            const from = q('s649b'), to = q('s649c');
            const fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect();
            const x0 = fr.left + fr.width / 2, y0 = fr.top + fr.height / 2;
            const x1 = tr.left + tr.width / 2, y1 = tr.top + tr.height / 2;
            const opt = (x, y, buttons) => ({ bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: x, clientY: y });
            from.dispatchEvent(new PointerEvent('pointerdown', opt(x0, y0, 1)));
            from.dispatchEvent(new PointerEvent('pointermove', opt(x0 + 10, y0, 1)));
            document.dispatchEvent(new PointerEvent('pointermove', opt(x1, y1, 1)));
            to.dispatchEvent(new PointerEvent('pointerup', opt(x1, y1, 0)));
        }) },
    { key: 'h', label: '対照2: 普通のクリック (s649a の行)', slug: 's649a',
        run: async (page) => treeNode(page, 's649a').click() },
    { key: 'i', label: '対照3: setPointerCapture を何もしない関数にして (a) と同じ操作', slug: 's649b',
        pre: async (page) => page.evaluate(() => { Element.prototype.setPointerCapture = function () {}; }),
        run: async (page) => mouseDrag(page, await box(page, 's649b'), at(await box(page, 's649c'), 0.5)) },
];

async function runCase(browserType, c) {
    const browser = await browserType.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // 外への通信は全部空で返す (tests/e2e/helpers/test-base.js と同じく abort しない)
    await ctx.route((url) => !url.href.startsWith(BASE), (route) => {
        const u = route.request().url();
        const ct = u.endsWith('.svg') || u.includes('lucide') ? 'image/svg+xml' : (u.endsWith('.js') || u.includes('googlesyndication') ? 'application/javascript' : 'text/plain');
        return route.fulfill({ status: 200, contentType: ct, body: ct === 'image/svg+xml' ? '<svg xmlns="http://www.w3.org/2000/svg"></svg>' : '' });
    });
    await ctx.addInitScript(([userData, library, shelves]) => {
        const ud = JSON.parse(userData);
        for (const s of shelves) ud.bookshelves.push({ iconName: 'library', isSpecial: false, ...s });
        localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        localStorage.setItem('bookshelf_treeExpanded_v1', JSON.stringify(['fixall001', 'p649iid01']));
        window.__ev = [];
        const rec = (e) => {
            const t = e.target;
            const node = t && t.closest ? t.closest('.tree-node') : null;
            window.__ev.push({
                type: e.type, node: node ? node.dataset.bookshelfId : null,
                tag: t && t.nodeName, id: (t && t.id) || '', connected: !!(t && t.isConnected), trusted: e.isTrusted,
                t: Math.round(performance.now()),
            });
        };
        for (const ty of ['pointerdown', 'pointerup', 'mouseup', 'click']) window.addEventListener(ty, rec, true);
    }, [fixtureUserData, fixtureLibrary, SHELVES]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    const res = { browser: browserType.name(), key: c.key, label: c.label, slug: c.slug };
    try {
        await boot(page);
        if (c.pre) await c.pre(page);
        res.before = await state(page, c.slug);
        await page.evaluate(() => { window.__ev.length = 0; window.__sw.length = 0; });
        const r = await c.run(page);
        if (typeof r === 'boolean') res.dragStarted = r;
        await page.waitForTimeout(400);
        // 確認の OK を押す前に、ドロップで起きた分だけを取る (OK の click を混ぜない)
        res.events = await page.evaluate(() => window.__ev.slice());
        res.switchCalls = await page.evaluate(() => window.__sw.slice());
        res.afterDrop = await state(page, c.slug);
        if (res.afterDrop.cfm) {
            await page.locator('.cfm-overlay .cfm-ok').click();
            await page.waitForTimeout(400);
            res.confirmed = true;
        }
        res.after = await state(page, c.slug);
        res.switchCallsAll = await page.evaluate(() => window.__sw.slice());
    } catch (e) {
        res.error = String(e).slice(0, 300);
    }
    res.pageErrors = errors;
    await browser.close();
    return res;
}

function summarize(r) {
    const clicks = (r.events || []).filter((e) => e.type === 'click');
    const ups = (r.events || []).filter((e) => e.type === 'mouseup');
    const fmt = (e) => `${e.node || e.tag + (e.id ? '#' + e.id : '')}${e.connected ? '' : '(外れ)'}`;
    return [
        `[${r.browser}] (${r.key}) ${r.label}`,
        r.error ? `  ERROR ${r.error}` : null,
        `  events: ${(r.events || []).map((e) => `${e.type}@${fmt(e)}${e.trusted ? '' : '[合成]'}`).join(' → ') || '(なし)'}`,
        `  mouseup=${ups.map(fmt).join(',') || '-'} click=${clicks.map(fmt).join(',') || '(出ない)'} switchBookshelf=${(r.switchCalls || []).map((s) => s.id).join(',') || '(呼ばれない)'}${r.dragStarted === false ? ' dragStarted=false' : ''}`,
        `  before: home=${r.before?.home} parent=${r.before?.parent} | 落とした直後: home=${r.afterDrop?.home} current=${r.afterDrop?.current} hash=${r.afterDrop?.hash} 確認=${r.afterDrop?.cfm} toast=${JSON.stringify(r.afterDrop?.toast || [])}`,
        `  確認の後: home=${r.after?.home} current=${r.after?.current} hash=${r.after?.hash} parent=${r.after?.parent} switch(全体)=${(r.switchCallsAll || []).map((s) => s.id).join(',') || '-'}`,
        `  並び: ${r.before?.order} → ${r.after?.order}${r.before?.order === r.after?.order ? ' (変わらない)' : ''}`,
        r.pageErrors?.length ? `  pageerror: ${r.pageErrors.join(' | ')}` : null,
    ].filter(Boolean).join('\n');
}

async function waitServer() {
    for (let i = 0; i < 50; i++) {
        try { const r = await fetch(`${BASE}/index.html`); if (r.ok) return true; } catch (_) {}
        await new Promise((r) => setTimeout(r, 200));
    }
    return false;
}

let server = null;
try {
    if (!(await waitServerQuick())) {
        server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: root, stdio: 'ignore' });
        if (!(await waitServer())) throw new Error(`server on ${PORT} did not start`);
    }
    const types = which === 'all' ? [chromium, webkit] : [which === 'webkit' ? webkit : chromium];
    const all = [];
    for (const bt of types) {
        for (const c of CASES) {
            const r = await runCase(bt, c);
            console.log(summarize(r));
            all.push(r);
        }
    }
    if (outPath) writeFileSync(outPath, JSON.stringify(all, null, 1));
} finally {
    if (server) server.kill();
}

async function waitServerQuick() {
    try { const r = await fetch(`${BASE}/index.html`); return r.ok; } catch (_) { return false; }
}
