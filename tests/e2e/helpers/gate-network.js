// 門のE2E (テスト名に `@gate` と観測点ID) で使う、電波なし・電波が戻る、の切り替え (イシュー#617)。
// 書き方の決まりは tests/e2e/gate/README.md。
//
// context.setOffline(true) だけでは、ブラウザによって「電波なしの間に外部へ届くか」が違う (2026-11-14・イシュー#617 で実測):
//   - chromium: navigator.onLine は false になり 'offline' も出るが、route で模擬した通信は模擬が答えてしまう (届く)
//   - webkit:   模擬した通信も失敗する (届かない)
// どちらでも 'online'・'offline' は出る。ここでは、電波なしの間は外部の模擬にも届かないように、模擬より手前で通信を落とす。
//
// 使う順番:
//   前提: await mockHubForTest(page, hub); await prepareOfflineForTest(context, `${HUB_BASE}/**`);  ← 模擬を掛けた後に呼ぶ
//   操作: await goOfflineForTest(context); … await goOnlineForTest(context);
const cut = new WeakMap();

/** 電波なしの間は、glob に合う外部への通信を通信エラーで落とす仕込みをする (電波がある間は、先に掛けた模擬へそのまま渡す)。
 * 後から掛けた route が先に呼ばれるので、外部の模擬 (mockHubForTest 等) を掛けた後に呼ぶ。
 * @param {import('@playwright/test').BrowserContext} context @param {string} glob 例: 'https://mockhub.test/**' */
export async function prepareOfflineForTest(context, glob) {
    const net = { offline: false };
    cut.set(context, net);
    await context.route(glob, (route) => (net.offline ? route.abort('internetdisconnected') : route.fallback()));
}

/** 電波を切る (navigator.onLine が false になり、'offline' が出る)。
 * @param {import('@playwright/test').BrowserContext} context */
export async function goOfflineForTest(context) {
    const net = cut.get(context);
    if (net) net.offline = true;
    await context.setOffline(true);
}

/** 電波を戻す (navigator.onLine が true になり、'online' が出る)。
 * @param {import('@playwright/test').BrowserContext} context */
export async function goOnlineForTest(context) {
    const net = cut.get(context);
    if (net) net.offline = false;
    await context.setOffline(false);
}
