// Escape：HTML エスケープの単一実装 (イシュー#523・U6)
//
// 背景：旧実装は7か所に分かれ、1文字でも動きが違っていた (docs/char/u6-escape.md 参照)。
// 変換する文字は最も広い集合 (& < > " ') に統一し、null/undefined は '' にする。0 は "0" のまま残す
// (旧 bookshelf.js _escapeHtml・renderExclusionsList 内ローカル escapeHtml の `s || ''` 方式は
//  0 が '' になる差分があったため、どちらにも合わせず広い方 (ui-components.js esc と同じ方式) を正とした)。
//
// 読み込み：ビルド無しSPA・他の js/ui/*.js と同じ window 公開パターン。vitest は jsdom 環境なので
// (vitest.config.js `environment: 'jsdom'`)、node 側のテストも window 経由でそのまま読める
// (publish-article-generator.test.js も同じ `await import('../../js/xxx.js')` → window.XXX の形)。
(function () {
    'use strict';

    function escapeHtml(s) {
        return s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    window.BookshelfEscape = { escapeHtml };
})();
