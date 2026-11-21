// イシュー#701 (テスト監査 #690 の9番): 旧い形式の判定 (detectFormat) と、旧い library.json からの移行 (migrateFromLegacy)。
// 利用者の保存先に旧形式が残りうるかを確かめられなかった (GitHub・ローカルは全数を確かめる手段が無い) ので、
// 移行のコードは消さずにテストを足す (#701 step1 の結論「分からない」・②承認)。
// BookshelfStorage の公開の入口から通し、模擬の保存先に書かれたファイルと、読込 (loadAll) の結果で確かめる。
import { describe, it, expect } from 'vitest';

await import('../../js/storage-adapter.js');
await import('../../js/storage.js');
const { BookshelfStorage } = window;

const ID = /^[a-z0-9]{8}$/;

// ファイルを Map に持つ模擬の保存先 (ローカルフォルダと同じ口だけ)
function memAdapter(initial = {}) {
    const files = new Map(Object.entries(initial).map(([p, d]) => [p, JSON.parse(JSON.stringify(d))]));
    const writes = [];
    return {
        files, writes,
        async writeJSON(p, d) { writes.push(p); files.set(p, JSON.parse(JSON.stringify(d))); },
        async writeText(p, t) { writes.push(p); files.set(p, String(t)); },
        async deleteFile(p) { files.delete(p); },
        async readJSON(p) { return files.has(p) ? JSON.parse(JSON.stringify(files.get(p))) : null; },
        async readText(p) { return files.has(p) ? String(files.get(p)) : null; },
        async fileExists(p) { return files.has(p); }
    };
}

// 旧形式 (単一の library.json・books が ASIN をキーにした object) の見本
const LEGACY = {
    exportDate: '2026-05-01T00:00:00.000Z',
    books: {
        B000000001: { title: '本1', authors: '著者1', acquiredTime: 1000, readStatus: 'READ', productImage: 'https://img/1.jpg', source: 'kindle_import', addedDate: 2000, memo: 'メモ1', rating: 4, originType: 'Purchase' },
        B000000002: { title: '本2', authors: '著者2', acquiredTime: 3000, readStatus: 'UNKNOWN', productImage: '', source: 'manual_add', addedDate: 4000 },
        B000000003: { title: '本3', rating: 5 }
    },
    bookshelves: [
        { id: 'all', name: 'すべて', books: ['B000000001', 'B000000002', 'B000000003'] },
        { id: 'Fav Books', name: 'お気に入り', books: ['B000000001'] },
        { id: 'fav-books', name: '同じ slug になる本棚', books: ['B000000002'] }
    ],
    bookOrder: { 'Fav Books': ['B000000001', 'B000000003'] },
    settings: { theme: 'dark', affiliateId: 'aff-22' }
};

describe('detectFormat: 保存先の形式の判定 (テスト監査の9番・イシュー#701)', () => {
    it('private/bookshelves/all.json が在れば new (直下の旧いファイルが残っていても)', async () => {
        const s = new BookshelfStorage(memAdapter({ 'private/bookshelves/all.json': {}, 'library.json': LEGACY, 'bookshelves/all.json': {} }));
        expect(await s.detectFormat()).toBe('new');
    });

    it('直下に bookshelves/all.json と notes.json が在れば flat、notes.json が無ければ pre-notes-split', async () => {
        expect(await new BookshelfStorage(memAdapter({ 'bookshelves/all.json': {}, 'notes.json': {} })).detectFormat()).toBe('flat');
        expect(await new BookshelfStorage(memAdapter({ 'bookshelves/all.json': {} })).detectFormat()).toBe('pre-notes-split');
    });

    it('直下の library.json の books が object なら legacy。配列・無い・空なら empty', async () => {
        expect(await new BookshelfStorage(memAdapter({ 'library.json': LEGACY })).detectFormat()).toBe('legacy');
        expect(await new BookshelfStorage(memAdapter({ 'library.json': { books: [] } })).detectFormat()).toBe('empty');
        expect(await new BookshelfStorage(memAdapter({ 'library.json': { exportDate: 'x' } })).detectFormat()).toBe('empty');
        expect(await new BookshelfStorage(memAdapter({})).detectFormat()).toBe('empty');
    });
});

