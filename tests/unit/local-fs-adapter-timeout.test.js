// LocalFSAdapter.readText/readJSON のタイムアウト保護 (回帰テスト・イシュー#153 H3)
// File System Access API は AbortController を受け付けないため、StorageAdapter.withTimeout
// (Promise.race ベースの汎用タイムアウト) で覆っている。権限プロンプト待ち・ハンドル失効時の
// 無期限pendingを模した dirHandle で、既定10秒でタイムアウトエラーになることを確認する。
import { describe, it, expect, vi } from 'vitest';

await import('../../js/storage-adapter.js');
await import('../../js/local-fs-adapter.js');
const { LocalFSAdapter } = globalThis;

function makeHangingDirHandle() {
    return { getFileHandle: () => new Promise(() => {}) };
}
function makeResolvingDirHandle(text) {
    return {
        getFileHandle: async () => ({
            getFile: async () => ({ text: async () => text })
        })
    };
}

describe('LocalFSAdapter: readText/readJSON のタイムアウト保護 (回帰テスト・イシュー#153 H3)', () => {
    it('readText が FS API 呼び出しでハングしても既定10秒でタイムアウトエラーになる', async () => {
        vi.useFakeTimers();
        try {
            const adapter = new LocalFSAdapter();
            adapter.setDirHandle(makeHangingDirHandle());
            const p = adapter.readText('x.md');
            const assertion = expect(p).rejects.toThrow(/タイムアウト/);
            await vi.advanceTimersByTimeAsync(10000);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });

    it('readJSON が FS API 呼び出しでハングしても既定10秒でタイムアウトエラーになる', async () => {
        vi.useFakeTimers();
        try {
            const adapter = new LocalFSAdapter();
            adapter.setDirHandle(makeHangingDirHandle());
            const p = adapter.readJSON('library.json');
            const assertion = expect(p).rejects.toThrow(/タイムアウト/);
            await vi.advanceTimersByTimeAsync(10000);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });

    it('正常系 (ハングしない) は従来どおり内容を返す', async () => {
        const adapter = new LocalFSAdapter();
        adapter.setDirHandle(makeResolvingDirHandle('# 長文メモ本文'));
        await expect(adapter.readText('x.md')).resolves.toBe('# 長文メモ本文');
    });

    it('正常系 (10秒未満で解決) はタイムアウトせず内容を返す', async () => {
        vi.useFakeTimers();
        try {
            const adapter = new LocalFSAdapter();
            adapter.setDirHandle({
                getFileHandle: () => new Promise((resolve) => {
                    setTimeout(() => resolve({ getFile: async () => ({ text: async () => 'ok' }) }), 5000);
                })
            });
            const p = adapter.readText('x.md');
            await vi.advanceTimersByTimeAsync(5000);
            await expect(p).resolves.toBe('ok');
        } finally {
            vi.useRealTimers();
        }
    });
});
