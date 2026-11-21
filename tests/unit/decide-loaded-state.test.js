// イシュー#656: 読込の決め方 (_decideLoadedState) が、自分の書きかけを「他の端末の更新」と見誤らないこと。
// ローカルの保存は1ファイルずつ書き、library.json が先・版の印 (sync-stamp.json) が最後。保存が途中で切れた時の
// 保存先の形は (exportDate, 版の印) = (前,前)・(新,前)・(新,新) の3つ。どれも自分の書きかけなので 'local'。
// 他の端末が書いた形 (版の印が変わる) は 'local' にしない。
// VirtualBookshelf の class は window に出ておらず import では取り出せないので、js/bookshelf.js から
// 2つのメソッド (_sameSyncVersion・_decideLoadedState) の本文を切り出し、最小の stub に付けて呼ぶ。
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** class の中のメソッドの本文 (4字下げの「name(」の行から、次の4字下げの「}」の行まで) */
function methodSource(src, name) {
    const lines = src.split(/\r?\n/);
    const start = lines.findIndex((l) => l.startsWith(`    ${name}(`));
    if (start < 0) throw new Error(`${name} が js/bookshelf.js に見つからない`);
    const end = lines.findIndex((l, i) => i > start && l === '    }');
    if (end < 0) throw new Error(`${name} の終わりが見つからない`);
    return lines.slice(start, end + 1).join('\n');
}

const OLD = { exportDate: '2026-11-14T08:00:00.000Z', stamp: '2026-11-14T08:00:00.001Z-old' };
const NEW = { exportDate: '2026-11-14T08:00:05.000Z', stamp: '2026-11-14T08:00:05.001Z-new' };
const OTHER = { exportDate: '2026-11-14T08:00:09.000Z', stamp: '2026-11-14T08:00:09.001Z-other' };

let App;
beforeAll(() => {
    // vitest はリポジトリ直下で動く (jsdom では import.meta.url が file: でない)
    const src = fs.readFileSync(path.resolve(process.cwd(), 'js/bookshelf.js'), 'utf8');
    const body = ['_sameSyncVersion', '_decideLoadedState'].map((n) => methodSource(src, n)).join('\n');
    const SyncConfigManager = { conflict: () => false };
    App = new Function('SyncConfigManager', `return class { ${body} }`)(SyncConfigManager);
});

/** 未反映の印あり・控え (前の版) と書きかけ (新しい版) がある端末で、保存先が remote の版だった時の決め方 */
function decide(remote) {
    const app = new App();
    app.userData = { notes: {}, bookshelves: [], settings: {} };
    app.books = [{ asin: 'B0MEMO5941', title: '題名を変えた本' }];
    app._readSyncBase = () => ({ target: 'local:test', exportDate: OLD.exportDate, stamp: OLD.stamp, writing: { ...NEW } });
    return app._decideLoadedState({
        library: { exportDate: remote.exportDate, books: [{ asin: 'B0MEMO5941', title: '題名を変えた本' }] },
        syncStamp: remote.stamp
    });
}

describe('_decideLoadedState: 自分の書きかけが途中で切れた形 (イシュー#656)', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('virtualBookshelf_pendingSync', '1');
    });

    it('(新,前) library.json の後・版の印の前に切れた形は、自分の書きかけ = local', () => {
        expect(decide({ exportDate: NEW.exportDate, stamp: OLD.stamp })).toBe('local');
    });

    it('(新,新) 最後まで書けた形は local', () => {
        expect(decide({ exportDate: NEW.exportDate, stamp: NEW.stamp })).toBe('local');
    });

    it('(前,前) 何も書けなかった形は local', () => {
        expect(decide({ exportDate: OLD.exportDate, stamp: OLD.stamp })).toBe('local');
    });

    it('他の端末が書いた形 (exportDate も版の印も変わった) は local にしない', () => {
        expect(decide({ exportDate: OTHER.exportDate, stamp: OTHER.stamp })).toBe('ask');
    });

    it('exportDate は自分の書きかけのままでも、版の印が他の端末の印に変わっていれば local にしない', () => {
        // 他の端末が本の一覧を変えずに保存した時は exportDate が進まず、版の印だけが変わる
        expect(decide({ exportDate: NEW.exportDate, stamp: OTHER.stamp })).toBe('ask');
    });
});

