// /top (全ユーザー横断の公開記事一覧) の SSR HTML。bookshelf-cdn.js から呼ばれる (S7・イシュー#269)。
// community-sites-query.js の cursor ページング・タグ横断検索をそのまま使う (hub の GET /community/sites
// と同じクエリロジック)。D1 は bookshelf-cdn.js 側にも read-only で bind する (wrangler.bookshelf.toml)。
// status='active' AND hidden=0 のみを対象にするため、通報で隠した記事 (hidden/quarantined) は出ない。

import { queryActiveSitesPage, encodeSitesCursor } from './community-sites-query.js';
import { OPERATOR_EMAIL } from './suspended-page.js';

// 全ページ共通のブランドOGP画像 (T11・イシュー#335決裁B案)。GitHub Pages配信の
// js/publish-article-generator.js `SHARED_OG_IMAGE` と同一アセット・同一URLを指す
// (cf-worker からは別ファイルのため定数を共有できず、ここは値を直書きで同期する)。
// ?v= は画像を差し替えるたびに上げる (2026-10-24: キャッチ文言・バッジを外しロゴのみに変更)。
const OG_IMAGE_URL = 'https://asayake.org/bookshelf/icons/og-image.png?v=2026102402';

// 仮の説明文 (T11・イシュー#335・2026-10-24 ②判断)。ハヘロ決裁「共有画像のデザインは概ね良いが文言に
// 課題あり。コンセプトを明確にして宣伝用記事作成などをしながら文言を固める」を受け、固まるまでは
// 宣伝調を避け機能だけを並べた仮の文言に統一する。js/publish-article-generator.js の
// PublishArticleGenerator.PROVISIONAL_DESCRIPTION と同文＝差し替え時は両方を直す。
const PROVISIONAL_DESCRIPTION = 'Kindle の蔵書を本棚ごとに整理し、メモや評価を付けて、読書記録を公開できるアプリ。';

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
    const description = tag
        ? `「#${tag}」タグの公開記事一覧です。`
        : PROVISIONAL_DESCRIPTION;
    const canonical = `${url.origin}/top${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`;
    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: heading,
        description,
        url: canonical,
        mainEntity: {
            '@type': 'ItemList',
            itemListElement: rows.map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: s.url, name: s.title }))
        }
    };
    const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading} | bookshelf.asayake.org</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(heading)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AsayakeBookshelf">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${OG_IMAGE_URL}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="AsayakeBookshelf">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(heading)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${OG_IMAGE_URL}">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
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
  .site-footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e3e3e6; font-size: 13px; color: #666; }
  .site-footer a { color: #3d52ff; }
</style>
</head>
<body>
<h1>${heading}</h1>
${clearTag}
${rows.length ? `<ul class="list">\n${items}\n</ul>` : `<div class="empty">まだ公開された記事がありません。</div>`}
<div class="pager">${nextLink}</div>
<footer class="site-footer">お問い合わせ: <a href="mailto:${OPERATOR_EMAIL}">${OPERATOR_EMAIL}</a></footer>
</body>
</html>`;
    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=30' }
    });
}
