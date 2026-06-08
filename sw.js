// bookshelf Service Worker
// 方針: ネットワーク優先 + キャッシュフォールバック (runtime cache)。
//   - オンライン時は常に最新を取得 → 開発中の ?v= キャッシュバストと衝突しない
//   - 成功した同一オリジン GET は実行時キャッシュに保存 → オフラインでも前回取得分が動く
//   - CDN 等のクロスオリジンは素通し (SW は介在しない)
//   - ナビゲーション時のオフラインは index.html にフォールバック

const CACHE = 'bookshelf-runtime-v1';

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
        await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); } catch (_) { return; }
    if (url.origin !== self.location.origin) return; // クロスオリジンは介在しない

    event.respondWith((async () => {
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
