# イシュー#631 購入日の欄と取得日時のずれ — 結果の記録

本の詳細の編集モードの「購入日」の欄と、手動追加の「読み終えた日」の欄で、日付と取得日時 (acquiredTime) がずれる不具合の記録。

## step1 再現テスト (修正前に赤)

### 対象と流し方

- 対象: `f6dd65a` (origin/main の最新・2026-11-14 14:37 時点) に、新しい spec `tests/e2e/book-detail-acquired-date.spec.js` だけを足した状態。製品コードは変えていない。
- コマンド (作業ツリーの直下で実行。`<node の bin>` は nvm の v24.18.0 の bin):

  ```
  env PATH=<node の bin>:/usr/local/bin:/usr/bin:/bin PORT=8131 PLAYWRIGHT_BASE_URL=http://localhost:8131 \
    node node_modules/@playwright/test/cli.js test tests/e2e/book-detail-acquired-date.spec.js --project=chromium --reporter=list
  ```

- 結果: 6本のうち 5本が赤・1本が緑 (32.0秒)。

### テストごとの結果

使った本はフィクスチャの本2 (B000000002)。acquiredTime 1700000001000 は、UTC 2023-11-14 22:13:21・東京 2023-11-15 07:13:21・ロサンゼルス 2023-11-14 14:13:21。

| テスト | タイムゾーン | 操作 | 結果 | 落ちた期待 (期待 → 実際) |
|---|---|---|---|---|
| T1 | Asia/Tokyo | 編集を開いて変えずに保存 | 赤 | 欄の初期値 2023-11-15 → 2023-11-14<br>acquiredTime 1700000001000 → 1699920000000<br>閲覧の購入 2023/11/15 → 2023/11/14 |
| T2 | America/Los_Angeles | 編集を開いて変えずに保存 | 赤 | acquiredTime 1700000001000 → 1699920000000<br>閲覧の購入 2023/11/14 → 2023/11/13<br>(欄の初期値 2023-11-14 は緑) |
| T3 | Asia/Tokyo | 欄を 2023-11-20 に変えて保存 | 赤 | acquiredTime 1700406000000 (東京の0時) → 1700438400000 (UTC の0時)<br>(閲覧の購入 2023/11/20・開き直した欄 2023-11-20 は緑) |
| T4 | America/Los_Angeles | 欄を 2023-11-20 に変えて保存 | 赤 | 閲覧の購入 2023/11/20 → 2023/11/19<br>acquiredTime 1700467200000 (ロサンゼルスの0時) → 1700438400000 (UTC の0時)<br>(開き直した欄 2023-11-20 は緑) |
| T5 | America/Los_Angeles | 手動追加で 2023-11-20 を入れる | 赤 | 閲覧の購入 2023/11/20 → 2023/11/19<br>acquiredTime 1700467200000 → 1700438400000 |
| T6 | Asia/Tokyo | 手動追加で 2023-11-20 を入れる | 緑 | (回帰の見張り) |

### 分かったこと

- 依頼の見立てを再現した (T1)。東京で 0〜9時に取得した本は、編集を開いて変えずに保存するだけで、取得日時が 1699920000000 (UTC 2023-11-14 00:00 = 東京 2023-11-14 09:00) に書き換わり、閲覧の日付が 1日前になる。
- UTC より西のタイムゾーンでは、変えずに保存しても 1日前になる (T2)。欄で選んだ日付も、手動追加で入れた日付も、閲覧では 1日前に出る (T4・T5)。
- 計画の見込みとの違いは無い (T1・T2・T4・T5 が赤、T3 は acquiredTime の期待だけ赤、T6 は緑)。

### テストの作り

- タイムゾーンは describe ごとに `test.use({ locale: 'ja-JP', timezoneId })` で固定した。各テストの最初に `getTimezoneOffset()` を見て、固定が効いていること (東京 -540・ロサンゼルス 480) を確かめている。
- プロセスの TZ を UTC にして (CI と同じ条件) 同じコマンドを流しても、同じ判定になった (5本が赤・1本が緑。期待と実際の値も同じ)。
- 値の期待は `expect.soft` にした。1回の実行で、落ちる期待が全部出る (T1 は欄・保存値・閲覧の3つ)。
- 計画から足したもの: T5 に保存値の期待 (入れた日付のロサンゼルスの0時) を入れた。②が確定した「手動追加も同じ関数・その日の現地0時」を固定するため。T6 は計画どおり閲覧だけを見る。

### 行の確認 (f6dd65a)

計画の時 (94b2164) から動いていない。

