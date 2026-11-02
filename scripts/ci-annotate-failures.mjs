// CI の check-run annotation に、失敗した E2E テスト名を出す。
//
// playwright.config.js の github reporter は個々の失敗テストに ::error を出すが、
// GitHub Actions の annotation は 1 step あたり error/warning それぞれ最大10件しか
// 表示されない (超えた分は捨てられる)。そのため落ちたテストが10件を超えると
// github reporter 単独では特定漏れが起きる (イシュー#349 ②申し送り)。
//
// この step は test-results/e2e.json (playwright.config.js の json reporter 出力) を読み、
// 「最終的に失敗した全テスト」を件数1本・一覧1本の annotation に圧縮して出す。
//
// イシュー#508 で判明した不具合の修正: 旧実装は test.results[0].status (1回目の結果) だけを
// 見て「passed以外なら失敗扱い」にしていたため、tests/e2e/char/*.spec.js のような
// test.skip(testInfo.project.name !== '<対象device>', ...) パターン(design通り・対象外deviceで
// 意図的にskip)が、丸ごと「失敗」としてannotationに混入していた(#508実測: b06fdd5で
// 429件のうち428件がこのskipで、実際の失敗は1件のみ)。また retries を設定していないため
// FLAKY(リトライで通った)は原理的に発生しないが、旧実装は「リトライで通ったFLAKY含む」という
// 固定文言を無条件に出していた。
//
// 修正: test-level の outcome (`test.status`: 'expected'|'unexpected'|'flaky'|'skipped') で
// 分類する。'skipped' は失敗ではないので件数から除外し、'unexpected'(最後まで失敗)と
// 'flaky'(リトライで通った)を分けて数える・一覧も分ける。FLAKY の annotation は実際に
// 1件以上あるときだけ出す。
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

const failedTests = [];
const flakyTests = [];
let skippedCount = 0;

for (const { spec, titlePath } of allSpecs) {
    for (const test of spec.tests ?? []) {
        // test.status は test-level の outcome:
        // 'expected' (通った) | 'unexpected' (最後まで失敗) | 'flaky' (リトライで通った) | 'skipped'
        if (test.status === 'skipped') {
            skippedCount++;
            continue;
        }
        if (test.status === 'expected') continue;

        const project = test.projectName ? `[${test.projectName}] › ` : '';
        const fullTitle = [...titlePath, spec.title].filter(Boolean).join(' › ');
        const line = `${project}${spec.file} › ${fullTitle}`;

        if (test.status === 'flaky') flakyTests.push(line);
        else failedTests.push(line); // 'unexpected'
    }
}

if (failedTests.length === 0 && flakyTests.length === 0) {
    printAnnotation('notice', '失敗したテストは無い', {
        title: 'E2E 失敗 0件'
    });
} else {
    if (failedTests.length > 0) {
        printAnnotation('error', `${failedTests.length} 件が最後まで失敗 (個別のannotationはGitHub側で各10件に切られるため、件数と全件一覧は別途このannotationで出す)`, {
            title: `E2E 失敗 合計${failedTests.length}件`
        });
        printAnnotation('error', failedTests.join('\n'), {
            title: 'E2E 失敗テスト一覧'
        });
    }
    if (flakyTests.length > 0) {
        printAnnotation('warning', `${flakyTests.length} 件がリトライで通った (不安定さを隠さないため一覧を出す)`, {
            title: `E2E FLAKY 合計${flakyTests.length}件`
        });
        printAnnotation('warning', flakyTests.join('\n'), {
            title: 'E2E FLAKY テスト一覧'
        });
    }
}

if (skippedCount > 0) {
    // 失敗ではない (design通りのtest.skip()、例: char端末別の対象外skip)。参考情報として出す。
    printAnnotation('notice', `${skippedCount} 件が test.skip() で対象外とされた (失敗ではない・設計通り)`, {
        title: `E2E skip ${skippedCount}件`
    });
}
