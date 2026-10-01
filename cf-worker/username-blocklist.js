// username のブロックリスト (ADR-114・2026-10-01 ハヘロ決裁「案B・公式マーク無し」・イシュー#269 step2)
// reserved-usernames.js の RESERVED_USERNAMES (完全一致の予約語) とは別に、
// 「なりすまし」「コンプライアンス違反」のおそれがある語を弾く。
// 判定は正規化後 (NFKC → 小文字化 → ハイフン除去 → 数字の見た目類似を標準字へ寄せる) の
// 文字列に対して行う (normalizeForBlocklist / containsBlockedWord)。
//
// イシュー#271 (2026-10-01) で有志の公開リストを取り込んだ。部分一致での誤爆 (false positive)
// が最大のリスクのため、完全一致 (EXACT_WORDS) と部分一致 (SUBSTRING_WORDS) を分けている:
//   - EXACT_WORDS: username 全体がこの語と完全一致する場合のみ弾く。運営・システム系予約語
//     (marteinn/The-Big-Username-Blocklist・shouldbee/reserved-usernames) と、不適切語のうち
//     誤爆検証で1件でも衝突した語 (例: 'rape'→'grape'/'drape' 等) が入る。
//   - SUBSTRING_WORDS: 部分一致で弾く。誤爆検証 (英単語辞書+日本語ローマ字コーパス) でゼロ件を
//     確認した語のみ。
// 生成元は scripts/blocklist/build-username-blocklist.mjs (手編集しない・再生成は同スクリプトを
// 実行)。出典・ライセンスは THIRD_PARTY_NOTICES.md 参照 (CC-BY-4.0 の LDNOOBW を含む)。
//
// 下記 IMPERSONATION_WORDS / COMPLIANCE_WORDS は #269 由来の手書きリスト (ハヘロ決裁の例示語・
// ヒトラー等のヘイト人物名を含む)。公開リストにはヘイト人物名がほぼ無いため、このまま残す
// (依頼3)。追加はこの配列へ足すだけでよい (reserved-usernames.js 側の変更は不要)。
import { EXACT_WORDS, SUBSTRING_WORDS } from './username-blocklist-data.js';

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

// 部分一致で弾く語 (手書き語＋生成データ)
const ALL_SUBSTRING_WORDS = [...IMPERSONATION_WORDS, ...COMPLIANCE_WORDS, ...SUBSTRING_WORDS];

// 数字の見た目類似 → 標準字 (username 制約は [a-z0-9-] のみなので記号の置換は不要)
const LEET_MAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };

// 比較用正規化: NFKC → 小文字化 → ハイフン除去 → 数字の見た目類似を標準字へ寄せる
// (例: 'adm1n' → 'admin', 'r00t-official' → 'rootofficial')
export function normalizeForBlocklist(u) {
    const base = String(u).normalize('NFKC').toLowerCase().replace(/-/g, '');
    return base.replace(/[013457]/g, (c) => LEET_MAP[c] || c);
}

// 完全一致で弾く語 (生成データ) は2種に分ける (イシュー#271 step3 実測で判明した罠):
//   - 数字のみの語 (予約語中の HTTP ステータスコード等): leet 変換を適用すると実在の英単語と衝突する
//     (例: '415' → leet変換で 'ais' になり、辞書に実在する一般語 'ais' を弾いてしまう)。
//     数字のみの語はそもそも見た目のなりすまし偽装を想定する必要が薄いため、
//     ハイフン除去のみ行い leet 変換はしない生の数字文字列で比較する。
//   - それ以外: 従来どおり正規化 (leet 変換込み) して比較する (例: 'r00t' → 'root' の偽装を弾く)。
// いずれも Set 化し、モジュールロード時に1回だけ構築 (CPU は実測 8ns/回・無視できる水準)。
const EXACT_WORDS_NUMERIC = new Set(EXACT_WORDS.filter((w) => /^[0-9]+$/.test(w)));
const EXACT_WORDS_SET = new Set(EXACT_WORDS.filter((w) => !/^[0-9]+$/.test(w)).map(normalizeForBlocklist));

// username (登録前の生文字列) がブロック語を含むか判定する (完全一致→部分一致の順)
export function containsBlockedWord(u) {
    const rawDigits = String(u).normalize('NFKC').toLowerCase().replace(/-/g, '');
    if (EXACT_WORDS_NUMERIC.has(rawDigits)) return true;
    const n = normalizeForBlocklist(u);
    if (EXACT_WORDS_SET.has(n)) return true;
    return ALL_SUBSTRING_WORDS.some((w) => n.includes(w));
}
