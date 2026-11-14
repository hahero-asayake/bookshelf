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

### step2：spec の赤→緑と直し

- 18:43 に origin/main 2072774 へ rebase した（step1 の docs 2件は 7765101・58d687e になった）。
- spec は `tests/e2e/shelf-reload-removed.spec.js`（ケース1・2 × PC 幅・390 幅）。
  - 別の端末での削除は画面から行う（ツリーの「…」→ 削除 → 確認）。ハブに届くまで `expect.poll` で待ってから、端末Aを再読込する。ハブの中身を直接消す代わりの手は使っていない。
  - 判定は画面で行う（見出し・URL・ツリーの選択・一覧の件数・history.length）。currentBookshelf は、失敗した時の添付だけにした。
  - 見本の「すべて」の本棚の名前は「すべての本」にした（fixture-userdata.json と同じ）。
- **直す前（56bedc7 の時点）**：ケース1は 1280・390 とも赤だった（見出しが `"本棚X"` で、期待の `"すべての本"` と違う）。ケース2は 1280・390 とも緑。
- 直し（cdc0e8a・`js/bookshelf.js` の `_applyLoadedState` の末尾）：
  - `rebuildReverseIndex()` の後で、読み込む前の手元（`_priorLocal.bookshelves`）にあって読み込んだ後の `bookshelves` に無い本棚を、`bookshelfManager._keyOf` で突き合わせて集める。
  - それを `_leaveRemovedShelf(removed)` に渡す。Promise は待たず、`.catch` で `console.error` に出す。
  - 消えたかの判定と、履歴の置き換え（replace）は #634 の関数のまま。別に書いていない。
  - `index.html` の `js/bookshelf.js?v=` は 2026111795 → 2026111796 にした（origin/main の最大値は 2026111795）。`check:version --range=origin/main..HEAD` は OK。
- **直した後**：新しい spec は4件とも緑（9.8秒）。ケース1では5つの点をすべて確かめている。
  - 見出しが「すべての本」
  - URL が `#/bookshelf/all`
  - ツリーで「すべて」の行だけが選ばれている（1行）
  - 一覧が5冊（全件）
  - history.length が再読込の前と同じ
  - 判定は、起動の読込が済んだ後（`waitForHubStartupForTest`。呼び出し元の `updateDisplay` まで済んだ後）に、自動でやり直す expect で行う。呼び出し元の描き直しが、切り替えの後の一覧（5冊）を古い中身（2冊）で上書きしていないことも、この判定で確かめた。

### 直す前と後（step1 の probe を直した後に流し直した値・chromium・18:48:05〜18:48:21）

probe の見本では「すべて」の本棚の名前が「すべて」なので、見出しは「すべて」と出る。

| 経路・幅 | 消した本棚 | 見出し（前→後） | URL（前→後） | ツリーの選択（前→後） | 一覧（前→後） | currentBookshelf（前→後） | history.length（後） |
|---|---|---|---|---|---|---|---|
| P1・1280 | X（開いている） | 本棚X → すべて | `#/bookshelf/p663-x` → `#/bookshelf/all` | なし → all | 2冊 → 5冊（全件） | p663-x → all | 3 → 3 |
| P1・390 | X（開いている） | 本棚X → すべて | 同上 | なし → all（ドロワーでも all） | 2冊 → 5冊（全件） | p663-x → all | 3 → 3 |
| P1・1280 | Y（対照） | 本棚X → 本棚X | 変わらず | p663-x → p663-x | 2冊 → 2冊 | p663-x → p663-x | 3 → 3 |
| P1・390 | Y（対照） | 本棚X → 本棚X | 変わらず | p663-x → p663-x | 2冊 → 2冊 | p663-x → p663-x | 3 → 3 |
| P3・1280 | X（開いたまま、電波が戻る） | 本棚X → すべて | `#/bookshelf/p663-x` → `#/bookshelf/all` | なし → all | 2冊 → 5冊（全件） | p663-x → all | 3 → 3 |
| P3・1280 | X（ホームにいて、電波が戻る） | （ホームのまま） | `''` → `''` | — | — | **p663-x → all** | 3 → 3 |

- **ホームから読み直した時の currentBookshelf：直す前は `p663-x`（消えた本棚）、直した後は `all`**。画面はホームのまま動かない（`app-view-main`・hash `''`）。
  - 同じ時、隠れているツリーでは「すべて」の行に is-active が付いていた（1280 ではツリーが見える）。これは、読み直しの後の描き直しで、ツリーが currentBookshelf を元に描き直されるため。ホームでのツリーの選択の見た目は、今回は変えていない（#634 の関数の、ホームにいる時の分岐のまま）。
- P2（衝突で「保存先」）は未実測のまま。コードの読みでは、P1 と同じ見込み（adoptRemote でも `_applyLoadedState` の末尾まで来る）。

