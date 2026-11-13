// 合否の集計 scripts/gate-report.mjs (イシュー#583) のテスト。
// 設計書 §6 の8条件を、見本の入力から「合格／不合格／未実施」に判定できること。
// 末尾の describe は、npm run gate:report と同じ入口(node でスクリプトを起動)を通して終了コードと表を確かめる。
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    AUTO_CHECKS, collectChecks, evaluateGate, FAIL, NONE, parseHumanRecords, PASS, readInputs, renderMarkdown,
    REQUIRED_AUDIT, REQUIRED_PROD
} from '../../scripts/gate-report.mjs';
import { loadJobs } from '../../scripts/check-e2e-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '../../scripts/gate-report.mjs');
const IDS = loadJobs(join(here, '../e2e/gate/jobs.json')).ids;

// ---- 見本の入力 ----
const gateTest = (id) => ({ file: `tests/e2e/gate/${id}.spec.js`, line: 5, title: `@gate ${id} 見本`, ids: [id] });
const lintJson = (ids) => ({
    ok: true, jobsTotal: IDS.length, tests: ids.map(gateTest), violations: [],
    coverage: Object.fromEntries(IDS.map((id) => [id, ids.includes(id) ? [gateTest(id)] : []])),
    missing: IDS.filter((id) => !ids.includes(id))
});
// Playwright の JSON。statuses の数だけ流した(--repeat-each)ことにする
const pwReport = (specs) => ({
    suites: specs.map(({ file, title, statuses }) => ({
        title: file, file, specs: [{ title, file, tests: statuses.map((status) => ({ projectName: 'chromium', status })) }]
    }))
});
const gateRuns = (ids, statuses = ['expected', 'expected', 'expected']) =>
    pwReport(ids.map((id) => ({ file: `gate/${id}.spec.js`, title: `@gate ${id} 見本`, statuses })));
const HUMAN_HEADS = ['H1 iPhone Safari（20分）', 'H2 Android Chrome（20分）', 'H3 PC Edge（15分）', 'H4 iPad または PC（15分）'];
const humanMd = (record, heads = HUMAN_HEADS) => ['# 公開前最終テスト 人の手順書', ...heads.flatMap((h) => [
    '', `## ${h}`, '', '| # | 操作 | 期待する結果 | 記録 |', '|---|---|---|---|',
    `| 1 | 本番URLを開く | 本棚が見える | ${record} |`, `| 2 | アプリを閉じる | 消える | ${record} |`
])].join('\n');
const passing = () => ({
    issues: { issues: [{ id: 'P-1', severity: '高', status: '直した', title: '直した問題' }, { id: 'P-2', severity: '低', status: '未対応', title: '既知の問題' }] },
    auditList: { items: [{ id: 'A-1', severity: '中', status: '直した' }, { id: 'A-2', severity: '低', status: '承認' }] },
    gateLint: lintJson(IDS),
    gateE2e: [gateRuns(IDS)],
    e2e: [pwReport([{ file: 'smoke.spec.js', title: '起動する', statuses: ['expected'] }])],
    visual: [pwReport([{ file: 'home.spec.js', title: 'ホーム', statuses: ['expected'] }])],
    vitest: { success: true, numPassedTests: 900, numFailedTests: 0 },
    checks: { checks: [...AUTO_CHECKS.map((name) => ({ name, group: 'auto', exitCode: 0 })), { name: 'lint:copy', group: 'audit', exitCode: 0 }] },
    prod: { checks: REQUIRED_PROD.map((name) => ({ name, ok: true })) },
    audit: { checks: REQUIRED_AUDIT.filter((name) => name !== 'lint:copy').map((name) => ({ name, detected: 0 })) },
    human: { text: humanMd('OK') }
});
const verdicts = (report) => report.conditions.map((c) => c.verdict);
const cond = (inputs, n) => evaluateGate(inputs).conditions[n - 1];

describe('総合の合否', () => {
    it('入力が全部無い → 8条件とも「未実施」で、総合は不合格', () => {
        const report = evaluateGate({});
        expect(verdicts(report)).toEqual(Array(8).fill(NONE));
        expect(report.overall).toBe(FAIL);
        expect(report.counts).toEqual({ [PASS]: 0, [FAIL]: 0, [NONE]: 8 });
    });
    it('全部そろう → 8条件とも合格で、総合も合格', () => {
        const report = evaluateGate(passing());
        expect(verdicts(report)).toEqual(Array(8).fill(PASS));
        expect(report.overall).toBe(PASS);
    });
});

