# イシュー#669 実測の記録

## §1 step1：実測（2026-11-14 18:12〜18:21）

### 前提

- 基準：origin/main = **36cf113**（計画時の f9468f8 の後に #645 が入った。`git diff --stat f9468f8..36cf113 -- js` は github-adapter.js・storage.js などの3ファイル。publish-article-generator.js・exporter.js は行番号が変わらない。article-editor.js と bookshelf.js は少しずれた）。以下の行番号は 36cf113 のもの。
- 起点：#664 の記録 `scripts/verify/664-results.md` §2-0 の3（issue-664 の worktree・**36fb978**。#664 は未着のため origin/main には無い）からの引用：
  > 除外する前から記事に置いてあった本は、除外した後も公開に出る。`libMap` は、除外を含む library.json から作る（publish-article-generator.js:938）。all.json とは関係がない。除外が記事に効くべきかの決まりは、設計書に無い。

### 測り方

- spec：`tests/e2e/exclude-article-publish.spec.js`（新規・1本）。chromium・1280×800・PORT=8169・`--repeat-each=3`。所要は1回20秒ほど（5分の上限内）。
- 公開の模擬：`tests/e2e/publish-article-editor.spec.js` の `bootAppForPublish` と同じ形。ハブの `/publish` を `page.route` で受け、送られた `files` と `index` を記録する。保存先はメモリ上の Map（`private/library.json`・`bookshelves.json`・`all.json`・`notes.json`）。export は state を渡さず `storage.loadAll()` を読む実経路を通る。
- 手順：
  1. 除外する前に記事を作る（文章・本ブロック X＝B000000001・本棚ブロック X と Y＝B000000002）。本だけのブロックは #528 で画面から足す入口が無くなったため、`publishArticleStore.create` で保存先に置いた（「除外する前から記事にあった」の再現）。
  2. 画面から X を除外する：「すべて」本棚→本のカード→本の詳細の編集→「除外」→確認。toast「除外しました」まで待つ。
  3. この spec は同期を止めている。そのため、同期の書き出し（bookshelf.js:3886 `excludedASINs`）が保存先へ書く形を、メモリ上の保存先へ写した：`exclusions.json={excludedASINs:[X]}`。library.json は除外を含む全書誌のまま（02:95・#664 §2-1 の実測 9/9 と同じ形）。
  4. 記事の一覧→編集で開き、(a) 閲覧キャンバス・編集キャンバス・本棚ブロックの全画面編集、(b) プレビュー（⋯→表示幅を切り替えて見る）、(c) 公開パネル→「公開する」→同意、の順に読む。
  5. 設定の「除外した本」で X を「元に戻す」（モーダルを開くのは `showExclusionsModal()`・ボタンは実クリック）。その後に、キャンバス・プレビュー・公開（更新）を読み直す。
- 観測の生データ：`scripts/verify/669-run1.jsonl`（3行＝3回）。

### 結果（3回とも同じ・3/3）

除外の後：

| 見る所 | 本 X（除外した本） | 本 Y | 経路（36cf113） |
|---|---|---|---|
| 保存先 | library.json に X が**ある**・exclusions.json＝[X] | ある | 書き出し bookshelf.js:3886（exclusions）。library.json は除外を含む（02:95） |
| アプリの蔵書 `this.books` | **無い** | ある | `_excludeAsinCore` bookshelf.js:5816- が `bookManager.library.books` から外す |
| (a) 閲覧キャンバス | **出ない**。本ブロックの `<section>` ごと無い（data-art-idx が 0・2 だけ）。本棚ブロックの中も Y だけ | 出る | article-editor.js:792 `build(…{state: _artBuildPreviewState()})`→:3625 `library: this.books`→generator:462 `_resolveBookData` が null→:564・:590 で空 |
| (a) 編集キャンバス | **出ない**。本ブロックの `<section>`（idx 1）と⋯の入口は残るが、題・ASIN は無い | 出る | 同上 |
| (a) 本棚ブロックの全画面編集 | **題の代わりに ASIN「B000000001」** が出る（除外中だとは分からない） | 題 | article-editor.js:1984-1985（`this.books` に無いと `title = it.asin`） |
| (b) プレビュー | **出ない**（題・ASIN とも無い） | 出る | article-editor.js:3749 `state: _artBuildPreviewState()`。キャンバスと同じ |
| (c) 公開物（記事の index.html） | **出る**（題・ASIN とも有る）。公開パネルの「公開する」も押せる（Y がいるため） | 出る | exporter.js:109 は state を渡さない→generator:929 `storage.loadAll()`→:938 `libMap` を library.json（X を含む）から作る。exclusions（storage.js:373）は build の state に入らない |

除外を取り消した後（対照）：

| 見る所 | 本 X |
|---|---|
| 閲覧キャンバス | 出る（開き直した直後は前の文書が残るため、出るまで 231・409・324ms 読み直した＝`_artQueueCanvas` の 80ms 予約） |
| プレビュー | 出る 3/3 |
| 公開物 | 出る 3/3 |

→ **見立てどおり。除外の後、プレビュー・キャンバスには X が無いのに、公開物には X が題・ASIN つきで出る（3/3）**。書き手が「プレビューで見た記事」と、読み手が見る記事が食い違う。

spec の判定（期待は、どの案でも成り立つ「公開物に X が出るかは、プレビュー・キャンバスと一致する」だけ）：

