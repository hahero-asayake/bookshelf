// イシュー#365 step2: createNav (段階③の骨組み・履歴の唯一の書き手と popstate の唯一の聞き手) を偽の history/location で検証
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let N;
beforeAll(() => {
    const ctx = { window: {}, navigator: {}, localStorage: { getItem: () => null }, performance: { now: () => 0 }, document: null, console };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(readFileSync('js/nav-state.js', 'utf-8'), ctx);
    N = ctx.NavState;
});

const parse = (h) => {
    if (!h || h === '#' || h === '#/') return { view: 'main' };
    const s = h.replace(/^#/, '');
    let m = s.match(/^\/bookshelf\/([^/?#]+)/); if (m) return { view: 'bookshelf', slug: decodeURIComponent(m[1]) };
    m = s.match(/^book\/([^/?#]+)(\?(.*))?$/); if (m) { const q = new URLSearchParams(m[3] || ''); const r = { view: 'book', asin: m[1] }; if (q.get('from')) r.from = q.get('from'); return r; }
    return { view: 'main' };
};
function env(hash = '', state = null) {
    const H = { state, calls: [],
        pushState(s, _t, u) { this.calls.push(['push', s, u]); this.state = s; if (u) L.hash = u.includes('#') ? '#' + u.split('#')[1] : ''; },
        replaceState(s, _t, u) { this.calls.push(['replace', s, u]); this.state = s; if (u) L.hash = u.includes('#') ? '#' + u.split('#')[1] : ''; },
        go(n) { this.calls.push(['go', n]); }, back() { this.calls.push(['back']); } };
    const L = { pathname: '/index.html', search: '', hash };
    const D = { querySelector: () => null, body: { classList: { contains: () => false } } };
    return { H, L, D };
}
const last = (H) => H.calls[H.calls.length - 1];

describe('createNav: 書き手 (UI 入力 → 履歴)', () => {
    it('boot: 新しいセッションは現在のエントリに写しを replace で書く', () => {
        const { H, L, D } = env('#/bookshelf/all');
        const nav = N.createNav(null, { history: H, location: L, document: D, parse });
        expect(nav.boot()).toEqual({ op: 'replace' });
        expect(last(H)[0]).toBe('replace');
        expect(H.state.nav.route).toEqual({ view: 'bookshelf', slug: 'all' });
        expect(H.state.d).toBe(0); expect(H.state.bsModal).toBeNull();
    });
    it('面を開く: スマホは push (旧キー bsModal/d/extra も書く)・PC は履歴に触らない', () => {
        const { H, L, D } = env('');
        const nav = N.createNav(null, { history: H, location: L, document: D, parse });
        nav.boot(); H.calls.length = 0;
        const close = () => true;
        expect(nav.open('settings-modal', { cat: 'sync' }, close, { mobile: true }).op).toBe('push');
        expect(last(H)[0]).toBe('push'); expect(H.state.bsModal).toBe('settings-modal'); expect(H.state.d).toBe(1); expect(H.state.cat).toBe('sync');
        expect(H.state.nav.faces).toEqual([{ id: 'settings-modal', extra: { cat: 'sync' } }]);
        expect(nav.facesCompat[0].close).toBe(close);
        H.calls.length = 0;
        expect(nav.open('icon-picker-modal', null, close, { mobile: false })).toEqual({ op: 'none', skipped: 'pc' });
        expect(H.calls).toEqual([]);
    });
    it('× で閉じる (route 不変) は go(-1)。着地の popstate は写しが同じなので何もしない', async () => {
        const { H, L, D } = env('');
        const nav = N.createNav(null, { history: H, location: L, document: D, parse });
        nav.boot(); const baseState = H.state;
        nav.open('drawer', null, () => true, { mobile: true });
        H.calls.length = 0;
        expect(nav.close('drawer').op).toBe('go'); expect(last(H)).toEqual(['go', -1]);
        H.calls.length = 0;
        const r = await nav.onPopstate({ state: baseState });
        expect(r.landed).toBe(true); expect(r.diff.close).toEqual([]); expect(r.diff.open).toEqual([]);
        expect(H.calls).toEqual([]); expect(nav.state.faces).toEqual([]);
    });
    it('本を開く: push 1回で URL は #book/asin?from=・faces に book-detail。編集モードの切替は replace で写しを更新', () => {
        const { H, L, D } = env('#/bookshelf/all');
        const nav = N.createNav(null, { history: H, location: L, document: D, parse });
        nav.boot(); H.calls.length = 0;
        expect(nav.openBook('B01', false, 'all', { mobile: true, close: () => true }).op).toBe('push');
        expect(last(H)[2]).toBe('/index.html#book/B01?from=all'); expect(H.state.nav.faces.map((f) => f.id)).toEqual(['book-detail']);
        H.calls.length = 0;
        expect(nav.openBook('B01', true, 'all', { mobile: true }).op).toBe('replace');
        expect(H.state.nav.book).toEqual({ asin: 'B01', edit: true });
        H.calls.length = 0;
        expect(nav.closeBook({ view: 'bookshelf', slug: 'all' }).op).toBe('replace');
        expect(last(H)[2]).toBe('/index.html#/bookshelf/all'); expect(H.state.d).toBe(0); expect(nav.state.book).toBeNull();
    });
    it('ドロワーを開いたままホームへ: overlay を外して replace (深さ不変)', () => {
        const { H, L, D } = env('#/bookshelf/all');
        const nav = N.createNav(null, { history: H, location: L, document: D, parse });
        nav.boot(); nav.open('drawer', null, () => true, { mobile: true }); H.calls.length = 0;
        expect(nav.navigate({ view: 'main' }).op).toBe('replace');
        expect(last(H)[2]).toBe('/index.html'); expect(H.state.d).toBe(0); expect(nav.state.faces).toEqual([]);
    });
});

describe('createNav: 聞き手 (popstate → 着地した写しに合わせる)', () => {
    it('戻るで面を閉じる: closer が fromHistory で呼ばれ、写しをそのまま採用', async () => {
        const { H, L, D } = env('');
        const calls = [];
        const nav = N.createNav(null, { history: H, location: L, document: D, parse });
        nav.boot(); const base = H.state;
        nav.open('settings-modal', null, (o) => { calls.push(o); return true; }, { mobile: true });
        nav.open('settings-cat', { cat: 'x' }, (o) => { calls.push(o); return true; }, { mobile: true });
        H.calls.length = 0;
        const r = await nav.onPopstate({ state: base });
        expect(r.landed).toBe(true);
        expect(calls).toEqual([{ fromHistory: true }, { fromHistory: true }]);
        expect(nav.state.faces).toEqual([]); expect(H.calls).toEqual([]);
    });
    it('閉じるのを拒んだ (close が false) ら、今の写しを積み直して「まだ開いている」に揃える', async () => {
        const { H, L, D } = env('');
        const nav = N.createNav(null, { history: H, location: L, document: D, parse });
        nav.boot(); const base = H.state;
        nav.open('bookshelf-form-modal', { bsKey: 'k' }, () => false, { mobile: true });
        H.calls.length = 0;
        const r = await nav.onPopstate({ state: base });
        expect(r).toMatchObject({ landed: false, reason: 'close-refused', id: 'bookshelf-form-modal' });
        expect(last(H)[0]).toBe('push'); expect(H.state.nav.faces.map((f) => f.id)).toEqual(['bookshelf-form-modal']); expect(H.state.bsKey).toBe('k');
        expect(nav.state.faces.map((f) => f.id)).toEqual(['bookshelf-form-modal']);
    });
    it('進むで面を開き直す: reopen 表を extra 付きで呼ぶ。表に無い面は back()', async () => {
        const { H, L, D } = env('');
        const reopened = [];
        const nav = N.createNav(null, { history: H, location: L, document: D, parse, reopeners: { 'book-memo-modal': (extra) => { reopened.push(extra); } } });
        nav.boot();
        const snap = N.snapshot({ view: 'main', route: { view: 'main' }, book: null, faces: [{ id: 'book-memo-modal', extra: { asin: 'A' } }], source: 'ui' }, 5);
        const r = await nav.onPopstate({ state: N.historyState(snap) });
        expect(r.landed).toBe(true); expect(reopened).toEqual([{ asin: 'A' }]);
        expect(nav.state.faces).toEqual([{ id: 'book-memo-modal', extra: { asin: 'A' }, close: null }]); expect(nav.seq).toBe(5);
        const snap2 = N.snapshot({ view: 'main', route: { view: 'main' }, book: null, faces: [{ id: 'book-memo-modal', extra: { asin: 'A' } }, { id: 'unknown-face' }], source: 'ui' }, 6);
        H.calls.length = 0;
        const r2 = await nav.onPopstate({ state: N.historyState(snap2) });
        expect(r2).toMatchObject({ landed: false, reason: 'no-reopener' }); expect(last(H)).toEqual(['back']);
    });
    it('route/book が違えば onLanded(写し, {animate:false}) に画面を任せる。state 無し (アドレスバー編集) は hash から', async () => {
        const { H, L, D } = env('#/bookshelf/all');
        const landed = [];
        const nav = N.createNav(null, { history: H, location: L, document: D, parse, onLanded: (snap, m) => { landed.push([snap.route, m.animate]); } });
        nav.boot();
        L.hash = '#book/B02';
        const r = await nav.onPopstate({ state: null });
        expect(r.landed).toBe(true); expect(landed).toEqual([[{ view: 'book', asin: 'B02' }, false]]);
        expect(nav.state.route).toEqual({ view: 'book', asin: 'B02' }); expect(nav.state.book).toEqual({ asin: 'B02', edit: false });
    });
});

describe('createNav: boot と再読込 (D06 互換)', () => {
    it('再読込で段が残っていれば go(-段数)・本詳細1段+#book は採用', () => {
        const s1 = N.historyState(N.snapshot({ view: 'main', route: { view: 'main' }, book: null, faces: [{ id: 'drawer' }, { id: 'settings-modal' }], source: 'ui' }, 3));
        let e = env('', s1);
        let nav = N.createNav(null, { history: e.H, location: e.L, document: e.D, parse });
        expect(nav.boot()).toEqual({ op: 'go', n: -2 });
        const s2 = N.historyState(N.snapshot({ view: 'bookshelf', route: { view: 'book', asin: 'B01' }, book: { asin: 'B01', edit: true }, faces: [{ id: 'book-detail' }], source: 'ui' }, 4));
        e = env('#book/B01', s2);
        nav = N.createNav(null, { history: e.H, location: e.L, document: e.D, parse });
        expect(nav.boot()).toEqual({ op: 'adopt' });
        expect(nav.state.faces.map((f) => f.id)).toEqual(['book-detail']); expect(last(e.H)[0]).toBe('replace');
    });
    it('旧形式のエントリ (nav 無し・d あり) でも段を畳む', () => {
        const e = env('', { bsModal: 'settings-modal', d: 1 });
        const nav = N.createNav(null, { history: e.H, location: e.L, document: e.D, parse });
        expect(nav.boot()).toEqual({ op: 'go', n: -1 });
    });
});
