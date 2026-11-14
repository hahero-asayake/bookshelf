# #653 ハブ・GitHub の起動の読込が失敗した時、状態の欄が「保存できませんでした」になる — 記録

## step1 着手条件・同じ種類の洗い出し・文言の案（2026-11-14 17:40〜17:50・コードは変えていない）

### 着手条件と土台

- 17:40 に `git fetch` した。origin/main は 1c99d78。`git log origin/main --grep='Issue: #648'` に、#648 の fix 2a06379「fix: 空の保存先の初期化の確認を待つ間と初期化の間、同期欄に「保存できませんでした」を出さない」がある。DB では #648 が done（#639・#636 も done）。
- worktree を 6a698df から 1c99d78 へ `git merge --ff-only origin/main` で早送りした。node_modules はもうあったので、張り直していない。
- 以下の行番号は 1c99d78 のもの。17:46 には origin/main が fa4f41f に進んだが、増えたのは docs の commit だけで js/bookshelf.js は変わっていない。

### 同じ種類の洗い出し（updateSyncStatus の呼び出し 全23か所）

`git grep -n updateSyncStatus origin/main -- js` で取り直した。呼び出しは全部 js/bookshelf.js にある（js/screens/settings.js L34 はコメント）。648-results.md の step2 では22か所だったが、その後に次の変化があった。

- #648 が、空の確認の前の2か所をキャンセルの分岐へ移した（3228・3366）。
- #639 が、衝突中の保存（旧 L3700）の 'reconnect' を消した。かわりに 'synced'（3008）と 'held'（5148）を足した。

既定の文言は updateSyncStatus（4137-）のクラウドの分岐 L4163 `failed ? (detail || '保存できませんでした') : …` にある。ハブ・GitHub の時に detail なしで 'reconnect'/'failed' を渡すと、この文言になる。

| 行 | 関数 | 場面 | 渡す状態 | ハブ・GitHub の時の表示 | ローカルの時の表示 | 事実と合うか | 扱い |
|---|---|---|---|---|---|---|---|
| 3008 | _askLoadConflict | 読込時の3択で「保存先の内容を読み込む」を選んだ | synced | HH:MM:SS 保存済み | 同期済み… | 合う | そのまま（#639） |
| 3216 / 3357 | _initCloudSyncLoad / _initGitHubSyncLoad | 起動の読込の始め | loading | 読み込み中... | – | 合う | そのまま |
| 3228 / 3366 | 同上 | 空の確認でキャンセルした後 | reconnect（`… (空)`・detail なし） | 保存できませんでした・「… (空)（要再接続）」 | – | おおむね合う（#648 で決めた表示） | 触らない（#648） |
| 3254 / 3387 | 同上 | 読込の後 | synced | HH:MM:SS 保存済み | – | 合う | そのまま |
| **3259 / 3390** | 同上 | **起動の読込の失敗（catch）** | reconnect（detail なし） | **保存できませんでした（赤）・「…（要再接続）」（赤）** | – | **合わない**（失敗したのは読込） | **このイシューで直す** |
| 3471 / 3473 | initObsidianSync | ローカル・起動・許可あり | loading → synced | – | 読み込み中... → 同期済み | 合う | そのまま |
| 3481 | initObsidianSync | ローカル・許可なし | reconnect | – | 「フォルダを選ぶ」を押して…（赤） | 合う | そのまま |
| 3500 / 3516 | selectObsidianFolder | フォルダを選んだ | loading → synced | – | 読み込み中... → 同期済み | 合う | そのまま |
| 3527 | selectObsidianFolder | ローカルの読込の失敗 | reconnect | – | 「フォルダを選ぶ」を押して…（赤）＋toast | 合う（ローカルの分岐を通るので「保存できませんでした」にならない） | そのまま |
| 3727 / 3734 / 3736 | reloadFromObsidianFile | ローカルの読み直し | loading → synced | – | 読み込み中... → 同期済み（読めない時は toast） | 合う | そのまま |
| 3809 | syncToObsidianFolder | ローカルの書き込みの許可が無い | disconnected | – | （未接続） | 合う | そのまま |
| 4006 | syncToObsidianFolder | まとめ保存で衝突 | reconnect（detail なし） | 保存できませんでした（赤） | – | 合う（送れていない） | 触らない |
| 4020 | syncToObsidianFolder | 保存の後 | synced | HH:MM:SS 保存済み | 同期済み… | 合う | そのまま |
| 4025 | syncToObsidianFolder の catch | **本当の保存の失敗** | reconnect / failed＋`failure.message` | 失敗の種類ごとの文（赤） | 「フォルダを選ぶ」を押して…（赤） | 合う | **変えない**（step2 の守りのテストで見る） |
| 5148 | _onSyncFailed | 書くのを止めている間（3択をまだ選んでいない） | held＋`f.message` | 理由の文（赤） | 同じ | 合う | そのまま（#639） |

