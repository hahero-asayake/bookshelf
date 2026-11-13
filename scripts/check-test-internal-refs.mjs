// テスト(tests/e2e/・tests/visual/)が VirtualBookshelf の内部メソッド(`_xxx`)を
// `window.bookshelf._xxx` / `app._xxx` のように直接参照している件数の上限をCIで確かめる
// (U9計画・イシュー#548・499-step4-plan.md §5「委譲を外す計画」)。
//
// 委譲(内部参照)は一時的なもの。ずっと残すと二重の入口になりDRYの目的に反するため、
// U9以降の各単位でこの上限を下げていく。上限を超えたらCIで落とす。
//
// 数える対象(②決裁2026-11-13・#548 step2承認): `bookshelf._xxx` と `app._xxx` の2パターンを
// 合算して1つの数として扱う(上限を分けない)。実測で `app._` 経由が14件あった(0件ではなかった)
// ため対象に含める。`vb._` 経由は0件だったため対象外。
//
// 上限は docs/char/u9-classification.md の分類作業に合わせて単位ごとに手で下げていく定数。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TARGET_DIRS = ['tests/e2e', 'tests/visual'];

// U9 step4 (#548) 時点の上限。G1(settings)置き換え後の実測値 = 313
// (299(bookshelf._) + 14(app._)。299 = 355 - 56。(a)利用者操作化で54件(_openSettingsModal)が0に
// なった一方、e2e-diff-main.mjs --visualの実測で(a)化が不成立と判明した3件(_openPluginSettings全3件
// ・1種類)と、対照テスト用の_openSettingsModal直呼び1件を(c)へ戻したため、純減は56件
// (前回step3時点の58件より2件少ない)。前回(step2)は369だった)。単位が進むごとに、この定数を
// 実測値まで下げる。
const MAX = 313;

const PATTERNS = [
    { name: 'bookshelf._', re: /\bbookshelf\._[A-Za-z]/g },
    { name: 'app._', re: /\bapp\._[A-Za-z]/g },
];

function walk(dir, exts, files = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            walk(full, exts, files);
        } else if (exts.includes(extname(entry))) {
            files.push(full);
        }
    }
    return files;
}

let total = 0;
const byPattern = new Map(PATTERNS.map(p => [p.name, 0]));
const byFile = new Map();

for (const dir of TARGET_DIRS) {
    const full = join(ROOT, dir);
    for (const file of walk(full, ['.js'])) {
        const text = readFileSync(file, 'utf-8');
        let fileCount = 0;
        for (const p of PATTERNS) {
            p.re.lastIndex = 0;
            const matches = text.match(p.re) || [];
            if (matches.length > 0) {
                byPattern.set(p.name, byPattern.get(p.name) + matches.length);
                fileCount += matches.length;
            }
        }
        if (fileCount > 0) {
            const rel = relative(ROOT, file);
            byFile.set(rel, (byFile.get(rel) || 0) + fileCount);
            total += fileCount;
        }
    }
}

console.log(`テストの内部参照(bookshelf._/app._)の件数: ${total} (上限 ${MAX})`);

console.log('\n-- パターン別 --');
for (const [name, count] of byPattern) {
    console.log(`  ${name}: ${count}`);
}

console.log('\n-- ファイル別 --');
for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}\t${file}`);
}

if (total > MAX) {
    console.error(`\n違反: テストの内部参照が上限(${MAX})を超えています(${total}件)。U9計画(#548)の分類表(docs/char/u9-classification.md)に沿って、(a)利用者操作/(b)公開窓口/(c)テスト用ヘルパーのいずれかへ置き換えてください。`);
    process.exit(1);
} else {
    console.log(`\nOK: 上限(${MAX})以内`);
    process.exit(0);
}
