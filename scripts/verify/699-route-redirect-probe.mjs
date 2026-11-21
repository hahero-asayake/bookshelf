// イシュー#699: Playwright の route (通信の模擬) が、リダイレクトの先の要求にも効くかを手元で確かめる (外へは出ない)。
// 門のE2E の模擬 (/go の 302 を2回たどる) と、本番の確認で Amazon への要求を止められるかの前提になる。
//   P = 公開ページの役 (実サーバーなし・route だけで答える)
//   H = hub の役 (localhost:8202・実サーバーあり = route が効かなければここへ届く)
//   A = Amazon の役 (127.0.0.1:8203・実サーバーあり = route が効かなければここへ届く)
// 場面1: P の /go は route が 302 を返す → H も A も route を掛けてある。実サーバーへ届いた数が 0 なら route が効いている。
// 場面2: H の /go は実サーバーが 302 を返す (本番の確認と同じ形) → A にだけ route。A の実サーバーへ届いた数を見る。
// 使い方: node scripts/verify/699-route-redirect-probe.mjs
import http from 'node:http';
import { webkit, chromium, devices } from '@playwright/test';

const P = 'http://127.0.0.1:8201';
const H = 'http://localhost:8202';
const A = 'http://127.0.0.1:8203';
const real = [];
const servers = [
    http.createServer((req, res) => { real.push('H'); res.writeHead(302, { Location: `${A}/dp/B000000001?via=realH` }); res.end(); }).listen(8202, 'localhost'),
    http.createServer((req, res) => { real.push('A'); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>real A</title>real A'); }).listen(8203, '127.0.0.1')
];
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>a{display:block;padding:20px;font-size:20px}</style>
<a id="mock" href="/go/site1/B000000001" target="_blank" rel="noopener">mock chain</a>
<a id="realhub" href="${H}/go/site1/B000000001" target="_blank" rel="noopener">real hub</a>`;

const TARGETS = [
    { name: 'webkit-iphone390', launcher: webkit, ctx: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }, touch: true },
    { name: 'chromium-pc', launcher: chromium, ctx: { viewport: { width: 1280, height: 800 } }, touch: false }
];

try {
    for (const t of TARGETS) {
        const browser = await t.launcher.launch();
        for (const scene of ['mock', 'realhub']) {
            const context = await browser.newContext(t.ctx);
            const routed = [];
            // route.fulfill は WebKit では 3xx を返せない ("Cannot fulfill with redirect status: 302" で落ち、その route は
            // 使い切りになる = 落ちた後に別の応答も返せない)。同じ行き先へすぐ移るページ (meta refresh) で代える
            // = 門のE2E の模擬 (tests/e2e/helpers/gate-hub.js) と同じやり方
            const redirect = (route, label, location) => {
                routed.push(label + '(meta refresh)');
                return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta http-equiv="refresh" content="0;url=${location}">` });
            };
            await context.route(`${P}/**`, (route) => {
                const u = new URL(route.request().url());
                if (u.pathname.startsWith('/go/')) return redirect(route, 'P/go', `${H}${u.pathname}`);
                return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
            });
            if (scene === 'mock') await context.route(`${H}/**`, (route) => redirect(route, 'H', `${A}/dp/B000000001?via=routeH`));
            await context.route(`${A}/**`, (route) => { routed.push('A'); return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub A</title>stub A' }); });
            const pg = await context.newPage();
            await pg.goto(P + '/');
            const before = real.length;
            const popupP = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
            if (t.touch) await pg.locator('#' + scene).tap(); else await pg.locator('#' + scene).click();
            const popup = await popupP;
            // meta refresh は最初の読み込みの後に移るので、Amazon 役の URL になるまで待つ
            if (popup) await popup.waitForURL((u) => u.href.startsWith(A), { timeout: 8000 }).catch(() => {});
            const title = popup ? await popup.title().catch(() => '?') : '-';
            console.log(`${t.name} 場面=${scene}: 着いた先=${popup ? popup.url() : '-'} 題=${title} route が呼ばれた=[${routed.join(',')}] 実サーバーへ届いた=[${real.slice(before).join(',')}]`);
            await context.close();
        }
        await browser.close();
    }
} finally {
    for (const s of servers) s.close();
}
