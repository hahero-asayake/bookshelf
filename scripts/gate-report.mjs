// 公開前品質の門(d)「合格の基準」の8条件を、結果から表にして合否を出す(イシュー#583)。
// 設計の正本: obsidian 60_🐙claude/63_🐙project/bookshelf/公開前最終テスト設計.md §6。
// 重さは 致命0・高0・中0 で合格(2026-11-14 ハヘロ決裁)。低は件数だけ出す(「既知の問題」に載せる)。
//
// 使い方:
//   node scripts/gate-report.mjs [--collect] [--dir=_local/gate] [--out=<md>] [--human=<md>]
//     [--issues=<json>] [--audit-list=<json>] [--gate-lint=<json>] [--e2e=<json>]… [--gate-e2e=<json>]…
//     [--visual=<json>]… [--vitest=<json>] [--checks=<json>] [--prod=<json>] [--audit=<json>]
//     [--version-range=<base>..<head>]
//   判定は「合格／不合格／未実施」。無い入力は「未実施」と出し、合格には数えない。
//   標準出力に Markdown の表を出す(--out でファイルにも書く)。終了コードは総合が合格の時だけ 0。
//
// 読むもの(既定の置き場。結果は --dir、正本は docs/gate/):
//   条件1・6  docs/gate/issues.json       問題の一覧 { issues: [{ id, severity: 致命|高|中|低, status: 未対応|直した, title }] }
//   条件2     <dir>/gate-lint.json        lint:e2e-gate の --json 出力(観測点IDごとの @gate と違反)
//             <dir>/gate-e2e*.json        門のE2Eの結果(Playwright の JSON)。--repeat-each=3 の1本でも3本でもよい。
//                                         <dir>/e2e*.json に入っている門のE2Eの結果も回数に数える
//   条件3     <dir>/e2e*.json             E2E 全件の結果(Playwright の JSON。CI の e2e-parallel.json 等)
//             <dir>/visual*.json          画像比較の結果(playwright.visual.config.js の JSON)
//             <dir>/vitest.json           vitest の結果(--reporter=json)
//             <dir>/checks.json           終了コードしか無い検査の記録 { checks: [{ name, group: auto|audit, exitCode }] }
//   条件4     <dir>/prod-url.json         本番URL の検査 { checks: [{ name, ok, detail }] }  name は REQUIRED_PROD
//   条件5     --human=<md>                人の手順書(公開前最終テスト_人の手順書.md)。表の「記録」欄が OK／NG／空
//   条件7     <dir>/audit.json            監査の機械検出 { checks: [{ name, detected, detail }] }  name は REQUIRED_AUDIT
//             (lint:copy は checks.json の group=audit からも読む)
//   条件8     docs/gate/audit-list.json   直すべき所の一覧 { items: [{ id, severity, status: 未判断|直す|直した|承認, where, text, problem, suggestion }] }
//
// --collect: 軽い検査(AUTO_CHECKS・lint:copy・vitest)をここで流し、checks.json・gate-lint.json・vitest.json を
//   --dir に書いてから集計する。重い検査(E2E・画像比較・本番URL)は流さない(結果ファイルを置いて読ませる)。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const PASS = '合格';
export const FAIL = '不合格';
export const NONE = '未実施';
export const REQUIRED_RUNS = 3;
export const SEVERITIES = ['致命', '高', '中', '低'];
const ISSUE_STATUS = ['未対応', '直した'];
const AUDIT_LIST_STATUS = ['未判断', '直す', '直した', '承認'];
export const REQUIRED_PROD = ['CSP', 'OGP', 'PWA', 'SEO', '301', 'Lighthouse性能', 'Lighthouse a11y', 'axe'];
export const REQUIRED_AUDIT = ['lint:copy', '用語表', 'aria・alt', '表示崩れ'];
export const AUTO_CHECKS = ['check:version', 'lint:css', 'lint:e2e-goto', 'lint:breakpoint', 'lint:esc', 'lint:js-color', 'lint:internal-refs', 'lint:e2e-gate'];
const AUDIT_CHECKS = ['lint:copy'];
const HUMAN_SECTIONS = ['H1', 'H2', 'H3', 'H4'];

