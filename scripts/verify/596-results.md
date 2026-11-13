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
