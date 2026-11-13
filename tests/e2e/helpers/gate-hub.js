// 門のE2E (テスト名に `@gate` と観測点ID) の「前提」で使う、ハブ (Asayake ハブの Worker と公開ページの配信) の模擬
// (イシュー#589 が作り、#588 で保存のまとめ書き・一覧・公開・公開ページの配信・書き込み失敗を足した)。
// 書き方の決まりは tests/e2e/gate/README.md。外部 (ハブ・公開ページの配信) への通信だけを差し替え、アプリ自身の
// ファイル (index.html・js/・css/・sw.js) は差し替えない = 本物のコードを通す。
//
// 使う順番: createHubStateForTest → (seedHubDataForTest) → seedHubLoginForTest → mockHubForTest → (gate-setup.js の) bootAppForTest
//          (→ ハブから読む起動なら waitForHubStartupForTest)。
//   let hub = null;                                         // 区間の外には値を置くだけの宣言しか書けない
//   await test.step('前提: …', async () => {
//       hub = createHubStateForTest({ plan: 'free' });
//       await seedHubLoginForTest(page, hub);              // ログイン済みの接続情報と蔵書を、最初の1回だけ入れる
//       await mockHubForTest(page, hub);                   // ハブと公開ページへの通信を模擬に向ける
//       await bootAppForTest(page);
//   });
// 模擬はホストごとに route を1本だけ、ページではなくコンテキスト (= その端末) に掛ける (振り分け役)。公開URLを新しい
// タブで開いても同じ模擬が答える。2つ目のコンテキスト (= 別の端末) のページにも同じ hub を渡すと、同じハブの中身を
// 読み書きする。同じコンテキストに2回掛けない (同じホストに route が重なると取り合いになる)。
//
// chromium と webkit (gate-webkit project) で同じ応答になることは実測で確かめてある (2026-11-14・イシュー#589 step1):
//  - route.fulfill は、CORS のヘッダが無くても、本文なし (204・404・200) でも、GET・HEAD・PUT・POST・DELETE の
//    どれでも両方のブラウザで同じに届く。プリフライト (OPTIONS) は route のハンドラに来ない。
//  - ETag 等の応答ヘッダは、Access-Control-Expose-Headers を付けないとページの JS から読めない (両方のブラウザで同じ)。
//  - 304 は route.fulfill できない (Playwright の制約「Cannot fulfill with redirect status: 304」)。
//  - ただし webkit は、Service Worker が制御しているページからの通信を route に渡さない (実ネットワークへ出て
//    「Load failed」になる。chromium は SW が制御していても届く)。この模擬は、SW を止めた実行
//    (playwright.config.js の既定 serviceWorkers: 'block') の中で使う。SW を動かすテストで外部の模擬が要る時は、
//    別の掛け方が要る。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), 'utf-8');
const MB = 1024 * 1024;

/** 模擬のハブの置き場 (実在しないホスト)。アプリの接続情報 (bookshelf_sync.hub.apiBase) はここを向く。 */
export const HUB_BASE = 'https://mockhub.test';
/** 公開ページの配信の置き場。本番と同じ形 https://bookshelf.asayake.org/<username>/<publicId>/ (cf-worker/bookshelf-cdn.js)。 */
export const PUBLIC_SITE_BASE = 'https://bookshelf.asayake.org';

/** 模擬のハブの状態を作る。テストの中で1つ作り、seedHubLoginForTest と mockHubForTest に同じ物を渡す。
 * @param {object} [overrides] plan ('free'|'plus')・billingManaged・planSource・email・username (null で公開名義なし) 等を上書きする */
export function createHubStateForTest(overrides = {}) {
    return {
        email: 'taro@example.com', uid: 'u1', siteId: 's1', key: 'hk_test',
        plan: 'free', billingManaged: false, planSource: null, subStatus: null,
        interval: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
        usedBytes: 10 * MB,
        username: 'hahero',    // 公開の名義。公開URL は https://bookshelf.asayake.org/<username>/<publicId>/
        deleted: false,        // DELETE /account (退会) を受けたか
        files: new Map(),      // /data/<path> の中身 (path → { content, etag })
        site: new Map(),       // 公開サイト sites/<siteId>/ の中身 (path → { body, contentType })
        seq: 0,                // ETag の連番
        failWrites: false,     // true の間は書き込み (PUT・DELETE・まとめ書き・公開) を 500 で失敗させる
        requests: [],          // 届いた通信の記録 ({ method, path })。模擬に無い道を見つける時に読む
        ...overrides
    };
}

const quotaOf = (state) => (state.plan === 'plus' ? 3072 : 100) * MB;

/** 公開ページの URL のベース (末尾 /)。username が無ければ null (アプリは旧URL の publicBase を使う)。
 * @param {ReturnType<typeof createHubStateForTest>} state */
