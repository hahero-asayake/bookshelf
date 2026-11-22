# イシュー#765 スマホ：検索を引き出しの中から開くと引き出しが下に残る（下のナビからとは違う）

見本は tests/fixtures だけ（実データは使っていない）。base＝origin/main 81057c1（#764 着地済み）。

## §1 直す前（step1）

### 着地の確認

- `git log origin/main --grep='Issue: #764'`：b91c429・9fc65a5（fix(ui): スマホで引き出しから開いた公開の一覧は引き出しを閉じて段を引き継ぎ…）・8424bfe・81057c1。
- `git log origin/main..issue/764` は0件。DB の issues(764) は done。
- issue/765 は a303920 にいたので `git merge --ff-only origin/main` で 81057c1 に進めた（自分の commit は無かった）。

### 判断：揃える（ア扱い・切り替えなし）

- 揃える先：17表 §2-1 **R22**（ドロワー→⌘K「ドロワーは先に閉じている。パレットだけ閉じ…」・#259）、**R23**（ドロワー→設定「ドロワーは出ない」）、#764 の **R31・R32**（引き出しから開いた面を閉じると開く前の画面・引き出しは出ない）。
- 17表 §4 の **D01〜D14** に、引き出し→検索の段や戻り先を決めた行は無い。**D06**（再読込後の段）と **D11**（設定の節へ直接開いた時の段数・#762 で変更）は変えない。§4-5 の **K2**（閉じてすぐ別の面を開く経路は段を新しい面へ引き継ぐ）の型を当てるだけ。
- 21_UIUX方針 (c) の「不具合の直しでも、直し方が操作を変える時はイより上」に当たりうるが、依頼文の指示と #764 R32 の②決裁（2026-11-23 02:15・ア扱い・切り替えなし）にそろえてア扱い。②の計画承認（03:01）で確定。
- 見た目の動きが変わる所：引き出しの「検索」から開いた検索を戻る・Esc・枠外で閉じると、引き出しに戻らず開く前の画面に戻る（下のナビの検索と同じ）。検索を開くと引き出しは閉じる。PC 幅（引き出しが無い）は変わらない。

### 段の並び（390・chromium と webkit iPhone 13 で同じ）

台本 `~/kuroko/_vault-work/765/repro/search765.mjs`（計画runの台本の写し・body の app-view-* と #settings-modal の show を足した）。ログは `repro/before/c390.log`・`w390.log`（2つは h の数を除いて同じ）。nav.log は `種類:面:op`。

引き出しの「検索」（#sidebar-search・下のナビ「本棚」で引き出しを開いてから）：

| 操作 | 段（nav.state.faces） | 引き出し | 画面 | nav.log |
|---|---|---|---|---|
| 「検索」 | [drawer, command-palette] | **開のまま** | ホーム＋パレット | open:command-palette:push |
| →戻る | [drawer] | **開** | ホーム | （無し） |
| →Esc／枠外 | [drawer] | **開** | ホーム | close:command-palette:go |
| →戻る→進む | [drawer] | **開** | ホーム（パレットは開き直らない） | open:drawer:none |
| →本棚を選ぶ | [] | 閉 | **ホームのまま（本棚が開かない）**・hash 空 | close:drawer:go → navigate:null:replace → open:drawer:none → close:drawer:go |
| 　→戻る | — | — | **アプリの外（about:blank）** | — |
| →「設定を開く」 | [] | 閉 | **ホーム（設定が開かない）** | close:command-palette:go → close:drawer:go → openRoute3:settings-modal:replace → open:drawer:none → close:drawer:go |
| 　→戻る | — | — | **アプリの外（about:blank）** | — |

比較：下のナビの「検索」（ホームから・引き出しは閉じたまま）：

