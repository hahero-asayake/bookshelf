# #633 本を足した直後に記事の引き出しが0件になるかの切り分け

## まとめ（step5 で仕上げ）

- **原因：アプリの不具合だった（canary が処理を直接呼ぶことは原因ではない）。** 空の保存先で「新規データで初期化しますか？」の OK を押してから、初期化の書き込み→読込が終わるまでの間に足した本を、後から届いた空の読込（`_applyLoadedState`）が消していた。引き出しが0件になり、保存先にも残らない。この間、画面の操作は塞がれていない（step1）。
  - 足し方（直接呼ぶ／本物の操作）では分かれず、読込との前後だけで分かれた。遅延0ではこの間が0.2〜0.5秒しか無く、直接呼ぶ canary だけが間に合っていた。本番に近い遅延なら本物の操作でも3回中3回再現（step1）。
  - 条件を1つだけ変えると結果が逆になる実験を2つ行った（足す時機・アプリの版。step2）。
- **直したもの：** アプリは #602 の **029bf88**（読込の時、保存先が空で手元にデータがあれば手元を採る）で直っていた。このイシューではアプリも canary も変えていない。
- **このイシューで足したもの：** この場面を固定する E2E 1本（`tests/e2e/first-run-add-article-drawer.spec.js`）。直す前の版（f6dd65a）で赤・main で緑（step3）。
- **直す前後の比較：**
  - 直す前は、空の保存先からの1回目が毎回 pick-book（公開）・edit-memo（保存）で落ちていた。
  - 直した後は、観測を足していない canary が、遅延0・本番に近い遅延の両方で1回目に通った（step4）。
  - #626 の模擬検証は全件 50/50 OK（step4）。
- **回帰の結果：** regression 0件（新しい spec 3回・関係する spec 3本・lint 11本・vitest。step5 の節）。
- **直していないもの・別件：**
  - 最初の保存の前に記事の画面を開くと、引き出しが空のまま戻らない（main でも起きる・step3）。
  - 初期化が2回走る（step1）。
  - 初期化の間、状態の欄が「保存できませんでした」のまま（step1）。
  - 後ろの2つは②が別に起票する。1つ目の扱いは②の判断。

## step1 再現と切り分け（2026-11-14 14:47〜14:55）

コードは変えていない。本番への通信は0（CANARY_OFFLINE=1・アプリとハブの向き先は localhost だけ）。#626 の worktree のファイルには触れていない。

### 結論

- **アプリの不具合だった（分岐A）。canary が処理を直接呼ぶことは原因ではない。**
  空の保存先で「新規データで初期化しますか？」の OK を押した後、初期化の書き込みと読込が終わるまでの間に足した本が、遅れて届いた空の読込で消えていた。画面の引き出しから消えるだけでなく、保存先にも残らない。
- 本物の操作（設定→蔵書→手動で本を追加→追加する）でも、ハブの応答が本番に近い遅さだと再現した（3回中3回）。応答の遅延が0だと、この間が約0.2〜0.5秒しか無く、本物の操作は間に合わない（公開の流れ3回・保存の流れ1回とも再現せず）。直接呼ぶ canary だけが間に合っていた。
- **main の最新（116db67）では再現しない（6回中0回）。** 14:39 に main へ入った #602 の直し（029bf88）で、読込の時に「保存先が空で手元にデータがある時は手元を採る」決まりになった（js/bookshelf.js:2879 `_decideLoadedState`・L2905 `_keepLocalOverLoaded`）。#626 が観測した時点（bd610ea）と、この worktree の出発点（f6dd65a）は、この直しの前。
  - どの commit で直ったかは、コードを読んだ見立て。commit を1つずつ流して確かめてはいない（step2 で確かめる）。

### 再現手順

1. 模擬のハブを空で立てる（`tmp/633/canary/tools/bookshelf-canary-mock/servers.mjs`。kuroko の issue/626＝3340f9c の写し）。遅延ありの回は、最初から 書込1900ms・読取280ms（#626 step1 の d2-probe-prodlike と同じ値）。
2. アプリを開く（保存先＝ハブ）。「…保存データがありません。新規データで初期化しますか？」で OK を押す。
3. 確認が消えた直後に本を1冊足す。足し方は2通り。
   - direct：canary と同じ（欄に値を入れて `window.bookshelf.addBookManually()` を呼ぶ）
   - ui：本物の操作（#sidebar-settings → 蔵書 → #add-book-manually → ASIN・タイトル・著者を入力 → #add-manually → 「書籍を追加しました」→ 閉じる）
4. 開き直さずに、公開 → 記事を新規作成 → 引き出しに足した本が出るかを見る（canary の pick-book の段）。
5. 1回目だけを見る（やり直しはしない）。

