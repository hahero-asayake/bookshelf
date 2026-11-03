// Reorder (js/ui/reorder.js・イシュー#517 U4) の契約。
// _bindPointerReorder を移しただけの本体(ドラッグ経路そのもの)は tests/e2e/touch-reorder.spec.js
// (6か所)・tests/e2e/char/widgets.spec.js(W1〜W3)が実ブラウザで打鍵して固定する。ここでは U4 で
// 足した2つの口(holeSelector/onDropHole・取り消し)だけを、pointer/keydown/blur/visibilitychange
// イベントを実際に dispatch する経路(内部メソッドの直呼びはしない)で確かめる。
// jsdom は PointerEvent 未実装のため、clientX/clientY/pointerId/pointerType/button を持つ
// 素の Event を使う(firePointer)。document.elementFromPoint も jsdom 未実装のためテストごとに
// 差し替える。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

await import('../../js/ui/reorder.js');
const { Reorder } = globalThis;

function firePointer(target, type, overrides = {}) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, { clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse', button: 0, ...overrides });
    target.dispatchEvent(ev);
    return ev;
}

function setupDom() {
    document.body.innerHTML = `
        <div id="list">
            <div class="item" data-id="a"><span class="handle">h</span></div>
            <div class="item" data-id="b"><span class="handle">h</span></div>
            <div class="hole" data-id="hole1"></div>
        </div>
    `;
    return document.getElementById('list');
}

function baseOpts(overrides = {}) {
    return {
        itemSelector: '.item',
        handleSelector: '.handle',
        dragClass: 'is-dragging',
        zoneMode: 'index',
        indicatorClass: 'drop-indicator',
        computeInsertIndex: () => 0,
        getKey: (el) => el.dataset.id,
        onDrop: vi.fn(),
        ...overrides,
    };
}

