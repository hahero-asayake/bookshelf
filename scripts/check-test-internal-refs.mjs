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

// U9 G3-1(article-editor前半、イシュー#551)置き換え後の実測値 = 216
// (204(bookshelf._) + 12(app._)。216 = 298 - 82。G3-1対象は`_artFlushSave`(39)・
// `_artFlushRemoteNow`(34)・`_artEditingId`(14)の3名87件(全て(c)。保存確定系は決定性の
// ため(a)化しない#536の教訓、_artEditingIdはDOM等価が無いため(c))。
// tests/e2e/helpers/art-editor.jsへ集約し5件(flushArtSave1・flushArtRemoteNow1・
// flushArtSaveAndRemote2・getArtEditingId1)に減った(87-5=82)。純減は82件(0(a)+82(c))。
// `_artDraft`(36)・`_artTextFsEditor`(29)は複雑度が高く次イシュー(G3-2)へ回した
// (詳細はdocs/char/u9-g3-plan.md)。前回(G2・#550)は298だった。単位が進むごとに、
// この定数を実測値まで下げる。
const MAX = 216;

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
