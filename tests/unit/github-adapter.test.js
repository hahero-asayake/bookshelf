// GitHubAdapter のテスト (イシュー#142)
// fetch をモックして 409 リトライ/リモート変更検知/422 分離/同一パス直列化を、
// writeJSON 等の公開メソッド経由 (経路を通す形) で確認する。
import { describe, it, expect, beforeEach, vi } from 'vitest';

await import('../../js/storage-adapter.js');
await import('../../js/github-adapter.js');
const { GitHubAdapter, GitHubConflictError, GitHubValidationError, GitHubRemoteChangedError } = globalThis;

const OWNER = 'o';
const REPO = 'r';
const TOKEN = 't';

// opts.treeFails=true(既定): R(イシュー#391)のtree一括取得(ref/commit/tree の3本)を
// 既存の handlerQueue を消費せず即座に404で失敗させる(=既存テストは全てtree取得失敗→個別取得
// フォールバックの経路を通る)。R機能自体(成功時のキャッシュヒット/sha不一致)は後述の
// 専用describeで opts.treeFails:false + 個別モックを組んで確認する。
function mockFetch(handlerQueue, opts = {}) {
    const { treeFails = true } = opts;
    const calls = [];
    const fn = vi.fn(async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase();
        calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
        if (treeFails && (url.includes('/git/refs/heads/') || url.includes('/git/commits/') || url.includes('/git/trees/'))) {
            return new Response('{}', { status: 404 });
        }
        const handler = handlerQueue.shift();
        if (!handler) throw new Error(`no more mock handlers (calls so far: ${calls.length}, last url: ${url})`);
        return handler({ url, method, calls });
    });
    globalThis.fetch = fn;
    return { fn, calls };
}

function b64(text) {
    return Buffer.from(text, 'utf-8').toString('base64');
}

function contentRes(text, sha, status = 200) {
    return new Response(JSON.stringify({ type: 'file', sha, content: b64(text) }), { status });
}

function putOkRes(sha) {
    return new Response(JSON.stringify({ content: { sha } }), { status: 200 });
}

function putConflictRes() {
    return new Response(JSON.stringify({ message: 'sha does not match', status: '409' }), { status: 409 });
}

function putValidationRes(message) {
    return new Response(JSON.stringify({ message, status: '422' }), { status: 422 });
}

