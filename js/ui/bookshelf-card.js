// 本棚カード・ツリー順の共用部品 (js/ui/bookshelf-card.js)
// イシュー#546 (U8e): js/bookshelf.js の VirtualBookshelf と js/dashboard.js の
// BookshelfDashboard (this.app 経由) の両方から呼ばれる共用部品3件
// (_bookshelvesInTreeOrder・_bindBookshelfOverviewEvents・_renderBookshelfCard) を、
// ここへ移した(移動のみ・本文は1行も書き換えていない)。範囲の確定・3案比較(bookshelf.js残置/
// js/ui/切り出し/dashboard.js寄せ)は docs/char/u8e-step1-scope.md §2 参照(②承認= (b) js/ui/)。
//
// 取り付け方 (Plan A・U7(article-editor.js)〜U8d(bookshelf-list.js)と同じ形・
// docs/char/u7-step1-scope.md §7参照):
// 下の class 本体に書いたメソッドは、匿名クラスの prototype から記述子を取り出し、
// VirtualBookshelf.prototype へそのまま上書き定義する。class構文のまま(オブジェクトリテラルの
// カンマ区切りに変換しない)なので、各メソッドの見出し・本体は元のbookshelf.jsと一字一句同じ。
// 呼ばれる時の this は今までと同じ VirtualBookshelf インスタンスを指す
// (js/dashboard.js の `app._renderBookshelfCard(...)` 等も無変更で動く。this.app 経由の
// 呼び方を変えるのは U9 の仕事＝今回はやらない)。
//
// dashboard.js は VirtualBookshelf の定義・インスタンス化より前の script タグで読み込まれて
// いるが、このファイルが行う prototype への上書き定義は実行時(DOMContentLoaded 内の
// `new VirtualBookshelf()` より前)に完了していればよく、dashboard.js の class 定義自体は
// app._renderBookshelfCard 等を呼ばない(呼ぶのは render() 内で、実際の呼び出しは
// VirtualBookshelf インスタンス化・init() 完了後)。index.html での読み込み位置は
// js/bookshelf.js より後・他の js/screens/*.js と同じ並び(DOMContentLoadedより前)。
//
// 移さなかったもの: _bookshelfDescription(_renderBookshelfCardの下請け・3行・本棚ヘッダー
// (_updateBookshelfViewTitle・残留確定済み)と共用のため bookshelf.js に残す)。
// renderBookshelfOverview(14行・#bookshelves-grid が無い no-op 経路)も今回は移さない
// (②指示: U8f(公開の一覧)へ回す。docs/char/u8e-step1-scope.md §1)。

