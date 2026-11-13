// lint:e2e-gate (scripts/check-e2e-gate.mjs・イシュー#583) 自身のテスト。
// 禁止物を入れた見本 spec(tests/unit/fixtures/e2e-gate/)がそれぞれ該当の規則で落ち、正しい見本が通ること。
// 見本は playwright の testDir(tests/e2e)と既存 lint の走査範囲(tests/e2e・tests/visual)の外に置いてある。
// 末尾の describe は、npm run lint:e2e-gate と同じ入口(node でスクリプトを起動)を通して終了コードを確かめる。
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitCodeFor, isAppRoute, lintGate, loadJobs, MAX_DEPTH } from '../../scripts/check-e2e-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures/e2e-gate');
const SCRIPT = join(here, '../../scripts/check-e2e-gate.mjs');
const JOBS = join(here, '../e2e/gate/jobs.json');

const lint = (...only) => lintGate({ e2eDir: FIX, helpersDir: join(FIX, 'helpers'), root: FIX, only });
const rules = (result) => result.violations.map((v) => v.rule);
const count = (result, rule) => rules(result).filter((r) => r === rule).length;

describe('観測点表 tests/e2e/gate/jobs.json', () => {
    const jobs = loadJobs(JOBS);
    it('J1〜J8 の 37点で、仕事ごとの点数が設計書 §2 と同じ', () => {
        expect(jobs.jobs.map((j) => j.id)).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8']);
        expect(jobs.jobs.map((j) => j.points.length)).toEqual([4, 6, 5, 3, 6, 5, 4, 4]);
        expect(jobs.ids).toHaveLength(37);
    });
    it('ID は重複が無く、仕事のIDと連番でできている', () => {
        expect(new Set(jobs.ids).size).toBe(37);
        for (const job of jobs.jobs) {
            expect(job.points.map((p) => p.id)).toEqual(job.points.map((_, i) => `${job.id}-${i + 1}`));
            for (const p of job.points) expect(p.desc.length).toBeGreaterThan(0);
        }
    });
});

describe('正しい見本', () => {
    const result = lint('good.spec.js');
    it('違反0件で通る', () => {
        expect(result.violations).toEqual([]);
        expect(result.ok).toBe(true);
    });
    it('@gate のテストだけを数え、観測点IDを拾う(門に数えないテストは対象外)', () => {
        expect(result.tests).toHaveLength(1);
        expect(result.tests[0].ids).toEqual(['J5-2']);
        expect(result.coverage['J5-2']).toHaveLength(1);
        expect(result.missing).toHaveLength(36);
        expect(result.missing).not.toContain('J5-2');
    });
});

describe('禁止物を入れた見本は該当の規則で落ちる', () => {
    it('操作・確認の区間の evaluate 系', () => {
        const result = lint('bad-evaluate.spec.js');
        expect(rules(result)).toEqual(['no-evaluate', 'no-evaluate']);
        expect(result.violations[0].message).toContain('操作の区間');
        expect(result.violations[1].message).toContain('確認の区間');
    });
    it('本体を辿ると内部に届く関数(helpers の推移的な呼び出し・spec 内の自作)', () => {
        const result = lint('bad-helper-internal.spec.js');
        expect(rules(result)).toEqual(['helper-internal', 'helper-internal', 'helper-internal', 'helper-internal']);
        const messages = result.violations.map((v) => v.message);
        expect(messages[0]).toContain('setBlocks → evaluate()');
        expect(messages[1]).toContain('addBlockAndCount → countBlocks → getDraft → evaluate()');
        expect(messages[2]).toContain('countBlocks → getDraft → evaluate()');
        expect(messages[3]).toContain('readTitle → evaluate()');
    });
    it('操作の区間の open*・show*・*Internal(中身がクリックだけでも名前で落とす)', () => {
        const result = lint('bad-helper-name.spec.js');
        expect(count(result, 'helper-name')).toBe(3);
        expect(count(result, 'helper-internal')).toBe(1);
        expect(result.violations.filter((v) => v.rule === 'helper-name').map((v) => /(\w+)\(\)/.exec(v.message)[1]))
            .toEqual(['openSettingsByClick', 'openEditorInternal', 'showList']);
    });
    it('前提の区間の直書き・自作関数、beforeEach の直書き', () => {
        const result = lint('bad-setup.spec.js');
        expect(new Set(rules(result))).toEqual(new Set(['setup-helpers-only']));
        const messages = result.violations.map((v) => v.message).join('\n');
        expect(messages).toContain('page.addInitScript()');
        expect(messages).toContain('bootApp()');
        expect(messages).toContain('test.beforeEach');
        expect(messages).not.toContain('seedLibraryForTest');
    });
    it('区間の外の文・知らない接頭辞・確認の区間が無い・確認に expect が無い', () => {
        const result = lint('bad-structure.spec.js');
        expect(rules(result).sort()).toEqual(['outside-step', 'step-missing', 'step-prefix', 'verify-no-expect']);
    });
    it('観測点IDが無い・表に無いID・静的でない名前・skip・describe やタグでの付け方', () => {
        const result = lint('bad-id.spec.js');
        expect(rules(result).sort()).toEqual(['describe-tag', 'id-missing', 'id-unknown', 'modifier', 'tag-option', 'title-static']);
    });
    it('前提のヘルパー経由でも、アプリ自身のファイルへの通信の差し替えは落とす(外部の模擬は通す)', () => {
        const result = lint('bad-app-route.spec.js');
        expect(rules(result)).toEqual(['no-app-route', 'no-app-route']);
        expect(result.violations[0].message).toContain('**/js/bookshelf.js');
        expect(result.violations[1].message).toContain('stubAllForTest → stubIndex');
    });
    it('辿る深さの上限を超えたら、確かめ切れないので落とす', () => {
        const result = lint('bad-deep.spec.js');
        expect(rules(result)).toEqual(['helper-depth']);
        expect(MAX_DEPTH).toBe(8);
    });
    it('循環するヘルパーでも止まる(正しい見本の pingA ⇄ pingB)', () => {
        expect(lint('good.spec.js').violations).toEqual([]);
    });
});

