// EmptyState (js/ui/empty-state.js・イシュー#518 U5) の契約。
// 既存各所のHTML文字列組み立て(docs/char/u5-inventory.md §4)を壊さないことが条件のため、
// 既存の実例(tree-empty・pp-empty pp-error 等)をそのまま引数に渡した時の出力を確認する。
import { describe, it, expect } from 'vitest';

await import('../../js/ui/escape.js');
await import('../../js/ui/empty-state.js');
const { EmptyState } = globalThis;

describe('EmptyState.html', () => {
    it('既定は div タグ・クラス無し', () => {
        expect(EmptyState.html({ message: 'x' })).toBe('<div>x</div>');
    });

    it('tag/className を指定できる (tree-empty の実例・style付き)', () => {
        const out = EmptyState.html({
            tag: 'p',
            className: 'tree-empty',
            style: 'padding:0.5rem 0.6rem;color:#9ca3af;font-size:0.8rem;',
            message: '本棚がありません',
        });
        expect(out).toBe(
            '<p class="tree-empty" style="padding:0.5rem 0.6rem;color:#9ca3af;font-size:0.8rem;">本棚がありません</p>'
        );
    });

    it('cmdk-empty の実例 (li・文言のみ)', () => {
        expect(EmptyState.html({ tag: 'li', className: 'cmdk-empty', message: '該当なし' }))
            .toBe('<li class="cmdk-empty">該当なし</li>');
    });

    it('iconHtml・actionHtml を前後に差し込む (pp-empty pp-error の実例)', () => {
        const iconHtml = '<span class="h-icon" data-icon="alert-triangle" data-icon-size="14"></span>';
        const actionBtn = '<button class="btn btn-secondary btn-small" data-act="open-settings" type="button">設定を開く</button>';
        const out = EmptyState.html({
            tag: 'li', className: 'pp-empty pp-error', message: '保存先から記事を読み込めませんでした。接続を確認して開き直してください。',
            iconHtml, actionHtml: actionBtn,
        });
        expect(out).toBe(`<li class="pp-empty pp-error">${iconHtml}保存先から記事を読み込めませんでした。接続を確認して開き直してください。${actionBtn}</li>`);
    });

    it('message は HTML エスケープする (文言そのものにタグ記号が混じっても壊れない)', () => {
        expect(EmptyState.html({ tag: 'li', message: '<script>&"\'' }))
            .toBe('<li>&lt;script&gt;&amp;&quot;&#39;</li>');
    });

    it('iconHtml/actionHtml はエスケープしない (呼び出し側が組み立てた静的HTMLをそのまま使う契約)', () => {
        const out = EmptyState.html({ tag: 'li', message: 'm', iconHtml: '<b>i</b>' });
        expect(out).toBe('<li><b>i</b>m</li>');
    });
});

describe('EmptyState.escapeHtml', () => {
    it('& < > " \' をエスケープする', () => {
        expect(EmptyState.escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    });

    it('null/undefined は空文字扱い', () => {
        expect(EmptyState.escapeHtml(null)).toBe('');
        expect(EmptyState.escapeHtml(undefined)).toBe('');
    });
});
