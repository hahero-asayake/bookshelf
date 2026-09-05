// StorageAdapter.fetchText / fetchJSON のテスト (イシュー#134/#143)
// HubStorageAdapter/GitHubAdapter が使う fetch のタイムアウト機構そのものを検証する。
// #134 は「fetch() 自体が応答しない」ケースだけを塞いだが、#143 の実機調査で「ヘッダは即座に
// 返るが本文の送信が遅延・停止する」ケースは塞げていないことが分かった (fetch() の Promise は
// ヘッダ受信時点で resolve するため、旧実装の finally { clearTimeout } がそこで走ってしまい、
// 以後 abort が発火しなかった)。両方のケースを fake timers で確認する (実時間で待たない)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

await import('../../js/storage-adapter.js');
const { StorageAdapter } = globalThis;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// 応答しない fetch を模す: signal の abort まで一切 resolve/reject しない Promise を返す
// (ヘッダ受信すら発生しないケース)
function hangingFetch() {
    return vi.fn((url, init) => new Promise((resolve, reject) => {
        if (init && init.signal) {
            init.signal.addEventListener('abort', () => {
                const err = new Error('The operation was aborted.');
                err.name = 'AbortError';
                reject(err);
            });
        }
    }));
}

// ヘッダは即座に返すが、本文 (res.text()) が abort されるまで一切 resolve しない Response を模す。
// #143 で見つかった「時限装置が本文送信中に解除される」欠陥そのものを再現する。
function bodyStallResponse() {
    let rejectBody;
    const bodyPromise = new Promise((_resolve, reject) => { rejectBody = reject; });
    return {
        status: 200,
        ok: true,
        statusText: 'OK',
        headers: new Headers(),
        text: () => bodyPromise,
        json: () => bodyPromise,
        _stallReject(signal) {
            signal.addEventListener('abort', () => {
                const err = new Error('The operation was aborted.');
                err.name = 'AbortError';
                rejectBody(err);
            });
        }
    };
}

function bodyStallFetch() {
    return vi.fn((url, init) => new Promise((resolve) => {
        const res = bodyStallResponse();
        if (init && init.signal) res._stallReject(init.signal);
        resolve(res);
    }));
}

describe('StorageAdapter.fetchText', () => {
    it('fetch() 自体が応答無いまま既定10秒 (10000ms) が経過すると、タイムアウトを表す Error で reject する', async () => {
        globalThis.fetch = hangingFetch();
        const p = StorageAdapter.fetchText('https://example.test/data/x');
        const assertion = expect(p).rejects.toThrow(/タイムアウトしました \(10000ms\)/);
        await vi.advanceTimersByTimeAsync(10000);
        await assertion;
    });

    it('ヘッダ受信後、本文の読み取りが既定10秒経過しても終わらない場合もタイムアウトする (イシュー#143本体)', async () => {
        globalThis.fetch = bodyStallFetch();
        const p = StorageAdapter.fetchText('https://example.test/data/x');
        const assertion = expect(p).rejects.toThrow(/タイムアウトしました \(10000ms\)/);
        await vi.advanceTimersByTimeAsync(10000);
        await assertion;
    });

    it('9999ms 時点ではまだ確定しない (早すぎるタイムアウトでないことの確認)', async () => {
        globalThis.fetch = hangingFetch();
        let settled = false;
        StorageAdapter.fetchText('https://example.test/data/x').catch(() => {});
        StorageAdapter.fetchText('https://example.test/data/x').then(() => { settled = true; }, () => { settled = true; });
        await vi.advanceTimersByTimeAsync(9999);
        expect(settled).toBe(false);
    });

    it('タイムアウト前に応答 (ヘッダ+本文) が返れば、本文まで読み切った結果を返す', async () => {
        globalThis.fetch = vi.fn((url, init) => new Promise((resolve) => {
            setTimeout(() => resolve(new Response('ok body', { status: 200 })), 3000);
        }));
        const p = StorageAdapter.fetchText('https://example.test/data/x');
        await vi.advanceTimersByTimeAsync(3000);
        const result = await p;
        expect(result.status).toBe(200);
        expect(result.ok).toBe(true);
        expect(result.body).toBe('ok body');
    });

    it('カスタム timeoutMs を指定すると、その時間で打ち切られる (本文読み取り中でも)', async () => {
        globalThis.fetch = bodyStallFetch();
        const p = StorageAdapter.fetchText('https://example.test/data/x', {}, 500);
        const assertion = expect(p).rejects.toThrow(/タイムアウトしました \(500ms\)/);
        await vi.advanceTimersByTimeAsync(500);
        await assertion;
    });
});

describe('StorageAdapter.fetchJSON', () => {
    it('本文を JSON.parse して json に入れる', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ a: 1 }), { status: 200 })));
        const result = await StorageAdapter.fetchJSON('https://example.test/data/x');
        expect(result.json).toEqual({ a: 1 });
        expect(result.body).toBe('{"a":1}');
    });

    it('本文が空なら json は null (例外を投げない)', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve(new Response('', { status: 200 })));
        const result = await StorageAdapter.fetchJSON('https://example.test/data/x');
        expect(result.json).toBeNull();
    });

    it('本文が非JSON (例: HTML エラーページ) でも例外を投げず json は null、body に生テキストが残る', async () => {
        globalThis.fetch = vi.fn(() => Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 502 })));
        const result = await StorageAdapter.fetchJSON('https://example.test/data/x');
        expect(result.json).toBeNull();
        expect(result.body).toContain('502 Bad Gateway');
    });

    it('本文送信が遅延・停止した場合もタイムアウトする', async () => {
        globalThis.fetch = bodyStallFetch();
        const p = StorageAdapter.fetchJSON('https://example.test/data/x');
        const assertion = expect(p).rejects.toThrow(/タイムアウトしました \(10000ms\)/);
        await vi.advanceTimersByTimeAsync(10000);
        await assertion;
    });
});
