// イシュー#594: 長文メモのファイル (private/books/<ASIN>__<題名>.md) の削除・移動待ち。
// 本棚ファイルの削除待ち (イシュー#587) と同じ記録に積み、次の保存のまとめ保存に載せる。
// ここでは記録の積み方・まとめ方と、保存時に作る書き込み・削除 (takeBookMemoOps) を確かめる。
// 保存先は中身を Map に持つ模擬 (readText / fileExists / writeText だけ使う)。
import { describe, it, expect, beforeEach } from 'vitest';

let idCounter = 0;
globalThis.generateInternalId = () => `gen${++idCounter}`;
await import('../../js/storage-adapter.js');
await import('../../js/storage.js');

const { BookshelfStorage } = window;
const KEY = 'virtualBookshelf_pendingShelfDeletes';

function makeAdapter(files = {}) {
    const store = new Map(Object.entries(files));
    return {
        store,
        readText: async (p) => (store.has(p) ? store.get(p) : null),
        fileExists: async (p) => store.has(p),
        writeText: async (p, c) => { store.set(p, c); },
        deleteFile: async (p) => { store.delete(p); }
    };
}

const records = () => JSON.parse(localStorage.getItem(KEY) || '[]');

let storage;
const P = (asin, title) => storage.bookMemoPath(asin, title);

beforeEach(() => {
    localStorage.removeItem(KEY);
    storage = new BookshelfStorage(makeAdapter());
});

describe('#587 の記録と混ぜても互いに消さない', () => {
    it('古い形式 (slug の文字列だけ) はそのまま本棚の削除として読め、メモの記録と混ざっても残る', () => {
        localStorage.setItem(KEY, JSON.stringify(['old-shelf']));
        storage.queueBookMemoDelete(P('A1', '本'));
        storage.queueBookshelfFileDelete('shelf2');
        expect(records()).toEqual(['old-shelf', 'shelf2', { kind: 'memo-delete', path: P('A1', '本') }]);

        const taken = storage.takeBookshelfFileDeletes([]);
        expect(taken.slugs).toEqual(['old-shelf', 'shelf2']);
        storage.clearBookshelfFileDeletes(taken.slugs);
        // 本棚の分を片づけても、メモの記録は残る
        expect(records()).toEqual([{ kind: 'memo-delete', path: P('A1', '本') }]);
    });

    it('メモの記録を片づけても、本棚の slug は残る', async () => {
        storage = new BookshelfStorage(makeAdapter());
        storage.queueBookshelfFileDelete('s1');
        storage.queueBookMemoDelete(P('A1', '本'));
        const ops = await storage.takeBookMemoOps([]);
        storage.clearBookMemoOps(ops.records);
        expect(records()).toEqual(['s1']);
    });
});

describe('続けて変えた場合のまとめ方', () => {
    it('A→B→C は A→C の1件になる', () => {
        storage.queueBookMemoMove(P('A1', 'A'), P('A1', 'B'));
        storage.queueBookMemoMove(P('A1', 'B'), P('A1', 'C'));
        expect(records()).toEqual([{ kind: 'memo-move', from: P('A1', 'A'), to: P('A1', 'C') }]);
    });

    it('A→B→A は取り消し (記録が残らない)', () => {
        storage.queueBookMemoMove(P('A1', 'A'), P('A1', 'B'));
        storage.queueBookMemoMove(P('A1', 'B'), P('A1', 'A'));
        expect(records()).toEqual([]);
    });

    it('移動待ちの本を削除すると、元のファイル (from) を消す記録になる', () => {
        storage.queueBookMemoMove(P('A1', 'A'), P('A1', 'B'));
        storage.queueBookMemoDelete(P('A1', 'B'));
        expect(records()).toEqual([
            { kind: 'memo-delete', path: P('A1', 'A') },
            { kind: 'memo-delete', path: P('A1', 'B') }
        ]);
    });
});

describe('ファイル名にした後で同じ名前になる変更は積まない', () => {
    it('使えない文字・空白の違いだけ', () => {
        expect(P('A1', 'a:b c')).toBe(P('A1', 'a?b\tc'));
        storage.queueBookMemoMove(P('A1', 'a:b c'), P('A1', 'a?b\tc'));
        expect(records()).toEqual([]);
    });

    it('50字より後ろだけの違い', () => {
        const base = 'あ'.repeat(50);
        storage.queueBookMemoMove(P('A1', base + 'い'), P('A1', base + 'う'));
        expect(records()).toEqual([]);
    });
});

