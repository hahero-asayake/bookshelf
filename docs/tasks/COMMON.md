# COMMON — 全タスク共通の規約 (毎セッション必読)

## 環境

- コード: `c:/Users/magur/Documents/GitHub/bookshelf` (このリポジトリ)
- 設計書: `c:/Users/magur/Documents/GitHub/obsidian/80_🚀project/81_🚀development/bookshelf/` (00〜08。書き方ルールは 00_概要)
- 実データ (ユーザの本物の蔵書): `obsidian/40_📖reading/41_📖bookshelf-data/` — **読み取り専用として扱う。テストで書き換えない**
- 開発サーバー: `python -m http.server 8000` をリポジトリ直下で起動 → `http://localhost:8000/index.html`
- ブラウザ検証: Playwright MCP を使用。スクリーンショットの保存先は許可されたルート配下の絶対パスを指定 (相対パスは失敗する)

## 鉄則 (違反 = タスク失敗)

1. **検証 (受け入れ基準) を全て満たすまで push しない**。満たしたら commit → push → README のチェック更新まで一気に行う
2. **実データを変更しない**。UI 検証前に必ず `app.saveUserData = async () => {}` でスタブする (同期書込が止まる)。同期機能そのものの検証タスク (T01/T07/T08/T09) は指示書の検証手順に明記された操作のみ行う
3. **js / css を変更したら `index.html` の該当 `?v=` を必ずバンプ** (`?v=YYYYMMDDNN`)。古いキャッシュ JS での検証はイベント空振りの罠 (過去に再発)
4. **ファイル削除は直接行わず `_trash/` へ移動**
5. 指示書にない依存ライブラリ・CDN を勝手に追加しない
6. 担当タスクと無関係なコードを「ついでに」直さない (気づいた問題は commit メッセージではなく vault の 07_残検討事項に 1 行追記)
7. コミットメッセージは `feat:`/`fix:`/`refactor:`/`docs:`/`test:` prefix + 末尾に `(設計: NN_xxx YYYY-MM-DD 更新)` で設計書同期を相互参照

## 検証プロトコル (UI を触るタスクは必須)

1. サーバー起動 → Playwright で開く → `window.bookshelf` が初期化されるまで待つ (`app.userData` 出現をポーリング)
2. `app.saveUserData = async () => {}` をスタブ (鉄則 2)
3. 検証用本棚: `app.switchBookshelf('bookshelf_1757120031680')` (「おすすめの漫画」87 冊。評価分布: 未評価 2 / ★4 58 / ★5 27)
4. **PC 幅 1280px と モバイル幅 390px の両方**で確認
5. console エラー 0 件を確認 (`browser_console_messages` level=error)
6. ⚠️ ALL 本棚 (約 2,400 冊) はヘッドレスで描画が詰まるため自動検証に使わない (GPU 無効環境の content-visibility 制約)

## コードの流儀

- Vanilla JS・ビルドレス。クラスは `window.<ClassName>` 公開、`<script>` 順次読込
- 色は CSS 変数のみ (`--accent` 等)。生の色直書き禁止 (警告色の意味色のみ例外)
- アイコンは Lucide (`data-icon` 属性 + `applyIcons`、または `window.renderIcon`)。絵文字を UI に入れない
- 文言は一般ユーザ向け日本語 (内部用語・英語キーを出さない)。確認ダイアログには実際に書く値のみ表示
- モバイル上書き CSS は **css/bookshelf.css 末尾のメディアブロック**に置く (media query は specificity を上げない — 途中に置くと後方の base に潰される)

## 既知の落とし穴 (vault 08_意思決定記録「実装上の教訓」より)

- `.popover` に top と bottom を同時指定しない (高さが負になり潰れる)
- 塗りボタン内の `.h-icon` は `color: inherit` を明示 (既定が accent 色で見えなくなる)
- グリッドの `1fr` は content-visibility の intrinsic-size に押し広げられる → モバイルは `minmax(0,1fr)`
- `.book-cover-link` の `height:100%` を消さない (表紙の下端揃えが崩れる)
- プラグイン API のラッパは pluginId を明示的に引き回す
- 本棚の参照は常に `_keyOf(bs) = internalId || id` (実データに internalId 欠落あり)

## 設計書同期 (コード変更したタスクは必須)

`bookshelf/CLAUDE.md` の対応表に従い、同セッション内で vault の設計書を更新する:

- 設計書 01〜06 は「現在の仕様」を**直接書き換える** (日付つき追記・経緯・検証ログを書かない)
- 新しい設計判断が発生したら 08_意思決定記録に ADR を追記
- 完了したバックログ項目は 07_残検討事項から**行を削除**
- vault 側は自動バックアップが commit するため手動 commit 不要。コード側は commit + push する

## ユーザへの報告

タスク完了時は以下を簡潔に報告: 何が変わったか (ユーザ視点) / 検証結果 (基準ごとの合否) / 設計書のどこを更新したか / commit ハッシュ。スクリーンショットがあれば添付。
