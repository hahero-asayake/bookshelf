// CI の check-run annotation に、1回目の実行で失敗した E2E テスト名を出す。
//
// playwright.config.js の github reporter は個々の失敗テストに ::error を出すが、
// GitHub Actions の annotation は 1 step あたり error/warning それぞれ最大10件しか
// 表示されない (超えた分は捨てられる)。そのため落ちたテストが10件を超えると
// github reporter 単独では特定漏れが起きる (イシュー#349 ②申し送り)。
//
// この step は test-results/e2e.json (playwright.config.js の json reporter 出力) を読み、
// 「1回目の実行で失敗した全テスト」を件数1本・一覧1本の annotation に圧縮して出す。
// リトライで最終的に通った FLAKY も、不安定さを隠さないため一覧に含める。
import fs from 'node:fs';

const REPORT_PATH = process.argv[2] || 'test-results/e2e.json';

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
// 最上位の suite は describe ではなくファイル自体 (title = ファイル名) なので、
// ファイル名は spec.file の方で出すため titlePath には含めない (isRoot で除外)。
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

let report;
try {
    report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
} catch (err) {
    // annotation 補完自体の失敗で job を落とさない (観測用の step のため)。
    printAnnotation('warning', `${REPORT_PATH} を読めなかった: ${err.message}`, {
        title: 'E2E annotation 補完スキップ'
    });
    process.exit(0);
}

const allSpecs = [];
for (const suite of report.suites ?? []) {
    allSpecs.push(...collectSpecs(suite, [], true));
}

const firstRunFailures = [];
for (const { spec, titlePath } of allSpecs) {
    for (const test of spec.tests ?? []) {
        const firstResult = test.results?.[0];
        if (!firstResult || firstResult.status === 'passed') continue;
        // outcome: 'unexpected' (最終失敗) | 'flaky' (リトライで通過) | 'skipped' | 'expected'
        const kind = test.status === 'flaky' ? 'FLAKY' : 'FAIL';
        const project = test.projectName ? `[${test.projectName}] › ` : '';
        const fullTitle = [...titlePath, spec.title].filter(Boolean).join(' › ');
        firstRunFailures.push(`[${kind}] ${project}${spec.file} › ${fullTitle}`);
    }
}

if (firstRunFailures.length === 0) {
    printAnnotation('notice', '1回目の実行で失敗したテストは無い', {
        title: 'E2E 1回目失敗 0件'
    });
    process.exit(0);
}

printAnnotation('error', `1回目の実行で ${firstRunFailures.length} 件が失敗 (リトライで通ったFLAKY含む・個別のannotationはGitHub側で各10件に切られるため、件数と全件一覧は別途このannotationで出す)`, {
    title: `E2E 1回目失敗 合計${firstRunFailures.length}件`
});

printAnnotation('error', firstRunFailures.join('\n'), {
    title: 'E2E 1回目失敗テスト一覧'
});
