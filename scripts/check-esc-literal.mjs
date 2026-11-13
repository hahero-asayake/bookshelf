// Esc の判定の直書き禁止 (イシュー#565・#556 報告の2)。
// Esc の判定は js/ui/surface.js の Surface.isEsc / Surface.onEsc の1か所だけで行う。
// 画面ごとに e.key === 'Escape' / keyCode 27 を直に書くと、defaultPrevented を見ない処理が増えて
// 共通の Esc (最前面の1枚だけ閉じる) と二重に履歴を戻す (引き出しの Esc で戻りすぎた実例)。
//
// 検査: js/**/*.js (js/vendor/ と js/ui/surface.js を除く) で、key と 'Escape' / keyCode と 27 の比較を禁止する。
//   new KeyboardEvent('keydown', { key: 'Escape' }) のような「Esc を発火する」書き方は比較ではないので対象外。
// 例外 (ALLOW): 理由のある直書き。増やす時は理由をここに書く。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JS_DIR = join(ROOT, 'js');
const SKIP = [join(JS_DIR, 'vendor'), join(JS_DIR, 'ui/surface.js')];
const ALLOW = {
    // ドラッグ中だけ Esc を取り消しに使い、Surface の Esc まで届かせない capture 処理 (イシュー#517 U4)。
    // 単体テスト (tests/unit/reorder.test.js) が surface.js を読まずに動かすため Surface に依存させない
    'js/ui/reorder.js': 1,
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

const PATTERNS = [
    /\.key\s*[!=]==?\s*['"](?:Escape|Esc)['"]/,
    /['"](?:Escape|Esc)['"]\s*[!=]==?\s*\w+\.key\b/,
    /\.keyCode\s*[!=]==?\s*27\b/,
    /\.which\s*[!=]==?\s*27\b/,
];

const violations = [];
for (const file of walk(JS_DIR)) {
    const rel = relative(ROOT, file);
    let count = 0;
    readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
        if (PATTERNS.some((re) => re.test(line))) {
            count++;
            if (count > (ALLOW[rel] || 0)) violations.push(`${rel}:${i + 1}: Esc の判定の直書き (Surface.isEsc / Surface.onEsc を使うこと): ${line.trim()}`);
        }
    });
}

if (violations.length) {
    console.error(violations.join('\n'));
    console.error(`\nNG: Esc の判定の直書き ${violations.length} 件 (js/ui/surface.js の Surface.isEsc/onEsc へ寄せる)`);
    process.exit(1);
}
console.log('OK: js/ 配下に Esc の判定の直書きは無い (例外: ' + Object.keys(ALLOW).join(', ') + ')');
