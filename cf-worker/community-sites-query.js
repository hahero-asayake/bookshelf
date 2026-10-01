// GET /community/sites (hub の JSON API・asayake-hub.js) と bookshelf.asayake.org/top (SSR HTML・
// bookshelf-cdn.js) が共有する、公開記事一覧のページング・タグ横断検索クエリ (S7・イシュー#269)。
// D1 (env.DB) にのみ依存し、レスポンス形式 (JSON/HTML) の組み立ては呼び出し側が行う。
//
// cursor方式: opaque な btoa(`${created_at}:${id}`) 文字列。並びは created_at DESC, id DESC (id は
// tie-break) で、status='active' AND hidden=0 の行に idx_sites_status_created を使う。
// sort=stars (スター数順) はスター集計が別表 (stats) にあり D1 側で同じ cursor が使えないため、
// このモジュールの対象外 (呼び出し側=asayake-hub.js が従来どおり全件取得+JSソートで扱う)。

export const COMMUNITY_PAGE_SIZE_DEFAULT = 24;
export const COMMUNITY_PAGE_SIZE_MAX = 50;

export function encodeSitesCursor(row) {
    return btoa(`${row.created_at}:${row.id}`);
}

export function decodeSitesCursor(s) {
    if (!s) return null;
    try {
        const raw = atob(String(s));
        const i = raw.lastIndexOf(':');
        if (i < 0) return null;
        const createdAt = Number(raw.slice(0, i));
        const id = raw.slice(i + 1);
        if (!Number.isFinite(createdAt) || !id) return null;
        return { createdAt, id };
    } catch (_) {
        return null;
    }
}

export function clampLimit(n) {
    const v = parseInt(n, 10);
    if (!Number.isFinite(v) || v <= 0) return COMMUNITY_PAGE_SIZE_DEFAULT;
    return Math.min(v, COMMUNITY_PAGE_SIZE_MAX);
}

// 公開中 (active・非hidden) の記事を created_at DESC, id DESC で1ページ分取得する。tag 指定時は
// site_tags と JOIN して絞り込む (hidden/quarantined は status!='active' または hidden=1 で既に除外)。
// 返り値: { rows, hasMore, limit }。rows は最大 limit 件、hasMore は次ページの有無。
export async function queryActiveSitesPage(env, { tag = '', cursor = null, limit } = {}) {
    const lim = clampLimit(limit);
    const cur = decodeSitesCursor(cursor);
    const t = String(tag || '').trim().slice(0, 50);
    let sql, binds;
    if (t) {
        sql = `SELECT s.id, s.uid, s.url, s.title, s.description, s.cover_url, s.tags, s.created_at, s.updated_at, s.published_at, s.modified_at
               FROM sites s JOIN site_tags st ON st.site_id = s.id
               WHERE s.status = 'active' AND s.hidden = 0 AND st.tag = ?1`;
        binds = [t];
        if (cur) {
            sql += ` AND (s.created_at < ?2 OR (s.created_at = ?2 AND s.id < ?3))`;
            binds.push(cur.createdAt, cur.id);
        }
        sql += ` ORDER BY s.created_at DESC, s.id DESC LIMIT ?${binds.length + 1}`;
        binds.push(lim + 1);
    } else {
        sql = `SELECT id, uid, url, title, description, cover_url, tags, created_at, updated_at, published_at, modified_at
               FROM sites WHERE status = 'active' AND hidden = 0`;
        binds = [];
        if (cur) {
            sql += ` AND (created_at < ?1 OR (created_at = ?1 AND id < ?2))`;
            binds.push(cur.createdAt, cur.id);
        }
        sql += ` ORDER BY created_at DESC, id DESC LIMIT ?${binds.length + 1}`;
        binds.push(lim + 1);
    }
    const rs = await env.DB.prepare(sql).bind(...binds).all();
    let rows = rs.results || [];
    const hasMore = rows.length > lim;
    rows = rows.slice(0, lim);
    return { rows, hasMore, limit: lim, tag: t };
}
