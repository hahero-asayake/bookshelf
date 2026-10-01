// username ブロックリストのデータ生成スクリプト (イシュー#271・ADR-114の拡張)
//
// 有志の公開リスト(出典は THIRD_PARTY_NOTICES.md 参照)から
// cf-worker/username-blocklist-data.js (EXACT_WORDS / SUBSTRING_WORDS) を生成する。
//
// 実行:
//   node scripts/blocklist/build-username-blocklist.mjs
//
// 入力 (このリポジトリに同梱・再現可能なもの):
//   - scripts/blocklist/ja-romaji-candidates.txt   手動選定した日本語ローマ字候補 (②承認・目安30-80語)
//   - scripts/blocklist/false-positive-romaji-corpus.txt  誤爆検証用の日本語ローマ字コーパス
//   - /usr/share/dict/american-english             誤爆検証用の英単語コーパス (Debian/Ubuntu 標準・wordsパッケージ)
//
// 入力 (このリポジトリには同梱しない・原データ。取得済みキャッシュを tmp/271-lists/ に置いて使う。
//        tmp/ は .gitignore 対象のため、再実行する場合は下記 SHA で再取得すること):
//   - tmp/271-lists/shouldbee-reserved.json   https://github.com/shouldbee/reserved-usernames
//                                              commit 0302214e8c1363fc5877ce3343ef6262e8852e96 (master)
//                                              raw: https://raw.githubusercontent.com/shouldbee/reserved-usernames/master/reserved-usernames.json
//   - tmp/271-lists/big-username-blocklist.txt  https://github.com/marteinn/The-Big-Username-Blocklist
//                                              commit c5d456f6af0285931c85e08d53ed7e1ac35d31fc (master)
//                                              raw: https://raw.githubusercontent.com/marteinn/The-Big-Username-Blocklist/master/list.txt
//   - tmp/271-lists/ldnoobw-en.txt  https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words
//                                              commit 5faf2ba42d7b1c0977169ec3611df25a3c08eb13 (master)
//                                              raw: .../master/en
//
// 方針 (②承認・2026-10-01 step1/step2):
//   ① データ同梱を採用。obscenity (jo3-l/obscenity, MIT) は出典として参照するのみで依存には加えない
//      (英語データのみで日本語データがなく、二重管理になるため)。
//   ② 運営・システム系予約語 (shouldbee + big-username-blocklist) は完全一致 (EXACT_WORDS) に採用。
//      数字のみの語 (HTTPステータスコード等) も3文字以上なら含める (404/500等の誤登録防止として害が無い)。
//   ③ 不適切語 (LDNOOBW en・日本語ローマ字手動選定) は「誤爆ゼロなら部分一致・1件でもあれば完全一致」で振り分け。
//   ④ 日本語の不適切語 (LDNOOBW ja・MosasoM) は全自動のローマ字化をせず、性的語・差別語の代表を手で選んで
//      ローマ字化したもの (scripts/blocklist/ja-romaji-candidates.txt) のみを対象にする。
//
// 既存の手書き IMPERSONATION_WORDS / COMPLIANCE_WORDS (hitler/nazi 等・cf-worker/username-blocklist.js) は
// このスクリプトの対象外 (手書きのまま維持・依頼3)。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const TMP_DIR = path.join(REPO_ROOT, 'tmp/271-lists');

const USERNAME_RE = /^[a-z0-9-]{3,30}$/;
const LEET_MAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };
// cf-worker/username-blocklist.js の normalizeForBlocklist と同一ロジック (生成データの整合性のため複製)。
function normalize(u) {
    const base = String(u).normalize('NFKC').toLowerCase().replace(/-/g, '');
    return base.replace(/[013457]/g, (c) => LEET_MAP[c] || c);
}

function readLines(p) {
    return fs.readFileSync(p, 'utf8')
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('#'));
}

// --- 既存の手書き語 (重複除去用。cf-worker/username-blocklist.js と同期させること) ---
const EXISTING_IMPERSONATION = [
    'admin', 'administrator', 'root', 'official', 'support', 'staff',
    'moderator', 'system', 'sysadmin', 'superuser', 'owner',
    'asayake', 'bookshelf',
];
const EXISTING_COMPLIANCE = [
    'porn', 'xxx', 'hentai', 'nude',
    'nigger', 'nigga', 'chink', 'retard', 'fag',
    'hitler', 'nazi',
    'murder', 'genocide', 'massacre',
    'cocaine', 'marijuana', 'fentanyl', 'methamphetamine',
];
const EXISTING_RESERVED_USERNAMES = [
    'top', 'about', 'legal', 'help', 'api', 'username',
    'public', 'data', 'session', 'publish', 'billing', 'admin', 'usage',
    'kindle', 'community',
    'www', 'css', 'img', 'static', 'assets',
];
const EXISTING_ALL = new Set([...EXISTING_IMPERSONATION, ...EXISTING_COMPLIANCE, ...EXISTING_RESERVED_USERNAMES]);

// --- 誤爆検証コーパス ---
function buildFalsePositiveCorpus() {
    const dict = fs.readFileSync('/usr/share/dict/american-english', 'utf8')
        .split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean)
        .filter((w) => /^[a-z]{3,30}$/.test(w));
    const romaji = readLines(path.join(__dirname, 'false-positive-romaji-corpus.txt'));
    return [...new Set([...dict, ...romaji.map((s) => s.toLowerCase())])];
}

