// E2E・visual がブラウザから外 (localhost 以外) へ出した要求を、要求単位で記録する計測の道具 (イシュー#637)。
// 既定の実行には一切影響しない＝NODE_OPTIONS で明示的に読み込み、EXTREQ_DIR を付けた時だけ動く。
//
// 使い方 (例: chromium のレグ):
//   EXTREQ_DIR=_local/extreq EXTREQ_RUN=chromium NODE_OPTIONS=--require=./scripts/verify/external-requests-hook.cjs \
//     E2E_SKIP_KNOWN_RED=1 npx playwright test --project=chromium --grep-invert "sort-perf-budget"
//   node scripts/verify/external-requests-report.mjs _local/extreq chromium   ← ホスト別・spec 別の表
//
// 仕組み: BrowserType.launch → Browser.newContext を包み、全 context (fixture の context と、spec が
// browser.newContext() で作る context の両方) に request/response/requestfailed の記録を付ける。
// response.serverAddr() が null なら route で返した (外へ出ていない)、値があれば実通信。
// fixture の中に置く計測では、fixture を通らない context の漏れ (#637 の53件) が見えないため、この形にしている。
// SW が自分で出す要求は context の request に出ない (playwright.config.js は serviceWorkers:'block')。
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const DIR = process.env.EXTREQ_DIR;
if (DIR) {
    const ROOT = process.cwd();
    fs.mkdirSync(path.resolve(ROOT, DIR), { recursive: true });
    const OUT = path.resolve(ROOT, DIR, 'req-' + (process.env.EXTREQ_RUN || 'run') + '-' + process.pid + '.jsonl');
    const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
    const rq = createRequire(path.join(ROOT, 'package.json'));
    const write = (o) => { try { fs.appendFileSync(OUT, JSON.stringify(o) + '\n'); } catch (_) { /* 記録の失敗は無視 */ } };
    const testTag = () => {
        try {
            const ti = rq('@playwright/test').test.info();
            return { file: path.relative(ROOT, ti.file), title: ti.titlePath.slice(1).join(' > '), project: ti.project.name };
        } catch (_) {
            return { file: null, title: null, project: null };
        }
    };
    const ext = (url) => {
        try {
            const u = new URL(url);
            return /^https?:$/.test(u.protocol) && !LOCAL.has(u.hostname) ? u.hostname : null;
        } catch (_) { return null; }
    };
    const attach = (context) => {
        if (context.__extreq) return;
        context.__extreq = true;
        const tag = testTag();
        context.on('request', (r) => {
            const host = ext(r.url());
            if (host) write({ ev: 'request', t: Date.now(), ...tag, host, url: r.url().slice(0, 300), type: r.resourceType() });
        });
        context.on('response', async (res) => {
            const host = ext(res.url());
            if (!host) return;
            let addr = null;
            try { addr = await res.serverAddr(); } catch (_) { /* 取れない時は null */ }
            write({ ev: 'response', t: Date.now(), ...tag, host, url: res.url().slice(0, 300), type: res.request().resourceType(), status: res.status(), serverAddr: addr ? addr.ipAddress + ':' + addr.port : null });
        });
        context.on('requestfailed', (r) => {
            const host = ext(r.url());
            if (host) write({ ev: 'failed', t: Date.now(), ...tag, host, url: r.url().slice(0, 300), type: r.resourceType(), error: (r.failure() || {}).errorText || null });
        });
    };
    try {
        const BT = Object.getPrototypeOf(rq('playwright-core').chromium);
        const origLaunch = BT.launch;
        BT.launch = async function (...args) {
            const browser = await origLaunch.apply(this, args);
            const BP = Object.getPrototypeOf(browser);
            if (!BP.__extreq) {
                BP.__extreq = true;
                const orig = BP.newContext;
                BP.newContext = async function (...a) {
                    const ctx = await orig.apply(this, a);
                    attach(ctx);
                    return ctx;
                };
            }
            return browser;
        };
        write({ ev: 'hook', t: Date.now(), pid: process.pid, ok: true });
    } catch (e) {
        write({ ev: 'hook', t: Date.now(), pid: process.pid, ok: false, error: String(e) });
    }
}
