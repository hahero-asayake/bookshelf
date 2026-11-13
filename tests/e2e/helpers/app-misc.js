// drawer/palette/route以外の核心・雑多な内部参照に関するテストヘルパー (U9・イシュー#554・G4 step3)。
//
// 分類 (docs/char/u9-g4-plan.md 参照):
// - triggerAppVersionCheck/spyOnAppVersionCheck/mockPwaUpdateReloadFallbackは(c)。
//   _checkAppVersion・_applyPwaUpdate・_pwaUpdateReg・_onPwaUpdateReadyはいずれも
//   「メソッド自体を呼ぶ/上書きする」モック・スパイパターンで、クリックでは代替できない
//   (fetchモック結果の反映・呼び出し回数計測・reg無しフォールバック経路の検証が目的)。
// - waitForListStaged/getOrderedBooksToRenderは(c)状態検査。_listTail/_orderedBooksToRenderは
//   段階描画の内部状態で、DOM側に型/内容を1:1で示す属性が無い。
// - mockRunPublishExportは(c)モック。GitHubAdapterの実API呼び出しを踏ませないためのテスト注入点。
// - stallLongMemoRead/releaseLongMemoReadは(c)。__releaseReadはテストが`window.bookshelf`に
//   後付けした計測/解放フックで、本体の正式メソッドではない。
// - mockSyncRouteAndMobileCompatは(c)。touch-reorder.spec.jsのbootApp専用で、元の1回のevaluateの
//   まま(_isSyncReady/_applyRouteの上書き・_openDrawer/_applyHeaderLayoutの呼び出し・
//   pluginLoaderのモック)を連結して行う(#552/#553の「1回のevaluateは分割しない」教訓の踏襲)。
// - navigateToMainInternalは(c)。_navigateFromUi('main')/_setBodyView('main')の二択
//   (routerは常にtrueのためelseは死に経路・#554 step2で確認済み)を内部呼び出しのまま行う。
//   対象3件(bookshelf-clip-373/385.spec.js)はwebkit限定(`test.skip(browserName!=='webkit')`)の
//   高速連打/再現テストで、本runでは実行されず実クリックへの置換の検証ができないため、
//   検証できない変更はリスクが高いという#550/#553の教訓に沿って(c)のまま残した
//   (ux-p1-nav.spec.jsの1件は通常のchromium実行・検証可能なため(a)化=helpers/nav.jsのnavigateHome)。

/** _checkAppVersion()を直接呼び、新バージョン検知を発火させる(公開メソッド経由・内部状態は書き換えない)。
 * @param {import('@playwright/test').Page} page */
export async function triggerAppVersionCheck(page) {
    await page.evaluate(() => window.bookshelf._checkAppVersion());
}

/** _checkAppVersionの呼び出し回数を計測するスパイを仕込む。呼び出し後は`window.__versionCheckCalls`で読む。
 * @param {import('@playwright/test').Page} page */
export async function spyOnAppVersionCheck(page) {
    await page.evaluate(() => {
        window.__versionCheckCalls = 0;
        const orig = window.bookshelf._checkAppVersion.bind(window.bookshelf);
        window.bookshelf._checkAppVersion = (...args) => {
            window.__versionCheckCalls++;
            return orig(...args);
        };
    });
}

/** PWA未登録(reg無し)時のフォールバック(location.reload()相当)を検証するためのモック。
 * _applyPwaUpdateをreg.waiting無しならreloadフラグを立てる形に差し替え、_onPwaUpdateReady(null)で
 * 通知を発火させる(元の呼び方どおり1回のevaluateで連結したまま呼ぶ)。呼び出し後は`window.__reloaded`で読む。
 * @param {import('@playwright/test').Page} page */
export async function mockPwaUpdateReloadFallback(page) {
    await page.evaluate(() => {
        window.__reloaded = false;
        window.bookshelf._applyPwaUpdate = (() => {
            const orig = window.bookshelf._applyPwaUpdate.bind(window.bookshelf);
            return function patched() {
                if (!(window.bookshelf._pwaUpdateReg && window.bookshelf._pwaUpdateReg.waiting)) {
                    window.__reloaded = true;
                    return;
                }
                return orig();
            };
        })();
        window.bookshelf._onPwaUpdateReady(null);
    });
}

/** 段階描画(_listTail)が完了するまで待つ。
 * @param {import('@playwright/test').Page} page */
export async function waitForListStaged(page) {
    await page.waitForFunction(() => !window.bookshelf._listTail);
}

