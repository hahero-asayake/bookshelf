// 重なり管理役 (OverlayManager・イシュー#367・設計案 19_重なる画面の共通化 案①)
//
// アプリ内で画面に重なる「面」(モーダル・シート・ポップオーバー・メニュー・確認ダイアログ) を、
// 開いた順のスタック 1 か所で持つ。面の root に data-layer="n" (スタック内の位置) を書き、
// z-index は CSS の帯 (--ov-z-base / --ov-z-dialog・css/bookshelf.css 「重なりの帯」) から
// calc(帯 + n) で払い出す = 決め打ちの z-index (99999 !important 等) を持たない。
// 新しく開く面は常にスタックの末尾 = 最前面になるので、「リンクを押すと今の画面の裏に出る」
// (同じ .modal の z-index で DOM 順に負ける) は構造的に起きない。
//
// 境界 (tmp/367/design.md §0・②決裁 2026-10-26):
//   - 履歴 (戻る/進む・段の深さ・pushState/popstate) は NavState (js/nav-state.js・_modalHistPush/Pop) が持つ。
//     管理役は history.* を呼ばず、hooks.onOpen / hooks.onClose で「開いた/閉じた」を知らせ、
//     requestClose(id, reason) で「閉じてよいか」を面に聞くだけ。
//   - 見た目 (大きさの段階 .ov-sm/.ov-md/.ov-lg/.ov-full・×/戻る・ヘッダ/フッタの型) は共通部品 = ここ。
//
// 使い方:
//   const h = window.overlays.open(el, { kind: 'modal', size: 'sm' });   // .show を付け data-layer を振る
//   h.close('button');  /  window.overlays.close(id, { reason: 'esc' });
//   await window.overlays.requestClose(id, 'history');   // onRequestClose(reason) が false を返せば閉じない
//   window.overlays.top() / isTop(id) / has(id) / stackInfo()
//   window.overlays.closeAll({ kinds: ['popover', 'menu'] });            // 遷移前の掃除
//
// 単体テスト: tests/unit/overlay-manager.test.js (jsdom)。経路の打鍵: tests/e2e/standard-ops.spec.js・overlay-front.spec.js
(function () {
    'use strict';

    const SIZES = ['sm', 'md', 'lg', 'full'];
    const KINDS = ['modal', 'sheet', 'popover', 'menu', 'dialog'];
    // 一時的な面 (別の面を開く前に自動で閉じる側・§6-4)
    const TRANSIENT = ['popover', 'menu'];
    // 操作要素 (フォーカスの移し先・イシュー#565)
    const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    class OverlayManager {
        constructor() {
            this.stack = [];          // [{ id, el, content, kind, size, hist, esc, backdrop, onRequestClose, onClose, owner, showClass, handle }]
            this.hooks = { onOpen: null, onClose: null };   // NavState (履歴) 側が結ぶ
            this._seq = 0;
        }

        /**
         * 面を開く。既に開いている id なら積み増さず既存のハンドルを返す (二重オープン)。
         * @param {HTMLElement|string} elOrId root 要素か id
         * @param {object} [spec]
         *   id         … 省略時は root の id (無ければ自動採番)
         *   kind       … 'modal'|'sheet'|'popover'|'menu'|'dialog' (既定 'modal')
         *   size       … 'sm'|'md'|'lg'|'full' (既定: root の data-ov-size か 'md')
         *   onOpen     … 'stack'|'closeOthers' (既定: popover/menu は 'closeOthers'、それ以外 'stack')
         *   esc        … ESC で閉じる面か (既定 true)。backdrop … 'close'|'ignore' (既定: modal/sheet は 'ignore'、他は 'close')
         *   hist       … 履歴に段を積む面か (既定: dialog/popover/menu は false、それ以外 true)。true なら hooks.onOpen を呼ぶ
         *   route      … 開いた時に URL (NavState route) を変える面か (イシュー#468・省略時は従来どおり route 不変)
         *   returnRoute… 閉じた時に戻す route (route 指定時のみ意味を持つ。省略時は main)
         *   onRequestClose(reason) → boolean|Promise<boolean> … 閉じる前の確認 (変更ありフォームの破棄確認の置き場)
         *   onClose(reason)       … 閉じた後片付け
         *   owner      … 'core'|'plugin:<id>'
         *   showClass  … root に付けるクラス (既定 'show'。null で付けない = 動的生成の .cfm-overlay 等)
         *   layer      … false なら data-layer/--layer を書かない (既定 true・イシュー#509)
         *   sizeTarget … .ov-* を付ける要素 (既定: root 内の .modal-content / .cfm-box、無ければ root)
         */
        open(elOrId, spec) {
            const s = spec || {};
            const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
            if (!el) return null;
            const id = s.id || el.id || ('ov-' + (++this._seq));
            const existing = this.stack.find((f) => f.id === id);
            if (existing) { this._applyLayers(); return existing.handle; }

            const kind = KINDS.includes(s.kind) ? s.kind : 'modal';
            // size:'none' = 段階を付けない (アンカー付きの popover/menu・自前の寸法を持つ面)。重なり順だけ管理役が決める
            const noSize = s.size === 'none';
            const size = SIZES.includes(s.size) ? s.size : (SIZES.includes(el.dataset.ovSize) ? el.dataset.ovSize : 'md');
            const onOpen = s.onOpen || (TRANSIENT.includes(kind) ? 'closeOthers' : 'stack');
            if (onOpen === 'closeOthers') this.closeAll({ kinds: TRANSIENT, reason: 'closeOthers' });

            const transientOrDialog = TRANSIENT.includes(kind) || kind === 'dialog';
            const face = {
                id, el, kind, size,
                hist: typeof s.hist === 'boolean' ? s.hist : !transientOrDialog,
                route: s.route || null, // イシュー#468: 開いた時に変える NavState route (省略時は従来どおり不変)
                returnRoute: s.returnRoute || null, // 閉じた時に戻す route
                esc: s.esc !== false,
                backdrop: s.backdrop || ((kind === 'modal' || kind === 'sheet') ? 'ignore' : 'close'),
                onRequestClose: typeof s.onRequestClose === 'function' ? s.onRequestClose : null,
                onClose: typeof s.onClose === 'function' ? s.onClose : null,
                owner: s.owner || 'core',
                showClass: s.showClass === undefined ? 'show' : s.showClass,
                // layer:false = data-layer/--layer を書かない (自前の z-index を持つ面をスタックに載せるだけ・イシュー#509 U3 で記事の面の重なり順を変えないため)
                layer: s.layer !== false,
                // イシュー#568: 開いている間、背後を inert にする面か (Tab が背後へ漏れない)。既定 = modal/dialog。
                // sheet (引き出し・記事エディタの引き出し/メニュー) と popover/menu は対象外 = 背後のスクリムのタップで閉じる今の操作を変えない
                trap: typeof s.trap === 'boolean' ? s.trap : (kind === 'modal' || kind === 'dialog'),
                content: null, handle: null,
                // イシュー#565: 開いた元 (フォーカスの戻し先)。閉じた時にここへ戻す
                opener: (document.activeElement && document.activeElement !== document.body) ? document.activeElement : null,
            };
            const target = typeof s.sizeTarget === 'string' ? el.querySelector(s.sizeTarget)
                : (s.sizeTarget || el.querySelector('.modal-content, .cfm-box') || el);
            face.content = target;
            if (!noSize) {
                SIZES.forEach((x) => target.classList.remove('ov-' + x));
                target.classList.add('ov-' + size);
                el.dataset.ovSize = size;
            }
            el.dataset.ovKind = kind;
            if (face.showClass) el.classList.add(face.showClass);

            this.stack.push(face);
            this._applyLayers();
            this._focusInto(face);

            face.handle = {
                id, el,
                close: (reason) => this.close(id, { reason: reason || 'program' }),
                requestClose: (reason) => this.requestClose(id, reason || 'program'),
                isTop: () => this.isTop(id),
            };
            if (face.hist && typeof this.hooks.onOpen === 'function') {
                try {
                    this.hooks.onOpen(id, {
                        hist: true, el,
                        route: face.route, // イシュー#468
                        // 履歴側が「戻る」で閉じる時に呼ぶ。契約: {fromHistory} を受け取り、閉じなかった時だけ false
                        closeFn: (o) => this.close(id, { reason: 'history', fromHistory: !!(o && o.fromHistory) }),
                    });
                } catch (e) { console.error('[overlays] hooks.onOpen', e); }
            }
            return face.handle;
        }

        /** 面を閉じる (確認は通さない)。閉じたら true、開いていなければ false */
        close(id, opts) {
            const o = opts || {};
            const reason = o.reason || 'program';
            const i = this.stack.findIndex((f) => f.id === id);
            if (i === -1) return false;
            const face = this.stack[i];
            this.stack.splice(i, 1);
            if (face.showClass) face.el.classList.remove(face.showClass);
            delete face.el.dataset.layer;
            face.el.style.removeProperty('--layer');
            this._applyLayers();
            if (face.onClose) { try { face.onClose(reason); } catch (e) { console.error('[overlays] onClose', e); } }
            this._restoreFocus(face);
            if (face.hist && typeof this.hooks.onClose === 'function') {
                try { this.hooks.onClose(id, { reason, fromHistory: !!o.fromHistory || reason === 'history', route: face.route ? (face.returnRoute || { view: 'main' }) : null }); }
                catch (e) { console.error('[overlays] hooks.onClose', e); }
            }
            return true;
        }

// フォーカスの戻し先 (イシュー#565)。全部の面がここを通るので、面ごとに書かない:
        //   開いた時: 面の中にフォーカスが無ければ、中の最初の操作要素へ移す (面が自前で入れる場合は邪魔しない=次のtickで確認)
        //   閉じた時: フォーカスが面の中か body に落ちていれば、開いた元へ戻す (元が消えていれば下の面の中・無ければ何もしない)
        _focusInto(face) {
            if (TRANSIENT.includes(face.kind)) return;
            setTimeout(() => {
                if (!this.stack.includes(face)) return;
                const ae = document.activeElement;
                if (ae && ae !== document.body && face.el.contains(ae)) return;
                if (ae && ae !== document.body && ae !== face.opener) return; // 面が別の場所へ入れた
                const t = face.el.querySelector(FOCUSABLE);
                if (t && t.offsetParent !== null) { try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
            }, 0);
        }

        _restoreFocus(face) {
            const ae = document.activeElement;
            if (ae && ae !== document.body && !face.el.contains(ae)) return; // 既に別の場所へ移っている
            let t = face.opener && face.opener.isConnected && face.opener.offsetParent !== null ? face.opener : null;
            if (!t) {
                const under = this.stack[this.stack.length - 1];
                t = under ? under.el.querySelector(FOCUSABLE) : null;
            }
            if (t) { try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
        }

                /** 閉じる要求 (ESC・×・戻る)。面の onRequestClose が false を返せば閉じない (false を返す) */
        async requestClose(id, reason) {
            const face = this.stack.find((f) => f.id === id);
            if (!face) return false;
            if (face.onRequestClose) {
                let ok;
                try { ok = await face.onRequestClose(reason || 'program'); } catch (e) { console.error('[overlays] onRequestClose', e); ok = false; }
                if (ok === false) return false;
            }
            return this.close(id, { reason: reason || 'program' });
        }

        /** まとめて閉じる (上から順)。kinds を渡せばその種類だけ。閉じた数を返す */
        closeAll(opts) {
            const o = opts || {};
            const targets = this.stack.filter((f) => !o.kinds || o.kinds.includes(f.kind)).reverse();
            targets.forEach((f) => this.close(f.id, { reason: o.reason || 'program' }));
            return targets.length;
        }

        /** 開いたまま大きさの段階を変える (公開記事モーダル: 一覧=lg → 編集=full 等) */
        setSize(id, size) {
            const face = this.get(id);
            if (!face || !SIZES.includes(size) || !face.content) return false;
            SIZES.forEach((x) => face.content.classList.remove('ov-' + x));
            face.content.classList.add('ov-' + size);
            face.size = size;
            face.el.dataset.ovSize = size;
            return true;
        }

        top() { return this.stack.length ? this.stack[this.stack.length - 1] : null; }
        isTop(id) { const t = this.top(); return !!t && t.id === id; }
        has(id) { return this.stack.some((f) => f.id === id); }
        get(id) { return this.stack.find((f) => f.id === id) || null; }
        stackInfo() { return this.stack.map((f, n) => ({ id: f.id, kind: f.kind, size: f.size, layer: n, owner: f.owner })); }

        // スタック内の位置 n を data-layer と --layer (CSS 変数) に書く。z-index は CSS 側が calc(帯 + n) で決める
        _applyLayers() {
            let n = 0; // layer:false の面は数えない = 他の面の data-layer を載せ替え前と同じ値に保つ (イシュー#509)
            this.stack.forEach((f) => {
                if (f.layer === false) return;
                f.el.dataset.layer = String(n);
                f.el.style.setProperty('--layer', String(n));
                n++;
            });
            this._applyInert();
        }

        // 背後の inert (イシュー#568・#556 報告の4)。全部の面がここを通るので、面ごとに書かない:
        //   最前面の trap 面の外側 (body から面までの道筋の兄弟) に inert を付ける。面より上の popover/menu・toast・
        //   hooks.inertKeep(id) が返す要素 (PC の「行き先」の面ではサイドバー) は残す。
        //   自分が付けた inert だけを外す = 元から inert の要素 (ホーム表示中の本棚 #bookshelf-view 等) は触らない
        _applyInert() {
            if (typeof document === 'undefined' || !document.body) return;
            const prev = this._inerted || [];
            prev.forEach((el) => { if (el.isConnected) el.inert = false; });
            this._inerted = [];
            let ti = -1;
            for (let i = this.stack.length - 1; i >= 0; i--) { if (this.stack[i].trap) { ti = i; break; } }
            if (ti === -1) return;
            const top = this.stack[ti];
            if (!top.el || !top.el.isConnected) return;
            const keep = [top.el, document.getElementById('toast-container')];
            this.stack.slice(ti + 1).forEach((f) => keep.push(f.el));
            if (typeof this.hooks.inertKeep === 'function') {
                try { (this.hooks.inertKeep(top.id) || []).forEach((el) => keep.push(el)); } catch (e) { console.error('[overlays] hooks.inertKeep', e); }
            }
            const keepSet = new Set(keep.filter((el) => el && el.isConnected));
            const path = new Set();
            keepSet.forEach((el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) path.add(p); });
            const walk = (parent) => {
                Array.from(parent.children).forEach((c) => {
                    if (keepSet.has(c)) return;
                    if (path.has(c)) { walk(c); return; }
                    if (/^(SCRIPT|STYLE|TEMPLATE|LINK|META)$/.test(c.tagName) || c.inert) return;
                    c.inert = true;
                    this._inerted.push(c);
                });
            };
            walk(document.body);
        }

        // 移行期の橋渡し (イシュー#367 step3〜5): まだ管理役経由に書き換えていない .modal が .show を付け外ししたら、
        // スタックに載せ外しする = 「開いた順 = 重なり順」を全モーダルで即時に成立させる (同じ z-index の DOM 順に依存しない)。
        // 管理役経由で開いた面は has(id) で弾くので二重には載らない。全面が移行したら撤去する
    }

    window.OverlayManager = OverlayManager;
    if (!window.overlays) window.overlays = new OverlayManager();
})();
