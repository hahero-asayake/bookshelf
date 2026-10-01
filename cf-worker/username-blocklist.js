// username のブロックリスト (ADR-114・2026-10-01 ハヘロ決裁「案B・公式マーク無し」・イシュー#269 step2)
// reserved-usernames.js の RESERVED_USERNAMES (完全一致の予約語) とは別に、
// 「なりすまし」「コンプライアンス違反」のおそれがある語を**部分一致**で弾く。
// 判定は正規化後 (NFKC → 小文字化 → ハイフン除去 → 数字の見た目類似を標準字へ寄せる) の
// 文字列に対して行う (normalizeForBlocklist / containsBlockedWord)。
//
// リストは意図的に保守的 (false positive を避けるため、一般語と高頻度に衝突する短い語根は
// 採らない)。追加はこの配列へ足すだけでよい (reserved-usernames.js 側の変更は不要)。

// ① 運営・権限を騙る語 (なりすまし対策)。ハヘロ決裁の例示
// (admin/administrator/root/official/support/staff/moderator/system/asayake/bookshelf) + 類似語。
// 'mod' は 'model'/'modern'/'module' 等と衝突するため採らず、'moderator' (フルワード) のみにする。
// 'root'/'system' は 'uproot'/'ecosystem' 等と部分一致するが、決裁で名指しされた語のため残す
// (許容する既知のトレードオフ・tests/unit/username-blocklist.test.js に明記)。
// 'hahero' はサービスの公式 username 自身であり、ブロックリストに入れると
// 本人が POST /username で現用名を再送 (冪等チェック) した時に自分の名前が弾かれて
// 壊れるため**入れない** (isValidUsername は冪等チェックより前に呼ばれる・asayake-hub.js:279)。
export const IMPERSONATION_WORDS = [
    'admin', 'administrator', 'root', 'official', 'support', 'staff',
    'moderator', 'system', 'sysadmin', 'superuser', 'owner',
    'asayake', 'bookshelf',
];

// ② コンプライアンス違反のおそれがある語 (性的・差別/ヘイト・歴史的ヘイト人物・暴力・違法薬物)。
// 日本語のローマ字表記も含める。
//
// 以下は意図的に除外した (短すぎる/一般的すぎて実在語と衝突するため。tests で確認済み):
//   'ero'    → 'hero'/'zero' に含まれる。**本サービスの公式 username 'hahero' 自身 (h-a-h-"ero")
//              にも含まれるため、入れると公式アカウントが自分の名前を使えなくなる**
//   'rape'   → 'grape'/'drape'/'scraper'/'therapeutic' 等の一般語に含まれる
//   'kill'   → 'skill'/'skilled'/'skillful' 等の一般語に含まれる
//   'meth'   → 'method'/'methodology'/'methodical' 等の一般語に含まれる
//   'heroin' → 'heroine' (本棚＝読書アプリの文脈で普通に使われる語) に含まれる
// これらは本ブロックリストでは拾わず、フルワード (murder/genocide/massacre/methamphetamine 等)
// に留める。短い語根での機械的ブロックが必要になった場合は 07_残検討事項 に積み残す。
export const COMPLIANCE_WORDS = [
    // 性的
    'porn', 'xxx', 'hentai', 'nude',
    // 差別・ヘイト
    'nigger', 'nigga', 'chink', 'retard', 'fag',
    // 歴史的ヘイト人物・組織
    'hitler', 'nazi',
    // 暴力 (短い一般語と衝突する 'kill'/'rape' は除外。フルワードのみ)
    'murder', 'genocide', 'massacre',
    // 違法薬物 ('meth'/'heroin' は除外。フルワードのみ)
    'cocaine', 'marijuana', 'fentanyl', 'methamphetamine',
];

const ALL_BLOCKED_WORDS = [...IMPERSONATION_WORDS, ...COMPLIANCE_WORDS];

// 数字の見た目類似 → 標準字 (username 制約は [a-z0-9-] のみなので記号の置換は不要)
const LEET_MAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };

// 比較用正規化: NFKC → 小文字化 → ハイフン除去 → 数字の見た目類似を標準字へ寄せる
// (例: 'adm1n' → 'admin', 'r00t-official' → 'rootofficial')
export function normalizeForBlocklist(u) {
    const base = String(u).normalize('NFKC').toLowerCase().replace(/-/g, '');
    return base.replace(/[013457]/g, (c) => LEET_MAP[c] || c);
}

// username (登録前の生文字列) がブロック語を部分一致で含むか判定する
export function containsBlockedWord(u) {
    const n = normalizeForBlocklist(u);
    return ALL_BLOCKED_WORDS.some((w) => n.includes(w));
}
