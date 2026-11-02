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
//     [--out=<dir>] [--port=<n>] [--retries=<n>] [--keep]
//
//   --self        base側と同じrefで、workも別の一時worktreeにする(自分自身との比較=誤検知の確認用)。
//   --grep        両側・絞り込み試走用。playwrightの--grep/vitestの-tにそのまま渡す。
//   --out         結果の置き場(既定: 作業ツリーの外・恒久的な場所。runをまたいで残る。tmp配下ではない)。
//   --port        既定は環境変数PORTまたは8000(playwright.config.jsと同じ規則)。
//   --retries     新しく落ちたものの流し直し回数(既定3・計画§3-2の4)。
//   --keep        デバッグ用。一時worktreeを片付けずに残す(通常は使わない)。
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

// ---------- 引数 ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
    const pre = `--${name}=`;
    const found = argv.find((a) => a.startsWith(pre));
    return found ? found.slice(pre.length) : def;
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
async function runE2E(sideDir, outFile, { extraArgs = [], grep = GREP } = {}) {
    const free = await waitPortFree(PORT);
    if (!free) throw new Error(`port ${PORT} が使用中。別プロセスのサーバーが残っていないか確認してから再実行すること`);
    const args = ['test', '--reporter=json', ...extraArgs];
    if (grep) args.push('--grep', grep);
    const env = {
        ...process.env, PORT, PLAYWRIGHT_BASE_URL: `http://localhost:${PORT}`, PLAYWRIGHT_JSON_OUTPUT_NAME: outFile,
    };
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

// ---------- JSON reporter の解析 ----------
function parsePlaywrightJson(path) {
    if (!existsSync(path)) { log(`警告: ${path} が無い(0テスト一致 or 実行失敗)`); return new Map(); }
    let data;
    try { data = JSON.parse(readFileSync(path, 'utf-8')); } catch (e) {
        log(`警告: ${path} のJSON解析に失敗: ${e.message}`); return new Map();
    }
    const tests = new Map();
    function walk(suite, titlePath, fileCtx) {
        const file = suite.file || fileCtx;
        const nextPath = suite.title ? [...titlePath, suite.title] : titlePath;
        if (suite.specs) {
            for (const spec of suite.specs) {
                const title = [...nextPath, spec.title].filter(Boolean).join(' > ');
                for (const t of spec.tests) {
                    const key = `e2e::${file}::${title}::${t.projectName}`;
                    tests.set(key, {
                        tool: 'e2e', file, title, project: t.projectName, status: t.status, failed: t.status === 'unexpected',
                    });
                }
            }
        }
        if (suite.suites) for (const s of suite.suites) walk(s, nextPath, file);
    }
    for (const top of data.suites || []) walk(top, [], undefined);
    return tests;
}
function parseVitestJson(sideDir, path) {
    if (!existsSync(path)) { log(`警告: ${path} が無い(0テスト一致 or 実行失敗)`); return new Map(); }
    let data;
    try { data = JSON.parse(readFileSync(path, 'utf-8')); } catch (e) {
        log(`警告: ${path} のJSON解析に失敗: ${e.message}`); return new Map();
    }
    const tests = new Map();
    for (const tf of data.testResults || []) {
        const file = relative(sideDir, tf.name);
        for (const ar of tf.assertionResults || []) {
            const key = `unit::${file}::${ar.fullName}`;
            tests.set(key, { tool: 'unit', file, title: ar.fullName, project: undefined, status: ar.status, failed: ar.status === 'failed' });
        }
    }
    return tests;
}

// ---------- 比較 ----------
function categorize(baseTests, workTests) {
    const newlyFailed = [];
    const newlyPassed = [];
    const bothFailed = [];
    const allKeys = new Set([...baseTests.keys(), ...workTests.keys()]);
    for (const key of allKeys) {
        const b = baseTests.get(key);
        const w = workTests.get(key);
        const bFailed = b ? b.failed : false;
        const wFailed = w ? w.failed : false;
        if (wFailed && !bFailed) newlyFailed.push({ key, base: b, work: w });
        else if (bFailed && !wFailed) newlyPassed.push({ key, base: b, work: w });
        else if (bFailed && wFailed) bothFailed.push({ key, base: b, work: w });
    }
    return { newlyFailed, newlyPassed, bothFailed };
}
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function classifyRetries(workDir, results) {
    if (results.e2e?.newlyFailed.length) {
        const items = results.e2e.newlyFailed;
        const files = [...new Set(items.map((i) => i.key.split('::')[1]))];
        const pattern = items.map((i) => escapeRegExp(i.work.title)).join('|');
        const outcomes = new Map(items.map((i) => [i.key, []]));
        for (let i = 1; i <= RETRIES; i++) {
            const outFile = join(OUT, `retry-e2e-${i}.json`);
            await runE2E(workDir, outFile, { extraArgs: files, grep: pattern });
            const tests = parsePlaywrightJson(outFile);
            for (const item of items) {
                const match = [...tests.values()].find((t) => t.title === item.work.title && t.project === item.work.project);
                outcomes.get(item.key).push(match ? !match.failed : false);
            }
        }
        for (const item of items) {
            const passes = outcomes.get(item.key);
            item.retryPasses = passes;
            item.verdict = passes.some((p) => p) ? 'flake' : 'regression';
        }
    }
    if (results.unit?.newlyFailed.length) {
        const items = results.unit.newlyFailed;
        const files = [...new Set(items.map((i) => i.key.split('::')[1]))];
        const pattern = items.map((i) => escapeRegExp(i.work.title)).join('|');
        const outcomes = new Map(items.map((i) => [i.key, []]));
        for (let i = 1; i <= RETRIES; i++) {
            const outFile = join(OUT, `retry-unit-${i}.json`);
            await runVitest(workDir, outFile, { extraArgs: files, grep: pattern });
            const tests = parseVitestJson(workDir, outFile);
            for (const item of items) {
                const match = [...tests.values()].find((t) => t.title === item.work.title);
                outcomes.get(item.key).push(match ? !match.failed : false);
            }
        }
        for (const item of items) {
            const passes = outcomes.get(item.key);
            item.retryPasses = passes;
            item.verdict = passes.some((p) => p) ? 'flake' : 'regression';
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
    const nf = cat.newlyFailed.map((i) => [i.work?.file ?? i.base?.file ?? '', i.work?.title ?? i.base?.title ?? '', i.work?.project ?? '', i.verdict ?? '(未判定・流し直し無し)']);
    const np = cat.newlyPassed.map((i) => [i.base?.file ?? '', i.base?.title ?? '', i.base?.project ?? '']);
    const bf = cat.bothFailed.map((i) => [i.work?.file ?? '', i.work?.title ?? '', i.work?.project ?? '']);
    let s = `### ${name}\n\n`;
    s += `**新しく落ちた (${nf.length}件)**\n\n${table(['file', 'title', 'project', '判定'], nf)}\n`;
    s += `**新しく通った (${np.length}件)**\n\n${table(['file', 'title', 'project'], np)}\n`;
    s += `**両方で落ちた/既存の問題 (${bf.length}件)**\n\n${table(['file', 'title', 'project'], bf)}\n`;
    return s;
}
function buildReport({ baseRef, baseSha, workLabel, results }) {
    const md = [
        '# e2e-diff-main 結果', '',
        `- base: ${baseRef} @ ${baseSha}`,
        `- work: ${workLabel}`,
        `- 生成: ${new Date().toISOString()}`,
        '',
        toolSection('E2E (playwright)', results.e2e),
        toolSection('Unit (vitest)', results.unit),
        results.visual
            ? `### 画像の差分 (playwright.visual.config.js・work側のみ)\n\n- ${visualFailedCount(results)}件 / ${results.visual.total}件 が差分あり\n${results.visual.failedNames.length ? table(['file > title [project]'], results.visual.failedNames.map((n) => [n])) : ''}`
            : '### 画像の差分 (playwright.visual.config.js・work側のみ)\n\n(skip)\n',
    ].join('\n');
    return { md, json: { baseRef, baseSha, workLabel, results } };
}
function visualFailedCount(results) { return results.visual ? results.visual.failed : 0; }
function countRegressions(results) {
    let n = 0;
    for (const cat of [results.e2e, results.unit]) {
        if (!cat) continue;
        for (const item of cat.newlyFailed) if (!item.verdict || item.verdict === 'regression') n += 1;
    }
    return n;
}

// ---------- main ----------
async function main() {
    log(`REPO_ROOT=${REPO_ROOT}`);
    log(`OUT=${OUT}`);
    log(`BASE_REF=${BASE_REF} SELF=${SELF} PORT=${PORT} GREP=${GREP || '(none)'}`);

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
        results.e2e = categorize(parsePlaywrightJson(baseOut), parsePlaywrightJson(workOut));
    } else {
        log('--skip-e2e: E2Eはスキップした');
    }

    if (!SKIP_VITEST) {
        const baseOut = join(OUT, 'base.vitest.json');
        const workOut = join(OUT, 'work.vitest.json');
        await runVitest(baseWt, baseOut);
        await runVitest(workDir, workOut);
        results.unit = categorize(parseVitestJson(baseWt, baseOut), parseVitestJson(workDir, workOut));
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
            const visualTests = parsePlaywrightJson(outFile);
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

    const report = buildReport({ baseRef: BASE_REF, baseSha, workLabel, results });
    writeFileSync(join(OUT, 'report.md'), report.md);
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report.json, null, 2));
    console.log('');
    console.log(report.md);
    log(`結果一式: ${OUT}`);

    const regressionCount = countRegressions(results);
    if (regressionCount > 0) {
        log(`リグレ ${regressionCount}件 → exit 1`);
        process.exitCode = 1;
    } else {
        log('新しく落ちたテストは0件(またはフレーク判定のみ)');
    }
}

main()
    .catch((e) => { log(`失敗: ${e.stack || e.message}`); process.exitCode = 1; })
    .finally(() => { cleanupWorktrees(); });