describe('アプリ自身のファイルかどうかの判定', () => {
    it('index.html・js/・css/・sw.js・全件一致はアプリ自身', () => {
        for (const p of ['**/index.html', '**/js/bookshelf.js', 'js/app.js', '**/css/**', '**/sw.js', '**/*', '**', '**/*.js', 'http://localhost:8000/js/x.js']) {
            expect(isAppRoute(p), p).toBe(true);
        }
    });
    it('外部の宛先・変数(判定できない)は対象外', () => {
        for (const p of ['https://hub.example.com/**', 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', '**/api.github.com/**', null]) {
            expect(isAppRoute(p), String(p)).toBe(false);
        }
    });
});

describe('網羅の未達の扱い', () => {
    it('既定は警告だけ(終了コード0)、--strict-coverage で失敗', () => {
        const result = lint('good.spec.js');
        expect(exitCodeFor(result)).toBe(0);
        expect(exitCodeFor(result, { strictCoverage: true })).toBe(1);
    });
    it('違反があれば --strict-coverage が無くても失敗', () => {
        expect(exitCodeFor(lint('bad-evaluate.spec.js'))).toBe(1);
    });
});

describe('入口(node scripts/check-e2e-gate.mjs)を通す', () => {
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, `--e2e-dir=${FIX}`, `--helpers-dir=${join(FIX, 'helpers')}`, ...args],
        { encoding: 'utf-8', env: { ...process.env, GITHUB_ACTIONS: '' } });
    it('正しい見本だけなら終了コード0で、未達を警告として出す', () => {
        const r = run('--only=good.spec.js');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('警告: 観測点の未達 36/37点');
        expect(r.stdout).toContain('OK: @gate 1本・違反0件・観測点の網羅 1/37');
    });
    it('GitHub Actions では未達を ::warning:: で出す', () => {
        const r = spawnSync(process.execPath, [SCRIPT, `--e2e-dir=${FIX}`, `--helpers-dir=${join(FIX, 'helpers')}`, '--only=good.spec.js'],
            { encoding: 'utf-8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('::warning title=lint:e2e-gate::観測点の未達 36/37点');
    });
    it('--strict-coverage を付けると未達で終了コード1', () => {
        expect(run('--only=good.spec.js', '--strict-coverage').status).toBe(1);
    });
    it('禁止物の見本が混ざると終了コード1で、場所と規則を出す', () => {
        const r = run();
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('bad-evaluate.spec.js:10: [no-evaluate]');
        expect(r.stderr).toContain('[helper-internal]');
    });
    it('--json で gate-report が読む結果を書き出す', () => {
        const out = join(mkdtempSync(join(tmpdir(), 'gate-lint-')), 'gate-lint.json');
        expect(run('--only=good.spec.js', `--json=${out}`).status).toBe(0);
        const json = JSON.parse(readFileSync(out, 'utf-8'));
        expect(json.jobsTotal).toBe(37);
        expect(json.tests.map((t) => t.ids)).toEqual([['J5-2']]);
        expect(json.missing).toHaveLength(36);
        expect(json.violations).toEqual([]);
    });
});
