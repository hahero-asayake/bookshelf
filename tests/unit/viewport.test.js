// Viewport (js/ui/viewport.js・イシュー#505) の契約。
// 境目は900pxの1組だけ(NARROW_MAX)・isNarrow/isWideが対になる・onChangeで跨いだ通知が来る・
// matchMediaが無い環境でもisNarrow=falseにフォールバックする(壊れない)。
// 実際のCSS/他JSからの参照経路の打鍵は tests/e2e/char/bp-820.spec.js 等が行う。
import { describe, it, expect, beforeEach, vi } from 'vitest';

function mockMatchMedia(initialMatches) {
    let matches = initialMatches;
    let changeHandler = null;
    const mql = {
        get matches() { return matches; },
        addEventListener: (type, cb) => { if (type === 'change') changeHandler = cb; },
        removeEventListener: () => { changeHandler = null; },
    };
    window.matchMedia = vi.fn(() => mql);
    return {
        setMatches(v) { matches = v; if (changeHandler) changeHandler({ matches: v }); },
    };
}

describe('viewport', () => {
    beforeEach(() => {
        vi.resetModules();
        delete window.viewport;
        delete window.matchMedia;
    });

    it('NARROW_MAX は900pxの1か所だけに定義されている', async () => {
        mockMatchMedia(false);
        await import('../../js/ui/viewport.js');
        expect(window.viewport.NARROW_MAX).toBe(900);
    });

    it('900px以下(matches=true)はisNarrow=true・isWide=false', async () => {
        mockMatchMedia(true);
        await import('../../js/ui/viewport.js');
        expect(window.viewport.isNarrow()).toBe(true);
        expect(window.viewport.isWide()).toBe(false);
    });

    it('901px以上(matches=false)はisNarrow=false・isWide=true', async () => {
        mockMatchMedia(false);
        await import('../../js/ui/viewport.js');
        expect(window.viewport.isNarrow()).toBe(false);
        expect(window.viewport.isWide()).toBe(true);
    });

    it('境目を跨いだらonChangeの購読者全員に新しい状態を知らせる', async () => {
        const ctl = mockMatchMedia(false);
        await import('../../js/ui/viewport.js');
        const calls1 = [];
        const calls2 = [];
        window.viewport.onChange((isNarrow) => calls1.push(isNarrow));
        window.viewport.onChange((isNarrow) => calls2.push(isNarrow));
        ctl.setMatches(true);
        expect(calls1).toEqual([true]);
        expect(calls2).toEqual([true]);
    });

    it('onChangeの戻り値で購読を解除できる', async () => {
        const ctl = mockMatchMedia(false);
        await import('../../js/ui/viewport.js');
        const calls = [];
        const unsub = window.viewport.onChange((isNarrow) => calls.push(isNarrow));
        unsub();
        ctl.setMatches(true);
        expect(calls).toEqual([]);
    });

    it('1つの購読者が例外を投げても他の購読者への通知は止まらない', async () => {
        const ctl = mockMatchMedia(false);
        await import('../../js/ui/viewport.js');
        const calls = [];
        window.viewport.onChange(() => { throw new Error('boom'); });
        window.viewport.onChange((isNarrow) => calls.push(isNarrow));
        expect(() => ctl.setMatches(true)).not.toThrow();
        expect(calls).toEqual([true]);
    });

    it('matchMediaが無い環境でもisNarrow=falseにフォールバックし、例外を投げない', async () => {
        window.matchMedia = undefined;
        await import('../../js/ui/viewport.js');
        expect(() => window.viewport.isNarrow()).not.toThrow();
        expect(window.viewport.isNarrow()).toBe(false);
        expect(window.viewport.isWide()).toBe(true);
    });

    it('onChangeに関数以外を渡しても例外を投げず、何もしない解除関数を返す', async () => {
        mockMatchMedia(false);
        await import('../../js/ui/viewport.js');
        const unsub = window.viewport.onChange(null);
        expect(typeof unsub).toBe('function');
        expect(() => unsub()).not.toThrow();
    });
});
