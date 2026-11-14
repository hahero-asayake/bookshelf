# U5 step1：棚卸し（保存表示・confirm・空/失敗表示・dialog前提テスト）

- 基準：worktree issue-518、HEAD=79ff2b0（=origin/main、U4完了直後）。
- **注記**：計画フェーズでの実測（行番号 1583, 3628, 3749…）は、計画時に `/home/sei/GitHub/bookshelf`（メインチェックアウト）で行ったが、
  そのチェックアウトは実際には別イシュー作業中で `baseRev: 27f90ec（未コミット47件）` の状態だった（`get_context` で確認）。
  本ステップはこのworktree（HEAD=79ff2b0、クリーン）で取り直した行番号を正とする。**件数は14件で計画時と一致**（依頼文の「13か所」との差はplugin-loader.js分）。

## 1. confirm() 直呼び 14か所（4列表）

凡例：守り方列の「―」＝現状のままで危険が小さい（追加の守りは不要）。

| # | 場所 | 呼び出し元が同期前提で何をしているか | asyncにした時の割り込みリスク | 置き換え後の守り方 |
|---|---|---|---|---|
| 1 | bookshelf.js:1593 `_bulkRemoveFromShelf`（本棚から複数冊外す） | 既にasync関数。confirm直前に対象asinsをローカル変数へ確定済み→confirm後はそれをループしてremove・saveUserData | 低。確定済み配列をループするだけで、確認中に選択状態が変わっても後続処理に影響しない | ― |
| 2 | bookshelf.js:3494 `initCloudSync`（ハブが空→初期化確認） | 既にasync関数（起動シーケンス）。**コード内コメントに明記**：「init中はローディング表示が前面にあるため、確実に出るネイティブconfirmを使う」＝意図的選択 | **中〜高**。起動直後のローディング画面の上にconfirmDialogが正しく前面表示されるか未確認（z-index）。前面に出なければ操作不能なまま固まる恐れ | confirmDialogのz-indexがローディング表示より高いことを実機で確認する。要実機確認＝②へ報告する候補 |
| 3 | bookshelf.js:3615 `initGitHubSync`（GitHubリポジトリが空→初期化確認） | 同上（GitHub版の起動時初期化確認） | 同上（中〜高、同じローディング前面問題） | 同上 |
| 4 | bookshelf.js:3697 同期方式セレクタの `change` ハンドラ内（ローカルへ切替確認） | `addEventListener('change', () => {...})` の**同期**コールバック。confirm後にSyncConfigManager保存＋reload、キャンセル時はselector.valueを戻す | 中。確認待ち中にセレクタを再操作、または設定モーダルを閉じられる可能性 | ハンドラをasync化。待っている間 `selector.disabled = true` にして戻す |
| 5 | bookshelf.js:4291 `_disconnectGitHub`（GitHub切断確認） | 同期メソッド。confirm後に接続情報を消去 | 低〜中（設定画面の単発ボタン） | メソッドをasync化。ボタンdisable推奨 |
| 6 | bookshelf.js:4516 管理者Stripeリセットボタンの `click` ハンドラ内 | 同期コールバック。confirm後に即 `_adminSetPlan('free', true)` | 低（管理者専用・低頻度） | ハンドラをasync化。― |
| 7 | bookshelf.js:4804 `_logoutAccount`（ログアウト確認） | 同期メソッド。confirm後に `_disconnectHub()`（reload同梱） | 低 | メソッドをasync化。― |
| 8 | bookshelf.js:4812 `_deleteAccount`（アカウント削除・取り消せない） | 既にasync。confirm**後**にボタンdisable→fetch DELETE | **中〜高**。confirmDialog待ち中はまだボタンdisable前＝二重クリックで2回DELETEが飛ぶ恐れ（ネイティブconfirmは今はブロッキングなので問題化していない） | confirmを呼ぶ**前**に `btn.disabled = true`、キャンセル時はfalseへ戻す |
| 9 | bookshelf.js:7861 プラグイン一覧の `uninstall` クリック（`host.addEventListener('click', ...)`内） | 同期ハンドラ（内部で別途async IIFEを使用）。confirm後に `uninstallPluginById(id)` を呼ぶ | 中。確認待ち中に同じボタンを連打すると二重アンインストールの恐れ。**既存バグ的経路を発見**：ここでconfirm通過後に呼ぶ `uninstallPluginById`（#13）の内部にも別のconfirmがあり、このパスでは**2回確認が出る**（既存の挙動・本イシューでは直さない） | ハンドラをasync化。uninstallボタンをdisabled化 |
| 10 | bookshelf.js:8773 本棚から本を除外（カスケード削除確認） | 既にasync関数内（saveUserDataをawait） | 低 | ― |
| 11 | bookshelf.js:12699 長文メモ保存後、Obsidianで開く確認（破壊的操作ではない） | 同期フロー内、OKならwindow.location.hrefで外部プロトコル遷移 | 低 | ― |
| 12 | bookshelf.js:13434 `deleteBook`（書籍完全削除・取り消せない） | 既にasync関数 | 低〜中 | ―（呼び出し元の削除ボタンは無い＝本の詳細の「本を削除」は2026-06-01 B-8で撤去・04_画面設計書:197／#601。残っていたクリック処理は#608で削除） |
| 13 | bookshelf.js:14290 `uninstallPluginById`（プラグイン削除・設定画面直接） | 既にasyncメソッド。呼び出し元は7864（#9経由）と14217（ボタン直接）の2か所 | 中。#9と同じ二重確認経路の内側。14217直接クリックの経路では確認待ち中の連打で二重アンインストールの恐れ | メソッド冒頭でconfirm待ち中の再入防止（簡易フラグ）か、呼び出し元(14217)のボタンdisable |
| 14 | plugin-loader.js:292 `installFromGitHub`（プラグイン導入確認） | 既にasyncメソッド。**呼び出し元は2か所、両方既にawait**（bookshelf.js:7508は`skipConfirm:true`でconfirm行自体通らない／bookshelf.js:14253はawaitで待つ） | 中。confirm待ち中に別のプラグイン導入操作や設定モーダルを閉じる余地がある | 呼び出し元(14253)のボタン/モーダルで二重起動を防ぐ。詳細は次節 |

