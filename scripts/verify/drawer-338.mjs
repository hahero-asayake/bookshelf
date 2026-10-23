// イシュー#338: UX-5(#59)「900px以下で引き出しがモーダル異常膨張」が #165 のボトムシート化で
// 解消したかを実データ相当(既定800冊)で再測定する。DOM クリックだけで記事エディタ→本の引き出しを開き、
// .modal-content / .art-side / #art-drawer-list の scrollHeight と画面スクロール量を実測する。
//
// fixture 注入は tests/e2e/publish-article-editor.spec.js の buildManyBooksFixtures/bootAppWithManyBooks と
// 同じ方式 (userData の "all" 特殊本棚 books 配列 + library 両方に注入。_artRenderDrawer は shelf.books を
// 直接参照するため library だけでは反映されない、イシュー#59 実測の教訓)。
//
// 実行例:
//   node scripts/verify/drawer-338.mjs [BASE=http://localhost:8731/] [chromium|webkit|both] [count=800]
// webkit 実行には別途 PLAYWRIGHT_BROWSERS_PATH / LD_LIBRARY_PATH が要る (イシュー#330 の型、呼び出し側シェルで設定)。
import { chromium, webkit } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveShotDir } from './verify-common.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');

const BASE = (process.argv[2] || 'http://localhost:8731/').replace(/\/?$/, '/');
const ENGINE_ARG = process.argv[3] || 'both';
const COUNT = Number(process.argv[4] || 800);
const CASE_TIMEOUT_MS = 5 * 60 * 1000; // ステップ規約: 1回の実行は最大5分

const SHOT_DIR = join(resolveShotDir(), '338');
mkdirSync(SHOT_DIR, { recursive: true });

const WIDTHS = [
    { w: 390, h: 844 },
    { w: 768, h: 1024 },
    { w: 900, h: 1000 },
];

const fixtureUserData = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/fixture-userdata.json'), 'utf-8'));
const fixtureLibrary = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/fixture-library.json'), 'utf-8'));

// tests/e2e/publish-article-editor.spec.js: buildManyBooksFixtures と同じ方式
function buildManyBooksFixtures(count) {
    const userData = JSON.parse(JSON.stringify(fixtureUserData));
    const library = JSON.parse(JSON.stringify(fixtureLibrary));
    const books = [];
    const asins = [];
    for (let i = 1; i <= count; i++) {
        const asin = `B${String(i).padStart(9, '0')}`;
        asins.push(asin);
        books.push({
            asin, title: `ダミー本 ${i} 〜長めのタイトルで折返しも確認する用〜`, authors: `著者${i % 37}`,
            acquiredTime: 1700000000000 + i * 1000, readStatus: 'READ',
            productImage: '', source: 'fixture', addedDate: 1700000000000 + i * 1000
        });
    }
    library.books = books;
    library.metadata = { ...library.metadata, totalBooks: books.length };
    const allShelf = userData.bookshelves.find(s => s.isSpecial);
    allShelf.books = asins;
    return { userData: JSON.stringify(userData), library: JSON.stringify(library) };
}

async function runCase(launcher, engineName, width) {
    const { w, h } = width;
    const browser = await launcher.launch();
    try {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } });
        const page = await ctx.newPage();
        const consoleErrors = [];
        page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));

        const { userData, library } = buildManyBooksFixtures(COUNT);
        await ctx.addInitScript(([u, l]) => {
            localStorage.setItem('virtualBookshelf_userData', u);
            localStorage.setItem('virtualBookshelf_library', l);
            localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        }, [userData, library]);

        await page.goto(BASE + 'index.html', { waitUntil: 'load', timeout: 20000 });
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData, null, { timeout: 15000 });
        await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
        await page.evaluate(() => { if (window.HubAuth) window.HubAuth.renderSignInButton = () => {}; });
        await page.evaluate(() => {
            const mem = new Map();
            const adapter = window.bookshelf.storage.adapter;
            adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
            adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
            window.bookshelf._isSyncReady = () => true;
        });

        // --- DOM クリックで記事エディタを開く ---
        // 768px以下はサイドバーがドロワー化 (イシュー#166既知)。先に下部ナビ「本棚」でドロワーを開く。
        if (w <= 768) {
            await page.click('[data-mobile-nav="shelves"]', { timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(300);
        }
        await page.click('#sidebar-publish', { timeout: 15000 });
        await page.click('#art-new', { timeout: 15000 });
        await page.locator('#art-edit-view').waitFor({ state: 'visible', timeout: 10000 });

        // 編集状態へ (新規作成直後は編集状態のはずだが念のため)
        const editBtn = page.locator('#art-mode-edit');
        if (await editBtn.isVisible().catch(() => false)) await editBtn.click();

        // 本ブロックを1つ追加 (キャンバス iframe 内の＋→本)
        const canvas = page.frameLocator('#art-canvas-frame');
        const insBtns = canvas.locator('.art-cv-ins-btn');
        await insBtns.last().click({ timeout: 10000 });
        await page.click('#art-add-sheet [data-block-type="book"]', { timeout: 10000 });
        await page.locator('#art-edit-view').waitFor({ state: 'attached' });
        await page.waitForFunction(() => document.getElementById('art-edit-view')?.dataset.artMode === 'form', null, { timeout: 10000 });

        // --- 閉じた状態 (ドロワー未オープン) の .modal-content.scrollHeight を先に取る ---
        const closedMetrics = await page.evaluate(() => {
            const modal = document.querySelector('#publish-pages-modal .modal-content');
            const se = document.scrollingElement;
            return {
                modalScrollH: modal ? modal.scrollHeight : null,
                modalClientH: modal ? modal.clientHeight : null,
                scrollGap: se.scrollHeight - window.innerHeight,
                scrollY: window.scrollY,
            };
        });

        // --- 本の引き出しを開く (.art-book-pick → _artRenderDrawer + _artOpenSheet。
        //     本ブロック(asin無し)の「本を選ぶ」入口。.art-shelf-add は本棚ブロック用で今回は使わない) ---
        await page.click('.art-book-pick', { timeout: 10000 });
        // 800件のDOM描画完了を待つ (件数が安定するまで・最大10秒)
        await page.waitForFunction((want) => {
            const list = document.getElementById('art-drawer-list');
            return list && list.querySelectorAll('.art-drawer-item').length >= want;
        }, Math.min(COUNT, 800), { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(400); // レイアウト安定待ち (transition含む)

        const openMetrics = await page.evaluate(() => {
            const modal = document.querySelector('#publish-pages-modal .modal-content');
            const side = document.getElementById('art-drawer');
            const list = document.getElementById('art-drawer-list');
            const se = document.scrollingElement;
            const sideStyle = side ? getComputedStyle(side) : null;
            const rect = side ? side.getBoundingClientRect() : null;
            return {
                modalScrollH: modal ? modal.scrollHeight : null,
                modalClientH: modal ? modal.clientHeight : null,
                sideScrollH: side ? side.scrollHeight : null,
                sideClientH: side ? side.clientHeight : null,
                sidePosition: sideStyle ? sideStyle.position : null,
                sideOverflowY: sideStyle ? sideStyle.overflowY : null,
                sideBottom: rect ? Math.round(rect.bottom) : null,
                sideIsOpen: side ? side.classList.contains('is-open') : null,
                listScrollH: list ? list.scrollHeight : null,
                itemCount: list ? list.querySelectorAll('.art-drawer-item').length : 0,
                scrollGap: se.scrollHeight - window.innerHeight,
                scrollY: window.scrollY,
                innerHeight: window.innerHeight,
            };
        });

        const shotPath = join(SHOT_DIR, `${engineName}-${w}.png`);
        await page.screenshot({ path: shotPath, fullPage: false });

        await browser.close();
        return {
            engine: engineName, width: w, height: h, ok: true,
            closed: closedMetrics, open: openMetrics,
            screenshot: shotPath, consoleErrors,
        };
    } catch (err) {
        await browser.close().catch(() => {});
        return { engine: engineName, width: w, height: h, ok: false, error: String(err).slice(0, 500) };
    }
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: `timeout (${ms}ms) at ${label}`, timedOut: true }), ms)),
    ]);
}

