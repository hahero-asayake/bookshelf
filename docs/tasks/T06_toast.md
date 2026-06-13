# T06: エラー・通知表示の toast 統一

状態: ✅ 完了 (2026-06-13) / 依存: T05 推奨 (smoke が安全網になる)
完了メモ: alert 85 箇所を toast へ全置換 (ブックマークレット内 4 箇所は対象外)。confirm は本棚削除・一括除外・単発除外・reparent の主要破壊操作を confirmDialog へ移行。残りの confirm は 07 に残課題。

## 目的

`alert()` / `confirm()` が散在し、見た目がネイティブで不統一。**通知は toast、破壊的操作の確認はアプリ内確認モーダル**に統一する。

## 方針 (2 段階 — 一括置換の事故を防ぐ)

- **Phase A (このタスクで全部やる)**: `alert()` → toast へ全置換。alert は戻り値を使わないので機械的に安全
- **Phase B (このタスクでは指定箇所のみ)**: `confirm()` → 確認モーダル。confirm は同期戻り値に依存するため、**呼び出し元を async 化する必要がある**。一括は危険なので下記の主要 3 系統だけ移行し、残りはネイティブ confirm のまま残す (07 に残課題として 1 行追記)

## 実装手順

### Step 1: 共通コンポーネント `js/ui-feedback.js` (新規)

- `window.toast(message, { type })`:
  - type: `'info' | 'success' | 'warn' | 'error'` (既定 info)
  - 画面下部中央 (モバイルは下部ナビの上) に積み上げ表示、4 秒で自動消滅 (error は 6 秒 + × で閉じる)
  - 複数同時はスタック。CSS は変数のみ使用 (`--panel`/`--fg`/`--warning`/`--danger`/`--accent`)。z-index はモーダル (1000+) より上の 1200
  - DOM コンテナは初回呼び出し時に body へ生成 (index.html 変更を最小に)
- `window.confirmDialog({ title, message, okLabel, danger })` → `Promise<boolean>`:
  - 既存モーダルのトーンに合わせた小型モーダル。OK は `danger: true` なら `.btn-danger`
  - Esc / 背景クリック = false
- `index.html` に script タグ追加 (`?v=` 付き、bookshelf.js より前)

### Step 2: alert の全置換 (Phase A)

1. `grep -n "alert(" js/*.js` で全箇所を列挙 (プラグインサンプル `plugins-sample/` は対象外)
2. 各箇所を意味で分類して置換: 成功系 → `toast(msg, {type:'success'})` / 入力不備・警告 → `warn` / 失敗 → `error`
3. メッセージ文面はそのまま (文言変更はしない)。絵文字入りの文面は絵文字を除去
4. ⚠️ alert がフロー制御を兼ねている箇所 (alert 直後に return 等) は挙動を変えない

### Step 3: confirm の限定移行 (Phase B)

以下の 3 系統のみ `await confirmDialog(...)` に移行 (呼び出し元の async 化と呼び出し連鎖を確認すること):
1. 本棚削除 (子孫カスケードの確認)
2. 一括除外 (`_bulkExclude`) / 単発除外
3. reparent 確認 (`_applyReparentWithConfirm`) — **同期呼び出し前提の箇所が無いか呼び出し元を遡って確認**。async 化が連鎖して広範囲に及ぶ場合はこの系統をスキップして 07 に残す (無理をしない)

## 受け入れ基準

1. `grep "alert(" js/*.js` の残存 0 件 (plugins-sample 除く)
2. toast: 成功 (例: 設定保存)・警告・エラーの 3 種が表示され、自動消滅・スタック・モバイル 390px での位置が正しい
3. 移行した confirm: OK / キャンセル / Esc がすべて従来挙動と一致 (削除キャンセルでデータ不変を確認 — saveUserData スタブ下で)
4. T05 の smoke が green のまま
5. console エラー 0 / `?v=` バンプ済み

## 設計書同期

- 03_詳細設計書: モジュール構成に `ui-feedback.js` を追加 + API 1 行
- 04_画面設計書: 文言方針の節に「通知は toast / 破壊的確認はアプリ内モーダル」を追記
- 07_残検討事項: T7 の toast 行を削除。confirm の未移行残があれば 1 行で追記

## コミット

`feat: 通知をtoastに統一 + 主要確認ダイアログのアプリ内モーダル化 (設計: 03/04 更新)`
