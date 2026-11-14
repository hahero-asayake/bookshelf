# #683 GitHub の E2E の模擬（gate-github.js）がフォルダの一覧を返さず、GitHub の E2E ではプラグインが常に0個・起動のたびにシードを書き直す — 記録

## §1 直す前の実測（step1・2026-11-14 20:46〜・コードは変えていない）

行番号は origin/main 9b25e4c（worktree の HEAD と同じ）のもの。

### 1-1 模擬の今の返し方（コードで確かめた）

アプリの側：`listDirs`（js/github-adapter.js L276-280）は、contents の GET の答えが配列でなければ `[]` を返す。404 は `_getContent` が null にする（L557）。プラグインの列挙（js/plugin-loader.js L52-75 `listInstalledPlugins`）は `listDirs('plugins')` の名前ごとに `plugins/<id>/manifest.json` を読む。`[]` なら manifest を1本も読まず、プラグインは0個になる。標準機能の補充（L138-190 `ensureStandardPlugins`）は、列挙に無い標準 id（L20 の5個）を全部「欠けている」とみなし、5×3＝15ファイル（manifest.json・index.js・.seed）を1回の syncBatch（blobs 15本＋tree・commit・ref）で書く。

| 模擬 | 場所 | フォルダ（`contents/plugins`）の GET に返すもの | listDirs('plugins') |
|---|---|---|---|
| gate-github（状態を持つ・門の E2E ほか） | tests/e2e/helpers/gate-github.js L109-115 | headTree と完全に一致するパスのファイルだけを `{type:'file'}` で返し、それ以外は404。フォルダも404 | `[]` |
| gate-github の接続の模擬（mockGitHubDeviceFlowForTest） | 同 L212-223 | 接続の道（/user・installations・repositories・branches）だけ答え、contents は404 | `[]` |
| storage-fakes の installFakeGitHub | tests/e2e/helpers/storage-fakes.js L181-198 | ファイルが無ければ、そのパスの下を `{type:'file'|'dir', name, path, sha}` の配列で返す。何も無ければ404 | 名前の一覧（シードの後は5個） |

spec の中に自前の模擬を持つもの（コードを読んで分類した・実測はしていない）。計画で7本と書いたうち、first-run-init-status・sync-offline-reconnect の2本は自前ではなく storage-fakes の installFakeGitHub を使っていた（L18・L90／L9・L435）。そのため実測の表（1-2）に入る。残る5本は、どれもフォルダの一覧を返さない。

| spec | フォルダの GET に返すもの | listDirs('plugins') |
|---|---|---|
| boot-confirm-dialog.spec.js | contents の GET はすべて404（L19・L55） | `[]` |
| github-sync-resilience.spec.js | 1本目：全要求を15秒待たせて500（L48-51）。2本目：1回目は503、2回目からは `{type:'file'}` の object（L63-70） | 1本目は列挙の失敗（`[]`）。2本目は配列でないので `[]` |
| preview-real-adapter.spec.js | private/books/ 以外は 200 `{installations:[],repositories:[]}`（L68-79） | 配列でないので `[]` |
| publish-panel.spec.js | すべて401（L54-57） | 認証の失敗で列挙が失敗する（`[]`） |
| username-publish-gate.spec.js | すべて 200 `{installations:[]}`（L239） | 配列でないので `[]` |

### 1-2 実測（GitHub への要求をテストごとに数えた）

- 測り方：tests/e2e/helpers/gate-github.js の `routeGitHub`（状態を持つ模擬）・`mockGitHubDeviceFlowForTest` の api.github.com の route と、storage-fakes.js の `installFakeGitHub` の route に、一時的に計測を入れた（環境変数 `GH_TRACE` がある時だけ、route.fulfill の時点で `test.info().titlePath`・要求・状態コード・答えが配列かを JSONL に書く。commit していない）。
- 流し方：計測を入れた状態で、chromium の E2E を全件流した（`PORT=8183`・workers は既定・20:47:50〜20:52:07）。結果は 1008 passed・0 failed・0 flaky・17 skipped（265秒）。webkit・gate-webkit・char の project は環境変数が要るので、流していない。
- 数えたもの（列の意味）：
  - 起動の回数：`GET /user/installations` の数。設定の同期欄が、トークンのある起動ごとに1回照会する（js/screens/settings.js L576）。電波なしで開き直した起動などは数えられないので、目安。
  - plugins の一覧の応答：`GET contents/plugins` の状態コード（200 で配列なら「配列」）。
  - シードの書き込み：`POST git/trees` のうち、body に `plugins/` のパスがあるもの。1回で blobs 15本＋tree・commit・ref の PATCH（#677 の実測で書き込み18本）。
  - blobs の本数：`POST git/blobs` の全部。シードの15本と、蔵書・本棚・メモの保存の分を合わせた数。
  - manifest を読んだ数：`GET contents/plugins/<id>/manifest.json` が 200 で返った数。listInstalledPlugins は一覧の名前ごとに読むので、読み込まれるプラグインの数の代わりに使う。0本ならプラグインは0個。
- 3つの模擬のどれも使わないテスト（ハブ・ローカルのテストなど）は、表に入らない。

#### 模擬 gate-github（23 本）

