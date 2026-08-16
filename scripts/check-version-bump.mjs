// index.html の <script src="js/*.js?v=..."> / <link href="css/*.css?v=..."> と
// 実ファイルの変更差分を突き合わせ、js/css を変更したのに ?v= のバンプを忘れていないかを検査する。
// 「js/css 変更後の検証は ?v= バンプ + リロード必須」(08_意思決定記録「実装上の教訓」) を
// 人間の注意力に頼らず機械的に検出するための npm script (npm run check:version)。
//
// 判定は直近コミット HEAD との比較 (作業ツリー + ステージ済みの変更が対象)。
// 値そのものは決めない (自動修正はしない) — 何を書くかは実装者の判断のため、検査のみ行う。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function git(args) {
    return execFileSync('git', args, { encoding: 'utf-8' });
}

function extractVersions(html) {
    const map = new Map();
    const re = /(?:src|href)="((?:js|css)\/[^"?]+)\?v=([\w.-]+)"/g;
    let m;
    while ((m = re.exec(html))) map.set(m[1], m[2]);
    return map;
}

let changed;
try {
    changed = git(['diff', '--name-only', 'HEAD', '--', 'js', 'css']).split('\n').filter(Boolean);
} catch (e) {
    console.error('[check-version-bump] git diff に失敗:', e.message);
    process.exit(1);
}

if (changed.length === 0) {
    console.log('[check-version-bump] js/css の変更なし。スキップ。');
    process.exit(0);
}

let headHtml;
try {
    headHtml = git(['show', 'HEAD:index.html']);
} catch (e) {
    console.error('[check-version-bump] HEAD の index.html 取得に失敗:', e.message);
    process.exit(1);
}
const nowHtml = readFileSync('index.html', 'utf-8');

const headVers = extractVersions(headHtml);
const nowVers = extractVersions(nowHtml);

const stale = changed.filter((file) => nowVers.has(file) && headVers.get(file) === nowVers.get(file));

if (stale.length > 0) {
    console.error('[check-version-bump] 以下は変更されていますが index.html の ?v= が更新されていません:');
    for (const f of stale) console.error(`  - ${f} (現在 ?v=${nowVers.get(f)})`);
    console.error('index.html の該当 <script>/<link> の ?v= を新しい値 (例: 日付 YYYYMMDDNN) にバンプしてください。');
    process.exit(1);
}
console.log('[check-version-bump] OK: 変更された js/css はすべて ?v= がバンプ済み。');
