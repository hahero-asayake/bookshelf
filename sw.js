// bookshelf Service Worker
// 方針: ?v= 付き資産はキャッシュ優先 (URL がバージョンを持つ=不変)、それ以外はネットワーク優先。
//   - install で殻 (index.html と、そこから参照される同一オリジンの script/css/manifest/アイコン) を先読みする
//     → 1回開いただけの端末でも電波なしで起動できる (イシュー#597・一覧は index.html から作る。下記)
//   - HTML は常に最新を取得 → 新しい ?v= 参照は即座に届き、資産はキャッシュから瞬時に出る
//   - 成功した同一オリジン GET は実行時キャッシュに保存 → オフラインでも前回取得分が動く
//   - CDN 等のクロスオリジンは原則素通し (SW は介在しない)。例外=表紙画像ホストのみ cache-first (下記)
//   - ナビゲーション時のオフラインは index.html にフォールバック
//   - 世代は CACHE の名前で持つ (先読み分と実行時分は同じ CACHE)。名前を上げると activate で古い世代を捨てる

const CACHE = 'bookshelf-runtime-v4';

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
    try {
        // CORS 許可済みホストのみ対象 (COVER_HOSTS)。mode:'cors' で取得し非 opaque のまま扱う。
        // 注意 (イシュー#391 step4 実機バグ発見): event.request (=req) をそのまま
        // fetch(req, {mode:'cors'}) に渡すと TypeError: Failed to fetch で毎回失敗する。
        // <img src="https://他オリジン…"> から発生するリクエストは既定で mode:'no-cors' になっており、
        // 既存 Request の mode を 'cors' へ変更しようとする呼び方が仕様上許可されないため
        // (127.0.0.1 の実サーバーへ実際に fetch させて実測・特定)。req.url (文字列) から
        // 新しい Request を作れば mode の制約に引っかからず成功する。
        const fresh = await fetch(req.url, { mode: 'cors' });
        if (fresh && fresh.status === 200) {
            const size = Number(fresh.headers.get('content-length')) || 0;
            await cache.put(req, fresh.clone());
            const meta = await _getCoverMeta(cache);
            meta[req.url] = { size, lastAccess: Date.now() };
            await _setCoverMeta(cache, meta);
            await _evictCoverCacheIfNeeded(cache);
        }
        return fresh;
    } catch (err) {
        // mode:'cors' の取得に失敗 (CORS不備・ネットワーク不調等) した場合は、キャッシュを諦めて
        // 素のリクエストへ素通しする (イシュー#391 step4 ②指摘: どちらにしても必要な保険)。
        return fetch(req);
    }
}

// ===== 殻の先読み (イシュー#597) =====
// なぜ: 初回の訪問では、ページの資源は SW の登録 (index.html の load 後) より前に読み終わっていて SW を通らない。
// 下の fetch の実行時キャッシュだけだと、1回開いただけの端末には何も残らず、電波なしで開き直すと起動しない
// (#589 の門のE2E J8-1 で実測)。install の間に、起動に要る殻を CACHE へ入れておく。
//
// 一覧は手で持たない: install のたびに index.html を取り直し、そこから参照されている同一オリジンの
// <script src>・<link href> (rel が下の一覧のもの)・<img src> を抜き出す。index.html の ?v= は check:version で
// 機械的に保証されている (ADR-082 と同じ理由) ので、抜き出した URL がそのまま版つきのキャッシュの鍵になる。
// SW では DOMParser が使えないため、属性は正規表現で読む。manifest からはアイコンも拾う。
//
// index.html・script・stylesheet (と modulepreload/preload/bookshelf-precache) は、1件でも取れなければ何も保存せずに
// install を失敗させる (中途半端な殻は残さない。次にページを開いた時の register/update で登録をやり直す)。
// manifest・アイコン・img は起動に要らないので、取れた分だけ入れる。
// bookshelf-precache = 起動に必須だが index.html からは参照されない (js が fetch で読む) ファイルを、index.html に
// 載せるための印 (ブラウザは取得しない)。例: data/config.json。一覧の正本を index.html の1つに保つため (ADR-155)。
const SHELL_REQUIRED_RELS = ['stylesheet', 'modulepreload', 'preload', 'bookshelf-precache'];
const SHELL_OPTIONAL_RELS = ['icon', 'apple-touch-icon'];

function _sameOriginUrl(raw, base) {
    if (!raw) return null;
    let u;
    try { u = new URL(raw, base); } catch (_) { return null; }
    if (u.origin !== self.location.origin) return null;
    u.hash = '';
    return u.href;
}

