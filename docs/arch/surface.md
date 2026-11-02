# Surface（出口と重なりの部品）設計 — イシュー#509 U3

> U3 は構造の単位＝**振る舞いは変えない**。出口の決まりをそろえるのは X1、PC でも段を積むのは S6。
> 正本の計画: #499 step4-plan §2/§4 U3。基点 origin/main b7e2a9a。

## 1. 位置づけ（ADR-129 / ADR-131 との関係）

| 層 | 正本 | 役割 |
|---|---|---|
| NavState（`js/nav-state.js`） | ADR-129 | 履歴の唯一の書き手。`apply → reduce3 → historyOp → push/replace/go` |
| overlays（`js/overlay-manager.js`） | ADR-131 | 重なり順・大きさ・Esc・枠外。`history.*` は触らない（hooks で外へ出す） |
| **Surface（`js/ui/surface.js`・新設）** | 本書（ADR は step3 までに 08 へ追記） | 面1枚の「開く・閉じる・Esc・枠外・戻る・フォーカスの戻し先・開き直し」を1回の登録で束ね、上の2つを呼ぶ |

Surface は ADR-129/131 を置き換えない。**2つを正しい順で呼ぶ手順の重複を消す層**。今は各画面が `_overlays().open(..., {hist:false})` と `_modalHistPush(...)` を別々に書き、Esc・枠外を個別に張っている。

## 2. API 案

```js
// 登録（起動時に1回・面ごと）。_navReopen の表を置き換える
Surface.define('publish-settings-modal', {
  el: '#publish-settings-modal',        // or () => Element
  kind: 'modal',                        // overlays の kind（modal|sheet|dialog|popover|menu）
  size: 'md', showClass: undefined,     // overlays.open へ素通し
  hist: 'mobile',                       // 'mobile'（今の既定: _isHistMobile のときだけ段）| 'never'（plugins-modal 等）| { isMobile: fn }（art-sheet）
  route: { view: 'publish-settings' },  // 任意。openRoute/closeFace に渡す（#468）
  esc: true, backdrop: 'ignore',        // overlays 既定と同じ。false/'close'/fn で個別
  close: (o) => app.closePublishSettingsModal(o),  // ×/Esc/戻る/枠外の共通の閉じ手（今の closeFn）
  reopen: (extra) => app.openPublishSettingsModal(), // 進むで開き直す（今の _navReopen の行）
  guard: (o, done) => app._formBackGuard(id, o, done), // 任意: 未保存確認（今の _formBackGuard 包み）
  focusReturn: 'opener',                // 'opener'（開いた時の activeElement）| selector | null（今と同じ＝戻さない面は null）
});
// 開く・閉じる
const h = Surface.open('publish-settings-modal', { extra });   // overlays.open → 段（hist 条件を満たす時だけ）→ フォーカス記録
Surface.close('publish-settings-modal', { reason: 'button' }); // overlays.close → 段を外す（fromHistory なら外さない）
Surface.isOpen(id) / Surface.top()
```

- 内部: `open` = `overlays.open(el, {kind,size,hist:false,esc,backdrop,onClose})` → `hist` 条件が真なら `nav.open / nav.openRoute`（今の `_modalHistPush` の中身そのもの・`_bindSettingsPopstate` 含む）。`close` = `overlays.close` → `_modalHistPop` の中身（settings-cat 畳みの特例 #494 も Surface 内へ移す）。
- **Esc / 枠外は overlays の esc/backdrop オプション（overlay-manager.js:46-47）に寄せる**。個別の keydown/click リスナーは Surface が張る1本に置き換える。今の個別処理が持つ条件（`defaultPrevented`・`_artMode==='form'`・`drawer-open` 等）は `esc: (e)=>bool` の述語として移し、**判定順と stopPropagation の有無を変えない**。
- 戻る: popstate → NavState が `closers[id]` を呼ぶ（今のまま）。Surface は登録時の `close` を closer として渡すだけ。
- `_modalHistPush(id, close, opts)` / `_modalHistPop` は **Surface への委譲として残す**（tests 参照 6件・U9 で外す）。残す数は step4 で数える。

### 振る舞いを保つための約束（U3 の不変条件）

