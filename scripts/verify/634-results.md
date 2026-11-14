# イシュー#634 step1 の結果：子の本棚を開いたまま親を削除した時の実測

## 前提

- 測った土台：origin/main 16c0a10（2026-11-14 17:15 に fetch した値）。
- #623 は入っている。
  - origin/main の `Issue: #623` の commit は4件（9c809a2・99f7488・432d519・6dc2c04、最後は 14:56）。
  - DB の issues.id=623 は state=done（updated 15:03:25）。
- 削除の処理：`js/bookshelf.js:5544-5584` の `deleteBookshelf`。
  - 「すべて」へ戻すのは L5578-5581 の `if (this.currentBookshelf === bookshelfId)` の時だけ。
  - 戻す時に行うのは `currentBookshelf = 'all'` と `applyFilters()` の2つだけ。

## 判定の基準（測る前に決めた）

対照A（開いている本棚そのものを削除）と比べる。本題のケースで、次のどれかが対照と違えば「起きた」、全部同じなら「起きなかった」とする。

- 一覧の見出し
- 表示される本の件数
- URL
- ツリーで選択中の行

## 手順

- スクリプト：`_local/634/measure.mjs`（commit しない）。chromium・`serviceWorkers: 'block'`。
  - 幅は 1280 と 390（390 は `hasTouch`・`isMobile` を付けた）。
  - 配信は `python3 -m http.server 8134`。
- 前提の本棚の用意：fixture（`tests/fixtures/fixture-userdata.json`・`fixture-library.json`）に、親＞子＞孫と無関係の本棚を足して localStorage に入れた。足し方は `tests/e2e/book-detail-shelf-meta.spec.js` の bootApp と同じ型。
  - **計画からの変更**：計画では本棚づくりも画面から行うとしていたが、時間の都合で本棚フォームでは作っていない。
  - 本棚フォームで作った本棚も同じ `userData.bookshelves` に入り、削除の経路（ツリーの「…」→ deleteBookshelf → `bookshelfManager.remove`）は同じなので、結果は変わらない見込み。
  - 本1（B000000001）は親・子・孫に入れ、無関係の本棚は空にした。
- 画面から行った操作：
  - 本棚を開く：ツリーの行を押す。390 では下部ナビの「本棚」でドロワーを開いてから押す。
  - 削除する：ツリーの「…」→「削除」→ 確認ダイアログの「削除する」。
  - 390 の削除の入口も、ドロワーのツリーの「…」（`js/screens/bookshelf-list.js:235`）。もう1つの入口（本棚の管理の一覧・L339-340）は使っていない。
- `saveUserData` の扱い：
  - 再読込のケース以外では、何もしない関数に差し替えた（#623 の spec と同じ）。
  - 再読込のケースでは差し替えていない。差し替えたまま流した1回目は、削除が端末に残らず、再読込で本棚が戻った。この1回目は無効とした。
- 読み取りだけで見たもの：`window.bookshelf.currentBookshelf`。
- 本の件数：一覧（`#bookshelf`）の `[data-asin]` の数を2で割った値（1冊のカードに `[data-asin]` が2つある）。ツリーの冊数（すべての本 5・テスト本棚 3）と合う。
- 繰り返し：1280 は2回流し、各ケースの削除後の値は2回とも同じだった。1280 と 390 も、全ケースで同じ値だった。

## 結果（1280・390 で同じ）