export function publicBaseOf(state) {
    return state.username ? `${PUBLIC_SITE_BASE}/${state.username}/` : null;
}

// GET /usage の応答。アプリが読む項目は js/hub-auth.js の refreshUsage
function usageOf(state) {
    return {
        plan: state.plan, usedBytes: state.usedBytes, quotaBytes: quotaOf(state),
        billingManaged: state.billingManaged, planSource: state.planSource, subStatus: state.subStatus,
        interval: state.interval, currentPeriodEnd: state.currentPeriodEnd, cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        siteId: state.siteId
    };
}

/** ハブの中に蔵書の見本 (「フィクスチャの本 1」ほか) を、アプリがハブに保存する形で置く。
 * 形は tests/e2e/char/publish-hub.spec.js の保存先の見本と同じ (private/library.json・bookshelves.json・
 * bookshelves/all.json・notes.json)。保存先をハブにして蔵書をハブから読ませる時に、seedHubLoginForTest の前に呼ぶ。
 * @param {ReturnType<typeof createHubStateForTest>} state */
export function seedHubDataForTest(state) {
    const library = JSON.parse(fixture('fixture-library.json'));
    const userData = JSON.parse(fixture('fixture-userdata.json'));
    const put = (path, data) => { state.seq += 1; state.files.set(path, { content: JSON.stringify(data), etag: `"v${state.seq}"` }); };
    put('private/library.json', library);
    put('private/bookshelves.json', { bookshelves: [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }] });
    put('private/bookshelves/all.json', { books: library.books.map((b) => b.asin) });
    put('private/notes.json', { notes: userData.notes || {} });
}

/** ログイン済みの接続情報 (公開先はハブ) と、既定では端末内の蔵書の見本を、アプリを開く前に localStorage へ入れる。
 * 入れるのはそのページ (タブ) で最初の1回だけ。再読込のたびに入れ直すと、退会・ログアウトで消えたはずの接続が
 * 戻ってしまい「消えた」「残った」を確かめられないため。gate-setup.js の seedLibraryForTest は毎回入れ直すので、
 * 再読込をまたいで確かめるテストでは、こちらだけを使う (併用しない)。
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<typeof createHubStateForTest>} state
 * @param {{ method?: 'local'|'hub', library?: boolean }} [opts] method: データの保存先 (既定はローカル)。library: 端末内の蔵書の見本も入れるか (既定 true) */
export async function seedHubLoginForTest(page, state, opts = {}) {
    const { method = 'local', library = true } = opts;
    const hub = {
        apiBase: HUB_BASE, key: state.key, uid: state.uid, siteId: state.siteId, email: state.email,
        plan: state.plan, quotaBytes: quotaOf(state), usedBytes: state.usedBytes,
        billingManaged: state.billingManaged, planSource: state.planSource, subStatus: state.subStatus,
        publicBase: `${HUB_BASE}/public/${state.siteId}/`, username: state.username || null, bookshelfBase: publicBaseOf(state)
    };
    await page.addInitScript(([hub, method, userData, libraryJson]) => {
        if (sessionStorage.getItem('gateHubSeeded')) return;
        sessionStorage.setItem('gateHubSeeded', '1');
        if (userData) localStorage.setItem('virtualBookshelf_userData', userData);
        if (libraryJson) localStorage.setItem('virtualBookshelf_library', libraryJson);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method, hub, publish: { target: 'hub' } }));
    }, [hub, method, library ? fixture('fixture-userdata.json') : null, library ? fixture('fixture-library.json') : null]);
}

/** ハブからの読み込み (起動の後半・js/bookshelf.js:462-479) が終わるまで待つ。bootAppForTest の後に呼ぶ。
 * 端末に蔵書が無い時は、ハブから読み終わるまで読み込み中の表示 (#loading) が画面を覆う。蔵書がある時は
 * 「最新のデータを確認しています…」の間に裏で読み直す。どちらも終わる前に押すと、押した画面が描き直しで閉じる。
 * @param {import('@playwright/test').Page} page */
export async function waitForHubStartupForTest(page) {
    // アプリの内部 (bookshelf._*) は読まない (lint:internal-refs の上限)。画面の2つの表示で判定する:
    // 読み込み中の覆い (#loading) と、上部の「最新のデータを確認しています…」の行 (js/bookshelf.js _updateStatusBar)
    await page.waitForFunction(() => {
        const loading = document.getElementById('loading');
        const checking = document.querySelector('.status-row.status-checking');
        return window.bookshelf && !checking && (!loading || loading.style.display === 'none');
    });
}

/** ハブの中のファイル (例: private/notes.json) に text が入るまで待つ (最大 timeoutMs)。端末の書き込みがハブに
 * 届いたことを、次の操作の前提にする時に使う (ハブの保存は「同期済み」の文字が画面に出ないため)。
 * @param {ReturnType<typeof createHubStateForTest>} state @param {string} path @param {string} text @param {number} [timeoutMs] */
