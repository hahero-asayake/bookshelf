// イシュー#699: bookshelf-cdn の /go の渡し方 (302 で hub へ送る / hub の応答を中継して返す) で、
// Amazon へ届く Referer とリダイレクトの回数がどう変わるかを、手元の3つのオリジンで実測する (外へは出ない)。
//   P = 公開ページの配信元 (bookshelf.asayake.org の役・127.0.0.1:8201)。本番と同じ Referrer-Policy: no-referrer で記事を返す
//   H = hub の役 (localhost:8202)。/go は 302・Referrer-Policy: strict-origin-when-cross-origin (handleGo と同じ)
//   A = Amazon の役 (127.0.0.1:8203)。届いた Referer を記録する
// 記事には3種類のリンクを置く:
//   chain  … P の /go-chain/… が 302 で H の /go/… へ送る (リダイレクト2回)
//   relay  … P の /go-relay/… が H の応答 (302・Location=A) をそのまま返す (リダイレクト1回)
//   direct … H の /go/… を直接指す (生成器が絶対URLで出す案の形・リダイレクト1回)
// 使い方: node scripts/verify/699-referer-probe.mjs
import http from 'node:http';
import { webkit, chromium, devices } from '@playwright/test';

const P = 'http://127.0.0.1:8201';
const H = 'http://localhost:8202';
const A = 'http://127.0.0.1:8203';
const GO_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
const seen = [];
const hits = []; // P の /go と H の /go に届いた要求 (リダイレクトの回数をサーバー側で数える)

const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>probe</title>
<style>a{display:block;padding:20px;font-size:20px}</style>
<p><a id="chain" href="/go-chain/site1/B000000001" target="_blank" rel="nofollow sponsored noopener">chain</a></p>
<p><a id="relay" href="/go-relay/site1/B000000001" target="_blank" rel="nofollow sponsored noopener">relay</a></p>
<p><a id="direct" href="${H}/go/site1/B000000001" target="_blank" rel="nofollow sponsored noopener">direct</a></p>`;

const servers = [
    http.createServer((req, res) => { // P
        if (req.url.startsWith('/go-')) hits.push('P');
        if (req.url.startsWith('/go-chain/')) {
            res.writeHead(302, { ...GO_HEADERS, Location: `${H}/go/${req.url.slice('/go-chain/'.length)}?via=chain` });
            return res.end();
        }
        if (req.url.startsWith('/go-relay/')) {
            res.writeHead(302, { ...GO_HEADERS, Location: `${A}/dp/B000000001?tag=probe-22&via=relay` });
            return res.end();
        }
        // 対照: /default/ は Referrer-Policy を付けない (ブラウザの既定)。Referer が届く形を測れているかの確認用
        const headers = { 'Content-Type': 'text/html; charset=utf-8' };
        if (!req.url.startsWith('/default/')) headers['Referrer-Policy'] = 'no-referrer';
        res.writeHead(200, headers);
        res.end(page);
    }).listen(8201, '127.0.0.1'),
    http.createServer((req, res) => { // H
        hits.push('H');
        const via = new URL(req.url, H).searchParams.get('via') || 'direct';
        res.writeHead(302, { ...GO_HEADERS, Location: `${A}/dp/B000000001?tag=probe-22&via=${via}` });
        res.end();
    }).listen(8202, 'localhost'),
    http.createServer((req, res) => { // A
        seen.push({ url: req.url, referer: req.headers.referer || null });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>amazon stub</title>ok');
    }).listen(8203, '127.0.0.1')
];

const TARGETS = [
    { name: 'webkit-iphone390', launcher: webkit, ctx: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }, touch: true },
    { name: 'chromium-pc', launcher: chromium, ctx: { viewport: { width: 1280, height: 800 } }, touch: false }
];

try {
    for (const t of TARGETS) {
        const browser = await t.launcher.launch();
        const context = await browser.newContext(t.ctx);
        const pg = await context.newPage();
        for (const [pagePath, pageLabel] of [['/hahero/x/', 'no-referrer(本番と同じ)'], ['/default/x/', '対照:指定なし']]) {
            await pg.goto(P + pagePath);
            for (const id of ['chain', 'relay', 'direct']) {
                const before = seen.length;
                const hitsBefore = hits.length;
                const popupP = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
                if (t.touch) await pg.locator('#' + id).tap(); else await pg.locator('#' + id).click();
                const popup = await popupP;
                if (popup) { await popup.waitForLoadState('load', { timeout: 8000 }).catch(() => {}); }
                const got = seen.slice(before);
                // リダイレクトの回数はサーバー側 (P と H に届いた要求) で数える。WebKit は新しいタブの最初の応答を
                // Playwright の response イベントに出さないことがあり、ブラウザ側で数えると1回少なく出た
                const chain = hits.slice(hitsBefore);
                console.log(`${t.name} ページ=${pageLabel} ${id}: 着いた先=${popup ? new URL(popup.url()).origin : '-'} リダイレクト=${chain.length}回 [${chain.join('→')}→A] Amazon役へ届いた Referer=${JSON.stringify(got.map(g => g.referer))}`);
                if (popup) await popup.close();
            }
        }
        await browser.close();
    }
} finally {
    for (const s of servers) s.close();
}
