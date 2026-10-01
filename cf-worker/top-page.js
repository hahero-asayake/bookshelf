// /top (全ユーザー横断の公開記事一覧) の SSR HTML。bookshelf-cdn.js から呼ばれる (S7・イシュー#269)。
// community-sites-query.js の cursor ページング・タグ横断検索をそのまま使う (hub の GET /community/sites
// と同じクエリロジック)。D1 は bookshelf-cdn.js 側にも read-only で bind する (wrangler.bookshelf.toml)。
// status='active' AND hidden=0 のみを対象にするため、通報で隠した記事 (hidden/quarantined) は出ない。

import { queryActiveSitesPage, encodeSitesCursor } from './community-sites-query.js';

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cardHtml(s) {
    const title = escapeHtml(s.title);
    const desc = String(s.description || '').trim();
    const tags = s.tags ? String(s.tags).split(',').filter(Boolean) : [];
    const tagLinks = tags.map((t) => `<a class="tag" href="/top?tag=${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`).join(' ');
    const cover = s.cover_url ? `<img class="cover" src="${escapeHtml(s.cover_url)}" alt="" loading="lazy">` : '';
    return `<li class="card">
  ${cover}
  <h2><a href="${escapeHtml(s.url)}">${title}</a></h2>
  ${desc ? `<p class="desc">${escapeHtml(desc)}</p>` : ''}
  ${tagLinks ? `<p class="tags">${tagLinks}</p>` : ''}
</li>`;
}

// GET /top・/top?tag=<tag>・/top?cursor=<opaque>。env.DB 未設定 (ローカル検証・移行直後) でも
// 真っ白な500にせず、0件のページとして返す。
export async function renderTopPage(env, url) {
    const tag = (url.searchParams.get('tag') || '').trim().slice(0, 50);
    const cursor = url.searchParams.get('cursor');
    let rows = [], hasMore = false;
    if (env.DB && typeof env.DB.prepare === 'function') {
        const page = await queryActiveSitesPage(env, { tag, cursor, limit: url.searchParams.get('limit') });
        rows = page.rows;
        hasMore = page.hasMore;
    }
    const nextCursor = hasMore && rows.length ? encodeSitesCursor(rows[rows.length - 1]) : null;
    const heading = tag ? `「#${escapeHtml(tag)}」の記事` : '公開された記事';
    const items = rows.map(cardHtml).join('\n');
    const tagQS = tag ? `tag=${encodeURIComponent(tag)}&` : '';
    const nextLink = nextCursor
        ? `<a class="next" href="/top?${tagQS}cursor=${encodeURIComponent(nextCursor)}">次へ →</a>`
        : '';
    const clearTag = tag ? `<a class="clear-tag" href="/top">すべての記事に戻る</a>` : '';
    const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading} | bookshelf.asayake.org</title>
<meta name="description" content="AsayakeBookshelf で公開された本棚記事の一覧です。">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px 14px 40px; font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif; background: #f6f6f8; color: #1a1a1a; font-size: 16px; line-height: 1.7; }
  h1 { font-size: 20px; margin: 0 0 14px; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .card { background: #fff; border: 1px solid #e3e3e6; border-radius: 10px; padding: 14px; }
  .card .cover { width: 100%; max-height: 160px; object-fit: cover; border-radius: 6px; margin-bottom: 8px; }
  .card h2 { font-size: 17px; margin: 0 0 6px; }
  .card h2 a { color: #1a1a1a; text-decoration: none; }
  .card h2 a:hover { text-decoration: underline; }
  .desc { font-size: 14px; color: #444; margin: 0 0 8px; }
  .tags { margin: 0; font-size: 13px; }
  .tag { color: #3d52ff; text-decoration: none; margin-right: 8px; }
  .tag:hover { text-decoration: underline; }
  .empty { background: #fff; border-radius: 10px; padding: 24px; text-align: center; color: #666; }
  .pager { display: flex; justify-content: center; margin-top: 20px; }
  .next { display: inline-block; padding: 10px 18px; background: #3d52ff; color: #fff; border-radius: 8px; text-decoration: none; font-size: 15px; }
  .clear-tag { display: inline-block; margin-bottom: 14px; font-size: 14px; color: #3d52ff; }
</style>
</head>
<body>
<h1>${heading}</h1>
${clearTag}
${rows.length ? `<ul class="list">\n${items}\n</ul>` : `<div class="empty">まだ公開された記事がありません。</div>`}
<div class="pager">${nextLink}</div>
</body>
</html>`;
    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=30' }
    });
}