describe('保存時に作る書き込み・削除 (takeBookMemoOps)', () => {
    it('移動: 移す先に中身を書き、元を消す。成功後に片づけると記録が残らない', async () => {
        storage = new BookshelfStorage(makeAdapter({ [P('A1', '旧')]: '本文' }));
        storage.queueBookMemoMove(P('A1', '旧'), P('A1', '新'));
        const ops = await storage.takeBookMemoOps([P('A1', '新')]);
        expect(ops.entries).toEqual([
            { op: 'put', kind: 'text', path: P('A1', '新'), data: '本文' },
            { op: 'delete', path: P('A1', '旧') }
        ]);
        storage.clearBookMemoOps(ops.records);
        expect(records()).toEqual([]);
    });

    it('保存が失敗した (片づけなかった) 時は、次の保存でもう一度載る', async () => {
        storage = new BookshelfStorage(makeAdapter({ [P('A1', '旧')]: '本文' }));
        storage.queueBookMemoMove(P('A1', '旧'), P('A1', '新'));
        await storage.takeBookMemoOps([P('A1', '新')]);
        const again = await storage.takeBookMemoOps([P('A1', '新')]);
        expect(again.entries.map(e => e.op)).toEqual(['put', 'delete']);
    });

    it('一覧にある本の今のメモは消さない (削除・移動の元とも)', async () => {
        storage = new BookshelfStorage(makeAdapter({ [P('A1', '本')]: '本文' }));
        storage.queueBookMemoDelete(P('A1', '本'));
        const ops = await storage.takeBookMemoOps([P('A1', '本')]);
        expect(ops.entries).toEqual([]);
        expect(records()).toEqual([]);
    });

    it('#484: 同じ ASIN・同じ題名のもう1冊が残る時、ASIN を変えるとコピーになり元は消さない', async () => {
        storage = new BookshelfStorage(makeAdapter({ [P('A1', '上')]: '本文' }));
        storage.queueBookMemoMove(P('A1', '上'), P('A2', '上'));
        const ops = await storage.takeBookMemoOps([P('A1', '上'), P('A2', '上')]);
        expect(ops.entries).toEqual([{ op: 'put', kind: 'text', path: P('A2', '上'), data: '本文' }]);
    });

    it('#484: 同じ ASIN・題名違いのもう1冊のメモには触らない', async () => {
        storage = new BookshelfStorage(makeAdapter({ [P('A1', '上')]: '上の本文', [P('A1', '下')]: '下の本文' }));
        storage.queueBookMemoMove(P('A1', '上'), P('A1', '上巻'));
        const ops = await storage.takeBookMemoOps([P('A1', '上巻'), P('A1', '下')]);
        expect(ops.entries).toEqual([
            { op: 'put', kind: 'text', path: P('A1', '上巻'), data: '上の本文' },
            { op: 'delete', path: P('A1', '上') }
        ]);
    });

    it('移す先がどの本のものでもない (変更が取り消された) 時は、何もせず記録を捨てる', async () => {
        storage = new BookshelfStorage(makeAdapter({ [P('A1', '旧')]: '本文' }));
        storage.queueBookMemoMove(P('A1', '旧'), P('A1', '新'));
        const ops = await storage.takeBookMemoOps([P('A1', '旧')]);
        expect(ops.entries).toEqual([]);
        expect(records()).toEqual([]);
    });

    it('元のメモが無い本の移動は、何もせず記録を捨てる', async () => {
        storage.queueBookMemoMove(P('A1', '旧'), P('A1', '新'));
        const ops = await storage.takeBookMemoOps([P('A1', '新')]);
        expect(ops.entries).toEqual([]);
        expect(records()).toEqual([]);
    });

    it('移す先が既にある時は、上書きも元の削除もしない', async () => {
        storage = new BookshelfStorage(makeAdapter({ [P('A1', '旧')]: '旧の本文', [P('A1', '新')]: '他の端末の本文' }));
        storage.queueBookMemoMove(P('A1', '旧'), P('A1', '新'));
        const ops = await storage.takeBookMemoOps([P('A1', '新')]);
        expect(ops.entries).toEqual([]);
        expect(records()).toEqual([]);
    });

    it('大文字・小文字だけの違い: ローカルでは元を消さず、それ以外は消す', async () => {
        const files = { [P('A1', 'abc')]: '本文' };
        storage = new BookshelfStorage(makeAdapter(files));
        storage.queueBookMemoMove(P('A1', 'abc'), P('A1', 'ABC'));
        const local = await storage.takeBookMemoOps([P('A1', 'ABC')], { caseInsensitiveDeletes: true });
        expect(local.entries).toEqual([{ op: 'put', kind: 'text', path: P('A1', 'ABC'), data: '本文' }]);
        const remote = await storage.takeBookMemoOps([P('A1', 'ABC')], { caseInsensitiveDeletes: false });
        expect(remote.entries.map(e => e.op)).toEqual(['put', 'delete']);
    });

    it('移す先をエディタで開いている間は次の保存へ回し、閉じた後の保存で片づく', async () => {
        storage = new BookshelfStorage(makeAdapter({ [P('A1', '旧')]: '本文' }));
        storage.queueBookMemoMove(P('A1', '旧'), P('A1', '新'));
        const whileOpen = await storage.takeBookMemoOps([P('A1', '新')], { openPath: P('A1', '新') });
        expect(whileOpen.entries).toEqual([]);
        expect(records()).toHaveLength(1);
        const afterClose = await storage.takeBookMemoOps([P('A1', '新')], { openPath: null });
        expect(afterClose.entries.map(e => e.op)).toEqual(['put', 'delete']);
        storage.clearBookMemoOps(afterClose.records);
        expect(records()).toEqual([]);
    });
});

describe('保存前でも新しい名前で読める (移動待ちの読み替え)', () => {
    it('読む・有無・パスは from に読み替え、to に書いたら from を消すだけの記録に変わる', async () => {
        storage = new BookshelfStorage(makeAdapter({ [P('A1', '旧')]: '本文' }));
        storage.queueBookMemoMove(P('A1', '旧'), P('A1', '新'));
        expect(await storage.readBookMemo('A1', '新')).toBe('本文');
        expect(await storage.bookMemoExists('A1', '新')).toBe(true);
        expect(storage.bookMemoFullPath('A1', '新')).toBe(P('A1', '旧'));

        await storage.writeBookMemo('A1', '新', '書き直した本文');
        expect(records()).toEqual([{ kind: 'memo-delete', path: P('A1', '旧') }]);
        expect(await storage.readBookMemo('A1', '新')).toBe('書き直した本文');
    });
});
