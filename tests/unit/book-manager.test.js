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
