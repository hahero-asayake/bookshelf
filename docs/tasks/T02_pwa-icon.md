# T02: PWA アイコン刷新 + アプリ名 AsayakeBookshelf

状態: 未着手 / 依存: なし / 夜間続行可 (選定ゲート解消済み 2026-06-12)

## 目的

現行アイコン (System.Drawing 自動生成) を、デザインされたアイコンに置き換える。favicon も統一する。あわせて PWA マニフェストの名称を新正式名称 **AsayakeBookshelf** にする (ADR-029)。

## 確定済みデザイン仕様 (2026-06-12 ユーザ決定)

- **構図**: 候補 **案 A「子供と本棚」** (mockups/icon-candidates.html) をベースに**ブラッシュアップ**。Kindle アイコンの文法 (フラットシルエット + グラデ地)、モチーフは「本棚から本を取る子供」
- **カラー**: ユーザのホームページ ([hahero-asayake.github.io](https://hahero-asayake.github.io)) のパレットに合わせる。`assets/site.css` より:
  - 夜空: `#181b2c` → `#2d2638` → `#4a3b4e` (135deg)
  - 朝焼けグロー: `#ff9e7d` (accent-glow) / 暖色グラデ: `#ffecd2` → `#fcb69f`
- **アイコンに文字は入れない** (シルエットのみ)

### ブラッシュアップの方向 (3 バリアント作って比較)

「朝焼け (Asayake)」の名と一致する空気を出す:

1. **朝焼けの空 + 黒シルエット**: 背景を上=夜空 (#181b2c→#4a3b4e)、下=地平の朝焼けグロー (#ff9e7d→#ffecd2) の縦グラデにし、子供と本棚を**ダークシルエット** (#181b2c) で手前に置く (逆光の構図)
2. **暖色地 + 白シルエット**: 背景 #ffecd2→#fcb69f→#ff9e7d、シルエット白 (案 A の配色替え)
3. **夜明けツートーン**: 背景は 1 と同じ朝焼け空、シルエットはクリーム (#ffecd2)

共通の磨き込み: 案 A の構図を整理 (本の数を減らす・棚 2 段・伸ばす腕のラインを綺麗に・頭身バランス調整)。**48px で潰れないこと**と **maskable 円内に主要素**が最優先。

### 選定の進め方 (夜間に完結させる)

1. 3 バリアントを `mockups/icon-candidates.html` に追記 (旧 4 案は残す)、各サイズ + 円形マスクでスクリーンショット
2. 基準 (48px 可読性 / 円形マスク安全 / 朝焼けの空気 / ホームページとの調和) で**実装 AI が最良の 1 つを選んで実装まで進める**
3. 比較スクリーンショットを保存して報告に添付 → 朝ユーザが別バリアントを希望したら **PNG 再書き出しだけで差し替え可能** (source.svg を差し替えるだけの構造にしておく)

## 実装手順

### Step 1: 確定バリアントの量産

1. 確定 SVG を `icons/source.svg` として保存 (再生成元)
2. PNG 書き出し: `mockups/icon-export.html` (一時ファイル、終わったら _trash へ) に確定 SVG を**正確なピクセルサイズの要素**として並べ、Playwright の element screenshot (device pixel ratio 1) で出力:
   - `icons/icon-192.png` / `icons/icon-512.png`
   - `icons/icon-maskable-512.png` (全面ベタ背景 + 主要素を中央 80% に縮小した maskable 専用構図)
   - `icons/apple-touch-icon-180.png` (透過なし)
   - `icons/favicon-32.png`
   - 既存のファイル名が異なる場合は**既存名に合わせて上書き** (manifest / head の現参照名を先に確認)
3. 出力後、各 PNG の実寸を確認

### Step 2: 組み込み + 名称変更

1. `manifest.webmanifest`: `name: "AsayakeBookshelf"` / `short_name: "Asayake"` (ホーム画面ラベル用に短く。朝ユーザに確認可と報告に明記)。アイコンパス・purpose を確認
2. `index.html` `<head>`: favicon link を新 PNG に。`<title>` は T11 で正式変更するため**ここでは触らない**
3. `sw.js`: キャッシュバージョン定数をバンプ
4. 旧アイコンはファイル名が変わる場合のみ `_trash/` へ

## 受け入れ基準

1. 3 バリアントの比較スクリーンショットが保存され、選定理由が報告に書かれている
2. `manifest.webmanifest` の全アイコン URL が 200・実寸一致・name が AsayakeBookshelf
3. ブラウザタブの favicon が新アイコン
4. maskable: 円形クロップで主要素が欠けない
5. console エラー 0 / SW 更新フローが壊れていない

PWA 再インストールでのホーム画面確認・バリアント最終 OK は**朝のユーザ確認** (報告に依頼を明記)。

## 設計書同期

- 04_画面設計書: モバイル/PWA 節のアイコン記述を更新
- 08_意思決定記録: ADR-025 に採用バリアントを追記 / ADR-029 (名称) は記録済み
- 07_残検討事項: 該当行を削除

## コミット

`feat: PWAアイコンを朝焼けシルエットに刷新 + manifest名をAsayakeBookshelfに (設計: 04/08 更新)`
