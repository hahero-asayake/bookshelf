// BookshelfPluginAPI の Amazon/画像 URL 薄いラッパ (ADR-043)
// 実 BookManager を使い、book オブジェクト / ASIN 文字列の両入力と
// affiliateId の自動付与・明示 null・上書きを検証する。
import { describe, it, expect } from 'vitest';

await import('../../js/book-manager.js');
await import('../../js/plugin-api.js');
const BookManager = window.BookManager;
const BookshelfPluginAPI = window.BookshelfPluginAPI;

function makeApi(affiliateId) {
    const app = {
        books: [
            { asin: 'B000000001', title: '本1' },
            { asin: 'OLD0000001', updatedAsin: 'B000000009', title: '本2' }
        ],
        userData: { settings: affiliateId !== undefined ? { affiliateId } : {}, notes: {} },
        bookManager: new BookManager()
    };
    return new BookshelfPluginAPI(app);
}

const IMG = (a) => `https://images-na.ssl-images-amazon.com/images/P/${a}.01.L.jpg`;

describe('effectiveAsin', () => {
    const api = makeApi('tag-22');
    it('ASIN 文字列 → 蔵書から解決', () => {
        expect(api.effectiveAsin('B000000001')).toBe('B000000001');
    });
    it('updatedAsin を優先', () => {
        expect(api.effectiveAsin('OLD0000001')).toBe('B000000009');
    });
    it('book オブジェクト直渡し', () => {
        expect(api.effectiveAsin({ asin: 'X', updatedAsin: 'B000000007' })).toBe('B000000007');
    });
    it('蔵書外 ASIN は合成して解決', () => {
        expect(api.effectiveAsin('B999999999')).toBe('B999999999');
    });
    it('null/未指定は null', () => {
        expect(api.effectiveAsin(null)).toBeNull();
        expect(api.effectiveAsin(undefined)).toBeNull();
    });
});

describe('getProductImageUrl', () => {
    const api = makeApi('tag-22');
    it('ASIN 文字列', () => {
        expect(api.getProductImageUrl('B000000001')).toBe(IMG('B000000001'));
    });
    it('updatedAsin 優先', () => {
        expect(api.getProductImageUrl('OLD0000001')).toBe(IMG('B000000009'));
    });
    it('null は null', () => {
        expect(api.getProductImageUrl(null)).toBeNull();
    });
});

describe('getAmazonUrl', () => {
    it('affiliateId 省略時はユーザ設定を自動付与', () => {
        const api = makeApi('tag-22');
        expect(api.getAmazonUrl('B000000001')).toBe('https://www.amazon.co.jp/dp/B000000001?tag=tag-22');
    });
    it('null を明示すると無タグ', () => {
        const api = makeApi('tag-22');
        expect(api.getAmazonUrl('B000000001', null)).toBe('https://www.amazon.co.jp/dp/B000000001');
    });
    it('明示した affiliateId で上書き', () => {
        const api = makeApi('tag-22');
        expect(api.getAmazonUrl('B000000001', 'other-99')).toBe('https://www.amazon.co.jp/dp/B000000001?tag=other-99');
    });
    it('ユーザ設定に affiliateId が無ければ無タグ', () => {
        const api = makeApi(undefined);
        expect(api.getAmazonUrl('B000000001')).toBe('https://www.amazon.co.jp/dp/B000000001');
    });
    it('updatedAsin 優先', () => {
        const api = makeApi(undefined);
        expect(api.getAmazonUrl('OLD0000001')).toBe('https://www.amazon.co.jp/dp/B000000009');
    });
    it('null は null', () => {
        const api = makeApi('tag-22');
        expect(api.getAmazonUrl(null)).toBeNull();
    });
});

describe('forPlugin スコープ経由でも同じ結果', () => {
    const api = makeApi('tag-22');
    const scoped = api.forPlugin('p1');
    it('getAmazonUrl / getProductImageUrl / effectiveAsin が委譲される', () => {
        expect(scoped.getAmazonUrl('B000000001')).toBe('https://www.amazon.co.jp/dp/B000000001?tag=tag-22');
        expect(scoped.getProductImageUrl('B000000001')).toBe(IMG('B000000001'));
        expect(scoped.effectiveAsin('OLD0000001')).toBe('B000000009');
    });
});

describe('bookManager 未初期化でも落ちない', () => {
    it('全メソッド null を返す', () => {
        const api = new BookshelfPluginAPI({ books: [], userData: { settings: {} } });
        expect(api.effectiveAsin('B000000001')).toBeNull();
        expect(api.getProductImageUrl('B000000001')).toBeNull();
        expect(api.getAmazonUrl('B000000001')).toBeNull();
    });
});
