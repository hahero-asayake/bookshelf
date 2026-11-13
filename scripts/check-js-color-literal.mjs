// JS 内のインライン style の色直書き禁止 (イシュー#565・#556 報告の3)。
// CSS 側の色は stylelint が見ているが、JS が innerHTML で書く style="color:#9ca3af" や el.style.color = '#888' は
// 素通りしていた (本棚ツリーの空表示が比 2.04 になった実例)。色は css/bookshelf.css のトークン
// (--muted / --fg2 / --danger / --accent 等) を var() で使い、ダークテーマにも追従させる。
//
// 検査: js/**/*.js (js/vendor/ を除く) で
//   (1) style="…color|background…: #hex" (var(--x, #hex) のフォールバックは対象外)
//   (2) .style.color / .style.background… = '#hex'
// 例外 (ALLOW): 理由のある直書き。増やす時は理由をここに書く。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JS_DIR = join(ROOT, 'js');
const SKIP = [join(JS_DIR, 'vendor')];
const ALLOW = {
    // 記事のプレビュー iframe (srcdoc) に書く別文書の文言。親のトークン (CSS 変数) が届かないため色を直に持つ
    'js/screens/article-editor.js': 4,
};

function walk(dir, files = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (SKIP.some((s) => full === s || full.startsWith(s + '/'))) continue;
        if (statSync(full).isDirectory()) walk(full, files);
        else if (extname(entry) === '.js') files.push(full);
    }
    return files;
}

// var(--x, #hex) のフォールバックは除いてから見る
const stripFallback = (line) => line.replace(/var\(\s*--[\w-]+\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/g, 'var()');
const PATTERNS = [
    /style=["'`][^"'`]*\b(?:color|background(?:-color)?)\s*:\s*#[0-9a-fA-F]{3,8}\b/,
    /\.style\.(?:color|background(?:Color)?)\s*=\s*['"`]#[0-9a-fA-F]{3,8}/,
];

const violations = [];
for (const file of walk(JS_DIR)) {
    const rel = relative(ROOT, file);
    let count = 0;
    readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
        const l = stripFallback(line);
        if (PATTERNS.some((re) => re.test(l))) {
            count++;
            if (count > (ALLOW[rel] || 0)) violations.push(`${rel}:${i + 1}: 色の直書き (css のトークンを var() で使うこと): ${line.trim().slice(0, 160)}`);
        }
    });
}

if (violations.length) {
    console.error(violations.join('\n'));
    console.error(`\nNG: JS 内のインライン style の色直書き ${violations.length} 件`);
    process.exit(1);
}
console.log('OK: JS 内のインライン style に色の直書きは無い (例外: ' + Object.keys(ALLOW).join(', ') + ')');