/** 描画されるべき並び順(_orderedBooksToRender)のasin配列を返す。
 * @param {import('@playwright/test').Page} page @returns {Promise<string[]>} */
export async function getOrderedBooksToRender(page) {
    return page.evaluate(() => window.bookshelf._orderedBooksToRender().map((b) => b.asin));
}

/** _runPublishExportをモックし、GitHubAdapterの実API呼び出しを踏ませない。
 * @param {import('@playwright/test').Page} page @param {object} result */
export async function mockRunPublishExport(page, result = { ok: true, result: { siteUrl: 'https://hahero-asayake.github.io/bookshelf-public/', errors: [] } }) {
    await page.evaluate((r) => { window.bookshelf._runPublishExport = async () => r; }, result);
}

/** 長文メモの読込(readBookMemo)を保留させ、`__releaseRead`を解放用フックとして仕込む。
 * @param {import('@playwright/test').Page} page */
export async function stallLongMemoRead(page) {
    await page.evaluate(() => {
        let release;
        window.bookshelf.__releaseRead = () => release && release();
        window.bookshelf.storage.readBookMemo = () => new Promise((resolve) => {
            release = () => resolve('# 長文メモ本文');
        });
    });
}

/** stallLongMemoReadで保留させた読込を解放する。
 * @param {import('@playwright/test').Page} page */
export async function releaseLongMemoRead(page) {
    await page.evaluate(() => window.bookshelf.__releaseRead());
}

/** touch-reorder.spec.jsのbootApp専用。sync準備済みモック・ルーター再適用の無効化・
 * (webkit/モバイル幅での)ドロワー開放・プラグインローダのモック・ヘッダーレイアウト再計算を
 * 元の1回のevaluateのまま連結して行う。
 * @param {import('@playwright/test').Page} page */
export async function mockSyncRouteAndMobileCompat(page) {
    await page.evaluate(() => {
        const app = window.bookshelf;
        app.saveUserData = async () => {};
        app._isSyncReady = () => true;
        // ルーター(hashchange)の非同期な再適用が showBookDetail(book, true) を showBookDetail(book, false)
        // で上書きしてしまう現象を実測した(bd-sectionテスト用、直接関数呼び出しとURLハッシュが不整合なため)。
        // E2E専用の割り切りとして _applyRoute を無効化する。
        app._applyRoute = () => {};
        // モバイル幅(webkit=iPhone 13)ではサイドバーがドロワーで畳まれており、ツリー/ヘッダーの
        // 要素は DOM 上に存在しても画面外にある(elementFromPointがnullを返す)。開いておく。
        if (typeof app._openDrawer === 'function') app._openDrawer();
        app.pluginLoader = app.pluginLoader || {};
        app.pluginLoader.listInstalledPlugins = async () => ([
            { id: 'reading-goal', manifest: { name: '読書目標', version: '1.0', description: 'd1', icon: 'target' } },
            { id: 'pinned-memo', manifest: { name: 'ピン留めメモ', version: '1.0', description: 'd2', icon: 'pin' } },
        ]);
        app.pluginLoader.loaded = new Map([['reading-goal', {}], ['pinned-memo', {}]]);
        if (app.pluginAPI) {
            app.pluginAPI._uiButtons = [
                { id: 'btn-a', pluginId: 'reading-goal', title: 'A', label: 'A', emoji: '🎯', active: false, onClick: () => {} },
                { id: 'btn-b', pluginId: 'pinned-memo', title: 'B', label: 'B', emoji: '📌', active: false, onClick: () => {} },
            ];
        }
        app._applyHeaderLayout();
    });
}

/** _navigateFromUi('main')/_setBodyView('main')の二択を内部呼び出しのまま行う(webkit限定の
 * 高速連打/再現テスト用・本runでは実行されず実クリック化の検証ができないため(c)のまま残す)。
 * @param {import('@playwright/test').Page} page */
export async function navigateToMainInternal(page) {
    await page.evaluate(() => { if (window.bookshelf.router) window.bookshelf._navigateFromUi('main'); else window.bookshelf._setBodyView('main'); });
}

/** 星クリックと同じ経路(saveRating+_applyRatingEverywhereのセット呼び出し、js/bookshelf.js:2437-2446)
 * を実クリックで再現する。既にその評価の星がクリック可能な状態であること前提(一覧カードの星)。
 * @param {import('@playwright/test').Page} page @param {string} asin @param {number} rating クリックする星の値 */
export async function clickStarRating(page, asin, rating) {
    await page.locator(`.book-item[data-asin="${asin}"] .star-rating .star[data-rating="${rating}"]`).click();
}
