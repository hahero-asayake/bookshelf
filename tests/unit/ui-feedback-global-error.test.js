// グローバル例外 → toast の ResizeObserver 除外 (イシュー#349)。
// js/ui-feedback.js の window 'error' リスナが、Chromium/WebKit 共通の無害な
// ResizeObserver ループ通知 (新旧2文言) では toast を出さず、本物の ErrorEvent では
// 従来どおり toast(type:'error') を出すことを確認する (本物のエラーの取りこぼし防止)。
// 経緯: tests/e2e/publish-article-editor.spec.js:792 のテストが taskset -c 0 (1コア固定)
// で高頻度にフレークし、原因はこのResizeObserver通知の誤検知だった (unhandledrejection側は
// 無関係・0件発火)。unhandledrejection のE2E確認は既存の tests/e2e/global-error-toast.spec.js
// でカバーされているため、ここでは今回変更した error リスナーの分岐のみを対象にする。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

await import('../../js/ui-feedback.js');

function dispatchWindowError(message) {
    const ev = new ErrorEvent('error', { message });
    // jsdom (25.x) は window.dispatchEvent() 時に event.target を window に設定しない
    // (本物のブラウザでは正しく window になる・既存の tests/e2e/global-error-toast.spec.js で
    // 確認済み)。js/ui-feedback.js の `e.target !== window` ガードを単体テストで素通りさせるため、
    // ディスパッチ前に target を強制する (jsdom 側の制約への回避で、本体コードの動作には影響しない)。
    Object.defineProperty(ev, 'target', { value: window, configurable: true });
    window.dispatchEvent(ev);
}

describe('window error → toast: ResizeObserver除外', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('ResizeObserver のループ通知 (新文言) では toast-error を出さない', () => {
        vi.setSystemTime(0);
        dispatchWindowError('ResizeObserver loop completed with undelivered notifications.');
        expect(document.querySelectorAll('.toast-error').length).toBe(0);
    });

    it('ResizeObserver のループ通知 (旧文言) も除外される', () => {
        vi.setSystemTime(10_000); // 連打防止ウィンドウ(5s)をまたいで前テストと独立させる
        dispatchWindowError('ResizeObserver loop limit exceeded');
        expect(document.querySelectorAll('.toast-error').length).toBe(0);
    });

    it('通常の ErrorEvent では toast(type:error) が従来どおり出る (退行防止)', () => {
        vi.setSystemTime(20_000);
        dispatchWindowError('boom-349');
        const toasts = document.querySelectorAll('.toast-error');
        expect(toasts.length).toBe(1);
        expect(toasts[0].textContent).toContain('予期しないエラーが発生しました');
    });
});