let adapter;
let warnSpy, errorSpy;
beforeEach(() => {
    adapter = new GitHubAdapter({ owner: OWNER, repo: REPO, token: TOKEN });
    adapter._shaCacheEnabled = true; // R(イシュー#391)を既定で有効化(②指示2026-10-29)
    try { localStorage.clear(); } catch (_) { /* jsdom以外の環境では無視 */ }
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('409: リトライで回復するケース (自分の sha キャッシュが古かっただけ)', () => {
    it('リモート本文が自分の最終認識と同じなら、リロードなしで1回リトライして回復する', async () => {
        // 1回目の write: sha未キャッシュ→GET(既存: sha=s1, body="A")→PUT(s1)→409
        // リトライ: GET(最新: sha=s2, body="A" ※内容は変わっていない=sha管理のズレのみ)→PUT(s2)→200
        const { calls } = mockFetch([
            () => contentRes('A', 's1'),      // 初回 write 内の GET (sha未キャッシュ)
            () => putConflictRes(),           // 初回 PUT → 409
            () => contentRes('A', 's2'),      // リカバリの GET (本文は "A" のまま = 変更なし)
            () => putOkRes('s3'),             // リトライ PUT → 成功
        ]);

        await adapter.writeText('p.json', 'B'); // 新しい内容 "B" を書き込もうとする

        expect(calls.filter(c => c.method === 'PUT').length).toBe(2);
        expect(adapter._shaCache.get('p.json')).toBe('s3');
        expect(adapter._lastKnownContent.get('p.json')).toBe('B');
        // リトライが発火したことがログに残る (後から発生頻度を追えるように)
        expect(warnSpy).toHaveBeenCalled();
    });

    it('リトライ成功後、続けて呼んでも(リロードなしで)通常どおり書き込める', async () => {
        mockFetch([
            () => contentRes('A', 's1'),
            () => putConflictRes(),
            () => contentRes('A', 's2'),
            () => putOkRes('s3'),
        ]);
        await adapter.writeText('p.json', 'B');

        // 2回目の書き込みは通常経路 (409なし)
        mockFetch([
            () => putOkRes('s4'),
        ]);
        await adapter.writeText('p.json', 'C');
        expect(adapter._shaCache.get('p.json')).toBe('s4');
    });
});

describe('409: リモートで本文が実際に変わっているケース (他タブ/他デバイスの編集)', () => {
    it('盲目的に上書きせず GitHubRemoteChangedError を投げる', async () => {
        // 事前に readText で "A" を認識済みにしておく
        mockFetch([() => contentRes('A', 's1')]);
        await adapter.readText('p.json');

        // write: 現在キャッシュ済みの sha=s1 で PUT → 409
        // リカバリの GET で本文が "X" (自分の認識 "A" とは違う=他者が変えた) を返す
        mockFetch([
            () => putConflictRes(),
            () => contentRes('X', 's2'),
        ]);

        await expect(adapter.writeText('p.json', 'B')).rejects.toThrow(GitHubRemoteChangedError);
        // 上書き用の PUT は発行されていないこと(2回目のPUTが飛んでいない)を確認
        expect(errorSpy).toHaveBeenCalled();
    });

    it('リモートが削除されていた場合も上書きせず GitHubRemoteChangedError (削除後の無条件再作成を防ぐ・イシュー#381・StorageAdapter.recoverFromConflict共通修正)', async () => {
        mockFetch([() => contentRes('A', 's1')]);
        await adapter.readText('p.json'); // _lastKnownContent = 'A' (存在すると認識)

        // write: sha=s1 で PUT → 409。リカバリの GET は「他タブ/他デバイスが削除した」ことを表す404
        mockFetch([
            () => putConflictRes(),
            () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
        ]);

        await expect(adapter.writeText('p.json', 'B')).rejects.toThrow(GitHubRemoteChangedError);
        expect(errorSpy).toHaveBeenCalled();
    });
});

describe('409: リトライしても本当の競合の場合', () => {
    it('2連続 409 なら GitHubConflictError を投げて失敗する', async () => {
        mockFetch([() => contentRes('A', 's1')]);
        await adapter.readText('p.json');

        mockFetch([
            () => putConflictRes(),          // 初回 PUT → 409
            () => contentRes('A', 's2'),     // リカバリGET: 本文は同じ(=リトライ許可)
            () => putConflictRes(),          // リトライ PUT → また 409 (真の競合)
        ]);
        await expect(adapter.writeText('p.json', 'B')).rejects.toThrow(GitHubConflictError);
    });
});

describe('onWriteStatus: 409リトライの発火をアプリ層へ通知する (イシュー#142)', () => {
    it('回復ケースで retrying → recovered の順に通知される', async () => {
        const statuses = [];
        adapter.onWriteStatus = (path, status) => statuses.push([path, status]);
        mockFetch([
            () => contentRes('A', 's1'),
            () => putConflictRes(),
            () => contentRes('A', 's2'),
            () => putOkRes('s3'),
        ]);
        await adapter.writeText('p.json', 'B');
        expect(statuses).toEqual([['p.json', 'retrying'], ['p.json', 'recovered']]);
    });

    it('リモート変更検知ケースで retrying → remote-changed の順に通知される', async () => {
        mockFetch([() => contentRes('A', 's1')]);
        await adapter.readText('p.json');
        const statuses = [];
        adapter.onWriteStatus = (path, status) => statuses.push([path, status]);
        mockFetch([
            () => putConflictRes(),
            () => contentRes('X', 's2'),
        ]);
        await adapter.writeText('p.json', 'B').catch(() => {});
        expect(statuses).toEqual([['p.json', 'retrying'], ['p.json', 'remote-changed']]);
    });

    it('真の競合ケースで retrying → conflict の順に通知される', async () => {
        mockFetch([() => contentRes('A', 's1')]);
        await adapter.readText('p.json');
        const statuses = [];
        adapter.onWriteStatus = (path, status) => statuses.push([path, status]);
        mockFetch([
            () => putConflictRes(),
            () => contentRes('A', 's2'),
            () => putConflictRes(),
        ]);
        await adapter.writeText('p.json', 'B').catch(() => {});
        expect(statuses).toEqual([['p.json', 'retrying'], ['p.json', 'conflict']]);
    });
});

describe('GET のキャッシュ抑止 (イシュー#150: ブラウザHTTPキャッシュにより「リトライ後も409」が再発した根治)', () => {
    // 実測 (gh api -i): GitHub Contents API の GET は Cache-Control: private, max-age=60 を返す。
    // GET(?ref=main付き)とPUT(クエリ無し)はURLが違うため、PUT成功時のブラウザ自動キャッシュ無効化が
    // 効かず、60秒間ブラウザキャッシュから古い sha が返り続けることがある。_recoverFromConflictAndRetry
    // がこの古いレスポンスを「取り直した最新」として信じてしまうと、実際には競合していないのに
    // 何度リトライしても 409 になる。cache:'no-store' で必ずネットワークから最新を取ることで解消する。
    it('_getContent の GET は cache: no-store を指定する', async () => {
        // このテストは「1回目のfetch呼び出し引数」を直接見るため、R(tree一括取得)を迂回する。
        adapter._shaCacheEnabled = false;
        const { calls } = mockFetch([() => contentRes('A', 's1')]);
        await adapter.readText('p.json');
        const getCall = calls.find(c => c.method === 'GET');
        expect(getCall).toBeTruthy();
        // mockFetch は init をそのまま fetch へ渡す実装のため、calls には body しか積んでいないので
        // ここでは fn の呼び出し引数を直接確認する。
        const fn = globalThis.fetch;
        const initArg = fn.mock.calls[0][1];
        expect(initArg.cache).toBe('no-store');
    });

    it('commitBatch の ref 取得 GET も cache: no-store を指定する', async () => {
        // commitBatch 自身が /git/refs,commits,trees/ を使うため、R(イシュー#391)のtree自動404化とは
        // 別物として扱う(readJSON/readTextを呼ばないテストなのでR自体は発動しない)。
        mockFetch([
            () => new Response(JSON.stringify({ object: { sha: 'refsha1' } }), { status: 200 }),
            () => new Response(JSON.stringify({ tree: { sha: 'treesha1' } }), { status: 200 }),
            () => new Response(JSON.stringify({ sha: 'blobsha1' }), { status: 200 }),
            () => new Response(JSON.stringify({ sha: 'newtreesha1' }), { status: 200 }),
            () => new Response(JSON.stringify({ sha: 'newcommitsha1' }), { status: 200 }),
            () => new Response(JSON.stringify({ object: { sha: 'newcommitsha1' } }), { status: 200 }),
        ], { treeFails: false });
        adapter.beginBatch();
        adapter.addBatchEntry('p.json', 'B');
        await adapter.commitBatch();
        const fn = globalThis.fetch;
        const refGetCall = fn.mock.calls.find(([url, init]) => url.includes('/git/refs/heads/') && (init.method || 'GET').toUpperCase() === 'GET');
        expect(refGetCall[1].cache).toBe('no-store');
    });

    it('ブラウザキャッシュが古い sha を返し続ける状況でも、cache:no-store により直列化2本目の書き込みが409にならず成功する', async () => {
        // 実ブラウザの HTTP キャッシュを模擬: cache:'no-store' が指定されない GET は、
        // そのURLへの最初のレスポンスを (サーバー側の状態が進んでも) 返し続ける。
        let serverSha = 's1';
        const staleCache = new Map();
        globalThis.fetch = vi.fn(async (url, init = {}) => {
            const method = (init.method || 'GET').toUpperCase();
            if (method === 'GET') {
                if (init.cache !== 'no-store') {
                    if (!staleCache.has(url)) staleCache.set(url, serverSha);
                    return contentRes('A', staleCache.get(url)); // キャッシュされた古い sha を返す
                }
                return contentRes('A', serverSha); // no-store は必ず最新
            }
            if (method === 'PUT') {
                const body = JSON.parse(init.body);
                if (body.sha !== serverSha) return putConflictRes();
                serverSha = 's2';
                return putOkRes(serverSha);
            }
            throw new Error('unexpected method ' + method);
        });

        // 1本目の書き込み (直列化された前段の書き込みが成功し、サーバー側の sha が s1→s2 に進む)
        await adapter.writeText('p.json', 'B');
        expect(serverSha).toBe('s2');

        // 2本目の書き込み: _shaCache をクリアし「まだ自分のキャッシュにshaを持っていない」状態から
        // 始める (#150 の実ログで、公開1回のうちに articles.json へ複数回書き込みが連続した状況を模す)。
        adapter._shaCache.delete('p.json');
        // GET(?ref=main相当のURL)には s1 の古いレスポンスがキャッシュされている想定だが、
        // _getContent が cache:'no-store' を指定するため実際には最新の s2 を取得し、
        // 1回で PUT が成功する (修正前は staleCache の s1 を掴んで 409→リトライしても409 になっていた)。
        await adapter.writeText('p.json', 'C');
        expect(adapter._shaCache.get('p.json')).toBe('s2');
        expect(adapter._lastKnownContent.get('p.json')).toBe('C');
    });
});

describe('422: sha 不一致以外のバリデーションエラー', () => {
    it('409 とは別の GitHubValidationError を、レスポンスボディ付きで投げる', async () => {
        mockFetch([
            () => contentRes('A', 's1'),
            () => putValidationRes('content is not a valid base64 string'),
        ]);
        const err = await adapter.writeText('p.json', 'B').catch(e => e);
        expect(err).toBeInstanceOf(GitHubValidationError);
        expect(err.detail).toContain('content is not a valid base64 string');
        expect(err).not.toBeInstanceOf(GitHubConflictError);
    });
});

describe('同一パスへの並行書き込みの直列化', () => {
    it('同じ path への2つの writeText 呼び出しが直列に実行される (2本目が1本目の完了を待つ)', async () => {
        const order = [];
        let resolveFirst;
        const firstGate = new Promise(r => { resolveFirst = r; });

        const fn = vi.fn(async (url, init = {}) => {
            const method = (init.method || 'GET').toUpperCase();
            if (method === 'GET') return contentRes('A', 's1');
            if (method === 'PUT') {
                const body = JSON.parse(init.body);
                const text = Buffer.from(body.content, 'base64').toString('utf-8');
                if (text === 'first') {
                    order.push('first-start');
                    await firstGate; // 1本目のPUTを意図的に足止め
                    order.push('first-end');
                    return putOkRes('s2');
                }
                order.push('second');
                return putOkRes('s3');
            }
            throw new Error('unexpected method ' + method);
        });
        globalThis.fetch = fn;

        const p1 = adapter.writeText('p.json', 'first');
        const p2 = adapter.writeText('p.json', 'second'); // p1 完了前に発行

        // p1 の PUT がまだ止まっている間は、p2 の PUT がまだ来ていないはず
        await new Promise(r => setTimeout(r, 0));
        expect(order).toEqual(['first-start']);

        resolveFirst();
        await Promise.all([p1, p2]);

        expect(order).toEqual(['first-start', 'first-end', 'second']);
    });

    it('1本目が失敗しても2本目のキューは止まらない', async () => {
        mockFetch([
            () => contentRes('A', 's1'),
            () => putValidationRes('bad content'), // 1本目失敗 (422)
            () => putOkRes('s2'),                  // 2本目は成功
        ]);
        const p1 = adapter.writeText('p.json', 'first').catch(e => e);
        const p2 = adapter.writeText('p.json', 'second');
        const [r1] = await Promise.all([p1, p2]);
        expect(r1).toBeInstanceOf(GitHubValidationError);
        expect(adapter._shaCache.get('p.json')).toBe('s2');
    });
});

describe('readText の hooks 透過 (イシュー#156: 段階トレースがfetchのヘッダ受領/ボディ読了を区別するための経路)', () => {
    it('readText(path, hooks) の hooks が実際の fetch まで届き、onHeaders → onBody の順に呼ばれる', async () => {
        mockFetch([() => contentRes('本文', 's1')]);
        const order = [];
        const text = await adapter.readText('p.json', {
            onHeaders: () => order.push('headers'),
            onBody: () => order.push('body')
        });
        expect(text).toBe('本文');
        expect(order).toEqual(['headers', 'body']);
    });

    it('hooks を渡さなくても従来どおり動作する (計装は完全にoptional)', async () => {
        mockFetch([() => contentRes('本文', 's1')]);
        expect(await adapter.readText('p.json')).toBe('本文');
    });
});

describe('R: tree一括sha取得による差分のみ取得 (イシュー#391・②指示2026-10-29で既定有効化)', () => {
    function treeOkHandlers(shaForPath) {
        return [
            () => new Response(JSON.stringify({ object: { sha: 'commitsha1' } }), { status: 200 }),
            () => new Response(JSON.stringify({ tree: { sha: 'treesha1' } }), { status: 200 }),
            () => new Response(JSON.stringify({ tree: [{ path: 'p.json', type: 'blob', sha: shaForPath }] }), { status: 200 }),
        ];
    }

    it('初回読み込みはローカルキャッシュが無いため通常どおり本文を取得し、localStorageへ保存する', async () => {
        mockFetch([...treeOkHandlers('sha-remote-1'), () => contentRes('{"a":1}', 'sha-remote-1')], { treeFails: false });
        const data = await adapter.readJSON('p.json');
        expect(data).toEqual({ a: 1 });
        const key = `virtualBookshelf_ghShaCache_${OWNER}/${REPO}/main`;
        const saved = JSON.parse(localStorage.getItem(key));
        expect(saved['p.json'].version).toBe('sha-remote-1');
        expect(saved['p.json'].text).toBe('{"a":1}');
    });

    it('前回保存したshaと最新shaが一致すれば、本文取得(contents API)を呼ばずローカル保存分を返す', async () => {
        const key = `virtualBookshelf_ghShaCache_${OWNER}/${REPO}/main`;
        localStorage.setItem(key, JSON.stringify({ 'p.json': { version: 'sha-same', text: '{"cached":true}' } }));
        // handlerQueue には contents API 用のハンドラを積まない = 呼ばれたら「no more mock handlers」で落ちる
        mockFetch([...treeOkHandlers('sha-same')], { treeFails: false });
        const data = await adapter.readJSON('p.json');
        expect(data).toEqual({ cached: true });
        const fn = globalThis.fetch;
        const contentsCalls = fn.mock.calls.filter(([url]) => url.includes('/contents/'));
        expect(contentsCalls.length).toBe(0); // 本文取得が発生していないこと
    });

    it('shaが変わっていれば通常どおり本文を取り直し、ローカルキャッシュを更新する', async () => {
        const key = `virtualBookshelf_ghShaCache_${OWNER}/${REPO}/main`;
        localStorage.setItem(key, JSON.stringify({ 'p.json': { version: 'sha-old', text: '{"old":true}' } }));
        mockFetch([...treeOkHandlers('sha-new'), () => contentRes('{"new":true}', 'sha-new')], { treeFails: false });
        const data = await adapter.readJSON('p.json');
        expect(data).toEqual({ new: true });
        const saved = JSON.parse(localStorage.getItem(key));
        expect(saved['p.json'].version).toBe('sha-new');
    });

    it('fallback: tree取得が失敗(404)しても通常のcontents API取得にフォールバックして動作する', async () => {
        // mockFetch既定(treeFails:true)でref/commit/treeが自動404になる状況そのもの
        mockFetch([() => contentRes('{"x":1}', 'sha-x')]);
        const data = await adapter.readJSON('p.json');
        expect(data).toEqual({ x: 1 });
    });

    it('同期先・リポジトリが変われば localStorage のキーも分かれる', async () => {
        const other = new GitHubAdapter({ owner: 'o2', repo: 'r2', branch: 'dev', token: TOKEN });
        expect(adapter._versionCache.ns).toBe(`virtualBookshelf_ghShaCache_${OWNER}/${REPO}/main`);
        expect(other._versionCache.ns).toBe('virtualBookshelf_ghShaCache_o2/r2/dev');
    });
});
