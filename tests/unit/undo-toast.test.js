// UndoToast (js/ui/undo-toast.js・イシュー#518 U5) の契約。
// window.toast は本物を使わず呼ばれ方だけを検証する (見た目自体は既存の toast・e2e char で確認)。
import { describe, it, expect, vi, beforeEach } from 'vitest';

await import('../../js/ui/undo-toast.js');
const { UndoToast } = globalThis;

describe('UndoToast.show', () => {
    beforeEach(() => {
        window.toast = vi.fn().mockReturnValue({ id: 'fake-item' });
    });

    it('onUndo が無いと例外', () => {
        expect(() => UndoToast.show('外しました')).toThrow(/onUndo/);
    });

    it('window.toast を action 付きで呼ぶ (既定ラベル・既定duration)', () => {
        const onUndo = vi.fn();
        UndoToast.show('ウィジェットを外しました。', { onUndo });
        expect(window.toast).toHaveBeenCalledWith('ウィジェットを外しました。', {
            type: 'info',
            duration: 6000,
            action: { label: '元に戻す', onClick: onUndo },
        });
    });

    it('undoLabel・duration・type を上書きできる', () => {
        const onUndo = vi.fn();
        UndoToast.show('削除しました。', { undoLabel: '取り消す', duration: 8000, type: 'warn', onUndo });
        expect(window.toast).toHaveBeenCalledWith('削除しました。', {
            type: 'warn',
            duration: 8000,
            action: { label: '取り消す', onClick: onUndo },
        });
    });

    it('toast の戻り値をそのまま返す', () => {
        const result = UndoToast.show('x', { onUndo: vi.fn() });
        expect(result).toEqual({ id: 'fake-item' });
    });

    it('action.onClick は渡した onUndo そのもの (押すと呼ばれる契約は toast 側が保証)', () => {
        const onUndo = vi.fn();
        UndoToast.show('x', { onUndo });
        const callArgs = window.toast.mock.calls[0][1];
        callArgs.action.onClick();
        expect(onUndo).toHaveBeenCalledTimes(1);
    });
});