### step2 の検証（直した後・cdc0e8a）

- E2E（chromium・PORT=8163・4 workers・18:45:59〜18:47:27）：**89件すべて緑（1.5分）**。流した spec は次のとおり。
  - 新しい spec：shelf-reload-removed
  - #634 の spec：shelf-delete-open-descendant
  - 本棚まわり：bookshelf-open-paths・shelf-file-delete・shelf-structure-home-refresh・tree-drop-stays-home・per-shelf-memo
  - 読み直しまわり：load-conflict-unsaved・sync-offline-reconnect・gate/j6-3-hub-other-device・gate/j6-4-sync-conflict・gate/j8-4-online-resync・sort-persist
- `npm test`（vitest）：80ファイル・1192件が通った（todo 2）。exit 0。
- 設計書：03_詳細設計書の主要メソッド表を更新した。
  - `loadData()` / `_applyLoadedState` の行（L86）に、保存先を採った後に `_leaveRemovedShelf` で「すべての本」へ移すことを足した。
  - `_leaveRemovedShelf` の行（L153）の「呼ぶのは」に、`_applyLoadedState` の末尾を足した。
  - obsidian 側の commit はしていない（自動バックアップに任せる）。
- probe 2本（`tests/e2e/probe-663-*.spec.js`）は commit せず、`_trash/663-probe/` へ移した。

### step3：push の前の検証

#### 載せ直し

- 18:50:22 に fetch し、origin/main 47505b2 へ rebase した（衝突なし）。
- issue/663 の commit は次の6件になった。どれも Issue: #663 付き。

| sha | 種類 | step2 の時の sha |
|---|---|---|
| fa4d630 | docs | 7765101 |
| b901e98 | docs | 58d687e |
| a8bfda6 | test（赤） | 56bedc7 |
| f5932f6 | fix | cdc0e8a |
| cfabd29 | docs | 46b89b1 |
| f47650e | chore（?v=） | なし（step3 で足した） |

#### ?v= が衝突なしで消えた（#665 の罠）

- origin/main の #669 の fix（0a75394）が、`js/bookshelf.js?v=` を同じ値の 2026111796 に上げていた。
- そのため rebase で、この直しの index.html の変更が消えた（f5932f6 は js/bookshelf.js だけになった）。
- f47650e で 2026111797 に上げ直した。origin/main の index.html の最大値は 2026111796。
- `check:version --range=origin/main..HEAD` は OK。

#### lint・vitest（rebase の後・f47650e）

- `npm run lint`：12本中0本失敗。
- `npm test`：80ファイル・1194件が通った（todo 2）。exit 0。

#### main との全件比較（e2e-diff-main）：途中で壊れたので代替判定にした

e2e-diff-main は、18:51:07〜19:03:07 に `--port=8163`・`--init-storage` なしで流した。12分の上限で打ち切った（exit 1）。

- **base 側（origin/main 47505b2）は全件を流し切った**（18:51〜18:57・6分13秒）。
  - 1147件が通り、4件が落ちた（skip 593・flaky 0）。
  - 落ちた4件：duplicate-asin-notice・list-staged-render・reimport-diff・sync-offline-reconnect の「両方が変わった:「保存先の内容を読み込む」を選ぶと…」。どれも origin/main で落ちたもので、この直しとは関係しない。
- **work 側の E2E は途中で終わった**（18:57:20〜19:02:39・1748件中およそ519件まで）。`work.e2e.json` が出ず、比較できなかった。
  - 負荷が高かった（load average 41）。
  - そのあと vitest は両側とも流れた（base 1194件・work 1194件が通り、どちらも失敗0）。
  - 画像比較は「port 8163 が使用中」で止まった。
- **後始末**：途中で終わった run が残したサーバ（`python3 -m http.server 8163`・cwd はこの worktree）が、空の応答を返していた。そのまま一覧を流すと89件すべてが `net::ERR_EMPTY_RESPONSE` で落ちたので、このサーバを止めた。

**代替判定（step3 の決まりどおり、step2 の一覧を両側で比べた）**

- base 側：e2e-diff が流し切った origin/main の全件の結果から、同じ spec の分を取り出した。新しい spec は base に無い。
  - 86件のうち85件が通り、1件が落ちた（sync-offline-reconnect の上の1件）。
- work 側：f47650e で、step2 と同じ13本を流し直した（chromium・PORT=8163・4 workers・19:04:32〜19:05:58）。
  - **89件すべてが通った（1.4分）**。base で落ちた sync-offline-reconnect の1件も、work では通った。
- **新しく落ちたもの：0件**。
- 流し切れなかったのは、work 側の E2E 全件と画像比較。この2つは、この判定に入っていない。
