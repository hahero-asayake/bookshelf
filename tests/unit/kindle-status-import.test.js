// Kindle 取込での originType/statusFromPlatformSearch/lendingType/lendingStatus 保持を検証 (イシュー#41)
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../js/book-manager.js');
const BookManager = window.BookManager;

function makePayloadBook(overrides = {}) {
    return {
        title: 'テスト本', authors: '著者', acquiredTime: 1000, readStatus: 'READ',
        asin: 'B000000001', productImage: 'https://img/x.jpg',
        ...overrides
    };
}

let bm;
beforeEach(() => {
    localStorage.clear();
    bm = new BookManager();
});

describe('importSelectedBooks: 新フィールドの保存 (イシュー#41)', () => {
    it('originType/statusFromPlatformSearch/lendingType/lendingStatus が保存される', async () => {
        const payload = makePayloadBook({
            originType: 'Ku', statusFromPlatformSearch: 'Active', lendingType: 'KU', lendingStatus: 'OnLoan'
        });
        const result = await bm.importSelectedBooks([payload]);
        expect(result.added).toBe(1);
        const saved = bm.library.books.find(b => b.asin === 'B000000001');
        expect(saved.originType).toBe('Ku');
        expect(saved.statusFromPlatformSearch).toBe('Active');
        expect(saved.lendingType).toBe('KU');
        expect(saved.lendingStatus).toBe('OnLoan');
    });

    it('新フィールドが無い payload でも既定で壊れない (キー自体を持たない)', async () => {
        const payload = makePayloadBook(); // originType 等を含まない
        const result = await bm.importSelectedBooks([payload]);
        expect(result.added).toBe(1);
        const saved = bm.library.books.find(b => b.asin === 'B000000001');
        expect(saved.title).toBe('テスト本');
        expect('originType' in saved).toBe(false);
        expect('statusFromPlatformSearch' in saved).toBe(false);
        expect('lendingType' in saved).toBe(false);
        expect('lendingStatus' in saved).toBe(false);
    });

    it('同一 ASIN 再取込: ステータス系だけ Amazon 最新値で更新し、書誌・addedDate・readStatus は維持する', async () => {
        // 1回目: 借用中 (Ku/OnLoan) として取込
        const first = makePayloadBook({
            title: '旧タイトル', originType: 'Ku', statusFromPlatformSearch: 'Active', lendingType: 'KU', lendingStatus: 'OnLoan'
        });
        await bm.importSelectedBooks([first]);
        const beforeUpdate = bm.library.books.find(b => b.asin === 'B000000001');
        const originalAddedDate = beforeUpdate.addedDate;
        const originalTitle = beforeUpdate.title;
        const originalReadStatus = beforeUpdate.readStatus;

        // 少し時間が経ってから返却済みとして再取込 (Amazon側の readStatus/statusFromPlatformSearch/lendingStatus が変化)
        const second = makePayloadBook({
            title: '新タイトル(Amazon側で変わったが無視すべき)', readStatus: 'UNKNOWN',
            originType: 'Ku', statusFromPlatformSearch: 'Revoked', lendingType: 'KU', lendingStatus: 'Terminated'
        });
        const result = await bm.importSelectedBooks([second]);

        expect(result.added).toBe(0);
        expect(result.updated).toBe(1);
        const after = bm.library.books.find(b => b.asin === 'B000000001');
        // 書誌・addedDate・readStatus は維持 (readStatus はアプリ内に手動編集UIが無いが、
        // 選択有無と無関係な自動更新の対象からは意図的に外している＝ユーザー入力を破壊するリスクをゼロにする)
        expect(after.title).toBe(originalTitle);
        expect(after.addedDate).toBe(originalAddedDate);
        expect(after.readStatus).toBe(originalReadStatus);
        // ステータス系のみ更新
        expect(after.statusFromPlatformSearch).toBe('Revoked');
        expect(after.lendingStatus).toBe('Terminated');
        // 書籍数は増えない (1件のまま)
        expect(bm.library.books.length).toBe(1);
    });

    it('選択されていない既存ASIN分でもステータス系だけ反映される (VirtualBookshelf層が選択有無と無関係に合成して渡す設計、イシュー#41差し戻し)', async () => {
        // 借用中として取込済み
        await bm.importSelectedBooks([makePayloadBook({
            asin: 'B0KUONLOAN', title: '借用中の本', originType: 'Ku', statusFromPlatformSearch: 'Active', lendingType: 'KU', lendingStatus: 'OnLoan'
        })]);
        const before = bm.library.books.find(b => b.asin === 'B0KUONLOAN');

        // VirtualBookshelf.importSelectedBooks() は選択されなかった既存ASIN本も
        // selectedBooks に合成して BookManager へ渡す (js/bookshelf.js #importSelectedBooks 参照)。
        // ここではその合成後の配列を模して直接呼び、ユーザーが選択しなくても反映されることを検証する。
        const result = await bm.importSelectedBooks([makePayloadBook({
            asin: 'B0KUONLOAN', title: '借用中の本(Amazon側タイトル変化・無視すべき)',
            originType: 'Ku', statusFromPlatformSearch: 'Revoked', lendingType: 'KU', lendingStatus: 'Terminated'
        })]);

        expect(result.updated).toBe(1);
        const after = bm.library.books.find(b => b.asin === 'B0KUONLOAN');
        expect(after.title).toBe(before.title);
        expect(after.addedDate).toBe(before.addedDate);
        expect(after.statusFromPlatformSearch).toBe('Revoked');
        expect(after.lendingStatus).toBe('Terminated');
    });

    it('同一 ASIN 再取込で並び順に影響する books 配列の位置が変わらない (先頭に移動しない)', async () => {
        await bm.importSelectedBooks([makePayloadBook({ asin: 'B1', title: '本1' })]);
        await bm.importSelectedBooks([makePayloadBook({ asin: 'B2', title: '本2' })]);
        await bm.importSelectedBooks([makePayloadBook({ asin: 'B1', title: '本1(更新)', statusFromPlatformSearch: 'Revoked' })]);
        const order = bm.library.books.map(b => b.asin);
        expect(order).toEqual(['B1', 'B2']);
    });

    it('同一 ASIN 再取込で変化が無ければ updated ではなく duplicates に積まれる', async () => {
        const payload = makePayloadBook({ originType: 'Purchase', statusFromPlatformSearch: 'Active' });
        await bm.importSelectedBooks([payload]);
        const result = await bm.importSelectedBooks([{ ...payload }]);
        expect(result.added).toBe(0);
        expect(result.updated).toBe(0);
        expect(result.skipped).toBe(1);
    });
});

describe('addBookManually: 新フィールドは既定で未設定のまま (イシュー#41)', () => {
    it('bookData に originType 等が無ければキー自体を持たない (= 購入・有効 扱い)', async () => {
        const book = await bm.addBookManually({ asin: 'B000000009', title: '手動追加本' });
        expect('originType' in book).toBe(false);
        expect('statusFromPlatformSearch' in book).toBe(false);
        expect('lendingType' in book).toBe(false);
        expect('lendingStatus' in book).toBe(false);
    });

    it('bookData に値があれば保存される', async () => {
        const book = await bm.addBookManually({ asin: 'B000000009', title: '手動追加本', originType: 'Purchase' });
        expect(book.originType).toBe('Purchase');
    });
});
