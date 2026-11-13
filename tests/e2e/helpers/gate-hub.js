// 門のE2E (テスト名に `@gate` と観測点ID) の「前提」で使う、ハブ (Asayake ハブの Worker) の模擬 (イシュー#589)。
// 書き方の決まりは tests/e2e/gate/README.md。外部 (ハブ) への通信だけを page.route で差し替え、アプリ自身の
// ファイル (index.html・js/・css/・sw.js) は差し替えない = 本物のコードを通す。
//
// 使う順番: createHubStateForTest → seedHubLoginForTest → mockHubForTest → (gate-setup.js の) bootAppForTest。
//   const hub = createHubStateForTest({ plan: 'free' });   // 値を置くだけの宣言 (区間の外に書ける)
//   await test.step('前提: …', async () => {
//       await seedHubLoginForTest(page, hub);              // ログイン済みの接続情報と蔵書を、最初の1回だけ入れる
//       await mockHubForTest(page, hub);                   // ハブへの通信を模擬に向ける
//       await bootAppForTest(page);
//   });
// 2つ目のページ (= 別の端末) にも同じ hub を渡すと、同じハブの中身を読み書きする。
//
// chromium と webkit (gate-webkit project) で同じ応答になることは実測で確かめてある (2026-11-14・イシュー#589 step1):
//  - route.fulfill は、CORS のヘッダが無くても、本文なし (204・404・200) でも、GET・HEAD・PUT・POST・DELETE の
//    どれでも両方のブラウザで同じに届く。プリフライト (OPTIONS) は route のハンドラに来ない。
//  - ETag 等の応答ヘッダは、Access-Control-Expose-Headers を付けないとページの JS から読めない (両方のブラウザで同じ)。
//  - 304 は route.fulfill できない (Playwright の制約「Cannot fulfill with redirect status: 304」)。
//  - ただし webkit は、Service Worker が制御しているページからの通信を page.route に渡さない (実ネットワークへ出て
//    「Load failed」になる。chromium は SW が制御していても届く)。この模擬は、SW を止めた実行
//    (playwright.config.js の既定 serviceWorkers: 'block') の中で使う。SW を動かすテストで外部の模擬が要る時は、
//    page.route ではない掛け方が要る。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), 'utf-8');
const MB = 1024 * 1024;

/** 模擬のハブの置き場 (実在しないホスト)。アプリの接続情報 (bookshelf_sync.hub.apiBase) はここを向く。 */
export const HUB_BASE = 'https://mockhub.test';

/** 模擬のハブの状態を作る。テストの中で1つ作り、seedHubLoginForTest と mockHubForTest に同じ物を渡す。
 * @param {object} [overrides] plan ('free'|'plus')・billingManaged・planSource・email 等を上書きする */
export function createHubStateForTest(overrides = {}) {
    return {
        email: 'taro@example.com', uid: 'u1', siteId: 's1', key: 'hk_test',
        plan: 'free', billingManaged: false, planSource: null, subStatus: null,
        interval: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
        usedBytes: 10 * MB,
        deleted: false,        // DELETE /account (退会) を受けたか
        files: new Map(),      // /data/<path> の中身 (path → { content, etag })
        seq: 0,                // ETag の連番
        requests: [],          // 届いた通信の記録 ({ method, path })。模擬に無い道を見つける時に読む
        ...overrides
    };
}

const quotaOf = (state) => (state.plan === 'plus' ? 3072 : 100) * MB;

// GET /usage の応答。アプリが読む項目は js/hub-auth.js の refreshUsage
function usageOf(state) {
    return {
        plan: state.plan, usedBytes: state.usedBytes, quotaBytes: quotaOf(state),
        billingManaged: state.billingManaged, planSource: state.planSource, subStatus: state.subStatus,
        interval: state.interval, currentPeriodEnd: state.currentPeriodEnd, cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        siteId: state.siteId
    };
}