結論：起動の読込の失敗で「保存できませんでした」になるのは **3259（ハブ）と 3390（GitHub）の2か所だけ**。brief の L3187・L3305（d92709f）と同じ catch で、#643 によって関数の名前が _initCloudSyncLoad/_initGitHubSyncLoad に変わり、行がずれた。ほかに同じ種類の箇所は無い。updateSyncStatus を呼ばない読込の経路も確かめた。

- #617 の読み直し（_retryInitLoad → initSync）と、GitHub の toast の「再試行」（initGitHubSync）は、同じ catch を通る。直せば一緒に直る。
- 読込時の3択の「保存先の内容を読み込む」（L3013 `adoptRemote: true`）は、起動の読込で読んだ内容を採るだけで、ここで読み直さない。読込の失敗の表示の経路ではない。
- 記事エディタ・長文メモの読込の失敗は、状態の欄ではなく、それぞれの帯（#art-save-status・SaveStatus）に出す。別の表示なので触らない。

### 今の表示（直す前・1c99d78 で実測）

流し方：`PORT=8153 npx playwright test --config tmp/653/probe.config.mjs`。probe は `tmp/653/probe-653.spec.mjs` で、tmp/ は commit しない。作り方は tests/e2e/online-resync.spec.js（#617）と同じ。

1. 1回ふつうに起動する。
2. ハブ（`HUB_BASE/**`）または GitHub（`https://api.github.com/**`）への通信を、模擬より手前の `context.route` で、通信の失敗（`route.abort('internetdisconnected')`）か認証切れ（401）にする。
3. 開き直す。

4本とも最後まで届いた（4 passed・48.7s）。画面の文は、状態バー・toast が出た 2.5秒後に読んだ。元の記録は `tmp/653/runs/<場面>-1-after.json`。

| 場面 | 状態バー | toast | 状態の欄 `#obsidian-sync-status` | path `#obsidian-sync-path` |
|---|---|---|---|---|
| ハブ・通信の失敗 | 「Asayake ハブ からの読み込みに失敗しました。」＋「確認」 | なし | **「保存できませんでした」（赤）** | 「Asayake ハブ（要再接続）」（赤） |
| ハブ・認証切れ（401） | 「Asayake ハブ の認証が切れました。設定から再接続してください。」＋「確認」 | なし | **「保存できませんでした」（赤）** | 「Asayake ハブ（要再接続）」（赤） |
| GitHub・通信の失敗 | 「最新のデータを確認しています…」と「GitHub の保存先を取得できません。」＋「確認」（注1・注2） | 「手元のデータで表示中です。GitHub からの読み込みに失敗しました。」＋「再試行」 | **「保存できませんでした」（赤）** | 「taro/bookshelf-data@main（要再接続）」（赤） |
| GitHub・認証切れ（401） | 「GitHub のトークンが無効です。再接続してください。」＋「確認」（注1） | 「GitHub との接続に失敗しました。（改行）「切断」してから、もう一度「GitHub に接続」をお試しください。」 | **「保存できませんでした」（赤）** | 「taro/bookshelf-data@main（要再接続）」（赤） |

