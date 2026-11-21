// イシュー#701 (テスト監査 #690 の10番): 単体テストは外へ接続しない。
// テストが差し替えていない fetch を呼ぶと、本物の外部 (api.github.com など) へ出てしまう
// (tests/unit/book-memo-move-target-exists.test.js が、GitHubAdapter の tree の一覧の取得で実際に出ていた)。
// ここで、差し替えていない fetch を必ず失敗させ、呼んだテストを落とす。
// - テストが自分で差し替えた fetch (globalThis.fetch = …・vi.stubGlobal('fetch', …)) はそのまま効く。
// - 本体が通信の失敗を握りつぶす経路 (例: GitHubAdapter._ensureRemoteShaMap の catch) でも気づけるよう、
//   呼ばれた URL を控えておき、テストの終わり (afterEach) で落とす。
import { afterEach } from 'vitest';

const blockedUrls = [];
const blockedFetch = async (input) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    blockedUrls.push(url);
    throw new TypeError(`単体テストが差し替えていない fetch を呼んだ (外へ接続しない・イシュー#701): ${url}`);
};
globalThis.fetch = blockedFetch;

afterEach(() => {
    if (blockedUrls.length === 0) return;
    const urls = blockedUrls.splice(0);
    throw new Error(`単体テストが差し替えていない fetch を呼んだ (通信の口を差し替えること・イシュー#701):\n  ${urls.join('\n  ')}`);
});
