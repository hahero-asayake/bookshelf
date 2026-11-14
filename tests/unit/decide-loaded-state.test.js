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