| ケース | 開いた本棚 | 消した本棚 | 削除後の見出し | 削除後の件数 | 削除後の URL | ツリーで選択中 | currentBookshelf |
|---|---|---|---|---|---|---|---|
| A 対照 | 無関係 | 無関係（自身） | 無関係の本棚（**古い**） | 5（すべて） | `#/bookshelf/e2e-other`（**古い**） | なし（**「すべての本」が選ばれない**） | all |
| B 本題 | 子 | 親（子・孫も消える） | 子の本棚（**古い**） | 1（**消えた子の本**） | `#/bookshelf/e2e-child`（**古い**） | なし | e2e-child（**消えた本棚**） |
| C 孫 | 孫 | 親 | 孫の本棚（**古い**） | 1（**消えた孫の本**） | `#/bookshelf/e2e-grand`（**古い**） | なし | e2e-grand（**消えた本棚**） |
| D1 | 無関係 | 親 | 無関係の本棚 | 0 | `#/bookshelf/e2e-other` | e2e-other | e2e-other（正しい） |
| D2 | 親 | 子（孫も消える） | 親の本棚 | 1 | `#/bookshelf/e2e-parent` | e2e-parent | e2e-parent（正しい） |

- 確認ダイアログには子孫の名前が出る。B・C では「子孫本棚もカスケード削除されます: ・親の本棚 ・子の本棚 ・孫の本棚」と表示された。
- B の続き：
  - **再読込**：ホームに着く（hash は空・`app-view-main`・currentBookshelf は undefined）。
    - 古い URL `#/bookshelf/e2e-child` の本棚が見つからないため、`_applyRoute`（`js/bookshelf.js:5331-5334`）が `navigateMain({ replace: true })` へ戻す。
  - **別の本棚へ切り替え**：テスト本棚へ切り替えると、見出し・件数（3）・URL・ツリーがすべて正しく揃う。
- コンソールのエラー：全ケース共通で `Failed to load resource: net::ERR_CONNECTION_REFUSED` が1件ずつ（対照にも出る＝削除とは関係がない）。ほかには無い。
- 画像：`_local/634/shots/<幅>-<ケース>-{before,after,reload,switch}.png`（32枚・commit しない）。

## 判定

- **起きた**（B・C、1280・390 とも）。
  - 対照A は削除後に件数が「すべて」の5冊になる。B・C は消えた本棚の本が1冊のまま残る。
  - currentBookshelf も消えた本棚の slug のまま。
- **対照A自体にも不足がある**：見出し・URL・ツリーの選択は「すべて」に揃わない。
  - 揃うのは一覧の中身と currentBookshelf だけ。
  - 原因は、`deleteBookshelf` が `_updateBookshelfViewTitle()`・`_updateSidebarActive()`・URL の更新を呼ばないこと（コードの読み）。
- D1・D2（切り替えてはいけない側）は正しく、開いたまま残る。

## 同じ種類の箇所の洗い出し

### ① 本棚が消える経路

| 経路 | 場所 | 開いている本棚の扱い | 同じ症状 |
|---|---|---|---|
| ツリーの「…」→ 削除 | `js/screens/bookshelf-list.js:235` → `deleteBookshelf` | 上の表のとおり | **出る（実測）** |
| 本棚の管理の一覧の削除ボタン | `js/screens/bookshelf-list.js:339-340` → `deleteBookshelf` | 同じ関数 | 出る見込み（未実測・同じ関数のため） |
| 保存先からの読み直し（起動・他の端末の更新・衝突で「保存先」を選ぶ） | `_applyLoadedState`（`js/bookshelf.js:3536`）の呼び出し4か所（L2981・3212・3345・3528） | `currentBookshelf` を見ていない（L3536-3700 に参照なし）。描き直しは `updateDisplay()` だけ | 未確認。他の端末で消された本棚を開いていると、症状の形が変わる見込み（下の注を参照） |
| `bookshelfManager.remove` のほかの呼び出し元 | なし（`js/bookshelf.js:5549` の1か所） | — | — |
| プラグイン | 削除の口は無い（`bookshelf:removed` を受け取るだけ・`js/plugin-api.js:17`） | — | 出ない |
| 本棚一覧の初期化 | `js/screens/bookshelf-list.js:280`（一覧が無い時だけ空配列にする） | — | 出ない |

注：`applyFilters()`（`js/bookshelf.js:1697-1704`）は、currentBookshelf の本棚が見つからない時は絞り込まない（全件を通す）。

