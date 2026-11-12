# U8a補完 step1: プラグイン管理7件の棚卸しとデッドコード判断（イシュー#544）

基準commit: origin/main `164622e`（#543 U8c push済み時点、計画時から変化なし＝fetchで再確認済み）。

## 0. 移動前スナップショット（機械的検証の基準値）

- `tests/e2e/` + `tests/visual/` の `bookshelf._` 参照数：**355件**（u8c-step1-scope.md §5 末尾コマンドで再計測し一致を確認。U8c後もorigin/mainは進んでいない）
- 計測コマンド：`grep -ron "bookshelf\._[A-Za-z]" tests/e2e/ tests/visual/ | wc -l`

## 1. 移す対象（7件・行番号は#543後の現状で測り直し）

| メソッド | 行範囲 |
|---|---|
| `showPluginsModal` | 6962-6966 |
| `closePluginsModal` | 6968-6970 |
| `_renderPluginsList` | 6972-7029 |
| `_refreshPluginCardStatus` | 7035-7046 |
| `installPluginFromInput` | 7048-7071 |
| `togglePlugin` | 7073-7094 |
| `uninstallPluginById` | 7096-7104 |

合計：js/bookshelf.js 6962-7104（143行、間に挟む非対象コードなし）。依頼文に書かれた「#543時点7375〜7509」からは、#543でimport.js(U8c)が26メソッド分を削った分だけ前にずれている（行番号そのものは依頼文の予告どおりズレただけで、対象メソッドの集合・内容は変化なし）。

### 呼び出し元（全tracked `.js`/`.html` を対象にgrep・全数列挙）

- `installPluginFromInput` ← `js/bookshelf.js:778`（`setupEventListeners`内、全画面共通の初期化。**現役**）。対応する`#install-plugin-btn`・`#plugin-repo-url`は`index.html:644-645`に実在し、設定モーダル「プラグイン」タブの「新しいプラグインを追加」折りたたみの中にある（hidden無し・表示される）
- `togglePlugin` ← `js/screens/settings.js:2312`（`_openPluginSettings`内のトグル）・`2404`（`_bindPluginListEvents`内のトグル）。いずれも**現役**（U8aでsettings.jsへ移した新UI=`_renderPluginListSection`/`plugin-list-section`/`.plugin-card-v2`から呼ばれる）
- `uninstallPluginById` ← `js/screens/settings.js:2425`（`_bindPluginListEvents`内）。**現役**（同上の新UIから呼ばれる）
- `_renderPluginsList` ← `showPluginsModal`(6965、デッド経由)・`uninstallPluginById`(7100、現役経由)
- `_refreshPluginCardStatus` ← `_renderPluginsList`(7028、上記経由)・`togglePlugin`(7093、現役経由)
- `showPluginsModal` ← **呼び出し元0件**
- `closePluginsModal` ← **呼び出し元0件**
- `tests/`（全体）：7件いずれも参照0件（grep実測）
- `js/plugin-api.js`：参照0件

**②指摘で判明した抜け（step1は`.js`/`.html`のみをgrepしており`.mjs`が対象外だった）**：`scripts/verify/shot-367-step5.mjs:25`が`window.bookshelf.showPluginsModal()`を呼んでいる（`#367`の撮影スクリプト、`box: '#plugins-modal .modal-content'`を撮る想定）。ただし撮影対象の`#plugins-modal`（モーダルDOM本体）はindex.htmlに無い＝この行は現状でも動かない（実行すればbox要素が見つからず失敗する）。削除の判断は変えない。スクリプト自体は直さない（本イシューのスコープ外）。以後、呼び出し元を確かめるgrepは`.mjs`も対象に含める。

### static/getter/setter混入検査（#537の落とし穴対応）

対象範囲 `js/bookshelf.js:6962-7104` を `^\s*(static |get |set )` と bare class field 正規表現で検査：**ヒット0件**（1件のfalse positive候補`installed = await ...`は`let installed;`に続くローカル変数代入であり、クラスフィールドではないことをコード確認済み）。

