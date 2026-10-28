// index.html の <script src="js/*.js?v=..."> / <link href="css/*.css?v=..."> と
// 実ファイルの変更差分を突き合わせ、js/css を変更したのに ?v= のバンプを忘れていないかを検査する。
// 「js/css 変更後の検証は ?v= バンプ + リロード必須」(08_意思決定記録「実装上の教訓」) を
// 人間の注意力に頼らず機械的に検出するための npm script (npm run check:version)。
//
// ===== 比較範囲 =====
// 既定 (引数・環境変数なし、従来どおり・イシュー#390で据え置き):
//   起点は origin/main が取れれば origin/main と HEAD の merge-base (未分岐なら origin/main と同一コミット)。
//   取れない (origin/main が無い・未fetch・merge-base 失敗) 場合は HEAD に戻す。
//   起点との比較対象は commit 済み・未push の変更 + ステージ済み + 作業ツリーの変更 (git diff <起点>)。
//   この既定経路は「push 直後/fetch 直後に実行すると origin/main==HEAD になり diff が消えて
//   見逃す」弱点を構造的に持つ (イシュー#390 で実測確認)。pre-push/CI からは必ず下の
//   --range を使うこと (素の merge-base には絶対に戻さない)。
//
// 範囲を明示指定 (pre-push・CI 向け、イシュー#390):
//   --range=<base>..<head>  または環境変数 CHECK_VERSION_RANGE=<base>..<head>
//   (CLI引数が優先。どちらも無ければ既定の merge-base 経路)
//   base/head は commit-ish (sha・ref) を直接 diff する (merge-base を介さない)。
//   base が解決できない (未fetch等) 場合はハード失敗にせず、警告を出して
//   その回の検査をスキップする (push-gate.mjs の「判定不能は保留」と同じ考え方。
//   fetch 漏れという別種の問題を version-bump 検査の失敗として誤報しないため)。
//
// ===== 未参照ファイルの警告 (イシュー#390・失敗にはしない) =====
//   js/・css/ 配下に存在するのに index.html のどの <script>/<link> からも
//   ?v= 付きで参照されていないファイルを一覧表示する (警告のみ・exit code に影響しない)。
//   新しい js/css を足して index.html への参照自体を書き忘れた場合の盲点を埋めるため。
//
// 値そのものは決めない (自動修正はしない) — 何を書くかは実装者の判断のため、検査のみ行う。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function git(args) {
    return execFileSync('git', args, { encoding: 'utf-8' });
}

function isUnresolvable(err) {
    const detail = (err.stderr != null ? String(err.stderr) : '') + ' ' + (err.message || '');
    return /invalid revision range|bad revision|unknown revision|fatal: ambiguous argument|unknown commit|bad object|fatal: not a valid object/i.test(detail);
}

// --range=<base>..<head> (CLI優先) または環境変数 CHECK_VERSION_RANGE を読む。
// どちらも無ければ null (= 既定の merge-base 経路を使う)。
function parseRangeArg() {
    const cliArg = process.argv.find((a) => a.startsWith('--range='));
    const raw = cliArg ? cliArg.slice('--range='.length) : (process.env.CHECK_VERSION_RANGE || '');
    if (!raw) return null;
    const idx = raw.indexOf('..');
    if (idx < 0) {
        console.error(`[check-version-bump] --range の形式が不正 (base..head 形式で指定): ${raw}`);
        process.exit(2);
    }
    const base = raw.slice(0, idx).trim();
    const head = raw.slice(idx + 2).trim();
    if (!base || !head) {
        console.error(`[check-version-bump] --range の形式が不正 (base..head 形式で指定): ${raw}`);
        process.exit(2);
    }
    return { base, head };
}

// 既定経路 (--range 無し): 従来どおりの merge-base ロジック。ログ文言も既存のまま。
function resolveDefaultBaseRef() {
    try {
        git(['rev-parse', '--verify', '--quiet', 'origin/main']);
        const base = git(['merge-base', 'origin/main', 'HEAD']).trim();
        console.log(`[check-version-bump] 起点: origin/main (merge-base ${base.slice(0, 7)})`);
        return base;
    } catch {
        console.log('[check-version-bump] 起点: HEAD (origin/main が取れないため)');
        return 'HEAD';
    }
}

function extractVersions(html) {
    const map = new Map();
    const re = /(?:src|href)="((?:js|css)\/[^"?]+)\?v=([\w.-]+)"/g;
    let m;
    while ((m = re.exec(html))) map.set(m[1], m[2]);
    return map;
}