流し方：`PLAYWRIGHT_BROWSERS_PATH=/home/sei/.cache/ms-playwright node tmp/633/run-all.mjs <回の名前,…>`（回ごとに別ポート 28750〜28783・別の模擬・別のブラウザ）。probe は写した canary に観測だけを足したもの（`tmp/633/gen-probe.mjs` が `probe-helpers.js.txt` を差し込んで `probe-canary.mjs` を作る）。初期化の確認を待つ長さだけ 5秒→30秒に延ばしてある（読取の遅延を入れた回で、確認が出る前に先へ進まないため）。

### 表1：#602 の直しが入る前のアプリ（f6dd65a）

時刻は「初期化の確認の OK を押した時」からのミリ秒。「読込」は初期化の後の `_applyLoadedState`（保存先の蔵書は毎回0冊）。

| 回 | 流れ | 足し方 | 遅延 書込/読取 | 1回目の結果 | 引き出し | 手元の蔵書 | 保存先の蔵書（終了時） | 本を足し終えた | 読込が終わった（＝OKからの長さ） | 読込の前後の手元 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1-direct-0 | 公開 | direct | 0 | **失敗 pick-book** | 0件 | 0冊 | 0冊 | +222 | +246 | 1→0冊 |
| 2-ui-0 | 公開 | ui | 0 | 通った | 1件 | 1冊 | 1冊 | +407 | +215 | 0→0冊 |
| 2b-ui-0 | 公開 | ui | 0 | 通った | 1件 | 1冊 | 1冊 | +595 | +256 | 0→0冊 |
| 2c-ui-0 | 公開 | ui | 0 | 通った | 1件 | 1冊 | 1冊 | +643 | +419 | 0→0冊 |
| 3-ui-slow | 公開 | ui | 1900/280 | **失敗 pick-book** | 0件 | 0冊 | 0冊 | +284 | +15,962 | 1→0冊 |
| 3b-ui-slow | 公開 | ui | 1900/280 | **失敗 pick-book** | 0件 | 0冊 | 0冊 | +437 | +16,044 | 1→0冊 |
| 4-direct-slow | 公開 | direct | 1900/280 | **失敗 pick-book** | 0件 | 0冊 | 0冊 | +122 | +15,963 | 1→0冊 |
| 7-ui-slow-wait8s | 公開 | ui（確認が消えて8秒後に操作を始める） | 1900/280 | **失敗 pick-book** | 0件 | 0冊 | 0冊 | +8,415 | +16,001 | 1→0冊 |
| 8-ui-slow-wait22s | 公開 | ui（22秒後に始める） | 1900/280 | 通った | 1件 | 1冊 | 1冊 | +22,367 | +16,012 | 0→0冊 |
| 5-save-ui-0 | 保存 | ui | 0 | 通った（edit-memo） | – | 1冊 | 1冊 | +373 | +187 | 0→0冊 |
| 6-save-direct-0 | 保存 | direct | 0 | **失敗 edit-memo** | – | 0冊 | 0冊 | +424 | +466 | 1→0冊 |

- 失敗した6回は、すべて「本を足し終えた」が「読込が終わった」より前。通った5回は、すべて後。足し方（direct か ui か）では分かれず、時刻の前後だけで分かれた。
- 7 と 8 は、同じ遅延・同じ本物の操作で、始める時機だけを変えた回。読込の前（+8.4秒）に足すと消え、後（+22.4秒）に足すと残る。
- 失敗した回は、保存先（模擬のハブ）の library.json も 0冊で終わった＝足した本は保存先にも残っていない。
- 保存の流れの1回目が edit-memo で落ちる件（#626 step2-report L47）も同じ原因（6-save-direct-0。本が消えているので `#book/<ASIN>` が開けず、URL の # が空に戻っていた）。

### 表2：main の最新のアプリ（116db67。#602 の直し 029bf88 を含む）

| 回 | 流れ | 足し方 | 遅延 書込/読取 | 1回目の結果 | 引き出し | 手元の蔵書 | 保存先の蔵書（終了時） | 本を足し終えた | 読込が終わった | 読込の前後の手元 |
|---|---|---|---|---|---|---|---|---|---|---|
| m1-direct-0 | 公開 | direct | 0 | 通った | 1件 | 1冊 | 1冊 | +324 | +370 | **1→1冊** |
| m2-ui-0 | 公開 | ui | 0 | 通った | 1件 | 1冊 | 1冊 | +387 | +157 | 0→0冊 |
| m3-ui-slow | 公開 | ui | 1900/280 | 通った | 1件 | 1冊 | 1冊 | +305 | +15,960 | **1→1冊** |
| m7-ui-slow-wait8s | 公開 | ui（8秒後に始める） | 1900/280 | 通った | 1件 | 1冊 | 1冊 | +8,296 | +15,956 | **1→1冊** |
| m8-ui-slow-wait22s | 公開 | ui（22秒後に始める） | 1900/280 | 通った | 1件 | 1冊 | 1冊 | +22,289 | +15,957 | 0→0冊 |
| m6-save-direct-0 | 保存 | direct | 0 | 通った（edit-memo） | – | 1冊 | 1冊 | +111 | +138 | **1→1冊** |