## 2. ②確認事項への回答：`#plugins-list` の実在確認（Surfaceキー `plugins-modal` との差）

**`#plugins-list` は実在する**（`index.html:662`）：

```html
<!-- 旧プラグイン管理 UI コンテナ (互換: 一部 legacy 呼び出しが #plugins-list を参照) -->
<div id="plugins-list" class="plugins-list-host" hidden></div>
```

`hidden`属性付きで、コメントに「旧プラグイン管理UIコンテナ（互換用）」と明記されている。すなわち：

- `uninstallPluginById`（現役・新UIから呼ばれる）が内部で呼ぶ`_renderPluginsList`は、この**hidden要素**に一覧HTMLを書き込むだけで、ユーザーの目には何も起こらない（新UI側の再描画は呼び出し元の`settings.js:2427`で別途`this._renderPluginListSection()`が担っている）。
- `togglePlugin`（現役）が内部で呼ぶ`_refreshPluginCardStatus`は、同じく`#plugins-list`内の`[data-plugin-card]`を探すが、hidden要素側には該当カードが生成されていない状況でも`!statusEl`で早期returnするだけ（`js/bookshelf.js:7038-7039`）＝実害もエラーも出ない no-op。

一方、`showPluginsModal`/`closePluginsModal`が開閉するSurfaceキー`'plugins-modal'`は**定義自体は存在する**（`js/bookshelf.js:6454`: `S.define('plugins-modal', { kind: 'modal', size: 'md', hist: 'never' })`）が、**対応するモーダルDOM要素はindex.htmlに存在しない**。Surface定義はあっても開く相手のDOMが無い＝呼んでも何も表示されない状態。かつ呼び出し元が0件なので、現状どこからも呼ばれていない。

まとめると、7件は実際には2段階に分かれている：

1. **完全デッドコード（呼び出し元0件・対応モーダルDOMも無い）**：`showPluginsModal`・`closePluginsModal`
2. **到達はするが画面上で無意味（hidden要素を操作するだけ）**：`_renderPluginsList`・`_refreshPluginCardStatus`（ただし依頼文のスコープはこの2件をデッドコード扱いにしておらず、呼び出し元である`togglePlugin`・`uninstallPluginById`は新UIの一部として現役＝この2件も含め5件はそのまま移す対象とする。「hidden要素操作がno-opである」こと自体の整理・削除は本イシューのスコープ外として申し送る）

## 3. デッドコード2件（`showPluginsModal`・`closePluginsModal`）の扱い：案と推奨

| | 案A：settings.jsへ移す | 案B：削除commitで消す |
|---|---|---|
| 内容 | 本文を変えず他5件と一緒にPlan Aで移植 | `_trash/`への物理退避はせず、削除commitで消す（git履歴に残るため復元可能。理由をこのdocsに記録） |
| 利点 | 7件を一括で同じ扱いにできる。U8aの見落としを機械的に解消。将来「プラグイン管理モーダル」を復活させる計画があれば下地が残る | 呼び出し元0件・対応モーダルDOMも無い＝実行不可能なコードを除去。settings.jsの可読性を保つ（「これは生きてるのか？」という混乱を生まない）。bookshelf.js側のコードもここで144行→119行相当に減る |
| 欠点 | 永久に呼ばれないコードをそのまま新ファイルへ持ち込む。読む人が生死を誤認しうる | 将来モーダルを復活させる場合は再実装が必要（ただしgit履歴から復元可能なので実質コストは低い） |
| 根拠 | - | 呼び出し元0件（grep全数実測）・Surface定義`'plugins-modal'`はあるが対応DOM要素が無い（index.html実測）＝二重に死んでいる。本文を変えないという大原則から見ても、削除は「呼ばれないコードの除去」であり実行時の振る舞いに一切影響しない（0件呼び出しなのでどのテストにも影響しない） |

**推奨：案B（削除）**。

