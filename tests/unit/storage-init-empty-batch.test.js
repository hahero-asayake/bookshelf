// イシュー#701 (テスト監査 #690 の5番・6番): 空の保存先の初期化 (initEmpty) と、まとめ保存 (syncBatch) の「消す」を、
// BookshelfStorage の公開の入口から通し、保存先 (模擬) に届いた書き込み・消す指示の中身で確かめる。
// #690 の mutator では、初期化の本体を空にしても・書く中身を変えても単体テストは1本も落ちなかった (50件全部)。
// E2E は「書かない」には気づくが、「書いた中身が違う」(存在しない本が「すべての本」に入る等) には気づかなかった (#701 step2)。
import { describe, it, expect } from 'vitest';

await import('../../js/storage-adapter.js');
await import('../../js/storage.js');
const { BookshelfStorage, generateInternalId } = window;

const ID = /^[a-z0-9]{8}$/;

// まとめ保存を持たない保存先 (ローカルフォルダと同じ形の口だけ)
function plainAdapter() {
    const files = new Map();
    const log = [];
    return {
        files, log,
        async writeJSON(p, d) { log.push(['writeJSON', p]); files.set(p, JSON.parse(JSON.stringify(d))); },
        async writeText(p, t) { log.push(['writeText', p]); files.set(p, String(t)); },
        async deleteFile(p) { log.push(['deleteFile', p]); files.delete(p); },
        async readJSON(p) { return files.has(p) ? files.get(p) : null; },
        async fileExists(p) { return files.has(p); }
    };
}

// まとめ保存を持つ保存先 (GitHub・ハブと同じ口)。commitBatch で送られた中身を控える。fail を立てると送信が失敗する
function batchAdapter({ fail = false } = {}) {
    const a = plainAdapter();
    let batch = null;
    Object.assign(a, {
        sent: [], discarded: 0,
        beginBatch() { batch = []; },
        addBatchEntry(path, content) { batch.push({ op: 'put', path, content }); },
        addBatchDelete(path) { batch.push({ op: 'delete', path }); },
        async commitBatch(message) {
            if (fail) throw new Error('送信に失敗');
            a.sent.push({ message, entries: batch });
            batch = null;
            return 'ok';
        },
        discardBatch() { batch = null; a.discarded++; },
        get pending() { return batch; }
    });
    return a;
}

describe('空の保存先の初期化 (initEmpty → _initEmptyNow・テスト監査の5番)', () => {
    it('private/ 配下に蔵書・除外・メモ・本棚の一覧・「すべての本」・設定・main を空の中身で書き、「すべての本」の id を返す', async () => {
        const a = plainAdapter();
        const before = Date.now();
        const { allInternalId } = await new BookshelfStorage(a).initEmpty();
        expect(allInternalId).toMatch(ID);
        expect(a.log.map(([, p]) => p)).toEqual([
            'private/library.json', 'private/exclusions.json', 'private/notes.json', 'private/bookshelves.json',
            'private/bookshelves/all.json', 'private/settings.json', 'private/main.json'
        ]);
        expect(a.log.every(([op]) => op === 'writeJSON')).toBe(true);

        const lib = a.files.get('private/library.json');
        expect(lib.books).toEqual([]);
        expect(Object.keys(lib).sort()).toEqual(['books', 'exportDate']);
        expect(Date.parse(lib.exportDate)).toBeGreaterThanOrEqual(before - 1000);
        expect(a.files.get('private/exclusions.json')).toEqual({ excludedASINs: [] });
        expect(a.files.get('private/notes.json')).toEqual({ notes: {} });

        const allMeta = { internalId: allInternalId, slug: 'all', name: 'すべての本', iconName: 'library', isSpecial: true, parent: null, appliedPlugins: [] };
        expect(a.files.get('private/bookshelves.json')).toEqual({ bookshelves: [allMeta] });
        expect(a.files.get('private/bookshelves/all.json')).toEqual({ ...allMeta, defaultBookOrder: 'addedDate-desc', books: [] });
        expect(a.files.get('private/main.json')).toEqual({ enabledPlugins: [], appliedPlugins: [], bookshelves: [allInternalId], defaultSort: 'addedDate-desc' });

        const settings = a.files.get('private/settings.json');
        expect(settings).toMatchObject({ version: '2.0', theme: 'light', language: 'ja', defaultView: 'covers', coverSize: 'medium', bookMemoOpenWith: 'app-editor', enabledPlugins: [] });
        expect(settings.extensionImportOrigins).toEqual(['http://localhost:*', 'https://hahero-asayake.github.io']);
    });

    it('初期化した保存先を読込 (loadAll) すると、本0冊・「すべての本」だけの状態になる', async () => {
        const a = plainAdapter();
        const s = new BookshelfStorage(a);
        const { allInternalId } = await s.initEmpty();
        expect(await s.detectFormat()).toBe('new');
        const state = await s.loadAll();
        expect(JSON.stringify(state)).not.toContain('Stryker');
        expect(state.libraryBooks || state.library?.books || []).toEqual([]);
        expect(JSON.stringify(state)).toContain(allInternalId);
    });

    it('初期化するたびに「すべての本」の id は新しく作る', async () => {
        const ids = new Set();
        for (let i = 0; i < 5; i++) ids.add((await new BookshelfStorage(plainAdapter()).initEmpty()).allInternalId);
        expect(ids.size).toBe(5);
    });
});

