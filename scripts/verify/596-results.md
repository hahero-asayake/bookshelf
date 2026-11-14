# イシュー#596 結果の記録

## step1 着手条件と再現 (2026-11-14 05:45〜05:50)

### 着手条件
- origin/main に #592 の commit 2678256 (`Issue: #592`) が入っていることを確認した。worktree `issue/596` を 66d9ac4 から origin/main の 06f7afd へ fast-forward。
- #592 で入ったもの: `SyncConfigManager.setMethod(method)` (js/sync-config.js)、`_recordLocalSyncChoice()` (js/bookshelf.js:3155 付近。`syncMethod==='local'` かつ `!isConfigured()` の時だけ `setMethod('local')`。initObsidianSync で保存済みフォルダが見つかった時と、selectObsidianFolder で呼ぶ)、`_applySyncMethodView` / `_showSyncPanel` (js/screens/settings.js)。tests/unit/sync-config.test.js (2件)・tests/e2e/sync-first-connect.spec.js (5件) も #592 で追加済み。

### 再現 (chromium ヘッドレス・1280x800・PORT=8196・画面の操作で通す)
使い捨ての spec: `tests/e2e/repro-596.spec.js` (commit しない。写しは `_artifacts/596-step1/`)。ハブと Google ログインは既存の模擬 (tests/e2e/helpers/gate-hub.js の mockHubForTest / mockHubSessionForTest / mockGoogleSignInForTest) を使った。

| 経路 | 操作 | 操作の前 | 操作の後 | 再読込の後に設定の同期を開いた時の #sync-method-select | 再現 |
|---|---|---|---|---|---|
| 対照 | 何もしない初回 | キー無し・isConfigured=false | — | `hub` | (正しい動き) |
| (a) ハブにログインしただけ | 設定 → アカウント → 規約に同意 → 「Google でログイン」 | キー無し・isConfigured=false | キーあり・method=`local`・hub.key あり・isConfigured=**true** | `local` (この端末のフォルダ・「まだ選んでいません」) | **再現した** |
| (b) 公開先を選んだだけ | `#/publish/settings` → 「公開先の変更」を開く → 公開先を GitHub に | キー無し・isConfigured=false | キーあり・method=`local`・publish.target=github・isConfigured=**true** | `local` | **再現した** |
| (c) トークンを更新しただけ | (操作なし・コードで判定) | — | — | — | **未決の状態からは到達しない** (下記) |

スクショ: `_artifacts/596-step1/control-sync-select.png`・`a-hub-login-sync-select.png`・`b-publish-target-selected.png`・`b-publish-target-sync-select.png`

(c) の根拠:
- トークン更新 `_ensureFreshGitHubToken` は `github.refreshToken` が無いと何もしない (js/bookshelf.js:3009 `if (!gh.refreshToken) return !force;`)。
- `github.refreshToken` を書くのは GitHub 接続 `_connectToGitHub` だけ (js/screens/settings.js:657)。同じ所で `method='github'` を書く (settings.js:652 付近・保存は :662)。ほかの `refreshToken:` は更新そのもの (bookshelf.js:3020・github-auth.js:200) と切断で空にする所 (settings.js:716)。
- だから更新が走る時は、決める操作で作られたキーが必ず既にある。今の判定 (キーの有無) では、更新で isConfigured が false→true に変わることは無い。ただし B案で「印のないキー」が残る人 (下の移行) では、更新の save が印を立てないことをテストで確かめる価値はある (step3 の (c))。
- 同じ理由で、ほかの書き手 (hub-auth.js:162 refreshUsage・:186 setUsername・:201 disconnect、settings.js:447/:455 公開先 repo、bookshelf.js:5376 lastPublishedTarget) も、ログインかトークンが先に要る＝キーを一から作る入口ではない。**キーを一から作る入口は (a)(b) の2つ**。

