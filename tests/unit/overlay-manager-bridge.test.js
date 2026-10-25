// 移行期の橋渡し (OverlayManager.installLegacyBridge / _syncLegacy・イシュー#367 step3)。
// まだ管理役経由に書き換えていない .modal が .show を付け外しした時に、スタックに載せ外しされること
// (= 開いた順が重なり順)。管理役経由で開いた面は二重に載らない。橋渡しで載った面 (legacy) は大きさの段階を付けない。
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../js/overlay-manager.js');
const { OverlayManager } = globalThis;

const tick = () => new Promise((r) => setTimeout(r, 0)); // MutationObserver はマイクロタスクで届く

function modal(id) {
    const d = document.createElement('div');
    d.id = id;
    d.className = 'modal';
    d.innerHTML = '<div class="modal-content"></div>';
    document.body.appendChild(d);
    return d;
}

describe('OverlayManager 移行期の橋渡し', () => {
    let ov;
    beforeEach(() => {
        document.body.innerHTML = '';
        ov = new OverlayManager();
        ov.installLegacyBridge(document.body);
    });

    it('未移行の .modal が .show を付けるとスタックに載り (legacy)、外すと外れる', async () => {
        const a = modal('legacy-a');
        a.classList.add('show');
        await tick();
        expect(ov.has('legacy-a')).toBe(true);
        expect(ov.get('legacy-a').legacy).toBe(true);
        expect(a.dataset.layer).toBe('0');
        expect(a.querySelector('.modal-content').classList.contains('ov-md')).toBe(false); // 段階は付けない
        a.classList.remove('show');
        await tick();
        expect(ov.has('legacy-a')).toBe(false);
        expect(a.dataset.layer).toBeUndefined();
    });

    it('未移行の面の直後に管理役経由で開いた面は上 (open の冒頭で同期的に載せる _syncLegacy)', async () => {
        const form = modal('legacy-form');
        const picker = modal('picker');
        form.classList.add('show');          // 橋渡しの通知はまだ届いていない
        ov.open(picker, { size: 'md' });     // 同期で開く
        expect(form.dataset.layer).toBe('0');
        expect(picker.dataset.layer).toBe('1');
        expect(ov.top().id).toBe('picker');
        await tick();                        // 遅れて届いた通知で二重に載らない
        expect(ov.stack.length).toBe(2);
        expect(ov.stackInfo().map((f) => f.id)).toEqual(['legacy-form', 'picker']);
    });

    it('管理役経由で開いた面の .show 付け外しは橋渡しが二重に載せ外ししない', async () => {
        const a = modal('managed');
        const h = ov.open(a);
        await tick();
        expect(ov.stack.length).toBe(1);
        expect(ov.get('managed').legacy).toBe(false);
        h.close('button');
        await tick();
        expect(ov.has('managed')).toBe(false);
    });

    it('管理役経由の面の上に未移行の面が後から開けば、未移行の面が上 (開いた順)', async () => {
        const settings = modal('settings');
        const add = modal('legacy-add');
        ov.open(settings, { size: 'lg' });
        add.classList.add('show');
        await tick();
        expect(settings.dataset.layer).toBe('0');
        expect(add.dataset.layer).toBe('1');
        expect(ov.top().id).toBe('legacy-add');
    });

    it('id の無い .modal や .modal でない要素は載せない', async () => {
        const noId = document.createElement('div'); noId.className = 'modal'; document.body.appendChild(noId);
        const other = document.createElement('div'); other.id = 'x'; other.className = 'popover'; document.body.appendChild(other);
        noId.classList.add('show'); other.classList.add('show');
        await tick();
        expect(ov.stack.length).toBe(0);
    });
});