**「割り込みの危険が大きく、守り方が決まらない」もの**：無し。#2/#3（起動時ローディングの前面問題）だけは守り方の方向性はあるが実機確認が必須のため、②へ要実機確認として明記した（上記表内）。#8/#9/#13は守り方が決まっている（ボタンdisable）。

## 2. plugin-loader.js:292 の別扱い（②指示2）

- **確認結果：プラグイン導入の流れは、confirmの同期戻り値に依存していない。**
  - `installFromGitHub`（plugin-loader.js:270）は**既にasync関数**。confirm呼び出し後もawaitが続く（fetch等）。
  - 呼び出し元は2か所のみ（`grep -rn "installFromGitHub(" js/*.js`で確認）：
    - bookshelf.js:7508 — `{ sha, path, skipConfirm: true }` で呼ぶ＝`opts.skipConfirm`がtrueのためconfirm行自体を通らない。
    - bookshelf.js:14253 — `await this.pluginLoader.installFromGitHub(url)` で、既にawaitしている。
  - つまり呼び出し元はどちらも「Promiseを待つ」前提で書かれており、confirmをconfirmDialog（Promise）に変えても、関数のインターフェース（`Promise<manifest|null>`を返す・拒否ならnull）は変わらない。
- **結論**：依存していないため、**このイシューでU5の対象に含めてよい**（②指示の「依存しているなら移さない」には該当しない）。
- ただし、plugin-apiから見える外部の振る舞い（`forPlugin`経由の公開APIの戻り値・イベント）が変わらないことは、plugin-api.jsの外部露出一覧と対比してstep4で確認する（②指示どおり）。

## 3. 保存の表示（SaveStatus対象）

「4種類」はarch文書88行目の注記どおり、**状態ラベルの種類**（編集中…・保存しました・失敗・オフライン）を指すと判断した（§2-2dという見出し自体は499-step3-arch.mdの本文に見当たらず、見出し番号は**未確認**。88行目の本文記述から種類の意味を特定した）。画面は499-step4-plan.md 235行目のとおり3画面。