const worst = (verdicts) => (verdicts.includes(FAIL) ? FAIL : verdicts.includes(NONE) ? NONE : PASS);

// 入力が無い(未実施)・読めない(不合格)を先に片付ける。読めた時は null
function unreadable(input, what) {
    if (!input) return { verdict: NONE, evidence: `${what}が無い`, gaps: [] };
    if (input.error) return { verdict: FAIL, evidence: `${what}を読めない: ${input.error}`, gaps: [] };
    return null;
}

// Playwright の JSON を「1回の実行」の並びにする(--repeat-each の分も1件ずつ)
export function flattenPlaywright(report) {
    const runs = [];
    const walk = (suite, file) => {
        const f = suite.file ?? file;
        for (const spec of suite.specs ?? []) {
            for (const t of spec.tests ?? []) runs.push({ file: spec.file ?? f, title: spec.title, project: t.projectName, status: t.status });
        }
        for (const s of suite.suites ?? []) walk(s, f);
    };
    for (const top of report.suites ?? []) walk(top, undefined);
    return runs;
}

// 条件1・6: 直っていない問題を重さごとに数える
function judgeSeverity(issues, levels) {
    const bad = unreadable(issues, '問題の一覧(docs/gate/issues.json)');
    if (bad) return bad;
    const open = Object.fromEntries(SEVERITIES.map((s) => [s, []]));
    const invalid = [];
    for (const it of issues.issues ?? []) {
        if (!SEVERITIES.includes(it.severity) || !ISSUE_STATUS.includes(it.status)) invalid.push(it.id ?? '(IDなし)');
        else if (it.status !== '直した') open[it.severity].push(it.id);
    }
    const gaps = levels.filter((s) => open[s].length > 0).map((s) => `${s}: ${open[s].join(' ')}`);
    if (invalid.length > 0) gaps.push(`重さ・状態の値が決まりと違う: ${invalid.join(' ')}`);
    const known = levels.includes('中') ? `（低 ${open.低.length}件は既知の問題）` : '';
    return { verdict: gaps.length === 0 ? PASS : FAIL, evidence: levels.map((s) => `${s} ${open[s].length}件`).join('・') + known, gaps };
}

// 条件2: 観測点ごとに、緑の @gate が1本以上あり、3回流して揺れ0か
function judgeGate(gateLint, reports) {
    const bad = unreadable(gateLint, 'lint:e2e-gate の結果(gate-lint.json)');
    if (bad) return bad;
    const runs = reports.filter((r) => !r.error).flatMap(flattenPlaywright).filter((r) => r.status !== 'skipped');
    const stateOf = (t) => {
        const mine = runs.filter((r) => r.title === t.title && typeof r.file === 'string' && (t.file === r.file || t.file.endsWith(`/${r.file}`)));
        if (mine.length === 0) return '未実行';
        if (mine.some((r) => r.status !== 'expected')) return '失敗・揺れ';
        const perProject = new Map();
        for (const r of mine) perProject.set(r.project, (perProject.get(r.project) ?? 0) + 1);
        return [...perProject.values()].every((n) => n >= REQUIRED_RUNS) ? '緑' : '回数不足';
    };
    const tests = gateLint.tests.map((t) => ({ ...t, state: stateOf(t) }));
    const order = ['緑', '失敗・揺れ', '回数不足', '未実行'];
    const groups = { 緑: [], '失敗・揺れ': [], 回数不足: [], 未実行: [], なし: [] };
    for (const id of Object.keys(gateLint.coverage)) {
        const states = tests.filter((t) => t.ids.includes(id)).map((t) => t.state);
        groups[states.length === 0 ? 'なし' : order.find((s) => states.includes(s))].push(id);
    }
    const flaky = tests.filter((t) => t.state === '失敗・揺れ');
    const violations = gateLint.violations.length;
    const gaps = [];
    if (groups.なし.length > 0) gaps.push(`@gate が無い ${groups.なし.length}点: ${groups.なし.join(' ')}`);
    if (flaky.length > 0) gaps.push(`失敗・揺れのある @gate ${flaky.length}本: ${flaky.map((t) => t.title).join(' ／ ')}`);
    if (groups.回数不足.length > 0) gaps.push(`${REQUIRED_RUNS}回に満たない ${groups.回数不足.length}点: ${groups.回数不足.join(' ')}`);
    if (groups.未実行.length > 0) gaps.push(`結果が無い ${groups.未実行.length}点: ${groups.未実行.join(' ')}`);
    if (violations > 0) gaps.push(`書き方の違反 ${violations}件(lint:e2e-gate)`);
    const failed = groups.なし.length > 0 || flaky.length > 0 || violations > 0;
    return {
        verdict: failed ? FAIL : gaps.length > 0 ? NONE : PASS,
        evidence: `緑 ${groups.緑.length}/${gateLint.jobsTotal}点（@gate ${tests.length}本・書き方の違反 ${violations}件・結果 ${runs.length}回分）`,
        gaps
    };
}

