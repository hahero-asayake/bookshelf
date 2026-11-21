# イシュー#726 結果：読み直しで手元の新しい並び順が残ることのE2E（#690監査3番）

## §1 既存のE2Eが書き換え 10hv83ghzyg を見逃した理由（step1・2026-11-22 07:05 JST）

### 基準

- 基準の sha：`ef72c7b6fd636efd039e89aa6030a459a02fcf1e`（worktree の HEAD = origin/main。fetch 後も同じ＝merge 不要）
- `npm run check:deps`：一致（worktree 直下の node_modules は実体・@playwright/test 1.65.1＝lock と同じ。npm ci は不要だった）
- ブラウザ：~/.cache/ms-playwright/chromium-1255（playwright install は打っていない）
- ポート：**8126**。ステップの detail は 18726 だったが、core の作業ツリーの指示（「検証サーバは PORT=8126」）を採った。流す前に 8126・18726 とも LISTEN 無しを確かめた。サーバは worktree 直下で自分で `python3 -m http.server 8126` を起こし、使い終わって止めた（停止後 `ss -ltn | grep ':8126 '` は空）

### 書き換えの再現

- 書き換え：js/bookshelf.js `_applyLoadedState` の並び順の塊（ef72c7b で L3695）
  `if (!Array.isArray(lo) || !((localTs[k] || 0) > (remoteTs[k] || 0))) return;` の先頭の `!` を外す（Edit で入れた）
- 配信の確認：`curl -s http://localhost:8126/js/bookshelf.js | grep -c 'if (Array.isArray(lo) ||'` → **1**
- `PORT=8126 npm run test:e2e -- tests/e2e/sort-persist.spec.js tests/e2e/gate/j3-3-sort-persist.spec.js --project=chromium`
  → **13 passed (10.1s)**＝#690 の「13本とも通った」を再現した
- 戻し：`git checkout -- js/bookshelf.js` → `git diff --stat` 空。配信も `if (!Array.isArray(lo) ||` が 1 に戻ったことを curl で確かめた

### 測った値（元のコード・sort-persist.spec.js に一時の console.log を入れて測り、測った後 `git checkout` で戻した）

hub・github の両方で同じ形になった（時刻の値は hub の回）。

① 「PC と交互に変更」：最後の `restart(pc)` の直前

| 項目 | 値 |
|---|---|
| PC の `userData.settings._updatedAt['bookOrder:all']`（メモリ） | **無い**（undefined） |
| PC の localStorage `virtualBookshelf_userData` の同じ値 | **無い**（undefined） |
| PC 側の保存先（__fakeRemote）の `private/settings.json` の `_updatedAt['bookOrder:all']` | 1795298759547 |
| PC の `virtualBookshelf_pendingSync` | null |
| PC の手元の `bookOrder.all`（= `_priorLocal.bookOrder.all` になる） | 配列（初期の順 0000〜0005） |
| 保存先の `bookshelves/all.json` の books | スマホが並べた順（0004 が先頭） |
| restart 後の `bs._lastLoadDecision` | **'remote'** |
| restart 後の `bookOrder.all` | スマホの順（期待どおり） |

② 「ドラッグで並べた直後に閉じた」：restart 直前

| 項目 | 値 |
|---|---|
| `localStorage.virtualBookshelf_pendingSync` | **'1'** |
| 手元の `_updatedAt['bookOrder:all']` | 1795298758876 |
| 保存先の `_updatedAt['bookOrder:all']` | 無い（pushAll は並べ替えの前） |
| restart 後の `bs._lastLoadDecision` | **'local'** |

③ J3-3（tests/e2e/gate/j3-3-sort-persist.spec.js）：操作は `#sort-order` の `selectOption('title')` と `#sort-direction` のクリックだけ。`drag|reorder|bookOrder|custom` は 0 件＝bookOrder を変える操作は無い。

### 理由（見立てとの照合）

- ①：見立てどおり。手元の時刻は 0（キー自体が無い。PC はこの spec の中で一度も並べ替えていない）、保存先は 1795298759547＝2つ目の条件で return する。書き換え後は `lo` が配列なので1つ目の条件で return する＝どちらも return で同じ結果。**見立てとの差（補足）**：手元の時刻は「保存先より古い」のではなく「無い」。また `lo` は配列（`_ensureAllShelf` で bookOrder.all が埋まる）なので、書き換えた版では必ず1つ目で return する。この spec には「手元の時刻が保存先より新しい」場面が無い。
- ②：見立てどおり。未反映の印 '1' が残ったまま再起動し、判定が 'local'＝`_keepLocalOverLoaded` で戻るので、L3691 の塊（`_lastLoadDecision='remote'` の後）に届かない。
- ③：見立てどおり。並び方（タイトル順・昇降）だけで bookOrder を変えない。

