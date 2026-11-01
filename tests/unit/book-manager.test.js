// BookManager の判定・URL 生成テスト
import { describe, it, expect } from 'vitest';

await import('../../js/book-manager.js');
const BookManager = window.BookManager;
const bm = new BookManager();

describe('isKindleBook', () => {
    it('B + 9 桁英数 → true', () => {
        expect(bm.isKindleBook({ asin: 'B0CB2B4S41' })).toBe(true);
    });
    it('ISBN (数字 10 桁) → false', () => {
        expect(bm.isKindleBook({ asin: '4873119485' })).toBe(false);
    });
    it('updatedAsin があればそちらで判定する', () => {
        expect(bm.isKindleBook({ asin: '4873119485', updatedAsin: 'B000000001' })).toBe(true);
        expect(bm.isKindleBook({ asin: 'B000000001', updatedAsin: '4873119485' })).toBe(false);
    });
});

describe('getKindleReadUrl', () => {
    it('web (既定): Cloud Reader URL', () => {
        expect(bm.getKindleReadUrl({ asin: 'B000000001' }))
            .toBe('https://read.amazon.co.jp/?asin=B000000001');
    });
    it('app: kindle:// スキーム + updatedAsin 優先', () => {
        expect(bm.getKindleReadUrl({ asin: 'X', updatedAsin: 'B000000002' }, 'app'))
            .toBe('kindle://book?action=open&asin=B000000002');
    });
});

describe('getProductImageUrl (保存 URL 優先)', () => {
    const CDN = 'https://m.media-amazon.com/images/I/81abcDEF.jpg';
    const built = (asin) => `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.L.jpg`;
    it('Kindle 取込の恒久 CDN URL があればそれを返す', () => {
        expect(bm.getProductImageUrl({ asin: 'B000000001', productImage: CDN })).toBe(CDN);
    });
    it('productImage が空なら ASIN 組み立てにフォールバック', () => {
        expect(bm.getProductImageUrl({ asin: 'B000000001', productImage: '' })).toBe(built('B000000001'));
    });
    it('updatedAsin (版差し替え) があるときは保存 URL より組み立てを優先', () => {
        expect(bm.getProductImageUrl({ asin: 'B000000001', updatedAsin: 'B000000009', productImage: CDN }))
            .toBe(built('B000000009'));
    });
    it('https 以外の保存値は信用せず組み立てへ', () => {
        expect(bm.getProductImageUrl({ asin: 'B000000001', productImage: 'http://insecure/img.jpg' }))
            .toBe(built('B000000001'));
    });
});

describe('hasCoverImage (表紙 <img> を出すかの唯一の正)', () => {
    it('productImage が空でも ASIN があれば true', () => {
        expect(bm.hasCoverImage({ asin: 'B000000001', productImage: '' })).toBe(true);
    });
    it('ASIN も productImage も無ければ false', () => {
        expect(bm.hasCoverImage({ asin: '', productImage: '' })).toBe(false);
    });
});

// イシュー#484: notes/bookOrder/exclusions が asin をキーにしているため、別の本に同じ asin が
// 付いていると設定を共有してしまう問題の検出。
describe('findDuplicateAsinGroups (イシュー#484: 重複asin検出)', () => {
    it('重複が無ければ空配列', () => {
        const local = new BookManager();
        local.library.books = [
            { asin: 'B000000001', title: 'A' },
            { asin: 'B000000002', title: 'B' }
        ];
        expect(local.findDuplicateAsinGroups()).toEqual([]);
    });

    it('別の本に同じasin(B00I8AT186型)は sameTitle:false で検出する', () => {
        const local = new BookManager();
        local.library.books = [
            { asin: 'B00I8AT186', title: '上巻' },
            { asin: 'B00I8AT186', title: '下巻' }
        ];
        const groups = local.findDuplicateAsinGroups();
        expect(groups.length).toBe(1);
        expect(groups[0].asin).toBe('B00I8AT186');
        expect(groups[0].sameTitle).toBe(false);
        expect(groups[0].books.map(b => b.title)).toEqual(['上巻', '下巻']);
    });

    it('同じ本の二重登録(B0F2TC5B79型)は sameTitle:true で検出する(削除・統合は促さない方針なので判定だけ分ける)', () => {
        const local = new BookManager();
        local.library.books = [
            { asin: 'B0F2TC5B79', title: '同じ本' },
            { asin: 'B0F2TC5B79', title: '同じ本' }
        ];
        const groups = local.findDuplicateAsinGroups();
        expect(groups.length).toBe(1);
        expect(groups[0].sameTitle).toBe(true);
    });

    it('3冊以上の重複も1グループにまとめる', () => {
        const local = new BookManager();
        local.library.books = [
            { asin: 'B000000009', title: 'X' },
            { asin: 'B000000009', title: 'Y' },
            { asin: 'B000000009', title: 'Z' }
        ];
        const groups = local.findDuplicateAsinGroups();
        expect(groups.length).toBe(1);
        expect(groups[0].books.length).toBe(3);
    });
});
