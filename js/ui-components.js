// ui-components.js - ドメインオブジェクトの描画を単一実装にする共通コンポーネント
//
// 背景: 同じ「本棚」がサイドバーのツリー・ホームのカード・公開の選択リストで
// バラバラに組まれていた (描画の重複)。本ファイルに「本棚の行」の正実装を集約し、
// 各コンテナ (ツリー / 公開ピッカー / 将来のリスト) はこれを内包する。
// CSS は .bsr-icon / .bsr-label / .bsr-count を共有し、配置だけコンテナ側が決める。
//
// 参照: T12 (モジュール分割 + 描画重複排除) / ADR 「同一ドメインオブジェクト=単一描画コンポーネント」
//
// イシュー#523 U6 で未使用関数を確認: pickRow/tree (選択可能なツリー描画) は外部から
// 呼ばれていなかったため撤去した (rowCore は js/bookshelf.js:6245 が使用中・esc/keyOf は
// 公開APIとして残す)。復元する時は本commitの直前を参照。

(function () {
    const esc = BookshelfEscape.escapeHtml;

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

    };

    if (typeof window !== 'undefined') window.BookshelfUI = BookshelfUI;
    if (typeof globalThis !== 'undefined') globalThis.BookshelfUI = BookshelfUI;
})();