- `js/screens/book-detail.js:319` 閲覧 = `toLocaleDateString('ja-JP')`
- `js/screens/book-detail.js:330` 編集欄 = `toISOString().split('T')[0]`
- `js/bookshelf.js:6180` saveBookChanges・`:6232` `new Date(newAcquiredTime).getTime()`
- `js/bookshelf.js:6617` 手動追加 = `new Date(dateInput).getTime()`

### ログ

- `_local/631/step1-red.log` (手元の TZ)・`_local/631/step1-red-tzutc.log` (TZ=UTC)。どちらも git の管理外。

## step2 修正 (端末の日付で行き来する関数2つ + 呼び出し3か所)

### 変えた所 (f6dd65a の上・未コミット)

| ファイル | 行 | 内容 |
|---|---|---|
| `js/book-manager.js` | 502-528 | BookManager に2つ足した。`acquiredTimeToDateInput(acquiredTime)` (:509) = 取得日時 → 欄の日付。`dateInputToAcquiredTime(value)` (:521) = 欄の日付 → その日の端末の0時 |
| `js/screens/book-detail.js` | 330 | 編集欄の value を `this.bookManager.acquiredTimeToDateInput(book.acquiredTime)` に |
| `js/bookshelf.js` | 6230-6238 | saveBookChanges。欄の値が「今の取得日時の端末の日付」と同じなら acquiredTime を書かない。違う時だけ、その日の端末の0時を書く。欄が空の時は今までどおり触らない。今の本を取る行 (currentBook) を前へ出した |
| `js/bookshelf.js` | 6621-6622 | addBookManually。「読み終えた日」を `dateInputToAcquiredTime` で読む (null なら今の時刻) |
| `index.html` | 1504・1519・1535 | `?v=` を上げた。book-manager.js 2026110207 → 2026111631・bookshelf.js 2026111596 → 2026111632・book-detail.js 2026111521 → 2026111633 |
| `tests/unit/book-detail-memo-button.test.js`<br>`tests/unit/book-detail-shelf-chips.test.js` | 42<br>47 | bookManager の stub に `acquiredTimeToDateInput` を1行足した (編集モードの描画が呼ぶため) |
| `tests/unit/local-date-input.test.js` | 新規 | 関数2つの単体テスト 11本 |

- 閲覧の表示 (`js/screens/book-detail.js:319`・`js/ui/book-list.js:128`) は触っていない。既存の acquiredTime を書き換える処理 (移行) は入れていない。
- `?v=` の値: origin/main (f6dd65a) の index.html の最大は 2026111598。未取り込みのブランチは 2026111597〜2026111601 を使っている。どれとも重ならない。

### 置き場を BookManager にした理由

