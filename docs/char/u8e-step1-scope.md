# U8e step1: 棚卸しと置き場所の決定（イシュー#546）

対象: ①ホームの概観（ダッシュボードを開く処理・ホームの表示切替のうち `js/bookshelf.js`(VirtualBookshelf) 側にある画面部分）を `js/screens/` へ移す。②本棚カードなど共用部品（`_renderBookshelfCard`・`_bindBookshelfOverviewEvents`・`_bookshelvesInTreeOrder`）の置き場所を決める。

計測は worktree `issue-546`（**origin/main 5123696 へ ff 済み**＝#545(U8d)完了後）。`js/bookshelf.js` は**7144行**（移す前・現在値）。移し方はU7(#525)〜U8d(#545)と同じ**Plan A**（匿名class の prototype 記述子を `VirtualBookshelf.prototype` へ合成・本文無変更）。

## 0. 移動前スナップショット（機械的検証の基準値）

`python3 -I -m http.server 8146`で配信→Playwright(MCP)で`index.html`を開き、`window.bookshelf.constructor`の`Object.getOwnPropertyNames`を静的側・prototype側それぞれ取得（組み込みの`length`/`name`/`prototype`(static側)と`constructor`(prototype側)は除外）。結果は `docs/char/u8e-baseline-members.json` に保存済み。

- static側：**9件**（U8d完了後と完全一致）。
- prototype側：**525件**（U8d完了後の値。移動候補の全メンバーが含まれていることを確認済み）。
- 起動時のconsoleエラー：**1件**（`ERR_CONNECTION_REFUSED @ pagead2.googlesyndication.com`＝サンドボックス環境のネットワーク遮断による既定ノイズで、本変更と無関係）。pageerrorは0件。
- テストの`bookshelf._`参照数：`grep -ron "bookshelf\._[A-Za-z]" tests/e2e/ tests/visual/ | wc -l` = **355件**（完了条件の基準値と一致）。
- step2で移動した後、同じ手順で static=9・proto=525（名前集合も完全一致）・console既定ノイズ1件（pagead2除く0件）・`bookshelf._`参照355件以下のままであることを確認する。

## 1. ホームの概観：移す対象の棚卸し（実測の結果、独立メソッドは1件のみ）

依頼が例示する3項目（ダッシュボードを開く処理／ホームの表示切替／本棚概観の描画）を実測した結果：

| 項目 | 実測箇所 | 独立メソッドか | 判定 |
|---|---|---|---|
| ダッシュボード生成(`new BookshelfDashboard`)・`dashboard.render()`呼び出し | `init()`内 369-371行、`_updateSortDirectionButton`系ハンドラ内1821-1822行、`updateBookshelfSelector()`内4019-4020行、`_applyRoute()`内4972行 | **否**＝いずれも大きなメソッド（起動処理・ソート変更ハンドラ・本棚セレクタ更新・ルーティング）の中に埋め込まれた1〜3行の呼び出しで、単独の「ホーム画面」メソッドではない | 移さない（ホスト側メソッド自体がHome専用ではなく、Plan Aの「メソッド単位で移す」単位に切り出せない） |
| ホームの表示切替（body class `app-view-{main\|bookshelf}`） | `_setBodyView(view)`（4061-4087行） | 独立メソッドだが**Home専用ではない**＝`main`(ホーム)と`bookshelf`(本棚ビュー)の両方を切り替える共通の画面遷移基盤。呼び出し元も`switchBookshelf`・ナビボタン・ルーティング等、画面全体から横断的に呼ばれる（grep実測：7箇所） | 移さない（Home固有ではなく画面遷移の中核インフラ。U8の各画面分割後も残る共通基盤という位置づけ） |
| ホームへ戻るナビボタン・ブランドロゴのクリック配線 | `_initPaneControls()`内 4127-4148行 | **否**＝ペイン折りたたみ・キーバインド・ホームボタン・ブランドロゴを1つの初期化メソッドでまとめて配線している。ホームボタン部分だけを抜くとホスト側メソッドが分裂する | 移さない（U8の判定基準「責務で見る」に従うと`_initPaneControls`はナビ初期化全体が責務で、Home固有の処理ではない） |
| 本棚概観の描画（旧ホーム画面の名残） | `renderBookshelfOverview()`（6810-6823行・**14行**） | **独立メソッド**。ただし本文冒頭のコメントのとおり「ホーム=ダッシュボードに置換されたため、旧`#bookshelves-grid`は使わない…互換のため呼出は受け付けるが何もしない」＝**実質no-op**（`#bookshelves-grid`がDOMに存在せず`if (!grid) return`で即終了） | 移動候補だが**14行**で②指示の目安（100行未満）を大きく下回る |

**結論**：「ホームの概観」として`js/screens/`へ独立に切り出せる実体は`renderBookshelfOverview`(14行・no-op経路)のみ。他の3項目は、いずれもHome専用ではない共通基盤（表示切替）か、より大きな非Home専用メソッドに埋め込まれた数行（ダッシュボード生成呼び出し・ナビボタン配線）であり、Plan Aの「メソッド単位移動」では切り出せない。