describe('条件1・6: 重さ(致命0・高0・中0。2026-11-14 ハヘロ決裁)', () => {
    const withIssue = (issue) => { const p = passing(); p.issues.issues.push(issue); return p; };
    it('中が1件残っている → 条件6が不合格で、総合も不合格(条件1は合格のまま)', () => {
        const report = evaluateGate(withIssue({ id: 'P-3', severity: '中', status: '未対応', title: '回避できる誤動作' }));
        expect(report.conditions[5].verdict).toBe(FAIL);
        expect(report.conditions[5].gaps).toEqual(['中: P-3']);
        expect(report.conditions[0].verdict).toBe(PASS);
        expect(report.overall).toBe(FAIL);
    });
    it('致命・高が残っている → 条件1が不合格', () => {
        expect(cond(withIssue({ id: 'P-4', severity: '致命', status: '未対応' }), 1).verdict).toBe(FAIL);
        expect(cond(withIssue({ id: 'P-5', severity: '高', status: '未対応' }), 1).gaps).toEqual(['高: P-5']);
    });
    it('低は残っていても合格で、件数だけ出す', () => {
        expect(cond(passing(), 6)).toMatchObject({ verdict: PASS, evidence: '中 0件（低 1件は既知の問題）' });
    });
    it('重さ・状態の値が決まりと違う行は不合格にする(黙って通さない)', () => {
        expect(cond(withIssue({ id: 'P-6', severity: '重大', status: '未対応' }), 1).verdict).toBe(FAIL);
        expect(cond(withIssue({ id: 'P-7', severity: '中', status: 'done' }), 6).verdict).toBe(FAIL);
    });
});

describe('条件2: 観測点が緑の @gate でそろい、3回流して揺れ0', () => {
    it('37点のうち1点だけ緑 → 不合格で、未達の36点を列挙する', () => {
        const c = cond({ ...passing(), gateLint: lintJson(['J5-2']), gateE2e: [gateRuns(['J5-2'])] }, 2);
        expect(c.verdict).toBe(FAIL);
        expect(c.evidence).toContain('緑 1/37点');
        expect(c.gaps).toHaveLength(1);
        expect(c.gaps[0]).toContain('@gate が無い 36点');
        expect(c.gaps[0].match(/J\d+-\d+/g)).toHaveLength(36);
        expect(c.gaps[0]).not.toContain('J5-2');
    });
    it('3回のうち1回でも失敗・揺れがある → 不合格', () => {
        expect(cond({ ...passing(), gateE2e: [gateRuns(IDS, ['expected', 'unexpected', 'expected'])] }, 2).verdict).toBe(FAIL);
        expect(cond({ ...passing(), gateE2e: [gateRuns(IDS, ['expected', 'flaky', 'expected'])] }, 2).verdict).toBe(FAIL);
    });
    it('2回しか流していない・結果が無い → 未実施(合格には数えない)', () => {
        expect(cond({ ...passing(), gateE2e: [gateRuns(IDS, ['expected', 'expected'])] }, 2).verdict).toBe(NONE);
        expect(cond({ ...passing(), gateE2e: [] }, 2).verdict).toBe(NONE);
    });
    it('1回ずつの結果が3本あれば3回と数える', () => {
        const once = () => gateRuns(IDS, ['expected']);
        expect(cond({ ...passing(), gateE2e: [once(), once(), once()] }, 2).verdict).toBe(PASS);
    });
    it('書き方の違反(lint:e2e-gate)が残っていれば不合格', () => {
        const p = passing();
        p.gateLint.violations.push({ file: 'tests/e2e/gate/J1-1.spec.js', line: 9, rule: 'no-evaluate', message: '…' });
        expect(cond(p, 2).verdict).toBe(FAIL);
    });
});