// js/・css/ 配下の実ファイル一覧 (.js/.css のみ)。headRef が null なら作業ツリー基準 (git ls-files)、
// 指定があればそのコミット時点 (git ls-tree) で揃える。
function listTrackedAssets(headRef) {
    let out;
    try {
        out = headRef
            ? git(['ls-tree', '-r', '--name-only', headRef, '--', 'js', 'css'])
            : git(['ls-files', '--', 'js', 'css']);
    } catch (e) {
        console.error('[check-version-bump] 資産一覧の取得に失敗 (警告チェックをスキップ):', e.message);
        return [];
    }
    return out.split('\n').filter((f) => /\.(js|css)$/.test(f));
}

function warnUnreferenced(headRef, nowVers) {
    const assets = listTrackedAssets(headRef);
    const unreferenced = assets.filter((f) => !nowVers.has(f));
    if (unreferenced.length > 0) {
        console.warn('[check-version-bump] 警告: 以下は js/・css/ 配下にありますが index.html から ?v= 付きで参照されていません:');
        for (const f of unreferenced) console.warn(`  - ${f}`);
        console.warn('(意図的に未使用なら無視してよい。読み込まれるはずのファイルなら index.html に <script>/<link> を足してください。exit codeには影響しません。)');
    }
}

const range = parseRangeArg();

let baseRef;
let headRef; // null = 作業ツリー (既定経路のみ。--range 指定時は必ず commit-ish)
let softSkip = false;

if (range) {
    baseRef = range.base;
    headRef = range.head;
    console.log(`[check-version-bump] 起点: ${range.base} (指定範囲 ${range.base}..${range.head})`);
} else {
    baseRef = resolveDefaultBaseRef();
    headRef = null;
}

let changed;
try {
    const diffArgs = headRef ? ['diff', '--name-only', baseRef, headRef, '--', 'js', 'css'] : ['diff', '--name-only', baseRef, '--', 'js', 'css'];
    changed = git(diffArgs).split('\n').filter(Boolean);
} catch (e) {
    if (range && isUnresolvable(e)) {
        // fetch漏れ等で起点が未解決 = バージョン取りこぼし検査とは別種の問題。
        // ハード失敗(push拒否)にはせず、警告を出してこの回はスキップする
        // (push-gate.mjs の「判定不能は保留」と同じ方針)。
        console.warn(`[check-version-bump] 起点 ${baseRef} を解決できない (未fetch等)。版バンプ検査をスキップする。`);
        softSkip = true;
        changed = [];
    } else {
        console.error('[check-version-bump] git diff に失敗:', e.message);
        process.exit(1);
    }
}

if (softSkip) {
    process.exit(0);
}

if (changed.length === 0) {
    console.log('[check-version-bump] js/css の変更なし。スキップ。');
    // 変更が無い場合も、未参照ファイルの警告だけは出しておく (別観点の検査のため)。
    try {
        const nowHtml = headRef ? git(['show', `${headRef}:index.html`]) : readFileSync('index.html', 'utf-8');
        warnUnreferenced(headRef, extractVersions(nowHtml));
    } catch { /* ここでの失敗は無視 (本来の判定には影響させない) */ }
    process.exit(0);
}

let baseHtml;
let nowHtml;
try {
    baseHtml = git(['show', `${baseRef}:index.html`]);
    nowHtml = headRef ? git(['show', `${headRef}:index.html`]) : readFileSync('index.html', 'utf-8');
} catch (e) {
    console.error('[check-version-bump] index.html 取得に失敗:', e.message);
    process.exit(1);
}

const baseVers = extractVersions(baseHtml);
const nowVers = extractVersions(nowHtml);

const stale = changed.filter((file) => nowVers.has(file) && baseVers.get(file) === nowVers.get(file));

warnUnreferenced(headRef, nowVers);

if (stale.length > 0) {
    console.error('[check-version-bump] 以下は変更されていますが index.html の ?v= が更新されていません:');
    for (const f of stale) console.error(`  - ${f} (現在 ?v=${nowVers.get(f)})`);
    console.error('index.html の該当 <script>/<link> の ?v= を新しい値 (例: 日付 YYYYMMDDNN) にバンプしてください。');
    process.exit(1);
}
console.log('[check-version-bump] OK: 変更された js/css はすべて ?v= がバンプ済み。');
