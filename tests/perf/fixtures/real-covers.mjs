// イシュー#559 step1: #530のgen-780.mjs(productImage空文字=実画像ではない)に、
// 実在するAmazon CDN(m.media-amazon.com)の画像URLを割り当てるラッパー。
// 2026-11-13、このマシンから疎通確認済み(curl 200、実サイズ取得済み)の2画像×3解像度=6バリエーション
// をASIN順でローテーションして割り当てる。780冊個別の実表紙は用意できないため、
// 「実CDN・実圧縮特性・実サイズ(21KB〜206KB)での通信」を近似する目的の割当て(画像の多様性は無い)。
import { genLibraryAndUserData } from './gen-780.mjs';

export const REAL_COVER_IDS = [
    '81VStYnDGrL._SL1500_', // size=166956
    '81VStYnDGrL._SL500_',  // size=25141
    '81VStYnDGrL._SX300_',  // size=21233
    '81wgcld4wxL._SL1500_', // size=205946
    '81wgcld4wxL._SL500_',  // size=36374
    '81wgcld4wxL._SX300_',  // size=31232
];

export function genLibraryAndUserDataRealCovers(N = 780) {
    const data = genLibraryAndUserData(N);
    data.library.books.forEach((b, i) => {
        // クエリ(?cb=ASIN)でURLをユニーク化する(実測で確認済み: Amazon CDNはクエリを無視して
        // 同じ画像を200で返す)。付けないと6種類しかURLが無いためブラウザが重複リクエストを
        // 自動で1本に畳んでしまい、780冊分の並行通信量を再現できない(2026-11-13実測で発覚)。
        b.productImage = `https://m.media-amazon.com/images/I/${REAL_COVER_IDS[i % REAL_COVER_IDS.length]}.jpg?cb=${b.asin}`;
    });
    return data;
}
