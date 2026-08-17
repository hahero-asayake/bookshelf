// E2E は外部スクリプトを実ネットワークから読まない (イシュー#53)
//
// なぜ: bookshelf は起動のたびに2つの外部スクリプトを読みうる。
//   (1) js/hub-auth.js の _loadGis() が動的ロードする Google Identity Services
//       (accounts.google.com/gsi/client) — ハブパネルを開いた時のみ
//   (2) index.html:11 に直書きされた Google AdSense 審査用スニペット
//       (pagead2.googlesyndication.com/pagead/js/adsbygoogle.js) — 全ページロードで常時
// どちらも読み込まれると Google 側の内部処理 (GIS の初期化・AdSense の広告配信/不正検出)
// が sandboxed iframe (frame-ancestors 'self') を生成し、その CSP report-only 違反警告が
// 非同期で遅延着弾する。Playwright は複数テストでブラウザプロセスを使い回すため、この警告が
// 無関係な別テストの page.on('console') errors 配列に混入し、expect(errors).toEqual([]) を
// ランダムに落としていた (直近5 run 中2件 failure・docs のみの commit でも再現)。
//
// 実測で分かったこと (イシュー#53 検証時): 当初 GIS だけが原因と推定したが、GIS を
// window.google.accounts.id のモックで完全に遮断した (accounts.google.com への通信 0件)
// 状態でも同一の CSP エラー文言 ("Framing 'https://www.google.com/' violates ...") が
// 再現した。真因は AdSense 側 (googleads.g.doubleclick.net・adtrafficquality.google・
// www.google.com/recaptcha への通信を実測)。1つの外部スクリプトを塞いでも、もう1つが
// 同じ症状を出し続ける — 「外部スクリプトを実ネットワークから読まない」を両方に適用して
// 初めて恒久対処になる。
//
// 対処方針: GIS は window.google.accounts.id を事前定義して _loadGis() の早期 return
// 条件 (window.google.accounts.id が既にある) を満たし、<script src=gsi/client> の挿入
// 自体を防ぐ (addInitScript のみ)。AdSense は window.adsbygoogle をアプリ側の誰も参照
// していない (grep 済み・審査用スニペットのみで広告ユニット未配置) ため、
// adsbygoogle.js 自体の取得を route で止めるだけでよい。
//
// route は adsbygoogle.js の URL だけに限定する (**/pagead2.googlesyndication.com/** 等の
// 狭いパターン)。page.route/context.route はメインフレームだけでなく全 iframe にも適用され、
// bookshelf の記事プレビュー用 <iframe id="pp-preview-frame" sandbox="allow-same-origin">
// (index.html) との組み合わせでは、www.google.com/** のような広いパターンや
// --host-resolver-rules=MAP *.google.com ~NOTFOUND のような全体遮断は sandboxed iframe 側で
// 無関係な "SecurityError: Failed to read the 'localStorage' property ... Access is denied"
// を新たに発生させることを実測した (イシュー#53 検証時。同一パターンの GIS 広域 route でも
// 同じ干渉が起きた)。adsbygoogle.js を直接 route する狭いパターンではこの干渉は再現しない
// (プレビュー系テストを含む19ファイル139テストで確認済み)。もし将来同種の
// "SecurityError...Access is denied" が出た場合は route パターンを広げすぎていないか疑う。
//
// page fixture ではなく context fixture をオーバーライドする: page.addInitScript/page.route は
// そのテストのデフォルト page にしか効かない。onboarding-and-prefs.spec.js の
// 「welcome: ×で閉じてもセッション限り」テストは `context.newPage()` で2枚目のタブを開いて
// 検証しており、page 単位のオーバーライドだとその2枚目には遮断が一切効かず、本物の AdSense が
// 読み込まれて googleads.g.doubleclick.net への通信が残ることを実測した。context.addInitScript/
// context.route はその context から newPage() で作られる全 page に効くため、こちらを使う。
//
// 全 tests/e2e/*.spec.js はこのファイルから test/expect を import すること
// (@playwright/test を直接 import すると遮断が効かない)。
import { test as base, expect } from '@playwright/test';

function installGisMock() {
    window.google = window.google || {};
    window.google.accounts = window.google.accounts || {};
    window.google.accounts.id = {
        initialize() {},
        prompt() {},
        renderButton(container) {
            if (container) {
                const el = document.createElement('div');
                el.className = 'gis-mock-button';
                el.textContent = 'Sign in with Google (mock)';
                container.appendChild(el);
            }
        },
        disableAutoSelect() {},
        cancel() {},
        revoke(_hint, cb) { if (cb) cb({}); }
    };
}

export const test = base.extend({
    context: async ({ context }, use) => {
        await context.addInitScript(installGisMock);
        // index.html の AdSense 審査用スニペット (adsbygoogle.js) を止める。
        // このスクリプト自体を止めれば、それが内部で発生させる広告配信/不正検出通信
        // (googleads.g.doubleclick.net・adtrafficquality.google・www.google.com/recaptcha 等)
        // も連鎖的に発生しなくなる。
        // route.abort() ではなく空スクリプトの fulfill にする: <script async src=...> は
        // index.html に静的に書かれているため毎回必ずリクエストが発生し、abort するとブラウザが
        // "Failed to load resource: net::ERR_FAILED" を console error として出し、それ自体が
        // 新しいフレーク源になることを実測した (GIS は動的挿入なので abort で問題ないが、
        // 静的 <script> タグは fulfill で「読み込み成功」に見せる必要がある)。
        await context.route('https://pagead2.googlesyndication.com/**', (route) => route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: '// adsbygoogle.js stubbed out for E2E (issue #53)'
        }));
        await use(context);
    }
});

export { expect };
