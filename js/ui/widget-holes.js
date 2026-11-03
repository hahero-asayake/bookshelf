// WidgetHoles — 格子の「穴」の計算 (イシュー#521 X2・ホームの「＋ここに追加」枠)
//
// ホームの格子は grid-auto-flow: row (詰めない) なので、行の残りに入らない部品は次の行へ送られ、
// 行の右に空き (穴) が残る。ここではその流し方を模擬して、穴の位置と幅を返す (DOM を見ない純粋な関数)。
// 穴の位置は保存しない＝保存の形 (順と大きさ) は変えない。穴に入れる時は、返した index の位置に
// 並びへ挿入するだけでよい (穴の後ろに送られた部品の直前＝流し方の結果、穴の場所に入る)。
//
// 使い方: WidgetHoles.compute(colsList, C)
//   colsList: 並び順の各部品の幅 (列数)。PC は span、2列の格子では half=1 / full=2
//   C:        格子の列の数 (PC 12・スマホ 2)
//   戻り値:   [{ index, col, row, width }]  index=挿入位置 (0..colsList.length)、col/row=0始まり、width=列数
//             最後の行の残りも穴として返す (index = colsList.length)。
(function () {
    'use strict';

    function compute(colsList, C) {
        const holes = [];
        if (!(C > 0)) return holes;
        let col = 0, row = 0;
        for (let i = 0; i < colsList.length; i++) {
            const w = Math.max(1, Math.min(Number(colsList[i]) || C, C));
            if (col + w > C) {
                holes.push({ index: i, col, row, width: C - col });
                row++; col = 0;
            }
            col += w;
            if (col === C) { row++; col = 0; }
        }
        if (col > 0) holes.push({ index: colsList.length, col, row, width: C - col });
        return holes;
    }

    const api = { compute };
    if (typeof window !== 'undefined') window.WidgetHoles = api;
    if (typeof globalThis !== 'undefined') globalThis.WidgetHoles = api;
})();
