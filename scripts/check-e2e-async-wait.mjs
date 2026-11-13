// tests/e2e 配下(spec と helpers)で、waitForFunction に async 関数を渡している所を検出して失敗させる(イシュー#607)。
// 背景: waitForFunction は述語の返り値が真になるまで待つが、async 関数は Promise を返し、Promise は常に真とみなされる。
// そのため中身が偽でも1回目で通り、「待ったつもり」のまま次へ進む。門のE2E J6-1 は、これでフォルダへの書き込みを
// 待たずに再読込し、アプリの不具合(短文メモが消える)に見える赤になっていた(#607 で実測。存在しない文字列でも通った)。
// ファイル・IndexedDB など非同期でしか読めないものを待つ時は expect.poll(() => page.evaluate(async …)) を使う。
//
// 見るもの: 呼び出し名が waitForFunction(page・frame 等どれのものでも)で、第1引数が
//   - async のアロー関数・関数式
//   - 同じファイルで async 関数として宣言・代入した名前
// 門の書き方の lint(scripts/check-e2e-gate.mjs)は @gate のファイルだけを読み、結果を門の判定(gate-report)へ渡すため、
// 門に数えないテストまで見るこの検査は別にした。
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'range', 'comments', 'errors', 'tokens',
    'leadingComments', 'trailingComments', 'innerComments']);

const isNode = (v) => v !== null && typeof v === 'object' && typeof v.type === 'string';
const isAsyncFn = (n) => isNode(n) && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration') && n.async === true;

function walk(node, visit) {
    visit(node);
    for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) continue;
        const v = node[key];
        if (Array.isArray(v)) { for (const c of v) if (isNode(c)) walk(c, visit); }
        else if (isNode(v)) walk(v, visit);
    }
}

function calleeName(callee) {
    if (callee.type === 'Identifier') return callee.name;
    if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && !callee.computed && callee.property.type === 'Identifier') return callee.property.name;
    if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && callee.property.type === 'StringLiteral') return callee.property.value;
    return null;
}

/** ソース1つの違反を返す。 @param {string} code @returns {{ line: number, text: string }[]} */
export function findAsyncWaits(code) {
    const ast = parse(code, { sourceType: 'module' });
    const asyncNames = new Set();
    walk(ast.program, (n) => {
        if (n.type === 'FunctionDeclaration' && n.id && n.async) asyncNames.add(n.id.name);
        if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && isAsyncFn(n.init)) asyncNames.add(n.id.name);
    });
    const found = [];
    walk(ast.program, (n) => {
        if (n.type !== 'CallExpression' && n.type !== 'OptionalCallExpression') return;
        if (calleeName(n.callee) !== 'waitForFunction') return;
        const arg = n.arguments[0];
        if (isAsyncFn(arg)) found.push({ line: n.loc.start.line, text: 'async 関数を渡している' });
        else if (isNode(arg) && arg.type === 'Identifier' && asyncNames.has(arg.name)) found.push({ line: n.loc.start.line, text: `async 関数 ${arg.name} を渡している` });
    });
    return found;
}

function walkFiles(dir, out = []) {
    for (const entry of readdirSync(dir).sort()) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walkFiles(full, out);
        else if (extname(entry) === '.js' || extname(entry) === '.mjs') out.push(full);
    }
    return out;
}

/** @param {{ dir?: string }} [opts] dir: 走査する所(既定は tests/e2e。lint 自身のテストが見本の置き場を指す) */
export function lintAsyncWaits(opts = {}) {
    const dir = opts.dir ?? join(ROOT, 'tests/e2e');
    const files = walkFiles(dir);
    const violations = [];
    for (const file of files) {
        const rel = relative(ROOT, file).split(sep).join('/');
        let hits;
        try { hits = findAsyncWaits(readFileSync(file, 'utf-8')); } catch (err) {
            violations.push({ file: rel, line: err.loc?.line ?? 1, text: `構文を読めない: ${err.message}` });
            continue;
        }
        for (const h of hits) violations.push({ file: rel, ...h });
    }
    return { files: files.length, violations };
}

function main() {
    const { files, violations } = lintAsyncWaits();
    if (violations.length > 0) {
        console.error('waitForFunction に async 関数を渡している所が見つかりました(Promise は真とみなされ、待たずに通る。expect.poll(() => page.evaluate(async …)) に直すこと。イシュー#607):');
        for (const v of violations) console.error(`  ${v.file}:${v.line}: ${v.text}`);
        console.error(`\n合計 ${violations.length} 件`);
        process.exit(1);
    }
    console.log(`OK: tests/e2e 配下 ${files} ファイルに、waitForFunction へ async 関数を渡す所は0件`);
    process.exit(0);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
