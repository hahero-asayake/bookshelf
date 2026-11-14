// 模擬の保存先 (イシュー#587): GitHub とローカルフォルダ。
//
// 保存先を再現し、テストから「いまどのファイルが残っているか」「どんな削除要求が来たか」を読めるようにする。
// GitHub の状態は Node 側にあるので、ページを再読込しても残る。
//
// ハブ (Asayake ハブ) の模擬はここには無い。tests/e2e/helpers/gate-hub.js の1本にまとめた (イシュー#598)。
// 保存先3つを同じ形で回す spec は、ハブの分を gate-hub.js の hubStoreForTest で読む
// (has / readJSON / list / writes / deleteRequests / failNextWrites / failuresLeft。installFakeGitHub の返り値と同じ名前)。

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,PUT,POST,DELETE,HEAD,OPTIONS',
    'access-control-expose-headers': 'ETag'
};

// ===== GitHub =====
//
// GitHub の REST API (api.github.com) のうち、js/github-adapter.js が使う分を Node 側で再現する:
//   GET    /repos/{o}/{r}                         リポジトリ情報
//   GET    /repos/{o}/{r}/contents/{path}?ref=    ファイル (base64) / ディレクトリ (配列) / 無ければ 404
//   PUT    /repos/{o}/{r}/contents/{path}         作成・更新 (sha 不一致は 409・既存なのに sha 無しは 422)
//   DELETE /repos/{o}/{r}/contents/{path}         削除 (無ければ 404・sha 不一致は 409)
//   GET    /repos/{o}/{r}/git/refs/heads/{b}      → commit sha
//   GET    /repos/{o}/{r}/git/commits/{sha}       → tree sha
//   GET    /repos/{o}/{r}/git/trees/{sha}?recursive=1
//   POST   /repos/{o}/{r}/git/blobs | git/trees | git/commits、PATCH git/refs/heads/{b}  (まとめ保存=1 commit)
//
// Trees API の削除 (tree の要素を sha:null にする) は、土台の tree に無いパスだとエラーになる。
// 公式ドキュメント (https://docs.github.com/en/rest/git/trees の "Create a tree") に
// "Returns an error if you try to delete a file that does not exist." とある。返る状態コードは
// 同ページに個別の記載が無く、一覧にある 422 (Validation failed) をここでは返す (コードは未確認の仮置き)。

export const FAKE_GITHUB = { owner: 'fake-owner', repo: 'fake-bookshelf-data', branch: 'main' };

/**
 * GitHub API の模擬を page に取り付ける。返り値の読み口はハブの模擬 (gate-hub.js の hubStoreForTest) と同じ
 * (has / readJSON / list / writes / deleteRequests / failNextWrites)。加えて commitCount() で commit 数を読める。
 * @param {import('@playwright/test').Page} page
 * @param {{ owner?: string, repo?: string, branch?: string }} [opts]
 */
