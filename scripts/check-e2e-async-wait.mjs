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
//
// 2つ目の検査: ページ全体を写す待ち(イシュー#640)。
// 背景: Playwright 1.60 の expect は、要素1つ向けの matcher(toHaveCount・配列の形・toMatchAriaSnapshot 以外)で、
// 問い合わせのたびにページの構造の写し(aria snapshot)を作る。対象が見えない・無い時と、ページ単位の matcher
// (toHaveURL・toHaveTitle)では document.body 全体を写し、対象が大きな入れ物(body 等)なら中身を全部たどる。
// 913冊・CPU 6倍のページでは、この写しが1回の待ちを 1.4〜5.9 秒にし、その間アプリの処理も止まる(#640 で実測。
// 門のE2E J3-5 の「記録が5秒以内に出ない」の正体・#629)。toHaveCount と expect.poll(getAttribute) は写しを作らず、
// 0.1〜0.2 秒で済む。5冊の小さなページでは1件あたり数〜30ms で害は小さいので、禁止は次の2つに絞る。
//   - 全ファイル: 見えない印(selector に gate-timings・data-gate-・[hidden] を含む)を、写しを作る matcher で待つ
//     → toHaveCount(属性つき locator) か expect.poll(() => locator.getAttribute(…)) にする(J3-5 と同じ形)
//   - 大量の蔵書の spec(同じファイルで seedManyBooksForTest(page[, 100以上]) か Array.from({ length: 100以上 }) を使う):
//     - 見えない・無いことを待つ(toBeHidden・not.toBeVisible・not.toBeAttached) → toHaveCount(0)、見えないことは
//       expect(page.locator('<sel>:visible')).toHaveCount(0)
//     - ページ単位(toHaveURL・toHaveTitle) → page.waitForURL(…) か expect.poll(() => page.url())
//     - 大きな入れ物(locator('body'|'html'|'main'|'#bookshelf'|'#sidebar-bookshelf-tree'))への matcher → 小さな要素にするか、
//       toHaveCount(属性つき locator)
// 見分けられないもの(作法として守る): 見える要素を出る前から toBeVisible 等で待つ形(出るまでの問い合わせは body 全体を
// 写す)・大量の蔵書を別の作り方(大きな fixture・page.evaluate の中・別ファイルのヘルパー)で入れた spec・ヘルパーの
// ファイルの中の expect を大量の spec から呼ぶ形。
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

// 1.60 の expect が問い合わせのたびに aria snapshot を作る matcher (to.have.count・〜.array・to.match.aria 以外)
const SNAPSHOT_MATCHERS = new Set(['toHaveAttribute', 'toHaveText', 'toContainText', 'toBeVisible', 'toBeHidden', 'toHaveClass',
    'toContainClass', 'toHaveValue', 'toHaveValues', 'toBeChecked', 'toBeEnabled', 'toBeDisabled', 'toBeAttached', 'toHaveCSS',
    'toBeFocused', 'toBeInViewport', 'toHaveJSProperty', 'toBeEmpty', 'toBeEditable', 'toHaveId', 'toHaveAccessibleName',
    'toHaveAccessibleDescription', 'toHaveAccessibleErrorMessage', 'toHaveRole', 'toHaveURL', 'toHaveTitle']);
// 期待値を配列で渡すと 〜.array の形になり、写しを作らない
const ARRAY_FORM = new Set(['toHaveText', 'toContainText', 'toHaveClass', 'toContainClass']);
const LARGE_CONTAINERS = new Set(['body', 'html', 'main', '#bookshelf', '#sidebar-bookshelf-tree']);
const HIDDEN_MARKER = /gate-timings|data-gate-|\[hidden\]/;
const MANY_BOOKS = 100;

// expect(X) / expect.soft(X) と、その後の .not を下りて、{ target, not } を返す
function expectTarget(obj) {
    let not = false;
    if (obj.type === 'MemberExpression' && !obj.computed && obj.property.type === 'Identifier' && obj.property.name === 'not') { not = true; obj = obj.object; }
    if (obj.type !== 'CallExpression') return null;
    const c = obj.callee;
    const isExpect = (c.type === 'Identifier' && c.name === 'expect')
        || (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'expect' && c.property.type === 'Identifier' && c.property.name === 'soft');
    if (!isExpect || !obj.arguments[0]) return null;
    return { target: obj.arguments[0], not };
}

// locator('…') の文字列 (ほかの形は null)
function locatorSelector(target) {
    if (target.type !== 'CallExpression' || calleeName(target.callee) !== 'locator') return null;
    const a = target.arguments[0];
    if (a?.type === 'StringLiteral') return a.value.trim();
    if (a?.type === 'TemplateLiteral' && a.expressions.length === 0) return a.quasis[0].value.cooked.trim();
    return null;
}