// index.html の文字列から、先読みする URL を「必須」「任意」「manifest」に分けて返す
function _shellUrlsFromHtml(html, base) {
    const attr = (tag, name) => {
        const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
        return m ? (m[1] ?? m[2] ?? m[3]) : null;
    };
    const required = new Set();
    const optional = new Set();
    const manifests = new Set();
    const add = (set, raw) => { const u = _sameOriginUrl(raw, base); if (u) set.add(u); };
    // コメントの中と、インラインの script の本文の中 (文字列のタグ) は読まない
    const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1');
    for (const [tag] of text.matchAll(/<script\b[^>]*>/gi)) add(required, attr(tag, 'src'));
    for (const [tag] of text.matchAll(/<link\b[^>]*>/gi)) {
        const rels = (attr(tag, 'rel') || '').toLowerCase().split(/\s+/);
        if (rels.includes('manifest')) add(manifests, attr(tag, 'href'));
        else if (rels.some((r) => SHELL_REQUIRED_RELS.includes(r))) add(required, attr(tag, 'href'));
        else if (rels.some((r) => SHELL_OPTIONAL_RELS.includes(r))) add(optional, attr(tag, 'href'));
    }
    for (const [tag] of text.matchAll(/<img\b[^>]*>/gi)) add(optional, attr(tag, 'src'));
    return { required: [...required], optional: [...optional], manifests: [...manifests] };
}

// 先読みの1件を取る。ok かつ同一オリジン (basic) の応答だけを、本文を読み切って作り直した形で返す (それ以外は例外)。
// 本文をすぐ読み切るのは、必須分を全部そろえてから保存するため: 読まないまま次々に取ると、本文待ちの応答が
// HTTP/1.1 の同時接続 (1ホスト6本) を占有して残りの取得が始まらず、install が止まる (イシュー#597 step3 で実測)。
// 作り直した応答はリダイレクトの印も持たない (リダイレクトを経た応答はナビゲーションに返すとブラウザが拒否する)。
async function _fetchShellResponse(url, init) {
    const res = await fetch(url, init);
    if (!res.ok || res.type !== 'basic') throw new Error(`${url} (HTTP ${res.status} ${res.type})`);
    return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function _precacheShell() {
    const indexUrl = new URL('./index.html', self.location).href;
    // HTML は再検証して最新を取る。?v= 付き資源は版が URL に乗っているので、既定のキャッシュモードで取る
    // (ページが読んだ直後の HTTP キャッシュから出る = 二重にダウンロードしない)
    const indexRes = await _fetchShellResponse(indexUrl, { cache: 'no-cache' });
    const { required, optional, manifests } = _shellUrlsFromHtml(await indexRes.clone().text(), indexUrl);
    // 必須分は全部取れてから保存する (1件でも失敗したらここで例外になり、何も保存しない)
    const requiredRes = await Promise.all(required.map((u) => _fetchShellResponse(u)));
    const cache = await caches.open(CACHE);
    await Promise.all(requiredRes.map((res, i) => cache.put(required[i], res)));
    await cache.put(indexUrl, indexRes);
    // 任意分 (アイコン・img・manifest とそのアイコン) は取れた分だけ
    const putOptional = async (u) => {
        try {
            const res = await _fetchShellResponse(u);
            await cache.put(u, res.clone());
            return res;
        } catch (_) { return null; }
    };
    const manifestIcons = await Promise.all(manifests.map(async (m) => {
        const res = await putOptional(m);
        if (!res) return [];
        try {
            const icons = (await res.json()).icons;
            return Array.isArray(icons) ? icons.map((ic) => _sameOriginUrl(ic && ic.src, m)).filter(Boolean) : [];
        } catch (_) { return []; }
    }));
    const rest = new Set([...optional, ...manifestIcons.flat()].filter((u) => !required.includes(u)));
    await Promise.all([...rest].map(putOptional));
}

self.addEventListener('install', (event) => {
    // skipWaiting は呼ばない。新 SW は待機させ、UI の「更新」ボタン (skipWaiting メッセージ) で適用する。
    // (初回インストール時は待機中の旧 SW が無いので、そのまま activate される)
    // 殻の先読みが終わるまで install を終えない = 有効になった時点で、電波なしでも起動できる状態になっている
    event.waitUntil(_precacheShell().catch((err) => {
        console.warn('[sw] 殻の先読みに失敗したため install を中止します (次に開いた時にやり直す):', err);
        throw err;
    }));
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