const engines = [];
if (ENGINE_ARG === 'both' || ENGINE_ARG === 'chromium') engines.push({ name: 'chromium', launcher: chromium });
if (ENGINE_ARG === 'both' || ENGINE_ARG === 'webkit') engines.push({ name: 'webkit', launcher: webkit });

const results = [];
for (const eng of engines) {
    for (const width of WIDTHS) {
        const label = `${eng.name}-${width.w}`;
        console.log(`== 実行中: ${label} (count=${COUNT})`);
        const res = await withTimeout(runCase(eng.launcher, eng.name, width), CASE_TIMEOUT_MS, label);
        if (res.timedOut) console.log(`== timeout: ${label}`);
        else console.log(`== 完了: ${label} ok=${res.ok}`);
        results.push(res);
    }
}

// chromium/webkit を別プロセスで(環境変数が競合するため)それぞれ実行するので、
// 既存の result.json があれば今回実行したエンジン以外の行を残してマージする。
const resultJsonPath = join(SHOT_DIR, 'result.json');
let merged = results;
try {
    const prior = JSON.parse(readFileSync(resultJsonPath, 'utf-8'));
    const ranEngines = new Set(results.map(r => r.engine));
    merged = [...prior.filter(r => !ranEngines.has(r.engine)), ...results];
} catch (_) { /* 初回実行は prior なし */ }
writeFileSync(resultJsonPath, JSON.stringify(merged, null, 2));

// --- 表形式 .md ---
const lines = [];
lines.push('# イシュー#338 実測結果 (drawer-338.mjs)');
lines.push('');
lines.push(`BASE=${BASE} count=${COUNT}冊`);
lines.push('');
lines.push('| engine | width | ok | modal閉scrollH | modal開scrollH | 差 | scrollGap閉 | scrollGap開 | 増分 | art-side bottom | innerHeight | position | overflowY | drawer件数 | listScrollH |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of merged) {
    if (!r.ok) {
        lines.push(`| ${r.engine} | ${r.width} | NG | - | - | - | - | - | - | - | - | - | - | - | - (${r.error || ''}) |`);
        continue;
    }
    const c = r.closed, o = r.open;
    const diff = (o.modalScrollH ?? 0) - (c.modalScrollH ?? 0);
    const gapDiff = (o.scrollGap ?? 0) - (c.scrollGap ?? 0);
    lines.push(`| ${r.engine} | ${r.width} | OK | ${c.modalScrollH} | ${o.modalScrollH} | ${diff} | ${c.scrollGap} | ${o.scrollGap} | ${gapDiff} | ${o.sideBottom} | ${o.innerHeight} | ${o.sidePosition} | ${o.sideOverflowY} | ${o.itemCount} | ${o.listScrollH} |`);
}
lines.push('');
lines.push('判定基準 (②承認2026-10-24): 全ケースで 差≤200px かつ 増分≤1px かつ art-side bottom≤innerHeight+1 を満たせば「解消」。1件でも不満なら「一部再現」。');
writeFileSync(join(SHOT_DIR, 'result.md'), lines.join('\n'));

console.log('== 結果出力:', join(SHOT_DIR, 'result.json'), join(SHOT_DIR, 'result.md'));
