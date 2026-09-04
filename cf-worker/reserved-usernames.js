// username 予約語 (S6・ADR-076・設計書 09 §10.3-v2)
// bookshelf-cdn.js (配信) と asayake-hub.js (POST /username) の双方から参照する共通定義。
//
// 2種に分離する (username 制約 [a-z0-9-]{3,30} に照らした違い):
//   ① RESERVED_USERNAMES: 3文字以上・制約上は取得できてしまう語 → username 登録 API でブロックする
//   ② EXCLUDED_PATHS:      3文字未満、またはドット/拡張子を含み、制約上そもそも取得できない語
//                           → 配信 Worker のルーティングで username 解決を試みず素通りする
// どちらも「bookshelf.asayake.org の第1階層パスセグメント」としては予約済み扱いにする点は同じ。

export const RESERVED_USERNAMES = [
    'top', 'about', 'legal', 'help', 'api', 'username',
    'public', 'data', 'session', 'publish', 'billing', 'admin', 'usage',
    'kindle', 'community',
    // 3文字以上で制約上は取得可能なため①に含める (2026-09-05 ②承認3点目の指摘を実装時に精査し訂正。
    // static/assets も同様に3文字以上のため①側)
    'www', 'css', 'img', 'static', 'assets'
];

// 'go' 'me' 'js' は2文字 = username 制約 {3,30} を満たさずそもそも取得不可のため②側
export const EXCLUDED_PATHS = [
    'go', 'me', 'js',
    'favicon.ico', 'robots.txt', 'sitemap.xml', 'ads.txt', '.well-known'
];

// 配信 Worker のルーティング判定用: ①②をまとめた「第1階層で予約済みのセグメント」全体
export const ALL_RESERVED_TOP_LEVEL = [...RESERVED_USERNAMES, ...EXCLUDED_PATHS];

const USERNAME_RE = /^[a-z0-9-]{3,30}$/;

// username として登録可能か (制約 + 予約語チェック)。配信ルーティングの除外判定には isReservedTopLevel を使う。
export function isValidUsername(u) {
    if (typeof u !== 'string') return false;
    if (!USERNAME_RE.test(u)) return false;
    if (u.startsWith('-') || u.endsWith('-')) return false;
    if (RESERVED_USERNAMES.includes(u)) return false;
    return true;
}

export function isReservedTopLevel(segment) {
    return ALL_RESERVED_TOP_LEVEL.includes(segment);
}
