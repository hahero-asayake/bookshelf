# U8a step1: 棚卸しと移し方の決定（イシュー#537）

対象: 設定画面（設定モーダルとその各タブ）を `js/bookshelf.js` から `js/screens/settings.js` へ移す。
計測は origin/main（adc26c2、U7完了済み・`js/screens/article-editor.js` が既にある版）で実施。`js/bookshelf.js` は **11603行**（移す前）。

## 1. 移す対象（確定・97メソッド、4グループ）

判定基準はU7と同じ：名前の接頭辞ではなく責務で決める。Plan A（§8）なので、呼び出し元がグローバルでも移しただけでは壊れない。「他画面から参照されているから残す」は理由にならない。中身が設定モーダル（画面の描画・ハンドラ）かどうかで判定する。

### A. 設定モーダルの骨格（10件）
`_isSettingsMobile`(6776) `_buildSettingsMaster`(6781) `_openSettingsModal`(6804) `_renderSettingsCategory`(6862) `_activateSettingsCategory`(6877) `_showSettingsMaster`(6908) `_bindSettingsPopstate`(6927) `_scrollSettingsTo`(6936) `_closeSettingsModal`(7797) `_confirmOpenSettings`(8798)

`_confirmOpenSettings`は8798行付近（本棚削除処理群の中）に浮いているが、呼び出し元は全部他画面（レポートモーダル4891・本棚削除8829/8840/8847/8851）で、中身は`confirmDialog`→`this._openSettingsModal(targetId)`のみ＝「他画面から設定モーダルを開くための窓口」。中身が設定モーダルを開く処理そのものなので、骨格側に含める（②判断）。

### B. ヘッダーカスタマイズ（設定内「ヘッダー」タブ、19件）
`_defaultHeaderLayout`(6963) `_newPlacementId`(6968) `_loadHeaderLayout`(6972) `_saveHeaderLayout`(6986) `_enumerateHeaderItems`(6995) `_getItemMeta`(7023) `_isPluginButtonHidden`(7037) `_setPluginButtonHidden`(7042) `_currentHeaderLayout`(7051) `_initHeaderTemplates`(7099) `_buildPlacementElement`(7115) `_applyHeaderLayout`(7178) `_bindSidebarUtilityDnD`(7207) `_reorderHeaderPlacement`(7786) `_loadHeaderIconOverrides`(6489) `_saveHeaderIconOverrides`(6496) `getHeaderIconOverride`(6506) `setHeaderIconOverride`(6515) `_getPluginIconOverride`(6532)

後の5件（6489〜6532）は行番号上は骨格より前（本棚ツリーのメソッド群の直後）にあるが、呼び出し元を実測（grep）するとすべて`_currentHeaderLayout`(7150)・`_openPluginSettings`(7563/7626/7629/7635)・`_getPluginIconOverride`自身からの呼び出しのみ＝ヘッダーカスタマイズ／プラグイン設定パネル専用。設定画面側に含める。

### C. プラグイン一覧・マーケット（設定内「プラグイン」タブ、16件）
`_loadPluginOrder`(7236) `_savePluginOrder`(7243) `_applyPluginOrder`(7247) `_renderPluginListSection`(7258) `_renderMarketSection`(7352) `_pluginCategoryMeta`(7427) `_renderPluginCategoryLegend`(7442) `_renderPluginCategoryBadges`(7457) `_loadPluginContribCache`(7471) `_setPluginContribCache`(7475) `_getPluginCategories`(7489) `_getPluginManifest`(7503) `_openPluginSettings`(7511) `_applyPluginSearchFilter`(7679) `_reorderPluginByIndex`(7696) `_bindPluginListEvents`(7710)

### D. 同期方式・GitHub・Hub・アカウント（設定内「同期」「アカウント」タブの画面側、52件）
`_setupSyncMethodUI`(3553) `_openBasepathBrowser`(3705) `_loadBasepathBrowser`(3714) `_renderGitHubAuthState`(3788) `_loadGitHubRepos`(3816) `_onGitHubRepoSelected`(3885) `_populatePublishRepoSelect`(3892) `_onPublishRepoSelected`(3922) `_onPublishTargetSelected`(3942) `_reflectPublishSwitchWarn`(3964) `_reflectPublishTargetPanels`(3971) `_reflectPublishHubStatus`(3985) `_reflectPublishRepoStatus`(3997) `_loadGitHubBranches`(4010) `_fetchAccessibleRepos`(4050) `_ghErrorDetail`(4081) `_connectToGitHub`(4090) `_cancelGitHubAuth`(4165) `_copyDeviceCode`(4172) `_disconnectGitHub`(4189) `_renderHubAuthState`(4210) `_renderHubDisconnected`(4249) `_renderHubUsageBar`(4277) `_reflectAffiliateField`(4303) `_reflectPublicNameField`(4327) `_formatBytes`(4340) `_setupHubUI`(4348) `_ensureHubSignInButton`(4361) `_setupAccountUI`(4385) `_ensureAccountSignInButton`(4445) `_renderAccountSection`(4469) `_renderAccountUsageBar`(4490) `_reflectAdminSection`(4541) `_renderAccountUsername`(4551) `_saveAccountUsername`(4570) `_renderPlanDetail`(4597) `_formatDate`(4622) `_reflectAccountChip`(4629) `_initUsageAlert`(4657) `_usageAlertLevelRank`(4671) `_renderUsageAlert`(4673) `_logoutAccount`(4702) `_deleteAccount`(4708) `_refreshHubUsage`(4737) `_startCheckout`(4758) `_openBillingPortal`(4782) `_pollPlusActivation`(4806) `_handleBillingReturn`(4826) `_collectGitHubRepoForm`(5089) `_saveGitHubRepo`(5109) `_disconnectHub`(5066) `_useHub`(5077)