- 取得日時は本の項目 (06_データ仕様書:64)。03_詳細設計書の BookManager の表 (:193〜) は、本の項目から値を作る読みヘルパー (`getProductImageUrl`=「唯一の正」) を持つ。saveBookChanges はすでに `this.bookManager.isValidASIN`・`getProductImageUrl` を呼んでいるので、同じ呼び方にそろう。
- 計画の第一候補 (VirtualBookshelf のメソッド) は合わなかった。
  - `js/bookshelf.js` に置くと、単体テストの型 (stub の class に book-detail.js を取り付ける・詳細ノート #611) では呼べない。
  - `js/screens/book-detail.js` は「本の詳細専用」のファイルで、手動追加から呼ぶ関数の置き場に合わない。
- そのため、計画で宣言していないファイルに触った: `js/book-manager.js` と、既存の単体テスト2本 (stub に1行)。未取り込みのブランチでこの3ファイルを触る commit は 0件 (`git log --branches --not origin/main`)。

### 関数の決まり

- `acquiredTimeToDateInput`: `Number()` で受ける (文字列の数値も可)。数として読めない値は `''` (空の欄)。直す前の `toISOString()` は、不正な値で例外になった。
- `dateInputToAcquiredTime`: `YYYY-MM-DD` だけを受ける。形式が違う値・実在しない日付 (2023-02-30 など) は `null`。null の時、保存は取得日時を触らず、手動追加は今の時刻を使う。

### テストの結果

| 対象 | 結果 |
|---|---|
| 再現テスト `tests/e2e/book-detail-acquired-date.spec.js` (T1〜T6) | 6本とも緑 (4.7秒)。step1 で赤だった期待 10個 (T1 3つ・T2 2つ・T3 1つ・T4 2つ・T5 2つ) が全部緑 |
| 同じ spec をプロセスの TZ=UTC で (CI と同じ条件) | 6本とも緑 (4.1秒) |
| 新しい単体テスト `tests/unit/local-date-input.test.js` | 11本とも緑。プロセスの TZ を5つ変えて流しても緑 (America/Los_Angeles・UTC・Asia/Tokyo・Pacific/Kiritimati・America/Sao_Paulo) |
| vitest 全件 | 74ファイル・1099本が緑 (ほかに todo 2本) |
| 編集・保存と手動追加を通る既存の E2E 6ファイル | 42本が緑・4本はスキップ。スキップは `book-memo-file-lifecycle.spec.js:259`・`:321` の `test.fixme` (#594 の残り＝元からスキップ) |

既存の E2E 6ファイル: book-detail-entries・duplicate-asin-notice・book-memo-file-lifecycle・kindle-reimport-merge・dashboard-stats-after-manual-add・book-detail-shelf-add。

- 単体テストは、プロセスの TZ を中で切り替えていない。どのタイムゾーンでも成り立つ性質 (端末の日付になる・往復で戻る・閲覧の表示と同じ日付) だけを見て、外から TZ を変えて流した。東京・ロサンゼルスを決めた判定は E2E が持つ。
- ログ: `_local/631/step2-green.log`・`step2-green-tzutc.log`・`step2-related.log`・`step2-vitest-all.log` (git の管理外)。

## step3 確認一式・設計書・commit・過去データの範囲

### commit

- `cd9f616` fix: 修正とテストの 8ファイル (f6dd65a の上)。本文末は `Issue: #631` と `Co-Authored-By` の連続2行。`git log --format='%(trailers)'` で両方が trailer として読めることを確かめた。
- この記録 (631-results.md) は、別の docs の commit にしている。

### 確認の結果 (cd9f616)

| 対象 | 結果 |
|---|---|
| vitest 全件 (`npm test`) | 74ファイル・1099本が緑 (ほかに todo 2本) |
| 本の詳細と手動追加まわりの E2E 10ファイル | 103本のうち 66本が緑・37本がスキップ・失敗 0本 (1.0分) |
| visual 全件 (`playwright.visual.config.js`) | 54本が緑 (11.0秒)。差分 0件・基準画像の更新なし |
| lint 11本 (CI の e2e レグと同じ) | 全部 exit 0 |
| `check:version` | `--range=origin/main..HEAD` で OK。自分の commit だけの範囲 `--range=f6dd65a..HEAD` でも OK |

E2E の内訳 (緑の本数):

| ファイル | プロジェクト | 緑 | スキップ |
|---|---|---|---|
| book-detail-acquired-date (新規) | chromium | 6 | 0 |
| book-detail-entries | chromium | 5 | 0 |
| book-detail-shelf-add | chromium | 10 | 0 |
| book-memo-file-lifecycle | chromium | 20 | 4 |
| dashboard-stats-after-manual-add | chromium | 1 | 0 |
| duplicate-asin-notice | chromium | 3 | 0 |
| gate/j3-1-shelf-to-detail | chromium | 1 | 0 |
| kindle-reimport-merge | chromium | 3 | 0 |
| reimport-diff | chromium | 8 | 0 |
| char/bookdetail | char の6端末 | 9 | 33 |

- スキップはどれも spec に元からある指定。book-memo-file-lifecycle の 4本は `test.fixme` (`:259` が3本・`:321` が1本。#594 の残り)。char/bookdetail の 33本は、端末ごとの対象外を `test.skip` で外したもの (`:42`・`:60`・`:81`)。
- lint 11本: lint:css・lint:e2e-goto・lint:e2e-wait・lint:breakpoint・lint:esc・lint:js-color・lint:internal-refs (上限 82 以内)・lint:e2e-gate (@gate 34本・違反 0件)・lint:copy (119/119)・lint:terms・lint:known-red。
- `check:version` の注意: origin/main は 029bf88 へ 1つ進んでいる (この作業ツリーの土台は f6dd65a)。載せ直しは step4 で行う。

### 設計書 (vault の bookshelf 設計書)

| ファイル | 行 | 直した内容 |
|---|---|---|
| 03_詳細設計書 | 206 | BookManager の表に `acquiredTimeToDateInput` / `dateInputToAcquiredTime` の行を足した (変換の唯一の正・端末の日付で行き来する・UTC になる書き方は使わない) |
| 04_画面設計書 | 190 | 編集トグルの説明に、購入日の欄は端末の日付で出し、日付を変えた時だけ取得日時をその日の0時に更新する、と書き足した |
| 04_画面設計書 | 216 | 手動追加の「読み終えた日」に、取得日時はその日の端末の0時、と書き足した |
| 06_データ仕様書 | 64 | `acquiredTime` の説明に、日付だけを入れた時はその日の端末の0時、と書き足した |

- 08_意思決定記録 (ADR) は足していない。不具合の修正で、決まりは 03・06 に今の仕様として書いた。07_残検討事項は触っていない (過去データの直しは下の案を②が判断する)。

### 横に調べた結果 (行番号は cd9f616)

同じ不具合 (日付だけの欄を UTC の日付として読み書きする) は、製品コードでは今回直した 2組だけ。`type="date"` の欄は `index.html:1383` と `js/screens/book-detail.js:330` の 2つだけ。

直さないもの:

| 場所 | 中身 | 直さない理由 |
|---|---|---|
| `scripts/verify/453-shot-bookdetail.mjs:76` | `toISOString().split('T')[0]` | #453 の時の 1回きりの撮影スクリプト。製品コードではない |
| `cf-worker/asayake-hub.js:1606` | `toISOString().slice(0, 10)` | 通報の 1日あたりの上限を数える鍵。サーバ側で UTC の日付にそろえている |
| `cf-worker/client-errors.js:34` | `jstDay` | 9時間足してから切っている。日本の日付として正しい |
| `tests/unit/hub-backup.test.js:180` | `toISOString().slice(0, 10)` | バックアップの名前 (UTC の日付) を作るテストの中 |
| `js/dashboard.js:914`・`:1022`<br>`plugins-sample/reading-goal/index.js:24` | 今月・年ごとの集計 | `getFullYear` / `getMonth` で端末の年・月を見ていて、問題なし |

### 過去データの範囲の見積り (読むだけ・データは書き換えていない)

**ずれ方**: 直す前は、編集モードで保存するたびに (題名だけを直した時も)、取得日時が「元の値の UTC の日付の 0時ちょうど」に書き換わった。東京で見ると、元の取得が 9時以降の本は同じ日のまま (時刻だけ 9:00 になる)、0〜9時の本は 1日前になる。

**判定の式**: `source === 'kindle_import'` で、`acquiredTime % 86400000 === 0` の本 = 編集モードで 1回以上保存された本。

- 手動追加で日付を入れた本 (`source === 'manual_add'`) も同じ値になるが、入れた日付どおりに見えているので対象外。
- 値だけでは、1日ずれた本と、時刻だけ変わった本を見分けられない (元の時刻が残っていない)。
- 直した後に入る値は端末の 0時 (東京なら 86400000 で割った余りが 54000000) なので、これからの値とは混ざらない。

**取込し直しでは戻らない**: `js/book-manager.js:65-110` の importSelectedBooks は、同じ ASIN の本では 4つの項目 (`:76` の STATUS_FIELDS) だけを更新する。取得日時は上書きしない。

**実データで数えた結果**: 読めたのは `bookshelf-data/private/library.json` (GitHub 直下・2026-08-15 11:16 更新の控え)。

| 見たもの | 数 |
|---|---|
| 本の数 (全部 `kindle_import`・acquiredTime は全部 number) | 783 |
| UTC の 0時ちょうどの本 | 0 |
| ミリ秒の下 3桁が 000 の本 | 0 |

- この控えの時点では、ずれた本は 0冊。
- 取込の値はミリ秒まで入っているので、0時ちょうどは自然には起きない。式で拾った本は、編集で書き換わった本とみてよい。
- 8/15 より後のデータ (今の保存先) は読めていない。vault の下に保存先のフォルダは見当たらなかった。

**戻し方の案 (提案だけ)**:

1. 今の件数を見る。アプリを開いた画面の console で `window.bookshelf.books.filter(b => b.source === 'kindle_import' && Number(b.acquiredTime) % 86400000 === 0).length`。0 なら何もしない。
2. 1冊以上なら、Amazon から取り直した取込データ (payload に acquiredTime がある・`js/screens/import.js:609`) と ASIN で突き合わせ、該当の本だけ Amazon の値へ戻す。日付も時刻も戻る。
3. 突き合わせる元が無い本 (Amazon の一覧から消えた本) は戻せない。
4. 作るなら別のイシューにし、該当の本の一覧を見せて確かめてから直す 1回きりの操作にする (起動時に自動で書き換える移行にはしない)。

### ログ

- `_local/631/step3-e2e.log`・`step3-visual.log`・`step3-vitest-all.log`・`step3-lint-*.log` (git の管理外)。
- 読むだけのスクリプト: `_local/631/read-design.mjs` (設計書)・`count-shifted.mjs` (件数)・`where.mjs` (場所)。
