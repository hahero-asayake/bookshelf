// 門のE2E (テスト名に `@gate` と観測点ID) の前提: 保存の失敗の自動の再試行の間隔を短くする (イシュー#632)。
// 書き方の決まりは tests/e2e/gate/README.md。
//
// 保存の失敗は、js/bookshelf.js の _onSyncFailed が自動で再試行し、3回とも失敗したら状態バーに原因の文と
// 「再試行」を出す (ADR-158)。間隔の既定は 5秒・15秒・45秒 (js/sync-failure.js の RETRY_DELAYS_MS) で、
// 尽きるまで約66秒かかる。ここでは待ち時間だけを縮める。通る経路 (_runPendingSync → _onSyncFailed → 状態バー) は本物のまま。
// 使うのは、アプリが E2E のために持つ口 (localStorage 'bookshelf.flag.syncRetryDelaysMs'・js/sync-failure.js の retryDelays)。

/** 自動の再試行の間隔を delays (ミリ秒の配列) にする。アプリを開く前 (bootAppForTest の前) に、前提の区間で呼ぶ。
 * @param {import('@playwright/test').Page} page
 * @param {number[]} [delays] */
export async function shortenSyncRetryForTest(page, delays = [300, 300, 300]) {
    await page.addInitScript((json) => {
        localStorage.setItem('bookshelf.flag.syncRetryDelaysMs', json);
    }, JSON.stringify(delays));
}