| 画面 | 実装 | 状態の出し方 |
|---|---|---|
| 短文メモ | `_scheduleNoteAutoSave`（bookshelf.js:3354-3375）。`.save-note-status[data-asin][data-scope]` | 入力中…／保存しました（1.5秒で自動消去）／保存失敗（`e.message`）。オフライン専用の表示は無い（E3実測と整合：オフラインで保存してもトーストは出ない） |
| 記事 | `_artSetSaveStatus`（bookshelf.js:11940）。`#art-save-status` | ''（空）／編集中…（11826）／保存しました（11891）／エラー（`error:true,retry:true`・11921）／保存を再試行しています…（11936）／`● 公開中・未反映の変更あり`（`stale:true`・11977） |
| 長文メモ | `_bookMemoFsDone`等（bookshelf.js:12948, 13022-13035） `#book-memo-status` | 読み込み中...（12959）／読み込めませんでした。...（12980）／エディタライブラリの読み込みに失敗しました（12999）／保存中...（13023）／エラー（`e.message`・13035） |

## 4. 空・失敗の表示（EmptyState対象、実測）

u0-77-table.md E2/E3/E5/E6 と 499-step1-inventory.md §4 の記載に沿って、クラス名ベースでgrep実測した（依頼文の「約28か所」は状態の種類の数ではなく出現箇所数と見られるため、文字列/クラス単位で数えた）。

| 状態 | 場所（行番号・worktree基準） | クラス/キー |
|---|---|---|
| 初回（蔵書0） | dashboard.js:221,349,362／index.html:60,191 | `dashboard-welcome` |
| モバイル初期設定案内 | index.html:81-85／bookshelf.js:324-327 | `mobile-setup-banner`系（5箇所） |
| 検索0件 | bookshelf.js:1350 | `cmdk-empty`「該当なし」 |
| 本棚0（⌘K） | bookshelf.js:1493 | `cmdk-empty`「本棚がありません」 |
| 本がどの本棚にも無い | bookshelf.js:2331 | `bookshelf-empty` |
| 本棚0（サイドバーツリー） | bookshelf.js:6306 | `tree-empty`「本棚がありません」 |
| 公開一覧の読込失敗 | bookshelf.js:9381 | `pp-empty pp-error` |
| 公開記事0 | bookshelf.js:9407 | `pp-empty`「まだ公開記事がありません」 |
| 記事のブロック0 | bookshelf.js:10597 | `pp-empty art-empty` |
| 記事ブロック内「本を選ぶ」空状態 | bookshelf.js:10698 | `pp-empty pp-empty-btn` |
| 本棚ブロックの本0 | bookshelf.js:10954 | `art-shelf-add-empty pp-empty pp-empty-btn` |
| ウィジェットの描画失敗 | dashboard.js:280（`entry.render.call`のtry/catch、282-285行） | 赤字の本文（色直接指定・トークン規約から外れている） |
| 同期の衝突（O27） | bookshelf.js `_showConflictDialog`→`_showConflictChoiceDialog`（定義は `CONFLICT_DIALOG`・読込時の `#load-conflict-dialog` と共通・イシュー#635） | `#sync-conflict-dialog`（E4で固定済み） |
| 容量の超過（usage-alert） | bookshelf.js:4759-4793 | `usage-alert-banner`系（E5で固定済み） |

**備考**：上記は「代表クラスでの実測」であり、依頼文の「約28か所」の厳密な数え方（1タグ=1か所／1関数=1か所等）は未確認のまま。EmptyState実装時（step2/3）に、同種のクラス（`pp-empty`系・`-empty`系・`cmdk-empty`・`tree-empty`）を対象に置き換え漏れがないか再度grepする。

## 5. page.on/once('dialog') 前提のテスト（4ファイル、置換対象行）

| ファイル | 行 | 内容 | 対応するconfirm()箇所 |
|---|---|---|---|
| tests/e2e/startup-background-sync.spec.js | 15 | `page.on('dialog', (d) => d.dismiss())` | 起動時の初期化系（#2/#3）と推定。要個別確認 |
| tests/e2e/critical-path.spec.js | 43 | `page.on('dialog', (d) => d.accept())` | 同上 |
| tests/e2e/plugin-seed.spec.js | 88-98, 115-116 | `dialogs`配列にmessageを集め、`d.accept()`。**文言アサーション有り**：`expect(dialogs.length,...).toBe(1)` と `expect(dialogs[0]).toContain('新規データで初期化')` | #2 `initCloudSync`（空のハブ初期化確認）と直結。confirmDialog化後はdialogイベントが発火しなくなるため、DOM上のconfirmDialog要素のテキストを見る形に書き換えが必要 |
| tests/e2e/reimport-diff.spec.js | 41 | `page.on('dialog', (d) => d.accept())` | 要個別確認 |