- 消えた本棚を指したまま一覧を描き直すと、一覧は全件になる。見出し・URL は消えた本棚のまま残る。
- 今回の B・C の後に並べ替え等で描き直しても同じになる（コードの読み・未実測）。

### ② 消えた本棚を指したまま残りうる状態

| 状態 | 場所 | 同じ症状 |
|---|---|---|
| `currentBookshelf` | 代入は `js/bookshelf.js:4294`（switchBookshelf）・5342（本のルートの from）・5579（deleteBookshelf） | **出る（実測・B/C）** |
| URL のハッシュ | `switchBookshelf` → `_navigateFromUi`。deleteBookshelf は URL を触らない | **出る（実測・A/B/C とも古いまま）** |
| 一覧の見出し | `_updateBookshelfViewTitle`（`js/bookshelf.js:4958`）。deleteBookshelf は呼ばない | **出る（実測・A/B/C）** |
| ツリーの選択中 | `_renderSidebarTree` が描く時に付ける（`bookshelf-list.js:57`）。消えた本棚の行は無いので「選択なし」になる | **出る（実測・A でも「すべての本」が選ばれない）** |
| 戻る用の履歴 | 消えた本棚の `#/bookshelf/<slug>` へ戻ると、`_applyRoute` が slug を解決できずホームへ replace（L5331-5334） | 出ない（コードの読み。再読込の実測でホームに着くのと同じ道） |
| 本の詳細の「どの本棚から開いたか」（route.from） | `js/bookshelf.js:5337-5345`。本棚が無ければ切り替えない（`if (bs)`） | 出ない（コードの読み） |
| 記事エディタの本棚選択（`_artShelfSel`・引き出しの本棚） | `js/screens/article-editor.js:1922` ほか | 未確認（範囲外。報告のみ） |

## 直し方の案

| 案 | 中身 | 直るもの | 残るもの・懸念 |
|---|---|---|---|
| A（依頼文どおり） | 判定を「消えた本棚（子孫を含む・slug と internalId の両方）に currentBookshelf が含まれるか」に広げる。中身は今の `currentBookshelf = 'all'` と `applyFilters()` のまま | B・C の一覧の中身と currentBookshelf | 見出し・URL・ツリーの選択は、対照A と同じく古いまま |
| A'（判定を広げ、切り替えは既存の `switchBookshelf('all')` を通す） | A と同じ判定で、`switchBookshelf('all')` を呼ぶ（本棚の切り替えと同じ1つの道） | B・C に加え、対照A の見出し・URL・ツリーの選択も揃う | `switchBookshelf` は絞り込みの解除（`_resetFilters`）とドロワーを閉じる処理を含む（どちらも本棚を切り替える時と同じ動き）。URL は `_navigateFromUi` で積まれる（消えた本棚の段へ戻っても、ホームへ replace されるので壊れない） |
| B（共通の関数にする） | 「今の本棚がもう無ければ『すべて』へ」を1つの関数（中身は A' と同じ）にし、deleteBookshelf と保存先からの読み直し（`_applyLoadedState` の後の4か所）から呼ぶ | A' に加え、他の端末で消された本棚を開いていた時 | 読み直し側は未実測。起動直後の読み直しでも「すべて」へ移ると、ホームにいる人を本棚へ動かさないかの確認が要る。範囲が広がる |

**推奨：A' の中身を1つの関数（例：`_leaveRemovedShelf(removed)`）にして、今回は deleteBookshelf からだけ呼ぶ。**

- 対照A の不足（見出し・URL・ツリー）も同じ変更で直るので、このイシューで一緒に直したい（②の判断を待つ）。
- 読み直しの経路は実測していないので、このイシューでは直さず別イシューにする。今回作る関数を呼ぶ形にしておけば、その別イシューは呼び出しを足すだけになる。
- E2E（step2）は、B・C・D と対照A の見出し・件数・URL・ツリーの選択を、画面から確かめる形にする。
