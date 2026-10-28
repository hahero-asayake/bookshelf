// bookshelf Service Worker
// 方針: ?v= 付き資産はキャッシュ優先 (URL がバージョンを持つ=不変)、それ以外はネットワーク優先。
//   - HTML は常に最新を取得 → 新しい ?v= 参照は即座に届き、資産はキャッシュから瞬時に出る
//   - 成功した同一オリジン GET は実行時キャッシュに保存 → オフラインでも前回取得分が動く
//   - CDN 等のクロスオリジンは原則素通し (SW は介在しない)。例外=表紙画像ホストのみ cache-first (下記)
//   - ナビゲーション時のオフラインは index.html にフォールバック

const CACHE = 'bookshelf-runtime-v3';

// ===== 表紙画像キャッシュ (イシュー#391) =====
// なぜ: ブラウザの HTTP キャッシュ任せだと iOS PWA (standalone) ではディスクキャッシュの保持期間・容量が
// 不安定で、毎回ネットワークへ取りに行っているように見える (ハヘロ報告)。表紙画像のホストだけ cache-first
// で明示的に保持する。
//
// 対象は Amazon (m.media-amazon.com 等) のみ。実測で Access-Control-Allow-Origin:* を返す (CORS許可) ため
// mode:'cors' で取得でき、レスポンスは非 opaque = Content-Length で実サイズが分かる。
//
// Google Books (books.google.com) は対象外 (ADR-138 を 2026-10-29 ②決裁で修正・(a)案採用)。実測で
// Access-Control-Allow-Origin ヘッダが無く (CORS 非許可)、SW で no-cors 保存すると opaque レスポンスになり
// 実サイズが分からない。iOS/Chrome はブラウザ内部のストレージ枠としては opaque を 1件あたり数MB (Chrome は
// 約7MB) で計上するため、自前の概算値 (例: 20KB) で 100MB まで許すつもりでも、実際のストレージ枠は数百件で
// 使い切り、他のデータ (localStorage・IndexedDB) ごと追い出される恐れがある。実データ (913冊) を調べたところ
// Google Books 由来の表紙は 0 件 (全て Amazon の kindle_import) で、対象外にしても実害が無い。
// Google Books は HTTP キャッシュ (実測 Cache-Control: private, max-age=86400=1日) に任せる。
const COVER_CACHE = 'bookshelf-covers-v1';
const COVER_HOSTS = ['m.media-amazon.com', 'images-na.ssl-images-amazon.com', 'images-amazon.com']; // Amazon のみ: CORS許可・実サイズ計上
// 容量上限 (②決裁 2026-10-29): 100MB・件数上限なし・LRU (最後に使われたものから残す)。
// ハヘロが別の値を求めたら、この定数だけ変える。
const COVER_CACHE_MAX_BYTES = 100 * 1024 * 1024;
// メタデータ (url→{size, lastAccess}) は Cache Storage 内の仮想 URL に JSON で保持する
// (IndexedDB を使わず Cache API だけで完結させるための型)。
const COVER_META_KEY = new Request('https://bookshelf-internal.invalid/__cover-cache-meta__');

async function _getCoverMeta(cache) {
    const res = await cache.match(COVER_META_KEY);
    if (!res) return {};
    try { return await res.json(); } catch (_) { return {}; }
}

async function _setCoverMeta(cache, meta) {
    await cache.put(COVER_META_KEY, new Response(JSON.stringify(meta)));
}

// 容量超過分を LRU (lastAccess が古い順) で削除する。respondWith の後に waitUntil で呼ぶ (応答を遅らせない)。
async function _evictCoverCacheIfNeeded(cache) {
    const meta = await _getCoverMeta(cache);
    let total = 0;
    for (const k in meta) total += meta[k].size || 0;
    if (total <= COVER_CACHE_MAX_BYTES) return;
    const entries = Object.entries(meta).sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    for (const [url, info] of entries) {
        if (total <= COVER_CACHE_MAX_BYTES) break;
        await cache.delete(url);
        delete meta[url];
        total -= info.size || 0;
    }
    await _setCoverMeta(cache, meta);
}

async function _handleCoverFetch(req) {
    const cache = await caches.open(COVER_CACHE);
    const hit = await cache.match(req);
    if (hit) {
        // ヒット時も lastAccess を更新 (LRU)。応答は先に返し、メタ更新は裏で行う。
        (async () => {
            const meta = await _getCoverMeta(cache);
            if (meta[req.url]) {
                meta[req.url].lastAccess = Date.now();
                await _setCoverMeta(cache, meta);
            }
        })();
        return hit;
    }
    // CORS 許可済みホストのみ対象 (COVER_HOSTS)。mode:'cors' で取得し非 opaque のまま扱う。
    const fresh = await fetch(req, { mode: 'cors' });
    if (fresh && fresh.status === 200) {
        const size = Number(fresh.headers.get('content-length')) || 0;
        await cache.put(req, fresh.clone());
        const meta = await _getCoverMeta(cache);
        meta[req.url] = { size, lastAccess: Date.now() };
        await _setCoverMeta(cache, meta);
        await _evictCoverCacheIfNeeded(cache);
    }
    return fresh;
}

self.addEventListener('install', () => {
    // skipWaiting は呼ばない。新 SW は待機させ、UI の「更新」ボタン (skipWaiting メッセージ) で適用する。
    // (初回インストール時は待機中の旧 SW が無いので、そのまま activate される)
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE && k !== COVER_CACHE).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); } catch (_) { return; }

    if (url.origin !== self.location.origin) {
        // クロスオリジンは原則介在しない。Amazon の表紙画像ホストのみ例外で cache-first (イシュー#391)。
        // Google Books は対象外 (CORS非許可・opaque容量問題のため。上記コメント参照)。
        if (!COVER_HOSTS.includes(url.hostname)) return;
        event.respondWith(_handleCoverFetch(req));
        return;
    }

    event.respondWith((async () => {
        // ?v= 付き資産 (js/css) はキャッシュ優先。バージョンは URL で変わるため安全で、
        // 毎回の全ダウンロードによる更新の遅さを無くす (2026-07-28 C-271)。
        // HTML (ナビゲーション) と ?v= 無しはネットワーク優先のまま = 新しい ?v= は即座に届く。
        if (url.searchParams.has('v')) {
            const hit = await caches.match(req, { ignoreSearch: false });
            if (hit) return hit;
        }
        try {
            const fresh = await fetch(req);
            if (fresh && fresh.status === 200 && fresh.type === 'basic') {
                const cache = await caches.open(CACHE);
                cache.put(req, fresh.clone());
            }
            return fresh;
        } catch (err) {
            const cached = await caches.match(req, { ignoreSearch: false });
            if (cached) return cached;
            // ?v= 付きで未キャッシュなら、クエリ無視で一致を試す
            const looseMatch = await caches.match(req, { ignoreSearch: true });
            if (looseMatch) return looseMatch;
            if (req.mode === 'navigate') {
                const fallback = (await caches.match('./index.html', { ignoreSearch: true }))
                    || (await caches.match('./', { ignoreSearch: true }));
                if (fallback) return fallback;
            }
            throw err;
        }
    })());
});
