#!/usr/bin/env node
// イシュー#502 (U1): origin/main と比べて「新しく落ちたテストが0件」かを機械判定する仕組み。
// 計画の正本: tmp/499/recovered/499-step4-plan.md §3-2。これから先の全単位(U2以降)が使う。
//
// 何をするか:
//   1. --base(既定 origin/main) を、作業の worktree の外に一時 worktree として取り出す(base側)。
//   2. work側(既定=作業ツリーそのもの。--self指定時はbaseと同じrefの別の一時worktree)と、
//      同じ port 規則で、E2E全件とvitestを「順番に」流す(JSON reporter)。
//   3. 失敗テストの集合(file+title+project)を比較し、「新しく落ちた」「新しく通った」
//      「両方で落ちた(既存の問題)」の3つに分けた表を出す。
//   4. 新しく落ちたものだけを work側で--retries回(既定3)流し直す。全回落ちれば regression、
//      1回でも通れば flake として分けて記録する。
//   5. 一時worktreeは正常終了・異常終了・SIGINT/SIGTERM いずれでも必ず片付ける
//      (`git worktree remove --force` → `git worktree prune`)。作業ツリー自体へは
//      checkout・stash・resetを一切行わない。
//
// 使い方:
//   node scripts/verify/e2e-diff-main.mjs [--base=origin/main] [--self]
//     [--skip-e2e] [--skip-vitest] [--visual] [--grep=<pattern>]
//     [--exclude=<pattern>]... [--no-default-exclude]
//     [--out=<dir>] [--port=<n>] [--retries=<n>] [--keep]
//
//   --self        base側と同じrefで、workも別の一時worktreeにする(自分自身との比較=誤検知の確認用)。
//   --grep        両側・絞り込み試走用。playwrightの--grep/vitestの-tにそのまま渡す。
//   --exclude     E2E(playwright)から除外するテスト名パターン。複数回指定可(既定の除外に追加)。
//                 空値(--exclude=)は無視する(--no-default-excludeと組み合わせて
//                 「既定除外も追加除外も無し=全件」を書きたい時のためのプレースホルダ)。
//   --no-default-exclude
//                 既定の除外(下記)を使わない。--exclude併用時はそちらだけ効く。
//   --out         結果の置き場(既定: 作業ツリーの外・恒久的な場所。runをまたいで残る。tmp配下ではない)。
//   --port        既定は環境変数PORTまたは8000(playwright.config.jsと同じ規則)。
//   --retries     新しく落ちたものの流し直し回数(既定3・計画§3-2の4)。
//   --keep        デバッグ用。一時worktreeを片付けずに残す(通常は使わない)。
//   --init-storage key=value
//                 E2E実行前にlocalStorageへ値を注入する(複数回指定可)。base/work両方の
//                 playwright実行に対して効く(S6専用の分岐ではない汎用オプション・②指示・
//                 docs/char/s6-scope.md §5)。tests/e2e/helpers/test-base.jsのcontext fixtureが
//                 環境変数E2E_INIT_STORAGE(JSON)を読んでaddInitScriptする。
//
// 除外(イシュー#507): sort-perf-budgetはCPU負荷で結果が揺れる既知のテストで、
// CIも.github/workflows/ci.ymlの「sort-perf-budget以外・並列」stepで
// `--grep-invert "sort-perf-budget"`して外し、別stepで単独実行している(#405/#476/#492)。
// このスクリプトもCIと同じ既定除外にする。一覧の正本をスクリプト側に二重管理せず、
// 起動時にci.ymlの該当行を読んで既定除外パターンにする(一意に読めなければ黙って
// 全件流さずエラーで止める=ci.ymlの形が変わったことに気づける)。vitestはCI側に
// 除外が無いため対象外(そのままreportに書く)。playwright.visual.config.js側の画像比較
// (--visual)にも適用しない(base対work比較ではなくwork側単独の基準画像比較のため)。
//
// 子プロセスの node は process.execPath を使う(呼び出し元と同じnode)。特定ユーザーの
// nvmパスを固定で埋め込まない(③はkurokoユーザーで動き、seiユーザーのnvmパスとは食い違う)。
//
// 既知の制約(最初の版):
//   - base/work間でdevDependencies(package-lock.json)が変わっている場合、一時worktreeは
//     作業側のnode_modulesをsymlink共有するため、古い/新しい依存のまま流れる可能性がある
//     (警告ログのみ・失敗にはしない)。
//   - 「work側にだけ存在しないテスト(削除・rename)」はbase側で落ちていた場合のみ
//     「新しく通った」に含める。3分類の表現を優先した単純化。

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
    existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildVitestRetryArgs, categorize, countRegressions, countUndetermined, findMatchOutcome,
    groupE2ERetryTargetsByProject, parsePlaywrightJson, parseVitestJson, verdictLabel,
    classifyVerdict,
} from './e2e-diff-lib.mjs';