- 失敗させる前（`*-0-before.json`）は、4本とも状態の欄が「H:MM:SS PM 保存済み」（緑）、path が名前だけだった。
- 状態の欄と path は、4本とも `checkVisibility()`=false だった。ハブ・GitHub を選んでいる間は「この端末のフォルダ」の欄ごと隠れている（648-results step1 と同じ）。見えるのは、保存先セレクトを「この端末のフォルダ」に切り替えた時（(c)）だけ。②の指示どおり、(c) は E2E に入れず、文字は textContent で見る。
- 注1：GitHub の状態バーの「GitHub の保存先を取得できません。」「GitHub のトークンが無効です。…」は、設定の GitHub の欄がリポジトリの一覧を取りに行って失敗したもの（js/screens/settings.js）。起動の読込の catch とは別。模擬がその要求に答えないので、失敗させる前の起動でも「取得できません」が出ている（`github-net-0-before.json`。648-results step1 注1 と同じ）。このイシューでは見ない。
- 注2：GitHub・通信の失敗では、toast の 2.5秒後にも「最新のデータを確認しています…」が残っていた。この帯は、起動の後半（finishStartup）が終わるまで出る作り（js/bookshelf.js L489-493）。いつ消えるかは見ていない（未確認）。このイシューの範囲外。

### 文言の案（状態の欄に出る文で比べる）

| 場面 | 今 | 案A（同じ失敗で、利用者にもう出している文） | 案B（短い文） | 案C（保存の失敗の文と同じ書き方で新しく作る） |
|---|---|---|---|---|
| ハブ・通信の失敗 | 保存できませんでした | Asayake ハブ からの読み込みに失敗しました。 | 読み込めませんでした | Asayake ハブから読み込めませんでした。通信が戻ると自動で読み直します。 |
| ハブ・認証切れ | 保存できませんでした | Asayake ハブ の認証が切れました。設定から再接続してください。 | 読み込めませんでした | Asayake ハブのログインが切れたため、読み込めませんでした。設定からログインし直してください。 |
| GitHub・通信の失敗 | 保存できませんでした | GitHub からの読み込みに失敗しました。 | 読み込めませんでした | GitHub から読み込めませんでした。通信が戻ると自動で読み直します。 |
| GitHub・認証切れ | 保存できませんでした | GitHub との接続に失敗しました。「切断」してから、もう一度「GitHub に接続」をお試しください。 | 読み込めませんでした | GitHub の接続が切れたため、読み込めませんでした。設定から接続し直してください。 |

| 比べる点 | 案A | 案B | 案C |
|---|---|---|---|
| 状態バー・toast と同じ文か | **同じ**（ハブは状態バーと同じ文、GitHub は toast の失敗の文。認証切れは改行だけを除く） | 違う（別の短い文） | 違う（同じ失敗に2通りの文が並ぶ） |
| 利用者が新しく見る文 | 0（文としては増えない。GitHub・通信の失敗だけ、toast の後半を単独で使う） | 1 | 4 |
| ui-standards §2-11「何が起きたか＋次にどうすればよいか」 | 認証切れは2つとも入っている。通信の失敗は「何が起きたか」だけ（今の状態バー・toast と同じ。GitHub の toast には「再試行」がある。ハブは電波が戻ると自動で読み直す＝#617） | 4つとも「何が起きたか」だけ | 4つとも入っている |
| 触る所 | js/bookshelf.js の2つの catch だけ | 同じ | 同じ（文を js/sync-failure.js に寄せるなら、そこも） |
| lint:copy・lint:terms（試しに当てて流した・commitしていない） | OK（当てる前と同じ数：lint:copy 119/119・lint:terms table 1/1・jargon 0/0） | OK（同じ） | OK（同じ） |

- lint は `tmp/653/trial.mjs A|B|C` で作業ツリーに一時的に当てて流した。流した後は毎回 `git checkout -- js/bookshelf.js` で戻し、退避した写しと `cmp` で一致することを確かめた。
- 案C を当てた時、抽出の結果（scripts/extract-ui-strings.mjs → `_local/ui-strings.json`）に4つの文が入っていた。lint が新しい文を読んだうえで通っている。戻した後は0件。

**推奨：案A。**

1. 同じ失敗には同じ文を出す。状態バー・toast と状態の欄で別の文を出さない。保存の失敗も、状態バーと状態の欄に同じ `failure.message` を出している（#603。save-failure-visible.spec.js の ja-JP のテストが、状態の欄の文を状態バーと同じ文として見ている）。
2. 利用者が新しく見る文が増えない（brief「既存の文言の書き方に合わせて」）。
3. 通信の失敗の文に「次にどうすればよいか」が無いのは、状態バー・toast の今の文も同じ。足すなら、状態バー・toast・状態の欄を1か所から一緒に変えるのが筋で、このイシューの範囲（状態の欄に detail を渡す）を超える。下の「別に回す候補」に置く。

