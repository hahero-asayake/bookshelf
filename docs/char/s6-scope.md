# S6：全幅で履歴の段を積む — 棚卸し（イシュー#513 step1）

> 基点 origin/main 719f5bf。コード変更なし（調査のみ）。実装（step2）の前提整理。

## 1. 段を積まない箇所（横展開・全部洗い出し）

判定の起点は1か所：`bookshelf.js:13329 _isHistMobile()` = `window.viewport.isNarrow()`（900px基準・#505で一本化済み）。この返り値を使う経路は2つ:

| # | 場所 | 中身 | S6の扱い |
|---|---|---|---|
| a | `js/ui/surface.js:54-58 _histOn(hist)` | `hist:'mobile'`（既定）→ `host._isHistMobile()` を呼ぶ。`hist:'never'`→常にfalse。`hist:{isMobile}`→isMobile() | **変える対象**（hist:'mobile'の既定分だけ） |
| b | `js/ui/surface.js:99-105 push()` | `const mobile = isMobile ? isMobile() : h._isHistMobile(); if (!mobile) return;` ← ここで段を積む処理(`h.nav.openRoute`/`h.nav.open`)ごと丸ごとスキップされる | **変える対象**（a の判定結果に従う） |
| c | `js/nav-state.js:411-414 nav.open(id,extra,close,meta)` | `const mobile = ...; if (!mobile) return {op:'none',skipped:'pc'};` | **変える対象**（呼び手がSurface.pushから渡す`{mobile:true}`固定なので、実際に判定しているのはb。nav.open自体のmobile引数契約は維持・呼び手が渡す値を変えるだけ） |
| d | `js/nav-state.js:420-423 nav.openRoute`／`425-427 openBook` | mobile早期returnが**無い**（openRouteは常にapply、openBookはmobileをreduce3へ渡すだけで早期returnしない） | 対象外（元から省略が無い） |

### d の裏付け：P9「本の詳細」はすでにPCでも段を積む

`docs/char/u0-findings.md §1` の実測どおり、`nav.openBook`→`reduce3`の`openBook3`分岐は`faces`増減に関わらず`route`変化で`historyOp`が`push`を返す（`nav-state.js:334-348`）。**本の詳細（PC）は今回のS6で新たに対処する箇所ではない**＝変更不要。

### 面ごとの個別指定（a の上位）

| 面 | 指定 | S6の扱い |
|---|---|---|
| `plugins-modal` | `hist:'never'` | **対象外**（②判断2026-11-03：今回は触らない。出口の決まりへの載せ方は別issue） |
| `art-sheet` | `hist:{isMobile: _artIsDrawerNarrow}` | **対象外**（②判断2026-11-03：PCでは横パネルなので段を積まないのが正しい） |
| それ以外の全面（設定・公開・本棚・取込・追加・palette・drawer等、`surface.md §4-1`の約27面） | `hist:'mobile'`（既定） | **変える対象** |

## 2. 公開の一覧／公開の設定がPCでhash空になる件（#509実測）

原因：`Surface.push()`の`if (!mobile) return`が、route処理（`h.nav.openRoute(...)`がhashを書く部分）**より前**にある（`js/ui/surface.js:101-104`）。route指定を持つのは`publish-pages-modal`・`publish-settings-modal`・`art-viewing`の3面（`surface.md §4-1 B`）。

**解釈**：brief の「早期returnの順番を直す」は、route処理用の別コードを新設する意味ではなく、**`_isHistMobile()`の判定自体をフラグで「全幅=true」にする（§3）ことで、この早期returnが発動しなくなる**＝自然に解決する、と読んだ。フラグ旧（既定='0'）の間はこの早期returnが残り、旧動作（PCでhash空）のまま。
→ **未確定・②確認**：この解釈で良いか。「順番を直す」という文言が、フラグの状態に関わらず常にroute処理だけ先に実行する別の構造変更を指しているなら、設計が変わる（フラグ旧でも公開routeだけ直る形）。

## 3. フラグ設計案

- **キー**：`bookshelf.flag.histAllWidths`（localStorage）。値 `'0'` = 旧動作、それ以外（未設定含む）= 新動作（既定）。
- **判定の集約**（②指示どおり1か所）：
  ```js
  _isHistMobile() {
      if (localStorage.getItem('bookshelf.flag.histAllWidths') === '0') return window.viewport.isNarrow(); // 旧
      return true; // 新: 全幅で段を積む
  }
  ```
  呼び手（Surface._histOn / nav.open の呼び出し元）は変更不要＝この1関数の返り値だけで a〜c 全てに伝播する。
- **UI**：設定モーダルの「このアプリについて」節にトグル＋期限表示（例：「全幅で履歴を1段ずつ戻る（新しい動き）— 2026-11-17 に確認のうえ撤去予定」）。トグルは`localStorage`に`'0'`/それ以外を書き分けるだけ（リロード前提でよいか、即時反映が要るかは実装時に確認）。

## 4. 書き換えが要るテスト（origin/main時点で列挙）

