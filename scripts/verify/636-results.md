# #636 本を足した直後の短文メモ欄・記事の引き出し（空の保存先）

## step1 #633 で埋まっていない所を本物の操作で確かめる（2026-11-14 15:19〜15:33）

コードは変えていない。アプリは origin/main の最新（0300351）。本番への通信は0（ハブは tests/e2e/helpers/gate-hub.js の模擬、ローカルのフォルダは OPFS）。#633 の worktree には書き込んでいない。

### 結論

- **短文メモ欄は、今の main では出る。** 本物の操作（設定→蔵書→手で追加）で本を足した後、カードを押す道と `#book/<asin>` の道の両方で出た。
  - G1（空のハブ・遅延あり・読込の前に足す）：6回中6回
  - L2（空のローカルフォルダ・書込の遅延あり・読込の前に足す）：6回中6回
  - L1（保存先なしの真の初回）：7回中7回
  - G1 では、ハブの library.json にも本が残った（G1R・G1W で確認）。
- **記事の引き出しは、今の main でも0件になる場面が残っている（再現した）。**
  - 起きる条件：空の保存先の初期化の途中に本を足し、読込が終わってから保存が終わるまでの間に、公開→新規記事を開く。
  - この時、引き出しは0件で畳まれたままになる。15回中15回（ハブ：G1 6回・G1R 1回・G1T 1回、ローカルフォルダ：L2 6回・L2R 1回）。
  - 同じ手順でも、保存が終わってから記事を開けば出る（G1W・L2W とも1回中1回）。
  - G1R では、開き直すと出た（依頼文の「新しい画面で開き直すと通る」と同じ）。
  - #633 の m3・m7（今の main で通った回）と canary の pick-book は、保存の完了を待ってから記事を開いていた（canary の ensureCanaryBook は追加の直後に waitSaved する）。そのため、この間に当たらなかったと読める。
- **L1（保存先なし）の引き出しは流せなかった。** 公開の一覧に「新規」（#art-new）が出ず、記事を作れない。見本の蔵書を入れた端末（C0・保存先なし）でも同じ。
  - L1 では左のツリーが「本棚がありません」で、「すべての本」の本棚がメモリに無い（shelves=[]・books=1・bookOrder.all=1）。

### 手順（共通）