describe('条件3: 既存の自動検査', () => {
    it('E2E に失敗があれば不合格で、落ちたテストを出す', () => {
        const p = passing();
        p.e2e.push(pwReport([{ file: 'publish.spec.js', title: '公開できる', statuses: ['unexpected'] }]));
        const c = cond(p, 3);
        expect(c.verdict).toBe(FAIL);
        expect(c.gaps).toEqual(['E2E: publish.spec.js › 公開できる']);
    });
    it('lint が1本落ちていれば不合格、流していない検査があれば未実施', () => {
        const failed = passing();
        failed.checks.checks.find((x) => x.name === 'lint:css').exitCode = 2;
        expect(cond(failed, 3)).toMatchObject({ verdict: FAIL, gaps: ['lint 一式と check:version 失敗: lint:css'] });
        const lacking = passing();
        lacking.checks.checks = lacking.checks.checks.filter((x) => x.name !== 'check:version');
        expect(cond(lacking, 3).verdict).toBe(NONE);
    });
    it('画像比較・vitest の結果が無ければ未実施', () => {
        expect(cond({ ...passing(), visual: [] }, 3).verdict).toBe(NONE);
        expect(cond({ ...passing(), vitest: null }, 3).verdict).toBe(NONE);
        expect(cond({ ...passing(), vitest: { success: false, numPassedTests: 899, numFailedTests: 1 } }, 3).verdict).toBe(FAIL);
    });
});

describe('条件4・7・8: 本番URL・監査', () => {
    it('本番URL: 1つでも NG なら不合格、足りない検査があれば未実施', () => {
        const ng = passing();
        ng.prod.checks[0] = { name: 'CSP', ok: false, detail: '違反3件' };
        expect(cond(ng, 4)).toMatchObject({ verdict: FAIL, gaps: ['NG: CSP（違反3件）'] });
        const lacking = passing();
        lacking.prod.checks = lacking.prod.checks.filter((x) => x.name !== 'axe');
        expect(cond(lacking, 4)).toMatchObject({ verdict: NONE, gaps: ['未実施: axe'] });
    });
    it('監査の機械検出: 検出があれば不合格。lint:copy は checks.json からも読む', () => {
        const p = passing();
        p.audit.checks[0] = { name: '用語表', detected: 4 };
        expect(cond(p, 7).verdict).toBe(FAIL);
        const copy = passing();
        copy.checks.checks.find((x) => x.name === 'lint:copy').exitCode = 1;
        expect(cond(copy, 7).verdict).toBe(FAIL);
        expect(cond({ ...passing(), audit: null }, 7)).toMatchObject({ verdict: NONE, gaps: ['未実施: 用語表 aria・alt 表示崩れ'] });
    });
    it('直すべき所の一覧: 「未判断」「直す」が残っていれば不合格', () => {
        const p = passing();
        p.auditList.items.push({ id: 'A-3', severity: '中', status: '未判断' }, { id: 'A-4', severity: '低', status: '直す' });
        expect(cond(p, 8)).toMatchObject({ verdict: FAIL, gaps: ['未判断 1件: A-3', '直す 1件: A-4'] });
    });
});

describe('条件5: 人の手順書の記録欄', () => {
    it('H1〜H4 の表の行と「記録」欄を読む', () => {
        const rows = parseHumanRecords(humanMd('OK'));
        expect(rows.map((r) => r.id)).toEqual(['H1-1', 'H1-2', 'H2-1', 'H2-2', 'H3-1', 'H3-2', 'H4-1', 'H4-2']);
        expect(new Set(rows.map((r) => r.state))).toEqual(new Set(['OK']));
    });
    it('全部空 → 未実施、NG が1つでもあれば不合格', () => {
        expect(cond({ ...passing(), human: { text: humanMd('') } }, 5)).toMatchObject({ verdict: NONE, evidence: '記録 OK 0/8行（NG 0・未記入 8）' });
        expect(cond({ ...passing(), human: { text: humanMd('NG（画像あり）') } }, 5).verdict).toBe(FAIL);
    });
    it('OK／NG で始まらない記録・表が欠けている手順書は不合格', () => {
        expect(cond({ ...passing(), human: { text: humanMd('済') } }, 5).verdict).toBe(FAIL);
        expect(cond({ ...passing(), human: { text: humanMd('OK', HUMAN_HEADS.slice(0, 3)) } }, 5).gaps).toEqual(['表が見つからない: H4']);
    });
});

