# イシュー#663 結果：保存先からの読み直しで、開いていた本棚が消えた時

## §0 前提の確認（step1）

### #634 が入ったか

- 確かめた時刻：2026-11-14 18:37:36 JST に fetch した。origin/main の先頭は 2946a43。
- `git log origin/main --grep='Issue: #634'` で8件が見つかった。直しの commit は次のとおり。
  - b002e98「fix: 開いている本棚・その上の本棚を削除したら「すべての本」へ切り替え、見出し・ツリーの選択・URL も揃える (設計: 03_詳細設計書 2026-11-14 更新)」
- worktree（issue/663）は、1234cf4 から 2946a43 へ `merge --ff-only` で進めた。

### #634 で入った関数（origin/main 2946a43 の `js/bookshelf.js`）

`async _leaveRemovedShelf(removed)`（L5767〜5788）

- 引数 `removed` は、消えた本棚の配列（子孫を含む）。見るのは各要素の `id`（slug）と `internalId`。
- 判定：`currentBookshelf` が空の時と、`removed` のどれにも当たらない時（`t.id === cur || t.internalId === cur` で比べる）は、何もしない。
- ホームにいる時など、本棚ビューを出していない時（body に `app-view-bookshelf` が無い）は、画面を動かさない。`currentBookshelf = 'all'` と `applyFilters()` だけを行う。
- 本棚ビューを出している時：
  - 先にドロワーの段を戻す。`drawer-open` なら `_closeDrawer()` して、popstate の着地を待つ（保険として最大1秒）。
  - 次に `switchBookshelf('all', { replace: true })` を呼ぶ。
- async で、Promise を返す。deleteBookshelf からは `await this._leaveRemovedShelf(removed)` で呼ぶ（L5758）。

`switchBookshelf(bookshelfId, { replace = false } = {})`（L4361）

- `replace` は `_navigateFromUi('bookshelf', slug, { replace })` に渡る。true なら URL を積まずに、今の段を置き換える。
- この中で次をまとめて揃える：
  - 一覧：`applyFilters`
  - 見出し：`_updateBookshelfViewTitle`
  - ツリーの選択：`_updateSidebarActive`
  - URL

#634 の spec（`tests/e2e/shelf-delete-open-descendant.spec.js`）は、次の4つを画面から見る。測り方はこれに揃えた。

- 見出し：`#current-bookshelf-title`
- 本の数：`#bookshelf .book-item`
- ツリーの選択：`#sidebar-bookshelf-tree .tree-node.is-active`
- URL

## §1 再現の実測（P1：起動時の読み直し）

### 方法

- probe は `tests/e2e/probe-663-reload-removed.spec.js`（commit しない）。
- 流した条件：chromium、PORT=8163、18:38:53〜18:39:15。4件とも完走した（20.5秒）。

前提

- ハブの模擬に、`seedHubDataForTest` の見本（5冊）と、次の2つの本棚を置いた。
  - 本棚X（`p663-x`）：フィクスチャの本 1・2
  - 本棚Y（`p663-y`）：フィクスチャの本 3
- 端末A：ハブにログインした状態で、端末内に蔵書が無いところから起動した。そのあとツリーから X を開いた。

別の端末での削除

- `prepareOtherDeviceForTest` で別の端末を用意し、アプリを開いた。
- ツリーの「…」→ 削除 → 確認ダイアログの順に、画面から消した。
- ハブの `private/bookshelves.json` から、消した slug が無くなるまで待った。
- **4件とも、画面からの削除がハブに届いた**。ハブの中身を直接書き換える代わりの手は使っていない。

端末Aでの再読込

- `page.reload()` で再読込した。手元には X が残っているので、ルーターは手元のデータで先に X を描く。
- そのあと保存先から読み直す（読込の決め方は `remote`）。
- `waitForHubStartupForTest` と 800ms の待ちの後に記録した。

### 記録

