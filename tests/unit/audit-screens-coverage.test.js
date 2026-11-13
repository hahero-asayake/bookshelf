// @vitest-environment node
// 監査で巡回する画面の一覧 (tests/audit/screens.js) の網羅を確かめる (docs/audit/machine-checks.md §1-1)。
// S.define の全 ID と ui-standards §1 の表の全行が、一覧か「対象外（理由つき）」のどちらかに載っていること。
// 新しい面を足して一覧に載せ忘れると、ここで落ちる。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREENS, EXCLUDED } from '../audit/screens.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function definedSurfaceIds() {
    const src = readFileSync(join(ROOT, 'js/bookshelf.js'), 'utf-8');
    const start = src.indexOf('_defineSurfaces(S) {');
    const body = src.slice(start, src.indexOf('\n    _surface() {', start));
    const ids = new Set();
    for (const m of body.matchAll(/S\.define\('([^']+)'/g)) ids.add(m[1]);
    // 配列でまとめて登録している分: ['a', 'b', …].forEach((id) => S.define(id, …))
    for (const list of body.matchAll(/\[((?:\s*'[^']+'\s*,?)+)\]\.forEach\(\(id\) => S\.define\(id/g)) {
        for (const m of list[1].matchAll(/'([^']+)'/g)) ids.add(m[1]);
    }
    return [...ids];
}

function standardOpsRows() {
    const lines = readFileSync(join(ROOT, 'docs/ui-standards.md'), 'utf-8').split(/\r?\n/);
    const head = lines.findIndex((l) => l.startsWith('| 面 |'));
    const rows = [];
    for (let k = head + 2; k < lines.length && lines[k].startsWith('|'); k++) rows.push(lines[k].split('|')[1].trim());
    return rows;
}

const listedSurfaces = [...SCREENS, ...EXCLUDED].flatMap((s) => s.surfaces || []);
const listedRows = [...SCREENS, ...EXCLUDED].flatMap((s) => s.std1 || []);

describe('監査の画面の一覧の網羅', () => {
    it('S.define の全 ID が、一覧か対象外に載っている', () => {
        const defined = definedSurfaceIds();
        expect(defined.length).toBeGreaterThan(20);
        expect(defined.filter((id) => !listedSurfaces.includes(id))).toEqual([]);
    });

    it('一覧にある S.define の ID は、実際に登録されている (古い ID が残っていない)', () => {
        const defined = definedSurfaceIds();
        expect(listedSurfaces.filter((id) => !defined.includes(id))).toEqual([]);
    });

    it('ui-standards §1 の表の全行が、一覧か対象外に載っている', () => {
        const rows = standardOpsRows();
        expect(rows.length).toBeGreaterThan(20);
        expect(rows.filter((row) => !listedRows.some((label) => row.startsWith(label)))).toEqual([]);
    });

    it('一覧にある §1 の行の名前は、実際の表にある (古い名前が残っていない)', () => {
        const rows = standardOpsRows();
        expect(listedRows.filter((label) => !rows.some((row) => row.startsWith(label)))).toEqual([]);
    });

    it('画面IDは重複しない。対象外には理由がある', () => {
        const ids = SCREENS.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const x of EXCLUDED) expect(x.reason, x.name).toBeTruthy();
    });
});