export async function waitForHubFileContainsForTest(state, path, text, timeoutMs = 20000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        const entry = state.files.get(path);
        if (entry && String(entry.content).includes(text)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`gate-hub.js: ${path} に「${text}」が ${timeoutMs}ms 以内に届かなかった`);
}

/** これ以降のハブへの書き込み (PUT・DELETE・まとめ書き・公開) を 500 で失敗させる (読み込みは通す)。
 * @param {ReturnType<typeof createHubStateForTest>} state */
export function failHubWritesForTest(state) {
    state.failWrites = true;
}

const etagHeaders = (etag) => ({ ETag: etag, 'Access-Control-Expose-Headers': 'ETag' });
const writeFailure = (route) => route.fulfill({ status: 500, json: { error: 'gate-hub.js の模擬: 書き込みの失敗' } });

// /data/<path> の読み書き。応答の形は tests/e2e/publish-conflict-hub.spec.js の模擬と同じ
// (ETag は Access-Control-Expose-Headers を付けて返す = 付けないとアプリから読めない)
function fulfillData(route, state, method, path) {
    const req = route.request();
    if (method === 'GET' || method === 'HEAD') {
        const entry = state.files.get(path);
        if (!entry) return route.fulfill({ status: 404 });
        return route.fulfill({ status: 200, headers: etagHeaders(entry.etag), body: method === 'HEAD' ? '' : entry.content, contentType: 'text/plain' });
    }
    if (state.failWrites) return writeFailure(route);
    if (method === 'PUT') {
        const ifMatch = req.headers()['if-match'];
        const entry = state.files.get(path);
        if (ifMatch && (!entry || entry.etag !== ifMatch)) return route.fulfill({ status: 412, body: 'conflict' });
        state.seq += 1;
        const etag = `"v${state.seq}"`;
        state.files.set(path, { content: req.postData() || '', etag });
        return route.fulfill({ status: 200, headers: etagHeaders(etag) });
    }
    if (method === 'DELETE') { state.files.delete(path); return route.fulfill({ status: 204 }); }
    return route.fulfill({ status: 405 });
}

// POST /data/batch (cf-worker/asayake-hub.js handleBatch の段階1検証を近似。tests/e2e/publish-conflict-hub.spec.js と同じ):
// 条件付きの entry を先に全部調べ、1件でも違えば全体を 412 {conflicts} にして何も書かない
function runBatch(state, entries) {
    if (!Array.isArray(entries)) return { status: 400 };
    const conflicts = [];
    for (const e of entries) {
        const entry = state.files.get(e.path);
        if (e.ifNoneMatch === '*') { if (entry) conflicts.push({ path: e.path, etag: entry.etag }); }
        else if (e.ifMatch) { if (!entry || entry.etag !== e.ifMatch) conflicts.push({ path: e.path, etag: entry ? entry.etag : null }); }
    }
    if (conflicts.length) return { status: 412, body: { error: 'etag mismatch', conflicts } };
    for (const e of entries) {
        if (e.op === 'delete') state.files.delete(e.path);
        else { state.seq += 1; state.files.set(e.path, { content: e.content || '', etag: `"v${state.seq}"` }); }
    }
    return { status: 200 };
}

// GET /data/<dir>?list=1 (dir の直下のファイルとフォルダ)
function listDir(state, dir) {
    const prefix = dir ? `${dir.replace(/\/+$/, '')}/` : '';
    const files = new Set();
    const dirs = new Set();
    for (const path of state.files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const i = rest.indexOf('/');
        if (i < 0) files.add(rest); else dirs.add(rest.slice(0, i));
    }
    return { files: [...files], dirs: [...dirs] };
}

function contentTypeOf(path) {
    if (path.endsWith('.html')) return 'text/html; charset=utf-8';
    if (path.endsWith('.css')) return 'text/css; charset=utf-8';
    if (path.endsWith('.json')) return 'application/json';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.js')) return 'application/javascript';
    return 'application/octet-stream';
}

// POST /publish (cf-worker/asayake-hub.js:776-788 と同じ約束: 全部置いてから、deleteMissing なら今回無い物を消す。
// siteUrl は username があれば https://bookshelf.asayake.org/<username>/、無ければ旧URL)
function runPublish(state, body) {
    const files = Array.isArray(body.files) ? body.files : [];
    const keep = new Set();
    for (const f of files) {
        const path = String(f.path || '').replace(/^\/+/, '');
        keep.add(path);
        const buf = f.encoding === 'base64' ? Buffer.from(f.content || '', 'base64') : Buffer.from(String(f.content || ''), 'utf-8');
        state.site.set(path, { body: buf, contentType: contentTypeOf(path) });
    }
    if (body.deleteMissing) for (const path of [...state.site.keys()]) if (!keep.has(path)) state.site.delete(path);
    const siteUrl = publicBaseOf(state) || `${HUB_BASE}/public/${state.siteId}/`;
    return { ok: true, siteId: state.siteId, siteUrl, published: files.length, indexed: 0 };
}