/** ログイン済みの接続情報 (と、既定では蔵書の見本) を、アプリを開く前に localStorage へ入れる。
 * 入れるのはそのページ (タブ) で最初の1回だけ。再読込のたびに入れ直すと、退会・ログアウトで消えたはずの接続が
 * 戻ってしまい「消えた」「残った」を確かめられないため。gate-setup.js の seedLibraryForTest は毎回入れ直すので、
 * 再読込をまたいで確かめるテストでは、こちらだけを使う (併用しない)。
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<typeof createHubStateForTest>} state
 * @param {{ method?: 'local'|'hub', library?: boolean }} [opts] method: データの保存先 (既定はローカル)。library: 蔵書の見本も入れるか (既定 true) */
export async function seedHubLoginForTest(page, state, opts = {}) {
    const { method = 'local', library = true } = opts;
    const hub = {
        apiBase: HUB_BASE, key: state.key, uid: state.uid, siteId: state.siteId, email: state.email,
        plan: state.plan, quotaBytes: quotaOf(state), usedBytes: state.usedBytes,
        billingManaged: state.billingManaged, planSource: state.planSource, subStatus: state.subStatus,
        username: null, bookshelfBase: null
    };
    await page.addInitScript(([hub, method, userData, libraryJson]) => {
        if (sessionStorage.getItem('gateHubSeeded')) return;
        sessionStorage.setItem('gateHubSeeded', '1');
        if (userData) localStorage.setItem('virtualBookshelf_userData', userData);
        if (libraryJson) localStorage.setItem('virtualBookshelf_library', libraryJson);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method, hub }));
    }, [hub, method, library ? fixture('fixture-userdata.json') : null, library ? fixture('fixture-library.json') : null]);
}

// /data/<path> の読み書き。応答の形は tests/e2e/publish-conflict-hub.spec.js の模擬と同じ
// (ETag は Access-Control-Expose-Headers を付けて返す = 付けないとアプリから読めない)
function fulfillData(route, state, method, path) {
    const req = route.request();
    const expose = { 'Access-Control-Expose-Headers': 'ETag' };
    if (method === 'GET' || method === 'HEAD') {
        const entry = state.files.get(path);
        if (!entry) return route.fulfill({ status: 404 });
        return route.fulfill({ status: 200, headers: { ETag: entry.etag, ...expose }, body: method === 'HEAD' ? '' : entry.content, contentType: 'text/plain' });
    }
    if (method === 'PUT') {
        const ifMatch = req.headers()['if-match'];
        const entry = state.files.get(path);
        if (ifMatch && (!entry || entry.etag !== ifMatch)) return route.fulfill({ status: 412, body: 'conflict' });
        state.seq += 1;
        const etag = `"v${state.seq}"`;
        state.files.set(path, { content: req.postData() || '', etag });
        return route.fulfill({ status: 200, headers: { ETag: etag, ...expose } });
    }
    if (method === 'DELETE') { state.files.delete(path); return route.fulfill({ status: 204 }); }
    return route.fulfill({ status: 405 });
}

/** ハブへの通信 (HUB_BASE 以下) を模擬に向ける。アプリを開く前に呼ぶ。
 * 今ある道: GET /usage・POST /billing/checkout・POST /billing/portal・DELETE /account・/data/<path> の GET/HEAD/PUT/DELETE。
 * まだ無い道 (POST /data/batch・POST /publish・一覧 ?list=1・ログイン) は 501 を返す = 使うテストを書く時に、
 * 本物 (cf-worker/asayake-hub.js) の約束を確かめてここへ足す。
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<typeof createHubStateForTest>} state */
export async function mockHubForTest(page, state) {
    await page.route(`${HUB_BASE}/**`, async (route) => {
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
        if (path.startsWith('/data/') && !url.searchParams.has('list') && path !== '/data/batch') {
            return fulfillData(route, state, method, decodeURIComponent(path.slice('/data/'.length)));
        }
        return route.fulfill({ status: 501, json: { error: `gate-hub.js の模擬に無い道: ${method} ${path}${url.search}` } });
    });
}
