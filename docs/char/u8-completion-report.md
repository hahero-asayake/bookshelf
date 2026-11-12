# U8完了報告（U8a〜U8f・イシュー#537・#542・#543・#545・#546・#547）

計画 `tmp/499/recovered/499-step4-plan.md` §5「U8の完了時に、残りの画面の委譲の数を報告する」を行う。対象は U8a〜U8f（U7の`_art*`138メソッドは対象外＝既にU7自身の完了報告で329→約140件と報告済み）。

## 1. bookshelf.js の行数（前後差）

| 時点 | 行数 |
|---|---|
| U7完了直後（U8a開始前） | 15,213 |
| U8a完了後 | — |
| U8e完了後（U8f開始時） | 7,144（step1棚卸し時点の実測） |
| U8f完了後（現在） | **6,740** |

U8全体（U8a〜U8f）での減少：約 **8,473行**（15,213 → 6,740）。

## 2. U8a〜U8fで残した委譲（名前・呼び出し元・件数）＝U9の入力

「委譲」＝U8で`js/screens/`・`js/ui/`へ移したメソッドのうち、テスト（`bookshelf._xxx`の内部参照）・`plugin-api.js`・`dashboard.js`が旧来どおり内部名で呼び続けているもの。実測は `grep -rohn "bookshelf\._[A-Za-z0-9_]*" tests/e2e/ tests/visual/`（テスト側）と `grep -n "_app\.\|this\.app\." js/plugin-api.js js/dashboard.js`（プラグイン/ダッシュボード側）。

### U8a（#537・settings.js）

| 名前 | 呼び出し元 | 件数 |
|---|---|---|
| `_openSettingsModal` | テスト54・dashboard.js 1（`app._openSettingsModal('sync-method-select')`） | 55 |
| `_openPluginSettings` | テスト | 3 |
| `_renderUsageAlert` | テスト | 2 |
| `_usageAlertLevel` | テスト | 1 |
| `_confirmOpenSettings` | テスト | 1 |

小計：5種類・62件

### U8b（#542・book-detail.js）

| 名前 | 呼び出し元 | 件数 |
|---|---|---|
| `_bookMemoEditor` | テスト | 17 |
| `_openBookMemoInAppEditor` | テスト | 2 |
| `_lastDetailEditMode` | テスト | 1 |
| `_bookMemoEditorContext` | テスト | 1 |
| `showBookDetail`（非アンダースコア） | `plugin-api.js:389`（`_app.showBookDetail(b)`） | 1 |
| `_currentBookshelfInternalId` | `plugin-api.js:283-284`（`_app._currentBookshelfInternalId()`） | 1 |

小計：テストの内部参照4種類・21件。`showBookDetail`・`_currentBookshelfInternalId`の2件は**プラグイン契約の正式窓口**（U9計画の「残すのは、plugin-api.jsが依存している窓口だけ」に該当。委譲ではなく正式窓口として残す対象）。

### U8c（#543・import.js）

内部参照（`_xxx`）は0件。`showImportModal`（非アンダースコア・公開API）を`dashboard.js:431`が1件呼ぶ（取込ボタンのクリック経路）。これは「内部参照」ではないため委譲debtに数えない。

### U8d（#545・bookshelf-list.js）

テスト・`plugin-api.js`・`dashboard.js`いずれからも内部参照は0件。委譲なし。

### U8e（#546・js/ui/bookshelf-card.js）

| 名前 | 呼び出し元 | 件数 |
|---|---|---|
| `_bindBookshelfOverviewEvents` | `dashboard.js:1001-1002` | 2 |
| `_bookshelvesInTreeOrder` | `dashboard.js:980-981` | 2 |
| `_renderBookshelfCard` | `dashboard.js:990,996` | 2 |

小計：3種類・6件（いずれも`dashboard.js`の`BookshelfDashboard`から`this.app.xxx`経由。テストからの直接参照は無い）。

### U8f（#547・report.js・article-editor.js追加分）

`js/screens/report.js`（11メソッド）・`article-editor.js`に追加した`_reopenArt*`（10メソッド）のいずれも、テスト・`plugin-api.js`・`dashboard.js`からの内部参照（`_xxx`）は**0件**。report.jsの呼び出しはすべて`openReportModal`/`closeReportModal`等の非アンダースコア公開APIで、テスト（`report-moderation.spec.js`等）も`window.bookshelf.openReportModal(...)`経由。委譲なし。

### まとめ

| 区分 | 内部参照(`_xxx`)件数 | 正式窓口(plugin-api.js契約)件数 |
|---|---|---|
| U8a | 62 | 0 |
| U8b | 21 | 2（`showBookDetail`・`_currentBookshelfInternalId`） |
| U8c | 0 | 0 |
| U8d | 0 | 0 |
| U8e | 6 | 0 |
| U8f | 0 | 0 |
| **合計** | **89**（12種類） | **2** |

