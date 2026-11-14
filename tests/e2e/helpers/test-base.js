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
// E2E は easymde/lucide/Amazon 書影の実ネットワークにも出ない (イシュー#57)
//
// なぜ: #53 で GIS/AdSense を遮断した後も、フルスイート並列実行 (既定 8 workers) だけで
// 毎回違うテストがランダムに落ちるフレークが残っていた。trace で追ったところ、直列実行や
// 単体テストの反復では再現せず、フルスイート規模でのみ発生することを実測 (同一テストを
// --repeat-each 30 で単独反復しても 0/30、フルスイート4回中1回で再現)。dev server
// (bookshelf-dev.service) は失敗時間帯も全リクエスト 200 でエラー無し (journalctl 実測)
// のため、dev server の輻輳が原因ではない。
//
// trace のネットワークログを実測すると、GIS/AdSense 遮断後も bootApp() のたびに
// 3つの実外部通信が残っていた:
//   (1) index.html に直書きの EasyMDE (cdn.jsdelivr.net) — <link>/<script> が静的に
//       全ページで読み込まれ、<head> 内 <link rel=stylesheet> はレンダーブロッキング
//   (2) js/icons.js の Lucide アイコン CDN フォールバック (unpkg.com。#565で撤去・同梱化) — ローカルの
//       LUCIDE_ICONS に無いアイコン名は icon() が同期で空文字を返しつつ裏で fetch する
//       設計のため、1 ページ内で十数件の個別リクエストが飛ぶ
//   (3) js/book-manager.js の書影フォールバック URL (images-na.ssl-images-amazon.com)
// これらは js/vendor/README.md に明記された ADR-001 (ビルドレス・CDN 不使用) にも反する。
// フルスイート×8 workers ではこの実通信が短時間に集中し、単体反復ではブラウザキャッシュが
// 効いて再現しない、という差が「なぜ並列でだけ落ちるか」の実測に基づく最有力説明 (完全な
// 因果証明はできていないが、該当外部通信の遮断後にクリーンな10連続実行で確認する運用とする。
// 詳細は 08_意思決定記録.md ADR-066)。
//
// EasyMDE 本体 (cdn.jsdelivr.net) は route で潰さず js/vendor/easymde.min.js へ vendor 化した
// (marked.umd.js と同じ方針)。空スタブにすると `typeof EasyMDE === 'undefined'` の早期 return に
// 落ちて _bookMemoEditor が生成されず、standard-ops.spec.js の長文メモテストが壊れるため。
// 残る images-na.ssl-images-amazon.com (書影) は E2E の見た目にしか
// 影響しない (アイコン SVG の中身・書影の画素を検証しているテストは無い) ため、ここで
// route.fulfill する。route.abort() は使わない (#53 の教訓: net::ERR_FAILED が新しい
// console error を生む)。
//
// 表紙のホストは sw.js の COVER_HOSTS と同じ3つを全部返す (イシュー#637)
//
// なぜ: #57 で返していたのは images-na.ssl-images-amazon.com (ASIN からの組み立て・book-manager.js
// getProductImageUrl) だけだった。Kindle 取込が保存する m.media-amazon.com と、Amazon リンクから追加した本の
// images-amazon.com (bookshelf.js fetchBookMetadata) は返していなかった。#637 の実測 (scripts/verify/637-results.md)
// では、この2つへの要求は0件だったので予防で揃える。固定画像は同じ透明 PNG なので、visual の絵は変わらない。
// 同じ実測で、外へ出た表紙の要求53件は全部この fixture を通らない context から出ていた
// (@playwright/test の直 import・blockExternalForTest を掛けない browser.newContext())。
// これは npm run lint:e2e-external (scripts/check-e2e-external.mjs) で止める。
//
// 全 tests/e2e/*.spec.js はこのファイルから test/expect を import すること
// (@playwright/test を直接 import すると遮断が効かない・lint:e2e-external が検査する)。
// browser.newContext() で context を作る時は、その context に blockExternalForTest を掛けること。
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// 既知の赤 (イシュー#589): アプリの不具合で赤になっている門のE2E の一覧。直すイシューの番号つき (docs/gate/known-red.json)。
// E2E_SKIP_KNOWN_RED=1 の時だけ、この一覧のテストを外す (CI の e2e・webkit レグ)。門の判定 (gate-report) に渡す実行では
// 付けない = 赤のまま数える (外した結果を渡しても、gate-report は「未実行」として合格に数えない)。
const KNOWN_RED = JSON.parse(readFileSync(new URL('../../../docs/gate/known-red.json', import.meta.url), 'utf-8')).tests || [];