### path の「（要再接続）」の扱い

| 場面 | (1) 認証切れは 'reconnect'、それ以外は 'failed'（推奨） | (2) 'reconnect' のまま（文言だけ変える） |
|---|---|---|
| ハブ・通信の失敗 | 「Asayake ハブ」（ふつうの色） | 「Asayake ハブ（要再接続）」（赤） |
| ハブ・認証切れ | 「Asayake ハブ（要再接続）」（赤） | 同じ |
| GitHub・通信の失敗 | 「taro/bookshelf-data@main」（ふつうの色） | 「taro/bookshelf-data@main（要再接続）」（赤） |
| GitHub・認証切れ | 「taro/bookshelf-data@main（要再接続）」（赤） | 同じ |

- 状態の欄の文字は、(1)(2) とも赤。updateSyncStatus のクラウドの分岐は、'failed' も 'reconnect' も赤にする。
- (1) を推す理由：通信の失敗なら、つなぎ直さなくても電波が戻れば自動で読み直す（#617 の `_markInitLoadFailed` → `_retryInitLoad`。GitHub は toast の「再試行」もある）。なので「要再接続」は事実と合わない。保存の失敗の catch（4025）も `failure.reconnect ? 'reconnect' : 'failed'` で、通信の失敗には「（要再接続）」を付けない。(1) にすると、読込の失敗と保存の失敗で決め方がそろう。
- (1) の影響：updateSyncStatus の本体は変えない（呼び出し側で state を選ぶだけ）。`git grep 要再接続 -- tests` で出る spec は、#648 の空の確認でキャンセルした後（first-run-init-status.spec.js）、#639 の止めている間（load-conflict-unsaved.spec.js）、ローカルの権限待ちとフォルダが見つからない保存の失敗だけ。起動の読込の失敗の後の path を見ている spec は無い。

### 直し方の見込み（案A＋(1) の場合。step3 で行う）

- ハブの catch（3257-3268）：`_syncErrorMsg` を先に決め、`this.updateSyncStatus(isAuthErr ? 'reconnect' : 'failed', label, this._syncErrorMsg)` にする。
- GitHub の catch（3388-3403）：認証切れの時は `'reconnect'` と、toast と同じ文から改行を除いたものを渡す。それ以外は `'failed'` と「GitHub からの読み込みに失敗しました。」を渡す。toast はそのまま。
- 次のものは触らない：updateSyncStatus の本体と既定の文言、保存の失敗（4025）、衝突（4006）、#648 のキャンセルの後（3228・3366）。
- E2E（step2）は、ハブ・GitHub それぞれで通信の失敗と認証切れを1本ずつ、計4本。守りとして、ハブ・GitHub の保存の失敗を2本足す。失敗の注入は、この下見と同じ形でできることを確かめた（4本とも最後まで届いた）。

### 別に回す候補（このイシューでは直さない・②の判断）

1. 起動の読込が通信で失敗した時の文に「次にどうすればよいか」が無い（ui-standards §2-11）。ハブの状態バー「Asayake ハブ からの読み込みに失敗しました。」が該当する。GitHub の toast には「再試行」のボタンがある。直すなら、状態バー・toast・状態の欄の文を1か所で決める形にする（保存の失敗の js/sync-failure.js と同じ形）。
2. GitHub の起動の読込が失敗した後も、状態バーの「最新のデータを確認しています…」が残っていた（上の注2・未確認）。

### ②の決定（2026-11-14 17:53）

- 文言は案A。同じ catch が状態バー・toast にもう出している文を、そのまま状態の欄へ detail で渡す（上の表の4つの文）。
- path は (1)。認証切れの時だけ 'reconnect'、通信の失敗は 'failed' にして「（要再接続）」を付けない。
- (1) で state が 'reconnect' から 'failed' に変わる。そこで step3 では、自動の読み直し（#617）と toast の「再試行」が state の値に頼っていないかをコードで確かめる。online-resync の spec が直した後も緑であることを、ここに書く。頼っていたら、直す前に止めて報告する。
- step2 の spec は6本（4場面と守りの2本）。

## step2 E2E を足し、直す前の版で赤を取る（2026-11-14 17:54〜17:59）

新しい spec：`tests/e2e/boot-load-failure-status.spec.js`（6本）。