1. 段を積むかどうかの判定は今と同じ関数を通す: `_modalHistPush` の `!mobile → return`（bookshelf.js:13285-13286）と `nav.open` の `mobile=false → skipped:'pc'`（nav-state.js:411-414）。**PC で段を積まない差は Surface の `hist:'mobile'` がそのまま持つ**（S6 でここだけ変える）。
2. `plugins-modal` は今「どの幅でも段なし」（bookshelf.js:14211 が `hist:false`＋`_modalHistPush` 無し）→ `hist:'never'` で固定。
3. `art-sheet` の `isMobile: _artIsDrawerNarrow`（11757）は `hist:{isMobile}` で保持。
4. overlays を通っていない記事6面は、overlays に登録しても **既定の Esc/backdrop を無効（esc:false, backdrop:'ignore'）にして今の個別処理を述語で移す**＝閉じ方の結果を変えない。重なり順（data-layer）が付くことで z-index が変わらないかを画像54枚で確認する（差が出たら showClass/size:'none' で吸収）。

## 3. P9 の原因と U3 での扱い

- `historyOp`（nav-state.js:334-348）は faces が増えれば push、**faces が増えなくても route が変われば push**（l.346）。本の詳細は route（`#/book/…`）を変えるので **PC でも段が積まれる**（#501 u0-findings §1 P9）。
- 一方、面（modal 等）は route を変えずに faces だけ増やす → PC では `_modalHistPush` の早期 return で **apply 自体が呼ばれない**＝段なし。
- **route 付きの面（publish-pages / publish-settings / art-viewing）も、PC では早期 return が route より先に効く**ため route が書かれない（§5 の実測）。
- U3 の扱い: この非対称は Surface の `hist:'mobile'` に閉じ込めるだけで変えない。S6 は「Surface の hist 判定1か所＋nav.open の pc 省略」を変えれば済む形になる。

## 4. 載せ替え対象（origin/main b7e2a9a・js/bookshelf.js の行）

### 4-1 `_modalHistPush` 直呼び 27か所（定義 13284・overlays hook 13276 を除く）
| まとまり | 行（面ID） |
|---|---|
| A 記事 | 9459 art-viewing(route) / 9782 art-edit-mode / 10088 art-add-sheet* / 10133 art-blk-menu* / 10184 art-fs* / 10745 art-look-sheet* / 11757 art-sheet* / 12188 art-more-menu* / 12321 art-publish-modal / 12716 pp-preview-modal / 12927 mde-heading-menu |
| B 公開 | 9218 publish-pages-modal(route) / 9253 publish-settings-modal(route) / 5192 report-modal |
| C 設定・プラグイン | 7148 settings-cat / 7940 plugin-settings-modal /（plugins-modal 14211 は段なし） |
| D 本棚・取込・追加 | 8484 bookshelf-modal / 8645 bookshelf-form-modal / 8897 descendants-pick-modal / 13424 exclusions-modal / 14023 import-modal / 14754 add-book-modal |
| E 共通・その他 | 1233 command-palette / 6278 drawer / 7032 icon-picker-modal / 13084・13098 book-memo-modal |

\* = overlays を通っていない記事6面（#499 inventory O14〜O19）。

### 4-2 Esc 個別処理 19か所
bookshelf.js: 689（settings 系）, 951, 962, 1171, 1376（palette）, 6006（sync-conflict）, 6342（drawer）, 6721（menu）, 7811（plugin-settings）, 9278, 9287, 9337, 9345（公開）, 9885（art-fs form）, 9992（記事エディタ）, 10646（look-sheet 等）, 11674（art-drawer-shelf-popover）／dashboard.js:547／ui-feedback.js:156（confirmDialog）。
（合成 keydown を投げる nav-state.js:457・bookshelf.js:9885/9995 の dispatch は「処理」ではないので数えない。）

### 4-3 枠外クリック 12か所
- 自分自身を見る型 6: bookshelf.js 679, 6010, 9326, 9417／ui-feedback.js 161／plugin-api.js 383
- `!x.contains(target)` 型 6: bookshelf.js 1428, 6720, 9397, 9409, 9410, 11664

### 4-4 `_navReopen` の表（bookshelf.js:13222〜）
面ID→開き直し関数の書き並べ。Surface.define の `reopen` へ移し、`_navReopen` は `Surface.reopener(id, extra)` への委譲にする。

## 5. plan §6「公開の一覧/公開の設定の戻り先指定が PC 幅で効かない疑い」実測