// ---------- 引数 ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
    const pre = `--${name}=`;
    const found = argv.find((a) => a.startsWith(pre));
    return found ? found.slice(pre.length) : def;
};
const optAll = (name) => {
    const pre = `--${name}=`;
    return argv.filter((a) => a.startsWith(pre)).map((a) => a.slice(pre.length));
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_REF = opt('base', 'origin/main');
const SELF = flag('self');
const SKIP_E2E = flag('skip-e2e');
const SKIP_VITEST = flag('skip-vitest');
const VISUAL = flag('visual');
const GREP = opt('grep', '');
const PORT = opt('port', process.env.PORT || '8000');
const RETRIES = parseInt(opt('retries', '3'), 10);
const KEEP = flag('keep');
const NO_DEFAULT_EXCLUDE = flag('no-default-exclude');
const EXTRA_EXCLUDE_PATTERNS = optAll('exclude');
// --init-storage key=value (複数回指定可) → {key: value, ...} のJSONにしてE2E_INIT_STORAGEへ渡す
const INIT_STORAGE_PAIRS = optAll('init-storage');
const INIT_STORAGE_JSON = INIT_STORAGE_PAIRS.length ? JSON.stringify(Object.fromEntries(
    INIT_STORAGE_PAIRS.map((kv) => {
        const i = kv.indexOf('=');
        if (i < 0) throw new Error(`--init-storage は key=value の形で指定すること(受け取った値: ${kv})`);
        return [kv.slice(0, i), kv.slice(i + 1)];
    }),
)) : '';

// ---------- 除外(sort-perf-budget等・イシュー#507) ----------
// 既定の除外一覧はci.ymlの「sort-perf-budget以外・並列」stepの--grep-invertを正本として読む
// (スクリプト側に別途ハードコードして二重管理しない)。該当行が一意に見つからなければ、
// 黙って全件流すのではなくエラーで止める(ci.ymlの形が変わったことに気づける)。
function readDefaultExcludesFromCi() {
    const ciPath = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
    if (!existsSync(ciPath)) {
        throw new Error(
            `既定の除外一覧(ci.yml)が見つからない: ${ciPath}\n`
            + '--exclude で明示するか、--no-default-exclude で既定除外無しを指定すること。',
        );
    }
    const lines = readFileSync(ciPath, 'utf-8').split('\n');
    const hits = [];
    lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('playwright test')) return;
        const m = line.match(/--grep-invert\s+"([^"]*)"/);
        if (m) hits.push({ lineNo: i + 1, raw: m[1] });
    });
    if (hits.length !== 1) {
        throw new Error(
            `ci.ymlから既定の除外を一意に読み取れない(${hits.length}件ヒット・${ciPath})。\n`
            + 'ci.ymlの形が変わった可能性がある。--exclude で明示するか --no-default-exclude で既定除外無しを指定すること。',
        );
    }
    const { lineNo, raw } = hits[0];
    const patterns = raw.split('|').map((p) => p.trim()).filter(Boolean);
    if (!patterns.length) {
        throw new Error(`ci.yml:${lineNo} の --grep-invert の値が空。--exclude で明示するか --no-default-exclude を使うこと。`);
    }
    return { patterns, lineNo, ciPath };
}
// パターンごとの理由の対応表。無い場合は出どころに応じた汎用理由を出す(黙って消さない)。
const EXCLUDE_REASONS = {
    'sort-perf-budget': '負荷で揺れる・CIでは別stepで単独実行(workers=1)(#405/#476/#492)',
};
function reasonFor(pattern, sourceKind) {
    if (EXCLUDE_REASONS[pattern]) return EXCLUDE_REASONS[pattern];
    return sourceKind === 'ci' ? 'CI設定(ci.yml)由来' : '--exclude 指定';
}
const EXCLUDES = [];
if (!NO_DEFAULT_EXCLUDE) {
    const { patterns, lineNo, ciPath } = readDefaultExcludesFromCi();
    for (const p of patterns) {
        EXCLUDES.push({ pattern: p, source: `${relative(REPO_ROOT, ciPath)}:${lineNo}`, reason: reasonFor(p, 'ci') });
    }
}
for (const p of EXTRA_EXCLUDE_PATTERNS) {
    if (!p) continue; // --exclude=(空値)は無視。--no-default-excludeと組み合わせて「全件」を表す時に使う。
    if (EXCLUDES.some((e) => e.pattern === p)) continue;
    EXCLUDES.push({ pattern: p, source: '--exclude指定', reason: reasonFor(p, 'cli') });
}
const EXCLUDE_INVERT_PATTERN = EXCLUDES.map((e) => e.pattern).join('|');