| 幅 | 別の端末で消した本棚 | 見出し | URL | ツリーの選択 | 一覧 | currentBookshelf | history.length（再読込の前→後） |
|---|---|---|---|---|---|---|---|
| 1280 | **X（開いている本棚）** | 本棚X | `#/bookshelf/p663-x` | **どの行も選ばれていない**（X の行は消えた） | **2冊**（X にあった本 1・2） | p663-x | 3 → 3 |
| 390 | **X（開いている本棚）** | 本棚X | `#/bookshelf/p663-x` | **どの行も選ばれていない**（ドロワーを開いて見た） | **2冊**（X にあった本 1・2） | p663-x | 3 → 3 |
| 1280 | Y（対照） | 本棚X | `#/bookshelf/p663-x` | 本棚X | 2冊 | p663-x | 3 → 3 |
| 390 | Y（対照） | 本棚X | `#/bookshelf/p663-x` | 本棚X（ドロワー） | 2冊 | p663-x | 3 → 3 |

- 全件は5冊。読込の決め方（`_lastLoadDecision`）は4件とも `remote`。
- 読み直した後の手元の本棚（`userData.bookshelves`）：
  - X を消した時：`["all","p663-y"]`
  - Y を消した時：`["all","p663-x"]`
- ハブの本棚は、再読込の後も消した時のままだった。端末Aは X を書き戻していない。

### 判定

**起きた（1280・390 とも）**。

- 見出しと URL は、消えた本棚Xのまま残る。
- ツリーでは、どの行も選ばれていない。
- currentBookshelf も `p663-x` のまま。

**一覧は、見込み（全件）と違った。X にあった2冊のまま残る**（全件は5冊）。理由はコードの読みでは次のとおり。

- `updateDisplay()`（L2032〜）は、`this.filteredBooks` を描くだけで、絞り込みをやり直さない。
- `filteredBooks` は、再読込の直後に手元のデータで X を描いた時（ルーター → `switchBookshelf` → `applyFilters`）の値のまま。
- `_applyLoadedState` も、呼び出し元（initCloudSync の L3246〜）も、`applyFilters` を呼ばない。
- 仮に `applyFilters` を呼べば、X が見つからないので全件になる（L1699〜1702）。#634 results の注にあった「全件になる」見込みは、こちらの場合の話だった。

対照（Y を消した時）では、X が正しく残る。見出し・URL・ツリー・一覧のどれも X のまま。

### P2・P3・GitHub・ローカルのフォルダ

- **P2（衝突で「保存先」を選ぶ）は未実測**。理由：run の時間（30分）の中で、P1 の実測と記録・commit を先にした。
  - コードの読み：`_askLoadConflict` で `remote` を選ぶと、`_applyLoadedState(state, { adoptRemote: true })` のあと `updateDisplay()` などを呼ぶ（L3015 付近）。ここでも `applyFilters` は呼ばない。描き直しの組が P1 と同じなので、同じ症状（見出し・URL・一覧が X のまま）になる見込み。
- **P3（電波なしで開いた後の読み直し）は実測した**（1280・chromium・18:41:36〜18:41:43・2件完走）。probe は `tests/e2e/probe-663-p3.spec.js`（commit しない）。
  - 前提は P1 と同じで、別の端末から画面で X を消した。
  - 端末Aは、ハブへの通信を `route.abort('internetdisconnected')` で落とした状態で再読込した。これで起動時の読込が失敗し、`_initLoadFailed` が立つ。
  - そのあとハブへ届くように戻し、`setOffline(true→false)` で 'online' を出した。`_watchSyncRecovery` → `_retryInitLoad` → initCloudSync の順に進み、読込の決め方は `remote` だった。

| 場面 | 見出し | URL | ツリーの選択 | 一覧 | currentBookshelf | history.length（読み直しの前→後） |
|---|---|---|---|---|---|---|
| X を開いたまま、電波が戻る | 本棚X | `#/bookshelf/p663-x` | どの行も選ばれていない | 2冊（X にあった本） | p663-x | 3 → 3 |
| X を開いてからホームへ戻り（戻る1回）、電波が戻る | （ホーム） | `''` | — | — | **p663-x のまま** | 3 → 3 |