- 読込より前に足した4回（m1・m3・m7・m6）でも、読込の後に手元の本が残り、引き出しに出て、保存先にも1冊残った。
- canary と同じ足し方・遅延0（m1-direct-0＝#626 が毎回落ちていた形）が、1回目で pick-book を通った。

### OK を押してから読込が終わるまで、画面の操作は塞がれていたか

**塞がれていない。**（全17回で同じ。100ms ごとに「設定ボタンの位置の一番上の要素」を読んで集計＝`node tmp/633/check-block.mjs`）

- OK を押した時点：確認の幕（`.cfm-overlay`）が設定ボタンの上にあり、押せない。main などに inert が付いている。
- OK の +0.1〜0.4秒後（確認が閉じた時）から：設定ボタン（#sidebar-settings）の位置の一番上の要素は設定ボタン自身で、inert の付いた要素は0件＝押せる。読込が終わるまでこのまま（遅延ありの回で約16秒間）。この間に押せなかったのは、probe 自身が開いた「手動で本を追加」のモーダルが上にあった0.1〜0.3秒だけ。
- この間に出ているのは、主画面の上の細い表示「本棚を準備中…」（#loading）だけ。サイドバーも、ようこそカードの「本を追加・取り込み」ボタンも押せる見た目のまま。
- 画像：`tmp/633/runs/3-ui-slow/after-ok.png`（OK の直後。ホームがそのまま出ている）・`ui-added.png`（この間に本物の操作で「書籍を追加しました」まで進んだ所）・`pick-before.png`（引き出しが畳まれて0件）。直った後は `tmp/633/runs/m3-ui-slow/pick-before.png`（引き出しに canary-book が1件）。

### 時刻の並び（代表：3-ui-slow・直しの前）

| OK からの時刻 | 出来事 |
|---|---|
| 0 | 初期化の確認で OK |
| +59ms | storage.initEmpty() 開始（7ファイルを1件ずつ書く。1件 約1.9秒） |
| +101ms | 設定ボタンが押せる状態になる |
| +152〜284ms | 本物の操作で本を足す（手元の蔵書 1冊） |
| +2,210ms | 2回目の initEmpty() 開始（本を足した保存の経路から。下の「ほかに見えたこと」1） |
| +15,393ms | 1回目の initEmpty() 終了 → loadAll() 開始 |
| +15,962ms | loadAll() 終了 → `_applyLoadedState`（保存先の蔵書0冊）→ 手元の蔵書 1→0冊 |
| +23,735ms〜 | 記事の画面：引き出し0件（10秒待っても出ない） |

### ほかに見えたこと（直していない・step2 で扱いを決める）

1. **初期化が2回走る。** 起動の初期化（initEmpty）が書いている間に本を足すと、約2秒後に保存の経路（js/bookshelf.js:3682 付近。保存先が空なら initEmpty を呼ぶ）がもう一度 initEmpty を呼ぶ。遅延ありで、読込より前に足した回はすべてそうなった（3・3b・4・7・m3・m7。7ファイルの PUT が 201→200 と2回ずつ）。main の最新でも起きる。終了時の蔵書数は合っていたが、2回の初期化は「すべての本」の id を別々に作るので、保存先のファイル同士・手元との食い違いが残らないかは未確認。
2. 初期化の確認が出ている間から読込が終わるまで（遅延ありで約16秒）、状態の欄（#obsidian-sync-status）の文字がずっと「保存できませんでした」だった（全17回・main の最新でも同じ）。画面に見えているか、意図した表示かは未確認。
3. main の最新の決まりは「保存先が空で、手元に 本・自分で作った本棚・メモ/評価 のどれかがある時は手元を採る」（L2891-2897）。この間にした操作が設定の変更や記事だけの時は当てはまらない＝消える可能性がある（未実測）。

### 流していないもの・未確認

