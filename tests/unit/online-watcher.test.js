// OnlineWatcher (js/ui/online-watcher.js・イシュー#518 U5) の契約。
// このステップでは「見張って状態を出す」ところまで (表示を変えるのはX4)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

await import('../../js/ui/online-watcher.js');
const { OnlineWatcher } = globalThis;

describe('OnlineWatcher.isOnline', () => {
    it('navigator.onLine をそのまま返す', () => {
        const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        expect(OnlineWatcher.isOnline()).toBe(false);
        spy.mockReturnValue(true);
        expect(OnlineWatcher.isOnline()).toBe(true);
        spy.mockRestore();
    });
});

describe('OnlineWatcher.onChange', () => {
    let offFns = [];
    afterEach(() => {
        offFns.forEach((off) => off());
        offFns = [];
    });

    it('callback (function) が無いと例外', () => {
        expect(() => OnlineWatcher.onChange()).toThrow(/callback/);
    });

    it("window の 'offline' イベントで callback(false) を呼ぶ", () => {
        const cb = vi.fn();
        offFns.push(OnlineWatcher.onChange(cb));
        window.dispatchEvent(new Event('offline'));
        expect(cb).toHaveBeenCalledWith(false);
    });

    it("window の 'online' イベントで callback(true) を呼ぶ", () => {
        const cb = vi.fn();
        offFns.push(OnlineWatcher.onChange(cb));
        window.dispatchEvent(new Event('online'));
        expect(cb).toHaveBeenCalledWith(true);
    });

    it('戻り値の解除関数を呼ぶと、以後イベントで呼ばれない', () => {
        const cb = vi.fn();
        const off = OnlineWatcher.onChange(cb);
        off();
        window.dispatchEvent(new Event('online'));
        window.dispatchEvent(new Event('offline'));
        expect(cb).not.toHaveBeenCalled();
    });

    it('複数登録しても互いに独立して解除できる', () => {
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const off1 = OnlineWatcher.onChange(cb1);
        offFns.push(OnlineWatcher.onChange(cb2));
        off1();
        window.dispatchEvent(new Event('online'));
        expect(cb1).not.toHaveBeenCalled();
        expect(cb2).toHaveBeenCalledWith(true);
    });
});
