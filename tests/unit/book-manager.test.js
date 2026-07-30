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
