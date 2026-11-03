// SaveStatus (js/ui/save-status.js・イシュー#518 U5) の契約。
// 足すだけの段のテスト=まだどの画面からも呼ばれていないため、部品自体のAPIを直接検証する。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

await import('../../js/ui/save-status.js');
const { SaveStatus } = globalThis;

function setupDom() {
    document.body.innerHTML = `<span id="st" class="save-note-status"></span>`;
    return document.getElementById('st');
}

describe('SaveStatus', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('set: 要素の textContent を書き換える', () => {
        const el = setupDom();
        SaveStatus.set(el, '保存しました');
        expect(el.textContent).toBe('保存しました');
    });

    it('set: 要素が無ければ何もしない (既存の if (statusEl) ガードと同じ)', () => {
        expect(() => SaveStatus.set('not-exist', 'x')).not.toThrow();
        expect(() => SaveStatus.set(null, 'x')).not.toThrow();
    });

    it('set: id文字列指定でも要素を解決できる', () => {
        setupDom();
        SaveStatus.set('st', '保存中...');
        expect(document.getElementById('st').textContent).toBe('保存中...');
    });

    it('set: state を渡すと is-<state> クラスを1つだけ付け、前回の is-* クラスは外す', () => {
        const el = setupDom();
        el.classList.add('is-old');
        SaveStatus.set(el, '失敗', { state: 'error' });
        expect(el.classList.contains('is-old')).toBe(false);
        expect(el.classList.contains('is-error')).toBe(true);
    });

    it('set: state を渡さない時は既存の is-* クラスを変えない', () => {
        const el = setupDom();
        el.classList.add('is-stale');
        SaveStatus.set(el, '編集中…');
        expect(el.classList.contains('is-stale')).toBe(true);
    });

    it('set: state に空文字を渡すと is-* クラスは全部外れる (is-<state> は付かない)', () => {
        const el = setupDom();
        el.classList.add('is-stale');
        SaveStatus.set(el, '', { state: '' });
        expect(el.classList.contains('is-stale')).toBe(false);
        expect(Array.from(el.classList).some((c) => c.startsWith('is-'))).toBe(false);
    });

    it('autoClearMs: 指定時間後にテキストが変わっていなければ空にする (既存の1.5秒パターン)', () => {
        const el = setupDom();
        SaveStatus.set(el, '保存しました', { autoClearMs: 1500 });
        expect(el.textContent).toBe('保存しました');
        vi.advanceTimersByTime(1499);
        expect(el.textContent).toBe('保存しました');
        vi.advanceTimersByTime(1);
        expect(el.textContent).toBe('');
    });

    it('autoClearMs: その間に別のテキストへ変わっていたら消さない (既存の安全策)', () => {
        const el = setupDom();
        SaveStatus.set(el, '保存しました', { autoClearMs: 1500 });
        el.textContent = '保存中...'; // 別の呼び出しで上書きされた想定
        vi.advanceTimersByTime(1500);
        expect(el.textContent).toBe('保存中...');
    });

    it('clear: テキストと state クラスを両方消す', () => {
        const el = setupDom();
        SaveStatus.set(el, 'エラー', { state: 'error' });
        SaveStatus.clear(el);
        expect(el.textContent).toBe('');
        expect(el.classList.contains('is-error')).toBe(false);
    });
});
