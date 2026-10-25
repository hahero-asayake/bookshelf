// イシュー#365: NavState の純関数 (段階②の reduce・段階③の reduce3/historyOp/screenDiff/snapshot)
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

const st = (o = {}) => ({ view: 'main', route: { view: 'main' }, book: null, faces: [], source: 'ui', ...o });

describe('reduce (段階②)', () => {
    it('open は二重に積まない・close は最初の1件だけ外す', () => {
        let s = N.reduce(st(), { type: 'open', id: 'drawer' });
        s = N.reduce(s, { type: 'open', id: 'drawer' });
        expect(s.faces.map((f) => f.id)).toEqual(['drawer']);
        s = N.reduce(s, { type: 'close', id: 'drawer' });
        expect(s.faces).toEqual([]);
    });
    it('view main は本詳細のピン留めも外す (旧 _setBodyView と同じ)', () => {
        const s = N.reduce(st({ book: { asin: 'A', edit: false } }), { type: 'view', view: 'main' });
        expect(s.book).toBeNull();
    });
});

describe('reduce3 / historyOp (段階③)', () => {
    it('本を開く: スマホは book-detail を末尾へ・履歴は push 1回', () => {
        const prev = st({ view: 'bookshelf', route: { view: 'bookshelf', slug: 'all' } });
        const next = N.reduce3(prev, { type: 'openBook3', asin: 'A', edit: false, from: 'all', mobile: true });
        expect(next.route).toEqual({ view: 'book', asin: 'A', from: 'all' });
        expect(next.faces.map((f) => f.id)).toEqual(['book-detail']);
        expect(N.historyOp(prev, next, { source: 'ui' })).toEqual({ op: 'push' });
    });
    it('別の本へ連続遷移: 段数は1冊分のまま・push', () => {
        const prev = st({ book: { asin: 'A', edit: false }, route: { view: 'book', asin: 'A' }, faces: [{ id: 'book-detail' }] });
        const next = N.reduce3(prev, { type: 'openBook3', asin: 'B', mobile: true });
        expect(next.faces.map((f) => f.id)).toEqual(['book-detail']);
        expect(N.historyOp(prev, next, { source: 'ui' })).toEqual({ op: 'push' });
    });
    it('× で面を閉じる (route 不変) は go(-1)', () => {
        const prev = st({ faces: [{ id: 'settings-modal' }] });
        const next = N.reduce3(prev, { type: 'close', id: 'settings-modal' });
        expect(N.historyOp(prev, next, { source: 'ui' })).toEqual({ op: 'go', n: -1 });
    });
    it('ドロワーを開いたままホームへ: overlay を外し replace (深さ不変=戻る1回で元へ・①-0 と同じ)', () => {
        const prev = st({ view: 'bookshelf', route: { view: 'bookshelf', slug: 'all' }, faces: [{ id: 'drawer' }] });
        const next = N.reduce3(prev, { type: 'navigate', route: { view: 'main' } });
        expect(next.faces).toEqual([]);
        expect(N.historyOp(prev, next, { source: 'ui' })).toEqual({ op: 'replace' });
    });
    it('本棚切替 (C): route は本棚・book はそのまま・push', () => {
        const prev = st({ view: 'bookshelf', book: { asin: 'A', edit: true }, route: { view: 'book', asin: 'A', from: 's1' } });
        const next = N.reduce3(prev, { type: 'navigate', route: { view: 'bookshelf', slug: 'novel' }, shelfInternalId: 's2' });
        expect(next.route).toEqual({ view: 'bookshelf', slug: 'novel' });
        expect(next.book).toEqual({ asin: 'A', edit: true });
        expect(N.historyOp(prev, next, { source: 'ui' })).toEqual({ op: 'push' });
    });
    it('本棚切替 A/B は定数1つで切り替わる', () => {
        const prev = st({ view: 'bookshelf', book: { asin: 'A', edit: false }, route: { view: 'book', asin: 'A', from: 's1' }, faces: [{ id: 'book-detail' }] });
        N.SHELF_SWITCH_WITH_BOOK = 'A';
        let next = N.reduce3(prev, { type: 'navigate', route: { view: 'bookshelf', slug: 'novel' }, shelfInternalId: 's2' });
        expect(next.book).toBeNull(); expect(next.faces).toEqual([]);
        N.SHELF_SWITCH_WITH_BOOK = 'B';
        next = N.reduce3(prev, { type: 'navigate', route: { view: 'bookshelf', slug: 'novel' }, shelfInternalId: 's2' });
        expect(next.route).toEqual({ view: 'book', asin: 'A', from: 's2' }); expect(next.book).toEqual({ asin: 'A', edit: false });
        N.SHELF_SWITCH_WITH_BOOK = 'C';
    });
    it('× で本を閉じる: replace (旧 closeModal と同じ深さ)', () => {
        const prev = st({ view: 'bookshelf', book: { asin: 'A', edit: false }, route: { view: 'book', asin: 'A', from: 's1' }, faces: [{ id: 'book-detail' }] });
        const next = N.reduce3(prev, { type: 'closeBook3', route: { view: 'bookshelf', slug: 'all' } });
        expect(next.book).toBeNull(); expect(next.faces).toEqual([]);
        expect(N.historyOp(prev, next, { source: 'ui', replace: true })).toEqual({ op: 'replace' });
    });
    it('履歴由来の入力は履歴を書かない', () => {
        const prev = st({ faces: [{ id: 'drawer' }] });
        const next = N.reduce3(prev, { type: 'close', id: 'drawer', source: 'history' });
        expect(N.historyOp(prev, next, { source: 'history' })).toEqual({ op: 'none' });
    });
});

describe('snapshot / historyState / screenDiff', () => {
    it('スナップショットは close 関数を含まず、旧キー (bsModal/d/extra) も書く', () => {
        const s = st({ book: { asin: 'A', edit: true }, route: { view: 'book', asin: 'A' }, faces: [{ id: 'book-detail', close: () => {} }, { id: 'book-memo-modal', extra: { asin: 'A' }, close: () => {} }] });
        const snap = N.snapshot(s, 7);
        expect(snap.faces).toEqual([{ id: 'book-detail', extra: null }, { id: 'book-memo-modal', extra: { asin: 'A' } }]);
        expect(snap.book).toEqual({ asin: 'A', edit: true });
        const hs = N.historyState(snap);
        expect(hs.bsModal).toBe('book-memo-modal'); expect(hs.d).toBe(2); expect(hs.asin).toBe('A'); expect(hs.nav.seq).toBe(7);
    });
    it('着地の差分: 閉じる面は末尾から・開き直す面・アニメ無し', () => {
        const cur = st({ faces: [{ id: 'settings-modal' }, { id: 'settings-cat' }, { id: 'icon-picker-modal' }] });
        const snap = N.snapshot(st({ faces: [{ id: 'settings-modal' }, { id: 'drawer' }] }), 1);
        const d = N.screenDiff(cur, snap);
        expect(d.close.map((f) => f.id)).toEqual(['icon-picker-modal', 'settings-cat']);
        expect(d.open.map((f) => f.id)).toEqual(['drawer']);
        expect(d.animate).toBe(false);
        expect(d.routeChanged).toBe(false);
    });
    it('fromSnapshot は closers から close を引く', () => {
        const snap = N.snapshot(st({ faces: [{ id: 'drawer' }] }), 2);
        const closeDrawer = () => true;
        const s = N.fromSnapshot(snap, { drawer: closeDrawer });
        expect(s.faces[0].close).toBe(closeDrawer); expect(s.source).toBe('history');
    });
});
