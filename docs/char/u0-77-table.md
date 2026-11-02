# U0：77件の実測結果（U0a：W・A・B／U0b：S・L・N・I・E／U0c：A1・A7・E4）

テストの実体：`tests/e2e/char/widgets.spec.js`・`bookdetail.spec.js`・`article.spec.js`・`exits.spec.js`・`pc-back.spec.js`・`bp-820.spec.js`・`settings-shelves-nav.spec.js`・`states.spec.js`・`publish-hub.spec.js`（U0c追加）・`hub-conflict.spec.js`（U0c追加）。

## 集計

| 区分 | 件数 |
|---|---|
| 測れた | 70（U0a/U0bの61＋U0cで固定したA1×3・A7×3・E4×3の9） |
| 測れなかった（アプリの仕様上その幅では存在しない） | 2（B4の390・768） |
| 測れなかった（実機でしか起きない／外側からの入力経路が無い） | 5（E6の全5幅） |
| 計 | 77 |

**除外（上2区分の7件）を除いた70件は、全件測れた（70/70＝100%）。U0c（#506）でA1・A7・E4の9件を固定し、残課題は0件になった。**

## 測れた／測れない理由（全77行）

| ID | 幅 | 測れた/測れない | 実測内容・理由 |
|---|---|---|---|
| W3 | 1920 | **測れた** | `widgets.spec.js` W3。先頭を3番目へドラッグしても個数は変わらない。 |
| A1 | 390 | **測れた**(U0c#506) | `publish-hub.spec.js` A1。ハングの原因は、本棚ブロック追加後に引き出し(`#art-drawer`)が自動で開かない(A-cの振る舞いどおり)状態で`.art-drawer-item`を直接クリックしていたこと＝オフキャンバス(390幅では`boundingClientRect().y`がビューポート外)のまま`isVisible()`はtrue判定になり、actionability待ちが解消されず続いていた。390/768(900px以下)は`window.bookshelf._artOpenSheet()`で明示的に開いてから選ぶ。新規作成→タイトル入力→本棚ブロック→本3冊選択→公開パネルで送信→URLが出るまで通る。 |
| A1 | 768 | **測れた**(U0c#506) | 同上。390と同じボトムシート方式(900px以下)で`_artOpenSheet`/`_artCloseSheet`を使う。 |
| A1 | 1024 | **測れた**(U0c#506) | 同上。1024(900px超)は常駐の畳める引き出し(イシュー#168の仕様)で、開閉関数を呼ばずに直接選べる＝390/768とは別経路。 |
| A7 | 390 | **測れた**(U0c#506) | `publish-hub.spec.js` A7。A1と同じ経路で1件公開した後、一覧の「編集」ボタン(`[data-act="edit"]`)で開く→⋯メニューの「公開を取り消す」(`#art-unpublish`)→確認ダイアログでOK→一覧の状態(`.pp-status-on`→`.pp-status-off`)に反映される。別記事を作って同様に「削除」(`#art-del`)→一覧の件数が減ることを確認。 |
| A7 | 768 | **測れた**(U0c#506) | 同上。 |
| A7 | 1024 | **測れた**(U0c#506) | 同上。 |
| B2 | 390/768/1024/1440/1920 | **測れた**(5幅共通) | `bookdetail.spec.js` B2。本棚チップの×→`confirm()`承認→チップが1減る。 |
| B3 | 390/768/1024 | **測れた**(3幅共通) | `bookdetail.spec.js` B3。実測：長文メモの入口は`.memo-file-btn`(js/bookshelf.js:3297-3301)。`openOrCreateBookMemo()`は`_isSyncReady()`が必要なので他のcharスペックと同じ型でモックした。開く→Escで本の詳細に戻る。 |
| B4 | 390 | **測れなかった**(仕様上存在しない) | 390幅では本の詳細が全画面オーバーレイになり、背後の2冊目をクリックできない(実測で確認済み)。B4自体の定義(499-step1-inventory.md「PCの右ペイン」)にも整合する。 |
| B4 | 768 | **測れなかった**(仕様上存在しない) | 同上(768幅でも同じCSS境目で全画面化する)。 |
| B4 | 1024 | **測れた** | `bookdetail.spec.js` B4@char-1024。1024は右ペインのまま。2冊目クリックでペインが入れ替わる。 |
| S2 | 390/768/1024 | **測れた**(3幅共通) | `settings-shelves-nav.spec.js` S2。同期先セレクトが見える(選択肢をannotationに記録)。 |
| S3 | 1440/1920 | **測れた**(2幅共通) | S3。星評価の表示設定を変えると即座に`userData.settings.starVisibility`が変わる。 |
| S4 | 390/768/1024/1440/1920 | **測れた**(5幅共通) | S4。プラグイン無効化→設定のプラグイン節`<details open>`。 |
| S6 | 1440/1920 | **測れた**(2幅共通) | S6。本棚フォームに未保存入力→戻る。確認(.cfm-overlay)が出るかを実測して記録(#284 D13はfromHistory時のみ発火)。 |
| L1 | 390/768/1024/1440/1920 | **測れた**(5幅共通) | L1。複数選択モード→1冊選択→一括で既存本棚(テスト本棚)に追加→実際にbooks配列へ入る。 |
| L2 | 390/768/1024/1440/1920 | **測れた**(5幅共通) | L2。本棚管理モーダル(コマンドパレット「本棚を管理」経由)→新規作成→一覧に反映。 |
| L3 | 1440/1920 | **測れた**(2幅共通) | L3。ツリー項目メニュー(編集)で名前変更→`userData.bookshelves`に反映。 |
| L4 | 390/768/1024/1440/1920 | **測れた**(5幅共通) | L4。表示形式をリストに切替(`.rseg.on`)、並び順をタイトル順に変更。 |
| L6 | 390/768 | **測れた**(2幅共通) | L6。ドロワーからallを選択→ドロワーが閉じて本棚ビューに戻る(`#app-sidebar`のx座標で開閉判定)。 |
| N1 | 390/768 | **測れた**(2幅共通) | N1。検索(⌘K相当)→本を探して開く。 |
| N2 | 390/768/1024 | **測れた**(3幅共通) | N2。検索から「設定」コマンドを実行→設定モーダルが開く。 |
| N3 | 390/768/1024 | **測れた**(3幅共通) | N3。`#toggle-search`→`#search-popover`で絞り込み→解除。 |
| I4 | 390/768/1024 | **測れた**(3幅共通) | I4。`openReportModal()`はhub未ログインだとログイン案内に分岐する(実測)。hubログイン済み相当に注入して通報モーダルの開閉を確認。 |
| E2 | 390/768/1024 | **測れた**(3幅共通) | E2。"all"は本棚自身のbooks配列ではなくlibrary.booksをそのまま映す(実測)。library側も空にして空状態(`.bookshelf-empty`)を確認。 |
| E3 | 390/768/1024 | **測れた**(3幅共通) | E3。`context.setOffline(true)`で短文メモを保存してもトーストは出ない(専用の扱いが無い、step1 §4と整合)。 |
| E4 | 390/768/1024 | **測れた**(3幅共通・U0c#506) | `hub-conflict.spec.js` E4。`sync.method='hub'`で起動し、POST `/data/batch`が412(conflicts詳細なし)を返す経路(`_scheduleSync→_runPendingSync→syncToObsidianFolder→hub-adapter.commitBatch`)を通し、`HubConflictError`→`_handleSyncConflict('Asayake ハブ')`→`#sync-conflict-dialog`(O27)の3択(何もしない／JSONで書き出す／再読込)が出て選べることを確認。`tests/e2e/sync-conflict.spec.js`は`_handleSyncConflict()`の直接呼びだったが、ここでは実際のHTTP応答経路を通した。 |
| E5 | 390/768/1024 | **測れた**(3幅共通) | E5。使用率96%→`#usage-alert-banner`表示・upgrade導線あり。実装中に`page.addInitScript`のクロージャの罠を発見・修正した(下記参照)。 |
| E6 | 390/768/1024/1440/1920 | **測れなかった**(技術上の理由) | ウィジェットのrender例外は`js/dashboard.js`の`entry.render.call(...)`のtry/catch(282〜285行)でのみ発生する。確認した範囲のwidget(`counter-total`等)はrender内でネットワーク呼び出しやlocalStorage読み込み失敗で例外を投げる分岐を持たず、UI操作や`context.route`/`setOffline`のような外側からの入力では例外を誘発できない。 |

## 残課題（U0cで解消済み・2026-11-03 #506）

②の決裁により#501では持ち越していた9件(A1×3・A7×3・E4×3)は、イシュー#506で全件固定した。残課題は0件。詳細な原因と結果は`u0-findings.md`§4（更新版）を参照。

## 見つけた不具合（テストコードの、重要な教訓）

`states.spec.js`のE5で、`page.addInitScript(([u, l]) => {...100 * MB...})`のように**ブラウザ側で評価されるコールバックの中からNode側のローカル変数(`MB`)を参照すると、`ReferenceError`で例外になり、コールバックの残りの行(`localStorage.setItem('bookshelf_sync', ...)`)が実行されない**ことを実測で発見した。
- 症状：`virtualBookshelf_userData`・`library`はセットされる（例外より前の行）が、`bookshelf_sync`はセットされないまま(`null`)。アプリは`sync.method`が無い状態で起動し、hub関連の画面(usage-alert等)が正しく反映されない。
- 対処：`page.addInitScript(fn, arg)`の`arg`に、使う値をすべて含める(`[fixtureUserData, fixtureLibrary, 100 * MB, 96 * MB]`のように)。
