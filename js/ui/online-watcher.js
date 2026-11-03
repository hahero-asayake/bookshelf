// OnlineWatcher — オンライン・オフラインの見張り (イシュー#518 U5)
//
// 499-step3-arch.md の実測どおり、js/ 全体に navigator.onLine / 'online' / 'offline' の専用の
// 扱いが0件だった (docs/char/u0-77-table.md E3: オフラインで保存してもトーストは出ない)。
// この部品は見張って状態を出すところまでで、オフラインの時の表示を変えるのは X4 の範囲
// (このイシューでは行わない・ブリーフの指定どおり)。
//
// まだどこからも呼ばない (足すだけ)。X4 で SaveStatus 等に state を伝える土台として使う想定。
//
// 使い方:
//   OnlineWatcher.isOnline();                    // 現在値 (navigator.onLine)
//   const off = OnlineWatcher.onChange((online) => { ... }); // 変化時に呼ばれる。off() で解除

(function () {
    'use strict';

    function isOnline() {
        return typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true;
    }

    function onChange(callback) {
        if (typeof callback !== 'function') throw new Error('OnlineWatcher.onChange: callback (function) is required');
        const onOnline = () => callback(true);
        const onOffline = () => callback(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }

    window.OnlineWatcher = { isOnline, onChange };
})();
