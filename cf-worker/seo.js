// robots.txt / sitemap.xml 生成 (bookshelf-cdn.js 用・イシュー#247 決裁4)。
// ユーザーページの掲載対象は KV `uname:<username>` を列挙して決める (username→siteId 解決に既に
// 使っている索引をそのまま使い回す。新しい索引は増やさない)。件数上限は KV.list() の1呼び出し上限
// (1000件) をそのまま採用する(ローンチ前の登録者数はこれで十分足りる規模。超えたらページング対応が要る)。
// /top (S7・イシュー#269で追加) は常設の公開ページなので無条件で載せる (D1 問い合わせ不要)。

export function buildRobotsTxt(origin) {
    return `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
}

// 1件のuname:レコードを、Sitemapに載せてよいか判定する。
// 除外: 退会(tombstone)・改名済み(movedTo、新username側だけ載せる)・停止(report:suspended)・
//       siteId未設定・R2にindex.htmlが無い(=公開記事が1件も無い「非公開」相当、ADR-104前提の
//       article.published単位の公開判定と整合: 何も公開していなければsites/配下に何も出力されない)。
async function isSitemapEligible(env, rec) {
    if (!rec || rec.tombstone || rec.movedTo || !rec.siteId) return false;
    const reportRec = await env.KV.get(`report:${rec.siteId}`, 'json');
    if (reportRec && reportRec.status === 'suspended') return false;
    const obj = await env.BUCKET.head(`sites/${rec.siteId}/index.html`);
    if (!obj) return false;
    return true;
}

export async function buildSitemapXml(env, origin) {
    const list = await env.KV.list({ prefix: 'uname:', limit: 1000 });
    const urls = [`${origin}/top`];
    for (const key of list.keys) {
        const username = key.name.slice('uname:'.length);
        const rec = await env.KV.get(key.name, 'json');
        if (await isSitemapEligible(env, rec)) {
            urls.push(`${origin}/${encodeURIComponent(username)}/`);
        }
    }
    const items = urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}