- どの commit で直ったかの実測（029bf88 の前後で流す）。
- GitHub・ローカルの空の保存先での同じ操作。
- 直していない canary（観測を足していない元の写し）での流し。probe は足し方と観測以外は同じだが、step4 で元のまま流して確かめる。
- 遅延ありの回は同時に5〜6本流した（ほかの③も多数稼働中）。秒数は揺れうるが、判定は時刻の前後で行っており、失敗/成功は時刻の前後と全回一致した。

### 証拠の場所

- 回ごとの記録：`tmp/633/runs/<回の名前>/`（run.log＝実行の記録・probe.json＝時刻と状態・after-ok.png／ui-added.png／pick-before.png／pick-after.png／memo-*.png・state.json）
- 要点の出力：`node tmp/633/summarize.mjs [回の名前,…] [brief]`
- tmp/ は .gitignore 済み（commit されない）。

## step2 原因の特定・同じ種類の洗い出し・直し方の比較（2026-11-14 14:58〜15:05）

コードは変えていない。本番への通信は0。アプリの版は `git archive` で `tmp/633/app-<sha>/` に展開して配信した（自分の worktree は main の最新 6dc2c04 へ早送りしただけ）。probe には「読込で手元と保存先のどちらを採ったか」（`_lastLoadDecision`）の観測を足した。

### 原因（1つに絞った）

**M1 で確定。** 空の保存先の初期化（initEmpty→loadAll）が終わる前に手元を変えると、その後の読込の反映（`_applyLoadedState`）が保存先の空の中身で手元を置き換えていた。M2（「すべての本」と bookOrder.all が別の配列）・M3（モーダルの導線を踏まない差）は当てはまらない（M2：消えた回は蔵書そのものが 0冊。M3：足し方を変えても結果は同じ）。

条件を1つだけ変えると結果が逆になる実験（2つ）：

| 変えた条件 | 変える前 | 変えた後 |
|---|---|---|
| 足す時機だけ（同じ版 f6dd65a・同じ遅延・同じ本物の操作） | 確認が消えて8秒後に足す＝読込の前（7-ui-slow-wait8s）：**消えた** | 22秒後に足す＝読込の後（8-ui-slow-wait22s）：残った |
| アプリの commit だけ（029bf88 とその親 f6dd65a・同じ回） | f6dd65a：1-direct-0・3-ui-slow・3b-ui-slow・6-save-direct-0 とも**消えた** | 029bf88：c1-direct-0・c3-ui-slow・c6-save-direct-0 とも残った（読込で採った側＝local・手元 1→1冊・保存先にも1冊） |

- 直した commit：**029bf88**（#602「保存先へ書けない間の編集が、つなぎ直した後に保存先の内容で上書きされて消える不具合を直す」・14:39 に main）。読込の前に `_decideLoadedState`（js/bookshelf.js:2879）が「保存先が空で、手元に本・自分で作った本棚・メモ/評価がある → 手元を採る」と決め、`_keepLocalOverLoaded`（L2905）で手元を残す。
- main の最新（6dc2c04）でも同じ：n1-direct-0・n3-ui-slow とも採った側＝local で残った。

### 同じ種類の洗い出し

#### 空の保存先を初期化して読み込む経路（grep で全数：`_applyLoadedState(` 4か所・`initEmpty()` の呼び出し 4か所）

| 経路 | 初期化 | 読込の反映 | 直す前（f6dd65a） | 今の main | 根拠 |
|---|---|---|---|---|---|
| ハブ（起動時 initCloudSync） | js/bookshelf.js:3126 | L3134 → `_decideLoadedState` | 消える | 残る（local） | **実測**（直す前：読込の前に足した6回とも消えた・029bf88：3回とも残った・main：8回とも残った（うち読込の前に足した6回）） |
| GitHub（起動時 initGitHubSync） | L3246 | L3254 → `_decideLoadedState` | 消える（g6-gh-direct-old：手元 1→0冊・本の詳細のメモ欄が出ない） | 残る（g6-gh-direct-new：local・1→1冊） | **実測**（遅延0・direct の各1回。GitHub の模擬は遅延を入れられない） |
| ローカルのフォルダ（selectObsidianFolder → loadFromObsidianFile） | L3381 | L3432 → `_decideLoadedState` | 同じ形（読んだだけ） | 同じ決まりを通る。#602 の E2E「手元に本がある状態で空のフォルダを初めてつなぐと、手元の本が残り…」（tests/e2e/sync-offline-reconnect.spec.js:385）がある | 読んだだけ |
| 3択で「保存先の内容を読み込む」 | – | L2944（adoptRemote:true） | – | 利用者が選んだ時だけ保存先を採る＝対象外 | 読んだだけ |
| 保存の経路（syncToObsidianFolder・保存先が空なら初期化） | L3682 | 読込の反映は無い | 起動の初期化と重なると初期化が2回走る | **同じ（直っていない）** | 2回走ることは実測（3・3b・4・7・m3・m7・c3・n3）。実害は未確認 |

