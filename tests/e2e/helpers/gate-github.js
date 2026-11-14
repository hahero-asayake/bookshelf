// 門のE2E (テスト名に `@gate` と観測点ID) の「前提」で使う、GitHub (保存先のリポジトリ) の模擬 (イシュー#588)。
// 書き方の決まりは tests/e2e/gate/README.md。外部 (api.github.com) への通信だけを差し替え、アプリ自身のファイルと
// アプリの GitHub の読み書き (js/github-adapter.js) は差し替えない = 本物のコードを通す。
//
// 模擬するのはアプリが使う範囲だけ (js/github-adapter.js):
//  - GET /repos/:o/:r (リポジトリ情報)・GET /user
//  - contents の GET (?ref=) / PUT / DELETE と sha の照合 (違えば 409)
//  - git の refs (GET・PATCH・早送りでなければ 422)・commits (GET・POST)・trees (GET ?recursive=1・POST)・blobs (POST)
// 状態は1つのリポジトリの1本のブランチ (main)。route はコンテキストに1本 (2つ目のコンテキスト = 別の端末にも同じ
// state を渡すと、同じリポジトリを読み書きする)。
//
// 使う順番: createMockGitHubForTest → seedGitHubDataForTest → seedGitHubLoginForTest → mockGitHubForTest → bootAppForTest
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), 'utf-8');

/** 模擬の GitHub の状態を作る。
 * @param {object} [overrides] */
export function createMockGitHubForTest(overrides = {}) {
    const state = {
        kind: 'github', owner: 'taro', repo: 'bookshelf-data', branch: 'main', token: 'gho_gate_test', login: 'taro',
        blobs: new Map(),      // blob sha → 中身 (文字列)
        trees: new Map(),      // tree sha → Map(path → blob sha)
        commits: new Map(),    // commit sha → { tree, parents }
        head: null,            // main が指す commit sha
        seq: 0,
        requests: [],          // 届いた通信の記録 ({ method, path })
        ...overrides
    };
    const tree = newTree(state, new Map());
    state.head = newCommit(state, tree, []);
    return state;
}

const nextSha = (state, prefix) => { state.seq += 1; return `${prefix}${String(state.seq).padStart(39, '0')}`; };
function newBlob(state, content) { const sha = nextSha(state, 'b'); state.blobs.set(sha, content); return sha; }
function newTree(state, map) { const sha = nextSha(state, 't'); state.trees.set(sha, map); return sha; }
function newCommit(state, tree, parents) { const sha = nextSha(state, 'c'); state.commits.set(sha, { tree, parents }); return sha; }
const headTree = (state) => state.trees.get(state.commits.get(state.head).tree);

// 1つのファイルを main に積む (contents の PUT・DELETE と、seed で使う)
function commitFile(state, path, content) {
    const map = new Map(headTree(state));
    if (content === null) map.delete(path); else map.set(path, newBlob(state, content));
    state.head = newCommit(state, newTree(state, map), [state.head]);
    return map.get(path) || null;
}

/** リポジトリに蔵書の見本 (「フィクスチャの本 1」ほか) を、アプリが保存する形で置く。
 * 形は gate-hub.js の seedHubDataForTest と同じ (private/library.json・bookshelves.json・bookshelves/all.json・notes.json)。
 * @param {ReturnType<typeof createMockGitHubForTest>} state */
export function seedGitHubDataForTest(state, { exportDate } = {}) {
    const library = JSON.parse(fixture('fixture-library.json'));
    // exportDate: library.json の版の日付 (gate-hub.js の seedHubDataForTest と同じ・イシュー#622)
    if (exportDate) library.exportDate = exportDate;
    const userData = JSON.parse(fixture('fixture-userdata.json'));
    commitFile(state, 'private/library.json', JSON.stringify(library, null, 2));
    commitFile(state, 'private/bookshelves.json', JSON.stringify({ bookshelves: [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }] }, null, 2));
    commitFile(state, 'private/bookshelves/all.json', JSON.stringify({ books: library.books.map((b) => b.asin) }, null, 2));
    commitFile(state, 'private/notes.json', JSON.stringify({ notes: userData.notes || {} }, null, 2));
}

