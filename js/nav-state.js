// NavState — 「今どの画面を開いているか」の台帳 (イシュー#359 案A・段階②=影モード)
//
// 段階② (このファイルの今の役割): 旧実装 (hash / history.state / _modalHistStack / body class) は一切変えず、
// 既存の書き手をラップして「入力」だけをここへ流し、純関数 reduce で次の状態を作る。遷移のたびに
// queueMicrotask で旧実装の実際の状態と突き合わせ、ずれを window.__navShadow.diffs に積む (console.warn 1行)。
// 画面・履歴への副作用は無い。ON の条件: E2E (navigator.webdriver) か localStorage.navShadow === '1'。
// 段階③で project.history が履歴の唯一の書き手になり、段階④で project.screen が画面の差分適用の元になる。
//
// 状態:
//   { view: 'main'|'bookshelf',           // body の app-view-* (画面の土台)
//     route: {view, slug?, asin?, from?}, // URL (hash) が指す行き先 = router.parse の形
//     book: {asin, edit}|null,            // 本詳細 (右ペイン/シート) が開いているか
//     faces: [{id, extra}],               // 履歴に段を積んでいる面 (旧 _modalHistStack と同じ順序)
//     source: 'ui'|'history'|'boot' }     // 直前の入力の由来
//
// 入力 (reduce の第2引数・type で分ける):
//   boot{route,view}  route{route}  view{view}  openBook{asin,edit}  closeBook  open{id,extra}  close{id}
//   adopt (本詳細を faces の末尾へ付け替え)  rename{from,to} (記事面の段の引き継ぎ)
(function () {
    'use strict';

    const EMPTY = Object.freeze({ view: 'main', route: { view: 'main' }, book: null, faces: [], source: 'boot' });

    // route を比較できる形に正規化する (undefined を落とし、キー順を固定)
    function canonRoute(r) {
        if (!r || !r.view) return { view: 'main' };
        const o = { view: r.view };
        if (r.view === 'bookshelf' && r.slug) o.slug = r.slug;
        if (r.view === 'book') { if (r.asin) o.asin = r.asin; if (r.from) o.from = r.from; }
        return o;
    }

    function reduce(state, input) {
        const s = state || EMPTY;
        const source = input.source || s.source;
        switch (input.type) {
            case 'boot':
                return { ...s, route: canonRoute(input.route), view: input.view || s.view, source: 'boot' };
            case 'route':
                return { ...s, route: canonRoute(input.route), source };
            case 'view':
                // _setBodyView('main') は本詳細のピン留めも外す (旧実装 L5517-5519) = 旧挙動を正とする
                return { ...s, view: input.view, book: input.view === 'main' ? null : s.book, source };
            case 'openBook':
                return { ...s, book: { asin: input.asin || null, edit: !!input.edit }, source };
            case 'closeBook':
                return { ...s, book: null, source };
            case 'open':
                if (s.faces.some((f) => f.id === input.id)) return s; // 二重オープンで積み増さない (旧 L12299)
                return { ...s, faces: [...s.faces, { id: input.id, extra: input.extra || null }], source };
            case 'close': {
                const i = s.faces.findIndex((f) => f.id === input.id);
                if (i === -1) return s;
                const faces = s.faces.slice(); faces.splice(i, 1);
                return { ...s, faces, source };
            }
            case 'adopt': {
                const faces = s.faces.filter((f) => f.id !== 'book-detail');
                faces.push({ id: 'book-detail', extra: null });
                return { ...s, faces, source };
            }
            case 'rename': {
                const i = s.faces.findIndex((f) => f.id === input.from);
                if (i === -1) return s;
                const faces = s.faces.slice(); faces[i] = { ...faces[i], id: input.to };
                return { ...s, faces, source };
            }
            default:
                return s;
        }
    }

    function formatRoute(r) {
        const c = canonRoute(r);
        if (c.view === 'bookshelf' && c.slug) return `#/bookshelf/${encodeURIComponent(c.slug)}`;
        if (c.view === 'book' && c.asin) return `#book/${encodeURIComponent(c.asin)}${c.from ? `?from=${encodeURIComponent(c.from)}` : ''}`;
        return '';
    }

    const project = {
        // 履歴の写し: 期待する hash と、履歴に段を積んでいる面の並び
        history(state) { return { hash: formatRoute(state.route), faces: state.faces.map((f) => f.id) }; },
        // 画面の写し: body のビュー class と本詳細のピン留め
        screen(state) { return { view: state.view, detailPinned: !!state.book }; },
    };

    // ON: E2E (navigator.webdriver) か localStorage.navShadow==='1'。navShadow==='0' は明示 OFF (E2E でも切れる=計測の対照用)
    function isEnabled() {
        try {
            const v = localStorage.getItem('navShadow');
            if (v === '0') return false;
            return navigator.webdriver === true || v === '1';
        } catch (_) { return false; }
    }

    // 旧実装の書き手をラップして入力を流す。戻り値・副作用は変えない (after は try で包み、失敗は diffs に記す)
    function install(app) {
        if (!app || app.__navShadowInstalled || !isEnabled()) return null;
        app.__navShadowInstalled = true;
        // costMs: dispatch(reduce)+compare に使った合計時間 (影モード自体の費用を直接測る・359-perf が読む)
        const shadow = window.__navShadow = { enabled: true, state: EMPTY, inputs: 0, compares: 0, costMs: 0, diffs: [], log: [], reduce, project };
        let lastPopstateAt = -1e9;
        const sourceNow = () => (performance.now() - lastPopstateAt < 50 ? 'history' : 'ui');
        let queued = false;
        const check = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; const t0 = performance.now(); compare(); shadow.compares++; shadow.costMs += performance.now() - t0; }); };
        const dispatch = (input) => {
            const t0 = performance.now();
            if (!input.source) input.source = sourceNow();
            shadow.state = reduce(shadow.state, input);
            shadow.inputs++;
            if (shadow.log.length < 400) shadow.log.push({ n: shadow.inputs, ...input });
            check();
            shadow.costMs += performance.now() - t0;
        };
        const wrap = (obj, name, after) => {
            const orig = obj && obj[name];
            if (typeof orig !== 'function') { shadow.diffs.push({ kind: 'missing', fn: name }); return; }
            obj[name] = function (...args) {
                const r = orig.apply(this, args);
                try { after.call(this, args, r); } catch (e) { shadow.diffs.push({ kind: 'wrap-error', fn: name, err: String(e) }); }
                return r;
            };
        };
        function compare() {
            const s = shadow.state;
            const body = document.body;
            const expected = { route: canonRoute(s.route), faces: project.history(s).faces, view: project.screen(s).view, detailPinned: project.screen(s).detailPinned };
            const actual = {
                route: canonRoute(app.router ? app.router.parse(location.hash) : { view: 'main' }),
                faces: (app._modalHistStack || []).map((e) => e.id),
                view: body.classList.contains('app-view-bookshelf') ? 'bookshelf' : 'main',
                detailPinned: body.classList.contains('book-detail-pinned'),
            };
            const fields = Object.keys(expected).filter((k) => JSON.stringify(expected[k]) !== JSON.stringify(actual[k]));
            if (!fields.length) return;
            const d = { kind: 'diff', n: shadow.inputs, t: Math.round(performance.now()), fields, expected, actual, lastInput: shadow.log[shadow.log.length - 1] || null, width: window.innerWidth };
            shadow.diffs.push(d);
            console.warn('[nav-shadow] diff ' + JSON.stringify(d));
        }

        // 起動時の URL と body を初期状態にする
        const bootView = document.body && document.body.classList.contains('app-view-bookshelf') ? 'bookshelf' : 'main';
        dispatch({ type: 'boot', route: app.router ? app.router.parse(location.hash) : { view: 'main' }, view: bootView, source: 'boot' });
        // 段階③ (nav 接続後) の自己検査: popstate で nav が段を外す/開き直す時は旧関数を通らないので継ぎ目から入力を受ける
        if (app.nav) {
            app.nav.onFaceClosedByHistory = (id) => dispatch({ type: 'close', id, source: 'history' });
            app.nav.onFaceReopenedByHistory = (id, extra) => dispatch({ type: 'open', id, extra: extra || null, source: 'history' });
            // showBookDetail は router を通らず nav.openBook で URL と段を書く → 影にも同じ入力 (route・adopt) を流す
            wrap(app.nav, 'openBook', function (args) {
                const m = args[3] || {};
                const mobile = typeof m.mobile === 'boolean' ? m.mobile : true;
                dispatch({ type: 'route', route: { view: 'book', asin: args[0], from: args[2] }, source: 'ui' });
                if (mobile) dispatch({ type: 'adopt' });
            });
        }

        // 履歴の由来 (popstate 直後の入力は 'history')。app 側のリスナーより先に登録される capture。
        // 戻る/進むでは、popstate の時点でブラウザが URL を既に書き換えている (hashchange は別タスクで後から来る=
        // 旧実装の2購読者 B11)。台帳は「着地した URL」をここで読む (段階③で popstate だけを購読する形の先取り)。
        window.addEventListener('popstate', () => {
            lastPopstateAt = performance.now();
            if (app.router) dispatch({ type: 'route', route: app.router.parse(location.hash), source: 'history' });
        }, true);

        // --- 履歴の段 (旧 _modalHistStack の書き手) ---
        // 戻るで着地した時、旧 _onModalHistPopstate は st.pop() で段を外してから top.close({fromHistory}) を呼ぶ
        // (_modalHistPop を通らない書き手)。段の close をラップし、同じ順 (外す→閉じる) で入力を流す。
        // close が false を返した時 (破棄確認で「続ける」・保存失敗) は旧実装が段を積み直す (旧 L12365-12368) ので、
        // 同じく open を入力に戻す。積み直しは await 再開後に起きるため、1 microtask 遅らせて順序を合わせる。
        const wrappedCloses = new WeakSet();
        const wrapEntryClose = (entry) => {
            if (!entry || typeof entry.close !== 'function' || wrappedCloses.has(entry.close)) return;
            const orig = entry.close;
            entry.close = function (...a) {
                const id = entry.id;
                const face = shadow.state.faces.find((f) => f.id === id);
                dispatch({ type: 'close', id, source: 'history' });
                const r = orig.apply(this, a);
                const keep = (res) => { if (res === false) queueMicrotask(() => dispatch({ type: 'open', id, extra: face ? face.extra : null, source: 'history' })); return res; };
                return (r && typeof r.then === 'function') ? r.then(keep) : keep(r);
            };
            wrappedCloses.add(entry.close);
        };
        const findEntry = (id) => (app._modalHistStack || []).find((e) => e.id === id);
        wrap(app, '_modalHistPush', function (args) {
            const o = args[2] || {};
            const mobile = o.isMobile ? o.isMobile() : this._isHistMobile(); // 旧 L12295: スマホ幅でだけ積む
            if (mobile) { dispatch({ type: 'open', id: args[0], extra: o.extra || null }); wrapEntryClose(findEntry(args[0])); }
        });
        wrap(app, '_modalHistPop', function (args) {
            const o = args[1] || {};
            dispatch({ type: 'close', id: args[0], source: o.fromHistory ? 'history' : undefined });
        });
        wrap(app, '_bookDetailHistAdopt', function () { dispatch({ type: 'adopt' }); wrapEntryClose(findEntry('book-detail')); });
        wrap(app, '_bookDetailHistRelease', function () { dispatch({ type: 'close', id: 'book-detail' }); });
        wrap(app, '_closeDrawer', function () { dispatch({ type: 'close', id: 'drawer' }); });            // silent は直接 splice (旧 L5615)
        wrap(app, '_closePalette', function () { dispatch({ type: 'close', id: 'command-palette' }); });  // 同上 (旧 L1152)
        wrap(app, '_artHistHandOver', function (args, r) {
            if (r !== true) return;
            dispatch({ type: 'rename', from: args[0], to: args[1] });
            wrapEntryClose(findEntry(args[1])); // close も差し替わる (旧 _artHistHandOver) ので包み直す
        });

        // --- 画面 (body class / 本詳細) ---
        wrap(app, '_setBodyView', function (args) { dispatch({ type: 'view', view: args[0] }); });
        wrap(app, 'showBookDetail', function (args) { dispatch({ type: 'openBook', asin: args[0] && args[0].asin, edit: !!args[1] }); });
        wrap(app, '_closeBookModalDom', function () { dispatch({ type: 'closeBook' }); });

        // --- URL (hash) ---
        if (app.router) {
            const router = app.router;
            wrap(router, '_setHash', function (args) { dispatch({ type: 'route', route: router.parse(args[0] || ''), source: 'ui' }); });
            wrap(router, '_dispatch', function (args) { dispatch({ type: 'route', route: args[0] }); });
        }
        return shadow;
    }

    // ===== 段階③ (イシュー#365 step2) の核: 純関数のみ・まだ bookshelf.js からは呼ばれていない (接続は次の commit) =====
    // 設計: tmp/359/stage3/design.md §2-3・§6。
    const OVERLAY_FACES = ['drawer', 'command-palette']; // hash 遷移で静かに閉じる面 (旧 _closeOverlayFacesSilently)
    // 本詳細を開いたまま UI から本棚を切り替えた時の扱い (②指示=C。A/B は定数1つで切替・ハヘロ決裁待ち)
    //   C: route は本棚・book はそのまま (現状)  A: book を閉じる  B: route を #book/asin?from=新本棚 に保つ
    const SHELF_SWITCH_WITH_BOOK = 'C';

    const sameRoute = (a, b) => JSON.stringify(canonRoute(a)) === JSON.stringify(canonRoute(b));

    // 履歴エントリに入れる写し (close 関数は入れない)
    function snapshot(state, seq) {
        return {
            v: 1, seq: seq | 0,
            route: canonRoute(state.route),
            book: state.book ? { asin: state.book.asin || null, edit: !!state.book.edit } : null,
            faces: state.faces.map((f) => ({ id: f.id, extra: f.extra || null })),
            view: state.view,
        };
    }
    // history.state に書く形 = 新 (nav) + 旧キー (bsModal / d / extra)。kill-switch で旧経路へ戻しても _histStateDepth が読める
    function historyState(snap) {
        const top = snap.faces[snap.faces.length - 1] || null;
        return Object.assign({}, top && top.extra ? top.extra : {}, { bsModal: top ? top.id : null, d: snap.faces.length, nav: snap });
    }
    // スナップショットから状態へ (着地したエントリをそのまま採用する)
    function fromSnapshot(snap, closers) {
        const s = snap || {};
        return {
            view: s.view || 'main',
            route: canonRoute(s.route),
            book: s.book ? { asin: s.book.asin || null, edit: !!s.book.edit } : null,
            faces: (s.faces || []).map((f) => ({ id: f.id, extra: f.extra || null, close: closers && closers[f.id] ? closers[f.id] : null })),
            source: 'history',
        };
    }

    // 段階③の UI 入力 (段階②の reduce に 3 種を足す)。navigate / openBook3 / closeBook3 以外は reduce へ
    function reduce3(state, input) {
        const s = state || EMPTY;
        switch (input.type) {
            case 'navigate': { // ホーム/本棚へ (UI)。overlay を閉じ、本詳細の扱いは SHELF_SWITCH_WITH_BOOK
                let faces = s.faces.filter((f) => !OVERLAY_FACES.includes(f.id));
                let book = s.book;
                let route = canonRoute(input.route);
                if (book && route.view === 'main') {
                    // ホームへ戻る時は本詳細も閉じる (旧 _applyRoute('main') → _setBodyView('main') + _closeBookModalDom と同じ)
                    book = null; faces = faces.filter((f) => f.id !== 'book-detail');
                } else if (book && route.view === 'bookshelf') {
                    const mode = NavState.SHELF_SWITCH_WITH_BOOK;
                    if (mode === 'A') { book = null; faces = faces.filter((f) => f.id !== 'book-detail'); }
                    else if (mode === 'B') route = canonRoute({ view: 'book', asin: book.asin, from: input.shelfInternalId });
                    // 'C': route は本棚・book はそのまま (現状維持)
                }
                return { ...s, faces, book, route, source: 'ui' };
            }
            case 'openBook3': { // showBookDetail (UI)。スマホ幅では book-detail を faces の末尾へ (既にあれば付け替え=旧 adopt)
                let faces = s.faces;
                if (input.mobile) faces = [...faces.filter((f) => f.id !== 'book-detail'), { id: 'book-detail', extra: null, close: input.close || null }];
                return { ...s, route: canonRoute({ view: 'book', asin: input.asin, from: input.from }), book: { asin: input.asin || null, edit: !!input.edit }, faces, source: 'ui' };
            }
            case 'closeBook3': { // closeModal (× で閉じる)。route は from の本棚かホーム (旧 closeModal と同じ)
                const faces = s.faces.filter((f) => f.id !== 'book-detail');
                const route = input.route ? canonRoute(input.route) : { view: 'main' };
                return { ...s, faces, book: null, route, source: 'ui' };
            }
            default:
                return reduce(s, input);
        }
    }

    // 履歴に何をするか (書き手は apply 1 つ)。meta: {source, replace, extraChanged}
    //   面を開いた→push／×・ESC・silent で閉じた (route 不変)→go(-k)／route が変わった→push (閉じた面があるか replace 指定なら replace)
    function historyOp(prev, next, meta) {
        const m = meta || {};
        if (m.source === 'history') return { op: 'none' };            // 着地は書かない
        const dFaces = next.faces.length - prev.faces.length;
        const routeChanged = !sameRoute(prev.route, next.route);
        const nextIds = new Set(next.faces.map((f) => f.id));
        // hash 遷移で overlay (ドロワー/パレット) を閉じた = その段を遷移先で置き換える (旧 _navigateFromUi の replace・①-0)。
        // 本詳細 (book-detail) が外れる遷移 (ホームへ) は旧と同じく新エントリ (戻るで本詳細に戻れる)
        const closedOverlay = prev.faces.some((f) => OVERLAY_FACES.includes(f.id) && !nextIds.has(f.id));
        if (dFaces > 0) return { op: 'push' };
        if (dFaces < 0 && !routeChanged) return { op: 'go', n: dFaces };
        if (routeChanged) return { op: (closedOverlay || m.replace) ? 'replace' : 'push' };
        if (m.extraChanged || m.renamed) return { op: 'replace' };
        return { op: 'none' };
    }

    // popstate で着地したスナップショットに画面を合わせるための差分 (閉じる面は末尾から・開き直す面は reopen 表で)
    function screenDiff(current, snap) {
        const snapIds = new Set((snap.faces || []).map((f) => f.id));
        const curIds = new Set(current.faces.map((f) => f.id));
        return {
            close: current.faces.filter((f) => !snapIds.has(f.id)).reverse(),
            open: (snap.faces || []).filter((f) => !curIds.has(f.id)),
            routeChanged: !sameRoute(current.route, snap.route),
            bookChanged: JSON.stringify(current.book || null) !== JSON.stringify(snap.book || null),
            animate: false, // source:'history' は常にアニメ無し (ADR-125 の意図をここ1箇所で)
        };
    }

    // ===== 段階③ 骨組み: 履歴の唯一の書き手・popstate の唯一の聞き手 (未接続・bookshelf.js からの呼び出しは次の commit) =====
    // 設計: tmp/359/stage3/design.md §3-4。opts は単体テスト用に差し替え可:
    //   { history, location, document, parse(hash), isMobile(), reopeners: {id: (extra, snap) => void|Promise}, onLanded(snap, {animate:false,...}) }
    function createNav(app, opts) {
        const o = opts || {};
        const H = o.history || window.history;
        const L = o.location || window.location;
        const D = o.document || (typeof document !== 'undefined' ? document : null);
        const parse = o.parse || ((h) => (app && app.router ? app.router.parse(h) : { view: 'main' }));
        const nav = {
            state: EMPTY, seq: 0, closers: {}, reopeners: o.reopeners || {}, log: [],
            // 旧 _modalHistStack 互換 (読み取りビュー): [{id, close}]
            get facesCompat() { return this.state.faces.map((f) => ({ id: f.id, close: this.closers[f.id] || null })); },
            url(route) { return `${L.pathname}${L.search}${formatRoute(route)}`; },
            _write(op) {
                const snap = snapshot(this.state, ++this.seq);
                const hs = historyState(snap);
                if (op === 'push') H.pushState(hs, '', this.url(snap.route));
                else H.replaceState(hs, '', this.url(snap.route));
            },
            // UI 入力の唯一の入口: reduce3 → historyOp → pushState / replaceState / go。履歴の操作が無くても写しが変わったら
            // (編集モード・extra 等) 現在のエントリを replace = エントリは常に「今」を映す (進む/戻るで開き直しても値が保たれる・R08i)
            apply(input, meta) {
                const m = meta || {};
                const prev = this.state;
                const next = reduce3(prev, input);
                this.state = next;
                if (input.close) this.closers[input.type === 'openBook3' ? 'book-detail' : (input.type === 'rename' ? input.to : input.id)] = input.close;
                let op = historyOp(prev, next, m);
                if (op.op === 'none' && m.source !== 'history' && JSON.stringify(snapshot(prev, 0)) !== JSON.stringify(snapshot(next, 0))) op = { op: 'replace' };
                if (op.op === 'push' || op.op === 'replace') this._write(op.op);
                else if (op.op === 'go') { try { H.go(op.n); } catch (_) {} }
                if (this.log.length < 400) this.log.push({ type: input.type, id: input.id || input.asin || null, op: op.op });
                return op;
            },
            // --- 入口 (bookshelf.js の各書き手が先頭で呼ぶ)。mobile=false (PC 幅) の面は履歴に積まない (旧 _modalHistPush L12297) ---
            open(id, extra, close, meta) {
                const m = meta || {};
                const mobile = typeof m.mobile === 'boolean' ? m.mobile : (o.isMobile ? !!o.isMobile() : true);
                if (!mobile) return { op: 'none', skipped: 'pc' };
                return this.apply({ type: 'open', id, extra: extra || null, close }, m);
            },
            close(id, meta) { return this.apply({ type: 'close', id }, meta); },
            navigate(route, meta) { const m = meta || {}; return this.apply({ type: 'navigate', route, shelfInternalId: m.shelfInternalId }, m); },
            openBook(asin, edit, from, meta) {
                const m = meta || {};
                const mobile = typeof m.mobile === 'boolean' ? m.mobile : (o.isMobile ? !!o.isMobile() : true);
                return this.apply({ type: 'openBook3', asin, edit: !!edit, from, mobile, close: m.close }, m);
            },
            closeBook(route, meta) { return this.apply({ type: 'closeBook3', route }, Object.assign({ replace: true }, meta || {})); },
            rename(from, to, close, meta) { return this.apply({ type: 'rename', from, to, close }, Object.assign({ renamed: true }, meta || {})); },
            setExtra(id, extra) {
                const faces = this.state.faces.map((f) => (f.id === id ? { ...f, extra: Object.assign({}, f.extra || {}, extra || {}) } : f));
                this.state = { ...this.state, faces };
                this._write('replace');
            },
            setView(view) { if (this.state.view !== view) this.state = { ...this.state, view }; }, // body の app-view-* (履歴は書かない)
            hasFace(id) { return this.state.faces.some((f) => f.id === id); },
            // 唯一の聞き手。着地したエントリの写しに画面を合わせ、その写しをそのまま採用する (数え合わせ無し)
            async onPopstate(ev) {
                const snapIn = ev && ev.state && ev.state.nav;
                const hashRoute = canonRoute(parse(L.hash));
                const snap = snapIn
                    ? { ...snapIn, route: canonRoute(snapIn.route), faces: snapIn.faces || [] }
                    : { v: 1, seq: 0, route: hashRoute, book: hashRoute.view === 'book' ? { asin: hashRoute.asin || null, edit: false } : null, faces: [], view: this.state.view };
                // 確認ダイアログ (.cfm-overlay) は履歴に積まない (D04): ESC を送り、今の写しを積み直す (旧 L12351-12358)
                if (D && D.querySelector && D.querySelector('.cfm-overlay')) {
                    D.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    this._write('push');
                    return { landed: false, reason: 'confirm' };
                }
                const diff = screenDiff(this.state, snap);
                // 1) 閉じる (末尾から)。close が false = まだ開いている → 今の写しを積み直して終える (旧 L12365-12369)
                for (const f of diff.close) {
                    this.state = { ...this.state, faces: this.state.faces.filter((x) => x.id !== f.id), source: 'history' };
                    if (this.onFaceClosedByHistory) { try { this.onFaceClosedByHistory(f.id); } catch (_) {} } // 影モードの自己検査用の継ぎ目
                    const close = this.closers[f.id];
                    let res = true;
                    if (close) { try { res = await close({ fromHistory: true }); } catch (_) { res = true; } }
                    if (res === false) {
                        this.state = { ...this.state, faces: [...this.state.faces, { id: f.id, extra: f.extra || null }] };
                        this._write('push');
                        return { landed: false, reason: 'close-refused', id: f.id };
                    }
                }
                // 2) 開き直す (reopen 表 = 関数 (id, extra, snap) → thunk|null でも表でも可)。表に無い面は開き直せない = さらに戻る (旧 D06・L12432)。
                //    book-detail は route/book 側 (onLanded) が開くので写しに足すだけ
                for (const f of diff.open) {
                    this.state = { ...this.state, faces: [...this.state.faces, { id: f.id, extra: f.extra || null }], source: 'history' };
                    if (f.id === 'book-detail') continue;
                    const reopen = typeof this.reopeners === 'function' ? this.reopeners(f.id, f.extra || {}, snap) : this.reopeners[f.id];
                    if (!reopen) { try { H.back(); } catch (_) {} return { landed: false, reason: 'no-reopener', id: f.id }; }
                    if (this.onFaceReopenedByHistory) { try { this.onFaceReopenedByHistory(f.id, f.extra || null); } catch (_) {} }
                    try { await reopen(f.extra || {}, snap); } catch (_) { /* 開けなかった面も写しには残す (旧と同じ) */ }
                }
                // 3) route / book は画面側 (bookshelf.js の _applyRoute 相当) に任せる。source:'history' = アニメ無し (ADR-125 をここ1箇所で)
                if (diff.routeChanged || diff.bookChanged) {
                    this.state = { ...this.state, route: snap.route, book: snap.book ? { ...snap.book } : null, source: 'history' };
                    if (o.onLanded) await o.onLanded(snap, { animate: false, routeChanged: diff.routeChanged, bookChanged: diff.bookChanged });
                }
                // 4) 着地した写しをそのまま採用
                this.state = { ...fromSnapshot(snap), source: 'history' };
                this.seq = Math.max(this.seq, snap.seq | 0);
                return { landed: true, diff };
            },
            // 起動: URL と body から初期状態。再読込で段が残っていれば旧 _modalHistNormalizeOnBoot と同じ結果 (D06・本詳細は採用)
            boot() {
                const route = canonRoute(parse(L.hash));
                const view = D && D.body && D.body.classList && D.body.classList.contains('app-view-bookshelf') ? 'bookshelf' : 'main';
                this.state = { ...EMPTY, route, view, book: route.view === 'book' ? { asin: route.asin || null, edit: false } : null, source: 'boot' };
                const hs = H.state;
                const snapIn = hs && hs.nav;
                const depth = snapIn && snapIn.faces ? snapIn.faces.length : (hs && typeof hs.d === 'number' ? hs.d : 0);
                if (depth > 0) {
                    const top = snapIn && snapIn.faces ? snapIn.faces[snapIn.faces.length - 1] : (hs && hs.bsModal ? { id: hs.bsModal } : null);
                    if (top && top.id === 'book-detail' && route.view === 'book' && depth === 1) {
                        this.state = { ...this.state, faces: [{ id: 'book-detail', extra: null }] };
                        this.seq = (snapIn && snapIn.seq) | 0;
                        this._write('replace');
                        return { op: 'adopt' };
                    }
                    try { H.go(-depth); } catch (_) {}
                    return { op: 'go', n: -depth };
                }
                this._write('replace');
                return { op: 'replace' };
            },
            start(win) { (win || o.window || window).addEventListener('popstate', (ev) => { this.onPopstate(ev); }); return this; },
        };
        return nav;
    }

    const NavState = { EMPTY, reduce, project, canonRoute, formatRoute, install,
        OVERLAY_FACES, SHELF_SWITCH_WITH_BOOK, snapshot, historyState, fromSnapshot, reduce3, historyOp, screenDiff, createNav };
    window.NavState = NavState;
})();