// 公開サイトの中身を返す (cf-worker/bookshelf-cdn.js:132-133 と同じ: 末尾 / なら index.html。無ければ 404)
function fulfillSite(route, state, sub) {
    let path = sub;
    if (path === '' || path.endsWith('/')) path += 'index.html';
    const entry = state.site.get(path);
    if (!entry) return route.fulfill({ status: 404, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>404</title><h1>404 Not Found</h1>' });
    return route.fulfill({ status: 200, contentType: entry.contentType, body: entry.body });
}

/** ハブへの通信 (HUB_BASE 以下) と公開ページの配信 (PUBLIC_SITE_BASE 以下) を模擬に向ける。アプリを開く前に呼ぶ。
 * route はそのページのコンテキストに1本ずつ掛ける (新しいタブにも効く)。
 * 今ある道: GET /usage・POST /billing/checkout・POST /billing/portal・DELETE /account・/data/<path> の GET/HEAD/PUT/DELETE・
 * POST /data/batch・GET /data/<dir>?list=1・POST /publish・GET /public/<siteId>/<path> (旧URL)・
 * GET https://bookshelf.asayake.org/<username>/<path>。
 * まだ無い道 (ログイン等) は 501 を返す = 使うテストを書く時に、本物 (cf-worker/asayake-hub.js) の約束を確かめてここへ足す。
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<typeof createHubStateForTest>} state */
export async function mockHubForTest(page, state) {
    const context = page.context();
    await context.route('https://mockhub.test/**', async (route) => {
        const req = route.request();
        const method = req.method();
        const url = new URL(req.url());
        const path = url.pathname;
        state.requests.push({ method, path: path + url.search });
        if (path === '/usage' && method === 'GET') return route.fulfill({ json: usageOf(state) });
        if (path === '/billing/checkout' && method === 'POST') {
            // 決済が済んだものとして Plus にし、アプリへ戻る URL を返す (本物は Stripe の決済ページの URL を返す)。
            // 戻り先はアプリが送ってきた returnUrl (js/screens/settings.js の _startCheckout) から組む
            let returnUrl = '';
            try { returnUrl = (JSON.parse(req.postData() || '{}').returnUrl) || ''; } catch (_) { /* 本文が JSON でなければ下の既定へ */ }
            if (!returnUrl) returnUrl = `${new URL(page.url()).origin}/index.html`;
            Object.assign(state, { plan: 'plus', billingManaged: true, planSource: 'stripe' });
            return route.fulfill({ json: { url: `${returnUrl}?billing=success` } });
        }
        if (path === '/billing/portal' && method === 'POST') {
            return route.fulfill({ json: { url: `${new URL(page.url()).origin}/index.html` } });
        }
        if (path === '/account' && method === 'DELETE') {
            state.deleted = true;
            state.files.clear();
            return route.fulfill({ json: { ok: true, deleted: true } });
        }
        if (path === '/publish' && method === 'POST') {
            if (state.failWrites) return writeFailure(route);
            return route.fulfill({ json: runPublish(state, JSON.parse(req.postData() || '{}')) });
        }
        if (path === '/data/batch' && method === 'POST') {
            if (state.failWrites) return writeFailure(route);
            const r = runBatch(state, JSON.parse(req.postData() || '{}').entries);
            return r.body ? route.fulfill({ status: r.status, json: r.body }) : route.fulfill({ status: r.status });
        }
        if (path.startsWith('/data/')) {
            const p = decodeURIComponent(path.slice('/data/'.length));
            if (url.searchParams.get('list') === '1') return route.fulfill({ json: listDir(state, p) });
            return fulfillData(route, state, method, p);
        }
        const old = `/public/${state.siteId}/`;
        if (path.startsWith(old) && method === 'GET') return fulfillSite(route, state, decodeURIComponent(path.slice(old.length)));
        return route.fulfill({ status: 501, json: { error: `gate-hub.js の模擬に無い道: ${method} ${path}${url.search}` } });
    });
    await context.route('https://bookshelf.asayake.org/**', async (route) => {
        const url = new URL(route.request().url());
        state.requests.push({ method: route.request().method(), path: url.href });
        const own = state.username ? `/${state.username}/` : null;
        if (!own || !url.pathname.startsWith(own)) return route.fulfill({ status: 404, contentType: 'text/html; charset=utf-8', body: '<!doctype html><h1>404 Not Found</h1>' });
        return fulfillSite(route, state, decodeURIComponent(url.pathname.slice(own.length)));
    });
}
