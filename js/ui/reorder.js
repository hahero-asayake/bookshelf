// Reorder — 並べ替えの部品 (イシュー#517 U4・ドラッグの並べ替えを独立したモジュールにする)
//
// js/bookshelf.js の _bindPointerReorder (旧2711-2897行、イシュー#337) をそのまま移した。
// このcommitは移すだけ = 振る舞いは変えない。bookshelf.js 側は Reorder.bindPointerReorder へ
// 委譲する1行の _bindPointerReorder を残すため、6か所の呼び出し元 (_bindDetailSectionReorder・
// _renderSidebarTree・_bindSidebarUtilityDnD・_bindPluginListEvents・setupBookshelfDragAndDrop・
// js/dashboard.js の this.app._bindPointerReorder) は変更不要。
//
// 独自のドラッグ4つ (本カードの _onBookPointerDown 系・記事エディタの3つ) はここでは移さない。
// docs/char/u4-reorder-inventory.md に一覧を残した (U7・U8で各画面と一緒に移す)。
//
// 使い方: Reorder.bindPointerReorder(container, opts) — opts の形は旧 _bindPointerReorder と同じ。
// opts: {
//   itemSelector,        // ドラッグ可能アイテムの選択子
//   handleSelector,      // 専用ハンドルの選択子 (無ければ null = アイテム全体がトリガー)
//   excludeSelector,     // ここに closest match したら開始しない (操作系要素除け)
//   canDrag(itemEl),     // 開始可否の追加判定 (特殊本棚など)
//   dragClass,           // ドラッグ中に付けるクラス
//   zoneMode,            // 'segment' (before/after/inside 3ゾーン) | 'index' (挿入インジケータ)
//   zoneClassPrefix,     // segmentモードで使うクラス接頭辞 (例: 'tree-drop-')
//   computeZone(targetEl, clientY),  // segmentモードのゾーン判定
//   indicatorClass,      // indexモードの挿入インジケータのクラス名
//   computeInsertIndex(container, clientX, clientY), // indexモードの挿入位置計算
//   getKey(itemEl),      // アイテムの識別子
//   onDrop(dragKey, targetKeyOrIndex, zone),  // ドロップ確定時 (既存の保存/並べ替え関数をそのまま呼ぶ)
//   scrollContainer,     // 自動スクロール対象 (要素 or 要素を返す関数, 省略可)
// }
(function () {
    'use strict';

    function bindPointerReorder(container, opts) {
        if (!container || container._pointerReorderBound) return;
        container._pointerReorderBound = true;
        const MOVE_THRESHOLD = 6;
        const LONG_PRESS_MS = 450;
        let drag = null;
        let pending = null;
        let scrollRAF = null;

        const clearPending = () => {
            if (!pending) return;
            pending.el.removeEventListener('pointermove', pending.onMove);
            pending.el.removeEventListener('pointerup', pending.onUp);
            pending.el.removeEventListener('pointercancel', pending.onUp);
            if (pending.timer) clearTimeout(pending.timer);
            pending = null;
        };

        const clearZoneMarks = () => {
            container.querySelectorAll(opts.itemSelector).forEach(el => {
                if (opts.zoneClassPrefix) {
                    el.classList.remove(`${opts.zoneClassPrefix}before`, `${opts.zoneClassPrefix}after`, `${opts.zoneClassPrefix}inside`);
                }
                delete el.dataset.dropZone;
            });
            if (opts.indicatorClass) {
                container.querySelectorAll(`.${opts.indicatorClass}`).forEach(el => el.remove());
                document.querySelectorAll(`.${opts.indicatorClass}`).forEach(el => el.remove());
            }
        };

        const stopAutoScroll = () => { if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; } };
        const startAutoScroll = () => {
            if (scrollRAF || !opts.scrollContainer) return;
            const EDGE = 60, MAX = 18;
            const step = () => {
                if (!drag) { scrollRAF = null; return; }
                const scroller = typeof opts.scrollContainer === 'function' ? opts.scrollContainer() : opts.scrollContainer;
                if (scroller) {
                    const r = scroller.getBoundingClientRect();
                    const y = drag.pointerY || 0;
                    let dy = 0;
                    if (y < r.top + EDGE) dy = -Math.ceil(MAX * Math.min(1, (r.top + EDGE - y) / EDGE));
                    else if (y > r.bottom - EDGE) dy = Math.ceil(MAX * Math.min(1, (y - (r.bottom - EDGE)) / EDGE));
                    if (dy) scroller.scrollTop += dy;
                }
                scrollRAF = requestAnimationFrame(step);
            };
            scrollRAF = requestAnimationFrame(step);
        };

        const onMove = (e) => {
            if (!drag) return;
            e.preventDefault();
            drag.ghost.style.left = (e.clientX - drag.offsetX) + 'px';
            drag.ghost.style.top = (e.clientY - drag.offsetY) + 'px';
            drag.pointerY = e.clientY;

            drag.ghost.style.display = 'none';
            void drag.ghost.offsetHeight; // force reflow (display切替を同期反映させる)
            const el = document.elementFromPoint(e.clientX, e.clientY);
            drag.ghost.style.display = '';
            const targetEl = el && el.closest(opts.itemSelector);

            clearZoneMarks();
            drag.lastTarget = null; drag.lastZone = null; drag.lastIndex = null;
            if (!targetEl || targetEl === drag.itemEl || !container.contains(targetEl)) return;

            if (opts.zoneMode === 'segment') {
                const zone = opts.computeZone(targetEl, e.clientY);
                targetEl.classList.add(`${opts.zoneClassPrefix}${zone}`);
                targetEl.dataset.dropZone = zone;
                drag.lastTarget = targetEl; drag.lastZone = zone;
            } else {
                const idx = opts.computeInsertIndex(container, e.clientX, e.clientY);
                const items = Array.from(container.querySelectorAll(opts.itemSelector)).filter(el => el !== drag.itemEl);
                const indicator = document.createElement('div');
                indicator.className = opts.indicatorClass;
                if (idx >= items.length) {
                    (items[items.length - 1] || container).after ? items[items.length - 1]?.after(indicator) : container.appendChild(indicator);
                    if (!items.length) container.appendChild(indicator);
                } else {
                    items[idx].before(indicator);
                }
                drag.lastTarget = targetEl; drag.lastIndex = idx;
            }
        };

        const finishDrag = () => {
            if (!drag) return;
            drag.itemEl.classList.remove(opts.dragClass);
            drag.itemEl.style.touchAction = '';
            drag.ghost.remove();
            document.body.style.userSelect = drag.prevUserSelect || '';
            document.removeEventListener('selectstart', preventSelectDuringDrag);
            (drag.suppressedFormEls || []).forEach(el => { el.style.pointerEvents = el.dataset._prevPointerEvents || ''; delete el.dataset._prevPointerEvents; });
            clearZoneMarks();
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onCancel);
            stopAutoScroll();
            drag = null;
        };

        const onUp = () => {
            if (!drag) return;
            const { dragKey, lastTarget, lastZone, lastIndex } = drag;
            if (opts.zoneMode === 'segment') {
                if (lastTarget && lastZone) opts.onDrop(dragKey, opts.getKey(lastTarget), lastZone);
            } else if (typeof lastIndex === 'number') {
                opts.onDrop(dragKey, lastIndex);
            }
            finishDrag();
        };
        const onCancel = () => finishDrag();
        const preventSelectDuringDrag = (ev) => ev.preventDefault();

        const beginDrag = (e, itemEl) => {
            e.preventDefault();
            try { itemEl.setPointerCapture(e.pointerId); } catch (_) {}
            itemEl.classList.add(opts.dragClass);
            itemEl.style.touchAction = 'none';
            // ドラッグ経路が textarea 等を跨ぐと、マウスの既定動作(テキスト選択)が走り、
            // 選択処理中は document.elementFromPoint が一時的に null を返す実ブラウザの挙動を
            // 実測した(イシュー#337 bd-section)。textarea は CSS user-select が効かないフォーム
            // コントロールのため、selectstart 自体を止めて踏み抜きを防ぐ。
            const prevUserSelect = document.body.style.userSelect;
            document.body.style.userSelect = 'none';
            document.addEventListener('selectstart', preventSelectDuringDrag);
            // textarea/input 等のフォームコントロールは user-select:none でも選択/フォーカス処理が残り、
            // ドラッグ経路上で elementFromPoint が一時的に null を返す実測挙動があった。ドラッグ中だけ
            // コンテナ内のフォームコントロールへのポインタ到達を止め、背後の並べ替え対象を拾わせる。
            const suppressedFormEls = Array.from(container.querySelectorAll('textarea, input, select'));
            suppressedFormEls.forEach(el => { el.dataset._prevPointerEvents = el.style.pointerEvents; el.style.pointerEvents = 'none'; });
            const rect = itemEl.getBoundingClientRect();
            const ghost = itemEl.cloneNode(true);
            ghost.className = itemEl.className + ' drag-ghost';
            ghost.style.cssText = [
                'position:fixed', `width:${rect.width}px`, `height:${rect.height}px`,
                `left:${rect.left}px`, `top:${rect.top}px`, 'pointer-events:none',
                'z-index:9999', 'opacity:0.78', 'box-shadow:0 6px 24px rgba(0,0,0,.35)', 'transition:none',
            ].join(';');
            document.body.appendChild(ghost);
            drag = {
                pointerId: e.pointerId, itemEl, ghost, prevUserSelect, suppressedFormEls,
                offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, pointerY: e.clientY,
                dragKey: opts.getKey(itemEl), lastTarget: null, lastZone: null, lastIndex: null,
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onCancel);
            startAutoScroll();
        };

        container.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (opts.excludeSelector && e.target.closest(opts.excludeSelector)) return;
            const handleEl = opts.handleSelector ? e.target.closest(opts.handleSelector) : null;
            if (opts.handleSelector && !handleEl) return;
            const itemEl = e.target.closest(opts.itemSelector);
            if (!itemEl || !container.contains(itemEl)) return;
            if (opts.canDrag && !opts.canDrag(itemEl)) return;

            if (opts.handleSelector) { beginDrag(e, itemEl); return; }

            // ハンドルが無い: マウス=移動しきい値／touch・pen=長押しで開始を遅らせる
            const startX = e.clientX, startY = e.clientY;
            const onPreMove = (ev) => {
                const dx = ev.clientX - startX, dy = ev.clientY - startY;
                if (Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD) {
                    if (ev.pointerType === 'mouse') { clearPending(); beginDrag(ev, itemEl); }
                    else clearPending(); // touch/pen は移動したら長押しキャンセル (スクロール優先)
                }
            };
            const onPreUp = () => clearPending();
            itemEl.addEventListener('pointermove', onPreMove);
            itemEl.addEventListener('pointerup', onPreUp);
            itemEl.addEventListener('pointercancel', onPreUp);
            pending = { el: itemEl, onMove: onPreMove, onUp: onPreUp, timer: null };
            if (e.pointerType !== 'mouse') {
                pending.timer = setTimeout(() => {
                    const p = pending; clearPending();
                    if (p) beginDrag(e, itemEl);
                }, LONG_PRESS_MS);
            }
        });
    }

    window.Reorder = { bindPointerReorder };
})();