function ts() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
// 既定の置き場は作業ツリーの外(兄弟ディレクトリ)・タイムスタンプ+pidで並行runと衝突しない。
const OUT = resolve(opt('out', join(dirname(REPO_ROOT), '_artifacts', `e2e-diff-${ts()}-${process.pid}`)));
mkdirSync(OUT, { recursive: true });

function log(msg) { console.log(`[e2e-diff-main] ${msg}`); }

// ---------- node_modules の実体を探す(worktreeは共有symlink経由で解決=イシュー#428) ----------
// 単なる existsSync(node_modules) だけでは、vitest/vite がキャッシュ目的で worktree 直下に
// 実ディレクトリの node_modules/.vite だけを自動生成し、それが「パッケージの入っていない
// node_modules」として先に見つかってしまう罠がある(実機で発生・パッケージ本体は無いので
// playwright/vitest の .bin が解決できず即死する)。.bin/playwright か .bin/vitest が
// 実在するかまで確認してから採用する。
function findNodeModulesRoot(startDir) {
    let dir = startDir;
    for (;;) {
        const cand = join(dir, 'node_modules');
        if (existsSync(cand) && (existsSync(join(cand, '.bin', 'playwright')) || existsSync(join(cand, '.bin', 'vitest')))) {
            return realpathSync(cand);
        }
        const parent = dirname(dir);
        if (parent === dir) throw new Error(`node_modules(playwright/vitestの実体入り)が見つからない(探索開始: ${startDir})`);
        dir = parent;
    }
}
const NODE_MODULES = findNodeModulesRoot(REPO_ROOT);
const PW_BIN = join(NODE_MODULES, '.bin', 'playwright');
const VITEST_BIN = join(NODE_MODULES, '.bin', 'vitest');

function linkNodeModules(worktreePath) {
    const linkPath = join(worktreePath, 'node_modules');
    if (existsSync(linkPath)) return;
    symlinkSync(NODE_MODULES, linkPath, 'dir');
    try {
        const a = readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf-8');
        const b = readFileSync(join(worktreePath, 'package-lock.json'), 'utf-8');
        if (a !== b) {
            log(`警告: ${worktreePath} の package-lock.json が作業側と異なる。node_modules は作業側のものを共有している(既知の制約)`);
        }
    } catch { /* package-lock.json が無い版は無視 */ }
}

