// イシュー#699 step4: deploy の前と後で、本番の公開ページの応答コード・Location・ETag を読むだけで並べる。
// リダイレクトは追わない (Amazon へは要求を出さない)。Location の tag= の値は伏せる。
// /go は bookshelf.asayake.org → hub.asayake.org の順にたどり、Amazon を指した所で止める。
// 使い方: node scripts/verify/699-prod-codes.mjs <出力の JSON (前後で別名)>
import { writeFileSync } from 'node:fs';

const SITE = '31b0fe39-a3f1-475e-85ab-eee336368355';
const B = 'https://bookshelf.asayake.org';
const H = 'https://hub.asayake.org';
const URLS = [
    `${B}/hahero/6h8aVAy0YP/`, `${B}/hahero/OfGFUCJFVY/`, `${B}/hahero/`, `${B}/hahero/6h8aVAy0YP/og.png`,
    `${B}/top`, `${B}/report?target=${encodeURIComponent(`${B}/hahero/6h8aVAy0YP/`)}`, `${B}/report.js`,
    `${B}/robots.txt`, `${B}/sitemap.xml`, `${B}/nobody-zz699/`, `${B}/about/`,
    `${B}/go/${SITE}/B087JKL1JH`, `${B}/go/${SITE}/B0BNTNRDV7`, `${B}/go/${SITE}/short`, `${B}/go/`, `${B}/go/${SITE}/B087JKL1JH/extra`,
    `${H}/go/${SITE}/B087JKL1JH`, `${H}/public/${SITE}/`
];
const mask = (s) => (s || '').replace(/(tag=)[^&\s]+/, '$1…');

async function head(url) {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'Cache-Control': 'no-cache' } });
    return { url, status: r.status, location: mask(r.headers.get('location')), etag: r.headers.get('etag') || '', cache: r.headers.get('cache-control') || '', referrerPolicy: r.headers.get('referrer-policy') || '' };
}

const rows = [];
for (const u of URLS) {
    try { rows.push(await head(u)); } catch (e) { rows.push({ url: u, status: 'error', error: String(e.message || e).slice(0, 80) }); }
}
// /go のたどり (bookshelf と hub だけに要求を出す)
const chains = [];
for (const asin of ['B087JKL1JH', 'B0BNTNRDV7', 'B0BCTY484X', 'B0C6WXSVYQ']) {
    let url = `${B}/go/${SITE}/${asin}`;
    const chain = [];
    for (let i = 0; i < 4; i++) {
        const host = new URL(url).hostname;
        if (host !== 'bookshelf.asayake.org' && host !== 'hub.asayake.org') { chain.push(`止める: ${mask(url)}`); break; }
        const r = await head(url);
        chain.push(`${r.status} ${url.replace(SITE, '<site>')}`);
        if (typeof r.status !== 'number' || r.status < 300 || r.status >= 400) break;
        url = new URL(r.location.replace('tag=…', 'tag=x'), url).href;
    }
    chains.push({ asin, chain });
}
writeFileSync(process.argv[2] || '/tmp/699-codes.json', JSON.stringify({ at: new Date().toISOString(), rows, chains }, null, 2));
for (const r of rows) console.log(`${r.status}\t${r.url.replace(SITE, '<site>')}${r.location ? '\t→ ' + r.location.replace(SITE, '<site>') : ''}${r.etag ? '\tETag ' + r.etag : ''}`);
for (const c of chains) console.log(`chain ${c.asin}: ${c.chain.join(' ／ ')}`);
