// イシュー#392 step6: 変更後(R+PAR実装後)の実測。step1(392-hub-load-measure.mjs)と同じ測り方
// (ネットワークレベル・絶対時刻化・直列/並列判定)で、3条件×5回を測る:
//   initial: localStorage(VersionCacheキャッシュ含む)を毎回クリアした「初回起動」
//   same:    1回ウォームアップしてキャッシュを作った後、同じページを reload する「変更なし再起動」
//   changed: ウォームアップ後、毎ラウンド前にサーバ側の1ファイル(private/library.json)だけを
//            worker API 経由で書き換えてから reload する「1本だけ変更」
//
// 使い方: HK=hk_xxxx node scripts/verify/392-after-measure.mjs [BASE] --apibase=... --rounds=5 --out=...
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:8000';
const APIBASE = arg('apibase', 'http://localhost:8787');
const ROUNDS = parseInt(arg('rounds', '5'), 10);
const OUT = arg('out', 'scripts/verify/392-after-raw.json');
const HK = process.env.HK;
if (!HK) { console.error('HK env var required'); process.exit(1); }

async function measureOnce(page, dataReqsRef) {
    dataReqsRef.map.clear();
    const t0 = Date.now();
    let timedOut = false;
    const errors = [];
    try {
        await page.waitForFunction(
            () => window.bookshelf && window.bookshelf.books && window.bookshelf.books.length > 0 && !window.bookshelf._syncChecking,
            null,
            { timeout: 30000 }
        );
    } catch (e) { timedOut = true; errors.push('timeout: ' + String(e).slice(0, 150)); }
    await page.waitForTimeout(300);
    const totalMs = Date.now() - t0;
    const reqList = [...dataReqsRef.map.values()]
        .filter((r) => r.timing)
        .map((r) => ({ path: r.url.replace(APIBASE, ''), method: r.method, status: r.status, absStart: r.timing.startTime + r.timing.requestStart, absEnd: r.timing.startTime + r.timing.responseEnd }))
        .sort((a, b) => a.absStart - b.absStart);
    const t0abs = reqList.length ? reqList[0].absStart : 0;
    for (const r of reqList) { r.startMs = Math.round(r.absStart - t0abs); r.endMs = Math.round(r.absEnd - t0abs); delete r.absStart; delete r.absEnd; }
    const bodyGets = reqList.filter((r) => r.method === 'GET' && !r.path.includes('?list=1'));
    const listCalls = reqList.filter((r) => r.path.includes('?list=1'));
    let serial = true;
    for (let i = 1; i < reqList.length; i++) { if (reqList[i].startMs < reqList[i - 1].endMs) { serial = false; break; } }
    return { totalMs, timedOut, errors, requests: reqList, bodyGetCount: bodyGets.length, listCallCount: listCalls.length, serial };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: 'block' });
await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
const page = await ctx.newPage();
page.on('pageerror', () => {});
const dataReqsRef = { map: new Map() };
page.on('request', (req) => { const u = req.url(); if (u.includes('/data/private')) dataReqsRef.map.set(req, { url: u, method: req.method() }); });
page.on('requestfinished', async (req) => {
    const rec = dataReqsRef.map.get(req);
    if (!rec) return;
    try { rec.timing = req.timing(); const res = await req.response(); rec.status = res ? res.status() : null; } catch (_) {}
});
await page.addInitScript(([apiBase, key]) => {
    localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'hub', hub: { apiBase, key } }));
}, [APIBASE, HK]);

const results = { same: [], changed: [] };
// initial(初回起動)は392-hub-load-measure.mjs(step1と全く同じスクリプト・毎ラウンド新規context)
// で別途5回測定済み(392-after-initial-raw.json)。このスクリプトは same/changed のみを担当する。

// --- same: 一度ウォームアップ(キャッシュ作成)してから reload を5回測る ---
await page.goto(`${BASE}/index.html?v=392after-same-warmup`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.bookshelf && window.bookshelf.books && window.bookshelf.books.length > 0 && !window.bookshelf._syncChecking, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(300);
for (let i = 1; i <= ROUNDS; i++) {
    await page.reload();
    const r = await measureOnce(page, dataReqsRef);
    results.same.push(r);
    console.log(`same round ${i}: bodyGET=${r.bodyGetCount} list=${r.listCallCount} totalMs=${r.totalMs} serial=${r.serial}`);
}

// --- changed: 毎ラウンド前に private/library.json を1本だけ書き換えてから reload ---
for (let i = 1; i <= ROUNDS; i++) {
    const putRes = await fetch(`${APIBASE}/data/private/library.json`, {
        method: 'PUT', headers: { Authorization: `Bearer ${HK}` },
        body: JSON.stringify({ books: [{ asin: `CHANGED${i}`, title: `changed-round-${i}` }], metadata: { totalBooks: 1 } }),
    });
    if (!putRes.ok) console.error(`changed round ${i}: PUT失敗 status=${putRes.status}`);
    await page.reload();
    const r = await measureOnce(page, dataReqsRef);
    results.changed.push(r);
    console.log(`changed round ${i}: bodyGET=${r.bodyGetCount} list=${r.listCallCount} totalMs=${r.totalMs} serial=${r.serial}`);
}

await browser.close();
writeFileSync(OUT, JSON.stringify({ apibase: APIBASE, rounds: ROUNDS, measuredAt: new Date().toISOString(), results }, null, 2));
console.log(`wrote ${OUT}`);