### 書き手の分類 (origin/main 06f7afd・#592 の後の行番号)
| 書き手 | 行 | 何を書くか | 分類 |
|---|---|---|---|
| ハブのログイン `_exchange` | js/hub-auth.js:126 | hub.* | 決めない (入口 (a)) |
| `refreshUsage` / `setUsername` / `disconnect` | js/hub-auth.js:162 / :186 / :201 | hub.* | 決めない |
| 公開先 repo の選択 | js/screens/settings.js:447 / :455 | publish.owner/repo | 決めない |
| 公開先 target の選択 | js/screens/settings.js:467 | publish.target | 決めない (入口 (b)) |
| トークン更新 | js/bookshelf.js:3024 | github.token 等 | 決めない |
| 公開先の記録 | js/bookshelf.js:5376 | publish.lastPublishedTarget | 決めない |
| 保存先セレクトで local へ切替 | js/screens/settings.js:121 (`setMethod('local')`) | method=local | 決める |
| GitHub 接続 | js/screens/settings.js:662 | method=github + token | 決める |
| GitHub の repo を「この設定で使う」 | js/screens/settings.js:1461 | method=github + repo | 決める |
| ハブを「この設定で使う」`_useHub` | js/screens/settings.js:1407 (`setMethod('hub')`) | method=hub | 決める |
| フォルダが決まった `_recordLocalSyncChoice` (#592) | js/bookshelf.js:3156 (`setMethod('local')`) | method=local | 決める |
| GitHub の切断 | js/screens/settings.js:722 | method=local・token 等を空 | 切断 (境界) |
| ハブの切断 (method が hub だった時) | js/screens/settings.js:1396 | method=local (hub は disconnect で空) | 切断 (境界) |

### 境界の扱い (②の叩き台: 自分で local に切り替えた人=決めた扱い、切断して local に戻った人=決めていない扱い)
これから書かれるデータでは、印で見分けられる: 切替 (settings.js:121) は印を立て、切断 (:722 / :1396) は印を外す (消す)。

すでに保存されているデータ (印が無い・method=local・フォルダ無し) では、**全部は見分けられない**。保存されている形:
| 人 | method | hub.key | github.token | 見分け |
|---|---|---|---|---|
| ハブから自分で local に切替 (settings.js:121) | local | あり (残る) | 無し* | (a) ハブにログインしただけ、と**同じ形** |
| GitHub から自分で local に切替 (settings.js:121) | local | — | **あり (残る)** | 見分けられる (汚染の経路は github.token を書かない) |
| GitHub を切断 (:722) | local | — | 空 | (b) 公開先を選んだだけ、と**同じ形** (repo を選んでいた人は owner/repo が残るので見分けられる) |
| ハブを切断 (:1396) | local | 空 | — | (b) と**同じ形** |
| (a) ハブにログインしただけ (汚染) | local | あり | 無し | — |
| (b) 公開先を選んだだけ (汚染) | local | 無し | 無し | — |
(* GitHub もつないでいた人は github.token もある)

選べる案と、起きること:
- **M1 (印の無い local・フォルダ無しは全部「決めていない」)**: 汚染された人は全員直る。代わりに、自分で local に切り替えたがフォルダをつないでいない人も、設定の保存先セレクトの初期表示がハブになる (表示だけ・method は変えない・フォルダをつなげば次の起動で印が立つ)。切断した人は叩き台どおり「決めていない」。規則は1つ (フォルダの有無だけ)。
- **M2 (M1 に加えて、github.token が残っている人は「決めた」)**: GitHub から自分で切り替えた人は叩き台どおり「決めた」のまま。ハブから切り替えた人は (a) と見分けられないので「決めていない」。GitHub もつないだままハブを使い、ハブを切断した人は「決めた」になる (叩き台と逆・まれ)。規則が2つになる。
- **M3 (印の無い既存データは全部「決めた」=今の動きのまま)**: 既存の人の表示は何も変わらない。代わりに、すでに汚染された人は直らない (新しく書かれる分だけ直る)。

推奨: **M1**。理由: 表示だけの変化で method もデータも変えない。表示が変わるのは「local を選んだがフォルダが無い=実際には保存先につながっていない」人に限られ、その人にハブを最初に見せるのは ADR-056 追補2 の趣旨どおり。M2 は見分けの効く範囲が狭く (ハブからの切替は救えない)、規則が増える。bookshelf は未公開で既存の利用者は少ない (ADR-006)。

### 実装の形 (B案・step2 で確定)
- 印は bookshelf_sync の中の1フィールド (仮名 `methodChosen: true`)。立てるのは「決める」専用のヘルパー1つ。#592 の `SyncConfigManager.setMethod(method)` をそのヘルパーにする (印も一緒に立てる) のが最小: 既に settings.js:121・:1407・bookshelf.js:3156 が使っている。GitHub の2か所 (settings.js:662・:1461) は method と接続情報を一緒に書くので、同じヘルパーに「設定を丸ごと渡して method と印を書く」形を足して寄せる。
- 切断 (:722 / :1396) は印を外す (叩き台どおり「決めていない」)。
- isConfigured() = 印あり、または「method が hub/github」(既定は local なので hub/github は決める操作でしか書かれない＝印の無い既存データの移行を兼ねる)。M1 なら local は印だけで判定する。
- #592 の `_recordLocalSyncChoice` は `!isConfigured()` を見ているので、新しい isConfigured に変わると (a) で汚染された人にもフォルダがあれば印が立つ (method は local のまま)。method が hub/github の人は isConfigured()=true なので書かない (#592 の「上書きしない」と同じ)。
- 決めない書き手 9 か所は直さない。

## step2 印の実装と既存利用者の移行 (2026-11-14 05:50〜05:55・②決定: B案・境界 M1)

### 変えたこと (commit fb59ea3)
- js/sync-config.js
  - `isConfigured()`: キーの有無 → 「`methodChosen === true`、または method が hub/github」。JSON が壊れていたら false。
  - `setMethod(method, base?)`: 決める操作専用の書き込み。method と `methodChosen: true` を一緒に保存する。base を渡すとそれを土台にする (GitHub の接続情報と一緒に書く時)。
  - `resetMethod(base?)` (新設): 切断用。method を local にし、`methodChosen` を消す。
  - 冒頭の設定形式の説明に `methodChosen` を足した。
- js/screens/settings.js: GitHub 接続 (`_connectToGitHub`)・GitHub の「この設定で使う」(`_saveGitHubRepo`) を `setMethod('github', merged)` に、GitHub の切断 (`_disconnectGitHub`)・ハブの切断 (`_disconnectHub`・method が hub だった時) を `resetMethod` に付け替えた。local 切替 (:121)・`_useHub` は #592 で既に `setMethod` を使っているのでそのまま印が立つ。
- js/bookshelf.js: `_recordLocalSyncChoice` のコメントだけ直した (判定は isConfigured() のまま=印の無い local でもフォルダがあれば印を立てる。移行はこの1か所・#592 の補正と同じ場所)。
- index.html: ?v= を sync-config.js・bookshelf.js・screens/settings.js とも 2026111596 に上げた (origin/main の最大 2026111499 より新しい)。並行イシューが次に選びやすい 2026111500 を避けた = 同じファイルに同じ値が入って rebase で黙って重なる事故を避けるため。
- 決めない書き手 9 か所 (hub-auth.js:126/162/186/201・settings.js:447/455/467・bookshelf.js:3024/5376) は無改修。

### isConfigured() の他の読み手
- js/screens/settings.js `_applySyncMethodView` (:82): 新しい定義でそのまま正しい (決めていない人はハブ表示)。
- js/bookshelf.js `_recordLocalSyncChoice` (:3155): 上記のとおり。method が hub/github の人は書かない。
- js/dashboard.js `_computeSyncDone` (:373): 変更不要。決めていない local は以前も「フォルダが無いので未完了」だった。印の無い local でフォルダがある人は、起動時の initObsidianSync → `_recordLocalSyncChoice` で印が立ってから案内の手順1が計算し直される (#592 の「フォルダはあるがキーが無い人」と同じ流れ)。

### 確かめたこと
- `npm test`: 69 ファイル・1041 件 passed (2 todo)。tests/unit/sync-config.test.js (#592 の2件) もそのまま緑。
- `tests/e2e/repro-596.spec.js` (使い捨て) を修正後に流した: (a) ハブにログインしただけ → キーは method=local で作られるが isConfigured=false・再読込後のセレクト=`hub`。(b) 公開先を選んだだけ → 同じく isConfigured=false・セレクト=`hub`。対照は変わらず `hub`。
- #592 の `tests/e2e/sync-first-connect.spec.js` 5件: 緑。
- 保存先セレクトに触れる既存 E2E (smoke・ux-h-series・ux-p2-settings・account-billing・overlay-front・gate/j7-account-delete): 46 passed・1 skipped。
- `npm run check:version -- --range=origin/main..HEAD`: OK。

### 気づいたこと (範囲外・未実測)
- `_disconnectGitHub` は、method が hub の人 (公開のためだけに GitHub をつないだ人) が GitHub を切断しても、保存先を local に戻す (修正前からの動き)。#596 では method の書き換えは変えず、切断なので印も外す (=決めていない扱い)。ハブを使っている人の保存先が GitHub の切断で local に変わること自体が意図どおりかは別に確かめる価値がある。

## step3 テストと回帰 (2026-11-14 05:55〜06:14)

- 新しい E2E `tests/e2e/sync-chosen-mark.spec.js` (7件・緑): (a) ハブのログインだけ・(b) 公開先の選択だけ → isConfigured=false・再読込後のセレクト hub。(c) 印の無い local・期限切れトークン・公開先 GitHub で公開の書き出し → `同期先が未接続です` で止まりトークン更新は起きない (exporter.js の `_isSyncReady` が local にはフォルダを要求・bookshelf.js:2837)・印は立たない・セレクト hub。(d) 印の無い hub / github → method そのまま・isConfigured=true。印の無い local+フォルダ → 起動時に印が立つ・method は local のまま。(e) ハブの「この設定で使う」→ 印が立つ・method hub。
- (c) について: 決めていない人 (印の無い local) はフォルダが無いので公開の書き出しがトークン更新の前で止まる。フォルダがあれば起動時に印が立つ。だから「決めていない人のトークン更新」は新しい設計では起きない。更新の保存が印を立てないこと自体は単体テスト (決めない書き込みで印が立たない) で確かめた。
- 単体 `tests/unit/sync-config.test.js` に 12件追加 (isConfigured の規則の表・壊れた JSON・決めない書き込み・resetMethod)。`npm test` 1053 passed。
- #592 の `tests/e2e/sync-first-connect.spec.js` 5件: 緑。
- e2e-diff (`_artifacts/596-e2e-diff/report.md`・base=origin/main 01a8bf0): 1回目は「リグレ 11件」+ 画像差分 6件 (設定の1節)。原因は全部同じで、テストの前提が `bookshelf_sync={method:'local'}` (印なし・フォルダ無し) を置いて設定の同期でローカルのパネルの「フォルダを選ぶ」を押す形だったこと。#596 (M1) ではこの形は「決めていない」=ハブのパネルが出る。前提を `{method:'local', methodChosen:true}` (この端末のフォルダに決めた人) に直した (shelf-file-delete・book-memo-file-lifecycle・helpers/gate-local.js・tests/visual/screens.spec.js・commit 920e32e)。直した後: 3ファイル 37 passed (4 skipped は元から)・画像比較「設定の1節」6件 passed (基準画像は更新していない)。残り2件は reimport-diff の flake 1件 (流し直しで通過) と、sync-chosen-mark (c) の判定不能 1件 (e2e-diff の実行中に spec を書き換えたため・単独で緑)。
- `{method:'local'}` を置いている他の E2E (active-filter 等十数件) は、ローカルのパネルを使わないので e2e-diff で落ちていない (前提は変えていない)。

## step4 設計書と push 前の状態 (2026-11-14 06:15〜06:24・利用上限で中断 → 13:30〜13:47 にやり直し)

### 設計書 (obsidian `80_🚀project/81_🚀development/bookshelf/`)
- 03_詳細設計書 SyncConfigManager: `isConfigured()` を「決めた印あり、または method が hub/github」に書き換え、`setMethod(method, base?)`・`resetMethod(base?)` を足した。#592 の古い `setMethod(method)` の行は消して1つにまとめた。
- 06_データ仕様書 §同期設定 bookshelf_sync: `methodChosen` の意味・立てる操作・切断で外すこと・決めない書き込みでは立たないこと・印の無い local の扱いを書き、JSON 例に足した。
- 08_意思決定記録 ADR-056 追補4: キーの有無の判定が決めない書き手 9 か所で崩れた経緯、印の導入、境界 M1 とその理由 (3つ)、M2 を採らなかった理由。
- 07_残検討事項: 該当行なし (変更なし)。
- obsidian の commit: 3d51eb6e (03/06/08)・361ab939 (03 の古い行の整理)。03 には他イシュー (#616・#620) の未 commit の行が同居していたので、自分の行だけを stage した。

### rebase (13:31・origin/main 15b0f9e へ)
- 衝突は index.html の ?v= 2行だけ (sync-config.js・bookshelf.js。#616 が 2026111561 に上げていた)。自分の値 2026111596 を残した (origin/main の最大 2026111561 より新しい・2026111596 は origin/main に無い)。js/sync-config.js・js/bookshelf.js は自動で両方残った (#616 の destinationKey / markConflict / conflict / clearConflict と、#596 の isConfigured / setMethod / resetMethod)。
- `isConfigured()` の読み手が #616 で1つ増えた: `SyncConfigManager.save()` の `before` (保存の前の保存先の鍵。決めていなければ null)。印の無い local では null になり衝突中の印を外すが、衝突中の印はハブ・GitHub の衝突でしか立たない (js/bookshelf.js `StorageAdapter.isRemoteConflict` の経路) ので動きは変わらない。#616 の単体テスト (tests/unit/sync-conflict.test.js) も緑。
- fix の commit の件名を `(設計: 03/06/08 2026-11-14 更新)` に直した (中身は同じ・木は直す前と一致)。

### 確かめたこと (rebase 後・HEAD の木は d3c6b26 と同じ)
- `npm test`: 73 ファイル・1088 passed (2 todo)。
- CI の lint 11本 (css・e2e-goto・e2e-wait・breakpoint・esc・js-color・internal-refs・e2e-gate・copy・terms・known-red): 全部 OK。`check:version --range=origin/main..HEAD`: OK。
- e2e-diff 3回目 (`_artifacts/596-e2e-diff-3/report.md`・base=origin/main 15b0f9e): E2E 新しく落ちた 2件はどちらも flake (流し直し 3回とも緑: reimport-diff の1件・shelf-file-delete の GitHub の1件)・regression 0件・判定不能 0件・両方で落ちた 0件。vitest 新しく落ちた 0件。画像比較 0件 / 54件。
- e2e-diff 2回目 (06:15・base=a245035・`_artifacts/596-e2e-diff-2/`): 新しく落ちた 0件・画像比較 0件 / 54件。
- 門のE2E の webkit レグ (`GATE_WEBKIT=1 E2E_SKIP_KNOWN_RED=1 --project=gate-webkit --workers=1`): 25 passed。
- この後 origin/main が1つ進んだ (bd610ea・門のE2E J2-2/J2-5 の投入・テストだけ・自分のファイルと重なり無し)。step5 でもう一度 rebase する。
