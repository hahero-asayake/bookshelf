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
