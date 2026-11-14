// tests/e2e・tests/visual のファイルが、外への通信の遮断と模擬 (tests/e2e/helpers/test-base.js の
// blockExternalForTest・context fixture) を通らずにブラウザの context を作る書き方を検出して失敗させる (イシュー#637)。
//
// なぜ: 表紙 (Amazon)・AdSense・GIS の遮断は test-base.js の context fixture が掛ける。#637 の実測
// (scripts/verify/637-results.md) で、外へ出た表紙の要求53件は全部この fixture を通らない context から出ていた。
//   - spec が @playwright/test から test を直接 import していた (github-sync-resilience.spec.js・5件)
//   - spec が browser.newContext() で作った context に blockExternalForTest を掛けていなかった (sort-persist.spec.js・48件)
// fixture の中に置く計測ではこの漏れは見えないので、書き方を静的に検査して CI で毎回止める。
//
// 検査すること:
//   A. @playwright/test から test を import しない (expect・型だけの import はよい。test-base.js 自身は対象外)
//   B. .newContext( の戻り値を変数に受け、同じファイルの後ろで blockExternalForTest(その変数) を呼ぶ
//      (変数に受けない書き方 = (await browser.newContext()).newPage() も違反)
//   C. browser.newPage( を使わない (中で fixture を通らない context を作る)
// 例外は下の ALLOW に理由つきで書く。該当が無くなった例外 (直した後に残った行) も失敗にする。
//
// 使い方: npm run lint:e2e-external  (--root <dir> で別の木を検査できる＝直す前の main で赤になることの確認用)
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DEFAULT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['tests/e2e', 'tests/visual'];
const BASE = 'tests/e2e/helpers/test-base.js';

/** 例外 (理由つき)。file はリポジトリ相対・rule は 'A' | 'B' | 'C'。 */
export const ALLOW = [
    {
        file: 'tests/e2e/cover-cache-sw.spec.js', rule: 'A',
        reason: 'SW の表紙キャッシュを確かめるため serviceWorkers:allow の自前の context が要る (page.route は SW の fetch を安定して横取りできない・同ファイル冒頭)。表紙は 127.0.0.1 の画像サーバから出すので外へ出ない (#637 実測で0件)。その context には blockExternalForTest を掛ける (B は例外にしない・イシュー#647)',
    },
];

const RULE_TEXT = {
    A: '@playwright/test から test を import している (./helpers/test-base.js から import する)',
    B: 'newContext() の context に blockExternalForTest を掛けていない',
    B0: 'newContext() の戻り値を変数に受けていない (変数に受けて blockExternalForTest を掛ける)',
    C: 'browser.newPage() を使っている (fixture を通らない context ができる)',
};

const lineOf = (code, index) => code.slice(0, index).split('\n').length;

/** コメント行を空にし、行末の // コメントを落とす (行番号は保つ)。 */
function stripComments(code) {
    return code.split('\n').map((l) => {
        const t = l.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
        return l.replace(/\s\/\/.*$/, '');
    }).join('\n');
}

/** @returns {{ line: number, rule: 'A'|'B'|'C', text: string }[]} */
export function findExternalBypass(code) {
    const src = stripComments(code);
    const out = [];
    // A: @playwright/test から test (または既定・名前空間の import) を取り込んでいる
    for (const m of src.matchAll(/import\s+([^;]*?)\s+from\s+['"]@playwright\/test['"]/g)) {
        const clause = m[1].trim();
        if (/^type\s/.test(clause)) continue;
        const braces = /\{([^}]*)\}/.exec(clause);
        const names = braces
            ? braces[1].split(',').map((s) => s.trim()).filter((s) => s && !/^type\s/.test(s)).map((s) => s.split(/\s+as\s+/)[0].trim())
            : [];
        const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
        if (names.includes('test') || rest) out.push({ line: lineOf(src, m.index), rule: 'A', text: RULE_TEXT.A });
    }
    // B: newContext( の戻り値を変数に受けて、後ろで blockExternalForTest(変数) を呼んでいるか
    const lines = src.split('\n');
    lines.forEach((l, i) => {
        if (!/\.newContext\(/.test(l)) return;
        const assigned = /(?:const|let|var)\s+([\w$]+)\s*=\s*await\s+[\w$][\w$.()]*\.newContext\(/.exec(l);
        if (!assigned) {
            out.push({ line: i + 1, rule: 'B', text: RULE_TEXT.B0 });
            return;
        }
        const name = assigned[1].replace(/\$/g, '\\$');
        const after = lines.slice(i).join('\n');
        if (!new RegExp(`blockExternalForTest\\(\\s*${name}\\s*[,)]`).test(after)) {
            out.push({ line: i + 1, rule: 'B', text: `${RULE_TEXT.B} (${assigned[1]})` });
        }
    });
    // C: browser.newPage(
    lines.forEach((l, i) => {
        if (/\bbrowser(\(\))?\.newPage\(/.test(l)) out.push({ line: i + 1, rule: 'C', text: RULE_TEXT.C });
    });
    return out.sort((a, b) => a.line - b.line);
}

function walk(dir, files = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, files);
        else if (['.js', '.mjs'].includes(extname(entry))) files.push(full);
    }
    return files;
}

export function lintExternalBypass({ root = ROOT_DEFAULT } = {}) {
    const files = DIRS.flatMap((d) => {
        try { return walk(join(root, d)); } catch { return []; }
    });
    const violations = [];
    const allowed = [];
    for (const f of files) {
        const rel = relative(root, f).split('\\').join('/');
        if (rel === BASE) continue;
        for (const v of findExternalBypass(readFileSync(f, 'utf-8'))) {
            const allow = ALLOW.find((a) => a.file === rel && a.rule === v.rule);
            if (allow) allowed.push({ file: rel, ...v, reason: allow.reason });
            else violations.push({ file: rel, ...v });
        }
    }
    const stale = ALLOW.filter((a) => !allowed.some((x) => x.file === a.file && x.rule === a.rule));
    return { files: files.length, violations, allowed, stale };
}

function main() {
    const i = process.argv.indexOf('--root');
    const root = i > 0 && process.argv[i + 1] ? process.argv[i + 1] : ROOT_DEFAULT;
    const { files, violations, allowed, stale } = lintExternalBypass({ root });
    for (const a of allowed) console.log(`例外 (許可リスト): ${a.file}:${a.line} [${a.rule}] ${a.reason}`);
    if (violations.length || stale.length) {
        if (violations.length) {
            console.error('外への通信の遮断 (test-base.js の blockExternalForTest) を通らない context の作り方が見つかりました (イシュー#637):');
            for (const v of violations) console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.text}`);
            console.error(`\n合計 ${violations.length} 件 (${new Set(violations.map((v) => v.file)).size} ファイル)`);
        }
        if (stale.length) {
            console.error('許可リスト (scripts/check-e2e-external.mjs の ALLOW) に、該当が無くなった例外が残っています (消すこと):');
            for (const s of stale) console.error(`  ${s.file} [${s.rule}]`);
        }
        process.exit(1);
    }
    console.log(`OK: tests/e2e・tests/visual 配下 ${files} ファイルに、遮断を通らない context の作り方は0件 (例外 ${allowed.length} 件)`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
