// e2e-diff-main.mjs の純粋ロジック(JSON解析・流し直し対象の組み立て・判定)を切り出したもの(イシュー#510)。
// ここに置く関数は spawn・fs書き込み等の副作用を持たない(テストしやすくするため)。
//
// 経緯(イシュー#510): 流し直し(classifyRetries)はテスト名をそのまま playwright の --grep に渡していた。
// しかしテスト名は parsePlaywrightJson が『ファイル名 > describe > test名』を ' > ' で連結した
// このスクリプト独自の形式で、playwright の --grep が照合する「空白連結のフルタイトル」とは一致しない
// (括弧などの特殊文字の有無に関係なく、そもそも一致しない)。一致しなければ playwright は
// 「No tests found」で exit し、流し直しの全3回が「失敗」と記録されて regression と誤判定されていた。
// 直し方: playwright JSON の spec.line から `<file>:<line>` の位置引数を組み立て、--project を付けて
// 実行する(グルーピングは groupE2ERetryTargetsByProject)。これはタイトルの連結形式・正規表現の
// 特殊文字・同名テストのどれにも依存しない。また「結果に見つからない」(No tests found・実行件数0・
// その他の理由で対象テストが結果に現れない)は false(失敗)ではなく null(判定不能)として記録する
// (findMatch / classifyVerdict)。

import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';

// ---------- 正規表現エスケープ(vitestの-t向け。vitestのfullNameは空白連結でvitest自身の照合形式と
// 一致するため、file:line化はせずエスケープのみで足りる) ----------
export function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---------- playwright JSON reporter の解析 ----------
// 返す各テストに line/column を持たせる(流し直しの file:line 位置引数の元)。
export function parsePlaywrightJson(path, { log = () => {} } = {}) {
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
                        line: spec.line, column: spec.column,
                    });
                }
            }
        }
        if (suite.suites) for (const s of suite.suites) walk(s, nextPath, file);
    }
    for (const top of data.suites || []) walk(top, [], undefined);
    return tests;
}

// ---------- vitest JSON reporter の解析 ----------
export function parseVitestJson(sideDir, path, { log = () => {} } = {}) {
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

// ---------- base/work比較 ----------
export function categorize(baseTests, workTests) {
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

// ---------- E2Eの流し直し対象を project ごとにグルーピングする(イシュー#510) ----------
// 同じ行に test.each 的なループがある場合(reimport-diff.spec.js:128 の order/direction 等)は
// その行に複数テストが乗るが、それは正しい挙動(行指定なので複数当たる)。結果の突き合わせは
// 従来どおり title+project で行う(findMatch)。
// 戻り値: Map<project, Set<"file:line">>。work側に line/project が無い item は読み飛ばす
// (その item は実行対象に入らず、最終的に実行0件=判定不能になる)。
export function groupE2ERetryTargetsByProject(items) {
    const byProject = new Map();
    for (const item of items) {
        const file = item.work?.file;
        const line = item.work?.line;
        const project = item.work?.project;
        if (file == null || line == null || project == null) continue;
        if (!byProject.has(project)) byProject.set(project, new Set());
        byProject.get(project).add(`${file}:${line}`);
    }
    return byProject;
}

// ---------- vitestの流し直し引数(ファイル一覧 + -t用パターン) ----------
export function buildVitestRetryArgs(items) {
    const files = [...new Set(items.map((i) => i.key.split('::')[1]))];
    const pattern = items.map((i) => escapeRegExp(i.work.title)).join('|');
    return { files, pattern };
}

// ---------- 1回の流し直し結果から、対象itemの通過/失敗/判定不能を決める ----------
// tests(そのPlaywright/vitest実行のJSON解析結果)に title(+project) で一致するテストが
// 見つからなければ null(判定不能)。見つかれば通過=true/失敗=false。
// 「結果に見つからない」理由(No tests found・実行件数0・その他)を区別しない
// (どの理由でも「この回では比較材料が無い」という扱いは同じにする)。
export function findMatchOutcome(tests, item, { matchProject = true } = {}) {
    const match = [...tests.values()].find(
        (t) => t.title === item.work.title && (!matchProject || t.project === item.work.project),
    );
    if (!match) return null;
    return !match.failed;
}

// ---------- 複数回の outcomes(true/false/null の配列) から verdict を決める ----------
// 実行された(=null以外の)回が1件も無ければ 'undetermined'(判定不能)。
// 実行された回のうち1回でも通過していれば 'flake'。
// 実行された回が全部失敗なら(1回でも) 'regression'。
// 例: [false, null, null] → 実行1回・全部失敗 → regression。
//     [null, null, null]  → 実行0回 → undetermined。
export function classifyVerdict(passes) {
    const executed = passes.filter((p) => p !== null);
    if (executed.length === 0) return 'undetermined';
    if (executed.some((p) => p === true)) return 'flake';
    return 'regression';
}

export const VERDICT_LABELS = {
    flake: 'flake',
    regression: 'regression',
    undetermined: '判定不能（流し直しで実行0件）',
};
export function verdictLabel(verdict) {
    if (!verdict) return '(未判定・流し直し無し)';
    return VERDICT_LABELS[verdict] ?? verdict;
}

// ---------- 画像比較(visual)の既定判定(イシュー#526) ----------
// #521の見た目の変化が--visual未指定のまま画像比較をすり抜けた反省から、UI対象パスで
// オン/オフを判定するロジックは持たず、既定で常にオンにする(判定ロジックが無い=
// 「新しいUIファイルを判定の対象一覧に追加し忘れる」という同種の見落としが構造的に起きない)。
// --no-visualを明示した時だけオフにする。--visualは後方互換で受け付けるが、既定で既に
// オンのため何も変えない(--visualと--no-visualが両方ある場合は明示的な除外を優先する)。
export function resolveVisual(argv) {
    if (argv.includes('--no-visual')) return { run: false, reason: 'スキップ（--no-visual 指定）' };
    return { run: true, reason: '実行（既定）' };
}

// ---------- 集計 ----------
export function countRegressions(results) {
    let n = 0;
    for (const cat of [results.e2e, results.unit]) {
        if (!cat) continue;
        for (const item of cat.newlyFailed) if (!item.verdict || item.verdict === 'regression') n += 1;
    }
    return n;
}
export function countUndetermined(results) {
    let n = 0;
    for (const cat of [results.e2e, results.unit]) {
        if (!cat) continue;
        for (const item of cat.newlyFailed) if (item.verdict === 'undetermined') n += 1;
    }
    return n;
}
