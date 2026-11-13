# U9 分類表（委譲の撤去・step1 棚卸し）

**(c)「テスト用ヘルパーに集約」についての前提（②決裁2026-11-13）**：この作業は内部参照そのものを無くすわけではなく、散らばった内部参照を1か所（テスト用ヘルパー）に集めることで、依存を無くさずに「内部の名前を変えたときに直す箇所を1か所に減らす」ことを狙っている。したがって`bookshelf._`/`app._`の生の参照数が0件になっても、ヘルパーの内部には内部参照が残る。その残りをさらに画面モジュールの公開窓口（(b)）へ移すかどうかは、U9の次の段階で判断する（本イシューの範囲では判断しない）。

## 0. 範囲と数え方

- 対象：`grep -ron "bookshelf\._[A-Za-z]" tests/e2e/ tests/visual/ | wc -l` = **355**（origin/main 61c1790、本worktreeで再実測して一致）。45ファイル・50種類の名前。
- 分類は**参照名単位**（50種類）で行う。同じ名前は呼び出し箇所が違っても分類・理由が機械的に同一になるため、355行すべてを1行ずつ書くより名前単位が実務的。各名前の全出現ファイル・行は `git grep -ron "bookshelf\._<name>\b" tests/e2e/ tests/visual/` で再現できる（生データを別ファイルにはしていない＝再現コマンドで十分、ファイル数を増やさない）。
- `bookshelf.__releaseRead`（二重アンダースコア、2件・publish-article-editor.spec.js内）は正規表現 `bookshelf\._[A-Za-z]`（2文字目が文字限定）に**一致しない**ため355に含まれない。これはテスト自身が `window.bookshelf.__releaseRead = () => ...` と後付けで生やした、テスト専用のフック（本体コードに定義が無い）。355の対象外だが、同種の越境として (c) の集約先に合わせて片付ける（群4に含める）。
- `_app._`経由（plugin-api.js内）は355に含まれない（plugin-api.jsはtests/e2e・tests/visual配下ではないため）。別名（`app._xxx`/`vb._xxx`）経由のテスト内参照を実測：`app\._` 14件、`vb\._` 0件、`window\.bookshelf\._` 357件（≒355の呼び出し形の大半を占める。入力ドアは`window.bookshelf._xxx`がほぼ全て）。14件の`app._`は別名経由の内部参照として存在するため、**step2のlintは`bookshelf._`に加えて`app._`も数える**（0件ではなかったため、②の確認指示どおり対象に含める）。

## 1. 分類表（名前・件数・ファイル数・分類・理由・出典）

凡例：分類 (a)利用者操作 (b)公開窓口 (c)テスト用ヘルパー集約 (d)プラグイン契約で残す。理由は1語。