| 操作 | 段 | 画面 | nav.log |
|---|---|---|---|
| 「検索」 | [command-palette] | ホーム＋パレット | open:command-palette:push |
| →戻る／Esc／枠外 | [] | ホーム | （戻る）無し／close:command-palette:go |
| →本棚を選ぶ | [] | 本棚（#/bookshelf/fixshelf） | navigate:null:replace |
| 　→戻る | [] | ホーム | — |
| →「設定を開く」 | [settings-modal] | 設定（#/settings） | close:command-palette:go → openRoute3:settings-modal:replace |
| 　→戻る | [] | ホーム | — |

（下のナビの行の「戻る2回目」がアプリの外へ出るのは、台本が about:blank から1段で開くため＝開く前の画面のさらに1つ前で正しい。）

- 引き出しの検索では、引き出しの段が下に残る。上で本棚を選ぶ・設定を開くと、引き出しの閉じ（close:drawer:go）が次の replace と合流し、着いた先で D06 の自己修復（open:drawer:none → close:drawer:go）がもう1段戻る。その結果、本棚・設定が残らず、次の戻るでアプリの外へ出る（#764 の公開と同じ型）。
- 引き出しが開いている間、下のナビの「検索」は見えない（計画runの台本で tap が30秒で時間切れ）。R22 の E2E は下のナビを page.evaluate の click で押しているので緑のまま＝人が押せる入口（引き出しの検索）を見ていなかった。

### 足した E2E（tests/e2e/back-nav-matrix.spec.js「戻る: イシュー#765 引き出しの「検索」」）

実 tap（引き出しは下のナビ「本棚」、検索は #sidebar-search、結果は .cmdk-item）。期待は直した後の形。

| ID | 中身 | 直す前（81057c1＋テストだけ）chromium・webkit とも |
|---|---|---|
| R33-back／esc／backdrop | 引き出し→検索＝引き出しは閉じ段は [command-palette]。戻る／Esc／枠外＝パレットだけ閉じ、引き出しは出ない・段 []・E1 | **赤**。「開いた直後: 引き出しは先に閉じている (R22)」（true）・「段はパレットだけ」・「引き出しは出ない」・「段が余らない」・E1 の stack と state |
| R33f | 引き出し→検索→戻る→進む＝パレットが開き直り、引き出しは開かない | **赤**。「戻る1回: 引き出しは出ない」・「段が余らない」・E1・「進む: 引き出しが開かない」 |
| R33k | 引き出しを開いて Ctrl+K＝引き出しを閉じてパレット・戻る＝パレットだけ閉じる | **赤**。R33 と同じ項目 |
| R34 | 引き出し→検索→本棚を選ぶ＝本棚が開く・戻る1回で開く前の画面（R04） | **赤**。「本棚の hash」（""）・「本棚が開く」（app-view-main）。戻るでアプリの外へ出て snap の evaluate が bookshelf 未定義で落ちた |
| R35 | 引き出し→検索→「設定を開く」＝設定が開いたまま・戻る1回で閉じて開く前の画面 | **赤**。「設定が開いたまま」（class に show 無し）・「段は設定だけ」。戻るでアプリの外へ出て evaluate が落ちた |
| R22（既存） | 下のナビ（evaluate の click）で ⌘K | 緑（両ブラウザ） |

結果：chromium 7 failed・1 passed（30.2秒）、webkit 7 failed・1 passed（35.4秒）。ログは `~/kuroko/_vault-work/765/repro/before/e2e-chromium.log`・`e2e-webkit.log`。

実行したコマンド：
- `PORT=8165 PLAYWRIGHT_BASE_URL=http://localhost:8165 npx playwright test tests/e2e/back-nav-matrix.spec.js -g "イシュー#765|R22"`（chromium）
- 同じ条件に `BACKNAV_WEBKIT=1` と `--project=webkit` を足して webkit

## §2 直した（step2）

### 直したこと（b5d26f6）