export async function installFakeGitHub(page, { owner = FAKE_GITHUB.owner, repo = FAKE_GITHUB.repo, branch = FAKE_GITHUB.branch } = {}) {
    const files = new Map();     // path → { sha, content }
    const blobs = new Map();     // blob sha → 本文
    const trees = new Map();     // tree sha → Map(path → blob sha)
    const commits = new Map();   // commit sha → { tree, parents }
    const writes = [];
    const deleteRequests = [];
    const state = { seq: 0, failWrites: 0, failStatus: 500, head: null, commitCount: 0 };

    const newSha = (kind) => `${kind}${String(++state.seq).padStart(7, '0')}`.padEnd(40, '0');
    const snapshot = () => new Map([...files].map(([p, f]) => [p, f.sha]));
    // いまの files を 1 commit として積む (Contents API の PUT/DELETE は 1 操作 = 1 commit)
    const commitFiles = () => {
        const treeSha = newSha('t');
        trees.set(treeSha, snapshot());
        const commitSha = newSha('c');
        commits.set(commitSha, { tree: treeSha, parents: state.head ? [state.head] : [] });
        state.head = commitSha;
        state.commitCount++;
    };
    commitFiles(); // 空のリポジトリ (最初の commit だけある状態)
    state.commitCount = 0;

    const shouldFailWrite = () => {
        if (state.failWrites <= 0) return false;
        state.failWrites--;
        return true;
    };
    const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
    const unb64 = (s) => Buffer.from(String(s || ''), 'base64').toString('utf8');
    const base = `https://api.github.com/repos/${owner}/${repo}`;

    await page.route('https://api.github.com/**', async (route) => {
        const req = route.request();
        const method = req.method();
        const url = new URL(req.url());
        const json = (status, body) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

        const full = `${url.origin}${decodeURIComponent(url.pathname)}`;
        if (!full.startsWith(base)) return json(404, { message: 'Not Found' });
        const rel = full.slice(base.length).replace(/^\/+/, '');
        const body = () => JSON.parse(req.postData() || '{}');

        if (rel === '' && method === 'GET') {
            return json(200, { default_branch: branch, private: true, permissions: { push: true, pull: true } });
        }

        if (rel === `git/refs/heads/${branch}`) {
            if (method === 'GET') return json(200, { ref: `refs/heads/${branch}`, object: { type: 'commit', sha: state.head } });
            if (method === 'PATCH') {
                if (shouldFailWrite()) return json(state.failStatus, { message: 'injected write failure' });
                const { sha } = body();
                const commit = commits.get(sha);
                if (!commit) return json(422, { message: 'Object does not exist' });
                // force:false = 早送りだけ許す (他の端末が先に進めていたら 422)
                if (!commit.parents.includes(state.head)) return json(422, { message: 'Update is not a fast forward' });
                const next = trees.get(commit.tree);
                for (const p of [...files.keys()]) {
                    if (!next.has(p)) { files.delete(p); writes.push({ op: 'delete', path: p, via: 'batch' }); }
                }
                for (const [p, blobSha] of next) {
                    const cur = files.get(p);
                    if (!cur || cur.sha !== blobSha) {
                        files.set(p, { sha: blobSha, content: blobs.get(blobSha) });
                        writes.push({ op: 'put', path: p, via: 'batch' });
                    }
                }
                state.head = sha;
                state.commitCount++;
                return json(200, { ref: `refs/heads/${branch}`, object: { type: 'commit', sha } });
            }
        }

        if (rel.startsWith('git/commits/') && method === 'GET') {
            const sha = rel.slice('git/commits/'.length);
            const commit = commits.get(sha);
            if (!commit) return json(404, { message: 'Not Found' });
            return json(200, { sha, tree: { sha: commit.tree }, parents: commit.parents.map((p) => ({ sha: p })) });
        }

        if (rel.startsWith('git/trees/') && method === 'GET') {
            const tree = trees.get(rel.slice('git/trees/'.length));
            if (!tree) return json(404, { message: 'Not Found' });
            return json(200, {
                sha: rel.slice('git/trees/'.length),
                tree: [...tree].map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha })),
                truncated: false
            });
        }

        if (rel === 'git/blobs' && method === 'POST') {
            const b = body();
            const sha = newSha('b');
            blobs.set(sha, b.encoding === 'base64' ? unb64(b.content) : String(b.content || ''));
            return json(201, { sha });
        }

        if (rel === 'git/trees' && method === 'POST') {
            const b = body();
            const baseTree = trees.get(b.base_tree);
            if (b.base_tree && !baseTree) return json(422, { message: 'base_tree is not a valid tree' });
            const next = new Map(baseTree || []);
            for (const e of (b.tree || [])) {
                if (e.sha === null) {
                    const existed = next.has(e.path);
                    deleteRequests.push({ path: e.path, via: 'batch', existed });
                    // 公式: "Returns an error if you try to delete a file that does not exist."
                    if (!existed) return json(422, { message: `Validation Failed: cannot delete ${e.path} (does not exist in base tree)` });
                    next.delete(e.path);
                } else {
                    if (!blobs.has(e.sha)) return json(422, { message: 'tree.sha does not exist' });
                    next.set(e.path, e.sha);
                }
            }
            const sha = newSha('t');
            trees.set(sha, next);
            return json(201, { sha });
        }

        if (rel === 'git/commits' && method === 'POST') {
            const b = body();
            if (!trees.has(b.tree)) return json(422, { message: 'Tree SHA does not exist' });
            const sha = newSha('c');
            commits.set(sha, { tree: b.tree, parents: b.parents || [] });
            return json(201, { sha, tree: { sha: b.tree } });
        }

        if (rel.startsWith('contents/') || rel === 'contents') {
            const path = rel.slice('contents/'.length);
            if (method === 'GET') {
                const f = files.get(path);
                if (f) {
                    return json(200, { type: 'file', name: path.split('/').pop(), path, sha: f.sha, encoding: 'base64', content: b64(f.content) });
                }
                const prefix = path ? `${path.replace(/\/+$/, '')}/` : '';
                const seen = new Map();
                for (const [p, file] of files) {
                    if (!p.startsWith(prefix)) continue;
                    const rest = p.slice(prefix.length);
                    const i = rest.indexOf('/');
                    if (i < 0) seen.set(rest, { type: 'file', name: rest, path: p, sha: file.sha });
                    else seen.set(rest.slice(0, i), { type: 'dir', name: rest.slice(0, i), path: `${prefix}${rest.slice(0, i)}`, sha: 'dir' });
                }
                if (seen.size === 0) return json(404, { message: 'Not Found' });
                return json(200, [...seen.values()]);
            }
            if (method === 'PUT') {
                if (shouldFailWrite()) return json(state.failStatus, { message: 'injected write failure' });
                const b = body();
                const cur = files.get(path);
                if (cur && !b.sha) return json(422, { message: `Invalid request.\n\n"sha" wasn't supplied.` });
                if (cur && b.sha !== cur.sha) return json(409, { message: `${path} does not match ${b.sha}` });
                if (!cur && b.sha) return json(409, { message: `${path} does not match ${b.sha}` });
                const sha = newSha('b');
                const content = unb64(b.content);
                blobs.set(sha, content);
                files.set(path, { sha, content });
                writes.push({ op: 'put', path, via: 'single' });
                commitFiles();
                return json(cur ? 200 : 201, { content: { name: path.split('/').pop(), path, sha }, commit: { sha: state.head } });
            }
            if (method === 'DELETE') {
                if (shouldFailWrite()) return json(state.failStatus, { message: 'injected write failure' });
                const b = body();
                const cur = files.get(path);
                deleteRequests.push({ path, via: 'single', existed: !!cur });
                if (!cur) return json(404, { message: 'Not Found' });
                if (b.sha !== cur.sha) return json(409, { message: `${path} does not match ${b.sha}` });
                files.delete(path);
                writes.push({ op: 'delete', path, via: 'single' });
                commitFiles();
                return json(200, { content: null, commit: { sha: state.head } });
            }
        }
        return json(404, { message: 'Not Found' });
    });

    return {
        owner, repo, branch,
        files,
        writes,
        deleteRequests,
        has: (path) => files.has(path),
        readJSON: (path) => (files.has(path) ? JSON.parse(files.get(path).content) : null),
        list: (dir) => {
            const prefix = `${String(dir).replace(/\/+$/, '')}/`;
            return [...files.keys()]
                .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
                .map((p) => p.slice(prefix.length))
                .sort();
        },
        commitCount: () => state.commitCount,
        // opts.status = 失敗で返す状態コード (既定 500。401 = トークン失効・イシュー#603)
        failNextWrites: (n = 1, { status = 500 } = {}) => { state.failWrites = n; state.failStatus = status; },
        // 注入した失敗のうち、まだ起きていない回数 (0 になったら失敗が起きた)
        failuresLeft: () => state.failWrites
    };
}

