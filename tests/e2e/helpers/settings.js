// 設定モーダルに関するテストヘルパー (U9・イシュー#548・G1置き換え)。
//
// 分類 (docs/char/u9-classification.md 参照):
// - openSettingsByClick は (a)利用者操作。設定画面を開く内部メソッドの直接呼び出しではなく、
//   実際にユーザーが辿るクリック経路を再現する。
// - openPluginSettingsByClick/getUsageAlertLevel/renderUsageAlertForTest/confirmOpenSettingsForTest/
//   openSettingsForTest は (c)テスト用ヘルパー。決定性(使用量が閾値を超えた状態・エラー注入経路)・
//   対象が実クリックで届かない(無効化されたプラグイン・非表示カテゴリ等)ため、クリックでは再現でき
//   ない内部呼び出しをこの1か所に集約する(内部参照自体は残るが、名前が変わった時に直す場所を
//   ここ1か所にする・e2e-diff-main.mjsでの実測#548 step4で(a)化を試みて不成立と判明したものを含む)。

// サブ要素id(カテゴリ内の特定の入力要素) → 親カテゴリの data-cat。
// 設定を開く内部メソッドは targetId がカテゴリ自身のidならそのカテゴリを開き、
// カテゴリ内の子要素のidなら親カテゴリを開いてその要素までscrollIntoViewする
// (js/screens/settings.js _scrollSettingsTo)。実クリックでは「親カテゴリを開く」までを再現する
// (多くのテストはカテゴリのpane-active/表示を見るだけで、scroll位置そのものは見ていない)。
const SUB_TARGET_CATEGORY = {
    'sync-method-select': 'sync-section',
};

// 設定モーダルを実際のクリックで開く。targetId を渡すとそのカテゴリ(または親カテゴリ)まで進める。
export async function openSettingsByClick(page, targetId) {
    // PC用(#sidebar-settings)とモバイル用([data-mobile-nav="settings"])はDOM上に両方常在し、
    // 狭幅側はdisplay:noneではなく画面外配置(オフキャンバス)で隠れる実装のため、CSSの可視性だけを見る
    // :visible 擬似クラスでは区別できない(実測・#548)。js/ui/viewport.js の境目(900/901px、
    // イシュー#505)と同じ基準でテスト側のviewport幅から判定し、実際に押せる側だけをクリックする。
    const vp = page.viewportSize();
    const mobile = !!vp && vp.width <= 900;
    await page.click(mobile ? '[data-mobile-nav="settings"]' : '#sidebar-settings');
    await page.locator('#settings-modal').waitFor({ state: 'visible' });
    if (!targetId) return;
    const cat = SUB_TARGET_CATEGORY[targetId] || targetId;
    await page.locator(`#settings-master .settings-cat[data-cat="${cat}"]`).click();
    if (cat === targetId) return;
    // サブ要素(カテゴリ内の特定入力)まで指定された場合は、_scrollSettingsTo と同じ見た目
    // (scrollIntoView+focus)を実際のDOM要素に対して再現する(visual回帰#548 step4で実測・
    // クリックだけだと画面上の位置が元のテストと変わり画像差分が出た)。
    await page.locator(`#${targetId}`).evaluate((el) => {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    });
}

// (c) プラグイン設定モーダルを開く内部呼び出し(実測#548 step4: back-nav-matrix/standard-opsの
// fixture-plugin/dark-themeは、設定→プラグイン一覧に実クリックで辿れる[data-settings-plugin]
// ボタンとして現れない状態のテストもあり、(a)実クリック化だと要素が出ずタイムアウトする。
// _openPluginSettings(id) はプラグイン一覧の描画に依存せずmanifestから直接モーダルを構築する
// 自己完結した内部メソッドのため、実クリックを強制せずここに集約する)。
export async function openPluginSettingsByClick(page, pluginId) {
    await page.evaluate((id) => window.bookshelf._openPluginSettings(id), pluginId);
}

// (c) 使用量アラートの現在値を直接読む(状態検査・内部参照はここ1か所に集約)。
export async function getUsageAlertLevel(page) {
    return page.evaluate(() => window.bookshelf._usageAlertLevel);
}

// (c) 使用量アラートを任意のペイロードで強制再描画する(決定性・実際にストレージを閾値まで
// 使わせることはテストでは非現実的なため、ここ1か所の内部呼び出しに集約する)。
export async function renderUsageAlertForTest(page, payload) {
    await page.evaluate((p) => window.bookshelf._renderUsageAlert(p), payload);
}

// (c) 確認ダイアログ経由で設定を開く内部呼び出し(決定性)。実際の呼び手は複数あり
// (通報フロー・公開フロー等)、どの呼び手でも「確認→設定を開く」という同じ経路を通る。
// overlay-front.spec.js の対照テストはこの経路自体の重なり順を検証するのが目的で、
// 実際の呼び手(通報フロー等)を経由させると無関係な状態(未ログイン等)を足すことになり
// 検証対象が変わってしまうため、ここでは内部呼び出しのまま1か所に集約する。
export async function confirmOpenSettingsForTest(page, message, targetId) {
    // _confirmOpenSettings は確認ダイアログのOKが押されるまで解決しないPromiseを返す非同期メソッド。
    // 呼び出し元(テスト)はこの後でOKボタンをクリックするため、ここでそのPromiseをawaitすると
    // 「OKクリックを待つ側」と「OKがクリックされるのを待つ側」が相互に止まる(実測#548 step4)。
    // 元の直接呼び出し(待たずに発火するだけ)と同じ挙動にするため、戻り値のPromiseは待たない。
    await page.evaluate(({ message, targetId }) => { window.bookshelf._confirmOpenSettings(message, targetId); }, { message, targetId });
}

// (c) 設定を内部呼び出しで開く(非表示/無効化されたカテゴリへの「直接遷移を試みても出ない」ことを
// 確かめるテスト専用。実クリックでは対象のnavボタン自体が非表示で押せない=利用者操作で再現不可)。
export async function openSettingsForTest(page, targetId) {
    await page.evaluate((id) => window.bookshelf._openSettingsModal(id), targetId);
}