- 作り方は online-resync.spec.js（#617）と同じ。1回ふつうに起動し、同期欄が「保存済み」になるのを待つ。その後、模擬より手前の `context.route` で、通信を落とすか 401 を返す形にしてから開き直す。
  - ハブ・通信の失敗：`${HUB_BASE}/**` を `route.abort('internetdisconnected')` で落とす。
  - ハブ・認証切れ：模擬に `hub.deleted = true` を立てる。gate-hub.js の模擬が 401 `{ error: 'invalid key' }` を返す。
  - GitHub・通信の失敗：`https://api.github.com/**` を abort で落とす。
  - GitHub・認証切れ：同じ口で 401 `{ message: 'Bad credentials' }` を返す。gate-github.js の模擬には 401 を返す口が無いので、模擬より手前の route で返した（storage-fakes.js L235 の opts.status は、別の模擬 installFakeGitHub 用）。
  - 守り：同じ口で、読み込み（GET）は通して書き込み（GET 以外）だけを abort で落とす。本の短文メモを書いて保存させる（書き方は online-resync.spec.js と同じ）。
- 見るのは画面だけ：#obsidian-sync-status・#obsidian-sync-path・#app-status-bar・toast の .toast-message。bookshelf._* は読まない。待つのは expect(locator) だけにした。
- 失敗の場面では3つを確かめる：同期欄に「保存できませんでした」が無いこと、決めた文と同じであること、path。expect.soft で並べ、赤の時にどれが違うかを1回で全部出すようにした。

| # | テスト | 確かめること（textContent） | 直す前（a390783＝1c99d78＋docs） |
|---|---|---|---|
| 1 | ハブ・通信の失敗 | 同期欄＝「Asayake ハブ からの読み込みに失敗しました。」・path＝「Asayake ハブ」 | **赤** |
| 2 | ハブ・認証切れ | 同期欄＝「Asayake ハブ の認証が切れました。設定から再接続してください。」・path＝「Asayake ハブ（要再接続）」 | **赤** |
| 3 | GitHub・通信の失敗 | 同期欄＝「GitHub からの読み込みに失敗しました。」・path＝「taro/bookshelf-data@main」 | **赤** |
| 4 | GitHub・認証切れ | 同期欄＝「GitHub との接続に失敗しました。「切断」してから、もう一度「GitHub に接続」をお試しください。」・path＝「taro/bookshelf-data@main（要再接続）」 | **赤** |
| 5 | 守り ハブ・保存の失敗 | 同期欄＝「Asayake ハブに保存できませんでした。通信が戻ったら「再試行」を押してください。」・path＝「Asayake ハブ」 | 緑 |
| 6 | 守り GitHub・保存の失敗 | 同期欄＝「GitHub に保存できませんでした。通信が戻ったら「再試行」を押してください。」・path＝「taro/bookshelf-data@main」 | 緑 |

### 直す前の出力（2回流して同じ。`tmp/653/step2-before.txt` は2回目、1回目は `step2-before-run1.txt`。commit しない）

流し方：`PORT=8153 npx playwright test tests/e2e/boot-load-failure-status.spec.js --project=chromium --workers=3`

```
✘ 1 ハブ: 起動の読込が通信で失敗した時、同期欄は状態バーと同じ読込の失敗の文を出し、path に「（要再接続）」を付けない (16.8s)
✘ 2 ハブ: 起動の読込が認証切れで失敗した時、同期欄は状態バーと同じ認証切れの文を出し、path に「（要再接続）」を付ける (11.6s)
✘ 3 GitHub: 起動の読込が通信で失敗した時、同期欄は toast と同じ読込の失敗の文を出し、path に「（要再接続）」を付けない (19.1s)
✘ 4 GitHub: 起動の読込が認証切れで失敗した時、同期欄は toast と同じ認証切れの文を出し、path に「（要再接続）」を付ける (11.4s)
✓ 5 守り ハブ: 保存の書き込みが通信で失敗した時は、今までどおり同期欄に「Asayake ハブに保存できませんでした。…」を出す (2.4s)
✓ 6 守り GitHub: 保存の書き込みが通信で失敗した時は、今までどおり同期欄に「GitHub に保存できませんでした。…」を出す (2.8s)
4 failed / 2 passed (1.1m)
```

