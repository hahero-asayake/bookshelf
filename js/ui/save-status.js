// SaveStatus — 保存の表示を1つの部品で出す (イシュー#518 U5)
//
// 既存は画面ごとに「対象要素に textContent を直接書き、is-xxx クラスを手で付け外しする」実装が
// 3画面(短文メモ・記事・長文メモ)に分かれていた(docs/char/u5-inventory.md §3)。この部品は
// その共通部分(テキストのセット・状態クラスの切替・一定時間後の自動クリア)だけを1か所にまとめる。
//
// 文言はこの部品の中には持たない (呼び出し側が渡す文字列をそのまま表示するだけ)。U5は「文言は
// 変えない」が条件のため、置き換え時 (step3) も各画面の既存の文言をそのまま渡す形にする。
//
// 使い方 (まだどこからも呼ばない。足すだけ):
//   SaveStatus.set(el, text, { state: 'saving'|'saved'|'error'|'offline'|<任意の文字列>|'', autoClearMs })
//   SaveStatus.set('art-save-status', '保存しました', { state: 'saved', autoClearMs: 1500 });
//   SaveStatus.clear(el);
//
// el は要素そのもの、または id 文字列 (document.getElementById で解決)。要素が無ければ無視する
// (既存の `if (statusEl) statusEl.textContent = ...` と同じ安全策)。
// state を渡すと `is-<state>` クラスを1つだけ付ける (前回の is-* クラスは先に全部外す)。
// state を渡さない ('' や未指定) 場合はテキストだけ変えて既存の is-* クラスは変えない
// (既存コードの一部が「クラスは呼び出し側で別に付け外す」形だったため、強制はしない)。
// autoClearMs を渡すと、その時間後に「表示したテキストから変わっていなければ」空文字へ戻す
// (既存の `setTimeout(() => { if (statusEl.textContent === text) ... }, 1500)` と同じ安全策=
// その間に別の状態に変わっていたら消さない)。

(function () {
    'use strict';

    function resolveEl(el) {
        if (!el) return null;
        if (typeof el === 'string') return document.getElementById(el);
        return el;
    }

    function clearStateClasses(node) {
        Array.from(node.classList)
            .filter((c) => c.startsWith('is-'))
            .forEach((c) => node.classList.remove(c));
    }

    function set(el, text, opts = {}) {
        const node = resolveEl(el);
        if (!node) return null;
        const { state, autoClearMs } = opts;
        node.textContent = text;
        if (state !== undefined) {
            clearStateClasses(node);
            if (state) node.classList.add(`is-${state}`);
        }
        if (autoClearMs) {
            setTimeout(() => {
                if (node.textContent === text) {
                    node.textContent = '';
                    if (state) clearStateClasses(node);
                }
            }, autoClearMs);
        }
        return node;
    }

    function clear(el) {
        const node = resolveEl(el);
        if (!node) return;
        node.textContent = '';
        clearStateClasses(node);
    }

    window.SaveStatus = { set, clear };
})();
