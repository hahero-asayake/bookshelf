// WidgetHoles (js/ui/widget-holes.js・イシュー#521 X2) の契約。
// 実測 (docs/char/x2-design.md §2) と一致すること: 既定の並びで 12列は2つ、2列は1つの穴。
import { describe, it, expect } from 'vitest';

await import('../../js/ui/widget-holes.js');
const { WidgetHoles } = globalThis;

describe('WidgetHoles.compute', () => {
    it('12列・既定の並び (3,3,3,3,9,6,12,12) → 最近の本の右に3列、今日の一冊の右に6列', () => {
        expect(WidgetHoles.compute([3, 3, 3, 3, 9, 6, 12, 12], 12)).toEqual([
            { index: 5, col: 9, row: 1, width: 3 },
            { index: 6, col: 6, row: 2, width: 6 },
        ]);
    });

    it('2列・既定の並び (half×4, full, half, full, full) → 今日の一冊の右に1列', () => {
        expect(WidgetHoles.compute([1, 1, 1, 1, 2, 1, 2, 2], 2)).toEqual([
            { index: 6, col: 1, row: 3, width: 1 },
        ]);
    });

    it('2列・最後の行が半分で終わる → 末尾の穴 (index=長さ)', () => {
        expect(WidgetHoles.compute([2, 1], 2)).toEqual([{ index: 2, col: 1, row: 1, width: 1 }]);
    });

    it('2列・すべて埋まる → 穴なし', () => {
        expect(WidgetHoles.compute([1, 1, 2, 2], 2)).toEqual([]);
    });

    it('1列 → 穴は決してできない', () => {
        expect(WidgetHoles.compute([1, 1, 1], 1)).toEqual([]);
        expect(WidgetHoles.compute([2, 5], 1)).toEqual([]); // 列数を超える幅は1列に丸める
    });

    it('4列 → 行の残りに入らない時と末尾', () => {
        expect(WidgetHoles.compute([1, 2, 2, 3, 1], 4)).toEqual([
            { index: 2, col: 3, row: 0, width: 1 },
            { index: 3, col: 2, row: 1, width: 2 },
        ]);
        expect(WidgetHoles.compute([1, 1, 1], 4)).toEqual([{ index: 3, col: 3, row: 0, width: 1 }]);
    });

    it('古い span (4/8) も列数として扱う・空の並びは穴なし', () => {
        expect(WidgetHoles.compute([4, 4, 8], 12)).toEqual([{ index: 2, col: 8, row: 0, width: 4 }, { index: 3, col: 8, row: 1, width: 4 }]);
        expect(WidgetHoles.compute([], 12)).toEqual([]);
    });
});