1回目も 4 failed / 2 passed（1.3m）で、赤になったテストと赤の理由は2回目と同じだった。

赤の理由（受け取った値）：

- 1 ハブ・通信：同期欄の `not.toContainText("保存できませんでした")` と `toHaveText("Asayake ハブ からの読み込みに失敗しました。")` が、どちらも Received "保存できませんでした"。path の `toHaveText("Asayake ハブ")` が Received "Asayake ハブ（要再接続）"。
- 2 ハブ・認証切れ：同期欄の2つが Received "保存できませんでした"。path は「Asayake ハブ（要再接続）」で合っている（認証切れは今も 'reconnect'）。
- 3 GitHub・通信：同期欄の2つが Received "保存できませんでした"。path が Received "taro/bookshelf-data@main（要再接続）"。
- 4 GitHub・認証切れ：同期欄の2つが Received "保存できませんでした"。path は合っている。

### 直した後に緑になるかの下見（テストの側に誤りが無いかを見るため）

step1 の案A＋(1) を作業ツリーに一時的に当てて流した（`node tmp/653/trial.mjs A`）。当てた中身は次のとおり。

- ハブ：`_syncErrorMsg` を決めた後に `updateSyncStatus(isAuthErr ? 'reconnect' : 'failed', label, this._syncErrorMsg)` を呼ぶ。
- GitHub：認証切れなら 'reconnect' と toast の文から改行を除いたもの、それ以外は 'failed' と「GitHub からの読み込みに失敗しました。」を渡す。

結果は **6本とも緑**（6 passed・15.1s・`tmp/653/step2-trial-fix.txt`）。流した後に `git checkout -- js/bookshelf.js` で戻し、退避した写しと `cmp` で一致することを確かめた。この commit には直しを入れていない（直すのは step3）。

### lint（新しい spec を足した後）

次の5本は、すべて OK だった。

- lint:e2e-goto：先頭スラッシュ付きの goto が0件。
- lint:e2e-wait：async の waitForFunction・ページ全体を写す待ちが0件。
- lint:e2e-external：遮断を通らない context が0件。
- lint:internal-refs：上限82以内。
- lint:e2e-gate：@gate 41本・違反0件。

## step3 直して緑にし、既存の spec・lint・設計の記述を揃える（2026-11-14 18:00〜18:13）

前の run は 18:02 に、関係する spec を流している途中で止められた（exit 137。同じ時刻に #634 が E2E 全件を流していて、こちらは worker 4本だった）。直しは作業ツリーに未コミットのまま残っていたので、その続きから進めた。関係する spec は worker を2本に減らして流し直した。

### ②の指示3：state を 'failed' に変えても、読み直しと「再試行」は state に頼っていない（コードで確かめた）

- updateSyncStatus（js/bookshelf.js 4137-）は、同期欄の DOM（#obsidian-sync-path・#obsidian-sync-status）を書くだけで、state を this のどこにも残さない。同期欄を読む所は、js/ 全体で updateSyncStatus の中だけだった（`grep -rn obsidian-sync-status js/ index.html`）。
- 自動の読み直し（#617）が見るのは、catch で `_markInitLoadFailed()` が立てる `this._initLoadFailed` と、電波の状態（OnlineWatcher）だけ（`_watchSyncRecovery` の kick → `_retryInitLoad`）。印を立てる条件は、ハブは `!isAuthErr`、GitHub は認証切れ以外の分岐で、どちらも state とは別。直しでもここは変えていない。
- GitHub の toast の「再試行」は `onClick: () => this.initGitHubSync()` で、state を見ない。
- online-resync.spec.js は、直した後に丸ごと流して緑（新しい spec と合わせて 13 passed・44.3s・`tmp/653/step3-online-resync.txt`）。ただし1か所、待つ所を toast に絞った（下の「既存の spec を揃えた所」）。

### 直したこと（commit e34343e）

- js/bookshelf.js（+12/-5）
  - ハブ（_initCloudSyncLoad の catch）：`_syncErrorMsg` を決めた後に `updateSyncStatus(isAuthErr ? 'reconnect' : 'failed', label, this._syncErrorMsg)` を呼ぶ。
  - GitHub（_initGitHubSyncLoad の catch）：認証切れの文を toast と同じ定数 `authMsg` に置き、同期欄には改行を除いたものを 'reconnect' で渡す。通信の失敗は 'failed' と「GitHub からの読み込みに失敗しました。」を渡す。toast はそのまま。
  - 次のものは変えていない：updateSyncStatus の本体と既定の文、保存の失敗（failure.message）・衝突・#648 のキャンセルの後の呼び出し。