function judgePlaywright(reports, label) {
    if (reports.length === 0) return { verdict: NONE, text: `${label} 未実施`, gaps: [] };
    if (reports.some((r) => r.error)) return { verdict: FAIL, text: `${label} 結果を読めない`, gaps: [] };
    const runs = reports.flatMap(flattenPlaywright);
    const n = (status) => runs.filter((r) => r.status === status).length;
    const bad = runs.filter((r) => r.status === 'unexpected' || r.status === 'flaky');
    const more = bad.length > 10 ? [`${label}: ほか ${bad.length - 10}件`] : [];
    return {
        verdict: runs.length === 0 ? NONE : bad.length === 0 ? PASS : FAIL,
        text: `${label} 緑${n('expected')}・失敗${n('unexpected')}・揺れ${n('flaky')}`,
        gaps: [...bad.slice(0, 10).map((r) => `${label}: ${r.file} › ${r.title}`), ...more]
    };
}

function judgeVitest(vitest) {
    if (!vitest) return { verdict: NONE, text: 'vitest 未実施', gaps: [] };
    if (vitest.error) return { verdict: FAIL, text: 'vitest 結果を読めない', gaps: [] };
    const failed = vitest.numFailedTests ?? 0;
    const ok = vitest.success === true && failed === 0;
    return { verdict: ok ? PASS : FAIL, text: `vitest 緑${vitest.numPassedTests ?? 0}・失敗${failed}`, gaps: ok ? [] : [`vitest: 失敗 ${failed}件`] };
}

function judgeChecks(checks, names, label) {
    if (!checks) return { verdict: NONE, text: `${label} 未実施`, gaps: [] };
    if (checks.error) return { verdict: FAIL, text: `${label} 結果を読めない`, gaps: [] };
    const found = new Map((checks.checks ?? []).map((c) => [c.name, c]));
    const failed = names.filter((n) => found.has(n) && found.get(n).exitCode !== 0);
    const missing = names.filter((n) => !found.has(n));
    const gaps = [];
    if (failed.length > 0) gaps.push(`${label} 失敗: ${failed.join(' ')}`);
    if (missing.length > 0) gaps.push(`${label} 未実施: ${missing.join(' ')}`);
    return {
        verdict: failed.length > 0 ? FAIL : missing.length > 0 ? NONE : PASS,
        text: `${label} 緑${names.length - failed.length - missing.length}/${names.length}`, gaps
    };
}

// 条件3: 既存の自動検査
function judgeAuto({ e2e, visual, vitest, checks }) {
    const parts = [judgePlaywright(e2e, 'E2E'), judgePlaywright(visual, '画像比較'), judgeVitest(vitest), judgeChecks(checks, AUTO_CHECKS, 'lint 一式と check:version')];
    return { verdict: worst(parts.map((p) => p.verdict)), evidence: parts.map((p) => p.text).join('／'), gaps: parts.flatMap((p) => p.gaps) };
}