#### 初期化の途中にする操作（今の main）

| 操作 | 手元を採る決まり（L2891-2897）に数えられるか | 今の main で残るか | 根拠 |
|---|---|---|---|
| 手で本を足す | 本の数 | 残る | 実測 |
| Kindle の取込 | 本の数 | 残る見込み | 読んだだけ |
| 本棚を作る | 自分で作った本棚 | 残る見込み | 読んだだけ |
| 短文メモ・評価 | notes のキー（本が要る） | 残る見込み | 読んだだけ |
| 設定を変える | 数えない（→保存先を採る）。ただし設定は項目ごとの更新時刻（_updatedAt）で新しい方を採り、端末ごとの好みは常に手元（L3522-3537） | 更新時刻を付けて書く設定なら残る見込み | 読んだだけ |
| 記事を書く | 読込の反映の対象外（記事は private/publish/articles.json を PublishArticleStore が別に読み書き。initEmpty も書かない） | 影響なし見込み | 読んだだけ |

→ step1 の「ほかに見えたこと」3（設定・記事だけの時は消える可能性）は、読んだ限り当たらない。

### 直し方の比較

この不具合は main で直っている（029bf88）。比べるのは「何を足すか」。

| 案 | 中身 | 直る範囲 | 今の挙動への影響 | 変更量 | テストのしやすさ | #626 への影響 |
|---|---|---|---|---|---|---|
| **A（推奨）** | アプリと canary は変えない。この場面の E2E を1本足して固定する（空のハブ→初期化の確認で OK→読込が終わる前に本物の操作で本を足す→開き直さずに記事の引き出しに本が出る・保存先の library.json にも残る） | 既に直っている。再発（決まりを変えた時など）を検知できる。#602 の E2E は「つなぐ前から手元に本がある」形で、この時機（確認の後・読込の前）は通していない | なし | spec 1本 | 初期化の書き込みを遅らせる必要。spec の中で後から page.route を足して PUT /data/* を遅らせる（gate-hub.js 本体は変えない＝#599・#629 と重ならない）。アプリの内部は読まない | なし |
| B | 何も足さない（#602 の E2E で足りるとする） | 時機の違う場面は通らない | なし | 0 | – | なし |
| C | 初期化と読込が終わるまで画面の操作を塞ぐ | 初期化中の全操作・初期化2回も起きなくなる | 大きい（起動中も操作できる作り（#519・C-277 の起動の2段化）と逆。本番の遅さで最大約16秒操作できない） | 中＋設計判断（ADR） | – | なし |
| D | 保存の経路（L3682）で、起動の初期化が進行中なら2回目の initEmpty を呼ばず終わりを待つ | 初期化2回（ほかに見えたこと1） | 最初の保存が少し遅れる | 小〜中 | 遅延つきの模擬で再現できる | なし |

- 推奨は A。C は設計の方針に関わるので、このイシューでは扱わない。D は先に実害（2回の初期化で「すべての本」の id が食い違うか）を確かめる必要があり、別イシューを推奨。
- canary（分岐B）は変えない。依頼の2案を含めて比べた結果：
  - 「直接呼ぶのをやめる」：原因ではないので直らない（直す前のアプリでは、遅延ありなら本物の操作でも落ちた）。
  - 「呼んだ後に一覧を読み直す」：遅れて届く読込が後から消すので、読み直す時機しだいで効かない。
  - 「起動の読込が済むのを待ってから足す」（実測から出た案）：直す前のアプリでも通るようになるが、利用者は塞がれずに操作できる＝見張りがアプリの不具合を隠す。採らない。
  - 今の main では、canary と同じ足し方で、空の保存先からの1回目に pick-book・edit-memo とも通る（c1・n1・m1・c6・m6・GitHub も）。

### #626 との衝突

- 台帳DB（読み取りのみ・15:00）：#626 は state=done（14:53）。
- canary は kuroko の main に未取り込み（`git ls-tree main tools/` に無い）。3340f9c を含む branch は issue/626 だけ。
- 推奨の案 A は canary を触らない＝衝突なし。(イ)(ロ)(ハ) のどれも不要。申し送りだけ：canary を main へ取り込む時、「029bf88 以降のアプリでは、空の保存先からの1回目のやり直し（pick-book・edit-memo）は出ない。#626 の step1/step2 の観測（bd610ea）は直しの前」。

### step3 で触るファイル（案 A の場合）