`scripts/verify/509-probe-pc-publish-route.mjs`（chromium・SW block・http.server 8109）:

| 幅 | 操作 | hash | history.length | faces |
|---|---|---|---|---|
| 1440 | 公開の一覧を開く | `""` | 2 | [] |
| 1440 | 公開の設定を開く | `""` | 2 | [] |
| 390 | 公開の一覧を開く | `#/publish` | 3 | [publish-pages-modal] |
| 390 | 公開の設定を開く | `#/publish/settings` | 4 | [publish-pages-modal, publish-settings-modal] |

**疑いは事実**: PC では route 指定（9218/9253 の `route:`）が効かない。原因は `_modalHistPush` の `!mobile → return` が route 処理より先にあること（13285-13286）。既存の char/pc-back.spec.js「公開ページ管理モーダルを開いてから戻る → アプリの外に出る」はこの結果を固定済み。**U3 では直さない**（直すのは S6／X1）。

## 6. 載せ替え順（commit 単位）

| # | commit | 対象 | 流す char/E2E |
|---|---|---|---|
| 1 | surface.js 新設＋index.html 読込（呼び手なし） | — | unit・全 char 1回 |
| 2 | `_modalHistPush/_modalHistPop/_navReopen` を Surface へ委譲（中身移動のみ） | 13222/13284/13295 | back-nav-matrix・standard-ops・char/pc-back |
| 3 | 記事6面（O14〜O19）を Surface.define＋overlays 経由 | 4-1 A の * 行と関連 Esc/枠外（9397, 9410, 10646, 11664, 11674, 9992） | char/article・art 系 E2E・webkit back-nav |
| 4 | 記事のその他（art-viewing/edit-mode/publish/preview/heading） | 4-1 A 残り・9326・9417・9885 | 同上 |
| 5 | 公開・通報 | 4-1 B・9278〜9345 | char/publish-hub・pc-back |
| 6 | 設定・プラグイン（plugins-modal を hist:'never' で登録） | 4-1 C・679・689・7811 | char/settings-shelves-nav・plugin 系 |
| 7 | 本棚・取込・追加 | 4-1 D | char/states・bookdetail |
| 8 | 共通（palette・drawer・menu・icon-picker・memo・sync-conflict・confirmDialog・dashboard） | 4-1 E・951/962/1171/1376/1428/6006/6010/6342/6720/6721/dashboard 547/ui-feedback 156,161 | char/widgets・exits・全 E2E |

各 commit 後に該当 char/E2E、step4 で `e2e-diff-main.mjs` 全件＋画像54枚。

## 7. 前の数（定義とコマンド・step4 で同じコマンドを Surface 外で再計測）

| 項目 | 定義（コマンド） | 前 |
|---|---|---|
| Esc 個別処理 | `grep -nE "key (===\|!==) 'Escape'" js/*.js \| grep -v "^js/overlay-manager.js" \| wc -l` | **19** |
| 枠外（自身型） | `grep -nE "\b(e\|ev)\.target === " js/*.js \| grep -v "^js/overlay-manager.js" \| wc -l` | **6** |
| 枠外（contains 型） | `grep -nE "!\S+\.contains\((e\|ev)\.target\)" js/*.js \| grep -v "^js/overlay-manager.js" \| wc -l` | **6** |
| `_modalHistPush` 直呼び | `grep -n "_modalHistPush(" js/*.js \| grep -v "_modalHistPush(id, close" \| wc -l`（定義 13284 と overlays hook 13276 の2行はこのパターンで除外される） | **27** |

step4 では上のコマンドに `\| grep -v "^js/ui/surface.js"` を足して「Surface の外」を数える。brief の 15/9/約30 は #499 時点の別の数え方（例: step3-arch は `key === 'Escape'` のみで8）で、比較は本表の定義で前後をそろえる。

## 8. 未確認・リスク
- 記事6面を overlays に載せると data-layer/z-index が付く。画像差が出たら退行として showClass/size で吸収する（commit 3 で確認）。
- `_artToggleMoreMenu` はトグル型（開閉を1関数で）＝Surface.open/close の両方から呼べる形に分ける必要がある。
- ADR は 08_意思決定記録 に「ADR-14x Surface を ADR-129/131 の上に置く」を step3 終了までに追記（②申し送り）。番号は着手時に `grep "^### ADR-"` で実測。