describe('まとめ保存の「消す」(syncBatch → _syncBatchNow・テスト監査の6番)', () => {
    const entries = [
        { op: 'put', path: 'private/notes.json', data: { notes: { A1: { memo: 'm' } } } },
        { op: 'put', kind: 'text', path: 'private/books/A1__新.md', data: '本文' },
        { op: 'delete', path: 'private/books/A1__旧.md' }
    ];

    it('まとめ保存を持つ保存先には、消す指示を消す指示として届ける (書く側へ回さない)', async () => {
        const a = batchAdapter();
        await new BookshelfStorage(a).syncBatch(entries, { message: 'm1' });
        expect(a.sent).toHaveLength(1);
        expect(a.sent[0].message).toBe('m1');
        expect(a.sent[0].entries).toEqual([
            { op: 'put', path: 'private/notes.json', content: JSON.stringify({ notes: { A1: { memo: 'm' } } }, null, 2) },
            { op: 'put', path: 'private/books/A1__新.md', content: '本文' },
            { op: 'delete', path: 'private/books/A1__旧.md' }
        ]);
        expect(a.discarded).toBe(0);
    });

    it('まとめ保存を持たない保存先には、1件ずつ書き、消すファイルは deleteFile で消す', async () => {
        const a = plainAdapter();
        a.files.set('private/books/A1__旧.md', '旧');
        await new BookshelfStorage(a).syncBatch(entries, { message: 'm1' });
        expect(a.log).toEqual([
            ['writeJSON', 'private/notes.json'],
            ['writeText', 'private/books/A1__新.md'],
            ['deleteFile', 'private/books/A1__旧.md']
        ]);
        expect(a.files.has('private/books/A1__旧.md')).toBe(false);
        expect(a.files.get('private/books/A1__新.md')).toBe('本文');
    });

    it('送信が失敗したら、組み立てたまとめ保存を捨ててから失敗を返す (次のまとめ保存に混ざらない)', async () => {
        const a = batchAdapter({ fail: true });
        await expect(new BookshelfStorage(a).syncBatch(entries, { message: 'm1' })).rejects.toThrow('送信に失敗');
        expect(a.discarded).toBe(1);
        expect(a.pending).toBeNull();
        expect(a.sent).toHaveLength(0);
    });

    it('捨てる口 (discardBatch) を持たない保存先でも、送信の失敗はそのままの失敗として返す', async () => {
        const a = batchAdapter({ fail: true });
        delete a.discardBatch;
        await expect(new BookshelfStorage(a).syncBatch(entries, { message: 'm1' })).rejects.toThrow('送信に失敗');
    });

    it('版の印 (stamp) は、印の口 (addBatchStamp) を持たない保存先では普通のファイルとして同じまとめ保存に入れる', async () => {
        const a = batchAdapter();
        const s = new BookshelfStorage(a);
        await s.syncBatch(entries, { message: 'm1', stamp: 'S1' });
        const last = a.sent[0].entries.at(-1);
        expect(last).toEqual({ op: 'put', path: BookshelfStorage.SYNC_STAMP_PATH, content: JSON.stringify({ stamp: 'S1' }, null, 2) });
        expect(s.syncStamp).toBe('S1');
    });
});

describe('id の生成 (generateInternalId・テスト監査の6番)', () => {
    it('8文字の英小文字と数字で、呼ぶたびに違う', () => {
        const ids = Array.from({ length: 200 }, () => generateInternalId());
        for (const id of ids) expect(id).toMatch(ID);
        expect(new Set(ids).size).toBe(ids.length);
        const chars = new Set(ids.join(''));
        expect([...chars].some((c) => /[0-9]/.test(c))).toBe(true);
        expect([...chars].some((c) => /[a-z]/.test(c))).toBe(true);
    });
});
