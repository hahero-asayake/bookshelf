// PendingSave — 入力のあと少し待ってから保存する予約の置き場 (イシュー#618)
//
// 入力のたびに保存せず、少し待ってから保存する予約 (debounce) を、key ごとに1つ持つ。
// ページを離れる時 (pagehide・beforeunload・visibilitychange=hidden。記事エディタの #595 と同じ3つ) は、
// 残っている予約を全部その場で同期に実行する = 保存待ちの間にタブを閉じても、入力が消えない。
// 予約が無い時は何もしない (無変更で保存しない)。
//
// 使っているもの: 本の詳細の短文メモ (js/screens/book-detail.js _scheduleNoteAutoSave)・
// ホームの自由メモ (js/dashboard.js _renderPinnedMemo)。
// 記事エディタの予約 (記事の _artSaveTimer・本のメモの _artMemoTimers) は、ここに乗せていない
// (js/screens/article-editor.js の _artSettleOnLeave が受け持つ・イシュー#595/#609・ADR-165)。理由は2つ:
// (1) ここのリスナーは読み込み時に登録されるので、乗せると js/bookshelf.js の離れる時の処理より先に走るよう
//     順番が入れ替わり、裏に回る時に記事の予約と送る予約が重なると、1回目に送る中身が変わりうる。
// (2) 画面の中で離れる経路 (←・×/Esc・戻る・別の記事を開く) でも、記事エディタ専用の確定 (_artSettlePendingSave) が要る。
//
// 使い方:
//   PendingSave.schedule(key, ({ reason }) => { ...保存... }, ms); // 同じ key は前の予約を置き換える
//   PendingSave.flush(key, reason);   // その予約を今すぐ実行する (無ければ何もしない)。実行したら true
//   PendingSave.flushAll(reason);     // 予約を全部、今すぐ実行する
//   PendingSave.has(key);             // 予約があるか
// fn には { reason } を渡す。時間が来た時は 'timer'、ページを離れる時は 'leave'、flush/flushAll は渡された値。
// fn の例外 (返した Promise の reject も) は1件ずつ受け止めて console.error に出し、次の予約へ進む
// (1件の失敗で、ほかの保存を落とさない)。

(function () {
    'use strict';

    const pending = new Map(); // key -> { timer, fn }

    function run(key, reason) {
        const entry = pending.get(key);
        if (!entry) return false;
        clearTimeout(entry.timer);
        pending.delete(key);
        const report = (e) => console.error(`PendingSave: ${key} の保存に失敗しました`, e);
        try {
            const r = entry.fn({ reason });
            if (r && typeof r.catch === 'function') r.catch(report);
        } catch (e) {
            report(e);
        }
        return true;
    }

    function schedule(key, fn, ms) {
        if (typeof fn !== 'function') throw new Error('PendingSave.schedule: fn (function) is required');
        const prev = pending.get(key);
        if (prev) clearTimeout(prev.timer);
        const timer = setTimeout(() => run(key, 'timer'), ms);
        pending.set(key, { timer, fn });
    }

    function flush(key, reason = 'flush') {
        return run(key, reason);
    }

    function flushAll(reason = 'flush') {
        [...pending.keys()].forEach((key) => run(key, reason));
    }

    function has(key) {
        return pending.has(key);
    }

    const onLeave = () => flushAll('leave');
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onLeave(); });

    window.PendingSave = { schedule, flush, flushAll, has };
})();