| spec | テスト名 | 起動の回数（/user/installations） | plugins の一覧の応答 | シードの書き込み（tree）の回数 | blobs の本数 | manifest を読んだ数（200） | 結果 |
|---|---|---|---|---|---|---|---|
| boot-load-checking-row.spec.js | GitHub: 起動の読込が通信で失敗したら、状態バーの読込の失敗の行が出てから2秒のうちに「最新のデータを確認しています…」が消える | 1 | 404×2 | 1（起動 1 回目の後） | 15 | 0 | expected/passed |
| boot-load-checking-row.spec.js | GitHub: 起動の読込が認証切れで失敗したら、toast が出てから2秒のうちに「最新のデータを確認しています…」が消える | 1 | 404×2 | 1（起動 1 回目の後） | 15 | 0 | expected/passed |
| boot-load-checking-row.spec.js | GitHub: 読込が成功する起動では「最新のデータを確認しています…」が出て、「保存済み」の後に消える | 2 | 404×4 | 2（起動 1・2 回目の後） | 30 | 0 | expected/passed |
| boot-load-failure-message.spec.js | GitHub: 起動の読込が通信で失敗した時、状態バーと同期欄に同じ文と「再試行」を出し、toast は出さない | 1 | 404×2 | 1（起動 1 回目の後） | 15 | 0 | expected/passed |
| boot-load-failure-message.spec.js | GitHub: 通信が戻ってから設定の同期欄の「再試行」を押すと読み直し、同期欄が「保存済み」になり状態バーの行も消える | 1 | 404×3 | 1（起動 1 回目の後） | 15 | 0 | expected/passed |
| boot-load-failure-message.spec.js | 守り GitHub: 起動の読込が認証切れで失敗した時の文は、#653 で決めた文のまま | 1 | 404×2 | 1（起動 1 回目の後） | 15 | 0 | expected/passed |
| boot-load-failure-status.spec.js | GitHub: 起動の読込が通信で失敗した時、同期欄は状態バーと同じ読込の失敗の文を出し、path に「（要再接続）」を付けない | 1 | 404×2 | 1（起動 1 回目の後） | 15 | 0 | expected/passed |
| boot-load-failure-status.spec.js | GitHub: 起動の読込が認証切れで失敗した時、同期欄は toast と同じ認証切れの文を出し、path に「（要再接続）」を付ける | 1 | 404×2 | 1（起動 1 回目の後） | 15 | 0 | expected/passed |
| boot-load-failure-status.spec.js | 守り GitHub: 保存の書き込みが通信で失敗した時は、今までどおり同期欄に「GitHub に保存できませんでした。…」を出す | 1 | 404×2 | 1（起動 1 回目の後） | 15 | 0 | expected/passed |
| boot-load-failure-tail.spec.js | GitHub: 端末にデータがある起動で読込が通信で失敗したら、読込の失敗の行が出てから2秒のうちに「最新のデータを確認しています…」が消える | 1 | 404×2 | 1（起動 1 回目の後） | 15 | 0 | expected/passed |
| boot-load-failure-tail.spec.js | GitHub: 読込が成功する起動では、プラグインの一覧を読むのは ensureStandardPlugins と loadEnabledPlugins の1回ずつ (2本) だけ | 1 | 404×2 | 1（起動 1 回目の後） | 15 | 0 | expected/passed |
| import-reload-persist.spec.js | GitHub: 再読込の後の同期と標準機能の補充のまとめ保存が重なっても、1本ずつ流れて3択が出ず、両方が保存先に入る | 2 | 404×4 | 2（起動 1・2 回目の後） | 38 | 0 | expected/passed |
| import-reload-persist.spec.js | GitHub: 取込の直後に待たずに再読込しても、取り込んだ本が残り保存先にも入り、衝突の3択が出ない | 2 | 404×4 | 2（起動 1・2 回目の後） | 38 | 0 | expected/passed |
| j1-4-github-save-reload.spec.js | @gate J1-4 PC で GitHub に接続してリポジトリを選び「この設定で使う」を押すと、開き直した後も再読込の後も、保存先はそのリポジトリでその蔵書が見える | 3 | 404×3 | 1（起動 2 回目の後） | 22 | 0 | expected/passed |
| j6-2-github-other-device.spec.js | @gate J6-2 GitHub：端末Aで書いた短文メモが、別の端末で開くと読める | 2 | 404×4 | 2（起動 1・2 回目の後） | 38 | 0 | expected/passed |
| j6-4-sync-conflict.spec.js | @gate J6-4 GitHub：2台で同じ本の短文メモを書いて衝突すると、選び方が出て、書き出しと読み込みで失われず、リポジトリからAの短文メモも消えない | 3 | 404×6 | 3（起動 1・2・3 回目の後） | 53 | 0 | expected/passed |
| manual-add-reload-all-shelf.spec.js | 662-GH GitHub：1回目の保存の後に手動で追加した直後に再読込しても、すべての本と端末の控えの冊数が合う | 2 | 404×4 | 2（起動 1・2 回目の後） | 38 | 0 | expected/passed |
| online-resync.spec.js | GitHub でも、電波なしのまま開き直した端末は、電波が戻ると読み直して、前の回に書いた短文メモを届ける (イシュー#617 穴1) | 1 | 404×4 | 2（起動 1・1 回目の後） | 38 | 0 | expected/passed |
| sync-chosen-mark.spec.js | 保存済みの人 (決めた印が入る前に保存した人) の method は変わらない › (d-2) GitHub を保存先にしていた人は、method が GitHub のままで「決めた」扱い | 2 | — | 0 | 0 | 0 | expected/passed |
| sync-conflict-overwrite.spec.js | GitHub: 書き込みで衝突した時に「この端末の内容で保存先を上書き」を選ぶと、保存先が端末の内容になり、続けて書いても衝突しない | 3 | 404×6 | 3（起動 1・2・3 回目の後） | 69 | 0 | expected/passed |
| sync-conflict-overwrite.spec.js | GitHub: 上書きを選んだ時に保存先を読み直せないと、何も書かずに知らせ、衝突中の印と未反映の印を残して選び直せる | 2 | 404×4 | 2（起動 1・2 回目の後） | 46 | 0 | expected/passed |
| sync-github-disconnect.spec.js | GitHub を保存先にする人 › GitHub を保存先にしている人が切断すると、保存先は local に戻り、決めた印が外れる | 1 | 404×2 | 1（起動 1 回目の後） | 15 | 0 | expected/passed |
| sync-section-status.spec.js | 同期欄に保存の状態が見える: GitHub の未保存 (イシュー#657) › 書き込み時の3択を選ばずに閉じた後、同期欄に状態バーと同じ文と「選ぶ」が見え、上書きを選ぶと正常に戻る | 2 | 404×4 | 2（起動 1・2 回目の後） | 46 | 0 | expected/passed |

- 集計（retry 0 の 23 本）：プラグイン0個（manifest を1本も読まない）23 本／うちシードの書き込みあり 22 本／うち同じテストの中でシードを2回以上書いた（＝一度書いた後の起動でも書き直した） 10 本／manifest を5本以上読んだ（＝5個が読み込まれる経路を通った）0 本
- シードの書き込みの合計 34 回・blobs の合計 621 本・GitHub への要求の合計 1560 本（うち書き込み 762 本）

#### 模擬 storage-fakes（28 本）

| spec | テスト名 | 起動の回数（/user/installations） | plugins の一覧の応答 | シードの書き込み（tree）の回数 | blobs の本数 | manifest を読んだ数（200） | 結果 |
|---|---|---|---|---|---|---|---|
| book-memo-file-lifecycle.spec.js | 長文メモ: 変更してすぐ再読込 GitHub (イシュー#594) › 題名を変えてすぐ再読込しても、新しい名前で読め、次の保存で古いファイルが消える | 2 | 404×1・配列×3 | 1（起動 1 回目の後） | 32 | 5 | expected/passed |
| book-memo-file-lifecycle.spec.js | 長文メモ: 保存先に書けない間の変更 GitHub (イシュー#594) › 書けない間に題名を変えても、記録が残り、次の保存で新しい名前へ移って古いファイルが消える | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 41 | 5 | expected/passed |
| book-memo-file-lifecycle.spec.js | 長文メモのファイルが取り残されない: GitHub (イシュー#594) › ASIN を変えると、長文メモが新しい名前で読め、古いファイルが残らない | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 32 | 5 | expected/passed |
| book-memo-file-lifecycle.spec.js | 長文メモのファイルが取り残されない: GitHub (イシュー#594) › 題名を変えると、長文メモが新しい名前で読め、古いファイルが残らない | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 32 | 5 | expected/passed |
| book-memo-file-lifecycle.spec.js | 長文メモのファイルが取り残されない: GitHub (イシュー#594) › 本を削除すると、保存先からその本の長文メモのファイルが消える | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 31 | 5 | expected/passed |
| book-memo-file-lifecycle.spec.js | 長文メモのファイルが取り残されない: GitHub・使えない文字と空白を含む題名 (イシュー#594) › ASIN を変えると、長文メモが新しい名前で読め、古いファイルが残らない | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 32 | 5 | expected/passed |
| book-memo-file-lifecycle.spec.js | 長文メモのファイルが取り残されない: GitHub・使えない文字と空白を含む題名 (イシュー#594) › 題名を変えると、長文メモが新しい名前で読め、古いファイルが残らない | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 32 | 5 | expected/passed |
| book-memo-file-lifecycle.spec.js | 長文メモのファイルが取り残されない: GitHub・使えない文字と空白を含む題名 (イシュー#594) › 本を削除すると、保存先からその本の長文メモのファイルが消える | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 31 | 5 | expected/passed |
| book-memo-file-lifecycle.spec.js | 本の編集: 前の保存が終わってから題名を変える GitHub (イシュー#614) › 再読込しなくても、題名の変更が保存先に届く | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 31 | 5 | expected/passed |
| book-memo-file-lifecycle.spec.js | 本の編集: 前の保存が終わってから題名を変える GitHub (イシュー#614) › 編集を終えてすぐ再読込しても、題名が戻らず保存先にも届く | 2 | 404×1・配列×3 | 1（起動 1 回目の後） | 31 | 5 | expected/passed |
| first-run-init-status.spec.js | GitHub: 空の保存先を初期化する間、状態の欄は「読み込み中...」で、読込の後に「保存済み」になり、「保存できませんでした」は出ない | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 15 | 5 | expected/passed |
| first-run-init-status.spec.js | GitHub: 初期化の確認でキャンセルした後は、今までどおり「保存できませんでした」と「(空)（要再接続）」を出す | 1 | — | 0 | 0 | 0 | expected/passed |
| save-failure-visible.spec.js | GitHub: トークンを更新しても 401 なら、再試行を待たずに「接続し直す」の案内がすぐ出る (イシュー#603) | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 42 | 5 | expected/passed |
| save-failure-visible.spec.js | GitHub: 保存で 401 が返ったら、トークンを更新して1回だけ保存し直し、何も出さずに保存される (イシュー#603) | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 42 | 5 | expected/passed |
| save-failure-visible.spec.js | 保存の失敗が画面に出る: GitHub (イシュー#603) › 1回目の自動の再試行で直る失敗は、何も出さずに保存される | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 42 | 5 | expected/passed |
| save-failure-visible.spec.js | 保存の失敗が画面に出る: GitHub (イシュー#603) › 再試行が尽きた失敗は状態バーに原因と「再試行」が出て、「再試行」・次の保存で消える (通常の保存と本棚の削除) | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 129 | 5 | expected/passed |
| shelf-file-delete.spec.js | 本棚の削除で保存先の本棚ファイルも消える: GitHub (イシュー#587) › 子を持つ本棚を削除すると、親と子の両方のファイルが保存先から消える | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 42 | 5 | expected/passed |
| shelf-file-delete.spec.js | 本棚の削除で保存先の本棚ファイルも消える: GitHub (イシュー#587) › 本棚の名前を変えても、保存先の本棚ファイルは同じ1つのまま (古いファイルが残らない) | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 33 | 5 | expected/passed |
| shelf-file-delete.spec.js | 本棚の削除で保存先の本棚ファイルも消える: GitHub (イシュー#587) › 本棚を1つ削除すると、保存先からその本棚のファイルが消える | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 32 | 5 | expected/passed |
| shelf-file-delete.spec.js | 本棚ファイルの削除待ち: GitHub (イシュー#587) › 削除の保存が一度失敗しても、次の保存で本棚ファイルが消える | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 52 | 5 | expected/passed |
| shelf-file-delete.spec.js | 本棚ファイルの削除待ち: GitHub (イシュー#587) › 削除待ちの slug で作り直した本棚のファイルは消えない | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 51 | 5 | expected/passed |
| shelf-file-delete.spec.js | 本棚ファイルの削除待ち: GitHub (イシュー#587) › 保存先にまだ無い本棚ファイルの削除が混ざっても、保存は失敗しない | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 43 | 5 | expected/passed |
| sync-offline-reconnect.spec.js | GitHub: 初めてつなぐ時・ログアウトしていた間の編集 (イシュー#602) › ログアウトしていた間に足した本とメモが、ログインし直した後も残る | 3 | 404×1・配列×3 | 1（起動 2 回目の後） | 31 | 5 | expected/passed |
| sync-offline-reconnect.spec.js | GitHub: 初めてつなぐ時・ログアウトしていた間の編集 (イシュー#602) › 手元に本がある状態で空の保存先を初めてつなぐと、手元の本が残り、保存先にも書かれる | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 23 | 5 | expected/passed |
| sync-offline-reconnect.spec.js | GitHub: 書き込みに失敗している間の編集が、再読込の後も残る (イシュー#602) › 書き込み失敗中に本の追加・本棚の削除・メモ編集をして、再読込する | 2 | 404×1・配列×3 | 1（起動 1 回目の後） | 40 | 5 | expected/passed |
| sync-section-status.spec.js | 同期欄に保存の状態が見える: GitHub (イシュー#657) › 正常: 保存の後、同期欄に「保存済み」が見える | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 23 | 5 | expected/passed |
| sync-section-status.spec.js | 同期欄に保存の状態が見える: GitHub (イシュー#657) › 保存失敗: 再試行が尽きた後、同期欄に状態バーと同じ文と「再試行」が見え、押すと保存されて正常に戻る | 1 | 404×1・配列×1 | 1（起動 1 回目の後） | 63 | 5 | expected/passed |
| sync-section-status.spec.js | 同期欄に保存の状態が見える: GitHub の未保存 (イシュー#657) › 読込時の3択を選ばずに閉じた後、同期欄に状態バーと同じ文と「選ぶ」が見え、選ぶと正常に戻る | 2 | 404×1・配列×3 | 1（起動 1 回目の後） | 31 | 5 | expected/passed |

- 集計（retry 0 の 28 本）：プラグイン0個（manifest を1本も読まない）1 本／うちシードの書き込みあり 0 本／うち同じテストの中でシードを2回以上書いた（＝一度書いた後の起動でも書き直した） 0 本／manifest を5本以上読んだ（＝5個が読み込まれる経路を通った）27 本
- シードの書き込みの合計 27 回・blobs の合計 1059 本・GitHub への要求の合計 3169 本（うち書き込み 1562 本）

#### 模擬 gate-deviceflow（6 本）

| spec | テスト名 | 起動の回数（/user/installations） | plugins の一覧の応答 | シードの書き込み（tree）の回数 | blobs の本数 | manifest を読んだ数（200） | 結果 |
|---|---|---|---|---|---|---|---|
| j1-3-connect-github.spec.js | @gate J1-3 PC で保存先を GitHub にして「GitHub に接続」を押すと、コードが出て、承認後につながったアカウントが見える | 1 | — | 0 | 0 | 0 | expected/passed |
| sync-github-disconnect.spec.js | 「この端末のフォルダ」を保存先にしている人 › フォルダをつないだ人が、GitHub に接続しても、切断しても、保存先は「この端末のフォルダ」のまま | 1 | — | 0 | 0 | 0 | expected/passed |
| sync-github-disconnect.spec.js | 「この端末のフォルダ」を保存先にしている人 › フォルダをまだ選んでいない人 (公開先は自分の GitHub リポジトリ) が切断しても、決めた印は残り、公開の注記が出る | 1 | — | 0 | 0 | 0 | expected/passed |
| sync-github-disconnect.spec.js | GitHub を保存先にする人 › GitHub に接続しただけでは保存先を決めた扱いにならず、「この設定で使う」を押すと GitHub に決まる | 3 | — | 0 | 0 | 0 | expected/passed |
| sync-github-disconnect.spec.js | ハブを保存先にしている人 › ハブにログインして「この設定で使う」を押した人が、GitHub に接続しても、切断しても、保存先はハブのまま | 2 | — | 0 | 0 | 0 | expected/passed |
| sync-github-disconnect.spec.js | ハブを保存先にしている人 › 決めた印が入る前からハブを保存先にしていた人 (印なし) も、GitHub の接続と切断で method も印も変わらない | 1 | — | 0 | 0 | 0 | expected/passed |

- 集計（retry 0 の 6 本）：プラグイン0個（manifest を1本も読まない）6 本／うちシードの書き込みあり 0 本／うち同じテストの中でシードを2回以上書いた（＝一度書いた後の起動でも書き直した） 0 本／manifest を5本以上読んだ（＝5個が読み込まれる経路を通った）0 本
- シードの書き込みの合計 0 回・blobs の合計 0 本・GitHub への要求の合計 26 本（うち書き込み 0 本）

### 1-3 集計と、brief の前提の判定

| 模擬 | テストの本数 | プラグイン0個 | うちシードの書き込みあり | うち同じテストの中でシードを2回以上書いた | 5個が読み込まれる経路を通った（manifest 5本） | シードの書き込みの合計 | GitHub への書き込みの要求の合計 |
|---|---|---|---|---|---|---|---|
| gate-github（状態を持つ） | 23 | **23** | **22** | **10**（2回が8本・3回が2本） | 0 | 34回 | 762本（うちシード分は 34×18＝612本の見込み） |
| gate-github の接続の模擬 | 6 | 6（一覧を読む所まで行かない） | 0 | 0 | 0 | 0回 | 0本 |
| storage-fakes の installFakeGitHub | 28 | 1（first-run-init-status の「キャンセル」の1本・一覧を読む所まで行かない） | 0 | 0 | **27** | 27回（どのテストも1回目の起動の後の1回だけ） | 1562本 |

- **brief の数（「プラグイン0個・シードの書き込みあり」）：gate-github の模擬で 23 本中 22 本**。残る1本（sync-chosen-mark の (d-2)）は、一覧を読む所まで進まないテスト。22本のうち10本は、同じテストの中で起動するたびにシードを書き直した（合計34回のうち12回が書き直し）。
  - 書き直した10本：boot-load-checking-row（読込が成功する起動）・import-reload-persist（GitHub の2本）・j6-2・j6-4（3回）・manual-add-reload-all-shelf（662-GH）・online-resync（GitHub）・sync-conflict-overwrite（2本・1本は3回）・sync-section-status（GitHub の未保存）。
  - j1-4 は起動3回でシードは1回。1回目の起動はまだ GitHub につないでいないので、2回目の起動の後のシードが最初の1回。3回目の起動のシードは、テストが終わるまでに来ていない。
- **brief の前提「GitHub の保存先でプラグインが有効になる経路を、E2E が1本も通っていない」は、半分だけ正しい**。
  - 誤り：storage-fakes の installFakeGitHub を使う 28 本中 27 本は、GitHub の保存先で manifest を5本読んでいる。つまりプラグインが読み込まれる経路は通っている。内訳は book-memo-file-lifecycle 10・shelf-file-delete 6・save-failure-visible 4・sync-offline-reconnect 3・sync-section-status 3・first-run-init-status 1。2回目以降の起動では一覧が配列で返り、シードは書き直していない。
  - 正しい：その27本のどれも、プラグインの数を確かめる expect を持たない。GitHub の spec でプラグインに触れるのは2本だけで、どちらも gate-github の模擬。
    - boot-load-failure-tail.spec.js L113-122：一覧の要求が起動1回で2本であることを数える。
    - import-reload-persist.spec.js L180-235：起動のたびに補充が走ることを前提にしている（L181）。
  - 門の E2E（@gate の j1-4・j6-2・j6-4）と、#653〜#677 で足した起動・同期の spec は、どれも gate-github の模擬を使う。そのため、本物と違う「起動のたびにシードを書き直す」を毎回踏んでいる。
- 要求の量：gate-github の模擬の書き込みの要求 762本のうち、シードの分は約612本（約8割）の見込み。1回のシードを18本とした数。blobs で見ると、621本のうち 34×15＝510本。

### 1-4 一時の計測の片付け

- 20:52:40 に `git checkout -- tests/e2e/helpers` で計測を戻した。その直後の `git status --short` は0行（空）で、HEAD は 9b25e4c。この results の写しは、その後に置いた。
- 計測の生データは /tmp/683/ にあり、commit しない。trace-full.jsonl が 4755行、full-report.json が Playwright の JSON、analyze.mjs が集計。

## §2 案の比較と試作（step2・2026-11-14 20:54〜20:58）

### 2-1 試作の測り方

- 案 (a) を worktree に一時的に当てた（commit していない）。gate-github.js の contents の GET で、完全に一致するファイルが無い時は、headTree からそのパスの下を `{type:'file'|'dir', name, path, sha}` の配列で返す。何も無ければ404を返す。作りは storage-fakes.js L181-198 と同じ。
- 計測は step1 と同じ（`GH_TRACE`）。gate-github を使う spec 15ファイル（§1 の表の全部と j1-3）を、続けて2回流した（chromium・`PORT=8183`・workers は既定）。1回目は当てない時（ベースライン）、2回目は当てた時。
  - ベースライン：82 passed・0 failed・2 skipped（51秒）
  - (a)：81 passed・**1 failed**・2 skipped（50秒）

### 2-2 試作の結果（gate-github の模擬を使った23本・左が今、右が (a)）

| spec | テスト名 | 結果（今→(a)） | plugins の一覧（今→(a)） | manifest を読んだ数 | シードの書き込み | blobs | 書き込みの要求 | 時間 秒（今→(a)） |
|---|---|---|---|---|---|---|---|---|
| boot-load-checking-row.spec.js | GitHub: 読込が成功する起動では「最新のデータを確認しています…」が出て、「保存済み」の後に消える | 緑→緑 | 404×4 → 404×1・配列×3 | 0→5 | 2→1 | 30→15 | 36→18 | 0.4→0.4 |
| boot-load-checking-row.spec.js | GitHub: 起動の読込が認証切れで失敗したら、toast が出てから2秒のうちに「最新のデータを確認しています…」が消える | 緑→緑 | 404×2 → 404×1・配列×1 | 0→5 | 1→1 | 15→15 | 18→18 | 1.4→0.4 |
| boot-load-checking-row.spec.js | GitHub: 起動の読込が通信で失敗したら、状態バーの読込の失敗の行が出てから2秒のうちに「最新のデータを確認しています…」が消える | 緑→緑 | 404×2 → 404×1・配列×1 | 0→5 | 1→1 | 15→15 | 18→18 | 5.3→4.2 |
| boot-load-failure-message.spec.js | GitHub: 起動の読込が通信で失敗した時、状態バーと同期欄に同じ文と「再試行」を出し、toast は出さない | 緑→緑 | 404×2 → 404×1・配列×1 | 0→5 | 1→1 | 15→15 | 18→18 | 3.7→2.6 |
| boot-load-failure-message.spec.js | GitHub: 通信が戻ってから設定の同期欄の「再試行」を押すと読み直し、同期欄が「保存済み」になり状態バーの行も消える | 緑→緑 | 404×2 → 404×1・配列×3 | 0→5 | 1→1 | 15→15 | 18→18 | 3.8→2.8 |
| boot-load-failure-message.spec.js | 守り GitHub: 起動の読込が認証切れで失敗した時の文は、#653 で決めた文のまま | 緑→緑 | 404×2 → 404×1・配列×1 | 0→5 | 1→1 | 15→15 | 18→18 | 0.3→0.3 |
| boot-load-failure-status.spec.js | GitHub: 起動の読込が認証切れで失敗した時、同期欄は toast と同じ認証切れの文を出し、path に「（要再接続）」を付ける | 緑→緑 | 404×2 → 404×1・配列×1 | 0→5 | 1→1 | 15→15 | 18→18 | 1.3→1.5 |
| boot-load-failure-status.spec.js | GitHub: 起動の読込が通信で失敗した時、同期欄は状態バーと同じ読込の失敗の文を出し、path に「（要再接続）」を付けない | 緑→緑 | 404×2 → 404×1・配列×1 | 0→5 | 1→1 | 15→15 | 18→18 | 2.6→2.7 |
| boot-load-failure-status.spec.js | 守り GitHub: 保存の書き込みが通信で失敗した時は、今までどおり同期欄に「GitHub に保存できませんでした。…」を出す | 緑→緑 | 404×2 → 404×1・配列×1 | 0→5 | 1→1 | 15→15 | 18→18 | 2.4→2.4 |
| boot-load-failure-tail.spec.js | GitHub: 端末にデータがある起動で読込が通信で失敗したら、読込の失敗の行が出てから2秒のうちに「最新のデータを確認しています…」が消える | 緑→緑 | 404×2 → 404×1・配列×1 | 0→5 | 1→1 | 15→15 | 18→18 | 2.6→2.7 |
| boot-load-failure-tail.spec.js | GitHub: 読込が成功する起動では、プラグインの一覧を読むのは ensureStandardPlugins と loadEnabledPlugins の1回ずつ (2本) だけ | 緑→緑 | 404×2 → 404×1・配列×1 | 0→5 | 1→1 | 15→15 | 18→18 | 1.9→1.9 |
| import-reload-persist.spec.js | GitHub: 再読込の後の同期と標準機能の補充のまとめ保存が重なっても、1本ずつ流れて3択が出ず、両方が保存先に入る | **緑→赤**（L232 `expect.poll(() => patches.length).toBeGreaterThanOrEqual(2)` が1のまま切れる） | 404×4 → 404×1・配列×3 | 0→5 | 2→1 | 38→23 | 47→29 | 1.4→19.3 |
| import-reload-persist.spec.js | GitHub: 取込の直後に待たずに再読込しても、取り込んだ本が残り保存先にも入り、衝突の3択が出ない | 緑→緑 | 404×4 → 404×1・配列×3 | 0→5 | 2→1 | 38→23 | 47→29 | 1.4→1.5 |
| j1-4-github-save-reload.spec.js | @gate J1-4 PC で GitHub に接続してリポジトリを選び「この設定で使う」を押すと、開き直した後も再読込の後も、保存先はそのリポジトリでその蔵書が見える | 緑→緑 | 404×3 → 404×1・配列×3 | 0→5 | 1→1 | 19→15 | 22→18 | 8.8→9.5 |
| j6-2-github-other-device.spec.js | @gate J6-2 GitHub：端末Aで書いた短文メモが、別の端末で開くと読める | 緑→緑 | 404×4 → 404×1・配列×3 | 0→10 | 2→1 | 38→23 | 47→29 | 4.3→4.0 |
| j6-4-sync-conflict.spec.js | @gate J6-4 GitHub：2台で同じ本の短文メモを書いて衝突すると、選び方が出て、書き出しと読み込みで失われず、リポジトリからAの短文メモも消えない | 緑→緑 | 404×6 → 404×1・配列×5 | 0→10 | 3→1 | 53→23 | 65→29 | 3.8→3.9 |
| manual-add-reload-all-shelf.spec.js | 662-GH GitHub：1回目の保存の後に手動で追加した直後に再読込しても、すべての本と端末の控えの冊数が合う | 緑→緑 | 404×4 → 404×1・配列×3 | 0→5 | 2→1 | 38→23 | 47→29 | 1.5→1.5 |
| online-resync.spec.js | GitHub でも、電波なしのまま開き直した端末は、電波が戻ると読み直して、前の回に書いた短文メモを届ける (イシュー#617 穴1) | 緑→緑 | 404×4 → 404×1・配列×3 | 0→5 | 2→1 | 38→23 | 47→29 | 4.7→4.4 |
| sync-chosen-mark.spec.js | 保存済みの人 (決めた印が入る前に保存した人) の method は変わらない › (d-2) GitHub を保存先にしていた人は、method が GitHub のままで「決めた」扱い | 緑→緑 | — → — | 0→0 | 0→0 | 0→0 | 0→0 | 0.2→0.2 |
| sync-conflict-overwrite.spec.js | GitHub: 上書きを選んだ時に保存先を読み直せないと、何も書かずに知らせ、衝突中の印と未反映の印を残して選び直せる | 緑→緑 | 404×4 → 404×1・配列×3 | 0→10 | 2→1 | 46→31 | 58→40 | 6.5→6.6 |
| sync-conflict-overwrite.spec.js | GitHub: 書き込みで衝突した時に「この端末の内容で保存先を上書き」を選ぶと、保存先が端末の内容になり、続けて書いても衝突しない | 緑→緑 | 404×6 → 404×1・配列×5 | 0→10 | 3→1 | 69→39 | 87→51 | 5.5→5.7 |
| sync-github-disconnect.spec.js | GitHub を保存先にする人 › GitHub を保存先にしている人が切断すると、保存先は local に戻り、決めた印が外れる | 緑→緑 | 404×2 → 404×1・配列×1 | 0→5 | 1→1 | 15→15 | 18→18 | 0.6→0.6 |
| sync-section-status.spec.js | 同期欄に保存の状態が見える: GitHub の未保存 (イシュー#657) › 書き込み時の3択を選ばずに閉じた後、同期欄に状態バーと同じ文と「選ぶ」が見え、上書きを選ぶと正常に戻る | 緑→緑 | 404×4 → 404×1・配列×3 | 0→10 | 2→1 | 46→31 | 58→40 | 4.5→4.5 |
| **計 23 本** | | | | 5本以上 0→22 本 | 34→22 | 618→434 | 759→539 | 68.9→83.7 |

- **落ちたのは import-reload-persist の1本だけ**（予想どおり）。
  - (a) では、1回目の起動のシードで plugins/ が入る。そのため再読込の後の起動では一覧が配列で返り、補充が走らない。再読込の後の PATCH は同期の1本だけになり、L232 の `patches.length >= 2` が15秒で切れる。
  - L231 の plugins/ の poll は、1回目のシードで満たされる（(a) では、待つ意味の無い待ちになる）。
- **他の22本は緑のまま**。22本とも manifest を5本以上読む＝標準5個が読み込まれる経路を通る。2台を使う j6-2・j6-4・sync-conflict-overwrite（2本）・sync-section-status は10本。標準5個が activate しても、22本の expect は1つも変わらなかった。ハブの spec では、もともと5個が activate している。
- **シードの書き込みは 34→22回**（どのテストも1回目の起動の後の1回だけ）。blobs は 618→434本、書き込みの要求は 759→539本（−29%）。
- boot-load-failure-tail L113（一覧の要求が起動1回で2本）は、(a) でも「404×1・配列×1」の2本で緑。ensureStandardPlugins が404→シード→`_installed=null`→loadEnabledPlugins が配列、の順になる。
- **時間**：落ちた1本を除く22本の合計は 67.5→64.4秒。15ファイル全体の経過時間は 51→50秒。差は揺れの範囲で、流れる時間はほぼ変わらない。

### 2-3 import-reload-persist の1本の直し方（試作した）

- **案**：1回目の起動のシードが入るのを待ってから、模擬の head から plugins/ を消す（別の端末で plugins/ が消えた場面）。こうすると、再読込の後の起動で補充が走り、同期と重なる＝テストの目的（同期と補充のまとめ保存が重なっても、1本ずつ流れて3択が出ない）はそのまま。
- **試作**：spec の中で gh.trees・gh.commits を直に書いた（L219 の後ろに10行）。(a) の上で `--repeat-each=3` で import-reload-persist を全件流し、3回とも緑だった（21 passed・6 skipped・12.9秒）。
- **step3 での形**：消す処理を gate-github.js の関数（例：`removeGitHubPathsForTest(state, prefix)`＝1つの commit で消す）にし、spec から呼ぶ。コメントも2か所直す。
  - import-reload-persist L181「模擬はディレクトリの一覧に 404 を返すので、補充は起動のたびに走る」
  - boot-load-failure-tail L8「GitHub の模擬はフォルダの一覧を返さないので、成功でも0個になる」
- **推さない別案**：この1本だけ一覧を返さない模擬にする（`createMockGitHubForTest({ listDirs: false })`）。変える量は小さいが、本物と違う作りを1つ残す。

### 2-4 比較の表

| 軸 | (a) 既定で一覧を返す | (a') spec ごとに選ぶ（既定は今のまま） | (b) gate-github は変えず、storage-fakes で1本足す |
|---|---|---|---|
| 1. 既存の spec への影響 | import-reload-persist の1本が落ちる（実測）。plugins/ を消す形に直す（試作で3回緑）。他の22本は緑のまま。コメント2か所を直す | 無し（既定は今のまま） | 無し |
| 2. 実際の GitHub API との近さ | 近い。フォルダは配列、無いパスは404（下の引用）。ハブ・storage-fakes の模擬とも揃う | 既定は遠いまま（フォルダも404）。選んだ spec だけ近い | gate-github は遠いまま。storage-fakes はもともと近い |
| 3. 流れる時間 | 22本の合計 67.5→64.4秒（揺れの範囲）。書き込みの要求は −29%（759→539）。新しい spec が1本増える | 変わらない。新しい spec が1本増える | 変わらない。新しい spec が1本増える |
| 4. 本物と違う挙動が門の E2E に残るか | 残らない（j1-4・j6-2・j6-4 でも5個が読み込まれ、シードは1回だけ） | 残る（門の spec が選ばなければ、プラグイン0個・起動のたびのシードのまま） | 残る（gate-github の22本は、プラグイン0個・起動のたびのシードのまま） |
| 変える量 | gate-github.js 約12行＋消す関数、import-reload-persist の1本、コメント2か所、新しい spec 1本 | gate-github.js 約14行（引数と分岐）、新しい spec 1本 | 新しい spec 1本だけ |

実際の API（docs.github.com「Get repository content」https://docs.github.com/en/rest/repos/contents#get-repository-content ・20:56 に取得）：
- 本文の引用：「If the content is a directory: The response will be an array of objects, one object for each item in the directory.」
- 本文の引用：「This API has an upper limit of 1,000 files for a directory.」
- 状態コードの一覧に「404 - Resource not found」がある。
- 各要素の項目は `type`・`size`・`name`・`path`・`sha`・`url`・`git_url`・`html_url`・`download_url`・`_links`。ただし、取得した本文で確かめられたのは object 形式の例だけ。
- 配列の各要素の `type` が `dir` になること：docs の取得本文では確かめられず（フォルダの schema の部分が欠けていた）、GitHub の REST の既知の挙動に依った。要素の `type` は `file` か `dir`（ほかに `symlink`・`submodule`）。アプリは `type === 'dir'` で読む（js/github-adapter.js L279）。（②の申し送りで書き直した）

### 2-5 推奨：(a)

理由：
1. 門の E2E（j1-4・j6-2・j6-4）を含む gate-github の22本が、本物では起きない「プラグイン0個・起動のたびのシード」の上で流れている（§1）。(a') と (b) では、これが残る。
2. 実際の API・ハブの模擬・storage-fakes の模擬と揃う。
3. 影響は1本だけで、その直し方は試作で3回緑だった。時間は変わらず、書き込みの要求が約3割減る。

**②の申し送りへの答え（brief の前提が半分誤りだった件）**
- 「経路は通っているが数を確かめていない」のは、storage-fakes の installFakeGitHub を使う27本。
- それでも gate-github を直す価値はある。門の E2E と、#653〜#677 で足した起動・同期の spec（22本）は、プラグインが有効な状態での同期・衝突・読み直しを一度も通っていない。しかも本物では起きない毎回のシード（うち10本は起動のたびの書き直し・書き込みの要求の約8割）の上で流れている。(a) の試作では、この22本がそのまま緑で、5個が有効な状態を通るようになった。
- (b) の方が小さい（新しい spec 1本だけで、既存への影響は無い）。ただし上の違いは残る。

**新しい spec（step3）**
- gate-github で起動すると、シードが1回入り、同じ起動で標準5個が有効になる。
- 再読込しても5個のままで、シードの書き込み（POST git/blobs・git/trees）は0本。
- この2点を画面の経路で確かめる。(b) を選んだ場合も、同じ中身を storage-fakes で書ける。

### 2-6 試作の片付け

- 20:58:01 に `git checkout -- tests/e2e/helpers tests/e2e/import-reload-persist.spec.js` で、試作と計測を戻した。直後の `git status --short` は `?? scripts/verify/683-results.md` の1行だけ（この results）。
- 生データは /tmp/683/ にあり、commit しない。base-report.json と a-report.json が Playwright の JSON、trace-base.jsonl・trace-a.jsonl・trace-a-fix.jsonl が計測、compare.mjs が比べるスクリプト、apply-a.cjs と apply-fix-irp.cjs が試作の差分。

## §3 直したもの（step3・2026-11-14 21:00〜・案 (a)）

②が (a) に決めた（20:59）。アプリのコード（js/）は変えていない。そのため ?v= も変えていない。

### 3-1 差分

- tests/e2e/helpers/gate-github.js
  - contents の GET で、完全に一致するファイルが無い時は、その下の一覧を返すようにした。形は `{ type: 'file' | 'dir', name, path, sha }` の配列で、何も無ければ404。作りは storage-fakes.js の installFakeGitHub と同じ。冒頭の「模擬するのは」のコメントも直した。
  - `removeGitHubPathsForTest(state, prefix)` を足した。prefix で始まるファイルを1つの commit で消し、main（ref）を進める＝別の端末で消した場面と同じ流れ（②の申し送りどおり）。返り値は消したファイルの数。
- tests/e2e/import-reload-persist.spec.js（GitHub の「再読込の後の同期と標準機能の補充のまとめ保存が重なっても…」）
  - 1回目の起動の補充が入るのを待ってから、`removeGitHubPathsForTest(gh, 'plugins/')` で plugins/ を消し、それから取込と再読込をする形にした。再読込の後の起動で補充が走り、同期と重なる。
  - テストの目的と、待つ条件（L231 の plugins/・patches≥2・422 が0本・3択が0）は変えていない。コメント（前の L181）も直した。
- tests/e2e/boot-load-failure-tail.spec.js：L8 のコメント「GitHub の模擬はフォルダの一覧を返さないので、成功でも0個になる」を直した（コメントだけ）。
- tests/e2e/gate/README.md：保存先を GitHub にする行に、一覧を返すことと `removeGitHubPathsForTest` を書き足した。
- 新しい spec：tests/e2e/github-standard-plugins.spec.js（1本・chromium・gate-github の模擬）。画面の経路（起動と `page.reload()`）で、次を確かめる。
  - 1回目の起動：標準5個が `bookshelf.pluginLoader.loaded` に入る（読み方は plugin-seed.spec.js L110 と同じ）。リポジトリに plugins/ の5個がある。plugins/ の下を書いた commit が1つ。読み込みの失敗が0件。
  - 再読込の後：5個のまま。再読込の後に届いた、まとめ保存の書き込み（POST git/blobs・git/trees）が0本。plugins/ の下を書いた commit は1つのまま。

### 3-2 手元の確認

- **新しい spec と import-reload-persist（全9本）を `--repeat-each=3` で流した**：24 passed・6 skipped・13.7秒で、3回とも緑。skipped は、もとから skip の R2 の2本が3回ずつ。
- **新しい spec が直す前の模擬で落ちることを確かめた**：gate-github.js だけを HEAD の版に一時的に戻して流すと、`loaded` が `[]` のままで落ちた（1 failed）。その後、直した版に戻した。
- **gate-github を使う spec 15ファイル＋新しい spec＋plugin-seed.spec.js**：86 passed・0 failed・2 skipped（52秒）。
- **lint:internal-refs**（②の申し送り）：82件（上限82）で、直す前と変わらない。
  - この lint が数えるのは `bookshelf._<英字>` と `app._<英字>`（scripts/check-test-internal-refs.mjs L82-83）。
  - 新しい spec の `window.bookshelf.pluginLoader.loaded` は数える形ではない。plugin-seed.spec.js L110・boot-load-failure-tail L28-32 と同じ扱い。
  - 新しい spec の中で数えられるものは0件。冒頭のコメントの「bookshelf._*」は、`_` の後が英字でないので当たらない。
- **E2E の lint**：e2e-goto・e2e-wait・e2e-external・known-red・e2e-gate（@gate 41本・違反0・観測点の網羅 37/37）も OK。
- 全件の比較・`npm run lint`・`npm test` は step4 で行う。