`_formatBytes`/`_formatDate`は実測（grep）で呼び出し元がD内（Hub/アカウントの使用量・課金表示）だけ＝汎用フォーマッタではなく設定専用。`_handleBillingReturn`は`_setupAccountUI`(4385)内から呼ばれる（4418行）＝アカウントUI初期化の一部。

**合計 10+19+16+52 = 97メソッド**。

## 2. 移さない（bookshelf.jsに残す・理由つき）

| 区分 | 対象 | 理由（実測・②判断） |
|---|---|---|
| 同期エンジンのコア | `selectObsidianFolder`(5173) `initObsidianSync`(5146) `loadFromObsidianFile`(5219) `reloadFromObsidianFile`(5422) `_applyLoadedState`(5243) `buildExportData`(5439) `syncToObsidianFolder`(5474) `autoSaveUserDataFile`(5780) `updateSyncStatus`(5744) `_handleSyncConflict`(5675) `_showConflictDialog`(5692) `_syncLabel`(5732) `exportUnifiedData` | 起動時（3369行・コンストラクタ経由の初期化）にも、設定モーダルを一度も開かずに自動的に呼ばれる（自動再接続・自動保存）。「設定タブのハンドラ」ではなく「同期機能そのもの」＝②指示の「設定値のロジックは残す」の精神を同期ロジックにも適用。GitHub/Hub側は接続（認証・repo選択）とデータ同期実行が分離しているため画面側に含めたが、ローカルファイル同期だけは接続＝即データロードが一体化しており分離できない |
| 設定値の読み書きロジック | `getDefaultSettings`(3173) `_loadDeviceSettings`(3199) `_commonSettings`(3211) `_getStarVisibility`(11384) `_getStarOverlay`(11390) `_getMemoVisibility`(11396) `_setDisplaySetting`(11401) | ②指示どおり。`_getStarVisibility`等は本棚一覧・本の詳細の描画（2090/2400-2402/2910行）からも広く呼ばれる値のgetter/setterで、画面の描画ではない |
| 通報（レポート）モーダル | `openReportModal`(4888) `closeReportModal`(4909) `_setReportError`(4916) `_submitReport`(4923) `_loadReportReview`(4955) `_renderReportReview`(4970) `_reportReviewAct`(5008) `_adminSetPlan`(5036) `_handleReportParam`(4852) `_pendingReportSet/Get/Clear`(4873-4884) | 記事の問題を報告する別のモーダル機能で、設定画面の構成要素ではない。`_handleReportParam`は`_setupAccountUI`内から呼ばれる(4420行)が、開く先はレポートモーダル側 |
| 汎用共有部品（既存どおり残す） | `_placeAnchoredMenu`(10875) `_openMdEditor`/`_mde*`群11件 `openOrCreateBookMemo` `openIconPicker`(6541) | §7参照 |
| 全体初期化 | `setupEventListeners`(556) | 設定モーダル用のボタン(`obsidian-sync-btn`等)も含むが、sort-order・cover-size等、全画面のイベントバインドを1関数にまとめた巨大メソッド＝設定専用ではない。中の`this._setupSyncMethodUI()`等の呼び出し行はそのまま残る（Plan Aで無変更で動く） |

## 3. 設定画面が使う、VirtualBookshelf側の状態・メソッド（(b)の一覧）

移した後も`this.`経由でそのまま呼ぶ前提（§8のPlan A）。確認できた主なもの：

- bookshelf.jsに残る設定値ロジック7件（§2）
- `this.userData`（設定全体の保存先・settings.json）・`SyncConfigManager`（static import、同期方式設定の保存）
- `this.pluginLoader`（プラグイン一覧の読み込み元）・`this._isSyncReady`
- `this.storage`（`BookshelfStorage`）・`this.bookManager`／`this.bookshelfManager`（本棚選択プルダウン等）
- `this._surface()`（Surfaceのopen/close）・`confirmDialog`／`toast`（共有関数）
- プラグインとの橋: `window.bookshelfAPI`経由（globalのため、ファイルを移しても呼び方は変わらない）