/** 大量の蔵書を入れる spec か。同じファイルの seedManyBooksForTest(page[, n]) (既定 913冊) と Array.from({ length: n }) を見る */
function isManyBooks(ast) {
    const consts = new Map();
    walk(ast.program, (n) => {
        if (n.type === 'VariableDeclaration' && n.kind === 'const') {
            for (const d of n.declarations) if (d.id.type === 'Identifier' && d.init?.type === 'NumericLiteral') consts.set(d.id.name, d.init.value);
        }
    });
    const num = (n) => (n?.type === 'NumericLiteral' ? n.value : n?.type === 'Identifier' ? consts.get(n.name) : undefined);
    let many = false;
    walk(ast.program, (n) => {
        if (many || n.type !== 'CallExpression') return;
        if (calleeName(n.callee) === 'seedManyBooksForTest') {
            const n2 = n.arguments[1];
            if (!n2 || (num(n2) ?? MANY_BOOKS) >= MANY_BOOKS) many = true;
        } else if (n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier' && n.callee.object.name === 'Array'
            && calleeName(n.callee) === 'from' && n.arguments[0]?.type === 'ObjectExpression') {
            const len = n.arguments[0].properties.find((p) => p.type === 'ObjectProperty' && !p.computed
                && ((p.key.type === 'Identifier' && p.key.name === 'length') || (p.key.type === 'StringLiteral' && p.key.value === 'length')));
            if (len && (num(len.value) ?? 0) >= MANY_BOOKS) many = true;
        }
    });
    return many;
}

/** ページ全体を写す待ち (イシュー#640) を返す。 @param {string} code @returns {{ line: number, text: string }[]} */
export function findHeavyAriaWaits(code) {
    const ast = parse(code, { sourceType: 'module' });
    const many = isManyBooks(ast);
    const found = [];
    walk(ast.program, (n) => {
        if (n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression' || n.callee.computed) return;
        const m = calleeName(n.callee);
        if (!SNAPSHOT_MATCHERS.has(m)) return;
        if (ARRAY_FORM.has(m) && n.arguments[0]?.type === 'ArrayExpression') return;
        const et = expectTarget(n.callee.object);
        if (!et) return;
        const line = n.loc.start.line;
        const name = `${et.not ? 'not.' : ''}${m}`;
        const sel = locatorSelector(et.target);
        const targetText = sel ?? code.slice(et.target.start, et.target.end);
        if (HIDDEN_MARKER.test(targetText)) {
            found.push({ line, text: `見えない印 (${targetText}) を ${name} で待っている。写しを作らない toHaveCount(属性つき locator) か expect.poll(() => locator.getAttribute(…)) にする` });
            return;
        }
        if (!many) return;
        if (m === 'toBeHidden' || (et.not && (m === 'toBeVisible' || m === 'toBeAttached'))) {
            found.push({ line, text: `大量の蔵書の spec で ${name} を使っている (問い合わせのたびに body 全体を写す)。無いことは toHaveCount(0)、見えないことは locator('…:visible') の toHaveCount(0) にする` });
        } else if (m === 'toHaveURL' || m === 'toHaveTitle') {
            found.push({ line, text: `大量の蔵書の spec で ${name} を使っている (問い合わせのたびに body 全体を写す)。page.waitForURL(…) か expect.poll(() => page.url()) にする` });
        } else if (sel !== null && LARGE_CONTAINERS.has(sel)) {
            found.push({ line, text: `大量の蔵書の spec で大きな入れ物 (${sel}) に ${name} を使っている (中身を全部たどって写す)。小さな要素にするか toHaveCount(属性つき locator) にする` });
        }
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
        try {
            const code = readFileSync(file, 'utf-8');
            hits = [...findAsyncWaits(code), ...findHeavyAriaWaits(code)].sort((a, b) => a.line - b.line);
        } catch (err) {
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
        console.error('E2E の待ち方の違反が見つかりました:');
        console.error('  - waitForFunction に async 関数: Promise は真とみなされ、待たずに通る。expect.poll(() => page.evaluate(async …)) に直すこと (イシュー#607)');
        console.error('  - ページ全体を写す待ち: Playwright 1.60 の expect が問い合わせのたびに aria snapshot を作り、大量の蔵書のページを数秒止める。直し方は各行 (イシュー#640)');
        for (const v of violations) console.error(`  ${v.file}:${v.line}: ${v.text}`);
        console.error(`\n合計 ${violations.length} 件`);
        process.exit(1);
    }
    console.log(`OK: tests/e2e 配下 ${files} ファイルに、waitForFunction へ async 関数を渡す所は0件・ページ全体を写す待ち (#640) も0件`);
    process.exit(0);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
