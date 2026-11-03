// CI の check-run annotation + GITHUB_STEP_SUMMARY に、visual(画像比較)の結果を出す。
//
// イシュー#527: visual は gh 未インストールの環境から artifact (差分画像) を認証なしで
// 取れないため、check-runs API や run 画面の HTML からでも読める形で数字を残す必要がある。
// scripts/ci-annotate-failures.mjs (E2E 用) と同じ collectSpecs パターンを使い、
// 失敗したテストごとに toHaveScreenshot のエラーメッセージから
// 「X pixels (ratio Y of all image pixels) are different」を正規表現で抜いて
// 差分件数・最大差分率・該当テストをまとめる。
import fs from 'node:fs';

const REPORT_PATH = process.argv[2] || 'test-results-visual/visual.json';

function escMessage(message) {
    // GitHub workflow command のエスケープ (公式ドキュメント準拠)
    return String(message)
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A');
}

function escProp(value) {
    return String(value)
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A')
        .replace(/:/g, '%3A')
        .replace(/,/g, '%2C');
}

function printAnnotation(level, message, props = {}) {
    const configs = Object.entries(props)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([key, value]) => `${key}=${escProp(value)}`)
        .join(',');
    process.stdout.write(`::${level} ${configs}::${escMessage(message)}\n`);
}

// suites は再帰構造 (describe ネスト)。spec までの title 階層を連結して完全名を作る。
// ci-annotate-failures.mjs と同じ実装 (DRY: 将来両スクリプトが分岐したら共通化を検討)。
function collectSpecs(suite, titlePath, isRoot = false) {
    const out = [];
    const nextPath = !isRoot && suite.title ? [...titlePath, suite.title] : titlePath;
    for (const spec of suite.specs ?? []) {
        out.push({ spec, titlePath: nextPath });
    }
    for (const child of suite.suites ?? []) {
        out.push(...collectSpecs(child, nextPath, false));
    }
    return out;
}

// toHaveScreenshot の失敗メッセージから "111452 pixels (ratio 0.08 of all image pixels)" を抜く。
// 一致しない場合 (タイムアウト等、画像比較以外の失敗) は ratio を null にして件数だけ数える。
function parseDiffRatio(message) {
    const m = /(\d+) pixels \(ratio ([\d.]+) of all image pixels\) are different/.exec(message ?? '');
    if (!m) return { pixels: null, ratio: null };
    return { pixels: Number(m[1]), ratio: Number(m[2]) };
}

let report;
try {
    report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
} catch (err) {
    printAnnotation('warning', `${REPORT_PATH} を読めなかった: ${err.message}`, {
        title: 'visual summary スキップ'
    });
    process.exit(0);
}

const allSpecs = [];
for (const suite of report.suites ?? []) {
    allSpecs.push(...collectSpecs(suite, [], true));
}

let totalCount = 0;
const diffRows = []; // { line, ratio, pixels }

for (const { spec, titlePath } of allSpecs) {
    for (const test of spec.tests ?? []) {
        if (test.status === 'skipped') continue;
        totalCount++;
        if (test.status === 'expected') continue;

        const project = test.projectName ? `[${test.projectName}] ` : '';
        const fullTitle = [...titlePath, spec.title].filter(Boolean).join(' › ');
        const line = `${project}${fullTitle}`;

        const lastResult = test.results?.[test.results.length - 1];
        const message = lastResult?.error?.message ?? lastResult?.errors?.[0]?.message ?? '';
        const { pixels, ratio } = parseDiffRatio(message);
        diffRows.push({ line, ratio, pixels, status: test.status });
    }
}

const durationSec = report.stats?.duration != null ? (report.stats.duration / 1000).toFixed(1) : null;
const diffCount = diffRows.length;
const maxRow = diffRows.reduce((max, row) => {
    if (row.ratio == null) return max;
    if (max == null || row.ratio > max.ratio) return row;
    return max;
}, null);

// ::notice:: 集計 (1本・件数と所要時間)
printAnnotation('notice',
    `差分 ${diffCount}/${totalCount} 件`
    + (maxRow ? `・最大差分率 ${(maxRow.ratio * 100).toFixed(2)}%（${maxRow.line}）` : '')
    + (durationSec ? `・所要 ${durationSec}秒` : ''),
    { title: `visual 集計: 差分${diffCount}/${totalCount}件` }
);

// ::warning:: 一覧 (差分が1件以上ある時だけ・check-runs APIから件数+個票を読めるようにする)
if (diffCount > 0) {
    const listText = diffRows
        .map((r) => `${r.line}: ${r.ratio != null ? `ratio ${(r.ratio * 100).toFixed(3)}% (${r.pixels}px)` : '(画像比較以外の失敗 or ratio抽出不可)'}`)
        .join('\n');
    printAnnotation('warning', listText, { title: `visual 差分一覧 (${diffCount}件)` });
} else {
    printAnnotation('notice', '差分は無い (全件一致)', { title: 'visual 差分 0件' });
}

// GITHUB_STEP_SUMMARY (ローカル実行では未設定なのでスキップ)
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
    const lines = [];
    lines.push('## visual (画像比較) 実測結果');
    lines.push('');
    lines.push(`- 差が出た件数／全件: **${diffCount} / ${totalCount}**`);
    lines.push(`- 所要時間: ${durationSec ?? '不明'} 秒`);
    if (maxRow) {
        lines.push(`- 最大差分率: **${(maxRow.ratio * 100).toFixed(3)}%**（${maxRow.line}）`);
    }
    lines.push('');
    if (diffCount > 0) {
        lines.push('| テスト | 差分率 | 差分px |');
        lines.push('|---|---|---|');
        for (const r of diffRows) {
            lines.push(`| ${r.line} | ${r.ratio != null ? `${(r.ratio * 100).toFixed(3)}%` : '不明'} | ${r.pixels ?? '-'} |`);
        }
    } else {
        lines.push('差分は無い (全件一致)。');
    }
    lines.push('');
    fs.appendFileSync(summaryPath, lines.join('\n') + '\n');
}
