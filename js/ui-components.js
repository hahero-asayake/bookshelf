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
    const SHELF_SEP = ' / '; // getPathLabel・getShelfLabel と同じ区切り (イシュー#746)

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

        // イシュー#746 (T1): 1行の部品に本棚を出す時の HTML。切り替え (bm.shelfPathOn) が on なら
        // 親からのパスを .shelf-path に入れ、段 (根→自身) は data-shelf-segs に JSON で持つ (文字から ' / ' で割らない)。
        // off なら今と同じ素の名前 (エスケープ済み) = 前の形の DOM。opts.parentsOnly は本棚の画面の題の下の行用 (親まで)。
        shelfPathHtml(bm, shelfOrKey, opts = {}) {
            const shelf = (shelfOrKey && typeof shelfOrKey === 'object') ? shelfOrKey : (bm && bm.getById(shelfOrKey));
            if (!shelf) return '';
            const on = !!(bm && typeof bm.shelfPathOn === 'function' && bm.shelfPathOn());
            if (!on || shelf.isSpecial) return esc(shelf.name || '');
            let segs = bm.getShelfPath(shelf);
            if (opts.parentsOnly) segs = segs.slice(0, -1);
            if (!segs.length) return '';
            // 1階層は名前だけ = 前と同じ素の名前 (折り返し・幅の決まりも前のまま)。T1 は親がある時だけ
            if (!opts.parentsOnly && segs.length === 1) return esc(shelf.name || '');
            return `<span class="shelf-path" data-shelf-segs="${esc(JSON.stringify(segs))}">${esc(segs.join(SHELF_SEP))}</span>`;
        },

        // イシュー#746 (T1): root の中の見えている .shelf-path を、欄に収まらない時だけ根の側の段から「… / 」に替える。
        // 最後の段 (本棚自身・題の下の行では いちばん近い親) は必ず残す。それでも収まらない時は is-self-wrap で折り返す。
        // 省いた時は title 属性に全文。#359 の教訓 (一覧の強制レイアウト) に沿い、全部を全文に戻す (書く) →
        // まとめて測る (読む) → はみ出した物だけ段を落として測り直す。見えていない物は飛ばす。
        fitShelfPaths(root) {
            const scope = root || (typeof document !== 'undefined' ? document : null);
            if (!scope || !scope.querySelectorAll) return 0;
            const items = [];
            let hidden = 0;
            for (const el of scope.querySelectorAll('.shelf-path[data-shelf-segs]')) {
                if (!el.getClientRects().length || !el.clientWidth) { hidden++; continue; }
                let segs = null;
                try { segs = JSON.parse(el.dataset.shelfSegs); } catch (_) { segs = null; }
                if (Array.isArray(segs) && segs.length) items.push({ el, segs });
            }
            for (const { el, segs } of items) {
                el.textContent = segs.join(SHELF_SEP);
                el.classList.remove('is-t1', 'is-self-wrap');
                el.removeAttribute('title');
            }
            const over = items.filter(({ el }) => el.scrollWidth > el.clientWidth + 1);
            for (const { el, segs } of over) {
                const full = segs.join(SHELF_SEP);
                let fit = false;
                for (let k = 1; k < segs.length; k++) {
                    el.textContent = '…' + SHELF_SEP + segs.slice(k).join(SHELF_SEP);
                    if (el.scrollWidth <= el.clientWidth + 1) { fit = true; break; }
                }
                if (!fit) el.classList.add('is-self-wrap');
                if (segs.length > 1) { el.classList.add('is-t1'); el.title = full; }
            }
            // 描いた時に見えていなかった物 (ホームの起動中・閉じた一覧) は、少し後に1回だけ測り直す
            if (hidden && !scope.__shelfFitRetry && typeof setTimeout === 'function') {
                scope.__shelfFitRetry = true;
                setTimeout(() => { scope.__shelfFitRetry = false; BookshelfUI.fitShelfPaths(scope === document ? document : (scope.isConnected ? scope : document)); }, 300);
            }
            return over.length;
        },

    };

    // イシュー#746: 画面の幅が変わった時は、見えている .shelf-path を測り直す (window の resize に1つだけ・rAF でまとめる)。
    if (typeof window !== 'undefined' && !window.__shelfPathResizeBound) {
        window.__shelfPathResizeBound = true;
        let raf = null;
        window.addEventListener('resize', () => {
            if (raf) return;
            raf = requestAnimationFrame(() => { raf = null; BookshelfUI.fitShelfPaths(document); });
        });
    }

    if (typeof window !== 'undefined') window.BookshelfUI = BookshelfUI;
    if (typeof globalThis !== 'undefined') globalThis.BookshelfUI = BookshelfUI;
})();
