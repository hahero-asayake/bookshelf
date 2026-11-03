// BookshelfEscape.escapeHtml (イシュー#523 U6): HTMLエスケープの単一実装の検証。
// 旧7実装 (bookshelf.js escapeHtml/_escapeHtml/renderExclusionsList内ローカルescapeHtml,
// dashboard.js _escape, ui-components.js esc, publish-article-generator.js static esc,
// icons.js _escapeXml) は撤去済み (step1調査: tmp/523/step1-survey.md §2)。
// ここでは旧実装を再現した関数と比較し、統一により結果が変わる入力を固定する。
import { describe, it, expect } from 'vitest';

await import('../../js/ui/escape.js');
const { BookshelfEscape } = globalThis;

describe('BookshelfEscape.escapeHtml (統一後の仕様)', () => {
    it('& < > " \' をすべて実体参照に変換する', () => {
        expect(BookshelfEscape.escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });
    it('null/undefined は空文字になる', () => {
        expect(BookshelfEscape.escapeHtml(null)).toBe('');
        expect(BookshelfEscape.escapeHtml(undefined)).toBe('');
    });
    it('0 は "0" のまま残る(空文字にならない)', () => {
        expect(BookshelfEscape.escapeHtml(0)).toBe('0');
    });
    it('変換対象の文字を含まない文字列はそのまま', () => {
        expect(BookshelfEscape.escapeHtml('はじめてのプログラミング')).toBe('はじめてのプログラミング');
    });
});

describe('旧実装との差分(統一により結果が変わる入力・差分固定)', () => {
    // 旧 bookshelf.js escapeHtml (DOM textContentトリック・div.textContent+innerHTML)。
    // ブラウザの直列化は実質 & < > のみを実体参照化し、" ' は変換しない。
    const oldDomEscape = (s) => {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };
    it('" \' を含む本のタイトルは、旧escapeHtml(DOM方式)では非変換だったが統一後は変換される', () => {
        const input = `O'Reilly's "Pragmatic" Guide`;
        expect(oldDomEscape(input)).toBe(`O'Reilly's "Pragmatic" Guide`);
        expect(BookshelfEscape.escapeHtml(input)).toBe('O&#39;Reilly&#39;s &quot;Pragmatic&quot; Guide');
    });

    // 旧 dashboard.js _escape: & < > " は変換するが ' は変換しない
    const oldDashboardEscape = (s) => {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };
    it('\' を含む本のタイトルは、旧_escape(dashboard.js)では非変換だったが統一後は変換される', () => {
        const input = `Today's Pick`;
        expect(oldDashboardEscape(input)).toBe(`Today's Pick`);
        expect(BookshelfEscape.escapeHtml(input)).toBe('Today&#39;s Pick');
    });

    // 旧 bookshelf.js _escapeHtml / renderExclusionsList内ローカルescapeHtml: `s || ''` 方式
    const oldOrEmptyEscape = (s) => {
        return String(s || '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    };
    it('0 は、旧 _escapeHtml(||\'\'方式)では空文字になったが統一後は"0"のまま残る', () => {
        expect(oldOrEmptyEscape(0)).toBe('');
        expect(BookshelfEscape.escapeHtml(0)).toBe('0');
    });

    // 旧 icons.js _escapeXml: null/undefined チェックが無く String(null)==='null' のまま変換される
    const oldNoNullCheckEscape = (s) => {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    it('null は、旧_escapeXml(icons.js)では文字列"null"になったが統一後は空文字になる', () => {
        expect(oldNoNullCheckEscape(null)).toBe('null');
        expect(BookshelfEscape.escapeHtml(null)).toBe('');
    });
});