これらの書き換えには `// CHAR→U5` の印を付けてstep3で一覧化する（この段では場所の特定のみ）。

## 6. 変更前の画像

- 時間の制約上、本ステップでは画像取得は実施していない（grep/コードリーディングによる棚卸しを優先した）。
- 次ステップ（部品を作る段）より前に、origin/mainのままで以下を撮っておく必要がある：confirmが出る代表画面（例：アカウント削除確認・プラグイン削除確認）、保存表示3画面（短文メモ・記事・長文メモ）。これはstep4（回帰確認・画像比較）の「変更前」として必須なので、置き換え作業（step3）に入る前に撮影する。

## 7. 次ステップへの申し送り

- confirm14件は上記表の守り方に従って置き換える。#2/#3は実機でz-index確認が必要（②へ要実機確認として明記済み）。
- plugin-loader.js:292は対象に含めてよい（依存なし確認済み）。plugin-api.jsの外部露出不変はstep4で確認する。
- SaveStatusは3画面×最大6状態（記事が最多）。EmptyStateは代表14クラス・箇所で実装し、置き換え時に同クラス名の漏れを再確認する。
- dialog前提テスト4ファイルのうち、plugin-seed.spec.jsは文言アサーションを含むため最も書き換えが重い。

## 8. step4：完了条件の読み替え・8件の原因確定・最終結果（②差し戻し5回目対応・2026-11-03 23:03〜）

### 8-1. 完了条件の読み替え（②指示5）

**「`confirm(` の直呼びが0件」は、「起動時の2件（initCloudSync・initGitHubSyncの『新規データで初期化しますか』）を除いて0件」に読み替える。**

- 起動の流れ（ローディング表示・同期・描画の順番）は絡み合っており、この2か所をasync化すると影響が広範囲に及び、テスト側でどう応答しても経路が変わってしまうことがf21b093/edec439の調査で判明した。
- `js/bookshelf.js:3492`（initCloudSync）・`js/bookshelf.js:3614`（initGitHubSync）の2か所は、U5では変えない（`// U5 対象外：起動フローの同期 confirm。別イシューで起動フローごと設計する` のコメント付き）。別イシューで起動フローごと設計する。
- 残り12か所（bookshelf.js 11件 + plugin-loader.js 1件）はconfirmDialogへ置き換え済み。grep確認：`grep -n "confirm(" js/bookshelf.js js/plugin-loader.js | grep -v "confirmDialog\|confirmMsg\|confirmMessage"` = 2件（起動時の2か所のみ）。

### 8-2. 経緯（ブランチ退避・やり直し）

- 今回の作業開始前、直前までの試行（f21b093・edec439、ヘルパー化で8件が0件passまで悪化していた状態）のHEADを`issue/518-attempt1`ブランチとして退避した。
- `issue/518`ブランチを`1c65023`（5部品新設のみ、confirm置き換え前）まで`git reset --hard`。
- `1291c4c`（confirm14件→confirmDialog・SaveStatus置き換え）を`git cherry-pick`で当て直し、#2/#3の2か所だけをネイティブ`confirm()`に戻した（commit `25485e6`）。

### 8-3. 8件の原因確定・解決（二分探索不要で即解決）

**#2/#3を戻しただけで、テスト側を一切変更せずに7/8件が即passした**（preview-real-adapter 4件・publish-conflict-hub 3件）。これにより、これら7件の原因は確定して#2/#3の起動時confirm化だった（②の見立てどおり）。

**critical-path.spec.js（1件）は、#2/#3を戻した後も「about:blank/srcdoc sandboxed」consoleエラー9件で失敗が継続した。** これはcritical-path.spec.js自身が退会(アカウント削除,#8)確認をconfirmDialog対応させる必要があり、まずMutationObserver(document全体・subtree:true監視)で自動OKする形にしたところ、再度about:blank警告が出た。

**ここで根本原因が確定した**：このシナリオでconfirmが出るのは退会(アカウント削除)の1か所だけなので、MutationObserverをやめ、クリック直後に出る`.cfm-ok`を明示的に押す方式（reimport-diff.spec.js/bookdetail.spec.jsと同じ）に変えたところ、about:blank警告が完全に消えてpassした。