- js/bookshelf.js に `_openPaletteFromUi()` を _openPalette の直前に足した。中身は `this._closeDrawer(); this._openPalette();`（同じ同期の塊）。引き出しが開いていれば閉じ、その段をパレットへ引き継ぐ（nav-state の push→replace）。_closeDrawer は開いていなければ何もしない＝PC 幅は変わらない。
- 人の操作の入口4つをここへ集めた：引き出しの「検索」#sidebar-search・ヘッダーの #palette-trigger・⌘K/Ctrl+K の開く側・下のナビの「検索」（`_closeDrawer(); _openPalette();` の2行を置き換えて1か所に）。
- 進むの開き直し（reopen の表の 'command-palette'）は _openPalette を直に呼ぶまま（開き直しの最中に go(-1) を出さない）。⌘K の閉じる側・本棚を追加（#sidebar-add-bookshelf）は触っていない。入口ごとの分岐は足していない。
- index.html の `js/bookshelf.js?v=` を 2026112301 → 2026112302。`npm run check:version -- --range=origin/main..HEAD` は OK。

### 直した後の段（390・chromium と webkit iPhone 13 で同じ）

台本は §1 と同じ（`repro/after/c390.log`・`w390.log`。2つは h の数を除いて同じ）。

| 操作（引き出しの「検索」から） | 段 | 引き出し | 画面 | nav.log |
|---|---|---|---|---|
| 「検索」 | [command-palette] | **閉** | ホーム＋パレット | close:drawer:go → open:command-palette:**replace** |
| →戻る | [] | 閉 | ホーム | （無し） |
| →Esc／枠外 | [] | 閉 | ホーム | close:command-palette:go |
| →本棚を選ぶ | [] | 閉 | **本棚（#/bookshelf/fixshelf）** | navigate:null:replace |
| 　→戻る | [] | 閉 | **ホーム** | — |
| →「設定を開く」 | [settings-modal] | 閉 | **設定（#/settings）** | close:command-palette:go → openRoute3:settings-modal:replace |
| 　→戻る | [] | 閉 | **ホーム** | — |

下のナビの「検索」（ホームから）の行は §1 と同じ（open:command-palette:push 以降が上と同じ）。引き出しの検索は、引き出しの段をパレットへ引き継ぐ分だけ nav.log の先頭が違い、その後は同じ形になった。
（台本の「戻る2回目」でアプリの外へ出るのは、about:blank から1段で開いているため＝開く前の画面のさらに1つ前で正しい。）

### E2E（直した後）

| 何を | chromium | webkit（BACKNAV_WEBKIT=1 --project=webkit） |
|---|---|---|
| R33（戻る・Esc・枠外）・R33f・R33k・R34・R35 | 7 passed | 7 passed（全件の中で） |
| back-nav-matrix.spec.js 全件（R04・R19〜R22・R23・R24f・X09・X19・#764 R30〜R32・#762 R26〜R29・X22 を含む） | **150 passed**（4.0分） | **144 passed・6 skipped**（5.0分。skip は spec が webkit で飛ばす PC 幅の行） |

| #sidebar-search を押す spec：ux-p1-nav・ux-quickwins・gate/j4-memo（chromium）、char/exits・char/settings-shelves-nav（char-390〜char-1920 の6端末） | **63 passed・234 skipped**（skip は char の spec が自分の幅以外で飛ばす分）。j4-memo（J4-1〜3）と char-1024 の P10 の2本（#sidebar-search から手動追加）は緑を個別に確かめた | — |

ログ：`~/kuroko/_vault-work/765/repro/after/bnm-chromium.log`・`bnm-webkit.log`・`others.log`。gate/j4-memo は既定の chromium project で流した（gate-webkit では流していない＝step3 の e2e-diff の表で見る）。

## §3 lint・単体・全件比較・前後の画像（step3・push の前）

### lint・単体

- `npm run lint`：12 本中 0 本失敗（esc-focus.spec.js を直した後に流し直しても同じ）。
- `npm test`：1298 passed・2 todo（1300）。

### e2e-diff-main（base＝origin/main @ 81057c1＝#764 着地後、work＝HEAD 59bd09e）

1回目（`~/kuroko/_vault-work/765/e2ediff/report.md`）：

