# イシュー#630 GitHub の切断で保存先が local に戻る件 — 実測と直し方の案

## step1 再現の実測 (2026-11-14 14:28〜14:40)

- 土台: origin/main 4b58ee1 (#596 の 5d8cdb2 を含む)。アプリのコード (js/) は変えていない。
- 測り方: `tests/e2e/sync-github-disconnect.spec.js` (新規・4本) を chromium で実行。接続・「この設定で使う」・切断は画面の操作。
  各段階で localStorage の `bookshelf_sync` と `SyncConfigManager.isConfigured()`、アプリが実際に使っている保存先
  (`bookshelf.syncMethod`)、設定「同期」の保存先セレクトの値を記録した (出力の `REC630` の行)。
- 実行: `PORT=8130 PLAYWRIGHT_BASE_URL=http://localhost:8130 node node_modules/@playwright/test/cli.js test tests/e2e/sync-github-disconnect.spec.js --project=chromium`
- 結果: P1・P2・P3 は赤 (不具合を再現)、P4 (対照) は緑。
- 前提の作り方: 「ハブを保存先にしている人」は接続情報を置いて作った (helpers/gate-hub.js `seedHubLoginForTest(..., { method: 'hub' })` と
  `seedHubDataForTest`)。画面の操作 (ログイン →「この設定で使う」) で作ると、再読込の後のハブの起動待ち
  (`waitForHubStartupForTest`) が40秒で終わらなかった (原因は未調査。空のハブ・空の端末での起動時の確認の画面の可能性)。
  P3 の前提 (この端末のフォルダに決めた・GitHub のトークンあり) も置いて作った。P4 は `seedGitHubLoginForTest` (既存の形)。

### P1 依頼文の手順 (ハブが保存先 → GitHub に接続 → 切断)

| 段階 | method | 決めた印 | GitHub のトークン | ハブの接続 | isConfigured | アプリが使う保存先 | 保存先セレクト |
|---|---|---|---|---|---|---|---|
| 1 ハブが保存先 | hub | 無し (印が入る前の形) | 無し | あり | true | hub | — |
| 2 「GitHub に接続」の直後 | **github** | true | あり | あり | true | hub (再読込の前) | github (自分で選んだ表示) |
| 3 再読込の後 | github | true | あり | あり | true | **local** | **local** |
| 4 「切断」の後 | **local** | 無し | 無し | あり | **false** | local | hub (決めていない人向けの表示) |

- 保存先が変わるのは「切断」より前の「GitHub に接続」の時点 (段階2)。再読込すると、リポジトリを選んでいないので
  GitHub にもつながらず、アプリは端末の中だけで動く (段階3)。ハブへの保存はここで止まる。
- 切断すると local・印なしになる (段階4)。ハブのログインは残るが、保存先はハブに戻らない。

### P2 method=hub のまま GitHub のトークンがある人 (接続の後にハブの「この設定で使う」を押し直した人) が切断

| 段階 | method | 決めた印 | GitHub のトークン | ハブの接続 | isConfigured | アプリが使う保存先 | 保存先セレクト |
|---|---|---|---|---|---|---|---|
| 1 「GitHub に接続」の直後 | github | true | あり | あり | true | hub (再読込の前) | github |
| 2 ハブの「この設定で使う」を押し直した | hub | true | あり | あり | true | hub | hub |
| 3 「切断」の後 | **local** | **無し** | 無し | あり | **false** | **local** | hub (決めていない人向けの表示) |

- 依頼文の不具合はこの形で再現した。ハブが保存先 (段階2) なのに、GitHub を切断しただけで local・印なしになる (段階3)。
- 段階3 では保存先セレクトはハブを見せるが、アプリは端末の中だけで動いている。

### P3 「この端末のフォルダ」に決めた人 (フォルダは未選択・GitHub のトークンあり) が切断

| 段階 | method | 決めた印 | GitHub のトークン | isConfigured | 保存先セレクト |
|---|---|---|---|---|---|
| 1 切断の前 | local | true | あり | true | local |
| 2 「切断」の後 | local | **無し** | 無し | **false** | **hub** |

- method は local のままだが、決めた印が外れ、保存先セレクトの表示が「この端末のフォルダ」からハブに変わる。
- フォルダを選んである人の形は未実測 (起動時の `_recordLocalSyncChoice` が印を立て直すので見た目は変わらない見込み。step2 で測る)。

### P4 (対照) GitHub が保存先の人が切断

| 段階 | method | 決めた印 | GitHub のトークン | isConfigured | アプリが使う保存先 | 保存先セレクト |
|---|---|---|---|---|---|---|
| 1 切断の前 | github | 無し (印が入る前の形) | あり | true | github | github |
| 2 「切断」の後 | local | 無し | 無し | false | local | hub |

- いまの正しい動き (#596 の決まりどおり)。緑。

### 切断の確認の文面 (P1〜P4 の全部で同じ)

> GitHub との接続を切断しますか？
> 接続情報を削除し、保存先を「この端末のフォルダ」に戻します。

## 同じ種類の箇所の洗い出し (接続・切断で method を書く所)

行番号は origin/main 4b58ee1。出発点は scripts/verify/596-results.md:28-43 の書き手の表。

| 操作 | 場所 | method に何を書くか | 保存先でない接続を足す／外すだけで method が変わるか |
|---|---|---|---|
| GitHub に接続 `_connectToGitHub` | js/screens/settings.js:662 `setMethod('github', merged)` | 無条件に github＋印 | **変わる** (P1 段階2。ハブ・フォルダの人が公開用につないだだけで github になる) |
| GitHub の「この設定で使う」`_saveGitHubRepo` | js/screens/settings.js:1460 `setMethod('github', merged)` | github＋印 | 変わらない (保存先に決める操作そのもの) |
| GitHub の切断 `_disconnectGitHub` | js/screens/settings.js:722 `resetMethod(merged)` | 無条件に local・印を外す | **変わる** (P2・P3。ハブ・フォルダの人が GitHub を外しただけで local・印なしになる) |
| ハブのログイン `HubAuth._exchange` ほか | js/hub-auth.js (save のみ) | 書かない | 変わらない |
| ハブの「この設定で使う」`_useHub` | js/screens/settings.js:1406 `setMethod('hub')` | hub＋印 | 変わらない (保存先に決める操作そのもの) |
| ハブのログアウト `_disconnectHub` | js/screens/settings.js:1390-1398 | method が hub だった時だけ `resetMethod()` | 変わらない (ガードあり。`HubAuth.disconnect` js/hub-auth.js:190-202 は hub.* だけを空にする) |
| 保存先セレクトで local へ切替 | js/screens/settings.js:121 `setMethod('local')` | local＋印 | 変わらない (保存先に決める操作そのもの) |
| フォルダが決まった `_recordLocalSyncChoice` | js/bookshelf.js:3148 `setMethod('local')` | 決めていない時だけ local＋印 | 変わらない |

- 問題があるのは GitHub の2か所 (接続 :662 と切断 :722)。ハブは「ログイン (決めない)」と「この設定で使う (決める)」の2段に分かれていて、
  ログアウトにもガードがある。GitHub だけ、接続と切断が保存先の書き換えを兼ねている。
- 公開用に GitHub をつなぐ専用の入口は無い。公開の設定の公開先リポジトリ (index.html `#publish-repo-select`) は「GitHub 接続後に選べます」で、
  接続の入口は設定「同期」の GitHub のパネルの「GitHub に接続」(`#github-connect-btn`) の1か所。
  つまり「ハブを使っている人が、公開のためだけに GitHub をつなぐ」時は、必ず :662 を通る。

## 直し方の案の比較

| 軸 | 案A: 切断だけ直す (依頼文どおり) | 案B: A＋接続では method を書かない | 案C: A＋接続は、決めていない時だけ github に決める |
|---|---|---|---|
| 中身 | `_disconnectGitHub` は、切断前の method が github の時だけ `resetMethod`。それ以外は接続情報だけ空にして `save` | A に加え、`_connectToGitHub` (:662) は接続情報だけを `save`。保存先を github に決めるのは「この設定で使う」(`_saveGitHubRepo`) だけ | A に加え、:662 は `isConfigured()` が false の時だけ `setMethod('github')`、決めている人は `save` |
| ハブの人が公開のためだけに GitHub をつなぐ (P1 段階2〜3) | **直らない**。つないだ時点で github になり、再読込でハブへの保存が止まる | 直る (ハブのまま) | 直る (ハブのまま) |
| その人が後で GitHub を切断 (P1 段階4) | **直らない** (切断前が github なので local に戻る) | 直る (ハブのまま) | 直る (ハブのまま) |
| P2 (hub のままトークンあり → 切断) | 直る | 直る | 直る |
| P3 (フォルダに決めた人 → 切断) | 直る | 直る | 直る |
| P4 (GitHub が保存先 → 切断で local・印なし) | 変わらない | 変わらない | 変わらない |
| 初めての人が GitHub を保存先にする流れ (接続 → リポジトリを選ぶ →「この設定で使う」) | 変わらない | 最後の結果は同じ (github＋印)。接続から「この設定で使う」までの間は「決めていない」のまま (ホームの案内の手順1 は「この設定で使う」で済みになる) | 変わらない |
| #596 の決まり (ADR-056 追補4「GitHub 接続＝決める操作」) | 変えない | 変える (決める操作が5つ→4つ。接続は「決めない書き込み」になる) | 変える (接続が決める操作かどうかが、その時の状態で変わる) |
| ハブとの形のそろい方 | そろわない | そろう (つなぐ＝決めない・「この設定で使う」＝決める) | そろわない |
| 既存テストへの影響 (grep で見た範囲・未実行) | 無し | 接続の後の method を確かめているテストは無い (門の J1-3 GitHub は、アカウント名・知らせ・リポジトリの一覧だけを見る。sync-chosen-mark に接続のテストは無い)。e2e-diff で確かめる | B と同じ |
| 変更の大きさ | settings.js の1か所＋文言 | settings.js の2か所＋文言＋設計書 (03/06/08) の決まりの書き換え | settings.js の2か所 (条件つき)＋文言＋設計書 |

**推奨: 案B。**
- 依頼文の手順 (P1) と、ハブの人が公開のためだけに GitHub をつなぐ使われ方を直せるのは B と C だけ。A では、接続した時点で保存先が
  github に変わる動きが残り、依頼文の題名の不具合 (ハブの人が GitHub を切断すると local に戻る) も P1 の道では残る。
- B は決まりが1つで済む (つなぐだけでは決めない。「この設定で使う」が決める)。ハブと同じ形になる。C は接続の意味が状態で変わるので、説明とテストが増える。
- B で変わる動きは、接続してから「この設定で使う」を押すまでの間だけ。いまもこの間は GitHub に保存されていない
  (リポジトリが未選択で、再読込すると端末の中だけで動く = P1 段階3)。「決めた」扱いをやめても、保存のされ方は悪くならない。
- B・C は #596 の決まり (ADR-056 追補4) を変えるので、②の判断が要る。

## 切断の確認の文面の案 (docs/ui-standards.md §3: です・ます・用語は「保存先」「この端末のフォルダ」)

- 保存先が GitHub の時 (切断で local・印なしになる): いまの文面のまま。
  > GitHub との接続を切断しますか？
  > 接続情報を削除し、保存先を「この端末のフォルダ」に戻します。
- 保存先が GitHub でない時 (ハブ・この端末のフォルダ・まだ決めていない):
  > GitHub との接続を切断しますか？
  > 接続情報を削除します。本のデータの保存先は変わりません。
- 追加の案 (採るかは②の判断): 公開先が「自分の GitHub リポジトリ」の人には、上の2行目の後に
  「自分の GitHub リポジトリへの公開は、もう一度接続するまでできません。」を足す。

## 気づいたこと (範囲外・この step では直していない)

- 保存先が GitHub でリポジトリ未選択の人は、再読込の後、保存先セレクトが「この端末のフォルダ」を見せる (P1 段階3)。
  アプリが端末内の動作に落ちた時の内部の設定 (js/bookshelf.js:211-215) を表示に使っているため。案B なら新しくこの形になる人は出ない。
- 切断の後 (P1 段階4・P2 段階3) は、保存先セレクトがハブを見せ、ハブのログインも残るが、アプリは端末の中だけで動く。
  ハブのパネルには「ログイン済みですが、まだ本のデータの保存先になっていません」と出るはず (js/screens/settings.js:747-749・コード読みのみ)。
- 画面の操作でハブを保存先にした直後 (ログイン →「この設定で使う」→ 再読込) に `waitForHubStartupForTest` が終わらない件は、
  原因を調べていない。step2 で前提を画面の操作に寄せるなら、先にここを調べる。(→ step2 で原因が分かった。下の「起動待ちが終わらなかった原因」)

## step2 実装とテストの仕上げ (2026-11-14 14:43〜14:52)

②の決定 (step1 の tp): 直す範囲は案B。確認の文面は下のとおり。公開先が自分の GitHub リポジトリの人にだけ公開の注記を足す。

### 実装 (origin/main 029bf88 の上)

- `js/screens/settings.js` `_connectToGitHub`: `SyncConfigManager.setMethod('github', merged)` を `SyncConfigManager.save(merged)` に変えた。
  つないだだけでは method も決めた印も書かない。保存先を GitHub に決めるのは「この設定で使う」(`_saveGitHubRepo`・変更なし) だけ。
- 接続の後の知らせ: 「GitHub に接続しました (アカウント名)。／リポジトリを選んで「この設定で使う」を押すと、本のデータの保存先になります。」
  (1行目は元のまま。2行目を、次にやることと、押すと何が起きるかが分かる文にした)
- `js/screens/settings.js` `_disconnectGitHub`: 切断の前の method を読み、github の時だけ `resetMethod(merged)` (local・印なし)。
  それ以外は接続情報だけ空にして `save(merged)` = method も印も変えない (`_disconnectHub` と同じガードの形)。
- 切断の確認の文面:
  - 保存先が GitHub の人: 「GitHub との接続を切断しますか？／接続情報を削除し、保存先を「この端末のフォルダ」に戻します。」(元のまま)
  - それ以外の人: 「GitHub との接続を切断しますか？／接続情報を削除します。本のデータの保存先は変わりません。」
  - 公開先 (`bookshelf_sync.publish.target`) が github の人には、どちらの文面にも3行目
    「自分の GitHub リポジトリへの公開は、もう一度接続するまでできません。」を足す。公開先は `SyncConfigManager.load()` で読める
    (保存が無い時の既定は hub) ので、「読めずに判定できない」場合は無い。
- `js/sync-config.js`: コメントだけ直した (冒頭の methodChosen の説明・`setMethod`・`resetMethod`)。動きは変えていない。単体テストは足していない。
- `index.html`: `js/sync-config.js`・`js/screens/settings.js` の ?v= を 2026111596 → 2026111630 (origin/main 029bf88 の最大は 2026111600)。

### テスト (`tests/e2e/sync-github-disconnect.spec.js`・6本・chromium)

| # | 前提 | 操作 | 確かめること |
|---|---|---|---|
| 1 | ハブにログインして「この設定で使う」を押した人 (画面の操作で作る) | GitHub に接続 → 再読込 → 切断 | 接続の直後・再読込の後・切断の後のどれも method=hub・印あり・アプリはハブを使う・セレクトは hub。切断で GitHub の接続情報は消え、ハブの接続情報は残る。確認の文面は「保存先は変わりません」 |
| 2 | 決めた印が入る前からハブが保存先の人 (印なし・接続情報を置いて作る) | GitHub に接続 → 切断 | method=hub のまま。印は立たず、外れもしない |
| 3 | フォルダをつないだ人 (画面の操作で作る) | GitHub に接続 → 切断 | method=local・印あり・セレクトは local のまま |
| 4 | フォルダ未選択で「この端末のフォルダ」に決めた人・公開先は GitHub (設定を置いて作る) | 切断 | 印は残り、セレクトは local のまま。確認の文面に公開の注記が付く |
| 5 | 何も決めていない人 | GitHub に接続 → 再読込 → リポジトリを選んで「この設定で使う」 | 接続だけでは method=local・印なし・isConfigured=false。再読込の後、ホームの案内の手順1 は「保存先を選ぶ」のまま、セレクトは hub。「この設定で使う」で method=github・印あり |
| 6 | GitHub が保存先の人 | 切断 | method=local・印なし・isConfigured=false・セレクトは hub。確認の文面は元のまま |

- 修正後: 6 passed (27.7s)。
- 修正前の settings.js に一時的に戻して同じ6本を流した結果: 5 failed / 1 passed (1〜5 が赤・6 は元から正しい動きなので緑)。
  戻した後、修正版と一致することを cmp で確かめた。
- step1 の P2 (接続の後にハブの「この設定で使う」を押し直した人) は、案B では接続で method が変わらないので #1 と同じ状態になる。#1 にまとめた。
- 既存のテスト (前提は変えていない): `tests/e2e/gate/j1-3-connect-github.spec.js`・`j1-2-storage-choice-pc.spec.js`・
  `j1-2-storage-choice-phone.spec.js`・`tests/e2e/sync-chosen-mark.spec.js`・`tests/e2e/sync-first-connect.spec.js` を
  この5ファイルだけで流して 15 passed (7.3s)。J1-3 が見る知らせ「GitHub に接続しました (アカウント名)」は1行目を変えていないので、そのまま通る。

### ホームの案内の手順1 (js/dashboard.js `_computeSyncDone`)

- 判定は「保存先を決めていて (`isConfigured()`)、その保存先が実際に使える (hub は鍵・github はトークン・local はフォルダ)」。
  関数の説明にも「設定済みは実際に使える状態のときだけ」とある。
- 直す前: GitHub に接続しただけで method=github＋トークンありになり、再読込の後は「設定済み」になっていた。
  だがリポジトリが未選択で、本のデータは GitHub に保存されていない (step1 の P1 段階3)。
- 直した後: 接続だけでは「保存先を選ぶ」のまま。「この設定で使う」を押すと「設定済み」になる。関数の意図 (実際に使える時だけ済み) に合う動きになった。
  テスト #5 で、接続 → 再読込の後に手順1 のボタンが「保存先を選ぶ」であることを確かめている。
- ハブ・フォルダを保存先にしている人が GitHub をつないだ場合は、method が変わらないので手順1 の表示も変わらない。

### 起動待ちが終わらなかった原因 (テスト側の原因)

- ログイン →「この設定で使う」→ 再読込の後、ハブが空だと、起動時に確認の画面が出る:
  「Asayake ハブ には保存データがありません。／新規データで初期化しますか？／(別の端末・アカウントのデータがある場合は…)」。
  答えるまで上部の「最新のデータを確認しています…」が出たままなので、`waitForHubStartupForTest` が終わらない (調査用の spec で画面の状態を読んで確かめた)。
- アプリの決まりどおりの動き (空の保存先を勝手に初期化しない) で、不具合ではない。テスト #1 は、この確認に OK で答えてから起動待ちをする形にした。
  これで「ハブを保存先にする」前提も画面の操作で作れた。

### この step で流した検査 (全体の検証は step3)

- `lint:copy` (上限以内 119/119)・`lint:terms`・`lint:internal-refs` (上限 82 以内)・`lint:e2e-wait`・`lint:e2e-goto`・`lint:e2e-gate`: どれも OK。
- `node scripts/check-version-bump.mjs --range=origin/main..HEAD`: OK (変更した js はすべて ?v= を上げてある)。
- 起動時に保存先へつなげなかった時の案内 (js/bookshelf.js `_syncFallbackFrom`) は、ハブの時だけ専用の文になる。
  GitHub は直す前も後も共通の文なので、接続だけして再読込した人への案内は変わらない。

### 状態

- step1 の赤を含む commit は `git reset --soft origin/main` でほどき、修正・テスト・記録を1つの commit にまとめ直した (push していない)。
- 設計書 (03/06/08) は step4 で直す。ADR-056 追補4 の「GitHub 接続＝決める操作」を変えた経緯と理由は 08 の追補に書く。

## step3 検証一式 (2026-11-14 14:51〜15:02)

- 土台: origin/main 88f02ba に載せ直した (衝突なし。main 側で増えた5 commit は電波が戻った時の再同期 (#617) で、
  js/screens/settings.js・js/sync-config.js には触れていない)。自分の commit は1つ。
- index.html の ?v= は sync-config.js・screens/settings.js とも 2026111630 のまま。origin/main 88f02ba の index.html の最大は
  2026111601 で、2026111630 は origin/main に無い。

### e2e の main との差 (`scripts/verify/e2e-diff-main.mjs`)

- コマンド: `node scripts/verify/e2e-diff-main.mjs --port=8130 --out=/home/kuroko/worktrees/bookshelf/_artifacts/630-e2e-diff`
  (base = origin/main 88f02ba・work = 作業ツリー 06ae3c1。E2E 全件・vitest・画像比較。14:51:48〜15:00:44・約9分)
- E2E: 新しく落ちた 0件・新しく通った 0件・両方で落ちた 0件・判定不能 0件。
  - base: 975 passed・0 failed・0 flaky・594 skipped (211秒)。
  - work: 981 passed・0 failed・0 flaky・594 skipped (263秒)。増えた6本は新しい `sync-github-disconnect.spec.js`。skipped は両側で同じ数。
  - 除外は既定の sort-perf-budget の1件だけ (CI でも別に流す物)。
- vitest (両側): 1088 passed・0 failed・2 todo。新しく落ちた・通った・両方で落ちた とも 0件。
- 画像比較 (work 側): 54件中 0件が差分。
- 報告: `/home/kuroko/worktrees/bookshelf/_artifacts/630-e2e-diff/report.md`

### 単体 (`npm test`)

- 73 ファイル・1088 passed・2 todo (exit 0)。

### lint・check:version (どれも exit 0)

| 検査 | 結果 |
|---|---|
| lint:copy | OK (上限以内 119/119) |
| lint:terms | OK (table 1/1・jargon 0/0) |
| lint:css | OK |
| lint:e2e-goto | OK (136 ファイル・0件) |
| lint:e2e-wait | OK (137 ファイル・0件) |
| lint:breakpoint | OK |
| lint:esc | OK |
| lint:js-color | OK |
| lint:internal-refs | OK (上限 82 以内) |
| lint:e2e-gate | OK (@gate 35本・違反 0件・観測点の網羅 34/37。未達 J3-5・J5-1・J6-5 は main と同じ警告) |
| lint:known-red | OK (既知の赤 2件・違反 0件) |
| `npm run check:version -- --range=origin/main..HEAD` | OK (変更した js はすべて ?v= を上げてある) |

- 作業ツリーに書き込まない lint 8本と check:version は、e2e の差を流している間に流した。書き込む3本
  (lint:copy・lint:terms は `_local/` へ文言を書き出す・lint:e2e-gate は報告を書く) と npm test は、e2e の差が終わってから流した。

### 画像比較の基準画像 (tests/visual)

- GitHub の切断の確認の画面・接続中の GitHub のパネル・接続の後の知らせの基準画像は無い (該当なし・更新なし)。
- `tests/visual/screens.spec.js` で保存先に関わるのは「設定の1節」(`06-settings-section`) だけ。保存先セレクトと
  「この端末のフォルダ」のパネルを開いた形で、今回の変更 (接続・切断の処理と、操作した時にだけ出る知らせ・確認の文面) では見た目が変わらない。
  上の画像比較でも差分 0件。

## step4 設計書の更新・rebase・push 前の確認 (2026-11-14 15:02〜15:13)

### 設計書 (obsidian `80_🚀project/81_🚀development/bookshelf/`)

- 03_詳細設計書: SyncConfigManager の `setMethod` を呼ぶ操作から GitHub の接続を外し (「この設定で使う」だけ)、`_connectToGitHub` を決めない書き込みに入れた。
  `resetMethod` は「保存先だった接続を切った時」(GitHub の切断は method が github だった時・ハブの切断は method が hub だった時) に直し、
  保存先でない接続の切断は接続情報だけを消すことを書いた。設定画面のメソッド表の `_connectToGitHub` / `_disconnectGitHub` の行にも同じことを書いた。
- 06_データ仕様書 §同期設定 bookshelf_sync: 決める操作を「GitHub の「この設定で使う」」に直し、切断は保存先だった接続を切った時だけ印を外すこと・
  GitHub への接続が決めない書き込みであることを書いた。
- 08_意思決定記録: ADR-056 追補5 (経緯・決めたこと・理由・採らなかった案 C・合わせて変えた文面)。追補4 の「GitHub の接続＝決める操作」を変えた。
- 04_画面設計書・07_残検討事項: 該当の記述なし (「切断」はステータスバーの同期の状態のことで、GitHub の切断の確認の文面は書かれていない)。
- obsidian の commit: c6a0930a (3ファイル・6行足して5行消した)。作業前に vault の index と3ファイルに他の変更が無いことを確かめ、この3ファイルだけを stage した。

### rebase と流し直し

- origin/main が 88f02ba → 6dc2c04 に進んでいた (5 commit。#615・#623 の js/bookshelf.js・js/dashboard.js・index.html の ?v= 等)。衝突なしで載せ直した。
- ?v=: sync-config.js・screens/settings.js とも 2026111630。origin/main 6dc2c04 の index.html の最大は 2026111603 で、2026111630 は origin/main に無い。
- js/bookshelf.js に他イシューの変更が入ったので、e2e の差を流し直した:
  `node scripts/verify/e2e-diff-main.mjs --port=8130 --out=/home/kuroko/worktrees/bookshelf/_artifacts/630-e2e-diff-2` (15:03〜15:11)
  - E2E: 新しく落ちた 0件・新しく通った 0件・両方で落ちた 0件・判定不能 0件。base 993 passed / work 999 passed。どちらも 0 failed・0 flaky・594 skipped。
  - vitest (両側): 1088 passed・0 failed・2 todo。差 0件。画像比較 (work 側): 54件中 0件が差分。
- `npm test`: 73 ファイル・1088 passed・2 todo。
- lint 11本 (copy 119/119・terms・css・e2e-goto・e2e-wait・breakpoint・esc・js-color・internal-refs・e2e-gate・known-red) と
  `check:version --range=origin/main..HEAD`: どれも exit 0。
- 関係する spec (sync-github-disconnect・sync-chosen-mark・sync-first-connect) を単独で: 18 passed。
- bookshelf の fix の commit の件名に「(設計: 03/06/08 2026-11-14 更新)」を足した (HEAD が自分の commit であることと、amend の前後で木が同じことを確かめた)。

## step5 push と CI (2026-11-14 15:23〜15:52)

- push: `BOOKSHELF_ISSUE=630 git push origin d43320d:main` (4f1a19b..d43320d・15:50)。自分の commit 3つ:
  da523ff (fix)・e502ae6 (docs step4)・d43320d (chore ?v=)。他イシューの commit は混ざっていない。この記録はその後の docs の commit。
- 載せ直し: 6dc2c04 → 0300351 (#628・#631・#632) → 4f1a19b (#629・#633。js/ のアプリのコードは無し・tests と ci.yml・playwright.config.js)。衝突なし。
- ?v=: origin/main の最大が 2026111633 になり 2026111630 を上回ったので、sync-config.js・screens/settings.js を 2026111641 に上げた
  (chore の commit・main に無い値)。check:version --range=origin/main..HEAD は OK。
- e2e の差 (0300351 に対して・`--out=…/_artifacts/630-e2e-diff-4`): 機械が混んでいて (load average 45) work 側の E2E が 461 秒かかり、
  work 側だけ 10件が落ちた (保存先に届くのを待つ所の時間切れが中心)。流し直しの途中で、裏の実行の時間の上限 (15分) で止まった。
  落ちた5つの spec (book-memo-file-lifecycle・reimport-diff・save-failure-visible・shelf-file-delete・sync-offline-reconnect) を
  単独で流すと 68 passed (load average 15)。今回の変更 (GitHub の接続・切断) の経路を通らない spec で、混み具合による揺れと判断した。
  vitest・画像比較 (54件中差分 0) は差なし。
- 4f1a19b に載せ直した後: GitHub と保存先の決め方に関わる spec (門の j1-4-github-save-reload・j1-3-connect-github・j1-3-connect-hub・
  sync-github-disconnect・sync-chosen-mark) を流して 16 passed。#629 が足した J1-4 GitHub (接続→リポジトリを選んで「この設定で使う」→再読込) も、
  案B (保存先を決めるのは「この設定で使う」) のまま通る。
- CI: push の直後に checks のページの HTML を読んだ結果は、提出の報告に書く (5分の待ちの範囲・残りは②の確認)。