- index.html：`js/bookshelf.js?v=2026111721` を `2026111753` にした。origin/main（f9468f8）の最大は 2026111721。開いている他のイシューの値（#634 2026111734・#645 2026111745/46・#657 2026111720/30・#660 2026111760〜62・#662 2026111722）とも重ならない。`npm run check:version -- --range=origin/main..HEAD` は OK。
- docs/char/boot-flow.md §1-5：起動の読込が失敗した時に同期欄へ出す文と、「（要再接続）」の付け方を1段足した。
- 設計書（vault）：04_画面設計書の「設定の同期欄の起動の読込」の行（#648 が足した行）の次に、「設定の同期欄の起動の読込の失敗」の行を足した（333行目）。vault の commit は自動バックアップに任せた。対応づけは、bookshelf の fix の commit の題「(設計: 04_画面設計書 2026-11-14 更新)」。

### 新しい spec：直す前と直した後

| # | テスト | 直す前（step2・a390783） | 直した後（e34343e） |
|---|---|---|---|
| 1 | ハブ・通信の失敗 | **赤**（同期欄 "保存できませんでした"・path "Asayake ハブ（要再接続）"） | **緑** |
| 2 | ハブ・認証切れ | **赤**（同期欄 "保存できませんでした"） | **緑** |
| 3 | GitHub・通信の失敗 | **赤**（同期欄 "保存できませんでした"・path "taro/bookshelf-data@main（要再接続）"） | **緑** |
| 4 | GitHub・認証切れ | **赤**（同期欄 "保存できませんでした"） | **緑** |
| 5 | 守り ハブ・保存の失敗（「Asayake ハブに保存できませんでした。…」） | 緑 | 緑 |
| 6 | 守り GitHub・保存の失敗（「GitHub に保存できませんでした。…」） | 緑 | 緑 |

直した後の出力（`tmp/653/step3-after.txt`）：6 passed（12.1s）。online-resync.spec.js と一緒に流した2回目も、6本とも緑だった。

### 関係する spec（13ファイル・chromium・worker 2本）

対象は、step の detail の7ファイルに、`git grep -l -e obsidian-sync-status -e 読み込みに失敗 -- tests/e2e` で出たファイルを足したもの。book-memo-file-lifecycle・first-run-init-status・first-run-save-during-init-empty・gate/j1-3-connect-local・gate/j6-1-local-restart・gate/j6-3-hub-other-device・gate/j6-5-sync-failure・load-conflict-unsaved・online-resync・save-failure-visible・shelf-file-delete・sync-first-connect・sync-offline-reconnect。

- 1回目（`tmp/653/step3-related.txt`）：**93 passed・6 failed**（6.0m）。
  - online-resync.spec.js:110（GitHub）は **直しのせいで落ちた**。`strict mode violation: getByText('GitHub からの読み込みに失敗しました') resolved to 2 elements`。同期欄にも toast と同じ文が入ったので、ページ全体の getByText が2つに当たった。アプリの誤りではなく、spec の待つ所が広すぎた。
  - 残りの5本は、GitHub・ローカルへの保存が届かないか、設定が開かない、という落ち方。book-memo-file-lifecycle.spec.js:253・203・234 は「本 B0MEMO5941 が保存先に届く」が Received undefined か、#settings-modal の待ちの時間切れ。save-failure-visible.spec.js:149（GitHub）は not.toBeNull に null。shelf-file-delete.spec.js:135（GitHub）は「本棚「消す本棚」が保存先の一覧に届く」に null。どれも起動の読込の失敗を通らない。
- 既存の spec を揃えた所（commit f96fb9d）：online-resync.spec.js L136 の待ちを `page.locator('.toast-message', { hasText: 'GitHub からの読み込みに失敗しました' })` に絞った。確かめる中身は変えていない。
- 流し直し（`tmp/653/step3-rerun-fix.txt`）：落ちた6か所を行で指定して流した。同じ行の3つの保存先の版も一緒に走り、**25 passed**（1.1m）。online-resync:110 は絞った後で緑。残りの5本は流し直すと緑なので、1回目は負荷による揺れと見た（同じ時刻に #634 が E2E 全件を流していた）。