// 候補語を部分一致にした場合、コーパス中の何語を誤爆するかを返す (自分自身の完全一致は除く)。
function countFalsePositives(word, corpus) {
    const nw = normalize(word);
    let count = 0;
    for (const c of corpus) {
        if (c === word) continue;
        if (normalize(c).includes(nw)) count++;
    }
    return count;
}

function main() {
    const corpus = buildFalsePositiveCorpus();

    // --- ① 運営・システム系予約語 (完全一致候補) ---
    const shouldbee = JSON.parse(fs.readFileSync(path.join(TMP_DIR, 'shouldbee-reserved.json'), 'utf8'));
    const big = readLines(path.join(TMP_DIR, 'big-username-blocklist.txt'));
    const reservedExact = [...new Set(
        [...shouldbee, ...big]
            .map((w) => String(w).toLowerCase())
            .filter((w) => USERNAME_RE.test(w))
            .filter((w) => !EXISTING_ALL.has(w))
    )].sort();

    // --- ② 不適切語 (LDNOOBW en) ---
    const ldnoobwEn = readLines(path.join(TMP_DIR, 'ldnoobw-en.txt')).map((s) => s.toLowerCase());
    const ldnoobwSingleWord = [...new Set(
        ldnoobwEn.filter((w) => /^[a-z0-9]+$/.test(w) && w.length >= 3 && !EXISTING_ALL.has(w))
    )];
    const enSplit = { substring: [], exact: [] };
    for (const w of ldnoobwSingleWord) {
        const fp = countFalsePositives(w, corpus);
        (fp === 0 ? enSplit.substring : enSplit.exact).push(w);
    }

    // --- ③ 日本語ローマ字手動選定 (②承認・2026-10-01) ---
    const jaCandidates = readLines(path.join(__dirname, 'ja-romaji-candidates.txt'));
    const jaSplit = { substring: [], exact: [] };
    for (const w of jaCandidates) {
        const fp = countFalsePositives(w, corpus);
        (fp === 0 ? jaSplit.substring : jaSplit.exact).push(w);
    }

    const EXACT_WORDS = [...new Set([...reservedExact, ...enSplit.exact, ...jaSplit.exact])].sort();
    const SUBSTRING_WORDS = [...new Set([...enSplit.substring, ...jaSplit.substring])].sort();

    // hahero / kurokotest の保護を生成時にも機械確認する (ビルド自体を失敗させる安全弁)。
    for (const u of ['hahero', 'kurokotest']) {
        const nu = normalize(u);
        if (EXACT_WORDS.map(normalize).includes(nu)) {
            throw new Error(`生成データに既存ユーザー '${u}' と完全一致する語が含まれる: build を中止`);
        }
        const hit = SUBSTRING_WORDS.find((w) => nu.includes(normalize(w)));
        if (hit) {
            throw new Error(`生成データに既存ユーザー '${u}' を誤爆させる部分一致語 '${hit}' が含まれる: build を中止`);
        }
    }

    const out = `// username ブロックリスト 生成データ (自動生成・手編集禁止)
// 生成元: scripts/blocklist/build-username-blocklist.mjs (イシュー#271)
// 出典・ライセンス: cf-worker/THIRD_PARTY_NOTICES.md 参照
//
// EXACT_WORDS: username 全体がこの語と完全一致する場合のみ弾く (①運営・システム系予約語＋②③の
//   振り分けで誤爆が確認された語)。SUBSTRING_WORDS: 部分一致で弾く (誤爆ゼロを確認済みの語のみ)。
// 振り分け方針・誤爆件数は #271 の報告 (projects/detail/bookshelf.md 参照) に記載。
//
// 内訳:
//   EXACT_WORDS     = 運営・システム系予約語 ${reservedExact.length}語 (shouldbee/reserved-usernames + marteinn/The-Big-Username-Blocklist)
//                    + 不適切語(英) ${enSplit.exact.length}語 (LDNOOBW en・部分一致で誤爆したため完全一致に振替)
//                    + 不適切語(日本語ローマ字) ${jaSplit.exact.length}語 (手動選定・同上)
//                    計 ${EXACT_WORDS.length}語 (重複除去後)
//   SUBSTRING_WORDS = 不適切語(英) ${enSplit.substring.length}語 + 不適切語(日本語ローマ字) ${jaSplit.substring.length}語
//                    計 ${SUBSTRING_WORDS.length}語 (重複除去後・誤爆ゼロ確認済み)

export const EXACT_WORDS = ${JSON.stringify(EXACT_WORDS, null, 4)};

export const SUBSTRING_WORDS = ${JSON.stringify(SUBSTRING_WORDS, null, 4)};
`;

    const outPath = path.join(REPO_ROOT, 'cf-worker/username-blocklist-data.js');
    fs.writeFileSync(outPath, out, 'utf8');

    console.log(`生成完了: ${outPath}`);
    console.log(`EXACT_WORDS: ${EXACT_WORDS.length}語 (予約語${reservedExact.length} + 不適切語英${enSplit.exact.length} + 不適切語日${jaSplit.exact.length})`);
    console.log(`SUBSTRING_WORDS: ${SUBSTRING_WORDS.length}語 (不適切語英${enSplit.substring.length} + 不適切語日${jaSplit.substring.length})`);
    console.log(`誤爆コーパス: ${corpus.length}語`);
}

main();
