// e2e-diff-main.mjs の流し直しの「経路を通すテスト」(イシュー#510)。
// 実際に playwright CLI を spawn し、tests/fixtures/e2e-diff/ の特殊文字入りテスト名に対して
// file:line + --project 指定が正しく1件(ループ行は2件)だけに当たること、存在しない行を
// 指定すると実行0件になり findMatchOutcome が null → classifyVerdict が 'undetermined'
// (regressionにしない)ことを確認する。
// フィクスチャのテストは page 等のブラウザfixtureを使わないため、ブラウザ起動は発生しない
// (CIのvitestジョブにブラウザが無くても通る・②承認note)。spawnにはタイムアウト(60秒)を付ける。
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyVerdict, findMatchOutcome, parsePlaywrightJson } from '../../scripts/verify/e2e-diff-lib.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE_CONFIG = 'tests/fixtures/e2e-diff/playwright.config.js';
const FIXTURE_SPEC = 'special-names.spec.js'; // testDir='.'(=tests/fixtures/e2e-diff/)相対
const SPAWN_TIMEOUT_MS = 60_000;

// e2e-diff-main.mjsのfindNodeModulesRoot相当(worktree分離でnode_modulesがsymlink経由の場合に対応)。
function resolvePlaywrightBin(startDir) {
    let dir = startDir;
    for (;;) {
        const cand = join(dir, 'node_modules', '.bin', 'playwright');
        if (existsSync(cand)) return cand;
        const parent = dirname(dir);
        if (parent === dir) throw new Error(`playwright実行体が見つからない(探索開始: ${startDir})`);
        dir = parent;
    }
}
const PW_BIN = resolvePlaywrightBin(REPO_ROOT);

function runPlaywright(extraArgs, outFile) {
    return spawnSync(
        process.execPath,
        [PW_BIN, 'test', `--config=${FIXTURE_CONFIG}`, '--reporter=json', ...extraArgs],
        {
            cwd: REPO_ROOT,
            encoding: 'utf-8',
            timeout: SPAWN_TIMEOUT_MS,
            env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: outFile },
        },
    );
}

describe('e2e-diff-main: file:line + --project の流し直しが経路を通して正しく絞れる(#510)', () => {
    let outDir;
    let allTests;

    beforeAll(() => {
        outDir = mkdtempSync(join(tmpdir(), 'e2e-diff-510-'));
        const listOut = join(outDir, 'all.json');
        const r = runPlaywright([FIXTURE_SPEC], listOut);
        if (r.status !== 0) {
            throw new Error(`フィクスチャ全件実行に失敗(status=${r.status}):\n${r.stdout}\n${r.stderr}`);
        }
        allTests = parsePlaywrightJson(listOut);
        if (allTests.size !== 8) {
            throw new Error(`フィクスチャの前提が崩れている(8件のはずが${allTests.size}件)`);
        }
    }, SPAWN_TIMEOUT_MS);

    afterAll(() => {
        if (outDir) rmSync(outDir, { recursive: true, force: true });
    });

    function findByTitleSubstr(substr) {
        const hit = [...allTests.values()].find((t) => t.title.includes(substr));
        if (!hit) throw new Error(`フィクスチャに「${substr}」を含むテストが見つからない`);
        return hit;
    }

    const SINGLE_CASES = [
        ['括弧()', '括弧を含む'],
        ['角括弧[]', '角括弧'],
        ['パイプ|', 'パイプ'],
        ['ドット.とアスタリスク*', 'ドット.とアスタリスク'],
        ['クエスチョン?とプラス+', 'クエスチョン'],
        ['ドル$とキャレット^', 'ドル$とキャレット'],
    ];

    for (const [label, titleSubstr] of SINGLE_CASES) {
        it(`${label} を含むテスト名は file:line で1件だけ実行される`, () => {
            const target = findByTitleSubstr(titleSubstr);
            const outFile = join(outDir, `single-${label.replace(/[^\w]/g, '_')}.json`);
            const r = runPlaywright([`${FIXTURE_SPEC}:${target.line}`, '--project=chromium'], outFile);
            expect(r.status).toBe(0);
            const tests = parsePlaywrightJson(outFile);
            expect(tests.size).toBe(1);
            const [only] = [...tests.values()];
            expect(only.title).toBe(target.title);
            expect(only.failed).toBe(false);
        }, SPAWN_TIMEOUT_MS);
    }

    it('同じ行のループ(test.each相当)は想定件数(2件)が実行される', () => {
        const target = findByTitleSubstr('ループ行');
        const sameLineCount = [...allTests.values()].filter((t) => t.line === target.line).length;
        expect(sameLineCount).toBe(2); // フィクスチャの前提(LOOP_LABELS 2件)の確認
        const outFile = join(outDir, 'loop-line.json');
        const r = runPlaywright([`${FIXTURE_SPEC}:${target.line}`, '--project=chromium'], outFile);
        expect(r.status).toBe(0);
        const tests = parsePlaywrightJson(outFile);
        expect(tests.size).toBe(2);
    }, SPAWN_TIMEOUT_MS);

    it('存在しない行を指定すると実行0件→No tests found(exit!=0)だが、JSON解析は0件のMapになる', () => {
        const outFile = join(outDir, 'no-match.json');
        const r = runPlaywright([`${FIXTURE_SPEC}:99999`, '--project=chromium'], outFile);
        expect(r.status).not.toBe(0); // 元バグの再現条件そのもの(#509のreimport-diffもここでexit!=0だった)
        const tests = parsePlaywrightJson(outFile);
        expect(tests.size).toBe(0);
    }, SPAWN_TIMEOUT_MS);

    it('実行0件の結果を findMatchOutcome に渡すと null(判定不能)になり、3回nullでも classifyVerdict は undetermined(regressionではない)', () => {
        const outFile = join(outDir, 'no-match-2.json');
        runPlaywright([`${FIXTURE_SPEC}:99999`, '--project=chromium'], outFile);
        const tests = parsePlaywrightJson(outFile);
        const target = findByTitleSubstr('括弧を含む');
        const item = { work: { title: target.title, project: 'chromium' } };
        const outcome = findMatchOutcome(tests, item);
        expect(outcome).toBeNull();
        expect(classifyVerdict([outcome, outcome, outcome])).toBe('undetermined');
    }, SPAWN_TIMEOUT_MS);
});