- 新規：`tests/e2e/first-run-add-article-drawer.spec.js`（計画で宣言した名前のまま）
- 追記：`scripts/verify/633-results.md`
- 計画の files から外れるもの（触らない）：js/bookshelf.js・index.html（?v= 不要）・js/storage.js・js/screens/article-editor.js・03_詳細設計書・canary の2本

### step2 の回の記録

| 回 | アプリ | 流れ | 足し方 | 遅延 | 結果 | 読込で採った側 | 手元（読込の前→後） |
|---|---|---|---|---|---|---|---|
| c1-direct-0 | 029bf88 | 公開 | direct | 0 | 通った（引き出し1件） | local | 1→1 |
| c3-ui-slow | 029bf88 | 公開 | ui | 1900/280 | 通った（引き出し1件） | local | 1→1 |
| c6-save-direct-0 | 029bf88 | 保存 | direct | 0 | 通った（edit-memo） | local | 1→1 |
| n1-direct-0 | 6dc2c04 | 公開 | direct | 0 | 通った | local | 1→1 |
| n3-ui-slow | 6dc2c04 | 公開 | ui | 1900/280 | 通った | local | 1→1 |
| g6-gh-direct-old | f6dd65a | 保存（GitHub） | direct | 0 | **失敗 edit-memo** | （この版には無い） | 1→0 |
| g6-gh-direct-new | 6dc2c04 | 保存（GitHub） | direct | 0 | 通った | local | 1→1 |

- GitHub の回の run.log の最後の「実行役の異常: GitHub の模擬は保存先の中身を読まない」は、模擬の中身を読む処理を飛ばすために runner がわざと出したもの（流れの結果とは関係ない）。
- c3・n3 でも初期化は2回走った（ほかに見えたこと1）。

## step3 E2E を1本足して固定（2026-11-14 15:08〜15:15）

案 A（②承認）。アプリと canary は変えていない。

### 足した spec

`tests/e2e/first-run-add-article-drawer.spec.js`（1本）。