describe('軽い検査を流して記録する(--collect)', () => {
    it('AUTO_CHECKS・lint:copy・vitest を流し、終了コードを checks.json に書く', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gate-collect-'));
        const calls = [];
        const run = (name, extra, env) => { calls.push({ name, extra, env }); return { status: name === 'lint:css' ? 2 : 0, output: `${name} done\n` }; };
        const result = collectChecks({ dir, run, versionRange: 'aaa..bbb' });
        expect(calls.map((c) => c.name)).toEqual([...AUTO_CHECKS, 'lint:copy', 'test']);
        expect(calls.find((c) => c.name === 'check:version').env).toEqual({ CHECK_VERSION_RANGE: 'aaa..bbb' });
        expect(calls.find((c) => c.name === 'lint:e2e-gate').extra).toEqual(['--', `--json=${join(dir, 'gate-lint.json')}`]);
        expect(calls.find((c) => c.name === 'test').extra).toEqual(['--', '--reporter=json', `--outputFile=${join(dir, 'vitest.json')}`]);
        expect(result.checks.find((c) => c.name === 'lint:css')).toMatchObject({ group: 'auto', exitCode: 2 });
        expect(result.checks.find((c) => c.name === 'lint:copy').group).toBe('audit');
        expect(JSON.parse(readFileSync(join(dir, 'checks.json'), 'utf-8')).checks).toHaveLength(AUTO_CHECKS.length + 1);
    });
});

describe('入口(node scripts/gate-report.mjs)を通す', () => {
    const writeAll = (dir, inputs) => {
        const put = (name, data) => writeFileSync(join(dir, name), JSON.stringify(data));
        put('issues.json', inputs.issues);
        put('audit-list.json', inputs.auditList);
        put('gate-lint.json', inputs.gateLint);
        put('gate-e2e-1.json', inputs.gateE2e[0]);
        put('e2e-parallel.json', inputs.e2e[0]);
        put('visual.json', inputs.visual[0]);
        put('vitest.json', inputs.vitest);
        put('checks.json', inputs.checks);
        put('prod-url.json', inputs.prod);
        put('audit.json', inputs.audit);
        writeFileSync(join(dir, 'human.md'), inputs.human.text);
    };
    const run = (dir, ...args) => spawnSync(process.execPath,
        [SCRIPT, `--dir=${dir}`, `--issues=${join(dir, 'issues.json')}`, `--audit-list=${join(dir, 'audit-list.json')}`, ...args], { encoding: 'utf-8' });

    it('結果が何も無い置き場 → 8行とも未実施の表を出し、終了コード1', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gate-report-empty-'));
        const r = run(dir);
        expect(r.status).toBe(1);
        expect(r.stdout).toContain('総合: **不合格**（合格 0・不合格 0・未実施 8）');
        expect(r.stdout.match(/\| 未実施 \|/g)).toHaveLength(8);
        expect(r.stdout).toContain('| 1 | 致命0件・高0件 | 未実施 | 問題の一覧(docs/gate/issues.json)が無い | — |');
    });
    it('全部そろった置き場 → 終了コード0で、--out にも同じ表を書く', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gate-report-pass-'));
        writeAll(dir, passing());
        const out = join(dir, 'report.md');
        const r = run(dir, `--human=${join(dir, 'human.md')}`, `--out=${out}`);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('総合: **合格**（合格 8・不合格 0・未実施 0）');
        expect(readFileSync(out, 'utf-8')).toBe(r.stdout);
    });
    it('見本の @gate 1本だけの置き場 → 条件2が不合格で未達36点を出す', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gate-report-one-'));
        writeAll(dir, { ...passing(), gateLint: lintJson(['J5-2']), gateE2e: [gateRuns(['J5-2'])] });
        const r = run(dir, `--human=${join(dir, 'human.md')}`);
        expect(r.status).toBe(1);
        expect(r.stdout).toContain('| 不合格 | 緑 1/37点');
        expect(r.stdout).toContain('@gate が無い 36点: J1-1 J1-2');
    });
    it('壊れた結果ファイルは「読めない」で不合格にする(未実施と区別する)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gate-report-broken-'));
        writeFileSync(join(dir, 'gate-lint.json'), '{ 壊れている');
        const inputs = readInputs({ dir, paths: { issues: join(dir, 'issues.json'), auditList: join(dir, 'audit-list.json') } });
        expect(evaluateGate(inputs).conditions[1].verdict).toBe(FAIL);
        expect(renderMarkdown(evaluateGate(inputs))).toContain('を読めない');
    });
});