- X を開いたままの時は、P1 と同じ症状が出る。
- ホームにいる時は、画面には何も出ない。ただし currentBookshelf は消えた X を指したまま残る。
- その後に「進む」で X の段へ行くと、`_applyRoute` が slug を引けず、ホームへ置き換わった（hash `''`）。消えた本棚の段は、ホームへ落ちるだけで壊れない。
- **GitHub（initGitHubSync の L3379）**：コードの読みだけ。fingerprint を比べてから `updateDisplay()` 他を呼ぶ形が initCloudSync と同じなので、同じ症状の見込み。
- **ローカルのフォルダ（loadFromObsidianFile の L3562）**：コードの読みだけ。呼び元は reloadFromObsidianFile と initObsidianSync で、`_applyLoadedState` のあとに `updateDisplay()` 他を呼ぶ。同じ症状の見込み。

## §2 呼び方の案

### 案A（既定・②の承認時の既定）

- 場所：`_applyLoadedState` の末尾（L3723 `bookshelfManager.rebuildReverseIndex()` の後、`return true` の前）。
- 消えた本棚の一覧（removed）の作り方：
  - 読み込む前の手元（`_priorLocal.bookshelves`）にあって、読み込んだ `bookshelves` に無いもの。
  - 突き合わせは `bookshelfManager._keyOf`（internalId、無ければ id）で行う。internalId の無い実データがあるため（bookshelf-manager.js:39-41）。
- これで `this._leaveRemovedShelf(removed)` を1回呼ぶ。「今の本棚が消えたか」の判定は、#634 の関数の中だけに置く。
- この1か所で、呼び出し4か所（ハブ・GitHub・ローカルのフォルダ・衝突で「保存先」の adoptRemote）を覆える。
- `local`・`held`・`ask` は、その手前で return するので呼ばれない。`ask` のあとで「保存先」を選ぶと、adoptRemote で末尾まで来るので呼ばれる。

step2 で気をつけること

1. **`_leaveRemovedShelf` は async で、`_applyLoadedState` は同期関数**（戻り値の true/false を呼び出し元が使う）。
   - 読み直しは起動時の裏で走るので、ふつうはドロワーが閉じていて、待ちは起きない。
   - 推奨：`_applyLoadedState` は async にしない。Promise は待たずに投げ、`.catch` でログを出す。
   - 待たないので、ドロワーが開いている時（電波が戻った時の再試行の途中にドロワーを開いていた場合など）は、切り替えが少し後になる。#634 と同じく、ドロワーの段を戻してから置き換えるので、履歴は崩れない。
2. 本棚ビューを出している時は、`switchBookshelf('all', { replace: true })` が `applyFilters` を呼ぶ。これで一覧も全件に揃う（§1 の「2冊のまま」も直る）。その後、呼び出し元の `updateDisplay()` がもう一度描く。2回描くのは本棚が消えた時だけ。
3. ホームにいる時は、#634 の決まりのとおり `currentBookshelf = 'all'` と `applyFilters()` だけを行う。画面は動かさない。
4. 履歴は #634 の関数の `replace` をそのまま使う。新しく書かない。

### 案B（採らない）

- #634 の関数の判定を「今の本棚が getById で引けない」に変え、引数なしで両方から呼ぶ形。
- #634 の判定に手を入れることになる。案A で4か所とも覆えるので、採る理由が無い。

### ホームにいる時の spec は要るか

- **要らない（推奨）**。理由は3つ。
  - ホームで currentBookshelf が消えた本棚を指したまま残るのは、P3（実測）・P2（コードの読み）のように、アプリを開いたまま読み直す時だけ。
  - その時も、ホームの画面には何も出ない（P3 の実測）。画面から確かめられるのは「次に本棚ビューへ入った時」だけになる。ただ、ホームから本棚ビューへ入る道（ツリー・ウィジェット・本の詳細の from）は、どれも行き先の本棚を指定して currentBookshelf を書き換える。これはコードの読みで、全部の道は確かめていない（未確認）。
  - ホームにいる時の扱いは、#634 の関数の中の決まり（画面を動かさず `currentBookshelf = 'all'`）そのもので、今回の変更は呼び出しを足すだけ。
- 判定を内部の値（currentBookshelf）だけで書く spec は、「画面から確かめる」の決まりに合わない。なので足さない。
- ②が要ると判断した場合は、step2 で P3 の probe の型（`route.abort` → 再読込 → 'online'）を使って1件足す。

## §3 直した後（step2〜3 で書く）