### 代替案（②提示・採用を推奨）

②の事前指示どおり、移せる量が100行未満（実測14行）のため、以下の代替案を提案する：

> U8eは**共用部品（§2）の置き場所の決定と移動だけ**を行い、「ホームの概観」の実体移動（`renderBookshelfOverview`14行）は次の**U8f（公開の一覧）**で、公開一覧用の新規`js/screens/`ファイルを作る際に**まとめて同じ便に乗せる**。

**この案を推奨する理由**：
- 14行・no-opの関数のためだけに新規`js/screens/home.js`を作ると、既存の`js/screens/*.js`（最小480行=bookshelf-list.js）に対して極端に小さい「ほぼ空のファイル」になり、不釣り合い。
- 一方`js/ui/*.js`には21行(escape.js)・33行(undo-toast.js)の前例があるが、`renderBookshelfOverview`は「画面(screen)」であって「部品(ui)」ではないため、その前例には当たらない。
- U8fで公開一覧の画面ファイルを新規作成する際、`renderBookshelfOverview`を一緒に移せば、新規ファイル作成・index.html配線・`?v=`更新・スナップショット検証のコスト（＝今回とほぼ同じ作業）を1回に集約できる。
- `renderBookshelfOverview`はno-op経路で振る舞いに影響しないため、移動を1イシュー先送りしても機能面のリスクは無い。

**比較のため、今すぐ移す案との差**：今すぐ`js/screens/home.js`を作って14行を移す場合でも、Plan A・スナップショット比較の手順自体はこのイシューの他の検証（§2の共用部品move）で既に走らせるため追加コストは小さい。ただし「ほぼ空のファイル」を作ることと、1イシューに2つの画面ファイル新設（home.js + 共用部品のjs/ui/ファイル）が混在する点は避けたい。②の判断を仰ぐ（tp）。

## 2. 共用部品（`_renderBookshelfCard`・`_bindBookshelfOverviewEvents`・`_bookshelvesInTreeOrder`）の置き場所：3案比較

### 対象範囲の確定

| 名前 | 行範囲（JSDoc含む） | 行数 | 呼び出し元（bookshelf.js側） | 呼び出し元（dashboard.js側） |
|---|---|---|---|---|
| `_bookshelvesInTreeOrder` | 4359-4387 | 29 | なし（U8dで4件のツリーメソッドが`js/screens/bookshelf-list.js`へ移動済みのため、現在bookshelf.js内から呼ぶ箇所は無し） | 980-981行（`app._bookshelvesInTreeOrder()`） |
| `_bindBookshelfOverviewEvents` | 6825-6853 | 29 | 6822行（`renderBookshelfOverview`内・§1のno-op経路） | 1001-1002行（`app._bindBookshelfOverviewEvents(gridHost)`） |
| `_renderBookshelfCard` | 6855-6926 | 72 | 6821行（`renderBookshelfOverview`内・§1のno-op経路） | 990行(`synthAll`合成カード)・996行(`ordered`ループ) |

合計**130行**（3メソッド）。実際に生きている呼び出し元は**dashboard.js側の4箇所のみ**（bookshelf.js側は到達しないno-op経路＝§1で確認済み）。

下請けの`_bookshelfDescription`(4725-4727・3行)は`_renderBookshelfCard`(6863行)と`_updateBookshelfViewTitle`(4747行・本棚ビューのヘッダー=残留確定済み、U8d §2表)の**両方**から呼ばれる。JSDoc自身が「ホームカード / 本棚ヘッダー 共通」と明記。3行の極小ヘルパーで、どちらに寄せても呼び出し側は無変更（Plan A）のため、**移動の実益が無く、bookshelf.jsに残す**（後述の3案比較は`_bookshelfDescription`を含めず、3メソッドのみを対象とする）。

### 比較