// ---------- port 確認 ----------
function checkPortFree(port) {
    return new Promise((res) => {
        const srv = createServer();
        srv.once('error', () => res(false));
        srv.listen(Number(port), '127.0.0.1', () => srv.close(() => res(true)));
    });
}
async function waitPortFree(port, attempts = 5, intervalMs = 500) {
    for (let i = 0; i < attempts; i++) {
        if (await checkPortFree(port)) return true;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}

// ---------- child process ----------
function run(bin, args, opts) {
    return new Promise((res, rej) => {
        const child = spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('close', (code) => res({ code, out, err }));
        child.on('error', rej);
    });
}
function spawnSyncGit(args, opts) {
    return spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8', ...opts });
}

// ---------- git worktree の生成・片付け ----------
const createdWorktrees = [];
function addWorktree(path, ref) {
    log(`git worktree add --detach ${path} ${ref}`);
    const r = spawnSyncGit(['worktree', 'add', '--detach', path, ref]);
    if (r.status !== 0) throw new Error(`git worktree add 失敗(${ref}): ${r.stderr}`);
    createdWorktrees.push(path);
}
let cleaned = false;
function cleanupWorktrees() {
    if (cleaned) return;
    cleaned = true;
    for (const p of createdWorktrees.splice(0)) {
        if (KEEP) { log(`--keep指定のため残す: ${p}`); continue; }
        const r = spawnSyncGit(['worktree', 'remove', '--force', p]);
        if (r.status !== 0) log(`警告: worktree remove 失敗 ${p}: ${r.stderr}`);
    }
    if (!KEEP) spawnSyncGit(['worktree', 'prune']);
}
process.on('SIGINT', () => { cleanupWorktrees(); process.exit(130); });
process.on('SIGTERM', () => { cleanupWorktrees(); process.exit(143); });

// ---------- テスト実行 ----------
async function runE2E(sideDir, outFile, {
    extraArgs = [], grep = GREP, grepInvert = EXCLUDE_INVERT_PATTERN, project,
} = {}) {
    const free = await waitPortFree(PORT);
    if (!free) throw new Error(`port ${PORT} が使用中。別プロセスのサーバーが残っていないか確認してから再実行すること`);
    const args = ['test', '--reporter=json', ...extraArgs];
    if (project) args.push('--project', project);
    if (grep) args.push('--grep', grep);
    if (grepInvert) args.push('--grep-invert', grepInvert);
    const env = {
        ...process.env, PORT, PLAYWRIGHT_BASE_URL: `http://localhost:${PORT}`, PLAYWRIGHT_JSON_OUTPUT_NAME: outFile,
    };
    if (INIT_STORAGE_JSON) env.E2E_INIT_STORAGE = INIT_STORAGE_JSON;
    log(`[E2E] cwd=${sideDir} args=${args.join(' ')}`);
    const r = await run(PW_BIN, args, { cwd: sideDir, env });
    writeFileSync(`${outFile}.log`, `exit=${r.code}\n${r.out}\n${r.err}`);
    return r;
}
async function runVitest(sideDir, outFile, { extraArgs = [], grep = GREP } = {}) {
    const args = ['run', '--reporter=json', `--outputFile=${outFile}`, ...extraArgs];
    if (grep) args.push('-t', grep);
    log(`[vitest] cwd=${sideDir} args=${args.join(' ')}`);
    const r = await run(VITEST_BIN, args, { cwd: sideDir, env: process.env });
    writeFileSync(`${outFile}.log`, `exit=${r.code}\n${r.out}\n${r.err}`);
    return r;
}

// ---------- 流し直し(新しく落ちたものを再実行し flake/regression/判定不能を分ける) ----------
// イシュー#510: E2Eはテスト名(--grep)ではなく file:line + --project で指定する(理由はlib冒頭コメント)。
// 対象テストが結果に見つからない回(No tests found・実行件数0 等)は失敗扱いにせずnull(判定不能)にする。
async function classifyRetries(workDir, results) {
    if (results.e2e?.newlyFailed.length) {
        const items = results.e2e.newlyFailed;
        const byProject = groupE2ERetryTargetsByProject(items);
        const outcomes = new Map(items.map((i) => [i.key, []]));
        for (let i = 1; i <= RETRIES; i++) {
            for (const [project, lines] of byProject) {
                const outFile = join(OUT, `retry-e2e-${i}-${project}.json`);
                // grep: '' で既定のGREPを上書きして外す(file:lineで既に対象を絞っているため不要・
                // 二重に絞ると却って一致しなくなる)。grepInvert(除外)は既定どおり渡す(#507を壊さない)。
                await runE2E(workDir, outFile, { extraArgs: [...lines], project, grep: '' });
                const tests = parsePlaywrightJson(outFile, { log });
                for (const item of items) {
                    if (item.work?.project !== project) continue;
                    outcomes.get(item.key).push(findMatchOutcome(tests, item));
                }
            }
        }
        for (const item of items) {
            const passes = outcomes.get(item.key);
            item.retryPasses = passes;
            item.verdict = classifyVerdict(passes);
        }
    }
    if (results.unit?.newlyFailed.length) {
        const items = results.unit.newlyFailed;
        const { files, pattern } = buildVitestRetryArgs(items);
        const outcomes = new Map(items.map((i) => [i.key, []]));
        for (let i = 1; i <= RETRIES; i++) {
            const outFile = join(OUT, `retry-unit-${i}.json`);
            await runVitest(workDir, outFile, { extraArgs: files, grep: pattern });
            const tests = parseVitestJson(workDir, outFile, { log });
            for (const item of items) {
                outcomes.get(item.key).push(findMatchOutcome(tests, item, { matchProject: false }));
            }
        }
        for (const item of items) {
            const passes = outcomes.get(item.key);
            item.retryPasses = passes;
            item.verdict = classifyVerdict(passes);
        }
    }
}

// ---------- 報告 ----------
function mdEscape(s) { return String(s).replace(/\|/g, '\\|'); }
function table(headers, rows) {
    if (!rows.length) return '_(0件)_\n';
    const head = `| ${headers.join(' | ')} |`;
    const sep = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map((r) => `| ${r.map(mdEscape).join(' | ')} |`).join('\n');
    return `${head}\n${sep}\n${body}\n`;
}
function toolSection(name, cat) {
    if (!cat) return `### ${name}\n\n(skip)\n`;
    const nf = cat.newlyFailed.map((i) => [i.work?.file ?? i.base?.file ?? '', i.work?.title ?? i.base?.title ?? '', i.work?.project ?? '', verdictLabel(i.verdict)]);
    const np = cat.newlyPassed.map((i) => [i.base?.file ?? '', i.base?.title ?? '', i.base?.project ?? '']);
    const bf = cat.bothFailed.map((i) => [i.work?.file ?? '', i.work?.title ?? '', i.work?.project ?? '']);
    let s = `### ${name}\n\n`;
    s += `**新しく落ちた (${nf.length}件)**\n\n${table(['file', 'title', 'project', '判定'], nf)}\n`;
    s += `**新しく通った (${np.length}件)**\n\n${table(['file', 'title', 'project'], np)}\n`;
    s += `**両方で落ちた/既存の問題 (${bf.length}件)**\n\n${table(['file', 'title', 'project'], bf)}\n`;
    return s;
}
function excludeSection(excludes) {
    let s = '### 除外したテスト (E2E・playwright)\n\n';
    s += excludes.length
        ? `${table(['パターン', '出どころ', '理由'], excludes.map((e) => [e.pattern, e.source, e.reason]))}\n`
        : '除外なし（全件実行）\n\n';
    s += '_(vitestはCI設定(ci.yml)に除外が無いため対象外。上記はE2E(playwright)にのみ適用)_\n';
    return s;
}
function buildReport({ baseRef, baseSha, workLabel, excludes, results }) {
    const undeterminedCount = countUndetermined(results);
    const md = [
        '# e2e-diff-main 結果', '',
        `- base: ${baseRef} @ ${baseSha}`,
        `- work: ${workLabel}`,
        `- 生成: ${new Date().toISOString()}`,
        `- 判定不能（流し直しで実行0件・regressionに含めない・イシュー#510）: ${undeterminedCount}件`,
        '',
        excludeSection(excludes),
        toolSection('E2E (playwright)', results.e2e),
        toolSection('Unit (vitest)', results.unit),
        results.visual
            ? `### 画像の差分 (playwright.visual.config.js・work側のみ)\n\n- ${visualFailedCount(results)}件 / ${results.visual.total}件 が差分あり\n${results.visual.failedNames.length ? table(['file > title [project]'], results.visual.failedNames.map((n) => [n])) : ''}`
            : '### 画像の差分 (playwright.visual.config.js・work側のみ)\n\n(skip)\n',
    ].join('\n');
    return { md, json: { baseRef, baseSha, workLabel, excludes, results } };
}
function visualFailedCount(results) { return results.visual ? results.visual.failed : 0; }

// ---------- main ----------
async function main() {
    log(`REPO_ROOT=${REPO_ROOT}`);
    log(`OUT=${OUT}`);
    log(`BASE_REF=${BASE_REF} SELF=${SELF} PORT=${PORT} GREP=${GREP || '(none)'}`);
    log(`INIT_STORAGE: ${INIT_STORAGE_JSON || '(none)'}`);
    log(EXCLUDES.length
        ? `除外(E2E): ${EXCLUDES.map((e) => e.pattern).join('|')} (${EXCLUDES.length}件・出どころと理由はreport参照)`
        : '除外(E2E): なし(全件実行)');

    const fetchResult = spawnSyncGit(['fetch', 'origin']);
    if (fetchResult.status !== 0) log(`警告: git fetch origin 失敗(続行する): ${fetchResult.stderr}`);

    const baseWt = join(OUT, '_worktree-base');
    addWorktree(baseWt, BASE_REF);
    linkNodeModules(baseWt);
    const baseSha = spawnSyncGit(['rev-parse', 'HEAD'], { cwd: baseWt }).stdout.trim();

    let workDir;
    let workLabel;
    if (SELF) {
        const selfWt = join(OUT, '_worktree-self');
        addWorktree(selfWt, BASE_REF);
        linkNodeModules(selfWt);
        workDir = selfWt;
        workLabel = `${BASE_REF} @ ${baseSha} (--self: 自分自身との比較用の別worktree)`;
    } else {
        workDir = REPO_ROOT;
        const workSha = spawnSyncGit(['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).stdout.trim();
        workLabel = `作業ツリー(HEAD=${workSha}・未コミット差分含む可能性あり)`;
    }
    log(`base: ${BASE_REF} @ ${baseSha}`);
    log(`work: ${workLabel}`);

    const results = { e2e: null, unit: null, visual: null };

    if (!SKIP_E2E) {
        const baseOut = join(OUT, 'base.e2e.json');
        const workOut = join(OUT, 'work.e2e.json');
        await runE2E(baseWt, baseOut);
        await runE2E(workDir, workOut);
        results.e2e = categorize(parsePlaywrightJson(baseOut, { log }), parsePlaywrightJson(workOut, { log }));
    } else {
        log('--skip-e2e: E2Eはスキップした');
    }

    if (!SKIP_VITEST) {
        const baseOut = join(OUT, 'base.vitest.json');
        const workOut = join(OUT, 'work.vitest.json');
        await runVitest(baseWt, baseOut);
        await runVitest(workDir, workOut);
        results.unit = categorize(parseVitestJson(baseWt, baseOut, { log }), parseVitestJson(workDir, workOut, { log }));
    } else {
        log('--skip-vitest: vitestはスキップした');
    }

    if (VISUAL) {
        const cfgPath = join(workDir, 'playwright.visual.config.js');
        if (!existsSync(cfgPath)) {
            log('--visual: playwright.visual.config.js が無い。今回はスキップした');
        } else {
            // 画像比較は「base(origin/main)にはまだ無い基準画像」を前提にするものなので、
            // E2E/vitestのようなbase対work比較にはしない。work側(=基準画像とその場のレンダリングの
            // toHaveScreenshot比較)をそのまま流し、失敗件数と名前だけ報告する(計画§3-3)。
            const outFile = join(OUT, 'work.visual.json');
            const free = await waitPortFree(PORT);
            if (!free) throw new Error(`port ${PORT} が使用中(visual)。別プロセスのサーバーが残っていないか確認してから再実行すること`);
            const env = {
                ...process.env, PORT, PLAYWRIGHT_BASE_URL: `http://localhost:${PORT}`, PLAYWRIGHT_JSON_OUTPUT_NAME: outFile,
            };
            log(`[visual] cwd=${workDir} (work側の画像比較を実行)`);
            const r = await run(PW_BIN, ['test', '--config=playwright.visual.config.js', '--reporter=json'], { cwd: workDir, env });
            writeFileSync(`${outFile}.log`, `exit=${r.code}\n${r.out}\n${r.err}`);
            const visualTests = parsePlaywrightJson(outFile, { log });
            const failed = [...visualTests.values()].filter((t) => t.failed);
            results.visual = {
                total: visualTests.size,
                failed: failed.length,
                failedNames: failed.map((t) => `${t.file} > ${t.title} [${t.project}]`),
            };
            log(`[visual] ${visualTests.size}件中${failed.length}件が画像差分で失敗`);
        }
    }

    const newlyFailedCount = (results.e2e?.newlyFailed.length ?? 0) + (results.unit?.newlyFailed.length ?? 0);
    if (newlyFailedCount > 0) {
        log(`新しく落ちたテスト ${newlyFailedCount}件 を work側で${RETRIES}回流し直す`);
        await classifyRetries(workDir, results);
    }

    const report = buildReport({ baseRef: BASE_REF, baseSha, workLabel, excludes: EXCLUDES, results });
    writeFileSync(join(OUT, 'report.md'), report.md);
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report.json, null, 2));
    console.log('');
    console.log(report.md);
    log(`結果一式: ${OUT}`);

    const regressionCount = countRegressions(results);
    const undeterminedCount = countUndetermined(results);
    if (undeterminedCount > 0) log(`判定不能(流し直しで実行0件) ${undeterminedCount}件・regressionには数えていない`);
    if (regressionCount > 0) {
        log(`リグレ ${regressionCount}件 → exit 1`);
        process.exitCode = 1;
    } else {
        log('新しく落ちたテストは0件(またはフレーク判定/判定不能のみ)');
    }
}

main()
    .catch((e) => { log(`失敗: ${e.stack || e.message}`); process.exitCode = 1; })
    .finally(() => { cleanupWorktrees(); });