| 名前 | 件数 | 分類 | 理由 | 出典・根拠 |
|---|---:|---|---|---|
| `_openSettingsModal` | 54 | (c) | 操作集約 | settings.js:923に実クリック導線はあるが、54件は設定モーダルを開く前提構築が主目的。1箇所のヘルパー（実クリックで開き、必要ならセクションへ移動）に集約する。settings.js:18のコメントは旧挙動保持の注記であり公開APIではない |
| `_artFlushSave` | 39→1(G3-1完了・イシュー#551) | (c) | 決定性 | ②指示：即時確定の保存呼び出しは(a)化禁止（#536の揺れ教訓）。article-editor.js:263で`art-save-retry`クリックから呼ばれる私的メソッド。tests/e2e/helpers/art-editor.js(既存ファイル拡張)の`flushArtSave`/`flushArtSaveAndRemote`へ集約 |
| `_artFlushRemoteNow` | 34→1(G3-1完了・イシュー#551) | (c) | 決定性 | 同上。article-editor.js:263,347。`flushArtRemoteNow`/`flushArtSaveAndRemote`へ集約（`flushArtSaveAndRemote`は元の`.then()`連結を1回のevaluateのまま保持＝2回の呼び出しに分けてタイミングを変えない） |
| `_artDraft` | 32 | (c) | 状態検査 | article-editor.js:291ほか、下書き状態を直接読むためのフィールド。公開getterが無い（pubdef探索でヒット無し） |
| `_artTextFsEditor` | 29 | (c) | 状態検査 | article-editor.js:1157,1164。全画面MDEエディタのインスタンス参照。テストは開閉状態の確認に使っている |
| `_isSyncReady` | 26 | (d)/一部(c) | 契約 | plugin-api.js:769で`this._app._isSyncReady`を呼ぶ正式窓口（d）。ただしテスト26件はいずれも「同期準備済みを待つ足場」としての**内部状態の読み取り**であり、プラグイン契約としての呼び出しではない（plugin-api.js側の呼び出しは355に含まれない別物）。テスト側はヘルパー（c）`waitForSyncReady(page)`に集約し、メソッド名自体は(d)としてplugin-api.jsのために変更しない |
| `_bookMemoEditor` | 17→6(G2完了・イシュー#550) | (c) | 状態検査 | book-detail.js:571。短文メモのインラインエディタ参照。17件の散在した呼び出しをtests/e2e/helpers/book-memo.js(新設)の6関数(setBookMemoValue/getBookMemoValue/hasBookMemoEditor/waitForBookMemoEditor/getBookMemoBoldToolbarHtml)へ集約し、呼び出し元5ファイルは0件に |
| `_artEditingId` | 14→1(G3-1完了・イシュー#551) | (c) | 状態検査 | bookshelf.js:4804,5561。現在編集中の記事ID。DOM等価が無い（`data-article-id`等は存在しない）ためtests/e2e/helpers/art-editor.jsの`getArtEditingId`へ集約 |
| `_artOpenSheet` | 13 | (a) | 操作再現 | article-editor.js:301で実際のUI操作（本の追加等）から呼ばれる。クリック相当の操作に置換可能 |
| `_artCloseSheet` | 10 | (a) | 操作再現 | article-editor.js:225-226に実クリック（`art-sheet-scrim`/`art-sheet-close`）が既にある |
| `_openDrawer` | 7 | (a) | 操作再現 | bookshelf.js:4033にトグルクリック、5756にハンバーガー相当の導線あり |
| `_artPreview` | 6 | (a) | 操作再現 | article-editor.js:265,280に`art-preview`/`art-width-preview`クリックの実導線あり |
| `_handleSyncConflict` | 5 | (c) | 決定性 | bookshelf.js:3673。catch節からのエラー注入経路で、クリックで再現できない。sync-conflict.spec.jsはエラー注入用ヘルパーへ |
| `_artPreviewStallMs` | 5 | (c) | 契約済み | bookshelf.js:70のコメントで「テストから注入できるよう」と明記済みの意図的なテスト注入点。集約先の定数に正式化する |
| `_setBodyView` | 4 | (c) | 決定性（要確認） | bookshelf.js:3875。クリック等価の導線が未確認。step3着手前に再確認 |
| `_scheduleSync` | 4 | (c) | 決定性 | bookshelf.js:2838。デバウンスを待たず即時同期させるためのテスト用呼び出し |
| `_openPluginSettings` | 3 | (a)/(c) | 操作再現（要確認） | settings.js:2175。プラグイン行クリックの導線有無をstep3で確認 |
| `_conflictNotified` | 3 | (c) | 状態検査 | bookshelf.js:3674-3675。通知済みフラグの直接読み取り |
| `_checkAppVersion` | 3 | (c) | モック | app-version-check.spec.js:46-47で**メソッド自体を上書き**してfetch結果をモックしている。クリックでは代替不可、テスト用フック集約が必須 |
| `_artRenderList` | 3 | (c) | 決定性 | article-editor.js:413。背後の状態変更後に即時再描画させる呼び出し |
| `_artPublishCalled` | 3 | (c) | スパイ | js/本体に定義無し（grep該当無し）。テスト側が貼り付けた計測用フラグそのもの |
| `_runPendingSync` | 2 | (c) | 決定性 | bookshelf.js:388 |
| `_renderUsageAlert` | 2 | (c) | 決定性 | settings.js:1159。使用量アラートの即時再描画 |
| `_pwaUpdateReg` | 2 | (c) | 状態検査 | bookshelf.js:4675,4681 |
| `_openPalette` | 2 | (a) | 操作再現 | bookshelf.js:1233。⌘K相当のキー入力で代替 |
| `_openBookMemoInAppEditor` | 4→1(G2完了・イシュー#550) | (a)※→(c) | 操作再現→自己完結(訂正) | book-detail.js:553。元の分類(a)は実装時に(c)へ変更した(G1の`_confirmOpenSettings`と同種)：実クリック経路(`.memo-file-btn`)は本の詳細ペインが開いている時だけ存在し、`showBookDetail()`はnav履歴に段を積む副作用を持つ。呼び出し元4件中3ファイル(back-nav-matrix/checklist-timing/standard-ops)は戻る/進むの履歴段数を検証するテストで、本の詳細を開く前段を追加すると前提が壊れる。既存スイートに実クリック経路の前例も無いため、tests/e2e/helpers/book-memo.jsのopenBookMemoInAppEditorへ集約した(ヘルパー内に1件残存) |
| `_navigateFromUi` | 2 | (a) | 操作再現 | bookshelf.js:4830。UI操作のディスパッチャ、実クリック/キー操作に置換 |
| `_listTail` | 2 | (c) | 状態検査 | bookshelf.js:2256,2258。list-tail差分レンダリングの内部状態 |
| `_artUnpublish` | 2 | (a) | 操作再現 | article-editor.js:315に`art-unpublish`クリック導線あり |
| `_artPublish` | 2 | (a) | 操作再現 | 公開ボタン（`art-bar-publish`等）クリック経路から到達 |
| `_artOpenPublishPanel` | 2 | (a) | 操作再現 | article-editor.js:229,276に`art-publish-header`/`art-bar-publish`クリック導線あり |
| `_artEditBlock` | 2 | (a) | 操作再現 | article-editor.js:1105。ブロック編集アイコンのクリック相当 |
| `_artDelete` | 2 | (a) | 操作再現 | article-editor.js:316に`art-del`クリック導線あり |
| `_applyPwaUpdate` | 2 | (c) | 決定性 | bookshelf.js:4680。PWA更新通知の即時適用 |
| `_usageAlertLevel` | 1 | (c) | 状態検査 | settings.js:1146,1168 |
| `_updateCoverSizeOptionLabels` | 1 | (c) | 決定性 | bookshelf.js:1929 |
| `_showConflictDialog` | 1 | (c) | 決定性 | bookshelf.js:3690。自動表示のダイアログでクリック導線なし |
| `_runPublishExport` | 1 | (c) | 決定性（要確認） | article-editor.js:60,3085。公開フロー内部からの呼び出し、ネットワーク経路のテスト注入点かをstep3で確認 |
| `_orderedBooksToRender` | 1 | (c) | 状態検査 | bookshelf.js:2032 |
| `_onPwaUpdateReady` | 1 | (c) | 決定性 | bookshelf.js:4674 |
| `_modalHistPush` | 1 | (c) | 状態設定 | bookshelf.js:5813。戻る行列テストの前提状態構築 |
| `_lastDetailEditMode` | 1→0(G2完了・イシュー#550) | (a) | DOM代替 | book-detail.js:127。②指示(2026-11-13)により、back-nav-matrix.spec.js:1521の内部状態読み取りを`!!document.querySelector('.bd.editing')`(book-detail.js:318、isEditModeと1:1で付くクラス)へ置換。テストの意図(戻った後に編集モードが復元すること)はDOMで確認できるため(a)化した |
| `_confirmOpenSettings` | 1 | (c)※ | 対照保持 | report.js:72等に実クリック導線はあるが、overlay-front.spec.jsの対照テストは「確認→設定を開く経路そのもの」の重なり順を検証するのが目的。実際の呼び手(通報/公開フロー)経由にすると無関係な未ログイン状態等が増えて検証対象が変わるため、step3実装時に(a)から(c)へ変更した(settings.js helperのconfirmOpenSettingsForTestに集約) |
| `_bookMemoEditorContext` | 1(G2完了・イシュー#550、件数不変) | (c) | 状態検査 | book-detail.js:585。tests/e2e/helpers/book-memo.jsのgetBookMemoEditorContextへ集約(元から1件・集約先も1件) |
| `_artShowList` | 1 | (a) | 操作再現 | article-editor.js:316の削除後遷移と同じ、戻る操作で到達可能 |
| `_artRenderPublishPanel` | 1 | (c) | 決定性 | article-editor.js:3177 |
| `_artPreviewHardDeadlineMs` | 1 | (c) | 契約済み | bookshelf.js:78のコメントで明記済みのテスト注入点 |
| `_artOpenEditor` | 1 | (c) | 操作簡略（要確認） | article-editor.js:1257。一覧からのクリックで同じ状態に到達できるか未確認 |
| `_applyRatingEverywhere` | 1 | (a) | 操作再現 | bookshelf.js:6579。星クリックで到達する経路 |
| `__releaseRead`（355外・2件） | - | (c) | 越境 | publish-article-editor.spec.js内でテストが後付けしたフック。集約先ヘルパーに同居させて片付ける |

**内訳**：(a) 利用者操作＝21種類・約86件／(c) テスト用ヘルパー集約＝25種類・約232件／(d) プラグイン契約＝1種類・26件中の「契約呼び出し分」（plugin-api.js側は355外、テスト側26件は(c)扱い）。
**(b) 公開窓口（既存の非アンダースコア名を呼ぶ形）に該当する例は0件**。理由：U8f（report.js）で`openReportModal`等の公開APIへの移行は既に完了済み（U8完了報告で確認＝参照0件）。355件の残りは「元から公開窓口が無い、プラグイン契約でもない、テスト専用の裏口」が中心だったため、(b)への置換候補は見つからなかった。新設が必要な(b)窓口は今回のinventoryでは無し（置換後に(a)(c)いずれでも対応可能だった）。

## 2. U8完了報告（§2・89件12種類）との対応

U8の89件は「テスト参照83件（U8a 62件＋U8b 21件）＋dashboard.js内部参照6件（U8e、tests配下ではないため355に含まれない）」の合計であり、355とは**測定範囲が異なる**（355はtests/e2e・tests/visualのみ、89はテスト+dashboard.js）。355のうちU8a/U8bの名前と重なるのは下記82件のみで、残り273件（art*系203件＋核心/雑多系約70件）はU7完了〜X3実施後に残っていたものがU9まで変化せずに残った分（u8-completion-report.md:83で報告済み）。

| U8区分 | 対応する名前（355内） | 355内の件数 |
|---|---|---:|
| U8a（settings.js） | `_openSettingsModal`,`_openPluginSettings`,`_renderUsageAlert`,`_usageAlertLevel`,`_confirmOpenSettings` | 61 |
| U8b（book-detail.js） | `_bookMemoEditor`,`_openBookMemoInAppEditor`,`_lastDetailEditMode`,`_bookMemoEditorContext` | 23※ |
| U8e（bookshelf-card.js） | dashboard.js経由のみ（`_bindBookshelfOverviewEvents`等3種6件）、テスト参照0件 | 0（355に現れない） |
| U7/X3残（article-editor.js） | `_art*`系21種類 | 203 |
| 対象外（plugin-api.js契約・355外） | `showBookDetail`,`_currentBookshelfInternalId` | 0 |
| 上記以外の核心/雑多（bookshelf.js本体） | `_isSyncReady`ほか18種類 | 70 |

※ 当初21と記載していたが、`app._`経由2件(`_openBookMemoInAppEditor`、mde-toolbar-icons.spec.js:46/231)を数え落としていた。本表は元々`grep -ron "bookshelf\._<name>\b"`で数えており、`app._`パターンは対象外だった。lintの実数(`bookshelf._`+`app._`合算、§0参照)に合わせ23に訂正（イシュー#550 step1・②指示2026-11-13）。

## 3. ファイル群・分割案（1イシュー500行目安）

名前単位で自然に分かれる4群に分ける。見込み差分行数は「置換後1件あたり概ね1〜3行の変化（呼び出し行の書き換え＋ヘルパー定義側の増分）」を元にした粗い見積り。

| 群 | 名前（件数） | 対象ファイル数 | 件数合計 | 見込み差分行数 | 主な分類 |
|---|---|---:|---:|---:|---|
| G1 settings | `_openSettingsModal`ほか5種 | 20 | 61 | 約150〜200行（1ファイルあたり1〜2箇所の置換が主） | (c)主・一部(a) |
| G2 book-detail | `_bookMemoEditor`ほか4種 | 5 | 23 | 約60〜90行 | (c)主・一部(a) |
| G3 article-editor（art*） | `_artFlushSave`ほか21種 | 約15（publish-article-editor.spec.js中心） | 209（lint実測・イシュー#551 step1。当初203はapp._経由7件の数え落とし） | 約500〜700行（500行目安を超える見込み） | (c)多数・(a)一部 |
| G4 核心/雑多（bookshelf.js本体） | `_isSyncReady`ほか18種＋`__releaseRead` | 約10 | 70+2 | 約150〜200行 | (c)主・(a)一部 |

**G3は500行目安を超える見込みのため、さらに分割した**（イシュー#551 step1実測）。当初提案（G3-1=保存/下書き系5名148件、G3-2=シート/プレビュー/公開操作系55件）は名前単位の粗い見積りで、実測すると`_artDraft`(オブジェクトの多様なフィールド読み書き)が複雑度・見積り誤差とも大きく、5名まとめては500行への安全マージンが乏しいと判断。実際には3群に分割した：
- **G3-1（完了・イシュー#551）**：`_artFlushSave`(39)/`_artFlushRemoteNow`(34)/`_artEditingId`(14)＝87件。全て(c)（保存確定系は決定性のため(a)化しない#536の教訓、`_artEditingId`はDOM等価なし）。実測差分は呼び出し形がほぼ均一だったため少なく済んだ（詳細はdocs/char/u9-g3-plan.md）。lint 298→216。
- **G3-2（次イシュー）**：`_artDraft`(36)/`_artTextFsEditor`(29)＝65件。`_artDraft`はオブジェクトの多様なフィールド読み書き(`.blocks`配列操作・`.theme`・`.adTag`・`.sourceShelfId`等、直接代入によるテスト用セットアップも含む)で複数の専用ヘルパーが必要になる見込み。
- **G3-3（さらに次）**：シート/プレビュー/公開操作系`_artOpenSheet`以下16名＝約57件（当初G3-2提案と同じ対象、実測57で当初55と近似差）。

G3-1+G3-2+G3-3＝87+65+57=209（lint実測の`_art*`合計と一致）。G1・G2・G4はそれぞれ500行以内に収まる見込みなので1イシュー1群で良い。

## 4. 本イシューで置き換える最初の1群の推奨

**G1（settings、61件・20ファイル）を推奨**。
- 理由：(a)/(c)で完結し(d)判断が絡まない、1ファイルあたりの変更が小さく、見込み差分が500行以内で収まる、②指示の「決定性を崩さない」対象（_artFlushSave等）を含まない。
- 置き換え方針：`_openSettingsModal(section)`は実クリック（設定を開くボタン）＋`section`指定時はタブ/セクションへの実ナビゲーションを行うヘルパー1つ（`tests/e2e/helpers/settings.js`新設）に集約し、20ファイルの呼び出しをヘルパー呼び出しに置換する。`_openPluginSettings`/`_renderUsageAlert`/`_usageAlertLevel`/`_confirmOpenSettings`は同ヘルパーファイル内の別関数として集約する。
- step2のlint上限はG1置換後、61件減の見込みで355→294付近まで下げる（step3で実測して確定）。

## 5. 未確認（要確認フラグが付いた項目・step3着手前に再確認）

- `_setBodyView`・`_openPluginSettings`・`_runPublishExport`・`_artOpenEditor`：クリック等価の導線が未確認（上表に個別記載）。
- `app._`経由の別名参照14件の具体的な中身（どの名前か）は未調査（lintの対象に含める決定はしたが、重複カウント防止の実装詳細はstep2で検討）。

## 6. 完了記録

- **G1（settings、イシュー#548・c886ec7）完了**：61件→299(bookshelf._)+14(app._)=313に減算（詳細はlint冒頭コメント参照）。
- **G2（book-detail、イシュー#550）完了**：23件（§2訂正後の実測値・当初の21は`app._`経由2件の数え落とし）を置き換えた。
  - (a)化：1件（`_lastDetailEditMode`）。back-nav-matrix.spec.js:1521の内部状態読み取りを`!!document.querySelector('.bd.editing')`（book-detail.js:318）へ置換。②指示（2026-11-13）に従い、DOM上で確認できる項目を優先した。
  - (c)集約：22件（`_bookMemoEditor`17・`_openBookMemoInAppEditor`4・`_bookMemoEditorContext`1）。新設`tests/e2e/helpers/book-memo.js`の7関数へ集約し、呼び出し元5ファイル（back-nav-matrix/checklist-timing/mde-toolbar-icons/publish-article-editor/standard-ops）は0件、ヘルパー内に8件残存（22→8、純減14件）。
  - 元の分類表§1で`_openBookMemoInAppEditor`を(a)としていたが、実装時に(c)へ訂正した：実クリック経路(`.memo-file-btn`)は本の詳細ペインが開いている時だけ存在し、`showBookDetail()`の履歴副作用が、戻る/進むの段数を検証する3ファイルのテスト前提を壊すため（G1の`_confirmOpenSettings`と同種の判断）。
  - 件数：313→298(bookshelf._ 286+app._ 12、純減15件＝1(a)+14(c))。lintのMAXも313→298に変更。