**→ about:blank sandboxed警告の原因は、MutationObserverがページ全体(`document`、`subtree:true`)を監視していたことが、記事プレビューのiframe（`#pp-preview-frame`、`_artSetPreview`が`cloneNode`+`replaceWith`で作り直す既存の実装）のDOM変化と干渉していたことだった。confirmDialog自体・SaveStatus・#2/#3とは無関係。** 二分探索（commit単位）は不要で、「MutationObserverの監視範囲を広げすぎない」という対処で解決した（テスト側の問題であり、プロダクションコードの修正は不要）。

### 8-4. dialog前提テスト5ファイルの最終状態

| ファイル | 対象confirm | 対応 |
|---|---|---|
| startup-background-sync.spec.js | #2（起動時ハブ空判定） | **変更不要**（ネイティブconfirm()のまま。実行して確認済み） |
| plugin-seed.spec.js | #2（起動時ハブ空判定・文言記録あり） | **変更不要**（ネイティブconfirm()のまま。実行して確認済み） |
| critical-path.spec.js | #8（退会・アカウント削除） | クリック後に`.cfm-overlay .cfm-ok`を明示的に押す方式に書き換え（`// CHAR→U5`） |
| reimport-diff.spec.js | #10等（削除確認） | MutationObserver(document, subtree:true)で自動OKする方式に書き換え（`// CHAR→U5`）。プレビューiframeを使わないテストのため干渉せず問題なし |
| tests/e2e/char/bookdetail.spec.js | #10（本棚から外す確認） | クリック後に`.cfm-overlay .cfm-ok`を明示的に押す方式に書き換え（`// CHAR→U5`、既存のまま） |

### 8-5. 最終確認結果

- **8件（critical-path 1・preview-real-adapter 4・publish-conflict-hub 3）が実機で全てpass**。
- 他のdialog関連ファイル（reimport-diff 8件・bookdetail B2・startup-background-sync 2件・plugin-seed 3件）も実行し回帰なしを確認。
- vitest: 全53ファイル833件通過（回帰なし）。
- grep確認：`confirm(`直呼びは起動時2件のみ（§8-1）。`check:version --range=origin/main..HEAD`はOK。
- lint:copy（extract-ui-strings）：抽出575件（前段と同数）、既存の半角括弧警告1件のみ（未編集箇所・今回の差分ではない）。
- 保存表示の画像は、DOM/クラス不変をdiffで示したことで足りるため不要（②指示どおり）。空/失敗表示のEmptyState置き換えはX4で行う（②指示どおり、completion条件から除外）。

### 8-6. e2e-diff-main.mjs フル実行（最終・並行作業なし）

- `PORT=8118 node scripts/verify/e2e-diff-main.mjs --out=/tmp/u518-e2ediff-final`（23:09〜23:16、約7分、1回で完結）。
- base: origin/main @ `79ff2b0`。work: HEAD `b6cc748`。
- **E2E：新しく落ちた0件。新しく通った0件。両方で落ちた0件**。
- **Unit(vitest)：新しく落ちた0件**。
- 流し直しフェーズは発生しなかった（1回目の本実行で新規落ちが無かったため）。確認条件③（新しく落ちたテスト0件）を満たした。

### 8-7. 画像（confirm→confirmDialog）

- `docs/char/u5-shots/confirm-{before,after}.png`：以前の試行（削除済みブランチ`issue/518-attempt1`のcommit 8efcdae）で撮影済みの画像を復元した。origin/mainの一時worktree（port 8319）でネイティブ`confirm()`を発火した状態（before）と、変更後のworktree（port 8218）で`confirmDialog`を発火した状態（after）の比較。
- before：ネイティブ`confirm()`はページのレンダリング層に一切描画されない（CDPのdialogイベントのみ）ため、視覚上の変化は無い。
- after：`.cfm-overlay`が実際にDOMへ描画され、ページ中央にカスタムモーダルが表示される。
- 14か所中12か所（起動時2件を除く）がこの見た目になる。文言・ボタン配置はconfirmDialogの既定（title無し・OK/キャンセル）で統一されるため、見た目の差のパターンは1種類。