// 1x1 透明 PNG (書影スタブ用)
const TRANSPARENT_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
// 表紙の画像のホスト (sw.js の COVER_HOSTS と同じ3つ・イシュー#637)。ホスト単位の狭いパターンで返す (上の #53 の注意)
const COVER_IMAGE_HOSTS = ['images-na.ssl-images-amazon.com', 'm.media-amazon.com', 'images-amazon.com'];

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

/** 外部への通信の遮断と模擬 (GIS・AdSense・Amazon 書影) をコンテキストに掛ける。既定の context は下の fixture が
 * 掛ける。門のE2E で2つ目のコンテキスト (= 別の端末・tests/e2e/helpers/gate-device.js) を作る時も同じ物を掛ける
 * (イシュー#588 で fixture の中身をそのまま関数に切り出した。順番も中身も変えていない)。
 * @param {import('@playwright/test').BrowserContext} context */
export async function blockExternalForTest(context) {
    await context.addInitScript(installGisMock);
    // イシュー#513 S6: フラグ旧状態での比較(e2e-diff-main.mjs --init-storage)用の汎用口。
    // E2E_INIT_STORAGE は {"key":"value",...} のJSON文字列(環境変数)。S6専用の分岐は書かず、
    // どのテストでも使える汎用のlocalStorage事前注入にする(②指示・s6-scope.md §5)。
    // 既定(未設定)は何もしない=既存スイートの結果に影響しない。
    if (process.env.E2E_INIT_STORAGE) {
        const kv = JSON.parse(process.env.E2E_INIT_STORAGE);
        await context.addInitScript((pairs) => {
            for (const [k, v] of pairs) localStorage.setItem(k, v);
        }, Object.entries(kv));
    }
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
    // Lucide アイコンの unpkg.com 取得はイシュー#565で撤去済み (全部 js/icons.js に同梱)。
    // ここで route しないことで、万一復活したら tests/e2e/no-external-icons.spec.js が検出する。
    // Amazon 書影 (イシュー#57: ASIN からの組み立て URL・イシュー#637: COVER_HOSTS の残り2つも)
    for (const host of COVER_IMAGE_HOSTS) {
        await context.route(`https://${host}/**`, (route) => route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: Buffer.from(TRANSPARENT_PNG_BASE64, 'base64')
        }));
    }
}

export const test = base.extend({
    // 既知の赤を外す (上の KNOWN_RED の説明)。既定 (E2E_SKIP_KNOWN_RED 未設定) は何もしない
    skipKnownRed: [async ({}, use, testInfo) => {
        if (process.env.E2E_SKIP_KNOWN_RED === '1') {
            const hit = KNOWN_RED.find((k) => k.test === testInfo.title);
            if (hit) testInfo.skip(true, `既知の赤 (docs/gate/known-red.json・直すイシュー #${hit.issue})`);
        }
        await use();
    }, { auto: true }],
    context: async ({ context }, use, testInfo) => {
        await blockExternalForTest(context);
        await use(context);
        // イシュー#359 段階②: NavState 影モードのずれ (window.__navShadow.diffs) を opt-in で検査する。
        //   NAV_SHADOW_CHECK=log    … 各テスト終了時に diffs を NAV_SHADOW_LOG (jsonl) へ追記するだけ (集計用)
        //   NAV_SHADOW_CHECK=strict … 上に加えて diffs が 1件でもあればそのテストを失敗にする
        // 既定 (未設定) は何もしない = 既存スイートの結果に影響しない。
        const mode = process.env.NAV_SHADOW_CHECK;
        if (mode) {
            const rows = [];
            for (const p of context.pages()) {
                try {
                    const r = await p.evaluate(() => (window.__navShadow ? { diffs: window.__navShadow.diffs, inputs: window.__navShadow.inputs } : null));
                    if (r) rows.push(r);
                } catch (_) { /* 閉じたページ・遷移中は読めない = 対象外 */ }
            }
            const diffs = rows.flatMap((r) => r.diffs);
            if (process.env.NAV_SHADOW_LOG) {
                const { appendFileSync } = await import('node:fs');
                appendFileSync(process.env.NAV_SHADOW_LOG, JSON.stringify({ test: testInfo.titlePath.join(' > '), project: testInfo.project.name, inputs: rows.reduce((s, r) => s + r.inputs, 0), diffs }) + '\n');
            }
            if (mode === 'strict') expect(diffs, 'nav-shadow diffs').toEqual([]);
        }
    }
});

export { expect };