| 表 | E2E | Unit | 画像比較 |
|---|---|---|---|
| 新しく落ちた | **1件**（下） | 0 | 差分 0件 / 54件 |
| 新しく通った | 0 | 0 | — |
| 両方で落ちた | 0 | 0 | — |

- E2E 件数：base 1282 passed・592 skipped（249秒）、work 1288 passed・1 failed・592 skipped（255秒）。work の +7 は R33〜R35。
- PC 幅の行（chromium 1280 等・webkit の PC 幅・char-1024〜1920）は新しく落ちた件が0＝**PC 幅の差は0**。画像比較も差分0（見た目の部品は変えていない）。
- 新しく落ちた1件：`esc-focus.spec.js` の「引き出しの上の面を Esc で閉じる (幅900px以下 Chromium) > Esc で上の面だけ閉じ、引き出しは残る→戻る1回でアプリの外へ出ない→進むで再び開く」（390・3回流し直して3回とも赤＝揺れでない）。
  - 理由：引き出しを開いたまま ⌘K（Ctrl+K）を押して「引き出しの上にパレットを積む」場面を作っていた。#765 で ⌘K も `_openPaletteFromUi` を通り、引き出しを閉じてから開く（承認どおり・17表 R33k）ので、パレットは引き出しの上に積まなくなった＝この spec の前提が今回の変更で無くなった。
  - 直し：spec の意図（引き出しの上に積んだ面を Esc で閉じると、その面だけ閉じて引き出しは残る・戻る1回でアプリの外へ出ない・進むで再び開く）は残し、引き出しの上に積む面を「本棚を追加」のフォーム（#sidebar-add-bookshelf・#bookshelf-form-modal＝このイシューの対象外で今も引き出しの上に積む）に替えた。⌘K の側は back-nav-matrix の R33k が見る。chromium で `--repeat-each=3` 12 passed・3 skipped（skip の中身は見ていない）。
- 2回目（spec を直した後・`~/kuroko/_vault-work/765/e2ediff2/report.md`）：下の「2回目の結果」に書く。

### 前後の画像（390・chromium と webkit iPhone 13）

台本 `~/kuroko/_vault-work/765/repro/shots765.mjs`。直す前＝`git archive origin/main`（81057c1）を `repro/src-before/` へ展開した物、直した後＝この worktree。

| 場面 | 直す前 | 直した後 |
|---|---|---|
| 01 引き出し→検索を開いた直後 | 引き出しの上にパレット（drawer=true） | 引き出しは閉じてパレットだけ |
| 02 その後の戻る | 引き出しに戻る（drawer=true） | ホームに戻る |
| 03 検索→「設定を開く」の後 | 設定が出ずホームのまま（hash 空） | 設定が開いたまま（#/settings） |
| 04 その後の戻る | アプリの外（about:blank）＝撮れない | ホームに戻る |

画像：`~/kuroko/_vault-work/765/repro/before/shots/{c390,w390}/`・`repro/after/shots/{c390,w390}/`（ログは各 `shots.log`）。

### ハヘロ向けの頁

https://homelab.tail83cfaa.ts.net:8444/bookshelf/6/4/引き出しの検索の戻り先/
（変わる所1行・直した不具合1行・「PC 幅では変わらない」1行・前後の画像（webkit iPhone 13）・iPhone で試す手順）

### 17表

vault の 17_戻る挙動テスト表_20261014.md §2-1 の R32 の後に R33〜R35 の行を足した（R33 に「R22 の人が押せる入口（R22 の E2E は下のナビを evaluate で押している）」）。commit は自動バックアップに任せる。

#### 2回目の結果（esc-focus.spec.js を直した後・`~/kuroko/_vault-work/765/e2ediff2/report.md`・exit 0）

| 表 | E2E | Unit | 画像比較 |
|---|---|---|---|
| 新しく落ちた | **0** | 0 | 差分 0件 / 54件 |
| 新しく通った | 0 | 0 | — |
| 両方で落ちた | 0 | 0 | — |

work の E2E：1289 passed・0 failed・0 flaky・592 skipped。PC 幅の差も0。
