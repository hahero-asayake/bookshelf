# AsayakeBookshelf

朝焼けを背に本棚から本を取る——ローカルファイル（Obsidian vault 等の同期フォルダ）を正本に、本棚を一級概念として扱い、プラグインで拡張可能な個人読書ライブラリ。

> リポジトリ名・公開 URL は `bookshelf`（`hahero-asayake.github.io/bookshelf`）のまま、表示名のみ **AsayakeBookshelf** に統一（ADR-029）。

[karaage0703/karaage-virtual-bookshelf](https://github.com/karaage0703/karaage-virtual-bookshelf) からフォーク → 全面再設計。

---

## コンセプト

- **ローカルファイル正本**: 同期フォルダ（Obsidian vault など）に全データを保存。GitHub やバックエンド不要
- **本棚が一級**: 親子継承・本棚ごとの短文メモ上書き・順引きと逆引きの整合
- **編集と公開の完全分離**: 編集用 main.json と公開用 main.json を別ファイルで保持
- **プラグインで拡張可能**: イベントフック + UI 拡張点 + GitHub からのインストール
- **PC ブラウザ完結**: File System Access API でローカルディレクトリを直接読み書き

## 同期フォルダ構造

```
<同期フォルダ>/
├── library.json              # Kindle 生データ
├── exclusions.json           # all 本棚から除外する ASIN
├── bookshelves.json          # 本棚一覧（メタ + isPublic）
├── books/
│   └── <ASIN>__<タイトル>.md  # 長文メモ（外部エディタで編集前提）
├── bookshelves/
│   ├── all.json              # 特殊本棚（本データ正本）
│   └── <slug>.json           # ユーザ作成本棚（books順序 + 上書きnotes）
├── private/
│   ├── settings.json
│   └── main.json             # 編集用メイン設定
├── public/
│   ├── settings.json
│   └── main.json             # 公開用メイン設定（編集側からコピー）
└── plugins/
    └── <plugin-id>/
        ├── manifest.json
        └── index.js
```

詳細は [obsidian/80_🚀project/81_🚀development/bookshelf/設計.md](https://github.com/hahero-asayake/obsidian-private) を参照（vault 内、私的）。

## セットアップ

### 1. リポジトリ取得

```bash
git clone https://github.com/hahero-asayake/bookshelf.git
cd bookshelf
```

### 2. ローカルサーバー起動

CORS 制約回避のため HTTP サーバーで開く必要がある:

```bash
python -m http.server 8000
# または
npx serve .
```

ブラウザで `http://localhost:8000` を開く。

> ⚠️ **VS Code Live Server は非推奨**: 同期フォルダの書き込みでブラウザがリロードされる現象がある。詳細と回避策は [CLAUDE.md](CLAUDE.md) を参照。

### 3. 同期フォルダの接続

1. ブラウザで「📁 Obsidian フォルダを選択」を押す
2. 同期フォルダを指定（初回のみ。FileSystemDirectoryHandle は IndexedDB に永続化される）
3. 中身が空でも自動で初期構造を作成

## 主な機能

| 機能 | 説明 |
|---|---|
| 📥 **Kindle 取込** | Bookmarklet 方式（拡張不要）。Amazon ライブラリページで実行 → postMessage で受信 |
| ➕ **手動追加** | ASIN・タイトル・著者・画像 URL・読んだ日付を入力 |
| 🚫 **除外** | Kindle 再取込時もスキップされる ASIN リスト |
| 📚 **本棚作成** | 親本棚継承・短文メモ上書き・本の並び替え（DnD）・isPublic フラグ |
| 📤 **公開にコピー** | private/main.json → 公開対象だけを public/main.json に書き出し |
| 📦 **エクスポート実行** | public/* + 該当本棚 + 本データ + 長文メモ + 編集 UI を抜いた html/js/css を `bookshelf-export/` に出力 |
| 🧩 **プラグイン** | GitHub repo URL から install。`activate(api, manifest)` で UI ボタン追加・イベントハック・エクスポート変換 |

## プラグイン

`plugins-sample/` にサンプル実装あり。最小スキーマ:

```json
{
  "id": "your-plugin-id",
  "name": "表示名",
  "version": "0.1.0",
  "publishable": false,
  "files": ["index.js"]
}
```

```js
// index.js
export function activate(api, manifest) {
    api.addUIButton({ id: 'hello', where: 'library-management', label: 'Hello', onClick: () => alert('hi') });
    api.on('note:updated', ({ asin, note }) => console.log('memo updated', asin, note));
}
```

API 詳細は [js/plugin-api.js](js/plugin-api.js) と [plugins-sample/README.md](plugins-sample/README.md) を参照。

## アーキテクチャ

| ファイル | 役割 |
|---|---|
| [js/bookshelf.js](js/bookshelf.js) | メインアプリケーションクラス（UI + ビジネスロジック） |
| [js/storage.js](js/storage.js) | File System Access API ラッパ、新ファイル構造のマイグレーション |
| [js/book-manager.js](js/book-manager.js) | 蔵書 CRUD |
| [js/bookshelf-manager.js](js/bookshelf-manager.js) | 本棚操作・継承・逆引きマップ |
| [js/exporter.js](js/exporter.js) | 公開エクスポート |
| [js/plugin-api.js](js/plugin-api.js) | プラグイン公開 API |
| [js/plugin-loader.js](js/plugin-loader.js) | プラグイン読込・GitHub install |

## モバイル

現状 PC ブラウザ専用（File System Access API が必須）。iOS は File Picker 拡張、Android は Capacitor ラッパで対応する計画（未実装）。

UA 検出時にバナーで案内を表示。

## ライセンス

オリジナルは MIT License（karaage0703）。
