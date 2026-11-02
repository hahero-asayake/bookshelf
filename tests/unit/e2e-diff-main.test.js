// e2e-diff-main.mjs の流し直し判定ロジック(イシュー#510)。
// 元の症状: テスト名をそのまま --grep に渡していたため、タイトルの連結形式の不一致で
// 「No tests found」になり、流し直し3回とも「失敗」と記録されて regression と誤判定していた。
// このテストは副作用の無い純粋ロジック(scripts/verify/e2e-diff-lib.mjs)だけを対象にする。
// 実際に playwright CLI を spawn して file:line 指定が1件に当たることの確認は
// tests/unit/e2e-diff-main-fixture.test.js(経路を通すテスト)でやる。
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
    categorize, classifyVerdict, countRegressions, countUndetermined, escapeRegExp,
    findMatchOutcome, groupE2ERetryTargetsByProject, buildVitestRetryArgs, verdictLabel,
} from '../../scripts/verify/e2e-diff-lib.mjs';

describe('classifyVerdict (#510)', () => {
    it('全回null(実行0件)なら判定不能・regressionではない', () => {
        expect(classifyVerdict([null, null, null])).toBe('undetermined');
    });
    it('1回だけ実行され失敗・残りnullなら regression(実行された回を基準に判定する)', () => {
        expect(classifyVerdict([false, null, null])).toBe('regression');
    });
    it('null/false/true が混在し1回でも通過していれば flake', () => {
        expect(classifyVerdict([null, false, true])).toBe('flake');
        expect(classifyVerdict([true, null, null])).toBe('flake');
    });
    it('実行された回が全部失敗なら regression', () => {
        expect(classifyVerdict([false, false, false])).toBe('regression');
    });
    it('全回通過なら flake(全回で再現しない=実質flake扱い)', () => {
        expect(classifyVerdict([true, true, true])).toBe('flake');
    });
});

describe('countRegressions / countUndetermined (#510)', () => {
    function resultsWith(newlyFailed) {
        return { e2e: { newlyFailed, newlyPassed: [], bothFailed: [] }, unit: null };
    }
    it('verdict=undetermined は regression に数えない', () => {
        const results = resultsWith([
            { key: 'a', work: { title: 't1' }, verdict: 'undetermined' },
            { key: 'b', work: { title: 't2' }, verdict: 'regression' },
        ]);
        expect(countRegressions(results)).toBe(1);
        expect(countUndetermined(results)).toBe(1);
    });
    it('verdict未設定(流し直し自体が無かった)は従来どおりregression扱い', () => {
        const results = resultsWith([{ key: 'a', work: { title: 't1' } }]);
        expect(countRegressions(results)).toBe(1);
        expect(countUndetermined(results)).toBe(0);
    });
    it('flakeはどちらにも数えない', () => {
        const results = resultsWith([{ key: 'a', work: { title: 't1' }, verdict: 'flake' }]);
        expect(countRegressions(results)).toBe(0);
        expect(countUndetermined(results)).toBe(0);
    });
});

describe('findMatchOutcome (#510)', () => {
    const item = { work: { title: '括弧(かっこ)を含む (#406)', project: 'chromium' } };
    it('title+projectが一致し失敗していればfalse', () => {
        const tests = new Map([['k', { title: item.work.title, project: 'chromium', failed: true }]]);
        expect(findMatchOutcome(tests, item)).toBe(false);
    });
    it('title+projectが一致し通過していればtrue', () => {
        const tests = new Map([['k', { title: item.work.title, project: 'chromium', failed: false }]]);
        expect(findMatchOutcome(tests, item)).toBe(true);
    });
    it('結果に見つからない(No tests found相当・実行件数0)場合はnull(false にしない=#510の本題)', () => {
        expect(findMatchOutcome(new Map(), item)).toBeNull();
    });
    it('titleは一致してもprojectが違えばnull', () => {
        const tests = new Map([['k', { title: item.work.title, project: 'webkit', failed: true }]]);
        expect(findMatchOutcome(tests, item)).toBeNull();
    });
    it('matchProject:false(vitest/unit)ならproject不問でtitleのみ照合', () => {
        const unitItem = { work: { title: 'unitのテスト名', project: undefined } };
        const tests = new Map([['k', { title: 'unitのテスト名', project: undefined, failed: false }]]);
        expect(findMatchOutcome(tests, unitItem, { matchProject: false })).toBe(true);
    });
});

describe('groupE2ERetryTargetsByProject (#510)', () => {
    it('file:lineをprojectごとにグルーピングし重複を除く', () => {
        const items = [
            { work: { file: 'a.spec.js', line: 10, project: 'chromium' } },
            { work: { file: 'a.spec.js', line: 10, project: 'chromium' } }, // 同じ行の別テスト(重複)
            { work: { file: 'a.spec.js', line: 20, project: 'chromium' } },
            { work: { file: 'b.spec.js', line: 5, project: 'webkit' } },
        ];
        const grouped = groupE2ERetryTargetsByProject(items);
        expect([...grouped.get('chromium')].sort()).toEqual(['a.spec.js:10', 'a.spec.js:20']);
        expect([...grouped.get('webkit')]).toEqual(['b.spec.js:5']);
    });
    it('line/project/fileが無いitemは読み飛ばす(最終的に未実行=判定不能になる)', () => {
        const items = [{ work: { file: 'a.spec.js', project: 'chromium' } }]; // line無し
        const grouped = groupE2ERetryTargetsByProject(items);
        expect(grouped.size).toBe(0);
    });
});

describe('buildVitestRetryArgs (#510)', () => {
    it('タイトルを正規表現エスケープして|で結合する', () => {
        const items = [
            { key: 'unit::x.test.js::a(#1)', work: { title: 'a(#1)' } },
            { key: 'unit::x.test.js::b[2]', work: { title: 'b[2]' } },
        ];
        const { files, pattern } = buildVitestRetryArgs(items);
        expect(files).toEqual(['x.test.js']);
        expect(pattern).toBe(`${escapeRegExp('a(#1)')}|${escapeRegExp('b[2]')}`);
        // 括弧・角括弧がメタ文字として解釈されない形でエスケープされていること
        expect(pattern).toBe('a\\(#1\\)|b\\[2\\]');
    });
});

describe('verdictLabel (#510)', () => {
    it('undeterminedは「判定不能」と分かる日本語になる', () => {
        expect(verdictLabel('undetermined')).toContain('判定不能');
    });
    it('verdict無し(流し直し自体が無かった)は未判定表示', () => {
        expect(verdictLabel(undefined)).toContain('未判定');
    });
    it('flake/regressionはそのまま', () => {
        expect(verdictLabel('flake')).toBe('flake');
        expect(verdictLabel('regression')).toBe('regression');
    });
});

describe('categorize (経路確認・既存ロジックの回帰防止)', () => {
    it('workだけ失敗なら newlyFailed に入る', () => {
        const base = new Map([['k', { title: 't', failed: false }]]);
        const work = new Map([['k', { title: 't', failed: true }]]);
        const { newlyFailed, newlyPassed, bothFailed } = categorize(base, work);
        expect(newlyFailed).toHaveLength(1);
        expect(newlyPassed).toHaveLength(0);
        expect(bothFailed).toHaveLength(0);
    });
});