/** GitHub に接続済み (保存先 = このリポジトリ) の接続情報を、そのタブで最初の1回だけ localStorage に入れる。
 * 端末内の蔵書は入れない (リポジトリから読む)。トークンの更新 (refreshToken) は持たない = 更新の通信は起きない。
 * @param {import('@playwright/test').Page} page @param {ReturnType<typeof createMockGitHubForTest>} state */
export async function seedGitHubLoginForTest(page, state) {
    const github = { owner: state.owner, repo: state.repo, branch: state.branch, basePath: '', token: state.token, login: state.login };
    await page.addInitScript((gh) => {
        if (sessionStorage.getItem('gateGitHubSeeded')) return;
        sessionStorage.setItem('gateGitHubSeeded', '1');
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'github', github: gh }));
    }, github);
}

/** リポジトリの中のファイル path に text が入るまで待つ (端末の書き込みがリポジトリに届いたことの前提)。
 * @param {ReturnType<typeof createMockGitHubForTest>} state @param {string} path @param {string} text @param {number} [timeoutMs] */
export async function waitForGitHubFileContainsForTest(state, path, text, timeoutMs = 20000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        const sha = headTree(state).get(path);
        if (sha && String(state.blobs.get(sha)).includes(text)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`gate-github.js: ${path} に「${text}」が ${timeoutMs}ms 以内に届かなかった`);
}

const b64 = (text) => Buffer.from(String(text), 'utf-8').toString('base64');
const unb64 = (text) => Buffer.from(String(text || ''), 'base64').toString('utf-8');

async function routeGitHub(route, state) {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    const path = url.pathname;
    state.requests.push({ method, path: path + url.search });
    const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch (_) { return {}; } };
    if (path === '/user') return route.fulfill({ json: { login: state.login } });
    // 接続の道 (インストール先とリポジトリの一覧・ブランチ)。mockGitHubConnectForTest を呼んだ時だけ答える (イシュー#629)
    if (state.connect && path === '/user/installations') return route.fulfill({ json: { total_count: 1, installations: [{ id: 1, account: { login: state.owner } }] } });
    if (state.connect && path === '/user/installations/1/repositories') return route.fulfill({ json: { total_count: 1, repositories: [installedRepoOf(state)] } });
    const base = `/repos/${state.owner}/${state.repo}`;
    if (!path.startsWith(base)) return route.fulfill({ status: 404, json: { message: 'Not Found' } });
    const rest = path.slice(base.length);
    if (state.connect && rest === '/branches' && method === 'GET') return route.fulfill({ json: [{ name: state.branch, protected: false }] });
    if (rest === '' && method === 'GET') {
        return route.fulfill({ json: { name: state.repo, full_name: `${state.owner}/${state.repo}`, default_branch: state.branch, private: true, permissions: { push: true } } });
    }
    if (rest.startsWith('/contents/')) {
        const p = decodeURIComponent(rest.slice('/contents/'.length));
        const cur = headTree(state).get(p) || null;
        if (method === 'GET') {
            if (!cur) return route.fulfill({ status: 404, json: { message: 'Not Found' } });
            return route.fulfill({ json: { type: 'file', path: p, name: p.split('/').pop(), sha: cur, encoding: 'base64', content: b64(state.blobs.get(cur)) } });
        }
        if (method === 'PUT' || method === 'DELETE') {
            const b = body();
            if ((cur && b.sha !== cur) || (!cur && b.sha)) return route.fulfill({ status: 409, json: { message: 'sha does not match' } });
            const sha = commitFile(state, p, method === 'DELETE' ? null : unb64(b.content));
            return route.fulfill({ json: { content: method === 'DELETE' ? null : { path: p, sha }, commit: { sha: state.head } } });
        }
    }
    if (rest === `/git/refs/heads/${state.branch}`) {
        if (method === 'GET') return route.fulfill({ json: { ref: `refs/heads/${state.branch}`, object: { sha: state.head, type: 'commit' } } });
        if (method === 'PATCH') {
            const b = body();
            const c = state.commits.get(b.sha);
            if (!c) return route.fulfill({ status: 422, json: { message: 'Object does not exist' } });
            if (!b.force && c.parents[0] !== state.head) return route.fulfill({ status: 422, json: { message: 'Update is not a fast forward' } });
            state.head = b.sha;
            return route.fulfill({ json: { ref: `refs/heads/${state.branch}`, object: { sha: state.head, type: 'commit' } } });
        }
    }
    if (rest.startsWith('/git/commits')) {
        if (method === 'GET') {
            const sha = rest.slice('/git/commits/'.length);
            const c = state.commits.get(sha);
            if (!c) return route.fulfill({ status: 404, json: { message: 'Not Found' } });
            return route.fulfill({ json: { sha, tree: { sha: c.tree }, parents: c.parents.map((s) => ({ sha: s })) } });
        }
        if (method === 'POST') {
            const b = body();
            return route.fulfill({ status: 201, json: { sha: newCommit(state, b.tree, b.parents || []) } });
        }
    }
    if (rest.startsWith('/git/trees')) {
        if (method === 'GET') {
            const sha = rest.slice('/git/trees/'.length);
            const map = state.trees.get(sha);
            if (!map) return route.fulfill({ status: 404, json: { message: 'Not Found' } });
            return route.fulfill({ json: { sha, truncated: false, tree: [...map].map(([p, s]) => ({ path: p, mode: '100644', type: 'blob', sha: s })) } });
        }
        if (method === 'POST') {
            const b = body();
            const map = new Map(b.base_tree ? state.trees.get(b.base_tree) || [] : []);
            for (const e of b.tree || []) {
                if (e.sha === null) map.delete(e.path);
                else if (e.sha) map.set(e.path, e.sha);
                else if (typeof e.content === 'string') map.set(e.path, newBlob(state, e.content));
            }
            return route.fulfill({ status: 201, json: { sha: newTree(state, map) } });
        }
    }
    if (rest === '/git/blobs' && method === 'POST') {
        const b = body();
        return route.fulfill({ status: 201, json: { sha: newBlob(state, b.encoding === 'base64' ? unb64(b.content) : String(b.content || '')) } });
    }
    return route.fulfill({ status: 404, json: { message: `gate-github.js の模擬に無い道: ${method} ${path}` } });
}