describe('migrateFromLegacy: 旧い library.json を private/ 配下の新しい形式へ移す (テスト監査の9番・イシュー#701)', () => {
    it('新しい形式のファイルを書き、判定が new になり、読込で本・メモ・本棚・設定が揃う', async () => {
        const a = memAdapter({ 'library.json': LEGACY });
        const s = new BookshelfStorage(a);
        const res = await s.migrateFromLegacy();
        expect(res.migrated).toBe(true);
        expect(res.allInternalId).toMatch(ID);

        // 書いたファイル (全部 private/ 配下・旧い library.json は消さない)
        expect(a.writes.slice(0, 5)).toEqual(['private/library.json', 'private/exclusions.json', 'private/notes.json', 'private/bookshelves.json', 'private/bookshelves/all.json']);
        expect(a.writes.slice(-2)).toEqual(['private/settings.json', 'private/main.json']);
        expect(a.writes.every((p) => p.startsWith('private/'))).toBe(true);
        expect(a.files.has('library.json')).toBe(true);
        expect(await s.detectFormat()).toBe('new');

        // 本の項目の写し (無い項目は既定の値・ステータス系は値がある時だけキーを持つ)
        const lib = a.files.get('private/library.json');
        expect(lib.exportDate).toBe('2026-05-01T00:00:00.000Z');
        expect(lib.books.map((b) => b.asin)).toEqual(['B000000001', 'B000000002', 'B000000003']);
        expect(lib.books[0]).toEqual({ asin: 'B000000001', title: '本1', authors: '著者1', acquiredTime: 1000, readStatus: 'READ', productImage: 'https://img/1.jpg', source: 'kindle_import', addedDate: 2000, originType: 'Purchase' });
        expect(lib.books[2]).toMatchObject({ asin: 'B000000003', title: '本3', authors: '', readStatus: 'UNKNOWN', productImage: '', source: 'unknown' });
        expect('memo' in lib.books[0] || 'rating' in lib.books[0]).toBe(false);

        // メモと評価は notes.json へ分ける (どちらも無い本は持たない)
        expect(a.files.get('private/notes.json')).toEqual({ notes: {
            B000000001: { memo: 'メモ1', rating: 4, hasDetailMemo: false },
            B000000003: { memo: '', rating: 5, hasDetailMemo: false }
        } });
        expect(a.files.get('private/exclusions.json')).toEqual({ excludedASINs: [] });

        // 「すべての本」の本棚と、自作の本棚 (slug は英小文字と数字にし、重なれば -2 を付ける・並び順は bookOrder を採る)
        const all = a.files.get('private/bookshelves/all.json');
        expect(all).toMatchObject({ internalId: res.allInternalId, slug: 'all', name: 'すべての本', isSpecial: true, parent: null, books: ['B000000001', 'B000000002', 'B000000003'] });
        const meta = a.files.get('private/bookshelves.json').bookshelves;
        expect(meta.map((b) => [b.slug, b.name, b.parent === null ? null : 'all'])).toEqual([['all', 'すべての本', null], ['fav-books', 'お気に入り', 'all'], ['fav-books-2', '同じ slug になる本棚', 'all']]);
        expect(meta[1].parent).toBe(res.allInternalId);
        expect(a.files.get('private/bookshelves/fav-books.json')).toMatchObject({ internalId: meta[1].internalId, books: ['B000000001', 'B000000003'] });
        expect(a.files.get('private/bookshelves/fav-books-2.json')).toMatchObject({ internalId: meta[2].internalId, books: ['B000000002'] });

        // 設定は旧い settings から引き継ぎ、main.json の本棚の順は「すべての本」が先頭
        expect(a.files.get('private/settings.json')).toMatchObject({ version: '2.0', theme: 'dark', affiliateId: 'aff-22', language: 'ja' });
        expect(a.files.get('private/main.json').bookshelves).toEqual([res.allInternalId, meta[1].internalId, meta[2].internalId]);

        // 読込で新しい形式として読める
        const state = await s.loadAll();
        expect(JSON.stringify(state)).toContain('B000000003');
        expect(JSON.stringify(state)).toContain(res.allInternalId);
    });

    it('旧い形式の library.json が無い (無い・books が配列) 時は移さずに例外を投げ、何も書かない', async () => {
        for (const initial of [{}, { 'library.json': { books: [] } }]) {
            const a = memAdapter(initial);
            await expect(new BookshelfStorage(a).migrateFromLegacy()).rejects.toThrow('旧形式の library.json が見つかりません');
            expect(a.writes).toEqual([]);
        }
    });
});
