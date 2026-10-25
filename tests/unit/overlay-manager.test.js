// 重なり管理役 (js/overlay-manager.js・イシュー#367) の契約。
// スタック順 = data-layer・新しく開いた面が最前面・一時的な面 (popover/menu) は別の面を開く前に閉じる・
// dialog は履歴に積まない・requestClose は onRequestClose の拒否で止まる・hooks は hist の面だけに届く。
// 画面の経路 (ESC/枠外/実際の z-index) は tests/e2e/standard-ops.spec.js・overlay-front.spec.js が打鍵する。
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../js/overlay-manager.js');
const { OverlayManager } = globalThis;

function el(id, inner = '') {
    const d = document.createElement('div');
    d.id = id;
    d.className = 'modal';
    d.innerHTML = inner;
    document.body.appendChild(d);
    return d;
}

describe('OverlayManager', () => {
    let ov;
    beforeEach(() => {
        document.body.innerHTML = '';
        ov = new OverlayManager();
    });

    it('開いた順に data-layer を振り、新しく開いた面が top() になる', () => {
        const a = el('a', '<div class="modal-content"></div>');
        const b = el('b', '<div class="modal-content"></div>');
        ov.open(a, { size: 'lg' });
        ov.open(b, { size: 'sm' });
        expect(a.dataset.layer).toBe('0');
        expect(b.dataset.layer).toBe('1');
        expect(a.style.getPropertyValue('--layer')).toBe('0');
        expect(b.style.getPropertyValue('--layer')).toBe('1');
        expect(ov.top().id).toBe('b');
        expect(ov.isTop('a')).toBe(false);
        expect(a.classList.contains('show')).toBe(true);
        expect(a.querySelector('.modal-content').classList.contains('ov-lg')).toBe(true);
        expect(b.querySelector('.modal-content').classList.contains('ov-sm')).toBe(true);
        expect(b.dataset.ovKind).toBe('modal');
    });

    it('閉じると .show と data-layer が外れ、上に残った面の data-layer が詰まる', () => {
        const a = el('a'); const b = el('b'); const c = el('c');
        ov.open(a); ov.open(b); ov.open(c);
        expect(ov.close('b', { reason: 'esc' })).toBe(true);
        expect(b.classList.contains('show')).toBe(false);
        expect(b.dataset.layer).toBeUndefined();
        expect(a.dataset.layer).toBe('0');
        expect(c.dataset.layer).toBe('1');
        expect(ov.close('b')).toBe(false); // 二重 close は false
        expect(ov.stackInfo().map((f) => f.id)).toEqual(['a', 'c']);
    });

    it('同じ id の二重オープンは積み増さず既存のハンドルを返す', () => {
        const a = el('a');
        const h1 = ov.open(a);
        const h2 = ov.open(a);
        expect(h1).toBe(h2);
        expect(ov.stack.length).toBe(1);
    });

    it('popover/menu は別の面を開く前に自動で閉じる (closeOthers)。modal は積む (stack)', () => {
        const pop = el('pop'); const menu = el('menu'); const m1 = el('m1'); const m2 = el('m2');
        ov.open(m1);
        ov.open(pop, { kind: 'popover' });
        ov.open(menu, { kind: 'menu' });   // menu を開くと pop は閉じる
        expect(ov.has('pop')).toBe(false);
        expect(ov.has('menu')).toBe(true);
        ov.open(m2);                       // modal は既定 stack = menu は残る
        expect(ov.has('menu')).toBe(true);
        ov.open(el('m3'), { onOpen: 'closeOthers' }); // 明示 closeOthers は一時的な面 (menu) だけ閉じ、modal は残す
        expect(ov.has('menu')).toBe(false);
        expect(ov.has('m1')).toBe(true);
        expect(ov.has('m2')).toBe(true);
    });

    it('dialog は data-ov-kind=dialog・履歴に積まない・showClass:null なら .show を付けない', () => {
        const overlay = document.createElement('div'); overlay.className = 'cfm-overlay';
        const box = document.createElement('div'); box.className = 'cfm-box'; overlay.appendChild(box);
        document.body.appendChild(overlay);
        const opened = []; const closed = [];
        ov.hooks.onOpen = (id) => opened.push(id);
        ov.hooks.onClose = (id) => closed.push(id);
        const h = ov.open(overlay, { kind: 'dialog', size: 'sm', showClass: null, sizeTarget: box });
        expect(overlay.dataset.ovKind).toBe('dialog');
        expect(overlay.classList.contains('show')).toBe(false);
        expect(box.classList.contains('ov-sm')).toBe(true);
        expect(ov.get(h.id).hist).toBe(false);
        h.close('cancel');
        expect(opened).toEqual([]);
        expect(closed).toEqual([]);
    });

    it('hist の面は hooks.onOpen/onClose に届き、closeFn は reason=history で閉じる', () => {
        const a = el('a');
        const log = [];
        ov.hooks.onOpen = (id, { closeFn }) => { log.push(['open', id]); ov._closeFn = closeFn; };
        ov.hooks.onClose = (id, { reason, fromHistory }) => log.push(['close', id, reason, fromHistory]);
        ov.open(a);
        expect(log).toEqual([['open', 'a']]);
        ov._closeFn({ fromHistory: true });
        expect(log[1]).toEqual(['close', 'a', 'history', true]);
        expect(ov.has('a')).toBe(false);
    });

    it('requestClose は onRequestClose が false を返すと閉じない。true/undefined なら閉じて onClose(reason) を呼ぶ', async () => {
        const a = el('a'); const b = el('b');
        let dirty = true; const reasons = [];
        ov.open(a, { onRequestClose: () => !dirty, onClose: (r) => reasons.push(r) });
        ov.open(b, { onRequestClose: async () => true, onClose: (r) => reasons.push(r) });
        expect(await ov.requestClose('a', 'esc')).toBe(false);
        expect(ov.has('a')).toBe(true);
        dirty = false;
        expect(await ov.requestClose('a', 'esc')).toBe(true);
        expect(await ov.requestClose('b', 'history')).toBe(true);
        expect(reasons).toEqual(['esc', 'history']);
        expect(await ov.requestClose('zzz')).toBe(false);
    });

    it('closeAll は上から順に閉じ、kinds を渡すとその種類だけ閉じる', () => {
        const a = el('a'); const p = el('p'); const m = el('m');
        ov.open(a); ov.open(p, { kind: 'popover' }); ov.open(m, { kind: 'menu', onOpen: 'stack' });
        expect(ov.closeAll({ kinds: ['popover', 'menu'] })).toBe(2);
        expect(ov.stackInfo().map((f) => f.id)).toEqual(['a']);
        expect(ov.closeAll()).toBe(1);
        expect(ov.top()).toBeNull();
    });

    it('存在しない要素は null、不正な size/kind は既定値に落ちる', () => {
        expect(ov.open('nope')).toBeNull();
        const a = el('a');
        a.dataset.ovSize = 'lg';
        ov.open(a, { size: 'huge', kind: 'weird' });
        expect(a.dataset.ovSize).toBe('lg');   // root の data-ov-size を既定に使う
        expect(a.dataset.ovKind).toBe('modal');
    });
});
