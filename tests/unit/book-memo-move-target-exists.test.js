// イシュー#594 (f): 長文メモの移す先 (to) が保存先に既にある時は、上書きも元 (from) の削除もしない。
// まとめ保存はどの保存先でも既にあるファイルへの put を止めない (step2 の実測: ハブも GitHub も上書きした) ので、
// takeBookMemoOps が保存の前に adapter.fileExists(to) で確かめる。その確かめが3つの保存先の本物の
// adapter (GitHubAdapter・HubStorageAdapter・LocalFSAdapter) の fileExists / readText で効くことを見る。
// 通信・フォルダの一番下 (GitHub=_getContent・ハブ=_fetch と ETag 一覧・ローカル=_resolveDir) だけを差し替える。
import { describe, it, expect, beforeEach } from 'vitest';

let idCounter = 0;
globalThis.generateInternalId = () => `gen${++idCounter}`;
await import('../../js/storage-adapter.js');
await import('../../js/github-adapter.js');
await import('../../js/hub-adapter.js');
await import('../../js/local-fs-adapter.js');
await import('../../js/storage.js');

const { BookshelfStorage, GitHubAdapter, HubStorageAdapter, LocalFSAdapter } = window;
const KEY = 'virtualBookshelf_pendingShelfDeletes';
const FROM = 'private/books/A1__旧.md';
const TO = 'private/books/A1__新.md';

function githubWith(files) {
    const a = new GitHubAdapter({ owner: 'o', repo: 'r', token: 't' });
    a._getContent = async (p) => (files[p] == null ? null
        : { type: 'file', sha: `sha-${p}`, content: Buffer.from(files[p], 'utf8').toString('base64'), encoding: 'base64' });
    return a;
}

function hubWith(files) {
    const a = new HubStorageAdapter({ apiBase: 'https://hub.test', getKey: () => 'hk_test' });
    a._ensureRemoteEtagMap = async () => ({});
    a._fetch = async (_method, url, init = {}) => {
        const p = decodeURIComponent(url.split('/data/')[1] || '');
        const has = files[p] != null;
        return {
            status: has ? 200 : 404,
            ok: has,
            headers: { get: (h) => (h.toLowerCase() === 'etag' && has ? '"e1"' : null) },
            body: init.method === 'HEAD' ? '' : (has ? files[p] : '')
        };
    };
    return a;
}

function localWith(files) {
    const a = new LocalFSAdapter();
    const notFound = () => { const e = new Error('not found'); e.name = 'NotFoundError'; return e; };
    a._resolveDir = async () => ({
        getFileHandle: async (name) => {
            const p = `private/books/${name}`;
            if (files[p] == null) throw notFound();
            return { getFile: async () => ({ text: async () => files[p] }) };
        }
    });
    return a;
}

const BACKENDS = [
    ['GitHubAdapter', githubWith],
    ['HubStorageAdapter', hubWith],
    ['LocalFSAdapter', localWith]
];

beforeEach(() => localStorage.removeItem(KEY));

describe.each(BACKENDS)('%s: 移す先が既にある時は上書きも元の削除もしない', (_name, make) => {
    it('to が既にある → 書き込み・削除を何も載せず、記録は外す', async () => {
        const storage = new BookshelfStorage(make({ [FROM]: '旧の本文', [TO]: '他の端末の本文' }));
        storage.queueBookMemoMove(FROM, TO);
        const ops = await storage.takeBookMemoOps([TO]);
        expect(ops.entries).toEqual([]);
        expect(JSON.parse(localStorage.getItem(KEY) || '[]')).toEqual([]);
    });

    it('to が無い → 中身を移し、元を消す', async () => {
        const storage = new BookshelfStorage(make({ [FROM]: '旧の本文' }));
        storage.queueBookMemoMove(FROM, TO);
        const ops = await storage.takeBookMemoOps([TO]);
        expect(ops.entries).toEqual([
            { op: 'put', kind: 'text', path: TO, data: '旧の本文' },
            { op: 'delete', path: FROM }
        ]);
    });
});