| 期待 | 結果 |
|---|---|
| 除外の後：公開物の X の題 = プレビュー | **赤 3/3**（公開 true・プレビュー false） |
| 除外の後：公開物の X の題 = 閲覧キャンバス | **赤 3/3**（公開 true・キャンバス false） |
| 取り消し後：プレビューに X・公開物に X | 緑 3/3 |
| 除外の後も Y は公開物に出る | 緑 3/3 |
| ページのエラー 0件 | 緑 3/3 |

### 公開先に書かれたファイル（②の追加指示）

| 書かれた所 | 中身 | X が入るか |
|---|---|---|
| ハブ `/publish` の files：`<publicId>/index.html` | 記事の HTML | **入る** 3/3 |
| ハブ `/publish` の files：`<publicId>/og.png` | OGP 画像（base64）。入力は題・タグ・発行者・配色（exporter.js:183 付近） | 入らない（画像の入力に本が無い） |
| ハブ `/publish` の files：`index.html` | サイトのトップ（記事の一覧） | 入らない 3/3 |
| ハブ `/publish` の index（共有ハブの索引・ADR-099） | publicId・題・説明・タグ・coverUrl（＝og.png の URL・generator:1079）など | 入らない 3/3 |
| 保存先への書き込み（公開の間） | `private/publish/articles.json`（lastBuiltAt）だけ | －（private） |
| `public/main.json`・`public/settings.json` | 書き手は **0件**（`writePublicMain`・`writePublicSettings` storage.js:413-414 は定義だけで、js・plugins-sample から呼ばれていない）。公開の間にも書かれなかった | －（書かれない） |

→ X が公開に出る所は、**記事の HTML の1つだけ**。

### 経路の全数 grep（36cf113）

記事の本を解決・表示する所：

| 場所 | 何を見て本を探すか | 除外した本の出方（実測） |
|---|---|---|
| generator:462 `_resolveBookData`（呼び出しは :504・:513 の2か所＝本ブロック・本棚ブロックの中） | 渡された state の `library.books`（`libMap` :938） | state 次第（下の3行） |
| ├ 公開 exporter.js:109 | state 無し→`loadAll()`＝library.json（除外を含む） | **出る** |
| ├ キャンバス article-editor.js:792 | `_artBuildPreviewState()`＝`this.books`（除外を引いた） | 出ない（本ブロックは閲覧で丸ごと消える） |
| └ プレビュー article-editor.js:3749 | 同上 | 出ない |
| article-editor.js:1900 本ブロックの行 | `this.books`。無ければ題の代わりに ASIN | （本ブロックの全画面編集は未計測） |
| article-editor.js:1984 本棚ブロックの全画面編集の行 | 同上 | **ASIN だけ**（3/3） |
| article-editor.js:2091 本棚ブロックの行 | 同上 | （未計測） |
| article-editor.js:2802 引き出しの検索 | `this.books`。無ければ ASIN で検索 | 範囲外（引き出しは「すべて」本棚の books を出す＝#664 の範囲） |
| article-editor.js:2902 引き出しの行 | `this.books` に無ければ `{asin, title: asin}` | 同上 |
| generator:482 `_shelfBooks` | all.json の books | 呼び出し0件（#664 §2-0） |

公開物に本のデータが入る所（generator）：

| 場所 | 除外した本 |
|---|---|
| 本ブロック :564-・本棚ブロックの中 :590- | `bookData` が解決できれば出る |
| 冊数 `bookCount` :1024- | 解決できた本だけ数える（index の `books` に入る） |
| 広告ラベル | 実際に出たリンクで判定（:1031 付近） |
| og:description :895- | 文章ブロック→タグ→発行者だけ。本を使わない |
| og.png・索引の coverUrl | 本を使わない（上の表） |

### 分かったこと

1. 除外した本は、**記事の HTML の1か所だけ**から公開に出る。原因は、公開の build が除外を含む library.json で本を解決し、exclusions を読まないこと（generator:929-938）。
2. 書き手の画面（閲覧キャンバス・編集キャンバス・プレビュー）は `this.books`（除外を引いた蔵書）で解決するので、X は出ない。**書き手が見る記事と、公開される記事が食い違う**（3/3）。
3. 編集の画面では、本棚ブロックの全画面編集だけが X を ASIN で出す（3/3）。本ブロックは、閲覧では丸ごと消え、編集では中身の無い枠と⋯だけが残る。除外中だと分かる表示はどこにも無い。
4. 除外を取り消すと、キャンバス・プレビュー・公開のどれにも X が戻る（3/3）。記事のデータ（ブロックの ASIN）は、除外しても書き換わらない。
5. `public/main.json`・`settings.json` の書き手は0件で、公開の経路には関係しない。

### step2 への申し送り

- 案の比較では「書き手が見る記事＝公開される記事」（2.）を比較軸に入れる。今は案4（現状維持）でも、プレビューと公開の食い違いが残る。
- 直す所の候補は、解決の入口の `_resolveBookData` が見る `libMap`（generator:938）の1か所。公開・キャンバス・プレビューの3経路が同じ build を通るため、ここで除外を効かせれば3経路が揃う。編集の画面の表示（1900・1984・2091）は `this.books` を直に探すので、案によっては「除外中」の判定を1つの関数に寄せる。
- spec の期待（一致）は、案1〜3のどれでも成り立つ形にしてある。step3 で、承認された案の期待（公開物に X が出ない、または出て注意を出す）を足す。
