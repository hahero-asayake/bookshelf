// イシュー#699: 本番の公開記事で、本の表紙と題名のリンクを押した時の動きを記録する (読むだけ・GET のみ)。
// - WebKit (iPhone 13 の UA・390×844・タッチ) と Chromium (PC 幅) の2通り。ヘッドレス・一時プロファイル。
// - リンクごとに href・解決後の URL・中心点の elementFromPoint がリンク自身かその子か、を記録する。
// - 記事ごとに最初の表紙と最初の題名を押し、新しいタブが開くか・開いたタブの URL と応答コードを記録する。
// - Amazon へは要求を出さない (自動操作で運営タグ付きの流入を作らないため)。新しいタブの最初の要求 (/go) を route で受け、
//   その先のリダイレクトは1つずつ読むだけにする (walkChain)。ブラウザに 302 をたどらせない: Playwright の route は
//   リダイレクトの先の要求には効かず (699-route-redirect-probe.mjs で実測)、たどらせると Amazon へ本当に届いてしまう。
//   このため、Amazon へ渡る Referer は本番では測れない (手元の実測は 699-referer-probe.mjs)。
// 使い方: node scripts/verify/699-prod-check.mjs <出力フォルダ> <ラベル (before / after)>
import { webkit, chromium, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || '/tmp/699';
const LABEL = process.argv[3] || 'before';
const ARTICLES = [
    'https://bookshelf.asayake.org/hahero/6h8aVAy0YP/',
    'https://bookshelf.asayake.org/hahero/OfGFUCJFVY/'
];
const TARGETS = [
    { name: 'webkit-iphone390', launcher: webkit, ctx: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }, touch: true },
    { name: 'chromium-pc', launcher: chromium, ctx: { viewport: { width: 1280, height: 800 } }, touch: false }
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// /go の先を1つずつ読む (リダイレクトを追わない)。要求を出すのは公開ページの配信元とハブだけで、
// Location が Amazon など外を指したら、そこで止める (要求しない)。
async function walkChain(context, startUrl) {
    const chain = [];
    let url = startUrl;
    for (let i = 0; i < 5; i++) {
        const host = new URL(url).hostname;
        if (host !== 'bookshelf.asayake.org' && host !== 'hub.asayake.org') break;
        const res = await context.request.get(url, { maxRedirects: 0, timeout: 20000 });
        const location = res.headers()['location'] || null;
        chain.push({ url, status: res.status(), location });
        if (res.status() < 300 || res.status() >= 400 || !location) break;
        url = new URL(location, url).href;
    }
    return chain;
}

fs.mkdirSync(OUT, { recursive: true });
const result = { label: LABEL, at: new Date().toISOString(), targets: [] };

for (const t of TARGETS) {
    const rec = { name: t.name, articles: [], amazonRequests: [], error: null };
    result.targets.push(rec);
    let browser = null;
    try {
        browser = await t.launcher.launch();
        rec.browserVersion = browser.version();
        const context = await browser.newContext(t.ctx);
        await context.route('https://www.amazon.co.jp/**', async (route) => {
            const req = route.request();
            rec.amazonRequests.push({ url: req.url(), referer: req.headers()['referer'] || null });
            await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>amazon stub (#699)</title><h1>amazon stub (#699)</h1>' });
        });
        // 新しいタブの最初の要求 (/go) はここで受ける。その先は walkChain が読み、開いたタブには読んだ結果を出す
        const goChains = [];
        await context.route('https://bookshelf.asayake.org/go/**', async (route) => {
            const chain = await walkChain(context, route.request().url());
            goChains.push(chain);
            const rows = chain.map(h => `<li>${h.status} ${esc(h.url)}${h.location ? ' → ' + esc(h.location) : ''}</li>`).join('');
            await route.fulfill({
                status: 200, contentType: 'text/html; charset=utf-8',
                body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>#699 の確認</title><h1>/go の行き先 (#699 の確認)</h1><p>Amazon へは要求していない。下は1つずつ読んだ応答。</p><ol>${rows}</ol>`
            });
        });
        const responses = [];
        context.on('response', (r) => {
            const u = r.url();
            if (/\/go\//.test(u) || u.includes('www.amazon.co.jp')) responses.push({ url: u, status: r.status(), location: r.headers()['location'] || null });
        });

        for (const url of ARTICLES) {
            const id = url.split('/').filter(Boolean).pop();
            const art = { url, status: null, links: [], taps: [] };
            rec.articles.push(art);
            const page = await context.newPage();
            const resp = await page.goto(url, { waitUntil: 'load', timeout: 20000 });
            art.status = resp ? resp.status() : null;
            art.links = await page.evaluate(() => {
                const pick = (sel, kind) => [...document.querySelectorAll(sel)].map((a) => {
                    a.scrollIntoView({ block: 'center' });
                    const r = a.getBoundingClientRect();
                    // 題名は2行に折り返すと外接矩形の中心が行の外 (親の p) に落ちるので、行ごとの矩形 (getClientRects) の
                    // 中心で見る。どの行の中心でも一番上がリンク自身かその子なら「上に別の要素は無い」。
                    const tops = [...a.getClientRects()].filter(q => q.width > 0 && q.height > 0)
                        .map(q => document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2));
                    const foreign = tops.filter(top => !top || !(top === a || a.contains(top)));
                    const top = foreign[0] || tops[0] || null;
                    return {
                        kind, hrefAttr: a.getAttribute('href'), resolved: a.href, target: a.target, rel: a.rel,
                        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
                        lines: tops.length,
                        topIsLinkOrChild: tops.length > 0 && foreign.length === 0,
                        topTag: top ? top.tagName.toLowerCase() + (top.className ? '.' + String(top.className).split(' ')[0] : '') : null
                    };
                });
                return [...pick('a.bk-cover-link', 'cover'), ...pick('.bk-title a', 'title')];
            });
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
            await page.screenshot({ path: path.join(OUT, `${LABEL}-${t.name}-${id}-article.png`) });

            for (const kind of ['cover', 'title']) {
                const loc = page.locator(kind === 'cover' ? 'a.bk-cover-link' : '.bk-title a').first();
                await loc.scrollIntoViewIfNeeded();
                const before = responses.length;
                const popupP = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
                if (t.touch) await loc.tap(); else await loc.click();
                const popup = await popupP;
                const tap = { kind, hrefAttr: await loc.getAttribute('href'), opened: !!popup };
                if (popup) {
                    await popup.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
                    tap.url = popup.url();
                    tap.title = await popup.title().catch(() => null);
                    tap.bodyText = (await popup.locator('body').innerText({ timeout: 3000 }).catch(() => '')).slice(0, 80);
                    await popup.screenshot({ path: path.join(OUT, `${LABEL}-${t.name}-${id}-${kind}-opened.png`) }).catch(() => {});
                    await popup.close();
                }
                tap.responses = responses.slice(before);
                tap.chain = goChains.shift() || null;
                tap.pageUrlAfter = page.url();
                art.taps.push(tap);
            }
            await page.close();
        }
        await context.close();
    } catch (e) {
        rec.error = String(e && e.message || e).slice(0, 300);
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

fs.writeFileSync(path.join(OUT, `${LABEL}-prod-check.json`), JSON.stringify(result, null, 2));
for (const t of result.targets) {
    console.log(`== ${t.name} ${t.browserVersion || ''} ${t.error ? 'ERROR ' + t.error : ''}`);
    for (const a of t.articles) {
        const cov = a.links.filter(l => l.kind === 'cover');
        const tit = a.links.filter(l => l.kind === 'title');
        const covered = a.links.filter(l => !l.topIsLinkOrChild);
        console.log(`  ${a.url} status=${a.status} cover=${cov.length} title=${tit.length} 上に別の要素があるリンク=${covered.length}`);
        const hrefs = [...new Set(a.links.map(l => `${l.hrefAttr} -> ${l.resolved} target=${l.target} rel=${l.rel}`))];
        for (const h of hrefs) console.log(`    link ${h}`);
        for (const tp of a.taps) {
            const chain = (tp.chain || []).map(h => `${h.status} ${h.url}${h.location ? ' → ' + h.location : ''}`).join(' ／ ');
            console.log(`    tap ${tp.kind}: opened=${tp.opened} url=${tp.url || '-'} /go の先=[${chain}]`);
        }
    }
    console.log(`  amazon への要求 (止めたもの): ${JSON.stringify(t.amazonRequests)}`);
}
