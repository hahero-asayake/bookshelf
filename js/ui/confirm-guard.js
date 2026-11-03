// ConfirmGuard — 未保存のまま離れる時の確認を1か所で判定する部品 (イシュー#518 U5)
//
// 既存の唯一の実装は bookshelf.js の `_formBackGuard`/`_formSnapOf`/`_formSnapTake`
// (D13・イシュー#284。docs/char/u5-inventory.md参照)。入力フォームを開いた時の値を控え、
// Surface の close フック (`this._surface().open(id, { close: (o) => this._formBackGuard(...) })`)
// から「戻る (fromHistory) の時だけ、開いた時から値が変わっていれば confirmDialog で確認する」
// というパターンを使っている。この部品はそのパターンを汎用化したもので、まだ bookshelf.js の
// _formBackGuard はこの部品を使わない (次の置き換え段で移す)。
//
// 確認そのものは window.confirmDialog (js/ui-feedback.js) に委ねる (直呼びにしない)。
//
// 使い方 (まだどこからも呼ばない。足すだけ):
//   const guard = ConfirmGuard.create();
//   guard.take('some-modal-id');             // モーダルを開いた時にスナップショットを控える
//   ...
//   this._surface().open('some-modal-id', {
//     close: (o) => guard.guard('some-modal-id', o, (oo) => this.closeSomeModal(oo), {
//       title: '入力した内容を破棄しますか？', message: '戻ると、入力した内容は保存されません。',
//       okLabel: '破棄する', cancelLabel: '編集を続ける', danger: true,
//     }),
//   });
//
// guard() は、o.fromHistory が true かつスナップショットから値が変わっている時だけ確認を出す。
// 確認で「編集を続ける」(false) を選んだら doClose を呼ばず false を返す (Surface の popstate
// ハンドラが段を積み直す。_formBackGuard と同じ契約)。それ以外は doClose(o) を呼んで true を返す。

(function () {
    'use strict';

    // 要素(id指定)内の input/textarea/select の値を直列化する。_formSnapOf と同じロジック。
    function snapshotOf(idOrEl) {
        const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
        if (!el) return '';
        return JSON.stringify(Array.from(el.querySelectorAll('input, textarea, select'))
            .filter((x) => x.type !== 'hidden' && x.type !== 'file')
            .map((x) => (x.type === 'checkbox' || x.type === 'radio') ? x.checked : x.value));
    }

    function create() {
        const snaps = {};
        return {
            // モーダル/フォームを開いた時に呼ぶ: 今の値を控える
            take(id) {
                snaps[id] = snapshotOf(id);
            },
            // 控えた時から値が変わっているか (take していない id は false)
            hasChanged(id) {
                return id in snaps && snaps[id] !== snapshotOf(id);
            },
            clear(id) {
                delete snaps[id];
            },
            // Surface の close フックから使う形。o は Surface が close に渡すオプション
            // ({ fromHistory, ... })。doClose は確認を通った後に実際に閉じる関数。
            async guard(id, o, doClose, dialogOpts) {
                if (o && o.fromHistory && this.hasChanged(id)) {
                    const ok = await window.confirmDialog(dialogOpts);
                    if (!ok) return false; // 留まる (呼び出し側が段を積み直す)
                }
                this.clear(id);
                doClose(o);
                return true;
            },
        };
    }

    window.ConfirmGuard = { create, snapshotOf };
})();
