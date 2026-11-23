// イシュー#771: GitHub でも、応答の消えた自分の書き込みを「他の場所で更新されています」と見誤る（H1）回帰。
// step4 で直した（結果待ちの記録＋StorageAdapter.recoverFromConflict の (1)(2)）。'0' で前の形に戻る。
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
    it('応答が消えた後の次の保存が「他の場所で更新」にならない（最新＝自分の B → s2 で1回だけ送り直す）', async () => {
        const calls = mockFetch(steps());
        await adapter.readText('private/articles.json');
        await expect(adapter.writeText('private/articles.json', 'B')).rejects.toThrow();
        await adapter.writeText('private/articles.json', 'C');
        expect(calls.filter((c) => c.method === 'PUT').map((c) => c.sha)).toEqual(['s1', 's1', 's2']);
        expect(adapter._shaCache.get('private/articles.json')).toBe('s3');
        expect(adapter._pendingWrites.has('private/articles.json')).toBe(false);
    });

    it('応答が消えた後、同じ中身の再送は送らずに成功する', async () => {
        const calls = mockFetch([
            () => contentRes('A', 's1'),
            () => { throw new TypeError('Load failed'); },
            () => putConflictRes(),
            () => contentRes('B', 's2'),
        ]);
        await adapter.readText('private/articles.json');
        await expect(adapter.writeText('private/articles.json', 'B')).rejects.toThrow();
        await adapter.writeText('private/articles.json', 'B');
        expect(calls.filter((c) => c.method === 'PUT').length).toBe(2);
        expect(adapter._shaCache.get('private/articles.json')).toBe('s2');
    });

    it('応答が消えた後に別の端末が書いていたら、今までどおり GitHubRemoteChangedError', async () => {
        mockFetch([
            () => contentRes('A', 's1'),
            () => { throw new TypeError('Load failed'); },
            () => putConflictRes(),
            () => contentRes('X（他の端末）', 's9'),
        ]);
        await adapter.readText('private/articles.json');
        await expect(adapter.writeText('private/articles.json', 'B')).rejects.toThrow();
        await expect(adapter.writeText('private/articles.json', 'C')).rejects.toBeInstanceOf(GitHubRemoteChangedError);
    });

    it("切り替え bookshelf.flag.ownWriteMatch='0' では前の形（GitHubRemoteChangedError＝誤検出）", async () => {
        localStorage.setItem('bookshelf.flag.ownWriteMatch', '0');
        const calls = mockFetch(steps());
        await adapter.readText('private/articles.json');
        await expect(adapter.writeText('private/articles.json', 'B')).rejects.toThrow();
        await expect(adapter.writeText('private/articles.json', 'C')).rejects.toBeInstanceOf(GitHubRemoteChangedError);
        expect(calls.filter((c) => c.method === 'PUT').map((c) => c.sha)).toEqual(['s1', 's1']);
    });
});

describe('#771 H2 GitHub 読みが書きに追い越される', () => {
    it('書き込み中に始まった読みの応答が後から届いても、控えを古い版に戻さない', async () => {
        let release;
        let readStarted = false;
        const hold = new Promise((r) => { release = r; });
        adapter._shaCacheEnabled = false; // 木の一覧を使わず、本文の GET を直接止める
        mockFetch([
            async () => { readStarted = true; await hold; return contentRes('A', 's1'); }, // 読み（古い A を掴んだまま止まる）
            () => putOkRes('s2'),                                      // 書く B（控えの s1 で送る）
            () => putOkRes('s3'),                                      // 書く C（s2 で通る）
        ]);
        adapter._shaCache.set('private/articles.json', 's1');
        adapter._lastKnownContent.set('private/articles.json', 'A');
        const reading = adapter.readText('private/articles.json');
        await vi.waitFor(() => expect(readStarted).toBe(true));
        await adapter.writeText('private/articles.json', 'B');
        release();
        expect(await reading).toBe('A');
        expect(adapter._shaCache.get('private/articles.json')).toBe('s2'); // 読みの s1 で巻き戻らない
        await adapter.writeText('private/articles.json', 'C');
        expect(adapter._shaCache.get('private/articles.json')).toBe('s3');
    });
});