// イシュー#701 (テスト監査 #690 の1番): 版の控え (sync base) が無い時＝この端末がまだ保存先と揃えたことが無い時の決め方。
// 決まり (#602): 手元のデータを黙って捨てない。保存先が空なら手元を採る。両方にデータがあり、手元に未反映の印があれば聞く (ask)。
// 未反映の印が無ければ保存先を採る。手元に「データがある」とは、本・自作の本棚 (「すべての本」以外)・短文メモのどれかがあること。
// #690 では、「手元に本があるか」「自作の本棚があるか」の判定を書き換えても、単体テスト5本は落ちなかった。
describe('_decideLoadedState: 版の控えが無い時 (初めての読込・イシュー#602・#701)', () => {
    const ALL = { id: 'all', slug: 'all', isSpecial: true };
    const MINE = { id: 'mine', slug: 'mine', name: '自作の本棚', isSpecial: false };
    const BOOK = { asin: 'B0TEST0001', title: '本' };

    function decideNoBase({ books = [], shelves = [ALL], notes = {}, remoteBooks = [], remoteShelves = [{ slug: 'all' }], remoteNotes = {}, pending = false }) {
        localStorage.clear();
        if (pending) localStorage.setItem('virtualBookshelf_pendingSync', '1');
        const app = new App();
        app.userData = { notes, bookshelves: shelves, settings: {} };
        app.books = books;
        app._readSyncBase = () => null;
        return app._decideLoadedState({
            library: { exportDate: '2026-11-14T08:00:00.000Z', books: remoteBooks },
            bookshelvesMeta: { bookshelves: remoteShelves },
            notes: remoteNotes,
            syncStamp: null
        });
    }

    it('手元に本があり、保存先が空 → 手元を採る (local)', () => {
        expect(decideNoBase({ books: [BOOK] })).toBe('local');
        expect(decideNoBase({ books: [BOOK], pending: true })).toBe('local');
    });

    it('手元が空で、保存先も空 → 保存先を採る (remote)', () => {
        expect(decideNoBase({})).toBe('remote');
        expect(decideNoBase({ pending: true })).toBe('remote');
    });

    it('手元が空で、保存先にデータ → 未反映の印があっても保存先を採る (remote)', () => {
        expect(decideNoBase({ remoteBooks: [BOOK] })).toBe('remote');
        expect(decideNoBase({ remoteBooks: [BOOK], pending: true })).toBe('remote');
    });

    it('手元は自作の本棚だけ (本0冊)、保存先が空 → 手元を採る (local)。「すべての本」だけなら手元は空とみなす', () => {
        expect(decideNoBase({ shelves: [ALL, MINE] })).toBe('local');
        expect(decideNoBase({ shelves: [MINE, ALL] })).toBe('local');
        expect(decideNoBase({ shelves: [ALL] })).toBe('remote');
    });

    it('手元は短文メモだけ、保存先が空 → 手元を採る (local)', () => {
        expect(decideNoBase({ notes: { B0TEST0001: { memo: 'メモ' } } })).toBe('local');
    });

    it('両方にデータがあり、手元に未反映の印がある → 聞く (ask)。印が無ければ保存先を採る (remote)', () => {
        expect(decideNoBase({ books: [BOOK], remoteBooks: [BOOK], pending: true })).toBe('ask');
        expect(decideNoBase({ books: [BOOK], remoteBooks: [BOOK], pending: false })).toBe('remote');
        expect(decideNoBase({ shelves: [ALL, MINE], remoteShelves: [{ slug: 'all' }, { slug: 'other' }], pending: true })).toBe('ask');
        expect(decideNoBase({ books: [BOOK], remoteNotes: { B0X: { memo: 'm' } }, pending: true })).toBe('ask');
    });
});