/** api.github.com への通信を模擬に向ける (そのページのコンテキストに1本)。アプリを開く前に呼ぶ。
 * @param {import('@playwright/test').Page} page @param {ReturnType<typeof createMockGitHubForTest>} state */
export async function mockGitHubForTest(page, state) {
    await page.context().route('https://api.github.com/**', (route) => routeGitHub(route, state));
}

// ---- イシュー#590 (門のE2E J1-3 の GitHub の分) で足した分：接続 (OAuth Device Flow) の模擬 ----
// 接続とリポジトリ一覧までを返す (状態は持たない)。リポジトリの中身の読み書きは上の mockGitHubForTest (#588) が受け持つ。
// 1つのテストでは、この関数と mockGitHubForTest のどちらか片方だけを使う (api.github.com に route を2本重ねない)。

const DEVICE_FLOW_CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
};

function fulfillDeviceFlowJson(route, status, body) {
    return route.fulfill({ status, headers: DEVICE_FLOW_CORS, contentType: 'application/json', body: JSON.stringify(body) });
}

/** 「GitHub に接続」を押すと、コード (userCode) が出て、すぐ承認された扱いになり、login のアカウントで
 * つながるようにする。GitHub App は1つのリポジトリ login/repo にだけ入っている扱い。
 * アプリを開く前に呼ぶ (再読込の後も同じ模擬が効く)。
 * @param {import('@playwright/test').Page} page
 * @param {{ login?: string, repo?: string, userCode?: string }} [opts] */