// 条件4・7: 名前の決まった検査が全部そろい、全部OKか
function judgeNamed(items, required, isOk, label) {
    const found = new Map(items.map((c) => [c.name, c]));
    const failed = items.filter((c) => !isOk(c));
    const missing = required.filter((n) => !found.has(n));
    const gaps = [];
    if (failed.length > 0) gaps.push(`${label}: ${failed.map((c) => (c.detail ? `${c.name}（${c.detail}）` : c.name)).join(' ／ ')}`);
    if (missing.length > 0) gaps.push(`未実施: ${missing.join(' ')}`);
    return {
        verdict: failed.length > 0 ? FAIL : missing.length > 0 ? NONE : PASS,
        evidence: `OK ${items.length - failed.length}件・${label} ${failed.length}件・未実施 ${missing.length}件（必要 ${required.length}件）`, gaps
    };
}

function judgeProd(prod) {
    return unreadable(prod, '本番URL の検査の結果(prod-url.json)') ?? judgeNamed(prod.checks ?? [], REQUIRED_PROD, (c) => c.ok === true, 'NG');
}

function judgeAuditMachine(audit, checks) {
    if (audit?.error) return unreadable(audit, '監査の機械検出の結果(audit.json)');
    const fromChecks = (checks && !checks.error ? checks.checks ?? [] : []).filter((c) => c.group === 'audit')
        .map((c) => ({ name: c.name, detected: c.exitCode === 0 ? 0 : 1, detail: c.exitCode === 0 ? '' : `終了コード ${c.exitCode}` }));
    const items = [...(audit?.checks ?? []), ...fromChecks.filter((c) => !(audit?.checks ?? []).some((a) => a.name === c.name))];
    if (items.length === 0) return { verdict: NONE, evidence: '監査の機械検出の結果(audit.json・checks.json の lint:copy)が無い', gaps: [] };
    return judgeNamed(items, REQUIRED_AUDIT, (c) => c.detected === 0, '検出あり');
}

