// bookshelf.asayake.org 配信専用 Worker (S6・ADR-076・設計書 09 §11.7「Worker 構成」)
// ======================================================================================
// hub.asayake.org (認証・課金・私的同期) とは別 Worker に分離する。理由:
//   - 配信ロジック (pathname→R2 lookup→返す、認証なし) と hub の複雑な API を混在させない
//   - KV/R2 は read-only の最小権限で bind する (plan:/stripe:/管理者権限などは持たせない)
//   - デプロイの独立性 (配信ロジックの変更が hub API の再デプロイを要求しない)
//
//   GET https://bookshelf.asayake.org/<username>/<publicId>/  → KV uname:<username> で siteId 解決
//                                                                 → R2 sites/<siteId>/<publicId>/index.html
//   GET https://bookshelf.asayake.org/<username>/              → R2 sites/<siteId>/index.html (プロフィール/一覧)
//
// env バインディング (wrangler.bookshelf.toml, read-only 運用):
//   BUCKET   R2 bucket (asayake-hub と同一。sites/ のみ参照)
//   KV       KV namespace (asayake-hub と同一。uname:/uid:/site:/report: のみ参照、書込は行わない)
//
// 予約語・除外パスは reserved-usernames.js を hub 側 (POST /username) と共有する。

import { serveHeaders, contentType } from './serve-headers.js';
import { isReservedTopLevel } from './reserved-usernames.js';

export default {
    async fetch(request, env, ctx) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('method not allowed', { status: 405 });
        }
        const url = new URL(request.url);
        const pathname = url.pathname;

        const rest = decodeURIComponent(pathname.slice(1)); // 先頭の '/' を落とす
        const slash = rest.indexOf('/');
        const username = slash < 0 ? rest : rest.slice(0, slash);
        let sub = slash < 0 ? '' : rest.slice(slash + 1);

        if (!username) return new Response('Not found', { status: 404, headers: serveHeaders('text/plain') });
        if (isReservedTopLevel(username)) {
            // ①②いずれの予約語も、S6 時点では専用ページを持たない (/top・/about 等は別イシュー・S7 以降)
            return new Response('Not found', { status: 404, headers: serveHeaders('text/plain') });
        }
        if (username.split('/').some(s => s === '..') || sub.split('/').some(s => s === '..')) {
            return new Response('bad path', { status: 400 });
        }

        const cache = caches.default;
        const cacheKey = new Request(url.origin + pathname, { method: 'GET' });
        const cached = await cache.match(cacheKey);
        if (cached) {
            return request.method === 'HEAD'
                ? new Response(null, { status: cached.status, headers: cached.headers })
                : cached;
        }

        const rec = await env.KV.get(`uname:${username}`, 'json');
        if (!rec) return new Response('Not found', { status: 404, headers: serveHeaders('text/plain') });

        // 改名: 旧 username へのアクセスは新 username へ 301 (解放しない・なりすまし防止, 09 §10.3-v2)
        if (rec.movedTo) {
            return new Response(null, {
                status: 301,
                headers: { 'Location': `https://bookshelf.asayake.org/${rec.movedTo}/${sub}`, 'Cache-Control': 'no-store' }
            });
        }

        const siteId = rec.siteId;
        if (!siteId) return new Response('Not found', { status: 404, headers: serveHeaders('text/plain') });

        const reportRec = await env.KV.get(`report:${siteId}`, 'json');
        if (reportRec && reportRec.status === 'suspended') {
            return new Response('This site has been suspended.', { status: 451 });
        }

        if (sub === '' || sub.endsWith('/')) sub += 'index.html';
        const obj = await env.BUCKET.get(`sites/${siteId}/${sub}`);
        if (!obj) return new Response('Not found', { status: 404, headers: serveHeaders('text/plain') });

        const res = new Response(obj.body, { headers: serveHeaders(contentType(sub), obj.httpEtag) });
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
    }
};
