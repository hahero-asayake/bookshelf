// UndoToast — 「元に戻す」操作の土台 (イシュー#518 U5)
//
// 既存の window.toast (js/ui-feedback.js) は opts.action = { label, onClick } で、押すと
// onClick を呼んで自身を閉じるボタンを1つトーストに付けられる。UndoToast はこれを
// 「元に戻す」用途に絞ったラッパーで、見た目や基盤 (toast-container・自動消去) は
// 既存の toast をそのまま使う (新しい DOM 構造を作らない)。
//
// X2 (外したウィジェットの「元に戻す」) で使う想定。まだどこからも呼ばない (足すだけ)。
//
// 使い方:
//   UndoToast.show('ウィジェットを外しました。', { onUndo: () => restoreWidget(removed) });
//   UndoToast.show(message, { undoLabel: '取り消す', onUndo, duration: 8000 });

(function () {
    'use strict';

    const DEFAULT_UNDO_LABEL = '元に戻す';
    const DEFAULT_DURATION_MS = 6000; // 通常の info/success(4000ms)より長め=押す間を確保する

    function show(message, opts = {}) {
        const { undoLabel = DEFAULT_UNDO_LABEL, onUndo, duration = DEFAULT_DURATION_MS, type = 'info' } = opts;
        if (typeof onUndo !== 'function') {
            throw new Error('UndoToast.show: opts.onUndo (function) is required');
        }
        return window.toast(message, {
            type,
            duration,
            action: { label: undoLabel, onClick: onUndo },
        });
    }

    window.UndoToast = { show };
})();
