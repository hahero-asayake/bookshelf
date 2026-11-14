# 起動フロー整理（イシュー#519・step2：洗い出し＋設計）

基準：worktree issue-519、HEAD=93188cd（=origin/main、#518完了直後）。行番号はこのHEAD基準。

## 1. 起動の順番と依存（表）

### 1-1. 起動前提

`#loading`（index.html:171）は **JSが表示するのではなく、HTML初期状態で既に表示されている**（CSS `.loading{display:flex}`、inline styleなし）。`showLoading()`（bookshelf.js:15174）は定義されているが呼び出し元が無い＝実質「消す専用」。起動中は常にローディングが見えている状態から始まり、`hideLoading()`（15187）が呼ばれた時点で初めて消える。

### 1-2. `init()`（bookshelf.js:359-485）の時系列

| # | 処理 | 行 | 同期/非同期 | 備考 |
|---|---|---|---|---|
| 1 | `loadData()` | 361 (await) | async | `bookManager.initialize()`・`config.json` fetch・`_hasLocalUserData`（localStorageに`virtualBookshelf_userData`があるか）を確定（508） |
| 2 | イベントリスナー・ヘッダー・ダッシュボード生成・一覧描画・ペイン初期化 | 362-377 | 同期 | ローカルデータ（あれば）をこの時点で描画。ネットワークは絡まない |
| 3 | `finishStartup`・`startRouter` を関数定義 | 413, 455 | - | まだ呼ばれない。定義のみ |
| 4 | **2段分岐**（`_hasLocalUserData`、467） | | | C-277 |

### 1-3. 2段分岐の内訳

| ケース | 順番 | ローディング | confirmが出る瞬間の画面状態 |
|---|---|---|---|
| **データ有り**（467-474） | `startRouter()`→`hideLoading()`→（裏で）`finishStartup()`→(finally)`_syncChecking=false` | 即座に消える（確認を待たない） | 画面は通常表示済み・router起動済み。confirmDialogは通常操作中に割り込むモーダルと同じ見え方 |
| **データ無し**（475-478） | `await finishStartup()`→`startRouter()`→`hideLoading()` | **finishStartup完了まで表示されたまま** | ローディング表示の最中にconfirmDialogが出る（router未起動・プラグイン未読込） |

### 1-4. `finishStartup`（413-454）内の時系列

| # | 処理 | 行 | 備考 |
|---|---|---|---|
| 1 | `initSync()` (await) | 415 | → `initCloudSync`/`initGitHubSync`/`initObsidianSync`のいずれか1つ（3464-3471） |
| 2 | 記事モデル移行（`migrateFromLegacyIfNeeded`） (await) | 425-434 | `_isSyncReady()`時のみ |
| 3 | プラグイン読込（`ensureStandardPlugins`→`loadEnabledPlugins`） (await) | 435-453 | `_setLoadingSub()`で進捗テキスト更新（438, 445） |

### 1-5. `initCloudSync`/`initGitHubSync`内、confirmが出る位置（3475-3531, 3600-3651）

両関数とも同じ構造：`updateSyncStatus('loading')` → `detectFormat()` (await、ネットワークI/O) → **`format === 'empty'`の時だけconfirm** → `initEmpty()`/`loadAll()` (await) → 描画更新。confirmは`detectFormat()`の結果を待った後、同期本体処理の手前に出る。

