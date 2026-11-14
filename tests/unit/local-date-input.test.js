// イシュー#631: 日付だけの欄 (type="date") の値と、取得日時 (acquiredTime・ミリ秒) の変換。
// BookManager の acquiredTimeToDateInput / dateInputToAcquiredTime が、端末のタイムゾーンの日付で行き来することを確かめる。
// 東京・ロサンゼルスなど、タイムゾーンを決めた判定は、画面を通す tests/e2e/book-detail-acquired-date.spec.js が持つ。
// ここでは、どのタイムゾーンで流しても成り立つ性質だけを見る (期待値も端末の日付・時刻から作る)。
import { describe, it, expect } from 'vitest';

await import('../../js/book-manager.js');
const bm = new window.BookManager();

// 端末のタイムゾーンでの日時 → ミリ秒
const local = (y, m, d, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, mi, s, ms).getTime();

describe('acquiredTimeToDateInput (取得日時 → 欄の日付)', () => {
    it('端末の日付になる。その日の 0:00 でも 23:59:59.999 でも同じ日', () => {
        expect(bm.acquiredTimeToDateInput(local(2023, 11, 15))).toBe('2023-11-15');
        expect(bm.acquiredTimeToDateInput(local(2023, 11, 15, 7, 13, 21))).toBe('2023-11-15');
        expect(bm.acquiredTimeToDateInput(local(2023, 11, 15, 23, 59, 59, 999))).toBe('2023-11-15');
    });

    it('月と日を2桁にそろえる', () => {
        expect(bm.acquiredTimeToDateInput(local(2024, 1, 5, 12))).toBe('2024-01-05');
    });

    it('月末・年末・年始・うるう日', () => {
        expect(bm.acquiredTimeToDateInput(local(2023, 11, 30, 23, 59))).toBe('2023-11-30');
        expect(bm.acquiredTimeToDateInput(local(2023, 12, 31, 23, 59))).toBe('2023-12-31');
        expect(bm.acquiredTimeToDateInput(local(2024, 1, 1))).toBe('2024-01-01');
        expect(bm.acquiredTimeToDateInput(local(2024, 2, 29, 12))).toBe('2024-02-29');
    });

    it('文字列の数値も受ける', () => {
        expect(bm.acquiredTimeToDateInput(String(local(2023, 11, 15, 7)))).toBe('2023-11-15');
    });

    it('数として読めない値は空の欄にする (例外にしない)', () => {
        for (const bad of [undefined, 'abc', NaN, Infinity, -Infinity, {}]) {
            expect(bm.acquiredTimeToDateInput(bad)).toBe('');
        }
    });

    it('閲覧の表示 (toLocaleDateString) と同じ日付になる', () => {
        const viewDate = (ms) => {
            const [y, m, d] = new Date(ms).toLocaleDateString('ja-JP').split('/');
            return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        };
        // フィクスチャの本 (UTC 2023-11-14 22:13 台) と、UTC の日付の変わり目の前後
        for (const ms of [1700000001000, Date.UTC(2023, 10, 14, 23, 59, 59), Date.UTC(2023, 10, 15, 0, 0, 0), Date.UTC(2024, 1, 29, 12)]) {
            expect(bm.acquiredTimeToDateInput(ms)).toBe(viewDate(ms));
        }
    });
});

describe('dateInputToAcquiredTime (欄の日付 → 取得日時)', () => {
    it('その日の、端末のタイムゾーンの0時になる', () => {
        expect(bm.dateInputToAcquiredTime('2023-11-20')).toBe(local(2023, 11, 20));
        const d = new Date(bm.dateInputToAcquiredTime('2023-11-20'));
        expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2023, 11, 20, 0, 0]);
    });

    it('うるう日は、ある年だけ受ける', () => {
        expect(bm.dateInputToAcquiredTime('2024-02-29')).toBe(local(2024, 2, 29));
        expect(bm.dateInputToAcquiredTime('2023-02-29')).toBeNull();
    });

    it('形式が違う値・実在しない日付は null', () => {
        for (const bad of ['', null, undefined, '2023/11/20', '2023-11-20T00:00', '20231120', '2023-1-5', '2023-13-01', '2023-02-30', '2023-00-10', 'abc']) {
            expect(bm.dateInputToAcquiredTime(bad)).toBeNull();
        }
    });
});

describe('往復', () => {
    it('欄の日付 → 取得日時 → 欄の日付 で、元の日付に戻る', () => {
        // 夏時間の切り替わりの日 (米国 3/8・11/1、欧州 3/29・10/25) も入れる
        for (const s of ['2023-11-15', '2023-12-31', '2024-01-01', '2024-02-29', '1999-12-31', '2000-01-01',
            '2026-03-08', '2026-11-01', '2026-03-29', '2026-10-25']) {
            expect(bm.acquiredTimeToDateInput(bm.dateInputToAcquiredTime(s))).toBe(s);
        }
    });

    it('取得日時 → 欄の日付 → 取得日時 は、同じ日の0時になる (欄は時刻を持てない)', () => {
        const ms = local(2023, 11, 15, 7, 13, 21);
        expect(bm.dateInputToAcquiredTime(bm.acquiredTimeToDateInput(ms))).toBe(local(2023, 11, 15));
    });
});
