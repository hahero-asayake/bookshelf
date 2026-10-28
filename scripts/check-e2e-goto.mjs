// tests/e2e 配下の page.goto('/...') (先頭スラッシュ付きの絶対パス指定) を検出して失敗させる。
// 背景: 先頭'/'はローカル(baseURLがオリジン直下)では問題が出ないが、本番URL相当の
// サブパス付きbaseURL(例: 'https://example.com/sub/')で流すとサブパスを無視して
// オリジン直下へ飛び、ページが見つからず時間切れになる(イシュー#396で実証)。
// 'index.html' 等の相対形(baseURLのサブパスが活きる)に統一する(イシュー#399)。
//
// 対象外(誤検出させない): about:blank・`${base}/...` のような変数展開形・
// http(s)://で始まる明示オリジン付き絶対URL・既に相対化済みのもの。
// これらは先頭が '/' ではない(クォート直後が '/' にならない)ため、下の正規表現には掛からない。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_DIR = fileURLToPath(new URL('../tests/e2e', import.meta.url));
const LEADING_SLASH_GOTO = /\.goto\(\s*['"`]\//;

function walk(dir, files = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            walk(full, files);
        } else if (extname(entry) === '.js') {
            files.push(full);
        }
    }
    return files;
}

const files = walk(TARGET_DIR);
const violations = [];

for (const file of files) {
    const lines = readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, i) => {
        if (LEADING_SLASH_GOTO.test(line)) {
            violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
    });
}

if (violations.length > 0) {
    console.error('先頭スラッシュ付きの goto() が見つかりました(相対形に直すこと。イシュー#396/#399の教訓):');
    for (const v of violations) console.error('  ' + v);
    console.error(`\n合計 ${violations.length} 件`);
    process.exit(1);
} else {
    console.log(`OK: tests/e2e 配下 ${files.length} ファイルに先頭スラッシュ付き goto() は0件`);
    process.exit(0);
}