1. 空のハブ（gate-hub.js の模擬・ファイル0件）・端末に蔵書なしで開く。
2. 「…新規データで初期化しますか？」で OK。
3. 初期化の書き込み（PUT /data/*）を、本を足し終えるまで止める。spec の中で page.route を足し、止めた後は fallback で模擬へ回す（gate-hub.js 本体は変えない）。機械の速さによらず「読込の前に足した」になる。
4. 本物の操作で本を足す（設定→蔵書→手動で本を追加→追加する→閉じる）。この時点で保存先に library.json が無い（＝読込の前）ことも確かめる。
5. 止めていた書き込みを放す → 起動の読み込みが終わるのを待つ → ホームの蔵書数が 1。
6. 模擬のハブの中身で数える：library.json の本の asin が [足した本]・all.json の books が [足した本]。
7. 開き直さずに記事の画面へ（公開→記事を新規作成→編集）→ 引き出しに足した本が出る。

アプリの内部（bookshelf._…）は読まない（lint:internal-refs 0件増）。非同期の状態は expect.poll で待つ。

### 赤（直す前）と緑（main）

同じ spec を、版だけ変えて流した（`node tmp/633/run-spec.mjs <label> <port> <appRoot|-> [回数]`。直す前の版は `git archive f6dd65a` を展開し、写した servers.mjs で配信。Playwright は reuseExistingServer で使い回す）。

- 直す前（f6dd65a・ポート 28799）：**赤**（`tmp/633/spec-old-f6dd65a3.log`）
  ```
  Error: expect(locator).toHaveText(expected) failed
  Expected: "1"
  Received: "0"
  > 67 |     await expect(page.locator('.dashboard-widget').filter({ hasText: '蔵書数' }).locator('.bn-value')).toHaveText('1');
    1 failed
  ```
  読込の前に足した本が、読込の後に消えている（M1 そのもの）。
- main の最新（6dc2c04・ポート 8133）：**緑** `1 passed (2.6s)`（`tmp/633/spec-new-main3.log`）。3回続けて `3 passed (7.0s)`（`tmp/633/spec-new-main-x3.log`）。

### 途中で見つけた別の不具合（main でも起きる・直していない）

**最初の保存が済む前に記事の画面を開くと、引き出しが「(本棚がありません)」で畳まれたまま、保存が済んでも戻らない。開き直すと出る。**

- 最初に書いた spec（読込が終わった直後に記事の画面を開く順）が、main でも引き出しの所で赤になった（`tmp/633/spec-new-main.log`。画面の記録ではホームの蔵書数 1冊・「全ての本 1冊」＝本は残っている）。
- 調べ用の spec（`tmp/633/zz-633-diag.spec.js.txt`・commit しない）で、main の最新で測った（`tmp/633/spec-diag-main.log`）：

  | 時点 | 保存先の library.json | 引き出しの項目 | 引き出しの本棚の表示 | .art-wrap |
  |---|---|---|---|---|
  | 記事の画面を開いた直後（+1.3秒） | 0冊 | 0 | (本棚がありません) | art-drawer-collapsed |
  | 3秒後 | 1冊（保存が済んだ） | 0 | (本棚がありません) | art-drawer-collapsed |
  | 保存先に届いた1秒後（開き直していない） | 1冊 | 0 | (本棚がありません) | art-drawer-collapsed |
  | 記事の一覧へ戻って開き直した後 | 1冊 | **1** | すべての本 | art-wrap |

  画像：`tmp/633/diag-drawer-before-reopen.png`・`tmp/633/diag-drawer-after-reopen.png`。
- 見立て（コードを読んだだけ・未実測）：初めての利用（端末にも保存先にも本棚が無い）では、手元の userData に「すべての本」の本棚が無く、最初の保存（`_prepareSyncEntries`・js/bookshelf.js の同期の書き出し）で初めて作られる。記事の画面は開いた時に引き出しの本棚を決め（`_artResolveSourceShelfId`。本棚が1つも無いと null）、保存で本棚が作られても描き直さない。
- 依頼の2つ目の仮説（「本を足した直後に記事の画面へ行くと、引き出しに新しい本が出ない」）は、この形で main にも残っている。canary が今の main で通るのは、記事の画面を開くまでに最初の保存が済んでいるため（公開の流れは一覧を開く・古い記事を消す・題を入れる等を先にする）。
- 足した spec は、この別件を避けるため「最初の保存が済んでから記事の画面を開く」順にした（spec の中に理由を書いた）。直すかどうか・どこで直すかは②の判断に回す。

### 流したもの

- lint 11本（package.json の lint:copy・lint:terms・lint:css・lint:e2e-goto・lint:e2e-wait・lint:breakpoint・lint:esc・lint:js-color・lint:internal-refs・lint:e2e-gate・lint:known-red）：すべて exit 0（`tmp/633/lint-*.log`）。
- vitest（npm test）：`Test Files 73 passed (73)`・`Tests 1088 passed | 2 todo (1090)`（`tmp/633/vitest.log`）。
- lint:internal-refs：`OK: 上限(82)以内`（新しい spec はアプリの内部を読まない）。
- index.html の ?v= は上げていない（公開されるファイルを変えていない）。check:version は commit の後に `--range=origin/main..HEAD` で流す。
- 関係する spec の単独の流し（sync-offline-reconnect・boot-confirm-dialog・dashboard-stats-after-manual-add）は step5（②の指示で step5 に回した）。

## step4 完了条件の確認（2026-11-14 15:15〜15:20）

アプリは main の最新 **0300351**（`git archive origin/main` を `tmp/633/app-0300351/` に展開して配信）。canary は issue/626 の先頭 **3340f9c** を写し直したもの（`tmp/633/canary-step4/`・#626 の step1/step2 と同じ版）。本番への通信は0。#626 の worktree・状態ファイルには触れていない。

### 観測を足していない canary（元の写し）を、空の保存先から流した

| 回 | 流れ | 遅延 書込/読取 | 結果 | やり直し | 1回目の失敗 | 記録 |
|---|---|---|---|---|---|---|
| s1-canary-publish-0 | 公開（pick-book を含む） | 0 | **成功** 8.4秒 | なし（attempts=1） | なし | 同意 302ms・公開URL 575ms・404まで 5012ms |
| s2-canary-publish-slow | 公開 | 1900/280 | **成功** 52.3秒 | なし（attempts=1） | なし | 同意 2296ms・公開URL 12987ms・404まで 10006ms |
| s3-canary-save-0 | 保存（edit-memo を含む） | 0 | **成功** 8.7秒 | なし（attempts=1） | なし | |
| s4-canary-save-slow | 保存 | 1900/280 | **成功** 34.4秒 | なし（attempts=1） | なし | |

- 4回とも、空の保存先からの1回目で通った（pick-book・edit-memo を含む）。模擬のハブの中身は、終了時に library.json・all.json とも1冊。
- 公開の流れで pick-book が通った＝記事の画面を開いた時には「すべての本」の本棚があった（step3 で見つけた別件＝最初の保存の前に記事の画面を開くと引き出しが空のまま戻らない、には当たらなかった）。canary は記事の画面を開く前に記事の一覧を開く・前の回の記事を消す等をするので、その間に最初の保存が済むためと見ている（推定・時刻は測っていない）。

- 記録：`tmp/633/runs/<回>/run.log`・`state.json`（canary 自身の状態ファイル。attempts と firstFailure を読む）。要点の出力は `node tmp/633/summarize-canary.mjs <回,…>`。
- 直す前（#626 step1・bd610ea）は、空の保存先からの1回目が毎回 pick-book で落ちてやり直していた（`tmp/626-step1/step1-report.md` §5）。保存の流れも1回目が edit-memo で落ちていた（#626 step2-report L47）。

### probe（step1 と同じ観測）を、直した後の版で流した

| 回 | 足し方 | 遅延 | 直す前（f6dd65a・step1） | 直した後（0300351） | 読込で採った側（直した後） | 手元（読込の前→後） |
|---|---|---|---|---|---|---|
| direct・0 | direct | 0 | 失敗 pick-book（1-direct-0） | **通った**（p1-direct-0） | local | 1→1 |
| ui・0 | ui | 0 | 通った（2-ui-0。読込の後に足した） | **通った**（p2-ui-0） | remote（読込の後に足した＝手元0冊） | 0→0 |
| ui・遅延あり | ui | 1900/280 | 失敗 pick-book（3-ui-slow・3b-ui-slow） | **通った**（p3-ui-slow） | local | 1→1 |
| direct・遅延あり | direct | 1900/280 | 失敗 pick-book（4-direct-slow） | **通った**（p4-direct-slow） | local | 1→1 |

- 引き出しに本が出ている画面：`tmp/633/runs/p2-ui-0/pick-before.png`（「本の引き出し」に canary-book が1件）。同じ形で p1・p3・p4 の `pick-before.png`。
- 直す前の画面（0件・畳まれた引き出し）：`tmp/633/runs/3-ui-slow/pick-before.png`。

### #626 の canary を壊していない確認（run-mock-check.mjs の全件）

- 写し：issue/626 の 3340f9c（`tmp/633/canary-step4/SOURCE_SHA.txt`）。写しの中だけでポートを変えた（場面の起点 18590→28800・静的配信 18584→28884・ハブと GitHub の模擬 18585→28885。どれも空きを確かめてから使った）。
- アプリ：CANARY_MOCK_APP_ROOT＝`tmp/633/app-0300351`（main の最新）。
- 結果：**50/50 OK**（`tmp/633/mock-check-step4.log`）。#626 step2-report の 50/50 と同じ。
- 1回目は 49/50 だった（`tmp/633/mock-check-step4-run1-missing-datacheck.log`）。NG の1件「データ確認 (状態ファイルの目印と一致) は exit 0」は、写しに `tools/bookshelf-canary-datacheck.mjs` を入れ忘れたため（実行役のファイルが無く、node が読み込みで止まって exit 1）。アプリとは関係ない。写しに足して全件を流し直した。

## step5 回帰の確認（2026-11-14 15:19〜）

②の指示（step3 承認時）で、e2e-diff-main は流さず、次の3つで判定した。アプリは変えていない（足したのは spec 1本と、この記録だけ）。

- 確かめた形：自分の2つの commit を origin/main の最新 **0300351** の上へ rebase した後（8d59a83・77e4c94）。この worktree を PORT 8133 で配信した（playwright.config.js の webServer と同じ `python3 -m http.server`）。流し方は `node tmp/633/run-step5.mjs`。

| 確かめたもの | 結果 | 記録 |
|---|---|---|
| 新しい spec を3回（first-run-add-article-drawer） | **3 passed** | `tmp/633/step5-new-x3.log` |
| sync-offline-reconnect（単独） | **13 passed (1.0m)** | `tmp/633/step5-sync-offline-reconnect.log` |
| boot-confirm-dialog（単独） | **2 passed** | `tmp/633/step5-boot-confirm-dialog.log` |
| dashboard-stats-after-manual-add（単独） | **1 passed** | `tmp/633/step5-dashboard-stats-after-manual-add.log` |
| lint 11本（copy・terms・css・e2e-goto・e2e-wait・breakpoint・esc・js-color・internal-refs・e2e-gate・known-red） | **すべて exit 0**（internal-refs は「OK: 上限(82)以内」） | `tmp/633/step5-lint-*.log` |
| check:version `--range=origin/main..HEAD` | exit 0（js/css の変更なし＝スキップ） | `tmp/633/step5-check-version.log` |
| vitest（npm test） | **74 files passed・1099 passed・2 todo** | `tmp/633/step5-vitest.log` |

- regression：**0件**（流したものはすべて緑。落ちて流し直したものは無い）。
- 流していないもの：e2e-diff-main（E2E 全件・画像比較。②の指示で省いた）。webkit の project では流していない（足した spec は chromium の project に入る）。