### 4-1. CHAR印つき・直す対象だった既存の期待（②判断：S6で書き換えるのが正しい。計画の「E2E 0件」はこれとは別枠）

| テスト | 行 | 印 | 現在の期待 | S6後に予想される変化 |
|---|---|---|---|---|
| `tests/e2e/char/pc-back.spec.js` | 28 | `// CHAR: 直す対象(step2 P9)` | 設定モーダルを開いて戻る→`about:blank`（アプリの外） | 1段戻ってモーダルが閉じる（アプリ内に留まる） |
| `tests/e2e/char/pc-back.spec.js` | 38 | 同上 | 公開ページ管理モーダルを開いて戻る→`about:blank` | 同上 |
| `tests/e2e/char/exits.spec.js` | 68 | `// CHAR: 直す対象(step2 P10)`（test.skipは`char-1024`専用） | 1024で手動追加→未保存入力→戻る→確認(`.cfm-overlay`)が出ない | 確認が出る（guard通過） |

注：`docs/char/x1-exits.md:61`は`exits.spec.js:57`と書くが、現HEADでは68行目（test本体の行）。X1時点からの行ズレ（コメント追加等）と判断・実害なし。

### 4-2. 様子見（計画の「様子見2件」の実体と判断）

| テスト | 行 | 今の扱い |
|---|---|---|
| `tests/e2e/char/settings-shelves-nav.spec.js` | 94-110 `S6@char-1440` | 本棚フォームに未保存入力→戻る→`.cfm-overlay`件数を**annotationに記録するだけ**（expectで固定していない＝「様子見」） |
| 同ファイル | 同ブロック `S6@char-1920` | 同上 |

S6実装後、この2件がそのまま様子見として残るか、`expect`で期待を固定する形に書き換えるかは実装時に実測して決める（計画の見込み「様子見2件」とは数は一致）。

### 4-3. unit（計画の「unit 1件」の候補・未確定）

| テスト | 行 | 内容 | 判定 |
|---|---|---|---|
| `tests/unit/nav-state-createnav.test.js` | 61 | `nav.open('icon-picker-modal', null, close, { mobile: false })` → `{op:'none', skipped:'pc'}` を期待 | **未確定・②確認**：§3の設計（nav.open自体のmobile引数契約は変えず、呼び手が渡す値だけ変える）なら、このテストは`mobile:false`を明示的に渡すAPI契約テストとして**書き換え不要**（0件）になる可能性がある。brief文言「NavStateのPCの省略をやめる」が nav.open自体のロジック削除を指すなら、このテストのdescribe文言（「PCは履歴に触らない」）も古い仕様の記述になり書き換えが要る（1件）。grepで他にmobile関連の単体テストは見つからず、候補はこれのみ。 |

### 4-4. 計画見込みとの対比

| 区分 | 計画の見込み | 判明分 |
|---|---|---|
| unit | 1件 | 0〜1件（§4-3の設計判断待ち） |
| E2E（CHARでない既存） | 0件 | 0件（§4-2の様子見2件は「様子見」のまま数には入れない解釈） |
| 様子見 | 2件 | 2件（§4-2と一致） |
| （参考）CHAR書き換え | 計画外枠 | 3件（§4-1。②判断どおりP9×2・P10×1は書き換えて正しい） |

## 4-5. 2つの論点（②判断2026-11-03 step2承認時・保守的解釈で進める）

1. **公開route**：フラグ新でmobile判定がtrueになれば自然に解決する＝それでよい。フラグ旧（元の動きに戻す側）で公開routeだけ別途直す必要は無い。ただし根本の問題は別にある：「URLに今のページを映すこと（route処理）」と「履歴に段を積むかどうか（mobile判定）」が`Surface.push()`の1つの早期returnに結び付いている。**フラグ撤去の単位（2026-11-17目安）でやること**：`js/ui/surface.js`の`push()`内の`if (!mobile) return`を、route処理（`h.nav.openRoute`呼び出し）より後ろへ移すか、route処理と段を積む処理を分離する。このS6では分離しない（フラグに1本化するだけ）。
2. **nav.openのmobile引数契約**：今回は残す（`tests/unit/nav-state-createnav.test.js:61`の書き換えは0件）。**フラグ撤去の単位でやること**：`js/nav-state.js`のnav.open内`if (!mobile) return {skipped:'pc'}`分岐（呼び手が常に`{mobile:true}`しか渡さなくなり死蔵する）と、`nav-state-createnav.test.js:61`のmobile:false契約テストを、一緒に消す。

## 5. 検証スクリプトの追加要件（②指示）

`scripts/verify/e2e-diff-main.mjs`に汎用オプション `--init-storage key=value`（複数回指定可）を追加し、base/work両方のPlaywright実行でlocalStorageへ値を注入できるようにする（S6専用分岐は書かない）。現状このオプションは無い（grep確認済み・既存オプションは`--exclude`/`--no-default-exclude`/`--skip-e2e`/`--skip-vitest`/`--visual`等）。注入経路は実装時に検討（環境変数→test-base.jsのcontext fixtureでaddInitScript、等）。