## 4. 設定画面外から設定系の名前を読み書きしている箇所（(c)の一覧）

grep実測：

| 箇所 | 内容 |
|---|---|
| `js/ui/surface.js:130/145` | Surfaceコアが`h._bindSettingsPopstate()`を直接呼ぶ（27行目のコメントにも明記：`this.host`は`_navMobile`・`_bindSettingsPopstate`を持つVirtualBookshelf） |
| `js/plugin-api.js:461-462` | `window.bookshelf._getPluginIconOverride(entry.pluginId)` |
| `js/plugin-api.js:491-492` | `window.bookshelf._applyHeaderLayout()` |

**Plan A（§8）であれば、これらは一切変更不要**：上の名前がどのファイルで定義されていても、`VirtualBookshelf.prototype`上に乗る限り同じ関数を指す。

## 5. テストが直接触っている設定系の名前（(d)の一覧）

grep実測（§1の97件それぞれに対し`bookshelf.<name>`形式の直接参照を数えた）：

| 名前 | 箇所数 |
|---|---|
| `_openSettingsModal` | 54 |
| `_openPluginSettings` | 3 |
| `_renderUsageAlert` | 2 |
| `_confirmOpenSettings` | 1 |
| **合計** | **60箇所・4種** |

`_closeSettingsModal`は`bookshelf._closeSettingsModal`形式の直接参照は0件（テストは別のヘルパー経由でモーダルを閉じている）。

**tests/配下の`bookshelf._`参照の総数（基準値・全体、設定以外も含む）＝320件**（§8末尾の報告で増えていないことを確認する基準）。

## 6. プラグイン（plugin-api.js）が使っている名前（(e)の一覧）

**2件**：`_getPluginIconOverride`・`_applyHeaderLayout`（§4参照）。

## 7. 共有部品の js/ui/ 切り出し判断（brief指示）

- **`_placeAnchoredMenu`（10875行）**：呼び出し元を実測すると全て9000番台（記事エディタ＝`_artXxx`群・長文メモ共有クラスタ）のみ。設定画面（3553〜8798の範囲）からの呼び出しは0件。
- **Markdown編集の共通部品（`_openMdEditor`／`_mde*`群）**：呼び出し元も記事エディタ(10014/9301行)と長文メモ(12906行付近)のみ。設定画面からの呼び出しは0件。
- **`openIconPicker`（6541行）**：設定のプラグイン設定パネル(7624)から呼ばれるが、本棚フォーム(8379)・汎用アイコンピッカーモーダル(9452)からも呼ばれる＝設定専用ではない共有部品。テストが`bookshelf.openIconPicker`を直接呼んでいる（`tests/e2e/standard-ops.spec.js:588`）。

**判断（②判断）：このイシューでは js/ui/ へ出さない**。`_placeAnchoredMenu`・Markdown共通部品は設定画面から使われていない（範囲を広げない・推奨の既定どおり）。`openIconPicker`も設定専用ではないため、bookshelf.js側に残す（settings.jsには移さない）。いずれもU8bなど他画面の棚卸しが揃った段階で、必要なら別イシューでjs/ui/へ出す。

## 8. 移し方の決定：Plan A（U7と同じ）

`js/screens/settings.js`に、class構文のまま(`class _SettingsMethods { ... }`)97メソッドの定義を書き、ファイル末尾で

```js
const _settingsDescriptors = Object.getOwnPropertyDescriptors(_SettingsMethods.prototype);
delete _settingsDescriptors.constructor;
Object.defineProperties(VirtualBookshelf.prototype, _settingsDescriptors);
```

により`VirtualBookshelf.prototype`へ合成する（U7の§7と同一パターン）。見出し・本体は1文字も書き換えない。index.htmlの読み込み順は`<script defer src="js/bookshelf.js?v=...">`の直後に`<script defer src="js/screens/article-editor.js?v=...">`があるため、`settings.js`はその後に続けて追加する。

**「委譲」の数について（②承認済みの解釈）**：Plan Aでは委譲ラッパーを新規に書かない。brief/§5が想定する「委譲の数」は、この案では「テスト・プラグインが直接触れていて、移動後も同じ名前（`VirtualBookshelf.prototype`上）で動くことを確認した対象」の数とする＝**テスト4種（60箇所）＋プラグイン2種 = 6種**。

## 9. 基準値（origin/main adc26c2、本書作成時点で実測）

| 対象 | 結果 |
|---|---|
| `js/bookshelf.js` 行数（移す前） | 11603行 |
| tests/配下の`bookshelf._`参照の総数（全体） | 320件 |
| 設定系97メソッドのうちテストが直接触る名前 | 4種・60箇所（§5） |
| 設定系97メソッドのうちプラグインが直接触る名前 | 2種（§6） |

## 10. 次段への足場

この一覧（特に§3・§4）は、設定画面をクラス化し、VirtualBookshelfへの依存を注入の形に変える次の段（U9以降）のための足場として残す。今回（U8a）ではクラス化・注入はしない。