describe('Reorder.bindPointerReorder', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        // jsdom は elementFromPoint 未実装。既定は「指の下に何も無い」を模す
        document.elementFromPoint = () => null;
    });

    describe('穴を落とす先にする口 (holeSelector/onDropHole)', () => {
        it('指定時: 指の下にカードが無く穴要素がある場合にonDropHoleを呼ぶ(onDropは呼ばない)', () => {
            const container = setupDom();
            const handleA = container.querySelector('[data-id="a"] .handle');
            const holeEl = container.querySelector('.hole');
            const onDrop = vi.fn();
            const onDropHole = vi.fn();
            Reorder.bindPointerReorder(container, baseOpts({ onDrop, holeSelector: '.hole', onDropHole }));
            document.elementFromPoint = () => holeEl;

            firePointer(handleA, 'pointerdown');
            firePointer(document, 'pointermove', { clientX: 10, clientY: 10 });
            firePointer(document, 'pointerup');

            expect(onDropHole).toHaveBeenCalledTimes(1);
            expect(onDropHole).toHaveBeenCalledWith('a', holeEl);
            expect(onDrop).not.toHaveBeenCalled();
        });

        it('未指定: 穴相当の要素の上でも従来どおり何も起きない(今の早期returnを保つ)', () => {
            const container = setupDom();
            const handleA = container.querySelector('[data-id="a"] .handle');
            const holeEl = container.querySelector('.hole');
            const onDrop = vi.fn();
            Reorder.bindPointerReorder(container, baseOpts({ onDrop })); // holeSelector未指定
            document.elementFromPoint = () => holeEl;

            firePointer(handleA, 'pointerdown');
            firePointer(document, 'pointermove', { clientX: 10, clientY: 10 });
            firePointer(document, 'pointerup');

            expect(onDrop).not.toHaveBeenCalled();
            // ドラッグ状態は正常に終わっている(穴の口が無くても後片付けは今まで通り動く)
            const itemA = container.querySelector('[data-id="a"]');
            expect(itemA.classList.contains('is-dragging')).toBe(false);
            expect(document.querySelector('.drag-ghost')).toBeFalsy();
        });

        it('穴要素がcontainerの外にある場合は落とす先として扱わない', () => {
            const container = setupDom();
            const handleA = container.querySelector('[data-id="a"] .handle');
            const outsideHole = document.createElement('div');
            outsideHole.className = 'hole';
            document.body.appendChild(outsideHole); // container外
            const onDrop = vi.fn();
            const onDropHole = vi.fn();
            Reorder.bindPointerReorder(container, baseOpts({ onDrop, holeSelector: '.hole', onDropHole }));
            document.elementFromPoint = () => outsideHole;

            firePointer(handleA, 'pointerdown');
            firePointer(document, 'pointermove', { clientX: 10, clientY: 10 });
            firePointer(document, 'pointerup');

            expect(onDropHole).not.toHaveBeenCalled();
            expect(onDrop).not.toHaveBeenCalled();
        });
    });

    describe('取り消し (Esc・blur・visibilitychange)', () => {
        it('ドラッグ中のEscで取り消す: 影が消え、onDropもonDropHoleも呼ばれない', () => {
            const container = setupDom();
            const handleA = container.querySelector('[data-id="a"] .handle');
            const onDrop = vi.fn();
            const onDropHole = vi.fn();
            Reorder.bindPointerReorder(container, baseOpts({ onDrop, holeSelector: '.hole', onDropHole }));

            firePointer(handleA, 'pointerdown');
            expect(document.querySelector('.drag-ghost')).toBeTruthy(); // 影がある(#499 W7の対象)

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

            expect(document.querySelector('.drag-ghost')).toBeFalsy(); // 影が消える
            expect(onDrop).not.toHaveBeenCalled();
            expect(onDropHole).not.toHaveBeenCalled();
            const itemA = container.querySelector('[data-id="a"]');
            expect(itemA.classList.contains('is-dragging')).toBe(false);
        });

        it('ドラッグ中のwindow blurで取り消す', () => {
            const container = setupDom();
            const handleA = container.querySelector('[data-id="a"] .handle');
            const onDrop = vi.fn();
            Reorder.bindPointerReorder(container, baseOpts({ onDrop }));

            firePointer(handleA, 'pointerdown');
            expect(document.querySelector('.drag-ghost')).toBeTruthy();

            window.dispatchEvent(new Event('blur'));

            expect(document.querySelector('.drag-ghost')).toBeFalsy();
            expect(onDrop).not.toHaveBeenCalled();
        });

        it('ドラッグ中のdocument visibilitychange(hidden)で取り消す', () => {
            const container = setupDom();
            const handleA = container.querySelector('[data-id="a"] .handle');
            const onDrop = vi.fn();
            Reorder.bindPointerReorder(container, baseOpts({ onDrop }));

            firePointer(handleA, 'pointerdown');
            expect(document.querySelector('.drag-ghost')).toBeTruthy();

            Object.defineProperty(document, 'hidden', { value: true, configurable: true });
            try {
                document.dispatchEvent(new Event('visibilitychange'));
                expect(document.querySelector('.drag-ghost')).toBeFalsy();
                expect(onDrop).not.toHaveBeenCalled();
            } finally {
                Object.defineProperty(document, 'hidden', { value: false, configurable: true });
            }
        });

        it('visibilitychangeが起きてもhiddenでなければ取り消さない(フォアグラウンドのタブ切替等)', () => {
            const container = setupDom();
            const handleA = container.querySelector('[data-id="a"] .handle');
            const onDrop = vi.fn();
            Reorder.bindPointerReorder(container, baseOpts({ onDrop }));

            firePointer(handleA, 'pointerdown');
            document.dispatchEvent(new Event('visibilitychange')); // document.hidden は既定false

            expect(document.querySelector('.drag-ghost')).toBeTruthy(); // 取り消されていない
        });

        it('ドラッグしていない時はEsc/blur/visibilitychangeとも何も起きない', () => {
            const container = setupDom();
            Reorder.bindPointerReorder(container, baseOpts());

            expect(() => {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                window.dispatchEvent(new Event('blur'));
                Object.defineProperty(document, 'hidden', { value: true, configurable: true });
                document.dispatchEvent(new Event('visibilitychange'));
            }).not.toThrow();
            Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        });
    });

    describe('Escのcapture・stopPropagation (②指示: Surfaceの重なり画面を閉じるEscまで届かせない)', () => {
        function setupModalDom() {
            document.body.innerHTML = `
                <div id="modal">
                    <div id="list">
                        <div class="item" data-id="a"><span class="handle">h</span></div>
                    </div>
                </div>
            `;
            return {
                modal: document.getElementById('modal'),
                container: document.getElementById('list'),
            };
        }

        it('ドラッグ中でなければEscはそのまま重なった画面(Surface相当)まで届く', () => {
            const { modal, container } = setupModalDom();
            const handleA = container.querySelector('[data-id="a"] .handle');
            const surfaceEsc = vi.fn();
            modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') surfaceEsc(); }); // bubble, Surface.onEsc相当
            Reorder.bindPointerReorder(container, baseOpts());

            handleA.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

            expect(surfaceEsc).toHaveBeenCalledTimes(1);
        });

        it('ドラッグ中はEscがstopPropagationされ、重なった画面(Surface相当)まで届かない', () => {
            const { modal, container } = setupModalDom();
            const handleA = container.querySelector('[data-id="a"] .handle');
            const onDrop = vi.fn();
            const surfaceEsc = vi.fn();
            modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') surfaceEsc(); });
            Reorder.bindPointerReorder(container, baseOpts({ onDrop }));

            firePointer(handleA, 'pointerdown');
            handleA.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

            expect(surfaceEsc).not.toHaveBeenCalled(); // 画面を閉じるEscまで届かない = 画面は開いたまま
            expect(onDrop).not.toHaveBeenCalled(); // ドラッグだけ取り消される
            expect(document.querySelector('.drag-ghost')).toBeFalsy();
        });
    });
});