U9の入力：上記89件（12種類の名前）がU9で「テストの内部への参照を0にする」対象。`showBookDetail`・`_currentBookshelfInternalId`（book-detail.js）は`renderBookshelfOverview`（bookshelf.js・07_残検討事項に記載済み）と同様、プラグイン契約の正式窓口としてU9でも撤去せず残す。

**bookshelf._参照数（基準との比較）**：U8f完了時点で`grep -ron "bookshelf\._[A-Za-z]" tests/e2e/ tests/visual/ | wc -l` = **355**（基準355と変化なし）。U7の`_art*`系が約266件（355-89）を占め、これはU7完了時の報告（329→約140）とX3実施後の残り＋U8期間中の増減が無いことと整合する。U8a〜U8fの作業はいずれもPlan A（本文・呼び方無変更）のため、この355件はU8の作業そのものでは増減していない。

## 3. js/bookshelf.js に残った責務の一覧

現在6,740行の内訳（概算・VirtualBookshelfクラス本体は189〜6,625行の6,436行、クラス外の定数・ヘルパー関数187行、クラス内コンストラクタ100行、クラス内208メソッド6,335行、クラス外`LazyLoader`51行＋起動ブートストラップ57行）。

| 区分 | 件数 | 行数(目安) | 代表例 |
|---|---|---|---|
| 起動・初期化 | 9 | 883 | `init`・`setupEventListeners`・`createDefaultUserData`・`getDefaultSettings`・`migrateUserData`・`loadData`・`_checkAppVersion`・`_applyPwaUpdate`・`_onPwaUpdateReady` |
| 同期基盤（Storage/GitHub/Obsidian/ハブ/課金） | 19 | 715 | `initSync`・`initCloudSync`・`initGitHubSync`・`initObsidianSync`・`flushSync`・`_ensureFreshGitHubToken`・`_handleSyncConflict`・`_refreshHubUsage`・`_startCheckout`・`_adminSetPlan` |
| 共通UI基盤（Surface/履歴/モーダル/ペイン/パレット/MDEエディタ） | 50 | 1,463 | `_surface`・`_modalHistPop`・`_navReopen`・`_togglePane`・`_openDrawer`・`_openPalette`・`_setupCommandPalette`・`openIconPicker`・`_ensureEasyMDELoaded`・`_mdeToolbarConfig`等（本・記事・設定の複数画面から共用） |
| 蔵書・本棚データ操作（全画面共通の土台） | 74 | 1,972 | `applyFilters`・`updateDisplay`・`switchBookshelf`・`deleteBook`・`saveBookChanges`・`saveNote`・`generateStarRating`・`exportUnifiedData`・`reorderBooks` |
| 通報・公開実行（共通処理として残留、画面ではない） | 4 | 153 | `_runPublishExport`（article-editor.jsからも呼ぶ公開実行の共通処理）・`_collectPublishablePluginIds`（exporter.jsが依存するデータ取得口）・`exportUnifiedData`・`buildExportData` |
| その他ユーティリティ（一覧の一括選択・差分レンダリング・除外一覧・デバイス設定等） | 52 | 1,149 | `_setupSelectMode`系（一覧の一括選択）・`_renderListDiff`系（list-tail差分レンダリング、複数一覧画面が利用する共通エンジン）・`showExclusionsModal`系（除外一覧モーダル、未分割の小画面）・`_applyLoadedState`（読込データの反映） |
| プラグイン窓口（`_app`経由でplugin-api.jsが依存） | — | — | `applyFilters`・`saveUserData`・`switchBookshelf`・`updateDisplay`・`updateStats`・`renderBookshelfOverview`・`_isSyncReady`・`bookManager`/`bookshelfManager`/`dashboard`/`storage`/`userData`（プロパティ） |
| クラス外（`VirtualBookshelf`ではない） | — | 108 | `LazyLoader`クラス（画像の遅延読み込み・51行、VirtualBookshelfと無関係の独立ヘルパー）＋起動ブートストラップ（`DOMContentLoaded`・インスタンス化、57行） |

**観察（今回のコード変更は行わず記録のみ）**：モジュール先頭（1〜188行）の`ART_*`定数群（`ART_REMOTE_FLUSH_DEBOUNCE_MS`・`ART_PREVIEW_STALL_MS`・`ART_CANVAS_CHROME_CSS`等）は記事エディタ専用の値だが、U7で`_art*`メソッドを`article-editor.js`へ移した際にこの定数群は移されず、bookshelf.jsのモジュールスコープに残ったまま`<script>`タグの読み込み順（bookshelf.js→article-editor.js）で参照可能になっている。本文は無変更の方針のため今回は移していないが、**U9以降の検討候補**として記録する。

