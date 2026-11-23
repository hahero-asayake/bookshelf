// イシュー#771 step1: GitHub でも、応答の消えた自分の書き込みを「他の場所で更新されています」と見誤る（H1）回帰。
// 直しはまだ＝it.fails で今の誤検出を固定（step4 で it に戻す）。
import { describe, it, expect, beforeEach, vi } from 'vitest';

await import('../../js/storage-adapter.js');
await import('../../js/github-adapter.js');
await import('../../js/storage.js');
const { GitHubAdapter, GitHubRemoteChangedError } = globalThis;

const b64 = (t) => Buffer.from(t, 'utf-8').toString('base64');
const contentRes = (t, sha) => new Response(JSON.stringify({ type: 'file', sha, content: b64(t) }), { status: 200 });
const putOkRes = (sha) => new Response(JSON.stringify({ content: { sha } }), { status: 200 });
const putConflictRes = () => new Response(JSON.stringify({ message: 'sha does not match', status: '409' }), { status: 409 });

function mockFetch(queue) {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
        const method = (init.method || 'GET').toUpperCase();
        calls.push({ url, method, sha: init.body ? JSON.parse(init.body).sha : undefined });
        if (url.includes('/git/refs/heads/') || url.includes('/git/commits/') || url.includes('/git/trees/')) return new Response('{}', { status: 404 });
        const h = queue.shift();
        if (!h) throw new Error(`no more mock handlers (${method} ${url})`);
        return h();
    });
    return calls;
}

let adapter;
beforeEach(() => {
    adapter = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' });
    adapter._shaCacheEnabled = true;
    try { localStorage.clear(); } catch (_) { /* noop */ }
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

// 手順: 読む(s1/A) → 書く B（保存先には入り s2 になったが応答が消える）→ 書く C（sha=s1 で 409）→ 最新を取り直すと B（自分の版）
const steps = () => [
    () => contentRes('A', 's1'),                               // read
    () => { throw new TypeError('Load failed'); },             // PUT B（保存先には入った想定）
    () => putConflictRes(),                                    // PUT C（sha=s1）→ 409
    () => contentRes('B', 's2'),                               // 取り直し＝自分の B
    () => putOkRes('s3'),                                      // （直した後に期待する）再送
];

describe('#771 H1 GitHub 応答の消えた自分の書き込み', () => {
    it.fails('応答が消えた後の次の保存が「他の場所で更新」にならない', async () => {
        mockFetch(steps());
        await adapter.readText('private/articles.json');
        await expect(adapter.writeText('private/articles.json', 'B')).rejects.toThrow();
        await adapter.writeText('private/articles.json', 'C');
    });

    it('（現状の固定）GitHubRemoteChangedError が出る＝誤検出', async () => {
        const calls = mockFetch(steps());
        await adapter.readText('private/articles.json');
        await expect(adapter.writeText('private/articles.json', 'B')).rejects.toThrow();
        await expect(adapter.writeText('private/articles.json', 'C')).rejects.toBeInstanceOf(GitHubRemoteChangedError);
        expect(calls.filter((c) => c.method === 'PUT').map((c) => c.sha)).toEqual(['s1', 's1']);
    });
});
