// 門のE2E(テスト名に `@gate` と観測点ID)の書き方を構文木で確かめる(イシュー#583)。
// 設計の正本: obsidian 60_🐙claude/63_🐙project/bookshelf/公開前最終テスト設計.md §3「門(a)」。
//
// なぜ: 今までのE2Eは画面の入口を内部から直接開いていたため「ボタンが壊れていても緑」になりえた
// (#580)。門に数えるテストは、利用者と同じ操作で、画面に見える結果を確かめたものだけにする。
//
// 見るもの(違反は終了コード1):
//   1. テスト名: `@gate` を含む test は、名前が静的な文字列で、観測点ID(jobs.json に在るもの)を1つ以上含む。
//   2. 本文: `test.step('前提: …' / '操作: …' / '確認: …')` だけで組む。操作と確認は1つ以上。
//   3. 前提(同じ範囲の beforeEach/beforeAll も前提として扱う): tests/e2e/helpers/ の関数の呼び出しだけ。
//   4. 操作・確認: evaluate 系(EVAL_FAMILY)を使わない。helpers の open*・show*・*Internal を呼ばない。
//      呼んだ関数(helpers・spec 内の自作)は本体を辿り、evaluate 系に届くものも違反にする
//      (名前の規則だけでは getArtDraft・setArtBlocks のような内部の読み書きがすり抜けるため)。
//      辿りはヘルパー→ヘルパーの呼び出しも追う。循環は訪問済みで止め、深さは MAX_DEPTH で打ち切る
//      (打ち切った時は「確かめ切れない」ので違反)。
//   5. アプリ自身のファイル(index.html・js/・css/・sw.js)への通信の差し替えは、前提のヘルパー経由でも違反。
//      宛先が文字列・正規表現で書かれている範囲だけを見る(変数・関数の述語は判定できない)。
//
// 数えるもの(既定は警告だけ・終了コード0): jobs.json の全IDが、どれかの `@gate` に載っているか。
//   `--strict-coverage` を付けた時だけ未達を失敗にする(門のE2Eが揃ってから CI で付ける)。
//
// 使い方:
//   node scripts/check-e2e-gate.mjs [--strict-coverage] [--json=<path>]
//     [--e2e-dir=<dir>] [--helpers-dir=<dir>] [--jobs=<path>] [--only=<file名,…>]
//   --json  結果(テスト・網羅・未達・違反)を書き出す。scripts/gate-report.mjs の入力。
//   後ろの4つは lint 自身のテスト(tests/unit/check-e2e-gate.test.js)が見本の置き場を指すためのもの。
//
// 機械で分からないもの(README に書いて人が守る): 直リンクで入口のボタンを飛ばすこと、
// 関数を別名に入れ直してから呼ぶこと、オブジェクトのメソッドとして書かれたヘルパー。
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const EVAL_FAMILY = new Set([
    'evaluate', 'evaluateHandle', 'evaluateAll', '$eval', '$$eval', 'waitForFunction',
    'addInitScript', 'addScriptTag', 'exposeFunction', 'exposeBinding',
    'route', 'routeFromHAR', 'unroute', 'storageState'
]);
const ROUTE_NAMES = new Set(['route', 'routeFromHAR']);
const HELPER_NAME_RE = /^(open|show)|Internal$/;
export const MAX_DEPTH = 8;
const STEP_PREFIX_RE = /^(前提|操作|確認)\s*[:：]/;
const ID_RE = /(?<![A-Za-z0-9])J\d+-\d+(?!\d)/g;
const TEST_MODIFIERS = new Set(['only', 'skip', 'fixme', 'fail', 'slow']);
const HOOKS = new Set(['beforeEach', 'beforeAll']);
const APP_ROUTE_RE = /index\.html|(^|[/*])(js|css)\/|sw\.js|\*\*\/\*\.(js|css|html)/;
const CATCH_ALL = new Set(['*', '**', '**/*', '**/**', '.*', '^.*$']);
const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'range', 'comments', 'errors', 'tokens',
    'leadingComments', 'trailingComments', 'innerComments']);

const isNode = (v) => v !== null && typeof v === 'object' && typeof v.type === 'string';
const isFn = (n) => isNode(n) && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration');
const isCall = (n) => n.type === 'CallExpression' || n.type === 'OptionalCallExpression';

// visit が false を返したら、その節の下へは入らない
function walk(node, visit) {
    if (visit(node) === false) return;
    for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) continue;
        const v = node[key];
        if (Array.isArray(v)) { for (const c of v) if (isNode(c)) walk(c, visit); }
        else if (isNode(v)) walk(v, visit);
    }
}

function staticString(node) {
    if (!isNode(node)) return null;
    if (node.type === 'StringLiteral') return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis.map((q) => q.value.cooked ?? '').join('');
    return null;
}

// 静的でない名前でも、書かれている文字だけは拾う(`@gate` の有無を見るため)
function writtenText(node) {
    if (!isNode(node)) return '';
    if (node.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.cooked ?? '').join(' ');
    if (node.type === 'BinaryExpression') return writtenText(node.left) + ' ' + writtenText(node.right);
    return staticString(node) ?? '';
}

// test.describe.only → ['test','describe','only']
function memberPath(node) {
    const parts = [];
    let cur = node;
    while (isNode(cur) && cur.type === 'MemberExpression' && !cur.computed && cur.property.type === 'Identifier') {
        parts.unshift(cur.property.name);
        cur = cur.object;
    }
    if (isNode(cur) && cur.type === 'Identifier') { parts.unshift(cur.name); return parts; }
    return null;
}

function patternText(arg) {
    if (!isNode(arg)) return null;
    const s = staticString(arg);
    if (s !== null) return s;
    if (arg.type === 'RegExpLiteral') return arg.pattern.replace(/\\/g, '');
    if (arg.type === 'TemplateLiteral') return arg.quasis.map((q) => q.value.cooked ?? '').join('*');
    return null;
}

export function isAppRoute(pattern) {
    if (pattern === null || pattern === undefined) return false;
    // 外部(ハブ・GitHub・Amazon等)の通信の模擬は前提で許されている
    const host = /^https?:\/\/([^/*]+)/.exec(pattern);
    if (host && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host[1])) return false;
    return CATCH_ALL.has(pattern) || APP_ROUTE_RE.test(pattern);
}

// 節の下にある呼び出しを全部拾う(入れ子の関数の中も含む)
function scanCalls(root) {
    const all = [];
    let expects = 0;
    walk(root, (n) => {
        if (!isCall(n)) return;
        const c = n.callee;
        const line = n.loc.start.line;
        if (c.type === 'Identifier') {
            if (c.name === 'expect') expects += 1;
            all.push({ kind: 'ident', name: c.name, ns: null, line, label: `${c.name}()` });
        } else if (c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') {
            const prop = !c.computed && c.property.type === 'Identifier' ? c.property.name
                : c.property.type === 'StringLiteral' ? c.property.value : null;
            const obj = c.object.type === 'Identifier' ? c.object.name : null;
            if (obj === 'expect') expects += 1;
            all.push({ kind: 'member', name: prop, ns: obj, line, label: `${obj ?? '…'}.${prop ?? '[…]'}()`, pattern: patternText(n.arguments[0]) });
        } else {
            all.push({ kind: 'other', name: null, ns: null, line, label: '(…)()' });
        }
    });
    return { all, expects };
}

function resolveImport(fromDir, src) {
    const abs = resolve(fromDir, src);
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
    for (const ext of ['.js', '.mjs']) if (existsSync(abs + ext)) return abs + ext;
    return abs;
}

function analyzeSource(code, file) {
    const ast = parse(code, { sourceType: 'module' });
    const imports = new Map();   // ローカル名 → { source: 絶対パス(相対importだけ)|null, imported }
    const functions = new Map(); // 関数名 → 関数の節の配列(入れ子で定義されたものも含む)
    for (const st of ast.program.body) {
        if (st.type !== 'ImportDeclaration') continue;
        const src = st.source.value;
        const source = src.startsWith('.') ? resolveImport(dirname(file), src) : null;
        for (const sp of st.specifiers) {
            const imported = sp.type === 'ImportSpecifier' ? (sp.imported.name ?? sp.imported.value)
                : sp.type === 'ImportNamespaceSpecifier' ? '*' : 'default';
            imports.set(sp.local.name, { source, imported });
        }
    }
    const add = (name, node) => { if (!functions.has(name)) functions.set(name, []); functions.get(name).push(node); };
    walk(ast.program, (n) => {
        if (n.type === 'FunctionDeclaration' && n.id) add(n.id.name, n);
        if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && isFn(n.init)) add(n.id.name, n.init);
    });
    // 他所の関数をそのまま出しているもの(export { x } from '…'・import して export { x }・export * from '…')
    const reexports = new Map();   // 出している名前 → { source, imported }
    const starSources = [];
    for (const st of ast.program.body) {
        if (st.type === 'ExportAllDeclaration' && st.source.value.startsWith('.')) starSources.push(resolveImport(dirname(file), st.source.value));
        if (st.type !== 'ExportNamedDeclaration' || st.declaration) continue;
        for (const sp of st.specifiers) {
            if (sp.type !== 'ExportSpecifier') continue;
            const exported = sp.exported.name ?? sp.exported.value;
            const local = sp.local.name ?? sp.local.value;
            if (st.source) {
                const src = st.source.value;
                reexports.set(exported, { source: src.startsWith('.') ? resolveImport(dirname(file), src) : null, imported: local });
            } else if (functions.has(local)) {
                if (exported !== local) functions.set(exported, functions.get(local));
            } else if (imports.has(local)) {
                reexports.set(exported, imports.get(local));
            }
        }
    }
    return { file, ast, imports, functions, reexports, starSources, facts: new Map() };
}

function makeContext({ e2eDir, helpersDir, jobsPath, root }) {
    const modules = new Map();
    const ctx = {
        e2eDir, helpersDir, root: root ?? ROOT, jobIds: new Set(loadJobs(jobsPath).ids),
        module(file) {
            if (!modules.has(file)) {
                let mod = null;
                try { mod = analyzeSource(readFileSync(file, 'utf-8'), file); } catch { mod = null; }
                modules.set(file, mod);
            }
            return modules.get(file);
        },
        inHelpers: (file) => typeof file === 'string' && file.startsWith(helpersDir + sep),
        rel: (file) => relative(root ?? ROOT, file).split(sep).join('/')
    };
    return ctx;
}

function factsOf(mod, name) {
    if (!mod.facts.has(name)) {
        const all = [];
        for (const node of mod.functions.get(name) ?? []) all.push(...scanCalls(node).all);
        mod.facts.set(name, all);
    }
    return mod.facts.get(name);
}

// file が name として出している関数を探す。他所の関数をそのまま出している時は元を辿る。
// null=ライブラリ(@playwright/test の expect 等)で辿る対象ではない。mod:null=本体が見つからない
function findFunction(file, name, ctx, hops = 0) {
    const mod = ctx.module(file);
    if (!mod) return { source: file, name, mod: null };
    if (mod.functions.has(name)) return { source: file, name, mod };
    if (hops >= MAX_DEPTH) return { source: file, name, mod: null };
    const via = mod.reexports.get(name);
    if (via) return via.source ? findFunction(via.source, via.imported, ctx, hops + 1) : null;
    for (const src of mod.starSources) {
        const found = findFunction(src, name, ctx, hops + 1);
        if (found && found.mod) return found;
    }
    return { source: file, name, mod: null };
}

// 呼び出し1つを、辿れる関数に解決する。null=辿る対象ではない(page.click() や expect 等)。
// importedFrom は「どのファイルから取り込んだ名前か」(helpers の関数かどうかの判定に使う)
function resolveCallee(mod, call, ctx) {
    if (call.kind === 'member') {
        const imp = call.ns ? mod.imports.get(call.ns) : null;
        if (!imp || imp.imported !== '*' || !imp.source || !call.name) return null;
        const found = findFunction(imp.source, call.name, ctx);
        return found && { ...found, importedFrom: imp.source, importedName: call.name };
    }
    if (call.kind !== 'ident') return null;
    if (mod.functions.has(call.name)) return { source: mod.file, name: call.name, mod, importedFrom: mod.file, importedName: call.name };
    const imp = mod.imports.get(call.name);
    if (!imp || !imp.source) return null;
    const found = findFunction(imp.source, imp.imported, ctx);
    return found && { ...found, importedFrom: imp.source, importedName: imp.imported };
}

// 関数 name から届く範囲を辿り、evaluate 系と route の宛先を集める
function trace(mod, name, depth, visited, chain, out, ctx) {
    const key = `${mod.file}#${name}`;
    if (visited.has(key)) return;   // 循環・合流は1回だけ見る
    visited.add(key);
    const here = [...chain, name];
    if (depth > MAX_DEPTH) { out.tooDeep ??= here.join(' → '); return; }
    for (const call of factsOf(mod, name)) {
        if (call.kind === 'member' && EVAL_FAMILY.has(call.name)) out.evals.push({ chain: here, file: mod.file, line: call.line, name: call.name });
        if (call.kind === 'member' && ROUTE_NAMES.has(call.name)) out.routes.push({ chain: here, file: mod.file, line: call.line, pattern: call.pattern });
        const target = resolveCallee(mod, call, ctx);
        if (!target) continue;
        if (!target.mod) { out.unresolved.push({ chain: [...here, target.name], file: target.source }); continue; }
        trace(target.mod, target.name, depth + 1, visited, here, out, ctx);
    }
}

function traceCall(target, ctx) {
    const out = { evals: [], routes: [], unresolved: [], tooDeep: null };
    trace(target.mod, target.name, 1, new Set(), [], out, ctx);
    return out;
}

function checkAppRoutes(traced, line, push, ctx) {
    for (const r of traced.routes) {
        if (!isAppRoute(r.pattern)) continue;
        push('no-app-route', line, `アプリ自身のファイルへの通信を差し替えている: ${r.chain.join(' → ')} → route('${r.pattern}')（${ctx.rel(r.file)}:${r.line}）。本物のコードを通す`);
    }
}

// 前提の区間(と beforeEach/beforeAll): helpers の関数の呼び出しだけ
function checkSetup(fnNode, where, spec, ctx, push) {
    for (const call of scanCalls(fnNode).all) {
        const target = resolveCallee(spec, call, ctx);
        if (!target || !ctx.inHelpers(target.importedFrom)) {
            push('setup-helpers-only', call.line, `${where}で ${call.label} を直接呼んでいる。前提は tests/e2e/helpers/ の関数の呼び出しだけにする`);
            continue;
        }
        if (!target.mod) continue;
        const traced = traceCall(target, ctx);
        checkAppRoutes(traced, call.line, push, ctx);
        if (traced.tooDeep) push('helper-depth', call.line, `${call.label} の本体を辿る深さが上限(${MAX_DEPTH})を超えた: ${traced.tooDeep}。確かめ切れないので浅くする`);
    }
}

// 操作・確認の区間: evaluate 系と、内部から開く・内部を読むヘルパーを禁止
function checkActOrVerify(kind, fnNode, stepLine, spec, ctx, push) {
    const { all, expects } = scanCalls(fnNode);
    for (const call of all) {
        if (call.kind === 'member' && EVAL_FAMILY.has(call.name)) {
            push('no-evaluate', call.line, `${kind}の区間で ${call.label} を使っている。${kind === '操作' ? '利用者の操作(クリック・入力・キー・再読込・URLを開く)で書く' : '画面に見えるもの(文字・件数・URL)を expect で確かめる'}`);
            continue;
        }
        const target = resolveCallee(spec, call, ctx);
        if (!target) continue;
        if (ctx.inHelpers(target.importedFrom) && HELPER_NAME_RE.test(target.importedName)) {
            push('helper-name', call.line, `${kind}の区間で ${target.importedName}() を呼んでいる。open*・show*・*Internal は画面を内部から開くヘルパーなので使えない`);
        }
        if (!target.mod) {
            push('helper-unresolved', call.line, `${target.name}() の本体が ${ctx.rel(target.source)} に見つからず、中身を確かめられない`);
            continue;
        }
        const traced = traceCall(target, ctx);
        if (traced.evals.length > 0) {
            const e = traced.evals[0];
            push('helper-internal', call.line, `${kind}の区間で呼んだ ${call.label} が内部に届く: ${e.chain.join(' → ')} → ${e.name}()（${ctx.rel(e.file)}:${e.line}）`);
        }
        if (traced.tooDeep) push('helper-depth', call.line, `${call.label} の本体を辿る深さが上限(${MAX_DEPTH})を超えた: ${traced.tooDeep}。確かめ切れないので浅くする`);
        for (const u of traced.unresolved) push('helper-unresolved', call.line, `${u.chain.join(' → ')}() の本体が ${ctx.rel(u.file)} に見つからず、中身を確かめられない`);
        checkAppRoutes(traced, call.line, push, ctx);
    }
    if (kind === '確認' && expects === 0) push('verify-no-expect', stepLine, '確認の区間に expect が無い。画面に見えるものを expect で確かめる');
}

function asStepCall(st) {
    let expr = null;
    if (st.type === 'ExpressionStatement') expr = st.expression;
    else if (st.type === 'VariableDeclaration' && st.declarations.length === 1) expr = st.declarations[0].init;
    if (isNode(expr) && expr.type === 'AwaitExpression') expr = expr.argument;
    if (!isNode(expr) || expr.type !== 'CallExpression') return null;
    const p = memberPath(expr.callee);
    return p && p.length === 2 && p[0] === 'test' && p[1] === 'step' ? expr : null;
}

function containsCall(node) {
    let found = false;
    walk(node, (n) => { if (isCall(n) || n.type === 'AwaitExpression' || n.type === 'NewExpression') found = true; return !found; });
    return found;
}

function checkGateBody(fnNode, testLine, spec, ctx, push) {
    if (!isFn(fnNode) || fnNode.body.type !== 'BlockStatement') {
        push('outside-step', testLine, '@gate のテスト本文は test.step(前提/操作/確認)だけで組む');
        return;
    }
    const seen = { 前提: 0, 操作: 0, 確認: 0 };
    for (const st of fnNode.body.body) {
        const step = asStepCall(st);
        if (!step) {
            if (st.type === 'VariableDeclaration' && !containsCall(st)) continue;   // 値を置くだけの宣言は許す
            push('outside-step', st.loc.start.line, '区間の外に文がある。@gate のテスト本文は test.step(前提/操作/確認)だけで組む');
            continue;
        }
        const title = staticString(step.arguments[0]);
        const m = title === null ? null : STEP_PREFIX_RE.exec(title);
        const body = step.arguments[1];
        if (!m || !isFn(body)) {
            push('step-prefix', step.loc.start.line, `test.step の名前は「前提: 」「操作: 」「確認: 」のどれかで始める(今の名前: ${title ?? '静的な文字列ではない'})`);
            continue;
        }
        seen[m[1]] += 1;
        if (m[1] === '前提') checkSetup(body, '前提の区間', spec, ctx, push);
        else checkActOrVerify(m[1], body, step.loc.start.line, spec, ctx, push);
    }
    if (seen.操作 === 0) push('step-missing', testLine, '操作の区間(test.step(\'操作: …\'))が無い');
    if (seen.確認 === 0) push('step-missing', testLine, '確認の区間(test.step(\'確認: …\'))が無い');
}

// 範囲(ファイル直下・describe の中)の直下にある呼び出しを集める。for やブロックの中は見るが、関数の中へは入らない
function scopeCalls(statements) {
    const out = [];
    for (const st of statements) walk(st, (n) => { if (isCall(n)) { out.push(n); return false; } if (isFn(n)) return false; });
    return out;
}

function visitScope(statements, inheritedHooks, spec, ctx, state) {
    const hooks = [...inheritedHooks];
    const tests = [];
    const describes = [];
    for (const call of scopeCalls(statements)) {
        const p = call.callee.type === 'Identifier' ? [call.callee.name] : memberPath(call.callee);
        if (!p || p[0] !== 'test') continue;
        if (p.length === 2 && HOOKS.has(p[1])) hooks.push(call);
        else if (p[1] === 'describe') describes.push(call);
        else if (p.length === 1 || (p.length === 2 && TEST_MODIFIERS.has(p[1]))) tests.push({ call, modifier: p[1] ?? null });
    }
    for (const { call, modifier } of tests) {
        const line = call.loc.start.line;
        const push = (rule, at, message) => state.violations.push({ file: ctx.rel(spec.file), line: at, rule, message });
        const title = staticString(call.arguments[0]);
        if (title === null) {
            if (writtenText(call.arguments[0]).includes('@gate')) push('title-static', line, '@gate のテスト名は静的な文字列にする(観測点IDを機械で数えるため)');
            continue;
        }
        if (!title.includes('@gate')) {
            const details = call.arguments[1];
            let tagged = false;
            if (isNode(details) && details.type === 'ObjectExpression') walk(details, (n) => { if (writtenText(n).includes('@gate')) tagged = true; });
            if (tagged) push('tag-option', line, '@gate は tag オプションではなくテスト名に書く(観測点IDと並べて数えるため)');
            continue;   // 門に数えないテストは今の書き方のままでよい
        }
        const ids = [...new Set(title.match(ID_RE) ?? [])];
        state.tests.push({ file: ctx.rel(spec.file), line, title, ids });
        if (modifier) push('modifier', line, `@gate のテストに test.${modifier} を付けている。流れないテストは門に数えられない`);
        if (ids.length === 0) push('id-missing', line, '@gate のテスト名に観測点ID(例: J5-2)が無い');
        for (const id of ids) if (!ctx.jobIds.has(id)) push('id-unknown', line, `観測点ID ${id} は tests/e2e/gate/jobs.json に無い`);
        for (const hook of hooks) {
            if (state.checkedHooks.has(hook)) continue;
            state.checkedHooks.add(hook);
            const fn = hook.arguments.find(isFn);
            if (fn) checkSetup(fn, `${memberPath(hook.callee).join('.')}(前提として扱う)`, spec, ctx, push);
        }
        checkGateBody(call.arguments[call.arguments.length - 1], line, spec, ctx, push);
    }
    for (const call of describes) {
        if (writtenText(call.arguments[0]).includes('@gate')) {
            state.violations.push({ file: ctx.rel(spec.file), line: call.loc.start.line, rule: 'describe-tag', message: '@gate は describe ではなくテスト名に書く(1本ずつ観測点IDと並べる)' });
        }
        const fn = call.arguments.find(isFn);
        if (fn && fn.body.type === 'BlockStatement') visitScope(fn.body.body, hooks, spec, ctx, state);
    }
}

export function loadJobs(jobsPath) {
    const data = JSON.parse(readFileSync(jobsPath, 'utf-8'));
    const points = data.jobs.flatMap((job) => job.points.map((p) => ({ id: p.id, desc: p.desc, job: job.id, jobName: job.name })));
    return { jobs: data.jobs, points, ids: points.map((p) => p.id) };
}

function walkFiles(dir, out = []) {
    for (const entry of readdirSync(dir).sort()) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walkFiles(full, out);
        else if (extname(entry) === '.js' && entry.endsWith('.spec.js')) out.push(full);
    }
    return out;
}

/**
 * @param {{ e2eDir?: string, helpersDir?: string, jobsPath?: string, root?: string, only?: string[] }} [opts]
 *   only: ファイル名(末尾一致)で対象を絞る(lint 自身のテスト用)
 */
export function lintGate(opts = {}) {
    const e2eDir = resolve(opts.e2eDir ?? join(ROOT, 'tests/e2e'));
    const helpersDir = resolve(opts.helpersDir ?? join(e2eDir, 'helpers'));
    const jobsPath = resolve(opts.jobsPath ?? join(ROOT, 'tests/e2e/gate/jobs.json'));
    const ctx = makeContext({ e2eDir, helpersDir, jobsPath, root: opts.root ? resolve(opts.root) : ROOT });
    const jobs = loadJobs(jobsPath);
    const state = { tests: [], violations: [], checkedHooks: new Set() };
    let files = walkFiles(e2eDir).filter((f) => !ctx.inHelpers(f));
    if (opts.only && opts.only.length > 0) files = files.filter((f) => opts.only.some((name) => f.endsWith(name)));
    for (const file of files) {
        const code = readFileSync(file, 'utf-8');
        if (!code.includes('@gate')) continue;
        let spec;
        try { spec = analyzeSource(code, file); } catch (err) {
            state.violations.push({ file: ctx.rel(file), line: err.loc?.line ?? 1, rule: 'parse-error', message: `構文を読めない: ${err.message}` });
            continue;
        }
        visitScope(spec.ast.program.body, [], spec, ctx, state);
    }
    const coverage = {};
    for (const id of jobs.ids) coverage[id] = [];
    for (const t of state.tests) for (const id of t.ids) if (coverage[id]) coverage[id].push({ file: t.file, line: t.line, title: t.title });
    const missing = jobs.ids.filter((id) => coverage[id].length === 0);
    return {
        ok: state.violations.length === 0, files: files.length, jobsTotal: jobs.ids.length,
        tests: state.tests, coverage, missing, violations: state.violations
    };
}

export function exitCodeFor(result, { strictCoverage = false } = {}) {
    if (result.violations.length > 0) return 1;
    if (strictCoverage && result.missing.length > 0) return 1;
    return 0;
}

function main(argv) {
    const flag = (name) => argv.includes(`--${name}`);
    const opt = (name) => { const pre = `--${name}=`; const found = argv.find((a) => a.startsWith(pre)); return found ? found.slice(pre.length) : undefined; };
    const strictCoverage = flag('strict-coverage');
    const only = opt('only');
    const result = lintGate({ e2eDir: opt('e2e-dir'), helpersDir: opt('helpers-dir'), jobsPath: opt('jobs'), only: only ? only.split(',') : undefined });
    const jsonPath = opt('json');
    if (jsonPath) {
        mkdirSync(dirname(resolve(jsonPath)), { recursive: true });
        writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), strictCoverage, ...result }, null, 2) + '\n');
    }
    for (const v of result.violations) console.error(`${v.file}:${v.line}: [${v.rule}] ${v.message}`);
    const covered = result.jobsTotal - result.missing.length;
    const summary = `@gate ${result.tests.length}本・違反${result.violations.length}件・観測点の網羅 ${covered}/${result.jobsTotal}`;
    if (result.missing.length > 0) {
        const list = result.missing.join(' ');
        const text = `観測点の未達 ${result.missing.length}/${result.jobsTotal}点: ${list}`;
        if (strictCoverage) console.error(text);
        else if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=lint:e2e-gate::${text}`);
        else console.log(`警告: ${text}`);
    }
    const code = exitCodeFor(result, { strictCoverage });
    if (code === 0) console.log(`OK: ${summary}`);
    else console.error(`NG: ${summary}${result.violations.length === 0 ? '(--strict-coverage のため未達を失敗にした)' : ''}`);
    process.exit(code);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
