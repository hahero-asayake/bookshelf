# T11: SEO / OGP / README 刷新

状態: 未着手 / 依存: T02 (アイコン)、T10 (公開ページが SEO の主対象)

## 目的

「サイトとして」の体裁を整える: 検索・シェア時の見え方 (meta / OGP) と、リポジトリの README (現状 fork 元のまま)。

## 実装手順

### Step 1: meta / OGP (`index.html` head)

1. `<title>`: `📚 bookshelf` → `bookshelf — 蔵書を眺めて楽しむ本棚アプリ` (📚 は favicon が新調されたため不要。タブ視認性は T02 のアイコンが担う)
2. `<meta name="description">`: 1〜2 文 (Kindle 蔵書を本棚として整理・公開できる、を平易に)
3. OGP + Twitter Card:
   - `og:title` / `og:description` / `og:type=website` / `og:url` (公開 URL) / `twitter:card=summary_large_image`
   - **`og:image`**: `icons/source.svg` (T02) を元に **1200×630 の OGP 画像**を生成 (`mockups/og-export.html` + Playwright element screenshot、T02 と同手法)。構図: 左にアイコン、右に「bookshelf」ロゴテキスト + 一言。`assets/og-image.png` として保存し絶対 URL で指定
4. 公開モード時は JS で `document.title` を「<本棚名> — hahero の本棚」等に動的更新 (T10 の表示名規約に従い**本名禁止**)
5. 編集モード (個人ツール) を検索結果に出したくないか実装時にユーザへ 1 問確認 → 出したくない場合も、同一 URL のため noindex は付けず **公開ページ優先の説明文**にする (これが既定)

### Step 2: README.md 刷新

現 README (fork 元 karaage 由来) を全面書き換え。構成:

1. ヒーロー: 1 行説明 + スクリーンショット (PC ホーム / 本棚ビュー / モバイル。Playwright で撮影し `assets/` に保存)
2. 特徴 (箇条書き 6〜8 個: 本棚階層 / メモ・評価 / ⌘K / ダッシュボード / PWA / 同期 4 方式 / プラグイン / 公開)
3. 使い始める: GitHub Pages 版 URL / ローカル起動 (`python -m http.server 8000`)
4. データと同期: 同期フォルダ構造の概要 + vault 設計書 06 へのリンク
5. フォークする人へ: GitHub App + Cloudflare Worker + (T07/T08 後) Drive/Dropbox アプリ登録が必要 → CLAUDE.md の該当 runbook へのリンク
6. プラグイン開発: 05_プラグイン仕様書相当の要点 + `plugins-sample/` へのリンク
7. クレジット: fork 元 (karaage0703 氏) への謝辞を**必ず残す** / ライセンス表記 (既存 LICENSE を確認して整合)
8. README は日本語。英語版は作らない (07 の i18n 判断に従う)

### Step 3: Chrome 拡張の Web Store 公開 — runbook のみ (ユーザ任意作業)

コード作業なし。報告に以下の手順を添える: 開発者登録 ($5) → `kindle_bookshelf_exporter` を zip → ダッシュボードから登録 (説明文・スクショ・プライバシー記載: postMessage 先の説明) → 審査。公開後、bookshelf 側の取込案内文言の「zip を読み込み」を「Web Store からインストール」に更新する (これは公開されてから別途)。

## 受け入れ基準

1. OGP デバッガ相当の確認: `og:image` が 200 で 1200×630、メタタグが HTML に正しく出力されている
2. シェアプレビューの見た目をスクリーンショットでユーザに提示 (X/Slack 風プレビューは og-export.html 上で再現可)
3. README: GitHub 上でレンダリング崩れなし・スクリーンショット表示・fork 元クレジットあり・リンク切れなし
4. アプリ挙動は無変更 (head のみ)。console エラー 0

## 設計書同期

- 04_画面設計書: 文言方針の近くに「meta / OGP / タイトル規約」を 3 行で追記
- 07_残検討事項: T3 の SEO / README 行を削除
- 00_概要 (vault): リンク表に変更があれば追従

## コミット

`feat: OGP/meta整備 + README全面刷新 (設計: 04 更新)`
