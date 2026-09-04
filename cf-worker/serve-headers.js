// 公開配信の安全ヘッダ (script 無し CSP・nosniff・no-cookie)。
// hub Worker (旧 /public/<siteId>/) と bookshelf-cdn Worker (新 /<username>/<publicId>/) の
// 両方が同じ安全根拠 (09 §10.7 の4不変条件) で配信するため、実体をここに集約して共有する。
export function serveHeaders(ct, etag) {
    const h = {
        'Content-Type': ct,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'public, max-age=60'
    };
    if (etag) h['ETag'] = etag;
    return h;
}

export function contentType(path) {
    if (path.endsWith('.html')) return 'text/html; charset=utf-8';
    if (path.endsWith('.css')) return 'text/css; charset=utf-8';
    if (path.endsWith('.json')) return 'application/json; charset=utf-8';
    if (path.endsWith('.svg')) return 'image/svg+xml';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    return 'application/octet-stream';
}