## 4. 計画見込み「約2,500行」との差と理由

- 見込み：約2,500行（計画 §4「U8：残りの画面をモジュールへ」の完了条件）
- 実測：6,740行
- **差：約4,240行（見込みの約2.7倍）**

### 理由

1. **見込みは「プラグイン窓口・委譲だけ」を想定していたが、実際は複数画面で共用する共通基盤がかなりの量を占めた**。U8d/U8eの実測（`_renderBookshelfCard`等）で判明したとおり、「本棚一覧」「ホーム」のような単一画面に閉じない共用ロジック（一覧描画エンジン`updateDisplay`系・本棚ナビゲーション中核`switchBookshelf`・一括選択`_setupSelectMode`系・list-tail差分レンダリング`_renderListDiff`系・MDEエディタ共通部`_mde*`・コマンドパレット・Surface/履歴基盤）は「どの画面にも属さない共通基盤」としてbookshelf.jsに残す判断を重ねた（U8d/U8e決定、03_詳細設計書に記載済み）。これらは合計で概算2,000行超（上表「共通UI基盤」1,463行＋「蔵書・本棚データ操作」1,972行の大半）を占め、見込みの「約2,500行」にはこの規模が十分に織り込まれていなかった。
2. **同期基盤（GitHub/Obsidian/ハブ/課金）が「起動・依存の受け渡し」よりも実装量が大きかった**。715行は見込みの「起動+依存の受け渡し+プラグイン窓口」という3カテゴリの想定に対し、同期基盤自体が独立した1カテゴリに近い規模を持っていた。
3. **U8f（本イシュー）で判明したとおり、「公開の一覧」は計画が想定した規模の対象がbookshelf.js側にほぼ残っていなかった**（実測0行、U7で既に移動済み）。一方で、U8aで「別の機能」として残されていた通報モーダル群（185行）のように、計画の当初の分類（設定・本の詳細・取込・本棚の一覧とツリー・ホームの概観・公開の一覧）に厳密には当てはまらない画面が複数見つかり、都度の判断（通報→U8fでreport.jsへ、ホームの概観→bookshelf.js残置）に時間とコードを使った。
4. **見込みの「約2,500行」自体が、計画段階（499-step4-plan.md策定時）での粗い見積りだった**。U7（記事エディタ、約3,500行見込み→実測で`_art*`138メソッド）は比較的近い見積りだったが、U8（残りの画面、約6,000行見込み）は複数の異種画面（設定・本の詳細・取込・本棚一覧・ホーム・公開・通報）を一括りにした見込みで、個々の画面の「共通基盤との境界」の精度は低かった。

### 結論

計画の「約2,500行」は「画面を全部出し切った後のbookshelf.jsの理想形」を指していたが、実際には「複数画面から呼ばれる共通基盤・データ操作の土台」の分だけ厚く残った。これは設計判断の誤りではなく、**U8d/U8eで確認したとおり「複数クラスから呼ばれる画面系の共用部品はjs/screens/ではなくjs/ui/に置く」という方針そのものが、「共用部品はbookshelf.jsから完全に追い出す」ことまでは意味しない**ため（js/ui/へ移したのは`_renderBookshelfCard`等の3件・130行のみで、`updateDisplay`・`switchBookshelf`・一括選択・list-tail等の大物はいずれも「複数画面共通の中核」と判定してbookshelf.jsに residing させた）。6,740行は「起動・依存の受け渡し・プラグイン窓口・委譲」に加えて「複数画面共通の中核ロジック」を含む実態を反映した行数であり、これをさらに削るには画面分割とは別の軸（共通ロジックのクラス化・サービス化）の設計判断がU9以降に必要になる。

## 5. U9への申し送り

- 上記§2の89件（12種類）がU9の「テストの内部への参照を0にする」対象。`showBookDetail`・`_currentBookshelfInternalId`（book-detail.js）は`renderBookshelfOverview`（bookshelf.js）と同様、plugin-api.jsの正式窓口として残す。
- `_reopenArt*`クラスタ（U7の移し残し）はU8fで無理なく`article-editor.js`へ移せた（危険な依存の絡み合いは見つからなかった）。U9開始時点で「U7の移し残し」は無い。
- モジュール先頭の`ART_*`定数群がbookshelf.jsに残っている件（§3観察）は、`article-editor.js`への定数移動（もしくは共有定数ファイル化）をU9以降で検討する候補として記録する。
- `renderBookshelfOverview`の削除可否は07_残検討事項.mdの起票候補を参照（判断材料：plugin-api.js:343のプラグイン契約）。