export async function mockGitHubDeviceFlowForTest(page, { login = 'gate-user', repo = 'bookshelf-data', userCode = 'GATE-0001' } = {}) {
    const fullName = `${login}/${repo}`;
    const oauth = async (route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: DEVICE_FLOW_CORS });
        const path = new URL(req.url()).pathname;
        if (path.endsWith('/login/device/code')) {
            return fulfillDeviceFlowJson(route, 200, { device_code: 'gate-device-code', user_code: userCode, verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
        }
        if (path.endsWith('/login/oauth/access_token')) {
            return fulfillDeviceFlowJson(route, 200, { access_token: 'gho_gate_test_token', token_type: 'bearer', scope: '' });
        }
        return fulfillDeviceFlowJson(route, 404, { error: 'not_found' });
    };
    await page.route('https://bookshelf-oauth-proxy.asayake-hahero.workers.dev/**', oauth);
    await page.route('https://github.com/login/**', oauth);
    await page.route('https://api.github.com/**', async (route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: DEVICE_FLOW_CORS });
        const path = new URL(req.url()).pathname;
        const repoJson = { id: 1, name: repo, full_name: fullName, owner: { login }, private: true, default_branch: 'main', updated_at: '2026-11-01T00:00:00Z', permissions: { admin: true, push: true, pull: true } };
        if (path === '/user') return fulfillDeviceFlowJson(route, 200, { login, id: 1 });
        if (path === '/user/installations') return fulfillDeviceFlowJson(route, 200, { total_count: 1, installations: [{ id: 1, account: { login } }] });
        if (path === '/user/installations/1/repositories') return fulfillDeviceFlowJson(route, 200, { total_count: 1, repositories: [repoJson] });
        if (path === `/repos/${fullName}`) return fulfillDeviceFlowJson(route, 200, repoJson);
        if (path === `/repos/${fullName}/branches`) return fulfillDeviceFlowJson(route, 200, [{ name: 'main', protected: false }]);
        return fulfillDeviceFlowJson(route, 404, { message: 'Not Found' });
    });
}

// ---- イシュー#629 (門のE2E J1-4 の GitHub の分) で足した分：接続の操作から、状態を持つ模擬へつなぐ ----
// mockGitHubForTest (状態を持つ・api.github.com に1本) と一緒に使う。api.github.com には route を足さない:
// 接続の道 (インストール先とリポジトリの一覧・ブランチ) は、routeGitHub が state.connect のある時だけ答える。
// ここで掛けるのは OAuth の2ホスト (Worker の proxy と github.com/login) だけ。mockGitHubDeviceFlowForTest とは併用しない。

// GitHub App が入っているリポジトリ (一覧の1件)。アプリが読む項目は js/screens/settings.js の _loadGitHubRepos
function installedRepoOf(state) {
    return {
        id: 1, name: state.repo, full_name: `${state.owner}/${state.repo}`, owner: { login: state.owner }, private: true,
        default_branch: state.branch, updated_at: '2026-11-01T00:00:00Z', permissions: { admin: true, push: true, pull: true }
    };
}

/** 「GitHub に接続」を押すと、コード (userCode) が出て、すぐ承認された扱いになり、state.login でつながるようにする。
 * GitHub App は state のリポジトリ1つにだけ入っている扱い。リポジトリを選んで「この設定で使う」を押した後の読み書きは、
 * そのまま mockGitHubForTest の状態 (seedGitHubDataForTest で置いた中身) に届く。mockGitHubForTest と一緒に、
 * アプリを開く前に呼ぶ。
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<typeof createMockGitHubForTest>} state
 * @param {{ userCode?: string }} [opts] */
export async function mockGitHubConnectForTest(page, state, { userCode = 'GATE-0002' } = {}) {
    state.connect = { userCode };
    const oauth = async (route) => {
        const req = route.request();
        state.requests.push({ method: req.method(), path: `oauth:${new URL(req.url()).pathname}` });
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: DEVICE_FLOW_CORS });
        const path = new URL(req.url()).pathname;
        if (path.endsWith('/login/device/code')) {
            return fulfillDeviceFlowJson(route, 200, { device_code: 'gate-device-code', user_code: userCode, verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
        }
        if (path.endsWith('/login/oauth/access_token')) {
            return fulfillDeviceFlowJson(route, 200, { access_token: state.token, token_type: 'bearer', scope: '' });
        }
        return fulfillDeviceFlowJson(route, 404, { error: 'not_found' });
    };
    const context = page.context();
    await context.route('https://bookshelf-oauth-proxy.asayake-hahero.workers.dev/**', oauth);
    await context.route('https://github.com/login/**', oauth);
}