| 軸 | (a) bookshelf.jsに残す | (b) js/ui/へ部品として出す | (c) dashboard.js側へ寄せる |
|---|---|---|---|
| 内容 | 現状維持 | Plan Aのまま、新規`js/ui/bookshelf-card.js`（匿名classの prototype記述子を`VirtualBookshelf.prototype`へ合成＝他の`js/screens/*.js`と同じ機構。BookListのような独立クラス化はしない＝②確認済み） | 3メソッドの本文を`BookshelfDashboard`のメソッドとして書く |
| 依存の向き（dashboard→app依存が減るか） | 変わらない（dashboard.jsは引き続き`app._bookshelvesInTreeOrder()`等を呼ぶ） | **変わらない**。呼び方(`this.xxx`/`app.xxx`)を変えないことが条件のため、dashboard.js→appの呼び出し自体は残る。ただし定義元が「bookshelf.jsの内部」から「共用部品ファイル」へ変わることで、**依存の所在が明示化**される（U9で呼び方を変える時に、変更対象が独立ファイルとして見えている方が作業しやすい） | **実測の結果、不成立**。`_renderBookshelfCard`本文は`this.userData`・`this.bookManager`・`this.books`・`this._getLibrarySortedAsins`・`this._bookshelfDescription`を参照する。`BookshelfDashboard`のインスタンスはこれらを直接持たず`this.app`経由（`this.app.userData`等）でしか参照できない。本文無変更の条件を満たせない。さらにbookshelf.js側の呼び出し元`renderBookshelfOverview`も`this._renderBookshelfCard(...)`を`this.dashboard._renderBookshelfCard(...)`に書き換える必要が生じ、「呼び方不変」にも反する |
| 変更量 | 0（移動なし） | 中：新規ファイル1つ・130行移動・index.html script追加・`?v=`更新・スナップショット再検証（U7〜U8dと同型の作業） | — （不成立のため評価対象外） |
| リグレのリスク | 最小 | 低（U7〜U8dで5回実証済みのPlan Aの機械的移動。呼び方不変のため動作変化なし） | — |
| U9（委譲の撤去）とのつながり | U9は「テストの内部参照(`bookshelf._xxx`)の撤去」が主眼。この3メソッドはテストから直接呼ばれていない（§4）ため、U9の委譲数には影響しない。ただし bookshelf.js に埋もれたままでは、dashboard.js→appの依存を解消する作業（呼び方を変える＝おそらくU9かその前後）の着手点が見えにくい | U9で「`app._renderBookshelfCard`→共用部品を直接import/呼び出し」のように呼び方を変える際、**移動先が明確な独立ファイルである方が変更対象を特定しやすい**。本イシューでは呼び方を変えないため依存は残るが、次の作業への地ならしになる | — |
| 判定 | 不採用（現状維持は可能だが、bookshelf.jsを約2,500行＝起動・委譲・窓口だけにするU8全体の完了条件に反する方向） | **推奨** | **不成立**（本文無変更の条件と両立しないことを確認済み。②指示により深追いしない） |

### 推奨：(b) `js/ui/bookshelf-card.js` へ切り出す

- 3メソッド（`_bookshelvesInTreeOrder`・`_bindBookshelfOverviewEvents`・`_renderBookshelfCard`）をPlan Aで`js/ui/bookshelf-card.js`へ移す。本文・呼び方（`this.xxx`・`app.xxx`）は無変更。
- `_bookshelfDescription`は3行の極小ヘルパーかつ本棚ヘッダー（残留確定済み）との共用のため、bookshelf.jsに残す。
- (c)は本文の`this`の向きが崩れるため不成立（確認済み・深追いしない）。

## 3. static/getter/setter/クラスフィールドの grep 全数検査（#537の落とし穴対応）

ファイル全体：
- static群**9件**（4438行・4669-4709行）。getter**1件**（`_modalHistStack`・5962行）。setterは0件。bare class field（`^ {4}[A-Za-z_][A-Za-z0-9_]*\s*=\s*[^(]`）は0件。

移動候補の行範囲（§1の`renderBookshelfOverview`6810-6823、§2の3メソッド4359-4387/6825-6853/6855-6926）に対し同じ検査：**全範囲でヒット0件**（static(4438,4669-4709)・getter(5962)はいずれも移動候補の外側）。

## 4. 委譲の対象（テストが直接触っている名前）

grep実測（`bookshelf.<name>`または`window.bookshelf.<name>`形式）：

| 名前 | 箇所数 |
|---|---|
| `renderBookshelfOverview` | 0 |
| `_bindBookshelfOverviewEvents` | 0 |
| `_renderBookshelfCard` | 0 |
| `_bookshelvesInTreeOrder` | 0 |
| `_bookshelfDescription` | 0 |

**「委譲」の数＝0件**（移動候補のいずれもテストから直接呼ばれていない＝UI操作・dashboard.js経由のみ）。

## 5. tests/配下の`bookshelf._`参照の総数（基準値）

**355件**（§0と同じ・基準値と一致）。§4のとおり移動候補はテストから`bookshelf._`形式で直接呼ばれていない（0件）。この計測・移動作業はテストファイルを一切編集しないため、step3の再計測でも355件以下であることを確認する。

```
grep -ron "bookshelf\._[A-Za-z]" tests/e2e/ tests/visual/ | wc -l
```

## 6. まとめ

- **共用部品の置き場所（確定推奨）**：(b) `js/ui/bookshelf-card.js` へ3メソッド・130行を移す。`_bookshelfDescription`は残す。(c)は不成立。
- **ホームの概観の移動（②判断待ち・tp）**：実測の結果、独立に切り出せる実体は`renderBookshelfOverview`(14行・no-op)のみで100行未満。代替案＝U8eは共用部品の決定・移動だけを行い、ホームの概観(14行)はU8f（公開の一覧）の新規ファイル作成と合わせる、を推奨。
- static/getter/setter/クラスフィールドの移動候補範囲内混入：0件。
- 委譲（テスト直接呼び出し）の対象：0件。
- `bookshelf._`参照数：355件（変化なし）。
