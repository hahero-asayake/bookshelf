// EmptyState — 空・失敗の表示の部品 (イシュー#518 U5)
//
// 既存は画面ごとに `<li class="pp-empty pp-error">...</li>` のような HTML 文字列を直接組み立てて
// innerHTML に差し込む実装が各所に散っていた (docs/char/u5-inventory.md §4: tree-empty・
// cmdk-empty・bookshelf-empty・pp-empty 系 他)。画面ごとにタグ名・クラス名・インラインstyleが
// 異なるため、この部品はそれらを強制しない: 呼び出し側が既存のタグ名・クラス名をそのまま渡し、
// この部品は「文言のエスケープ + 組み立て」という共通の最後の一手だけをまとめる。
// (U5は「見た目を変えない」「文言は変えない」が条件のため、既存のクラス構造を壊さない設計にした。)
//
// まだどこからも呼ばない (足すだけ)。置き換え時 (step3) に、既存の各箇所の tag/className/文言を
// そのまま html() の引数に渡す形にする。
//
// 使い方:
//   EmptyState.html({ tag: 'li', className: 'pp-empty pp-error', message: msg, iconHtml, actionHtml });
//   EmptyState.html({ tag: 'p', className: 'tree-empty', style: 'padding:0.5rem 0.6rem;...', message: '本棚がありません' });

(function () {
    'use strict';

    // bookshelf.js の escapeHtml と同じ最小実装 (依存を増やさないため自前で持つ)。
    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    // tag: 要素名 (既定 'div')。className: 既存のクラス文字列そのまま (必須ではない)。
    // message: 表示文言 (エスケープして差し込む・変えない)。iconHtml/actionHtml: 文言の前後に
    // 差し込む既存のアイコン/ボタン等の HTML (呼び出し側が組み立てた文字列をそのまま使う=
    // この部品はエスケープしない。信頼できる静的文字列のみを渡すこと)。style: インラインstyle文字列。
    function html({ tag = 'div', className = '', message = '', iconHtml = '', actionHtml = '', style = '' } = {}) {
        const classAttr = className ? ` class="${className}"` : '';
        const styleAttr = style ? ` style="${style}"` : '';
        return `<${tag}${classAttr}${styleAttr}>${iconHtml}${escapeHtml(message)}${actionHtml}</${tag}>`;
    }

    window.EmptyState = { html, escapeHtml };
})();
