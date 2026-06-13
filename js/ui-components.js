// ui-components.js - ドメインオブジェクトの描画を単一実装にする共通コンポーネント
//
// 背景: 同じ「本棚」がサイドバーのツリー・ホームのカード・公開の選択リストで
// バラバラに組まれていた (描画の重複)。本ファイルに「本棚の行」の正実装を集約し、
// 各コンテナ (ツリー / 公開ピッカー / 将来のリスト) はこれを内包する。
// CSS は .bsr-icon / .bsr-label / .bsr-count を共有し、配置だけコンテナ側が決める。
//
// 参照: T12 (モジュール分割 + 描画重複排除) / ADR 「同一ドメインオブジェクト=単一描画コンポーネント」

(function () {
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // internalId || id(slug)。bookshelf-manager._keyOf と同じ規則 (依存を持たないよう再実装)
    function keyOf(bs) {
        return bs.internalId || bs.id;
    }

    const BookshelfUI = {
        esc,
        keyOf,

        // 本棚の「アイコン + 名前 + 冊数」コア (共通の見た目)。
        // ツリー・ピッカーなど各コンテナがこの 3 span をそのまま内包する。
        // count を省略すると冊数 span を出さない。
        rowCore(bs, opts = {}) {
            const iconName = bs.iconName || 'library';
            const iconSvg = (typeof window !== 'undefined' && window.renderIcon)
                ? window.renderIcon(iconName, { size: 16 }) : '';
            const count = opts.count;
            const countHtml = (count == null) ? '' : `<span class="bsr-count">${esc(count)}</span>`;
            return `<span class="bsr-icon" data-icon-value="${esc(iconName)}">${iconSvg}</span>`
                + `<span class="bsr-label" title="${esc(bs.name)}">${esc(bs.name)}</span>`
                + countHtml;
        },

        // 選択可能な独立した本棚行 (公開ページの本棚選択など)。
        // 値は keyOf(bs)。クリックでトグルする前提で aria-pressed と .is-selected を持つ。
        pickItem(bs, opts = {}) {
            const selected = !!opts.selected;
            const value = (opts.value != null) ? opts.value : keyOf(bs);
            const checkSvg = (typeof window !== 'undefined' && window.renderIcon)
                ? window.renderIcon('check', { size: 14 }) : '';
            return `<button type="button" class="bookshelf-row bs-pick-item${selected ? ' is-selected' : ''}"`
                + ` data-value="${esc(value)}" aria-pressed="${selected ? 'true' : 'false'}">`
                + `<span class="bsr-check">${checkSvg}</span>`
                + this.rowCore(bs, { count: opts.count })
                + `</button>`;
        }
    };

    if (typeof window !== 'undefined') window.BookshelfUI = BookshelfUI;
    if (typeof globalThis !== 'undefined') globalThis.BookshelfUI = BookshelfUI;
})();
