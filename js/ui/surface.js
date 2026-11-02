// Surface — 出口と重なりの部品 (イシュー#509 U3・設計 docs/arch/surface.md)
//
// 面1枚の「開く・閉じる・Esc・枠外・戻る (履歴の段)・開き直し」を1回の登録 (define) で束ね、
// 重なり管理役 (window.overlays・ADR-131) と画面遷移の台帳 (NavState・ADR-129) を正しい順で呼ぶ。
// U3 は構造の単位 = 振る舞いは変えない。段を積むかどうか (PC は積まない) は hist で面ごとに持つ:
//   hist: 'mobile'      … 今の既定。host._isHistMobile() が真の時だけ段を積む (旧 _modalHistPush と同じ)
//   hist: 'never'       … 段を積まない (plugins-modal: 今どの幅でも段なし)
//   hist: { isMobile }  … 面ごとの判定関数 (art-sheet の _artIsDrawerNarrow)
// 出口の決まり (イシュー#511 X1・docs/char/x1-exits.md §1)。画面ごとに別々の実装を書かず、define の2項目に寄せる:
//   exit: 'page' | 'overlay' | 'edit'  … 既定 'overlay'。'page' は←で親(parent)へ行く面 (×は置かない)。
//                                        'edit' は編集モード (Esc・戻る=完了。呼び手の close がその意味を持つ)
//   parent: {view,...} または () => {view,...}  … exit:'page' の時の←の行き先。閉じる時の returnRoute は
//                                                  ここから導く (parent(id) で取得)。履歴がアプリの外なら
//                                                  呼び手 (nav.closeFace 等) が replace で親へ行く (push しない)
// 使い方:
//   surface.define('art-add-sheet', { el: '#art-add-sheet', kind: 'sheet', layer: false, esc: false, close: (o) => ... });
//   surface.open('art-add-sheet', { extra });  /  surface.close('art-add-sheet', { reason: 'button' });
//   surface.push(id, close, { isMobile, extra, route }) / surface.pop(id, { fromHistory, route }) … 段だけの操作 (旧 _modalHistPush/Pop)
//   surface.parent('settings-modal') … define の parent を解決した route を返す (無ければ null)
(function () {
    'use strict';

    class Surface {
        constructor() {
            this.defs = {};
            this.host = null;     // VirtualBookshelf (nav・_isHistMobile・_bindSettingsPopstate を持つ)
        }

        bind(host) { this.host = host; return this; }

        define(id, def) { this.defs[id] = Object.assign({ id, hist: 'mobile', overlay: true, exit: 'overlay' }, def || {}); return this; }

        get(id) { return this.defs[id] || null; }

        // 出口 (イシュー#511 X1): exit:'page' の面の←の行き先 (parent) を解決して返す。無ければ null
        parent(id) {
            const def = this.get(id);
            if (!def) return null;
            const p = def.parent;
            return typeof p === 'function' ? p() : (p || null);
        }

        _ov() { return (typeof window !== 'undefined' && window.overlays) || null; }

        _el(def) {
            const e = def.el;
            if (!e) return document.getElementById(def.id);
            if (typeof e === 'function') return e();
            if (typeof e === 'string') return document.querySelector(e);
            return e;
        }

        // 段を積むか (今の判定関数をそのまま通す・PC で積まない差はここだけが持つ = S6 で変える所)
        _histOn(hist) {
            if (hist === 'never') return false;
            if (hist && typeof hist === 'object' && typeof hist.isMobile === 'function') return !!hist.isMobile();
            return !!(this.host && this.host._isHistMobile());
        }

        // 面を開く: overlays に載せ (段は Surface が積むので hist:false)、条件を満たせば段を積む
        open(id, opts) {
            const def = this.get(id);
            if (!def) return null;
            const o = opts || {};
            let handle = null;
            if (def.overlay !== false) {
                const ov = this._ov();
                const el = this._el(def);
                if (ov && el) {
                    handle = ov.open(el, {
                        id, kind: def.kind || 'modal', size: def.size, hist: false,
                        esc: def.esc, backdrop: def.backdrop, showClass: def.showClass, onOpen: def.onOpen,
                        layer: def.layer, sizeTarget: def.sizeTarget,
                        onClose: def.onClose,
                    });
                }
            }
            // close: 戻るで閉じる関数 (呼び手が渡せば定義より優先)。isMobile も同じ (art-sheet)
            const close = o.close || def.close;
            const isMobile = o.isMobile || (def.hist && def.hist.isMobile);
            if (o.hist !== false && close) this.push(id, close, { isMobile, never: def.hist === 'never', extra: o.extra, route: o.route || def.route });
            return handle;
        }

        // 面を閉じる: overlays から外し、段を外す (戻る由来 fromHistory は台帳が既に外している)
        close(id, opts) {
            const o = opts || {};
            const def = this.get(id);
            const ov = this._ov();
            // 未登録の面・overlay:false の面は段だけ外す (旧 _modalHistPop と同じ)
            if (def && def.overlay !== false && ov) ov.close(id, { reason: o.reason || 'program' });
            if (o.hist !== false) this.pop(id, { fromHistory: !!o.fromHistory, route: o.route });
        }

        isOpen(id) { const ov = this._ov(); return !!(ov && ov.has(id)); }

        // 段を積む (旧 VirtualBookshelf._modalHistPush の中身そのもの)
        push(id, close, { isMobile, never, extra, route } = {}) {
            const h = this.host;
            if (!h || never) return;
            const mobile = isMobile ? isMobile() : h._isHistMobile();
            if (!mobile) return;
            h._bindSettingsPopstate();
            if (route) h.nav.openRoute(id, extra || null, close, route, { mobile: true });
            else h.nav.open(id, extra || null, close, { mobile: true }); // 台帳が pushState する
        }

        // 段を外す (旧 VirtualBookshelf._modalHistPop の中身そのもの)
        pop(id, { fromHistory = false, route } = {}) {
            const h = this.host;
            if (!h) return;
            // × / ESC は台帳が go(-1)・戻る由来 (fromHistory) は台帳が既に外している
            if (fromHistory) return;
            // イシュー#494: settings-modal を × / Esc で閉じる時、詳細段 (settings-cat) が残っていれば
            // 1回の apply でまとめて畳む (#442 の closePublish3 と同じ理由。個別に2回 apply すると
            // go(遅延)とreplace(即時)の実行タイミングが噛み合わず段が余る・#494 step2で実測)。
            // settings-cat 単独の「‹戻る」(_bindSettingsPopstate) はここを通らない(変更なし)
            if (id === 'settings-modal' && h.nav.hasFace('settings-cat')) { h.nav.closeSettings(route); return; }
            if (route) h.nav.closeFace(id, route); // イシュー#468: face除去+route復元を1 apply
            else h.nav.close(id);
        }

        // 進むで開き直す関数 (define の reopen)。無ければ null
        reopener(id, extra) {
            const def = this.get(id);
            if (!def || typeof def.reopen !== 'function') return null;
            return () => def.reopen(extra || {});
        }
    }

    // Esc・枠外の判定 (イシュー#509 U3 step3)。各画面の個別の判定をここへ寄せる = 判定の正本を1か所にする
    // (どの面で何をするかは各画面のまま・振る舞いは変えない。出口の決まりをそろえるのは X1)
    Surface.isEsc = (e) => !!e && e.key === 'Escape';
    // keydown を登録し、Esc の時だけ fn を呼ぶ (addEventListener と同じ target・capture)。登録したハンドラを返す
    Surface.onEsc = (target, fn, capture) => {
        const h = (e) => { if (!Surface.isEsc(e)) return; fn(e); };
        target.addEventListener('keydown', h, capture);
        return h;
    };
    // 枠外クリック: 面の root 自身 (= 背景) を押した
    Surface.isBackdrop = (e, el) => !!e && !!el && e.target === el;
    // 枠外クリック: 渡した要素 (面・開いたボタン) のどれにも含まれない所を押した
    Surface.isOutside = (e, ...els) => !!e && els.every((el) => !el || !el.contains(e.target));

    window.Surface = Surface;
    if (!window.surface) window.surface = new Surface();
})();