// ===== ローカルフォルダ =====
//
// 「この端末のフォルダに保存」は、利用者がフォルダ選択 (showDirectoryPicker) で選んだフォルダへ書く。
// E2E では OS のフォルダ選択を出せないので、showDirectoryPicker だけを「ブラウザ内蔵の専用フォルダ
// (navigator.storage.getDirectory()) の下のフォルダを返す関数」に差し替える。返るのは本物の
// FileSystemDirectoryHandle なので、実物の LocalFSAdapter がそのまま読み書き・削除する。
// 読み口はハブの模擬 (gate-hub.js の hubStoreForTest) と同じ名前 (has / readJSON / list) だが、ブラウザの中を読むので Promise を返す。

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ dirName?: string }} [opts]
 */
export async function installFakeLocalFolder(page, { dirName = 'bookshelf-sync-test' } = {}) {
    await page.addInitScript((name) => {
        window.showDirectoryPicker = async () => {
            const root = await navigator.storage.getDirectory();
            return root.getDirectoryHandle(name, { create: true });
        };
    }, dirName);

    // フォルダの中を読む (無ければ null)。kind: 'text' = 本文 / 'list' = 直下のファイル名
    const read = (path, kind) => page.evaluate(async ([name, p, k]) => {
        try {
            let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
            const parts = String(p).split('/').filter(Boolean);
            const last = k === 'list' ? null : parts.pop();
            for (const part of parts) dir = await dir.getDirectoryHandle(part);
            if (k === 'list') {
                const names = [];
                for await (const [n, entry] of dir.entries()) if (entry.kind === 'file') names.push(n);
                return names.sort();
            }
            return await (await (await dir.getFileHandle(last)).getFile()).text();
        } catch (e) {
            if (e && e.name === 'NotFoundError') return null;
            throw e;
        }
    }, [dirName, path, kind]);

    return {
        dirName,
        deleteRequests: [], // ローカルは要求を記録できない (フォルダの中身だけを見る)
        has: async (path) => (await read(path, 'text')) !== null,
        readJSON: async (path) => {
            const text = await read(path, 'text');
            return text === null || !text.trim() ? null : JSON.parse(text);
        },
        list: async (dir) => (await read(dir, 'list')) || []
    };
}