// 人の手順書(Markdown)の表から、H1〜H4 の「記録」欄を読む
export function parseHumanRecords(md) {
    const rows = [];
    let section = null;
    for (const line of md.split(/\r?\n/)) {
        const head = /^##\s+(H\d+)(?![0-9])/.exec(line);
        if (head) { section = head[1]; continue; }
        if (/^#/.test(line)) { section = null; continue; }
        const row = /^\|\s*(\d+)\s*\|/.exec(line);
        if (!section || !row) continue;
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        const record = cells[cells.length - 1];
        const state = record === '' ? '未記入' : /^OK(?![A-Za-z])/i.test(record) ? 'OK' : /^NG(?![A-Za-z])/i.test(record) ? 'NG' : '不明';
        rows.push({ id: `${section}-${row[1]}`, section, record, state });
    }
    return rows;
}

// 条件5: 人の実機4本
function judgeHuman(human) {
    if (human === null || human === undefined) return { verdict: NONE, evidence: '人の手順書(--human=<md>)が渡されていない', gaps: [] };
    if (human.error) return { verdict: FAIL, evidence: `人の手順書を読めない: ${human.error}`, gaps: [] };
    const rows = parseHumanRecords(human.text);
    const ids = (state) => rows.filter((r) => r.state === state).map((r) => r.id);
    const lacking = HUMAN_SECTIONS.filter((s) => !rows.some((r) => r.section === s));
    const gaps = [];
    if (ids('NG').length > 0) gaps.push(`NG: ${ids('NG').join(' ')}`);
    if (ids('不明').length > 0) gaps.push(`OK／NG で始まっていない記録: ${ids('不明').join(' ')}`);
    if (lacking.length > 0) gaps.push(`表が見つからない: ${lacking.join(' ')}`);
    if (ids('未記入').length > 0) gaps.push(`未記入 ${ids('未記入').length}行: ${ids('未記入').join(' ')}`);
    const failed = ids('NG').length > 0 || ids('不明').length > 0 || lacking.length > 0;
    return {
        verdict: failed ? FAIL : ids('未記入').length > 0 ? NONE : PASS,
        evidence: `記録 OK ${ids('OK').length}/${rows.length}行（NG ${ids('NG').length}・未記入 ${ids('未記入').length}）`, gaps
    };
}

// 条件8: 直すべき所の一覧が全件「直した」か「承認」
function judgeAuditList(auditList) {
    const bad = unreadable(auditList, '直すべき所の一覧(docs/gate/audit-list.json)');
    if (bad) return bad;
    const items = auditList.items ?? [];
    const of = (status) => items.filter((it) => it.status === status);
    const invalid = items.filter((it) => !AUDIT_LIST_STATUS.includes(it.status));
    const gaps = [];
    for (const status of ['未判断', '直す']) if (of(status).length > 0) gaps.push(`${status} ${of(status).length}件: ${of(status).map((it) => it.id).join(' ')}`);
    if (invalid.length > 0) gaps.push(`状態の値が決まりと違う: ${invalid.map((it) => it.id ?? '(IDなし)').join(' ')}`);
    return {
        verdict: gaps.length === 0 ? PASS : FAIL,
        evidence: `全 ${items.length}件（直した ${of('直した').length}・承認 ${of('承認').length}・直す ${of('直す').length}・未判断 ${of('未判断').length}）`, gaps
    };
}

/**
 * 8条件を判定する(純粋な関数。入力の読み込みは readInputs)。
 * @param {object} inputs readInputs の返り値と同じ形
 */
export function evaluateGate(inputs) {
    const titles = [
        '致命0件・高0件',
        `門(a)：観測点が全部、緑の @gate でそろい、${REQUIRED_RUNS}回流して揺れ0`,
        '既存の自動検査（E2E・画像比較・vitest・lint 一式・check:version）が全部緑',
        '本番URL の表が全部OK（Lighthouse・a11y・axe を含む）',
        '人の実機4本の記録が全部埋まり、NG 0',
        '中も0件（低は「既知の問題」に載せる）',
        '門(c)：機械の検出が0件（lint:copy・用語表・aria/alt・表示崩れ）',
        '門(c)：「直すべき所の一覧」の全件が「直した」か「ハヘロが承認した」'
    ];
    const judged = [
        judgeSeverity(inputs.issues, ['致命', '高']),
        judgeGate(inputs.gateLint, [...(inputs.gateE2e ?? []), ...(inputs.e2e ?? [])]),
        judgeAuto({ e2e: inputs.e2e ?? [], visual: inputs.visual ?? [], vitest: inputs.vitest, checks: inputs.checks }),
        judgeProd(inputs.prod),
        judgeHuman(inputs.human),
        judgeSeverity(inputs.issues, ['中']),
        judgeAuditMachine(inputs.audit, inputs.checks),
        judgeAuditList(inputs.auditList)
    ];
    const conditions = judged.map((j, i) => ({ n: i + 1, title: titles[i], ...j }));
    const count = (v) => conditions.filter((c) => c.verdict === v).length;
    return { overall: count(PASS) === conditions.length ? PASS : FAIL, counts: { [PASS]: count(PASS), [FAIL]: count(FAIL), [NONE]: count(NONE) }, conditions };
}

export function renderMarkdown(report, { generatedAt = `${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' })} JST` } = {}) {
    const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    const lines = [
        '# 公開前品質の門(d) 合否の集計',
        '',
        `- 総合: **${report.overall}**（合格 ${report.counts[PASS]}・不合格 ${report.counts[FAIL]}・未実施 ${report.counts[NONE]}）`,
        `- 集計した時刻: ${generatedAt}`,
        '',
        '| # | 条件 | 判定 | 根拠 | 未達 |',
        '|---|---|---|---|---|'
    ];
    for (const c of report.conditions) {
        lines.push(`| ${c.n} | ${cell(c.title)} | ${c.verdict} | ${cell(c.evidence)} | ${c.gaps.length > 0 ? c.gaps.map(cell).join('<br>') : '—'} |`);
    }
    return lines.join('\n') + '\n';
}

function readJson(path) {
    if (!path || !existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf-8')); } catch (err) { return { error: `${path}: ${err.message}` }; }
}

function readText(path) {
    if (!path) return null;
    if (!existsSync(path)) return { error: `${path} が無い` };
    return { text: readFileSync(path, 'utf-8') };
}

function listJson(dir, prefix) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort().map((f) => join(dir, f));
}

/** 結果ファイルを読む。paths で渡されたものが優先、無ければ dir と docs/gate/ の既定の名前を探す */
export function readInputs({ dir = join(ROOT, '_local/gate'), root = ROOT, paths = {} } = {}) {
    const many = (given, prefix) => (given && given.length > 0 ? given : listJson(dir, prefix)).map((p) => readJson(p) ?? { error: `${p} が無い` });
    return {
        issues: readJson(paths.issues ?? join(root, 'docs/gate/issues.json')),
        auditList: readJson(paths.auditList ?? join(root, 'docs/gate/audit-list.json')),
        gateLint: readJson(paths.gateLint ?? join(dir, 'gate-lint.json')),
        gateE2e: many(paths.gateE2e, 'gate-e2e'),
        e2e: many(paths.e2e, 'e2e'),
        visual: many(paths.visual, 'visual'),
        vitest: readJson(paths.vitest ?? join(dir, 'vitest.json')),
        checks: readJson(paths.checks ?? join(dir, 'checks.json')),
        prod: readJson(paths.prod ?? join(dir, 'prod-url.json')),
        audit: readJson(paths.audit ?? join(dir, 'audit.json')),
        human: readText(paths.human)
    };
}

function runNpmScript(name, extra, env) {
    const r = spawnSync('npm', ['run', '--silent', name, ...extra], {
        cwd: ROOT, encoding: 'utf-8', timeout: 180_000,
        env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`, ...env }
    });
    return { status: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * 軽い検査を流して結果を dir に書く(checks.json・gate-lint.json・vitest.json)。
 * @param {{ dir: string, versionRange?: string, run?: (name: string, extra: string[], env: object) => { status: number, output: string } }} opts
 */
export function collectChecks({ dir, versionRange = 'origin/main..HEAD', run = runNpmScript }) {
    mkdirSync(dir, { recursive: true });
    const checks = [];
    const record = (name, group, extra = [], env = {}) => {
        const r = run(name, extra, env);
        checks.push({ name, group, exitCode: r.status, tail: r.output.trim().split('\n').slice(-3).join('\n') });
    };
    for (const name of AUTO_CHECKS) {
        if (name === 'check:version') record(name, 'auto', [], { CHECK_VERSION_RANGE: versionRange });
        else if (name === 'lint:e2e-gate') record(name, 'auto', ['--', `--json=${join(dir, 'gate-lint.json')}`]);
        else record(name, 'auto');
    }
    for (const name of AUDIT_CHECKS) record(name, 'audit');
    run('test', ['--', '--reporter=json', `--outputFile=${join(dir, 'vitest.json')}`], {});
    const result = { generatedAt: new Date().toISOString(), versionRange, checks };
    writeFileSync(join(dir, 'checks.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
}

function main(argv) {
    const flag = (name) => argv.includes(`--${name}`);
    const all = (name) => { const pre = `--${name}=`; return argv.filter((a) => a.startsWith(pre)).map((a) => resolve(a.slice(pre.length))); };
    const one = (name) => all(name)[0];
    const dir = one('dir') ?? join(ROOT, '_local/gate');
    if (flag('collect')) {
        const rangeArg = argv.find((a) => a.startsWith('--version-range='));
        collectChecks({ dir, versionRange: rangeArg ? rangeArg.slice('--version-range='.length) : undefined });
    }
    const inputs = readInputs({
        dir,
        paths: {
            issues: one('issues'), auditList: one('audit-list'), gateLint: one('gate-lint'), gateE2e: all('gate-e2e'), e2e: all('e2e'),
            visual: all('visual'), vitest: one('vitest'), checks: one('checks'), prod: one('prod'), audit: one('audit'), human: one('human')
        }
    });
    const report = evaluateGate(inputs);
    const md = renderMarkdown(report);
    const out = one('out');
    if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, md); }
    process.stdout.write(md);
    process.exit(report.overall === PASS ? 0 : 1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
