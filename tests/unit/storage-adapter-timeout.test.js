// StorageAdapter.fetchWithTimeout のテスト (イシュー#134)
// HubStorageAdapter/GitHubAdapter が使う fetch のタイムアウト機構そのものを検証する。
// 素の fetch() は「応答が来ない」だけでは失敗しない (DNS失敗等の明確なエラーとは違う) ため、
// AbortController による能動的な打ち切りが実際に効くこと・所定のミリ秒で発火することを
// fake timers で確認する (実時間で10秒待たない)。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

await import('../../js/storage-adapter.js');
const { StorageAdapter } = globalThis;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// 応答しない fetch を模す: signal の abort まで一切 resolve/reject しない Promise を返す
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

describe('StorageAdapter.fetchWithTimeout', () => {
    it('応答が無いまま既定10秒 (10000ms) が経過すると、タイムアウトを表す Error で reject する', async () => {
        globalThis.fetch = hangingFetch();
        const p = StorageAdapter.fetchWithTimeout('https://example.test/data/x');
        const assertion = expect(p).rejects.toThrow(/タイムアウトしました \(10000ms\)/);
        await vi.advanceTimersByTimeAsync(10000);
        await assertion;
    });

    it('9999ms 時点ではまだ確定しない (早すぎるタイムアウトでないことの確認)', async () => {
        globalThis.fetch = hangingFetch();
        let settled = false;
        StorageAdapter.fetchWithTimeout('https://example.test/data/x').catch(() => {});
        StorageAdapter.fetchWithTimeout('https://example.test/data/x').then(() => { settled = true; }, () => { settled = true; });
        await vi.advanceTimersByTimeAsync(9999);
        expect(settled).toBe(false);
    });

    it('タイムアウト前に応答が返れば、そのまま結果を返す (遅延はあるが打ち切りには至らない場合)', async () => {
        globalThis.fetch = vi.fn((url, init) => new Promise((resolve) => {
            setTimeout(() => resolve(new Response('ok', { status: 200 })), 3000);
        }));
        const p = StorageAdapter.fetchWithTimeout('https://example.test/data/x');
        await vi.advanceTimersByTimeAsync(3000);
        const res = await p;
        expect(res.status).toBe(200);
    });

    it('カスタム timeoutMs を指定すると、その時間で打ち切られる', async () => {
        globalThis.fetch = hangingFetch();
        const p = StorageAdapter.fetchWithTimeout('https://example.test/data/x', {}, 500);
        const assertion = expect(p).rejects.toThrow(/タイムアウトしました \(500ms\)/);
        await vi.advanceTimersByTimeAsync(500);
        await assertion;
    });
});
