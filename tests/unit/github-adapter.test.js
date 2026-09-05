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

function mockFetch(handlerQueue) {
    const calls = [];
    const fn = vi.fn(async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase();
        calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
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