理由：
- 呼び出し元0件は全tracked `.js`/`.html` を対象にしたgrepで確認済み（u8c-step1-scope.md §2の時点の実測結果とも一致）。
- Surfaceキー定義はあるが対応するモーダルDOM自体が無いため、仕様としても実装としても「開けるモーダル」ではない。
- bookshelfの不変条件「削除は直接せず`_trash/`へ退避する」はファイル削除を指す運用であり、依頼文自体が今回は「リポジトリ内なら削除commitで可（理由をメモに残す）」という例外を明示している＝git履歴に残る形なので実質的な退避になっている。
- 振る舞いを変えないという原則にも抵触しない（呼び出し元が無いので削除してもランタイムの挙動・テスト結果は変わらない）。

②の承認が得られれば、この2件は`js/bookshelf.js`から削除commitで消し、残り5件（`_renderPluginsList`・`_refreshPluginCardStatus`・`installPluginFromInput`・`togglePlugin`・`uninstallPluginById`）のみをPlan Aでsettings.jsへ移す。

## 4. 画面をまたぐ this.*（Plan Aで無変更に動くことの確認）

移す側（5件、案B採用時）がbookshelf.js側に残るものを呼ぶ this.*：

- `this.pluginLoader`（`listInstalledPlugins`/`loaded`/`failedToLoad`/`_loadPlugin`/`unloadPlugin`/`uninstall`/`installFromGitHub`）
- `this.userData`（`.settings.disabledPlugins`の読み書き）・`this.saveUserData()`
- `this._isSyncReady()`
- `this._applyHeaderLayout()`・`this._renderPluginListSection()`（`installPluginFromInput`内、新UI側の再描画呼び出し＝settings.js側に既存）
- グローバル`toast()`・`window.confirmDialog()`

逆に、bookshelf.js側に残るコードが移す側を呼ぶ箇所：

- `setupEventListeners`(556行台)内の`installPluginBtn.addEventListener('click', () => this.installPluginFromInput())`(778行)
- （案B採用時）`showPluginsModal`/`closePluginsModal`はそもそも削除するため、残留コードからの呼び出し元チェックは不要（元々0件）

いずれも`this.`経由のため、Plan A（prototype合成）で定義ファイルが変わっても無変更で動く。

## 5. テストが直接触っている名前・bookshelf._総数の基準値

7件いずれも`tests/`配下からの直接参照は**0件**（grep実測、`showPluginsModal`/`closePluginsModal`/`_renderPluginsList`/`_refreshPluginCardStatus`/`installPluginFromInput`/`togglePlugin`/`uninstallPluginById`のいずれも0件）。委譲ラッパーの対象（U8a/U8b/U8cと同じ基準＝テスト・プラグインが直接触れていて移動後も同じ名前で動くことを確認する対象）は**0件**。

`tests/e2e/` + `tests/visual/` の`bookshelf._`参照総数の基準値：**355件**（§0と同じ、変化なし）。この作業はテストファイルを一切編集しないため、step3の再計測でも355件のままであることを確認する。

計測コマンド（u8c-step1-scope.md §5末尾と同一）：
```
grep -ron "bookshelf\._[A-Za-z]" tests/e2e/ tests/visual/ | wc -l
```

## 6. static/getter/setterのgrep全数検査（#537の落とし穴対応）

§1末尾に記載（ヒット0件）。

## 7. step2実施結果（②承認・案Bで実施）

②承認（2026-11-13 06:30）：案B（`showPluginsModal`・`closePluginsModal`は削除commitで消し、残り5件をPlan Aでsettings.jsへ移す）で実施した。

### 残件：使われなくなったSurface定義（②指示で削除せず記録のみ）

- `S.define('plugins-modal', { kind: 'modal', size: 'md', hist: 'never' })`（`js/bookshelf.js:6454`）
- `js/ui/surface.js:8`のコメント（`hist: 'never' … plugins-modal: 今どの幅でも段なし。S6の対象外・②判断`という既存コメント）

いずれも、開く側のメソッド（`showPluginsModal`/`closePluginsModal`）を削除した後も**意図して残す**（②指示・2026-11-13）。対応するモーダルDOM自体がindex.htmlに無いため実害は無いが、「メソッド削除後も残る使われないSurface定義」として次に触る人向けに残件扱いとする。