class _BookshelfCardMethods {
    /**
     * 本棚を「左ペインツリーと同じ表示順」で平坦化して返す。
     *   ALL(特殊) を先頭 → ルートを配列順 → 各本棚の子孫を深さ優先。
     * ツリーと本棚ハイライト(ダッシュボード)で順序を揃えるための共通ヘルパ。
     */
    _bookshelvesInTreeOrder() {
        const all = (this.userData?.bookshelves || []);
        const bm = this.bookshelfManager;
        const keyOf = (bs) => bm ? bm._keyOf(bs) : (bs.internalId || bs.id);
        const byParent = new Map();
        for (const bs of all) {
            const key = bs.parent || null;
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key).push(bs);
        }
        const result = [];
        const seen = new Set();
        const walk = (bs) => {
            const k = keyOf(bs);
            if (seen.has(k)) return;        // 循環ガード
            seen.add(k);
            result.push(bs);
            for (const child of (byParent.get(k) || [])) walk(child);
        };
        const roots = (byParent.get(null) || []).slice();
        roots.sort((a, b) => (b.isSpecial ? 1 : 0) - (a.isSpecial ? 1 : 0)); // ALL 先頭
        for (const r of roots) walk(r);
        return result;
    }

    /**
     * 本棚カード grid (renderBookshelfOverview / dashboard 本棚ハイライトウィジェット 共通) の
     * クリックハンドラをバインド。複数 host で呼ばれるため signal は使わず、各 host で 1 回だけ bind。
     */
    _bindBookshelfOverviewEvents(grid) {
        if (!grid) return;
        if (grid._bookshelfClickBound) return;
        grid._bookshelfClickBound = true;
        grid.addEventListener('click', (e) => {
            if (e.target.classList.contains('select-bookshelf')) {
                const bookshelfId = e.target.dataset.bookshelfId;
                this.switchBookshelf(bookshelfId);
                setTimeout(() => {
                    const bs = document.getElementById('bookshelf');
                    if (bs) bs.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            } else {
                const bookshelfPreview = e.target.closest('.bookshelf-preview');
                if (bookshelfPreview && !e.target.closest('.bookshelf-preview-actions')) {
                    const bookshelfId = bookshelfPreview.dataset.bookshelfId;
                    this.switchBookshelf(bookshelfId);
                    setTimeout(() => {
                        const bs = document.getElementById('bookshelf');
                        if (bs) bs.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 100);
                }
            }
        });
    }

    /**
     * 本棚プレビューカード 1 枚を生成 (all / ユーザ作成本棚 統一)
     */
    _renderBookshelfCard(bookshelf, textOnlyClass, bookByAsin) {
        const isSpecial = !!bookshelf.isSpecial;
        const cardEffectiveIcon = bookshelf.iconName || 'library';
        const iconSvg = window.renderIcon(cardEffectiveIcon, { size: 18 });
        const name = bookshelf.name || (isSpecial ? 'すべての本' : bookshelf.id);
        const description = this._bookshelfDescription(bookshelf);

        // プレビュー対象の本のリスト（特殊本棚 = all は全蔵書）
        let previewAsins = [];
        if (isSpecial) {
            previewAsins = (this.books || []).map(b => b.asin);
        } else if (Array.isArray(bookshelf.books)) {
            previewAsins = this.shelfVisibleAsins(bookshelf); // 見える本だけ (除外した本は数えない・イシュー#670)
        }
        const bookCount = previewAsins.length;

        // イシュー#398: この端末の並び順の設定 (#387 sortOrder/sortDirection) に合わせる。
        // 「自由な並び」の時だけ bookOrder (ドラッグで決めた順) を使い、それ以外は本棚一覧
        // (applySorting) と共有する _bookSortKey/_bookCompareFn で並べる。以前は sortOrder を見ず
        // bookOrder があれば無条件に使っていたため、タイトル順/取得日順に変えてもハイライトだけ
        // 古い (ドラッグ済みの) 順のままになっていた。
        if (this.sortOrder === 'custom') {
            if (this.userData.bookOrder && this.userData.bookOrder[bookshelf.id]) {
                const customOrder = this.userData.bookOrder[bookshelf.id];
                // イシュー#530 step2で見つけた低リスク改善: indexOf()はO(n)なのでsort比較のたびに
                // 全走査していた(O(n^2 log n)相当)。Map化してO(1)引きにする(n=780では0.6ms→0.1msと
                // 実測上は小さいが、蔵書数・本棚数が増えるほど効いてくるアルゴリズム的な非効率のため
                // 直す。②指示どおり「これで#530(3)の固まりが直った」とは言えない=未確認のまま)。
                const orderIndex = new Map(customOrder.map((asin, i) => [asin, i]));
                previewAsins.sort((a, b) => {
                    const ai = orderIndex.has(a) ? orderIndex.get(a) : -1;
                    const bi = orderIndex.has(b) ? orderIndex.get(b) : -1;
                    if (ai === -1 && bi === -1) return 0;
                    if (ai === -1) return 1;
                    if (bi === -1) return -1;
                    return ai - bi;
                });
            }
        } else if (isSpecial) {
            // 「すべての本」は全蔵書を並べた結果そのものの先頭が答え (本棚ごとに並べ直さない)
            previewAsins = this._getLibrarySortedAsins().asins;
        } else {
            // 通常本棚はこの本棚の冊数 (913件より十分小さい) だけを順位表で並べ替える
            const { rank } = this._getLibrarySortedAsins();
            previewAsins.sort((a, b) => (rank.has(a) ? rank.get(a) : Infinity) - (rank.has(b) ? rank.get(b) : Infinity));
        }

        const previewBooks = previewAsins.slice(0, 8);
        const previewHtml = previewBooks.map(asin => {
            // イシュー#575: 呼び出し側が asin→本 の Map を渡したらそれを引く (ホームのハイライトは
            // 本棚数×8回の全蔵書走査が 9000冊・61本棚で約70ms(CPU6倍)になっていた)。Map は find と
            // 同じく最初に一致した本を持つ。渡さない呼び出し(本棚一覧)は従来どおり find。
            const book = bookByAsin ? bookByAsin.get(asin) : (this.books || []).find(b => b.asin === asin);
            // data-asin: 表紙が読み込み失敗/1x1(_setupCoverFallback)で<img>がプレースホルダdivに
            // 差し替わっても、並び順をasinで検証できるように外側のラッパーに持たせる(イシュー#398)。
            if (book && this.bookManager.hasCoverImage(book)) {
                return `<div class="bookshelf-preview-book" data-asin="${asin}"><img src="${this.bookManager.getProductImageUrl(book)}" alt="${book.title}" data-cover-fallback=""></div>`;
            }
            return `<div class="bookshelf-preview-book bookshelf-preview-placeholder" data-asin="${asin}">${window.renderIcon('book-open', { size: 20 })}</div>`;
        }).join('');

        return `
            <div class="bookshelf-preview ${textOnlyClass}" data-bookshelf-id="${bookshelf.id}">
                <div class="bookshelf-preview-header">
                    <h3><span class="bs-card-icon" data-icon-value="${cardEffectiveIcon.replace(/"/g,'&quot;')}">${iconSvg}</span>${name}</h3>
                </div>
                <p class="bs-card-desc">${description}</p>
                <p class="book-count">${bookCount}冊</p>
                <div class="bookshelf-preview-books">${previewHtml}</div>
            </div>
        `;
    }
}

const _bookshelfCardDescriptors = Object.getOwnPropertyDescriptors(_BookshelfCardMethods.prototype);
delete _bookshelfCardDescriptors.constructor;
Object.defineProperties(VirtualBookshelf.prototype, _bookshelfCardDescriptors);