この読込の間 (confirmが出ている間も含む) は `_beginBootLoad()` で印を立て、保存 (`syncToObsidianFolder()`) は入口の `_waitBootLoads()` で読込が終わるまで待つ (ローカルの`selectObsidianFolder`も同じ)。初期化の途中に本を足しても、保存が保存先を「空」と見て2回目の `initEmpty()` を呼ばない (イシュー#643)。

同期欄（`#obsidian-sync-status`）は、confirmを待つ間と`initEmpty()`→`loadAll()`の間も`'loading'`（「読み込み中...」）のままで、読込の後に`'synced'`（「HH:MM:SS 保存済み」）になる。失敗の表示（`'reconnect'`＝「保存できませんでした」・「… (空)（要再接続）」）はconfirmでキャンセルした時だけ出す。confirmの前に出すと、読込が終わるまで「保存できませんでした」が残っていた（イシュー#648・`tests/e2e/first-run-init-status.spec.js`）。

## 2. #518 attempt1で8件落ちた原因（実機再現で確定。推測ではない）

### 2-1. 再現条件と手順

issue-519 worktree（HEAD=93188cd、origin/main相当）で `js/bookshelf.js:3492`・`3614` の2か所だけを一時的に`confirm()`→`await window.confirmDialog({message:...})`に変更し（実験用・**作業後に`git diff`差分0まで元に戻し済み**）、`PORT=8119 playwright test tests/e2e/preview-real-adapter.spec.js -g "通常応答" --timeout=25000`を実行。

### 2-2. 実機で確認した事実

```
Error: page.click: Test timeout of 25000ms exceeded.
  - waiting for locator('#art-new')
  - <div data-layer="1" data-ov-size="sm" class="cfm-overlay" data-ov-kind="dialog">…</div> intercepts pointer events
  （46回以上リトライ後にタイムアウト）
```

- `#art-new`への`page.click()`が、画面に残り続ける`.cfm-overlay`（起動時confirmDialog）に`intercepts pointer events`としてブロックされ続け、25秒のタイムアウトで失敗した。
- **原因はローディングとのz-index競合ではない。** `.cfm-overlay`は`z-index: var(--ov-z-dialog)`=1800（css/bookshelf.css:7590, 8279）で明示的なスタッキングコンテキストを持ち、`.loading`（2580、z-index指定なし=auto）より常に前面に出る。CSS解析でも、実機でも、確認ダイアログは正しく最前面に描画されクリック可能だった（ハングしたのは別のUI操作`#art-new`であり、confirmDialog自身は正常に表示されている）。
- **原因は「テストが起動時confirmに一切応答していない」こと。** 旧`confirm()`はPlaywrightが未処理のネイティブdialogイベントを既定で自動キャンセルする（Playwrightの仕様）ため表面化していなかった。`confirmDialog`はDOM要素なので、この自動キャンセルの対象にならず、画面に残り続けて後続操作をブロックした。
- about:blank/about:srcdoc sandboxedの警告は、この7件（preview-real-adapter 4・publish-conflict-hub 3）には出ていない。about:blank警告が出るのはcritical-path.spec.js 1件のみで、原因は起動時confirmと無関係（MutationObserverが`document`全体を`subtree:true`で過剰監視し、記事プレビューiframeの`cloneNode`+`replaceWith`と干渉したこと。#518のdocs/char/u5-inventory.md §8-3で確定済み、本番コードの修正は不要）。

### 2-3. この結果が意味すること

**起動の順番（ローディング→同期→描画）自体は、confirmをasync化しても壊れない。** 壊れていたのはE2Eテストの前提（ネイティブdialogの自動キャンセルに暗黙的に依存）であり、テスト側が確認画面に正規に応答すれば、起動順序を変えずに解決できる可能性が高い（実装・確認はstep3で行う）。

## 3. 設計案（2案＋現状維持案、比較軸つき）

比較軸：①ローディングとの重なり順　②確認待ち中の操作可否　③2段起動分岐との整合　④E2Eの経路を変えずに通せるか

| 案 | 内容 | ①重なり順 | ②操作可否 | ③2段起動との整合 | ④E2E経路 |
|---|---|---|---|---|---|
| **A（推奨）起動順序は変えない。confirmDialogのz-indexレイヤーに任せる** | `initCloudSync`/`initGitHubSync`内のconfirmをそのままconfirmDialogに置き換えるだけ。起動の分岐・タイミングは一切変更しない | 問題なし（§2-2で実測確認済み。`--ov-z-dialog`が`.loading`より常に上） | データ無し端末では「ローディング表示中に確認ダイアログが操作可能な状態で乗る」見た目になる（router/プラグイン読込はまだ動いていない）。データ有り端末では通常操作中の割り込みと同じ見た目 | 変更ゼロ（既存のコード分岐・呼び出し順をそのまま使う） | 変える必要なし。テスト側がダイアログに正規応答すれば通る（§2-3） |
| **B 確認を同期初期化の前段へ切り出す** | `detectFormat()`による空判定とconfirmを`initSync()`より前の独立ステップに分離し、ローディングを出す前に確認を終えてから本処理に入る | `detectFormat()`自体がネットワークI/O（API呼び出し）を伴うため、ローディングを出す前にその待ち時間が生まれ、現状「即座にローディングを出す」設計（C-277のコメント「一瞬見せないよう」）の意図と矛盾する真っ白な時間ができる | 確認完了後は同じ | `initSync()`の内部構造（hub/github/obsidianの3分岐・detectFormat呼び出し）を外へ引き出す必要があり、同期ロジックの保守コストが上がる | 経路が変わる（確認が出るタイミングが変わるため既存テストの前提が変わる）→②指示が避けたい方向 |
| **C 確認直前にローディングを一時的に下げ、応答後に戻す**（計画時の仮説。z-index確認の結果、不要と判断） | confirm直前に`hideLoading()`、応答後に`showLoading()`し直す | §2-2の実測で、そもそも重なりは問題なかった（confirmDialogは常に最前面）ため、この操作に実質的な効果がない | 変化なし | `showLoading`/`hideLoading`の呼び出しをconfirm前後に追加する必要があり、2段分岐の両ケースに手を入れる箇所が増える | 効果が無いのに複雑さだけ増える |

### 3-1. 推奨：案A

§2の実機確認により、「ローディングと確認の重なり順」はCSSのダイアログ帯（`--ov-z-dialog`）が既に解決しており、起動の順番を変える必要が無いと判明した。#518 attempt1で8件落ちた本当の原因は起動フローの設計ではなくE2Eテスト側の前提だったため、本イシューでの実装（step3）は「起動順序はそのまま・2か所をconfirmDialogへ置き換え・E2Eは`.cfm-overlay`に正規に応答する形へ書き換え」で完了条件を満たせる見込み。

### 3-2. 実装時に確認すべき残り懸念（step3以降で潰す）

- データ無し端末のケースで、`await finishStartup()`の中で`confirmDialog`のPromiseがpendingのまま長時間放置された場合（ユーザーがダイアログに気づかない等）、ローディング表示も一緒に残り続ける。これは現状のネイティブ`confirm()`でも同じ挙動（ブロッキングで同様に放置されうる）であり、今回の変更で新たに生まれる問題ではない。
- E2E側の書き換え方針：MutationObserverでの自動応答は避ける（#518 attempt1 edec439で悪化した経緯があるため）。`.cfm-overlay .cfm-ok`／`.cfm-cancel`を明示的にクリックする既存パターン（critical-path.spec.js・reimport-diff.spec.js・tests/e2e/char/bookdetail.spec.jsで採用済み）に倣う。起動時confirmが出うるテスト（preview-real-adapter.spec.js・publish-conflict-hub.spec.js・startup-background-sync.spec.js・plugin-seed.spec.js・reimport-diff.spec.js）を対象に、起動直後に`.cfm-overlay`が出たら即OKを押す処理を**起動ヘルパー内**（例：`bootApp`/`bootAppGitHub`等の共通関数）に1か所だけ足す（テストケース本体に個別実装しない）。
- `plugin-seed.spec.js`は#518 u5-inventory.md §5の記載どおり文言アサーション（`dialogs[0]).toContain('新規データで初期化')`）を含む。confirmDialog化後はネイティブdialogイベントが発火しないため、`.cfm-overlay`内のテキスト要素を見るアサーションに書き換える必要がある（文言自体は変えない。アサーションの取得先だけ変える）。

## 4. 次ステップ（step3）への申し送り

- 置き換え対象：`js/bookshelf.js:3492`（initCloudSync）・`3614`（initGitHubSync）の2行のみ。周辺の`// U5 対象外`コメント（3490, 3612）を外す。
- 起動順序・2段分岐コードは変更しない（案A）。
- E2E側は上記5ファイルを対象に、起動ヘルパー内で`.cfm-overlay`への正規クリック応答を1か所に集約する。
