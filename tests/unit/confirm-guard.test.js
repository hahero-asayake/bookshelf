// ConfirmGuard (js/ui/confirm-guard.js・イシュー#518 U5) の契約。
// confirmDialog は本物を使わず window.confirmDialog をモックして呼ばれ方だけを検証する
// (本物のDOM確認モーダルは js/ui-feedback.js 側・e2e char で確認する)。
import { describe, it, expect, vi, beforeEach } from 'vitest';

await import('../../js/ui/confirm-guard.js');
const { ConfirmGuard } = globalThis;

function setupForm() {
    document.body.innerHTML = `
        <div id="form1">
            <input id="title" type="text" value="初期値" />
            <textarea id="body">初期本文</textarea>
        </div>
    `;
}

describe('ConfirmGuard.snapshotOf', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('input/textarea の値を直列化する (hidden/file は除く)', () => {
        document.body.innerHTML = `
            <div id="f">
                <input type="text" value="a" />
                <input type="hidden" value="skip" />
                <input type="file" />
                <textarea>b</textarea>
            </div>`;
        expect(ConfirmGuard.snapshotOf('f')).toBe(JSON.stringify(['a', 'b']));
    });

    it('要素が無ければ空文字', () => {
        expect(ConfirmGuard.snapshotOf('not-exist')).toBe('');
    });
});

describe('ConfirmGuard.create().guard (Surface close フックから使う契約)', () => {
    beforeEach(() => {
        setupForm();
        window.confirmDialog = vi.fn();
    });

    it('take していない id は変更無しとみなし、確認を出さず doClose を呼ぶ', async () => {
        const guard = ConfirmGuard.create();
        const doClose = vi.fn();
        const result = await guard.guard('form1', { fromHistory: true }, doClose, {});
        expect(window.confirmDialog).not.toHaveBeenCalled();
        expect(doClose).toHaveBeenCalledWith({ fromHistory: true });
        expect(result).toBe(true);
    });

    it('fromHistory が無い (通常の戻る以外) 場合は値が変わっていても確認を出さない', async () => {
        const guard = ConfirmGuard.create();
        guard.take('form1');
        document.getElementById('title').value = '変更後';
        const doClose = vi.fn();
        await guard.guard('form1', { fromHistory: false }, doClose, {});
        expect(window.confirmDialog).not.toHaveBeenCalled();
        expect(doClose).toHaveBeenCalled();
    });

    it('fromHistory かつ値が変わっていれば confirmDialog を出す。OK なら doClose を呼ぶ', async () => {
        window.confirmDialog.mockResolvedValue(true);
        const guard = ConfirmGuard.create();
        guard.take('form1');
        document.getElementById('title').value = '変更後';
        const doClose = vi.fn();
        const opts = { title: 't', message: 'm' };
        const result = await guard.guard('form1', { fromHistory: true }, doClose, opts);
        expect(window.confirmDialog).toHaveBeenCalledWith(opts);
        expect(doClose).toHaveBeenCalled();
        expect(result).toBe(true);
    });

    it('fromHistory かつ値が変わっている時、キャンセルなら doClose を呼ばず false を返す', async () => {
        window.confirmDialog.mockResolvedValue(false);
        const guard = ConfirmGuard.create();
        guard.take('form1');
        document.getElementById('title').value = '変更後';
        const doClose = vi.fn();
        const result = await guard.guard('form1', { fromHistory: true }, doClose, {});
        expect(doClose).not.toHaveBeenCalled();
        expect(result).toBe(false);
        // キャンセル後もスナップショットは残る (再度「戻る」を試せる)
        expect(guard.hasChanged('form1')).toBe(true);
    });

    it('guard 完了後 (doClose を呼んだ後) はスナップショットを消す', async () => {
        const guard = ConfirmGuard.create();
        guard.take('form1');
        await guard.guard('form1', { fromHistory: true }, vi.fn(), {});
        expect(guard.hasChanged('form1')).toBe(false);
    });

    it('複数 id を独立して管理できる', () => {
        document.body.innerHTML += '<div id="form2"><input type="text" value="x" /></div>';
        const guard = ConfirmGuard.create();
        guard.take('form1');
        guard.take('form2');
        document.getElementById('title').value = '変更';
        expect(guard.hasChanged('form1')).toBe(true);
        expect(guard.hasChanged('form2')).toBe(false);
    });
});
