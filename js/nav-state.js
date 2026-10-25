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

    window.NavState = { EMPTY, reduce, project, canonRoute, formatRoute, install };
})();