→ 書き換えを捕まえるには「未反映の印が無い（= 判定が 'remote' になる）」「手元の `_updatedAt['bookOrder:X']` が保存先より新しい」「手元と保存先で並び順が違う」の3つがそろった読み直しが要る。step2 の筋書きはこの条件を作る形で足す（筋書きの直しは不要）。

本体のバグは見つかっていない（元のコードでは①②とも期待どおりの順になった）。

## §2 足した E2E と確かめた結果（step2・2026-11-22 07:07 JST）

### 足した test

- 場所：tests/e2e/sort-persist.spec.js の `for (const method of ['hub', 'github'])` の describe の中（hub・github で2本）
- 題：「読み直し: 手元で新しく並べ替えた順は、保存先が古い順のままでも残る」
- 筋書き（page の1枚・既存の seed/boot/pushAll/loadRemote/remoteFile/restart を使う）
  - a. seed → goto → boot(remote:'{}') → selectSort('custom') → pushAll
  - b. 保存先の写し old と oldOrder（bookOrder.all）を控える
  - c. 画面の並びから `bs.reorderBooks(ids[5], ids[0])` → `await bs.flushSync()`。newOrder を控え、oldOrder と違うこと・`virtualBookshelf_pendingSync` が null（判定が 'remote' になる前提）を確かめる
  - d. 保存先を old に戻す（古い状態のまま開いていた別の端末が古い並び順で書いた）。前提として、`private/bookshelves/all.json` の books が oldOrder であること、手元の `_updatedAt['bookOrder:all']` が保存先の `private/settings.json` の同じキー（無ければ0）より大きいことを確かめる
  - e. loadRemote → `bookOrder.all` が newOrder
  - f. 手元が勝った時の送り直し：保存先の all.json の books が newOrder になるのを expect.poll で待つ
  - g. restart → 画面の並び（`#bookshelf > .book-item[data-asin]`）が newOrder になるのを expect.poll で確かめる
- 書き方：`bookshelf._`・`app._` の字面は足していない。waitForFunction(async) と固定の sleep は使っていない。toast は見ていない

### 書き換え 10hv83ghzyg の前後（PORT=8126・自分で起こした http.server。step1 と同じ理由で 18726 でなく 8126）

- 元のコード：`--grep "読み直し: 手元で"` → **2 passed**
- 書き換え（Edit で入れ、curl の grep -c 'if (Array.isArray(lo) ||' = 1 を確かめた）：→ **2 failed**（hub・github とも）
  - 落ちた行：sort-persist.spec.js:164（筋書き e の `expect(bookOrder.all).toEqual(newOrder)`）
  - 期待値：`[B0SORT0005, B0SORT0000, B0SORT0001, B0SORT0002, B0SORT0003, B0SORT0004]`（手元の新しい順）
  - 実際の値：`[B0SORT0000, B0SORT0001, B0SORT0002, B0SORT0003, B0SORT0004, B0SORT0005]`（保存先の古い順）
- 戻した後（`git checkout -- js/bookshelf.js`、curl で `if (!Array.isArray(lo) ||` = 1）：→ **2 passed**
- `git diff --stat -- js/`：空（本体は変えていない）

### 3回続けて（`PORT=8126 npm run test:e2e -- tests/e2e/sort-persist.spec.js --project=chromium`）

| 回 | 開始 | load average（uptime） | 結果 |
|---|---|---|---|
| 1 | 07:07:36 | 4.00, 2.31, 2.56 | 14 passed (14.0s) |
| 2 | 07:07:50 | 4.94, 2.62, 2.66 | 14 passed (15.6s) |
| 3 | 07:08:06 | 8.33, 3.51, 2.95 | 14 passed (13.7s) |

### lint

- `npm run lint`：**12 本中 0 本失敗**

### 筋書き f・g について

- f（手元が勝った時に保存先へ送り直す）・g（再起動後の並び）とも、期待どおりに通った（期待は外していない）。本体のバグは見つかっていない
