// 画面の切り替わる幅(スマホ/PC)の境目が、js/ui/viewport.js の1か所と
// CSSの @media (max-width: 900px) / (min-width: 901px) の1組だけで定義されていることを確かめる
// (イシュー#505・U2・②決裁2026-11-03「境目の値はviewport.jsの1か所と、CSSの900/901の1組だけ。
// それ以外の直書きは、検査で0件」)。
//
// 検査1 (CSS): css/**/*.css の @media 条件に、旧い境目の数字 768px/769px が残っていないか。
//   768/769 は旧実装(U2で廃止)の値。900/901 (正)はチェック対象外(許可された唯一の組)。
//   480px/560px/600px/760px 等、スマホ/PC判定とは別の目的の既存ブレークポイント
//   (例: 760pxは本文イシュー#168コメントの通り900pxとは別概念のflex-wrap用・狭幅内の細かい
//   調整用で、U2の対象外=振る舞いを変えない)は、この検査の対象にしない
//   (docs/char/u2-breakpoint-decision.md §1参照)。
// 検査2 (JS): js/ui/viewport.js 以外の js/**/*.js で、matchMedia('(...px...)') のように
//   pxを伴う幅の直書きmatchMedia呼び出しがあれば違反(値に関係なく、viewport.js経由を強制する)。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CSS_DIR = join(ROOT, 'css');
const JS_DIR = join(ROOT, 'js');
const VIEWPORT_FILE = join(ROOT, 'js/ui/viewport.js');
const FORBIDDEN_PX = new Set(['768', '769']); // U2で廃止した旧い境目の値

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

const violations = [];

// ----- 検査1: CSS の @media 条件 -----
const MEDIA_LINE = /@media[^{]*\b(?:max-width|min-width)\s*:\s*([\d.]+)px/g;
for (const file of walk(CSS_DIR, ['.css'])) {
    const lines = readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, i) => {
        let m;
        MEDIA_LINE.lastIndex = 0;
        while ((m = MEDIA_LINE.exec(line))) {
            const px = m[1];
            if (FORBIDDEN_PX.has(px)) {
                violations.push(`${relative(ROOT, file)}:${i + 1}: @media に旧い境目 ${px}px の直書き(900/901に統一すること): ${line.trim()}`);
            }
        }
    });
}

// ----- 検査2: JS の matchMedia(幅の直書き) -----
const MATCH_MEDIA_PX = /matchMedia\(\s*[`'"][^`'"]*\d+px/;
for (const file of walk(JS_DIR, ['.js'])) {
    if (file === VIEWPORT_FILE) continue; // 唯一の例外(ここが定義の正本)
    const lines = readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, i) => {
        if (MATCH_MEDIA_PX.test(line)) {
            violations.push(`${relative(ROOT, file)}:${i + 1}: matchMedia() の幅の直書き(js/ui/viewport.js経由にすること): ${line.trim()}`);
        }
    });
}

if (violations.length > 0) {
    console.error('画面の境目(スマホ/PC)の直書きが見つかりました(js/ui/viewport.js の1か所とCSSの900/901の1組だけに統一すること。イシュー#505):');
    for (const v of violations) console.error('  ' + v);
    console.error(`\n合計 ${violations.length} 件`);
    process.exit(1);
} else {
    console.log('OK: 画面の境目(スマホ/PC)の直書きは0件(js/ui/viewport.js の1か所とCSSの900/901の1組だけ)');
    process.exit(0);
}