1. 新しいブラウザのコンテキストで、空の保存先から始める。
   - G1：`seedHubLoginForTest(page, hub, { method: 'hub', library: false })`→`mockHubForTest`。さらにページに route を足し、/data/* への書込を1900ms、読取を280ms 遅らせる（#633 の本番に近い値）。「…新規データで初期化しますか？」で OK を押す。
   - L2：`stubFolderPickerForTest` で空の OPFS フォルダを返す。`FileSystemWritableFileStream.close` を1900ms 遅らせる。`selectObsidianFolder()` を待たずに呼ぶ。
   - L1：何も入れずに index.html を開く。
2. 本物の操作で本を1冊足す：設定（蔵書）→「手で追加」(#add-book-manually)→ASIN・タイトル→「追加する」(#add-manually)→「書籍を追加しました」→閉じる→Esc。
   - G1・L2 は、読込が終わる前に足し終えている。全回で、足し終えた時点の `_lastLoadDecision` は null。読込が終わった後は local（手元を採った）。
3. 開き直さずに、短文メモ欄を確かめる。
   - card：ホームの「最近追加した本」の本を押す。
   - hash：`location.hash = '#book/<asin>'`。
   - どちらも `.note-textarea[data-asin][data-scope="all"]` が10秒以内に見えるか。
   - 保存先なしの初回は左のツリーに「すべての本」が無いため、3つの保存先とも card はホームの部品から押した。
4. 開き直さずに、記事の引き出しを確かめる：#sidebar-publish→#art-new→題→（#art-fs-done・#art-mode-edit が見えれば押す）→足した本の `.art-drawer-item` が10秒以内に見えるか（canary の pick-book と同じ道）。
5. 保存先に本が残るか：ハブの private/library.json、またはフォルダの private/library.json に ASIN が入るまで待つ。

### 表1：短文メモ欄（今の main・本物の操作・1回目だけ）

| 保存先 | 道 | 回数 | 結果 | 本を足し終えた（ms） | 読込が終わった（ms） |
|---|---|---|---|---|---|
| G1 空のハブ（遅延あり） | card | 3 | 3回とも出た | +3,298〜3,371 | +18,935〜18,995 |
| G1 空のハブ（遅延あり） | hash | 3 | 3回とも出た | +2,212〜3,221 | +17,979〜18,986 |
| L2 空のローカルフォルダ（書込遅延） | card | 3 | 3回とも出た | +387〜1,367 | +13,460〜14,448 |
| L2 空のローカルフォルダ（書込遅延） | hash | 3 | 3回とも出た | +682〜863 | +13,588〜13,715 |
| L1 保存先なし | card | 3 | 3回とも出た | +410〜416 | （読込なし） |
| L1 保存先なし | hash | 4 | 4回とも出た | +336〜911 | （読込なし） |

時刻は G1 が「初期化の確認の OK」から、L2・L1 は始めてからの ms（`_local/636/runs/round1-results.jsonl` ほか）。

### 表2：記事の引き出し（今の main・本物の操作・開き直さない）

| 回 | 保存先 | 記事を開いた時機 | 引き出し | 開き直した後 |
|---|---|---|---|---|
| G1-card ×3・G1-hash ×3 | 空のハブ | 読込の直後（保存の途中） | **0件 6/6** | – |
| G1R | 空のハブ | 読込の直後（+19.2秒・ハブに本が届いたのは +30.0秒） | **0件** | 出た（1件） |
| G1W | 空のハブ | 保存の完了の後（+26.4秒） | 出た（1件） | – |
| G1T | 空のハブ | 読込の直後（+19.9秒） | **0件**（保存の完了後も0件のまま） | – |
| L2-card ×3・L2-hash ×3 | 空のフォルダ | 読込の直後（保存の途中） | **0件 6/6** | – |
| L2R | 空のフォルダ | 読込の直後（+13.9秒・フォルダに本が届いたのは +24.4秒） | **0件** | **0件**（下の未確認2） |
| L2W | 空のフォルダ | 保存の完了の後（+42.6秒） | 出た（1件） | – |
| C1（対照） | ハブに見本5冊 | 起動の読込の後 | 出た（5件） | – |
| L1 ×7・C0（対照） | 保存先なし | – | 流せない（#art-new が出ない） | – |

0件の回の、落ちた時点の状態（G1R・L2R。`_local/636/runs/round3-results.jsonl`）：
- 引き出しの元の本棚＝下書きの sourceShelfId（すべての本・isSpecial）が見つかる。その books は1冊で、`_artDrawerFilteredAsins()` も1冊。
- それでも `.art-wrap` に `art-drawer-collapsed` が付き、`#art-drawer-list` は空で見えていない。
- ＝引き出しを描いた時点では本棚の books が0冊で、後から1冊になっても描き直されていない、と読める（未確認1）。
- pageerror は0件。console error はハブの模擬の 404（存在しないファイルの読取）のみ。

### 原因の手がかり（G1T・1回の観測・`_local/636/runs/results.jsonl` の G1T-hub-none-0）

読込の直後と、記事を開いた瞬間の値（「すべての本」＝`userData.bookshelves` の isSpecial の本棚）：

| 時点（OK からの ms） | 「すべての本」の本棚 | bookOrder.all | 引き出し | 保存中 |
|---|---|---|---|---|
| 本を足し終えた（+3,113） | **無い** | 1冊 | – | はい |
| 読込が終わった・手元を採った（+18,904） | **無い** | 1冊 | – | はい |
| 記事を開いた（+19,921） | **無い** | 1冊 | 0件・畳まれた | はい |
| 保存が終わった（+25,872） | 1冊（ここで作られた） | 1冊 | **0件のまま**（描き直されない） | いいえ |

- 空の保存先から始めると、手元の userData には「すべての本」の本棚が無い。保存先の initEmpty は all.json を書く（js/storage.js:299-325）が、読込で手元を採った（`_keepLocalOverLoaded`・js/bookshelf.js:2905・#602）ので、保存先の「すべての本」はメモリに入らない。
- メモリに「すべての本」ができるのは、最初の保存の書き出し `_prepareSyncEntries` で「無ければ作る」時（js/bookshelf.js の `if (!this.userData.bookshelves.some(b => b.isSpecial)) { this.userData.bookshelves.unshift(...) }`）。
- その間に記事を開くと、`_artResolveSourceShelfId()` は「すべての本→先頭の本棚→null」と探して本棚が無い（js/screens/article-editor.js:2628-2640・#155 のコメントの「真の初回は isSpecial 本棚が無いことがある」）。引き出しは0件で畳まれる（同:2873-2880）。
- 後から本棚ができても、開いている引き出しは描き直されない（保存の完了後も0件）。
- L1（保存先なし）は、保存先へ書かないため「すべての本」が作られないまま（shelves=[]）。上と同じ状態が続いている。
- 1回の観測で、行ごとの時刻の確定（どの呼び出しで作られたか）はしていない。

### 未確認（step2 で確かめる）

1. 原因の確定。上の手がかりは1回の観測。直し方（「すべての本」を初回からメモリに必ず持つ／引き出しを本棚の変化で描き直す／`_artResolveSourceShelfId` の行き先）と、同じ種類の箇所（「すべての本」が無い時に空に見える画面）の洗い出しは step2 で行う。
2. L2R で、開き直した後も0件だった理由。開き直した後の待ちが「手元の books に本がある」だけで、フォルダからの起動の読込の完了は待っていない。起動の読込の途中に記事を開いた、同じ種類の間の可能性がある（未確認）。
3. 本番の速さで、この間に記事を開けるか。ハブで約7〜11秒（読込の完了から保存の完了まで）。利用者が初期化の直後に本を足し、すぐに公開→新規記事へ進んだ時に当たる。
4. L1（保存先なし）の初回は、メモリに「すべての本」の本棚が無い（shelves=[]）。記事が作れないので引き出しへの影響は見えないが、ほかの画面への影響は見ていない。

### 流せなかった組み合わせ

- L1 の引き出し：保存先・公開先なしでは、公開の一覧に「新規」が出ない（#art-new を15秒待って出ない。C0 の対照も同じ）。
- GitHub の空の保存先：対象外（step の範囲外。#633 が direct で各1回流している）。

### #633 の「ほかに見えたこと」（申し送りのみ）

- 初期化が2回走る件と、状態の欄が「保存できませんでした」になる件は、今回見ていない。②の判断どおり step2 の報告に申し送る。

### 置き場

- 試験用の spec：`_local/636/_probe636.spec.js`（未commit。tests/e2e から外へ移した。流す時は tests/e2e へ戻して `PORT=8136 PLAYWRIGHT_BASE_URL=http://localhost:8136 node node_modules/.bin/playwright test tests/e2e/_probe636.spec.js --project=chromium --grep "<名前>"`）。
- 回ごとの記録：`_local/636/runs/*.jsonl`（1行1回。t＝段ごとの時刻、final・snap1st＝落ちた時点の状態、drawer1st の文に引き出しの内部の値）。
- 画像：`_local/636/runs/*.png`（G1R-drawer-1st.png＝0件で畳まれた画面、G1R-drawer-after-reopen.png＝開き直した後、C1-drawer.png＝対照）。

## step2 判定と、直し方・回帰テストの持ち方（2026-11-14 15:37〜15:45）

コードは変えていない（案Aの確かめは、ページの中で値を置いただけ）。アプリは origin/main の最新（4f1a19b。js/・index.html は step1 の 0300351 から変化なし）。

### 判定

- 計画の「どれか落ちた場合」に当たる。記事の引き出しが、今の main でも0件になる（step1：15/15）。短文メモ欄は今の main で出る（step1：19/19）。
- #633 も同じ不具合を step3 で見つけ、直すかどうかを②の判断に回していた（origin/main の scripts/verify/633-results.md「途中で見つけた別の不具合」）。#633 の spec（tests/e2e/first-run-add-article-drawer.spec.js・3072cb9）は、この不具合を避けるため「最初の保存が済んでから記事の画面を開く」順にしてある。そのため、この不具合は今の回帰テストでは捕まらない。
- canary の直呼びは原因ではない。canary は変えない（#633 と同じ）。

### 原因（1つに確定）

**初めての利用者の手元の userData には「すべての本」（isSpecial の本棚）が無い。メモリに作るのは、最初の保存の書き出しの1か所だけ。その前に記事の画面を開くと、引き出しの元の本棚が見つからない。**

1. 手元の userData の始まり：起動時、端末にデータが無ければ `createDefaultUserData()` で作る（js/bookshelf.js:515・定義は L2725-2735）。`bookshelves: []`＝「すべての本」が無い。
2. 空の保存先を初期化して読み込むと、手元に本があれば手元を採る（#602・`_decideLoadedState` L2879 → `_keepLocalOverLoaded` L2905-2915）。`_keepLocalOverLoaded` は `_storage.allInternalId` だけを保存先の値にし（L2909）、保存先の「すべての本」はメモリに入れない。
3. メモリに「すべての本」を作るのは、保存の書き出しの「無ければ作る」（L3776-3786）だけ。
4. 冊数が変わった時の揃え直し `_onLibraryChanged()`（L4099-4104）は、「すべての本」が無いと何もしない。
5. 記事の画面は、開いた時に引き出しの本棚を決める。`_artResolveSourceShelfId()`（js/screens/article-editor.js:2628-2640）は、すべての本→先頭の本棚→null の順に探す。本棚が1つも無いので null。`_artRenderDrawer()`（同:2863-2880）は本0冊として畳む（L2875）。
6. 保存で「すべての本」ができた後も、開いている引き出しは描き直さない。

落ちた時の値（step1 の G1T。OK からの ms）：

| 時点 | 「すべての本」 | bookOrder.all | 引き出し |
|---|---|---|---|
| +3,113 足し終えた | 無い | 1冊 | – |
| +18,904 読込（手元を採った） | 無い | 1冊 | – |
| +19,921 記事を開いた | 無い | 1冊 | 0件・畳まれた |
| +25,872 保存が終わった | 1冊（L3776 で作られた） | 1冊 | 0件のまま |

（#633 の診断も同じ形：開いた直後・保存の後とも「(本棚がありません)」で畳まれ、開き直すと「すべての本」1件。）

### 同じ種類の箇所（「すべての本」がメモリに無い時の扱い・grep で全数）

「すべての本」が無い時のための個別の手当てが、すでに2か所ある：
- ホームの本棚の概観（js/dashboard.js:994-1004）：無ければ擬似の本棚「全ての本」を合成する。
- 記事の画面（article-editor.js:2631-2637）：#155 のコメントで「真の初回は isSpecial 本棚が無いことがある」とし、先頭の本棚へ逃がす。

| 箇所 | 無い時の挙動 | 影響 |
|---|---|---|
| 記事の引き出し（article-editor.js:2628-2640・2863-2880） | null → 0件で畳む | **今回の不具合** |
| 冊数の揃え直し `_onLibraryChanged`（bookshelf.js:4099-4104） | 揃え直しを飛ばす | 上の原因の一部 |
| 左の本棚ツリー（js/screens/bookshelf-list.js） | 「本棚がありません」 | 保存先なしの初回（L1）で実測。保存の後に本棚ができても、描き直すまで出ない疑い（未実測） |
| ホームの本棚の概観（dashboard.js:994-1004） | 擬似の「全ての本」を合成 | 名前が本物（「すべての本」）と違う |
| 一括操作・絞り込み・表示（bookshelf.js:1594・2343・2628） | 「無い＝すべて」として扱う | 影響なし（読んだだけ） |
| 本棚の作成・移動の既定の親（bookshelf-manager.js:149-150・233・256 `getAllInternalId()`） | `_storage.allInternalId` が無いと親が未定 | 保存の時に補われる（読んだだけ・未実測） |
| 公開の書き出し（publish-article-generator.js:486） | 保存先の state を読む | 影響なし（読んだだけ） |

### 直し方の比較

| 案 | 中身 | 直る範囲 | 変更量 | 注意 |
|---|---|---|---|---|
| **A（推奨）** | 「すべての本」をメモリに必ず持つ決まりを、**1つの関数 `_ensureAllShelf()`**（bookshelf.js・新設）にまとめる。中身は3つ：無ければ作る／id を `_storage.allInternalId` と揃える（無ければ作って記録）／books を `bookOrder.all` と同じ配列にする。手元の userData が決まる所すべてから呼ぶ：起動時（L506-516）・`_keepLocalOverLoaded`（L2905）・保存の経路で保存先を初期化し id を入れ直す所（L3682-3690）・書き出しの「無ければ作る」（L3776-3786 を置き換える）・`_onLibraryChanged`（L4099）。 | 記事の引き出し・揃え直し・ツリー・ホームの概観が、初回から同じ本物の本棚を見る | bookshelf.js の1関数と呼び出し5か所程度 | 下の「案A の確かめ」の id の食い違いを必ず揃えること。保存先なしの初回（L1）でも、左のツリーに「すべての本」が出る／ホームの概観の名前が「全ての本」→「すべての本」になる＝**画面の変化**（step3 の tp で画像で見せる） |
| B | 開いている引き出しを、本棚・蔵書の変化で描き直す | 引き出しだけ | 小 | 「すべての本」が無い状態は残る（ツリー・揃え直しは直らない）。個別の手当て |
| C | `_artResolveSourceShelfId` で、本棚が無い時は `bookOrder.all` を仮の本棚として返す | 引き出しだけ | 小 | ホームの擬似合成と同じ型の個別の手当てが3つ目になる＝bookshelf の決まり（個別の症状をすぐ直さない）に反する |

- 推奨は **A**。B は「記事を開いている間に本が増える」別の場面の手当てとしては意味があるが、このイシューの再現には要らない（案A の確かめで、B 無しで通った）。
- ホームの擬似合成（dashboard.js:1004）と、記事の画面の逃がし（article-editor.js:2636-2637）は、A の後は通常は通らない。このイシューでは消さずに残す（守りとして無害）。消すかは②の判断。
- コア境界原則（ADR-041/042）：プラグインの差し込み口の話ではなく、コアの初期状態の不具合の修正。保存の形式（private/ のファイル）は変えない。

### 案A の確かめ（アプリを変えず、ページの中で模擬・G1F・1回）

初期化の確認で OK を押した直後に、ページの中で「すべての本」をメモリに置いた（books＝bookOrder.all と同じ配列・id は仮の値）。その後、本物の操作で本を足した。

| 時点 | 「すべての本」 | 引き出し |
|---|---|---|
| +4,504 足し終えた | 1冊（bookOrder.all と同じ配列） | – |
| +5,522 記事を開いた（読込の前・保存の前） | 1冊 | **出た（1件）** |
| +26,996 保存が終わった | 1冊 | 出た（1件） |

- ただし **id が食い違った**：ハブの bookshelves.json の「すべての本」は `simjkhpee`（メモリと同じ）、all.json の internalId は `3ph766uz`。
- 原因：保存の経路が保存先を空と見て、もう一度 initEmpty を呼び、新しい id を `_storage.allInternalId` に入れ直す（L3682-3684。#633 の「初期化が2回走る」と同じ所）。書き出しは all.json にその id、bookshelves.json にメモリの本棚の id を書く。
- → A の関数は、`_storage.allInternalId` を入れ直す所（L2909・L3684・L3690）の後にも呼び、メモリの本棚の id を揃える。step3 の spec で「bookshelves.json と all.json の『すべての本』の id が同じ」を確かめる。
- 今の main（A なし）は、書き出しの時に同じ id で作るので、この食い違いは無い＝**A を入れて新しく生まれうる不具合**。

### 回帰テストの持ち方（step3）

- 新しい spec：`tests/e2e/first-run-drawer-before-first-save.spec.js`（仮）。#633 の spec と場面が違う（あちらは保存の後に開く・こちらは保存の前に開く）ので、2本でも重ならない。共通の手順（初期化の書き込みを止める型・本物の操作での追加）は #633 の spec に合わせる。
  1. ハブ：初期化の書き込み（PUT /data/*）を止めたまま、OK→本物の操作で本を足す→公開→新規記事→引き出しに足した本が出る。止めている間は読込も保存も起きない＝機械の速さによらず「最初の保存の前」になる。その後、止めを外す→読込・保存を待つ→保存先の bookshelves.json と all.json の「すべての本」の id が同じ・library.json に本がある・引き出しに出たまま。
  2. ローカルのフォルダ：同じ形（書き込みの close を止める）。
  3. 短文メモ欄：上の2つの中で `#book/<asin>` の道も見る（今の main でも緑。依頼の2つ目の症状を固定する）。
- 赤と緑：今の main で 1・2 が引き出しで赤になることを先に確かめ、A を入れて緑にする。
- 回帰：#633 の spec・dashboard-stats-after-manual-add・sync-offline-reconnect・門の J1 系・visual（左のツリーとホームの初回の見た目）、e2e-diff-main（全件・約8分。コアの初期状態を変えるため）。

### 触るファイル（申告し直し）

- js/bookshelf.js（`_ensureAllShelf` の新設と呼び出し）
- index.html（bookshelf.js の ?v=。sw.js の先読みは #597 の決まりで確かめる）
- tests/e2e/first-run-drawer-before-first-save.spec.js（新規・仮名）
- tests/visual の基準画像（初回の画面が対象なら・#524）
- scripts/verify/636-results.md
- 設計書：03_詳細設計書（新しい関数）。CLAUDE.md の決まりで、同じ作業の中で更新する。
- 触らない：js/screens/article-editor.js・js/dashboard.js（案A の後も今のまま）・canary・gate-hub.js・gate-local.js

### #633 の「ほかに見えたこと」（申し送りのみ・#636 では直さない）

- 初期化が2回走る（保存の経路の L3682）。案A の確かめでは、これが id の入れ直しの元になっていた。A は id を揃えるだけで、2回走ること自体は直さない。
- 初期化の間、状態の欄が「保存できませんでした」のまま。

## step3 案A の実装と回帰テスト（2026-11-14 15:54〜16:12）

commit：`65990ba`（branch issue/636・未push）。origin/main の eef77b5 に載せ直し済み。載せ直しの衝突は index.html の `?v=` の1行だけで、こちらの値を採った。

### 変えたもの

- js/bookshelf.js：`_ensureAllShelf()` を新設した。
  - 「すべての本」が無ければ作る（books は bookOrder.all と同じ配列）。
  - ある時はその id を `_storage.allInternalId` に揃える。`_storage` が無い時は作らない。
  - 呼ぶ所は5つ：起動時（端末の userData を読んだ直後）、`_keepLocalOverLoaded`、`syncToObsidianFolder` の書き出しの前、書き出しの「無ければ作る」（置き換え）、`_onLibraryChanged`。
- index.html：bookshelf.js の `?v=` を 2026111660 にした（main の最大値 2026111651 より新しい）。
- tests/e2e/first-run-drawer-before-first-save.spec.js（新規）：空のハブ・空のフォルダの2本。
  - 初期化の書き込みを止めたまま、本物の操作で本を足す。
  - 短文メモの欄（ホームの「最近追加した本」から）と、記事の引き出しに本が出ることを確かめる。
  - 止めを外した後、保存先に本が残ること、bookshelves.json と all.json の「すべての本」の id が同じことを確かめる。
  - アプリの内部は読まない。gate-hub.js・gate-local.js の本体は変えない。
- 設計書 03_詳細設計書：`_ensureAllShelf()` の行を足し、`_keepLocalOverLoaded`・`_onLibraryChanged` の行を今の挙動に直した（vault は自動の控えが commit する）。
- 触っていない：js/screens/article-editor.js・js/dashboard.js（②の指示どおり）・canary・gate-hub.js・gate-local.js。

### 赤と緑（新しい spec）

| 版 | ハブ | フォルダ | 回数 |
|---|---|---|---|
| 直す前（e7f5e0d＝当時の main） | **赤**（引き出しで：`.art-drawer-item[data-asin="B0FIRSTDR1"]` が10秒出ない） | **赤**（同じ所） | 各1回 |
| 直した後（e7f5e0d＋直し） | 緑 | 緑 | 各3回（6/6） |
| 直した後を eef77b5 に載せ直した版（65990ba） | 緑 | 緑 | 各3回（6/6） |

- 短文メモの欄は、直す前でも出た（両方とも引き出しの手前の確認は通った）。

### 回帰の確認（65990ba）

- 関係する E2E 13本（chromium）：45件すべて緑。内訳は次のとおり。
  - #633 の first-run-add-article-drawer、dashboard-stats-after-manual-add、sync-offline-reconnect、sync-first-connect
  - 門の j1-1・j1-2-storage-choice-pc・j1-3-connect-hub・j1-3-connect-local・j1-4-github-save-reload
  - #612 が足した hub-save-changed-only・hub-merge-items・hub-cross-file-drift・shelf-file-delete
- vitest：75ファイル・1114件が緑（todo 2）。
- lint：e2e-goto・e2e-wait・breakpoint・esc・js-color・internal-refs（上限82以内）・e2e-gate `--strict-coverage`（違反0・網羅37/37）・known-red が、すべて OK。
- check:version `--range=origin/main..HEAD`：OK。sw.js に bookshelf.js の `?v=` の記載は無い（grep 0件）。
- e2e-diff-main（全件・origin/main eef77b5 と比べる）：結果は下の「e2e-diff の結果」に書く。

### 画面の変化（②の受け入れ済み・前後の画像）

- 保存先なしの初回に本を1冊足した後のホーム：`_local/636/shots/before-L1-home.png`（左のツリー「本棚がありません」）→ `_local/636/shots/after-L1-home.png`（左のツリー「すべての本 1」）。「本棚数」は 0 のまま（自分で作った本棚だけを数える）。
- 本棚ハイライト（ホームの本棚の概観）の前後の画像は、撮れなかった。部品の取り方（並びの7番目）と、一時のサーバの番号の取り合いで、2回とも失敗した。
  - 見込み：直す前は、擬似の「全ての本」（dashboard.js:1004）を合成して出す。直した後は、本物の「すべての本」が出る（名前の表記が「全ての本」→「すべての本」）。
  - step4 の前に撮って添える。

## step4 載せ直し・push 前の確認・push・CI（2026-11-14 16:19〜）

### 載せ直し

- origin/main が step3 の後に進んでいた（#635 が js/bookshelf.js・index.html を変えた・#642 のテスト）。2回載せ直した。最後は d92709f の上の **0065d18**。
- 衝突は無かった。ただし #635 が main で bookshelf.js の `?v=` を 2026111660（こちらと同じ値）にしていたので、こちらは **2026111672** に上げ直した（main の最大値 2026111660 より新しい）。
- origin/main との差は自分の3ファイルだけ（index.html 1行・js/bookshelf.js・新しい spec）。

### push 前の確認（0065d18）

- check:version `--range=origin/main..HEAD`：OK。
- lint：e2e-goto・e2e-wait・breakpoint・esc・js-color・internal-refs（上限82以内）・e2e-gate `--strict-coverage`（違反0・網羅37/37）・known-red が、すべて OK。
- 新しい spec（ハブ・フォルダ）と #633 の spec：各3回で 9/9 緑。
- 本棚ハイライトの前後の画像：省いた（step3 で3回試して、部品の取り方と一時サーバの取り合いで撮れなかったため・②の判断で必須にしない）。

### e2e-diff-main（0065d18 と origin/main d92709f・全件）

- 新しく落ちた 3件：
  - **regression 1件（自分の変更が原因）**：`publish-article-editor.spec.js` の「記事エディタ: 本棚ブロックの shelfId 解決 (イシュー#155) > 本棚が1つも無い状態では「本棚」ブロックの追加メニューが無効化され、追加できない」。
  - flake 2件（再試行で通った）：gate/j2-2-import-paste・gate/j2-5-import-no-duplicate。
- 新しく通った：gate/j3-5-many-books（時間を測るテスト・負荷による揺れ）。
- vitest：新しく落ちた 0件。画像の差分：0件 / 54件。
- 記録：`_local/636/e2e-diff3/report.md`・`_local/636/e2e-diff3.log`。

#### regression の中身（1回流し直して確かめた・16:33）

- 落ち方：`expect(shelfItem).toBeDisabled()` が「Expected: disabled / Received: enabled」（tests/e2e/publish-article-editor.spec.js:2474）。
- 前提：`bootAppNoShelves`（同:114-128）は、端末の userData の `bookshelves` を空にして起動する（本はある）。
- 直した後は、起動時に `_ensureAllShelf()` が「すべての本」を置くので、この前提（本棚が1つも無い）がアプリの中では起きない。そのため「本棚」ブロックは押せる（#155 の守り＝記事の画面の「本棚がまだ1つもありません」で押せなくする処理は、通らなくなる）。
- #155 が守りたかったのは、`shelfId:null` の本棚ブロックを作らないこと。直した後は、本棚ブロックの入れ先が「すべての本」になり、null にはならない見込み（未実測）。

→ **push していない**（②の条件「新しい落ちが0件」を満たさないため）。②の判断を仰ぐ。

### step4 やり直し（②の決定 (1)・2026-11-14 16:37〜）

#### #155 のテストを今の決まりに合わせて書き換えた（commit 0609b23）

- tests/e2e/publish-article-editor.spec.js の「本棚が1つも無い状態では『本棚』ブロックの追加メニューが無効化され、追加できない」を、「端末の本棚データが空でも『すべての本』が入れ先になり、本棚ブロックを shelfId:null で作らない」に書き換えた。
- 前提は同じ（`bootAppNoShelves`＝端末の本棚データが空・本はある）。操作は既存の #155 のテストと同じ（`openPublishPagesModal`→`#art-new`→`addBlock(page,'shelf','first')`）。
- 確かめること：
  - (a) 本棚ブロックを足せる（ブロックは shelf が1つ）。
  - (c) 引き出しの本を押すと、そのブロックに本が出る（`.art-shelf-item` 1件）。
  - (b) 保存した記事の本棚ブロックの shelfId は、null でなく「すべての本」の id。保存先の all の id（`_storage.allInternalId`＝`bookshelfManager.getAllInternalId()`）を持つ時は、それとも同じ。
- 実測（16:38）：shelfId=`fixall001`・「すべての本」の id=`fixall001`・`_storage.allInternalId`=`fixall001`（3つとも同じ・null ではない）。
- 記事の画面の守り（本棚が無い時に押せなくする処理）は、指示どおり残した（article-editor.js・dashboard.js は触っていない）。

#### 載せ直し（2回）

- 1回目：#614（25b9472）が bookshelf.js の `?v=` を 2026111661 にしていた。こちらの 2026111672 を採った。
- 2回目：#643 の push（eb316db まで）が bookshelf.js の `?v=` を 2026111682 にしていた。こちらを **2026111690** にした（main の最大値 2026111682 より新しい）。js/bookshelf.js は自動で重なった（`_ensureAllShelf` の呼び出し5か所は残っている）。
- 最後の版：fix **1b5e7ba**・test **0609b23**（origin/main eb316db の上）。main との差は4ファイル（index.html 1行・js/bookshelf.js・新しい spec・publish-article-editor.spec.js）。

#### push 前の確認（0609b23）

- check:version `--range=origin/main..HEAD`：OK。lint 8本：すべて OK。
- 新しい spec 2本・#633 の spec・#643 の spec（first-run-save-during-init-empty）・書き換えた #155：各3回で 15/15 緑。
- e2e-diff-main：下に書く。

#### e2e-diff-main（0609b23 と origin/main eb316db・全件・16:40〜16:53）

- **新しい落ち 0件**（「新しく落ちたテストは0件(またはフレーク判定/判定不能のみ)」・exit 0）。
- 新しく落ちた表の3件は、すべて再試行で通った揺れ：gate/j2-5-import-no-duplicate・gate/j3-5-many-books・reimport-diff（#406）。
- #155 の書き換えたテストは落ちていない。vitest の新しい落ち 0件。
- 記録：`_local/636/e2e-diff4/report.md`・`_local/636/e2e-diff4.log`。

#### push の前の最後の確認（②の条件 (i)〜(iii)・origin/main 985e770 の上の e2cc01c・abc65de・6ce207a）

- (i) 全件比較（eb316db に対して新しい落ち0件）の後に main が進んだ分（eb316db→985e770・#639 ほか）と、自分の変更が同じ関数の中に触れていないかを、変わった行の入っているメソッド名で比べた（`_local/636/fn-of-diff.mjs`）。
  - main が進んだ分：_askLoadConflict・_clearSyncFailure・_initStatusBar・_onSyncFailed・_resolveSyncHold・_runPendingSync・_runPublishExport・_syncFailureRow・**syncToObsidianFolder**・updateSyncStatus（ほかに js/screens/settings.js・js/sync-failure.js）。
  - 自分の変更：_ensureAllShelf・_keepLocalOverLoaded・_onLibraryChanged・loadData・**syncToObsidianFolder**・updateBookshelfSelector（_ensureAllShelf を置いた前後の行）。
  - **syncToObsidianFolder が重なる** → (i) を満たさない → ②の決まりどおり、全件比較をやり直した（下）。
- (ii) check:version `--range=origin/main..HEAD`：OK。lint の集約（scripts/run-lint.mjs・#619）：「12 本中 0 本失敗」。vitest：77ファイル・1156件が緑（todo 2）。
- 全件比較のやり直し（6ce207a と origin/main 985e770・16:56〜17:06）：**新しく落ちた 0件**（E2E・vitest とも）。画像の差分 0件 / 54件。記録：`_local/636/e2e-diff5/report.md`。
- 新しい spec 2本と書き換えた #155：各3回で 9/9 緑。
- (iii) は、全件比較のやり直しで main が進んだ分の spec（#639 の load-conflict-unsaved など）も含めて流れたので、それで確かめた。
