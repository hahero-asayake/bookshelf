// アプリ本体の新バージョン検知 (イシュー#143・仮説a-1対策)。
// SW の updatefound は load 時に reg.update() を1回呼ぶだけで、開きっぱなしのタブに新しい
// ?v= が届く経路が無かった。index.html を取り直して埋め込まれた js/bookshelf.js の ?v= を
// 比較する extractAppVersionFromHtml() の抽出ロジックそのものを検証する
// (VirtualBookshelf 自体は DOM 依存が強くこの経路の import では安全にインスタンス化できないため、
// 検知ロジックは純粋関数に切り出してここで検証し、_checkAppVersion() の実際の fetch/表示接続は
// tests/e2e 側で検証する)。
import { describe, it, expect } from 'vitest';

await import('../../js/bookshelf.js');
const { extractAppVersionFromHtml } = globalThis;

function htmlWithVersion(v) {
    return `<html><body><script src="js/bookshelf.js?v=${v}"></script></body></html>`;
}

describe('extractAppVersionFromHtml', () => {
    it('js/bookshelf.js の ?v= 値を取り出す', () => {
        expect(extractAppVersionFromHtml(htmlWithVersion('2026090604'))).toBe('2026090604');
    });

    it('該当スクリプトタグが無ければ null', () => {
        expect(extractAppVersionFromHtml('<html><body>no script here</body></html>')).toBeNull();
    });

    it('空文字/undefined でも例外を投げず null', () => {
        expect(extractAppVersionFromHtml('')).toBeNull();
        expect(extractAppVersionFromHtml(undefined)).toBeNull();
    });

    it('他のスクリプトタグの ?v= には反応しない (bookshelf.js 自身のみ)', () => {
        const html = '<script src="js/storage-adapter.js?v=2026090601"></script><script src="js/bookshelf.js?v=2026090604"></script>';
        expect(extractAppVersionFromHtml(html)).toBe('2026090604');
    });

    it('2つの取得結果を比較すれば新旧判定に使える (呼び出し側の使い方の確認)', () => {
        const current = extractAppVersionFromHtml(htmlWithVersion('2026090604'));
        const latestSame = extractAppVersionFromHtml(htmlWithVersion('2026090604'));
        const latestNew = extractAppVersionFromHtml(htmlWithVersion('2026090701'));
        expect(latestSame).toBe(current);
        expect(latestNew).not.toBe(current);
    });
});