/**
 * ローカルフォルダへの書き込み失敗の注入 (イシュー#603)。installFakeLocalFolder の既定の動きは変えず、
 * 別に取り付ける。LocalFSAdapter が書く2つの口 (FileSystemFileHandle.createWritable と
 * FileSystemDirectoryHandle.removeEntry) を、failNextWrites(n) の後 n 回だけ失敗させる。
 * カウンタはページ側 (window) に置く＝再読込すると 0 に戻る。
 * @param {import('@playwright/test').Page} page
 * @param {{ error?: string }} [opts] error = 投げる DOMException の名前 (既定 'NoModificationAllowedError')
 */
export async function installLocalWriteFailures(page, { error = 'NoModificationAllowedError' } = {}) {
    await page.addInitScript((errName) => {
        window.__e2eLocalFailWrites = 0;
        const shouldFail = () => {
            if (!(window.__e2eLocalFailWrites > 0)) return false;
            window.__e2eLocalFailWrites--;
            return true;
        };
        const wrap = (proto, name) => {
            const orig = proto[name];
            proto[name] = function (...args) {
                if (shouldFail()) return Promise.reject(new DOMException('injected write failure', window.__e2eLocalFailName || errName));
                return orig.apply(this, args);
            };
        };
        wrap(FileSystemFileHandle.prototype, 'createWritable');
        wrap(FileSystemDirectoryHandle.prototype, 'removeEntry');
    }, error);
    return {
        // opts.error = この回だけ投げる DOMException の名前 (例 'NotFoundError' = フォルダが見つからない)
        failNextWrites: (n = 1, { error: name } = {}) => page.evaluate(([k, e]) => {
            window.__e2eLocalFailWrites = k;
            window.__e2eLocalFailName = e;
        }, [n, name || null]),
        // 注入した失敗のうち、まだ起きていない回数 (0 になったら失敗が起きた)
        failuresLeft: () => page.evaluate(() => window.__e2eLocalFailWrites)
    };
}