### vitest・lint

- `npm test`：Test Files 79 passed（79）・Tests 1181 passed | 2 todo。
- `npm run lint`：**12 本中 0 本失敗**。中身は lint:copy・lint:terms・lint:css・lint:e2e-goto・lint:e2e-wait・lint:e2e-external・lint:breakpoint・lint:esc・lint:js-color・lint:internal-refs（上限82以内）・lint:e2e-gate・lint:known-red。

### step4（載せ直し）で見ること

- #657（作業中・step4）が、設定の同期欄に `#sync-state-row`（3つの保存先に共通の状態の行で、ハブ・GitHub でも見える）を足している。updateSyncStatus は、`_applySyncStatus`（今の本体）と `_renderSyncState` に分けている。2つの catch には触れていないので、文字がぶつかるのは index.html の ?v= の行だけの見込み。vault の 04_画面設計書は、もう #657 の中身（状態の行はハブ・GitHub でも見える）になっている。
- #657 が先に入ったら、step4 で新しい spec と online-resync を流し直し、同期欄の文と path が同じかを確かめる。#657 で同期欄が見えるようになると、この直しは画面にも出る。

## step4 載せ直し・main との全件比較（2026-11-14 18:13〜18:30・push の前に止まる）

### 載せ直し

- `git fetch` の後、origin/main 36cf113 へ rebase した。1c99d78 から8件入っていた（#645 5件・#622 2件・#656 1件）。#657 はまだ入っていない。
- ぶつかったのは、見込みどおり index.html の `js/bookshelf.js?v=` の1行だけ（origin/main は 2026111746）。2026111753 を残した。origin/main の最大は 2026111746 で、開いている他のイシューの値（#634 2026111734・#657 2026111720/30・#660 2026111760〜62・#662 2026111722・#665 2026111763・#667 2026111780）とも重ならない。js/bookshelf.js は手を入れずに載った。2つの catch は L3266（ハブ）・L3396（GitHub）。
- `npm run check:version -- --range=origin/main..HEAD` は OK。
- 載せ直した後の sha：1971863（step1 docs）・e844987（test）・6cb8c63（fix）・7ffde72（online-resync の待ち）・fd11479（step3 docs）。

### 載せ直した後の流し直し

- 新しい spec と online-resync.spec.js：**13 passed**（1.1m・`tmp/653/step4-after-rebase.txt`）。
- step3 の関係する spec（13ファイル）は、下の全件比較の work 側に全部入っている。新しく落ちたものは無い。

### origin/main との全件比較（`node scripts/verify/e2e-diff-main.mjs --port=8153 --out=tmp/653/e2e-diff`・18:15〜18:29）

base は origin/main 36cf113、work は作業ツリー（HEAD fd11479）。E2E は base 1634本・work 1640本で、work は新しい spec の6本だけ多い。除外は既定の sort-perf-budget だけ。

| | 新しく落ちた | 新しく通った | 両方で落ちた |
|---|---|---|---|
| E2E（playwright） | **0件** | 5件 | 2件 |
| Unit（vitest） | **0件** | 0件 | 0件 |

- 新しく通った5件は、どれも base 側で落ちたもの。今回の直しが触る起動の読込の失敗は通らない。
  - book-memo-file-lifecycle（GitHub・使えない文字と空白を含む題名）
  - focus-trap-deeplink（パレットの Tab 20回）
  - reimport-diff 2件
  - save-failure-visible（GitHub・再試行が尽きた失敗）
  - step3 でも、同じ時刻に他のイシューの全件が流れていると、この種類（保存が届かない・時間の掛かるもの）が揺れた。base 側の揺れと見る。
- 両方で落ちた2件は、913冊を使う重いテスト。負荷で時間の基準を超える種類で、base でも落ちている既存の問題。
  - gate/j3-5-many-books（@gate J3-5）
  - list-staged-render（#401 並べ替えの段階描画 913冊）
- 画像の差分（work 側のみ）：**0件 / 54件**。
- 結果一式は `tmp/653/e2e-diff/`（report.md・report.json・base/work の JSON。commit しない）。

push はしていない。②の判断で止まる。
