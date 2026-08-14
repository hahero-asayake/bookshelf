# js/vendor/

サードパーティ製ライブラリを、bookshelf のビルドレス方針 (ADR-001) に合わせてファイルとして同梱する場所。
CDN からの読込は使わない (Service Worker のオフライン動作・公開ビルド生成が壊れるため)。

## marked.umd.js

- 出典: npm `marked` v18.0.9 (`lib/marked.umd.js` の UMD ビルド)
- ライセンス: MIT (ファイル冒頭のコメントにも記載)
- 用途: `js/publish-article-generator.js` の文章ブロック / 長文メモ Markdown→HTML 変換 (S2, ADR-058)。
  `<script>` 読込でグローバル `marked` を公開する。アプリ内部の変換処理でのみ使用し、
  生成される公開 HTML 自体には同梱しない (CSP `script-src 'none'` とは無関係)。
- **1箇所だけ手を入れている**: UMD ラッパーの CJS/AMD 分岐を外し、常に `globalThis["marked"]` へ代入する形に
  単純化した (本体ロジックは無改変)。元の分岐のままだと vitest (vite-node) の ESM 変換環境で CJS 分岐
  (`module.exports=f()`) を通ってしまい、テストから `globalThis.marked` が見えなかったため。
- 更新: 新バージョンを使う場合は `npm pack marked@<version>` で取得し、`lib/marked.umd.js` を複製した上で
  同じラッパー書き換えを再適用すること。
