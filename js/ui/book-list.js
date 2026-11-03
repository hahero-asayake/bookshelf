// BookList — 本のカード・行の描画を1つにまとめる部品 (イシュー#523 U6)
//
// 背景：本1冊のカード/行を描く処理が、画面ごとに11個の関数に分かれていた
// (本棚メイン一覧・取込候補一覧・除外一覧・⌘K検索結果・ホーム「最近追加した本」の5画面+
//  重複ASINバッジの付属部品。tmp/523/step1-survey.md §1・step2-scope.md)。
// U6は「出力するHTMLとクラスは変えない」が条件のため、既存のテンプレート文字列をそのまま
// 移植し、`this` 依存 (userData・bookManager・設定取得等) は呼び出し側が opts で渡す形にした。
// U8 (本の詳細)・U7→X3 (記事エディタ系) は対象外 (②判断・tmp/523/step2-scope.md)。
//
// 画面ごとの小さな違い (ボタンの有無・画面の種類) は、各関数の opts で表す
// (画面ごとに分岐を書き足す形にはしない・関数自体を画面別に分けるのは出力DOMが
//  そもそも違う=.book-item/.book-selection-item/.exclusion-item/.widget-book-cell のため)。
(function () {
    'use strict';
    const esc = BookshelfEscape.escapeHtml;

    // Kindle状態バッジ(利用終了/KU/Prime)。旧 _kindleBadgesHtml と旧 _allBadgesHtml 内の
    // 同一ロジックの重複を統合 (出力は両者と同じ)。
    function kindleBadgeItems(book) {
        const items = [];
        if (book.statusFromPlatformSearch === 'Revoked') items.push('<span class="book-badge">利用終了</span>');
        if (book.originType === 'Ku') items.push('<span class="book-badge book-badge-accent">KU</span>');
        else if (book.originType === 'Prime') items.push('<span class="book-badge book-badge-accent">Prime</span>');
        return items;
    }
    function kindleBadgesHtml(book) {
        const items = kindleBadgeItems(book);
        return items.length ? `<div class="book-badges">${items.join('')}</div>` : '';
    }

    // 重複ASIN検出バッジ(1項目)。dupGroup は呼び出し側の this._dupAsinInfo().get(book.asin) 相当。
    // 旧 _duplicateAsinBadgeItem と同じ出力。
    function duplicateAsinBadgeItem(book, dupGroup) {
        if (!dupGroup) return null;
        const label = dupGroup.sameTitle ? '重複登録' : 'ASIN共有';
        const title = dupGroup.sameTitle
            ? '同じ本が複数登録されています(統合・削除の必要はありません)'
            : 'このASINは他の本と共有されています。本の詳細から付け直しをご検討ください';
        return `<span class="book-badge book-badge-warn" title="${esc(title)}">${label}</span>`;
    }

    // createBookElement 用の全バッジ(Kindle + 重複ASIN)。旧 _allBadgesHtml と同じ出力。
    function allBadgesHtml(book, dupGroup) {
        const items = kindleBadgeItems(book);
        const dup = duplicateAsinBadgeItem(book, dupGroup);
        if (dup) items.push(dup);
        return items.length ? `<div class="book-badges">${items.join('')}</div>` : '';
    }

    // 本棚メイン一覧の本カード(.book-item)の innerHTML。旧 createBookElement のテンプレート部分
    // (DOM生成・data属性・イベント配線は呼び出し側に残す=描画だけをここに寄せる)。
    // opts: { displayType, userNote, listMemo, isSelected, starVisibility, starOverlay,
    //         starWidgetHtml(asin,rating,size), formatMemo(memo,maxLen), dupGroup,
    //         hasCoverImage(book), getProductImageUrl(book) }
    function cardInnerHtml(book, opts = {}) {
        const listRating = opts.userNote?.rating || 0;
        const listMemo = opts.listMemo;

        const isCoverView = (opts.displayType === 'cover' || opts.displayType === 'covers');
        const isImagesView = (opts.displayType === 'images');
        const starVis = opts.starVisibility;
        const overlayOn = opts.starOverlay && isCoverView;
        let starSize;
        if (starVis === 'hover') starSize = 16;
        else if (overlayOn) starSize = 18;
        else starSize = isCoverView ? 15 : 16;
        const starWidget = (starVis === 'hidden' || isImagesView) ? '' : opts.starWidgetHtml(book.asin, listRating, starSize);
        const memoVis = isImagesView ? 'hidden' : opts.memoVisibility;

        const overlayAlwaysStars = (starVis === 'always' && overlayOn && starWidget)
            ? `<div class="cover-stars-layer stars-overlay">${starWidget}</div>` : '';
        const belowAlwaysStars = (starVis === 'always' && !overlayOn && starWidget)
            ? `<div class="book-rating">${starWidget}</div>` : '';
        const alwaysMemo = (memoVis === 'always' && listMemo)
            ? `<div class="book-memo">${opts.formatMemo(listMemo, isCoverView ? 90 : 140)}</div>` : '';

        const popStars = (starVis === 'hover' && starWidget)
            ? `<div class="pop-stars stars-overlay">${starWidget}</div>` : '';
        const popMemo = (memoVis === 'hover' && listMemo)
            ? `<div class="book-memo pop-memo">${opts.formatMemo(listMemo, 160)}</div>` : '';
        const hoverPop = (popStars || popMemo)
            ? `<div class="card-hover-pop">${popStars}${popMemo}</div>` : '';
        const coverHoverPop = isCoverView ? hoverPop : '';
        const rowHoverPop = isCoverView ? '' : hoverPop;

        const placeholderHtml = (isCoverView || isImagesView)
            ? `<div class="book-cover-placeholder">${esc(book.title)}</div>`
            : `<div class="book-cover-placeholder">${window.renderIcon('book-open', { size: 24 })}</div>`;

        const kindleBadges = allBadgesHtml(book, opts.dupGroup);
        const infoHtml = isImagesView ? '' : `
                <div class="book-info">
                    <div class="book-title">${esc(book.title)}</div>
                    <div class="book-author">${esc(book.authors)}</div>
                    ${kindleBadges}
                    ${belowAlwaysStars}
                    ${alwaysMemo}
                </div>`;
        const imagesBadges = (isImagesView && kindleBadges)
            ? `<div class="cover-badges-layer">${kindleBadges}</div>` : '';

        return `
                <div class="book-cover-container">
                    <div class="drag-handle">${window.renderIcon('grip-vertical', { size: 14 })}</div>
                    <div class="book-select-check" aria-hidden="true">${window.renderIcon('check', { size: 13 })}</div>
                    <div class="book-cover-link">
                        ${opts.hasCoverImage(book) ?
                            `<img class="book-cover lazy" data-src="${esc(opts.getProductImageUrl(book))}" alt="${esc(book.title)}" data-cover-fallback="${esc(book.title)}">` :
                            placeholderHtml
                        }
                    </div>
                    ${overlayAlwaysStars}
                    ${imagesBadges}
                    ${coverHoverPop}
                </div>${infoHtml}
                ${rowHoverPop}
            `;
    }

    // 取込候補一覧の行(.book-selection-item)の innerHTML。旧 renderBookList のテンプレート部分。
    // opts: { index, isBlocked, stateLabel }
    function selectionItemInnerHtml(book, opts) {
        return `
                <input type="checkbox" id="book-${opts.index}" value="${opts.index}" ${opts.isBlocked ? 'disabled' : ''}>
                <div class="book-selection-info">
                    <div class="book-selection-title">${esc(book.title)} ${opts.stateLabel}</div>
                    <div class="book-selection-author">${esc(book.authors)}</div>
                    <div class="book-selection-meta">${new Date(book.acquiredTime).toLocaleDateString('ja-JP')}</div>
                    ${kindleBadgesHtml(book)}
                </div>
            `;
    }

    // 除外一覧の行(.exclusion-item)の完全なHTML。旧 renderExclusionsList のテンプレート部分。
    // book は { title, authors, productImage } が無い (削除済みの本) 場合もあるため asin にフォールバック。
    function exclusionItemHtml(book, asin) {
        const title = esc(book.title || asin);
        const authors = esc(book.authors || '');
        const image = book.productImage ? esc(book.productImage) : '';
        return `
                <div class="exclusion-item">
                    ${image ? `<img class="exclusion-cover" src="${image}" alt="">` : '<div class="exclusion-cover exclusion-cover-empty"></div>'}
                    <div class="exclusion-meta">
                        <div class="exclusion-title">${title}</div>
                        <div class="exclusion-authors">${authors}</div>
                        <div class="exclusion-asin">${esc(asin)}</div>
                    </div>
                    <button class="btn btn-small btn-secondary unexclude-btn" data-asin="${esc(asin)}">元に戻す</button>
                </div>
            `;
    }

    // ホーム「最近追加した本」(.widget-book-cell) の中身。旧 dashboard._renderRecentBooks のテンプレート部分。
    // opts: { hasCoverImage(book), getProductImageUrl(book) }
    function recentCellHtml(book, opts) {
        return `
                    <button type="button" class="widget-book-cell" data-asin="${esc(book.asin)}" title="${esc(book.title)}">
                        ${opts.hasCoverImage(book)
                            ? `<img src="${esc(opts.getProductImageUrl(book))}" alt="" loading="lazy" data-cover-fallback="">`
                            : `<div class="widget-book-cell-placeholder">${window.renderIcon('book-open', { size: 24 })}</div>`}
                        <div class="widget-book-cell-title">${esc(book.title)}</div>
                    </button>
                `;
    }

    // ⌘K検索結果の「本」グループ1件への変換。旧 _renderPaletteResults 内の本専用の items.push(...) と
    // 同じ形 (group/icon/title/sub)。run は呼び出し側のコールバックのままなのでここでは作らない。
    function cmdkEntry(book) {
        return { group: '本', icon: 'book-open', title: book.title, sub: book.authors || '' };
    }

    window.BookList = {
        kindleBadgesHtml,
        duplicateAsinBadgeItem,
        allBadgesHtml,
        cardInnerHtml,
        selectionItemInnerHtml,
        exclusionItemHtml,
        recentCellHtml,
        cmdkEntry,
    };
})();
