// イシュー#392 step1: ハブ経由起動時の取得本数・所要時間の基準値 (変更前)。
// storage.loadAll() (js/storage.js:278-304) が HubStorageAdapter.readJSON を直列 await する現状の実測。
//
// 前提: wrangler dev --local (cf-worker/wrangler.hub.toml) をポート8787で起動済み、
//       KV に key:<HK>→{uid,siteId,createdAt} / uid:<uid>→{...} をシード済み、
//       R2 (data/<uid>/private/...) に12本相当のダミーファイルを worker API 経由で投入済み。
//       静的ファイルは http://localhost:8000 で配信済み (python -m http.server 等)。
//
// 使い方: HK=hk_xxxx node scripts/verify/392-hub-load-measure.mjs [BASE] [--apibase=http://localhost:8787] [--rounds=5] [--out=scripts/verify/392-baseline-raw.json] [--label=step1-before]
//
// 計測方法: ネットワークレベル (Playwright Request.timing()) で `/data/` を含むリクエストの
// requestStart〜responseEnd を記録する。アプリ内部のインスツルメントではなくブラウザの生タイミング
// を見ることで、直列実行 (前の responseEnd 後に次の requestStart が来る) であることを機械的に確認できる。

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:8000';
const APIBASE = arg('apibase', 'http://localhost:8787');
const ROUNDS = parseInt(arg('rounds', '5'), 10);
const OUT = arg('out', 'scripts/verify/392-baseline-raw.json');
const LABEL = arg('label', 'before');
const HK = process.env.HK;
if (!HK) { console.error('HK env var required (wrangler dev local KV にシードした hk_... キー)'); process.exit(1); }

mkdirSync('scripts/verify', { recursive: true });

const browser = await chromium.launch();
const results = [];

for (let round = 1; round <= ROUNDS; round++) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
    await ctx.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && errors.length < 20) errors.push('console: ' + m.text().slice(0, 300)); });

    // private/ 配下 (loadAll + detectFormat の HEAD) のみを対象にする。
    // plugins/*/manifest.json 等 (プラグイン読込) や publish/articles.json (公開記事移行チェック) は
    // loadAll の対象外なので除外する (js/storage.js:278-304 参照)。
    const dataReqs = new Map();
    page.on('request', (req) => {
        const u = req.url();
        if (u.includes('/data/private/')) dataReqs.set(req, { url: u, method: req.method() });
    });
    page.on('requestfinished', async (req) => {
        const rec = dataReqs.get(req);
        if (!rec) return;
        try {
            rec.timing = req.timing();
            const res = await req.response();
            rec.status = res ? res.status() : null;
        } catch (_) { /* ignore */ }
    });

    await page.addInitScript(([apiBase, key]) => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'hub', hub: { apiBase, key } }));
    }, [APIBASE, HK]);

    const t0 = Date.now();
    let timedOut = false;
    try {
        await page.goto(`${BASE}/index.html?v=392measure-r${round}`);
        await page.waitForFunction(
            () => window.bookshelf && window.bookshelf.books && window.bookshelf.books.length > 0 && !window.bookshelf._syncChecking,
            null,
            { timeout: 30000 }
        );
    } catch (e) {
        timedOut = true;
        errors.push('waitForFunction timeout: ' + String(e).slice(0, 200));
    }
    await page.waitForTimeout(300); // 微小な後続GETの取り残しを拾う
    const totalMs = Date.now() - t0;

    // timing.startTime は UNIX epoch 絶対 ms。requestStart/responseEnd 等はそこからの相対 ms
    // (Playwright Request.timing() の仕様)。絶対時刻に直してから比較しないと全リクエストが
    // 見かけ上 startMs=0 近辺に揃ってしまい、直列判定ができない。
    const reqList = [...dataReqs.values()]
        .filter((r) => r.timing)
        .map((r) => ({
            path: r.url.replace(APIBASE, ''),
            method: r.method,
            status: r.status,
            absStart: r.timing.startTime + r.timing.requestStart,
            absEnd: r.timing.startTime + r.timing.responseEnd,
        }))
        .sort((a, b) => a.absStart - b.absStart);
    const t0abs = reqList.length ? reqList[0].absStart : 0;
    for (const r of reqList) {
        r.startMs = Math.round(r.absStart - t0abs);
        r.endMs = Math.round(r.absEnd - t0abs);
        delete r.absStart; delete r.absEnd;
    }

    // 直列判定: 各リクエストの開始が、直前リクエストの終了以降かどうか (重なり=並列)
    let serial = true;
    for (let i = 1; i < reqList.length; i++) {
        if (reqList[i].startMs < reqList[i - 1].endMs) { serial = false; break; }
    }

    results.push({ round, label: LABEL, timedOut, totalMs, getCount: reqList.length, serial, requests: reqList, errors });
    console.log(`round ${round}: getCount=${reqList.length} totalMs=${totalMs} serial=${serial} timedOut=${timedOut} errors=${errors.length}`);
    await ctx.close();
}

await browser.close();
writeFileSync(OUT, JSON.stringify({ label: LABEL, apibase: APIBASE, rounds: ROUNDS, measuredAt: new Date().toISOString(), results }, null, 2));
console.log(`wrote ${OUT}`);
