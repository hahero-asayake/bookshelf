// PendingSave (js/ui/pending-save.js・イシュー#618) の契約。
// 入力のあと少し待ってから保存する予約を key ごとに持ち、ページを離れる時は残りを全部その場で実行する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

await import('../../js/ui/pending-save.js');
const { PendingSave } = globalThis;

describe('PendingSave', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
        PendingSave.flushAll('cleanup');
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('時間が来たら1回だけ実行し、reason は timer', () => {
        const fn = vi.fn();
        PendingSave.schedule('a', fn, 300);
        expect(PendingSave.has('a')).toBe(true);
        vi.advanceTimersByTime(299);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith({ reason: 'timer' });
        expect(PendingSave.has('a')).toBe(false);
    });

    it('同じ key で呼ぶと前の予約を置き換える (前の fn は呼ばれない)', () => {
        const first = vi.fn();
        const second = vi.fn();
        PendingSave.schedule('a', first, 300);
        vi.advanceTimersByTime(200);
        PendingSave.schedule('a', second, 300);
        vi.advanceTimersByTime(200);
        expect(first).not.toHaveBeenCalled();
        expect(second).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('flush はその予約だけを今すぐ実行し、あとで時間が来ても2回目は呼ばない', () => {
        const a = vi.fn();
        const b = vi.fn();
        PendingSave.schedule('a', a, 300);
        PendingSave.schedule('b', b, 300);
        expect(PendingSave.flush('a', 'leave')).toBe(true);
        expect(a).toHaveBeenCalledWith({ reason: 'leave' });
        expect(b).not.toHaveBeenCalled();
        vi.advanceTimersByTime(300);
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('予約が無い時は何もしない (flush は false・flushAll は何も呼ばない)', () => {
        expect(PendingSave.flush('none')).toBe(false);
        expect(() => PendingSave.flushAll('leave')).not.toThrow();
        expect(PendingSave.has('none')).toBe(false);
    });

    it('flushAll は全部を今すぐ実行し、例外が出ても次の予約へ進む', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const throws = vi.fn(() => { throw new Error('同期の失敗'); });
        const rejects = vi.fn(async () => { throw new Error('非同期の失敗'); });
        const ok = vi.fn();
        PendingSave.schedule('throws', throws, 300);
        PendingSave.schedule('rejects', rejects, 300);
        PendingSave.schedule('ok', ok, 300);
        PendingSave.flushAll('leave');
        expect(throws).toHaveBeenCalledWith({ reason: 'leave' });
        expect(rejects).toHaveBeenCalledWith({ reason: 'leave' });
        expect(ok).toHaveBeenCalledWith({ reason: 'leave' });
        await vi.runAllTimersAsync();
        expect(err).toHaveBeenCalledTimes(2);
        expect(ok).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
        ['beforeunload', () => window.dispatchEvent(new Event('beforeunload'))],
    ])('ページを離れる時 (%s) は、残っている予約をその場で実行する (reason は leave)', (_name, leave) => {
        const fn = vi.fn();
        PendingSave.schedule('memo', fn, 400);
        leave();
        expect(fn).toHaveBeenCalledWith({ reason: 'leave' });
        expect(PendingSave.has('memo')).toBe(false);
    });

    it('裏に回った時 (visibilitychange=hidden) も実行する。表に戻った時 (visible) は実行しない', () => {
        const state = vi.spyOn(document, 'visibilityState', 'get');
        const fn = vi.fn();
        PendingSave.schedule('memo', fn, 400);
        state.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(fn).not.toHaveBeenCalled();
        state.mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(fn).toHaveBeenCalledWith({ reason: 'leave' });
    });
});
