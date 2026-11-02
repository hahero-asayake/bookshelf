#!/usr/bin/env node
// イシュー#510 実データ確認: reimport-diff「direction: moved は wouldMove に一致し連鎖しない (#406)」
// [chromium] (_artifacts/509-diff/report.json で誤って regression 判定された実例) を対象に、
// 修正後の流し直し経路(lib.groupE2ERetryTargetsByProjectで組み立てたfile:line + --project、
// e2e-diff-main.mjsのclassifyRetries/runE2Eと同じ引数の付け方・--grepは渡さない)で
// 実際に1回以上実行し、実行件数・status・使ったコマンド引数を記録する。
// 全体比較(e2e-diff-main.mjsのフル実行)は時間がかかるため、ここでは単発確認のみ行う。
//
// 使い方: node scripts/verify/510-retry-check.mjs [--port=8110]

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMatchOutcome, groupE2ERetryTargetsByProject, parsePlaywrightJson } from './e2e-diff-lib.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
    const pre = `--${name}=`;
    const found = argv.find((a) => a.startsWith(pre));
    return found ? found.slice(pre.length) : def;
};
const PORT = opt('port', process.env.PORT || '8110');

const TARGET_FILE = 'reimport-diff.spec.js';
// parsePlaywrightJsonのtitleは『ファイル名 > (describe >) test名』を' > 'で連結した形式
// (このスクリプト独自の形式。#510の元バグはこれをそのまま--grepに渡していたこと)。
// findMatchOutcomeでの照合にはこの形式のtitleを使う(e2e-diff-main.mjsの実際の比較と同じ)。
const TARGET_TITLE = 'reimport-diff.spec.js > direction: moved は wouldMove に一致し連鎖しない (#406)';
const TARGET_PROJECT = 'chromium';
const SPAWN_TIMEOUT_MS = 90_000;

function findNodeModulesRoot(startDir) {
    let dir = startDir;
    for (;;) {
        const cand = join(dir, 'node_modules');
        if (existsSync(cand) && existsSync(join(cand, '.bin', 'playwright'))) return cand;
        const parent = dirname(dir);
        if (parent === dir) throw new Error(`node_modules(playwright実体入り)が見つからない(探索開始: ${startDir})`);
        dir = parent;
    }
}
const PW_BIN = join(findNodeModulesRoot(REPO_ROOT), '.bin', 'playwright');

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

function runPlaywright(args, outFile) {
    return spawnSync(process.execPath, [PW_BIN, 'test', ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        timeout: SPAWN_TIMEOUT_MS,
        env: {
            ...process.env, PORT, PLAYWRIGHT_BASE_URL: `http://localhost:${PORT}`, PLAYWRIGHT_JSON_OUTPUT_NAME: outFile,
        },
    });
}

async function main() {
    const outDir = mkdtempSync(join(tmpdir(), 'e2e-diff-510-retrycheck-'));

    // 1. 対象テストの現在のspec.lineをタイトル連結形式に依存せず確定する(ファイル全件を一度listする)。
    const listOut = join(outDir, 'list.json');
    if (!(await waitPortFree(PORT))) throw new Error(`port ${PORT} が使用中(1回目・list前)`);
    const listRes = runPlaywright([TARGET_FILE, '--project', TARGET_PROJECT, '--reporter=json'], listOut);
    const allTests = parsePlaywrightJson(listOut);
    const target = [...allTests.values()].find((t) => t.title === TARGET_TITLE && t.project === TARGET_PROJECT);
    if (!target) {
        throw new Error(`対象テストが現在の${TARGET_FILE}に見つからない(全件実行exit=${listRes.status}・${allTests.size}件中)`);
    }
    console.log(`[510-retry-check] 対象: ${target.file}:${target.line} [${target.project}] "${target.title}"`);

    // 2. e2e-diff-main.mjsのclassifyRetriesと同じ組み立て(groupE2ERetryTargetsByProject)で引数を作る。
    const items = [{ key: `e2e::${target.file}::${target.title}::${target.project}`, work: target }];
    const byProject = groupE2ERetryTargetsByProject(items);
    const lines = [...(byProject.get(TARGET_PROJECT) ?? [])];
    if (lines.length === 0) throw new Error('groupE2ERetryTargetsByProjectが対象行を返さなかった(line/project欠落)');

    // 3. runE2Eと同じ呼び方(--grepは渡さない・file:line位置引数+--project)で実際に実行(1回)。
    const outFile = join(outDir, 'retry.json');
    if (!(await waitPortFree(PORT))) throw new Error(`port ${PORT} が使用中(2回目・retry前)`);
    const retryExtraArgs = [...lines, '--project', TARGET_PROJECT, '--reporter=json'];
    console.log(`[510-retry-check] 実行コマンド: node ${PW_BIN} test ${retryExtraArgs.join(' ')}`);
    const retryRes = runPlaywright(retryExtraArgs, outFile);
    const retryTests = parsePlaywrightJson(outFile);
    const outcome = findMatchOutcome(retryTests, items[0]);

    const report = {
        target: { file: target.file, line: target.line, project: target.project, title: target.title },
        retryCommandArgs: ['test', ...retryExtraArgs],
        exitCode: retryRes.status,
        executedCount: retryTests.size,
        executedTests: [...retryTests.values()].map((t) => ({ title: t.title, project: t.project, status: t.status, failed: t.failed })),
        matchedOutcome: outcome, // true=通過 / false=失敗 / null=未発見(判定不能)
    };
    console.log(JSON.stringify(report, null, 2));
    const reportPath = join(outDir, 'report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`[510-retry-check] 結果: ${reportPath}`);

    if (report.executedCount < 1) {
        console.error('[510-retry-check] NG: 実行件数が0件(期待: 1以上)');
        process.exitCode = 1;
    } else {
        console.log(`[510-retry-check] OK: 実行件数=${report.executedCount}件(>=1)`);
    }
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
