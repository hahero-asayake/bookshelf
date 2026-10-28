// イシュー#391 step4: 表紙画像(Amazon)のSWキャッシュ前後比較計測ハーネス。
// 389-scroll-perf.mjs の fixture セットアップ型を流用。SW は allow (389 は block だった点が異なる)。
// 測る値: 本棚一覧表示後の Amazon画像ネットワークリクエスト数 (1回目ロード/2回目ロード以降)。
//
// 実行例:
//   node scripts/verify/391-cover-cache-perf.mjs --mode=after  http://localhost:8000   (修正後・現在のsw.js)
//   node scripts/verify/391-cover-cache-perf.mjs --mode=before http://localhost:8391   (修正前・旧sw.js配信)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const MODE = arg('mode', 'after');
const BOOKS = parseInt(arg('books', '30'), 10); // 1画面に収まる程度の冊数(表紙リクエスト数を見やすくする)
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:8000';

const fixtureUserData = JSON.parse(readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8'));
const books = Array.from({ length: BOOKS }, (_, i) => {
    const n = i + 1; const asin = `B${String(n).padStart(9, '0')}`;
    return { asin, title: `計測用の本 ${n}`, authors: `著者${n}`, acquiredTime: 1700000000000 + n * 1000, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + n * 1000 };
});
const userData = JSON.parse(JSON.stringify(fixtureUserData));
const allShelf = userData.bookshelves.find((s) => s.isSpecial); allShelf.books = books.map((b) => b.asin);
userData.notes = {};
userData.settings = { ...(userData.settings || {}), coverSize: 'medium', defaultView: 'covers' };
const libraryStr = JSON.stringify({ books, metadata: { totalBooks: books.length } });
const userDataStr = JSON.stringify(userData);

const DUMMY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAKAAAADwCAIAAAAII/iNAAACPElEQVR4nO3RQQkAMAzAwPrX0/e0TcUYhIMTEMjsHsLmewFPGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncJzBcQbHGRxncNwFOJ5W30KHEhcAAAAASUVORK5CYII=', 'base64');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'allow' });

let amazonReqCount = 0;
await ctx.route('https://images-na.ssl-images-amazon.com/images/P/**', async (r) => {
    amazonReqCount++;
    await r.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }, body: DUMMY_PNG });
});
await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));

const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));

await page.addInitScript(([u, l]) => {
    localStorage.setItem('virtualBookshelf_userData', u);
    localStorage.setItem('virtualBookshelf_library', l);
    localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
}, [userDataStr, libraryStr]);

async function openAndSettle() {
    const t0 = Date.now();
    await page.goto(BASE + '/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0);
    const bootMs = Date.now() - t0;
    await page.evaluate(() => {
        const bs = window.bookshelf; const mem = new Map();
        const a = bs.storage.adapter;
        a.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        a.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        bs._isSyncReady = () => true;
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
    });
    await page.evaluate(() => { window.bookshelf.setCoverSize('medium'); window.bookshelf.setView('covers'); window.bookshelf.switchBookshelf('all'); });
    // 画像(lazy解除後)の読み込み安定を待つ
    await page.waitForTimeout(1500);
    return bootMs;
}

// 1回目: SW未登録状態での初回ロード (#265 の挙動どおり、初回は SW が controller になっていない=キャッシュ不使用のはず)
amazonReqCount = 0;
const boot1 = await openAndSettle();
const count1 = amazonReqCount;

// SW が実際に activate し controller になるまで待つ (#221 の型: reload を跨ぐ前に register 完了を待つ)
let swOk = true;
await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 15000 }).catch(() => { swOk = false; });
const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { hasController: !!navigator.serviceWorker.controller, active: reg && reg.active ? reg.active.state : null, waiting: !!(reg && reg.waiting) };
});
process.stderr.write(`[sw-wait] ok=${swOk} controller=${swState.hasController} active=${swState.active} waiting=${swState.waiting}\n`);

// 2回目: reload (SW 許可下・#221 prepare()+自前 goto の型)
amazonReqCount = 0;
const boot2 = await openAndSettle();
const count2 = amazonReqCount;

// 3回目: さらに reload (継続してキャッシュが効くか確認)
amazonReqCount = 0;
const boot3 = await openAndSettle();
const count3 = amazonReqCount;

console.log(`### 391-cover-cache-perf (${MODE}) — books=${BOOKS}`);
console.log(`pageerror: ${errors.length}`);
console.log(`| 回 | 起動→表示 ms | Amazon画像リクエスト数 |`);
console.log(`|---|---:|---:|`);
console.log(`| 1回目(初回) | ${boot1} | ${count1} |`);
console.log(`| 2回目(reload) | ${boot2} | ${count2} |`);
console.log(`| 3回目(reload) | ${boot3} | ${count3} |`);
if (errors.length) console.log('\npageerror:\n' + errors.slice(0, 5).join('\n'));

await browser.close();
