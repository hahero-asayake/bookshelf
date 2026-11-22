# イシュー#764 スマホ：引き出し→公開の一覧から開いた設定を戻ると、公開の一覧ごと閉じる

見本は tests/fixtures だけ（実データは使っていない）。base＝origin/main a303920（#762 着地済み）。

## §1 直す前（step1）

### 着地の確認

- `git log origin/main --grep='Issue: #762'`：c2e4443（fix(ui): スマホで設定の外から設定の中の画面へ直接開いた時…）・a303920。
- origin/main の先頭は a303920。`git log origin/main..issue/762` は0件。DB の issues(762) は done（02:08）。
- issue/764 は origin/main と同じ a303920 から始めた（自分の commit は無かった）。

### 段の並び（390・chromium と webkit iPhone 13 で同じ）

台本は `~/kuroko/_vault-work/764/repro/pub764.mjs`（計画run）と `drawer764.mjs`（step1）。nav.log は `種類:面:op` の形。

| 操作 | 段（nav.state.faces） | 引き出し | nav.log |
|---|---|---|---|
| 下のナビ「本棚」 | [drawer] | 開 | open:drawer:push |
| 引き出しの「公開」 | [drawer, publish-pages-modal] | **開のまま（公開の一覧が全面で隠す）** | openRoute3:publish-pages-modal:push |
| 案内「保存先を選ぶ」→設定 | [publish-pages-modal, settings-modal] | 閉 | close:drawer:go → openRoute3:settings-modal:**replace** |
| 戻る1回 | [] | 閉 | open:drawer:none → close:drawer:go |
| 進む | [drawer] | **開** | open:drawer:none |

- 設定を開く時、#760 の `_closeOverlaysForTransition` が下に残った引き出しを閉じる（close:drawer:go）。そのすぐ後の設定の push は、nav-state.js の「閉じた段を新しい面へ引き継ぐ」（push→replace）に化ける。その結果、公開の一覧のエントリが [公開の一覧, 設定] で上書きされ、公開の一覧が自分の段を失う。
- 戻ると引き出しのエントリに着く。設定と公開の一覧が閉じた後、D06 の自己修復でもう1段戻りホームへ。進むと引き出しのエントリに戻り、#291（開き直す）で引き出しが開く。
- 直す前の版（#762 の前）も、戻る2回目で公開ごと閉じていた（762-results.md の入口の表）。

### 横展開：引き出しの各入口（390・chromium と webkit で同じ結果）

`drawer764.mjs`。「開いた直後」は入口を押して 1.2 秒後。

| 入口 | 開いた直後の段 | 引き出しが下に残るか | 戻る | 戻る→進む | × | Esc |
|---|---|---|---|---|---|---|
| 公開（#sidebar-publish） | [drawer, publish-pages-modal] | **残る** | 公開も引き出しも閉じてホーム（close:drawer:go） | **引き出しが開く** | 公開だけ閉じて**引き出しに戻る**（closePublish3:go） | × と同じ（引き出しに戻る） |
| 検索（#sidebar-search） | [drawer, command-palette] | **残る** | パレットだけ閉じて引き出しに戻る | パレットが開き直る | （× なし） | パレットだけ閉じて引き出しに戻る |
| 本棚を追加（#sidebar-add-bookshelf） | [drawer, bookshelf-form-modal] | **残る** | フォームだけ閉じて引き出しに戻る | フォームが開き直る | フォームだけ閉じて引き出しに戻る | × と同じ |
| 設定（#sidebar-settings） | [settings-modal] | 閉じる（段を引き継ぐ・K2） | 閉じてホーム | 設定が開き直る | 閉じてホーム | 閉じてホーム |
| アカウント（#sidebar-account） | [settings-modal] | 閉じる（段を引き継ぐ・K2） | 閉じてホーム | 設定が開き直る | （台本で × を押せず） | 閉じてホーム |
| 本棚の木 | 未測 | — | — | — | — | — |

- 本棚の木は、台本のセレクタが本棚を開かないボタン（開閉の印）を押していた。そのため段が変わらず、未測。本棚を選ぶ経路は #634 で、引き出しを先に閉じて着地を待ってから置き換える（bookshelf.js の switchBookshelf の前）。
- 段が崩れる（ある面のエントリが他の面に上書きされる）のは公開だけ。理由：上に設定を開ける面は公開の一覧だけだから。
- 検索と本棚を追加も引き出しを下に残す。ただし段は [drawer, X] で一貫していて、戻る・進む・×・Esc はどれも「X だけ閉じて引き出しに戻る」で揃っている。
- 17表 R22（ドロワー→⌘K）の期待は「ドロワーは先に閉じている」。下のナビの「検索」は引き出しを閉じてから開くが、引き出しの中の「検索」は閉じずに重ねる＝入口で違う。

### 足した E2E（tests/e2e/back-nav-matrix.spec.js「戻る: イシュー#764 引き出し→公開の一覧」）

保存先が未設定の起動（`bootUnsynced` を #762 の describe の外へ出して共用）。実クリック・tap で操作した。

| ID | 中身 | 直す前（a303920＋テストだけ） |
|---|---|---|
| R30 | 390 引き出し→公開→案内「保存先を選ぶ」→設定→戻る＝公開の一覧が残る・段は [publish-pages-modal]・引き出しなし。もう1回＝閉じて開く前の画面。進む＝引き出しは開かず、公開の一覧が開き直る | **赤**（chromium・webkit）。「戻る1回: 公開の一覧が残る」（class は "modal" で show なし）、「戻る1回: 段は公開の一覧だけ」（[] だった）。戻る2回目はアプリの外へ出て（開く前の履歴が1段しかない）、snap の page.evaluate が `bookshelf` 未定義で落ちた |
| R31 | 390 引き出し→公開→戻る＝閉じて開く前の画面（A01）。進む＝引き出しは開かず、公開の一覧が開き直る | **赤**（chromium・webkit）。「進む: 引き出しが開かない」（drawer=true）、「進む: 公開の一覧が開き直る」（show なし）。戻る1回の側は緑 |
| R32 | × と Esc の行き先 | 番号だけ空けた（期待は tp で決める）。今の動きは上の表のとおり＝引き出しに戻る |

同じ実行で、#762 の R26〜R29・X22 は緑（chromium 5 passed、webkit 4 passed・X22 は skip）。`bootUnsynced` を外へ出しても変わらない。

実行したコマンド：
- `PORT=8164 PLAYWRIGHT_BASE_URL=http://localhost:8164 npx playwright test tests/e2e/back-nav-matrix.spec.js -g "イシュー#764|イシュー#762"`（chromium）
- 同じ条件に `BACKNAV_WEBKIT=1` と `--project=webkit` を足して webkit
