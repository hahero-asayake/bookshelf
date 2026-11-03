# イシュー#519 step4: 起動時confirmDialogの実機確認画像

`scripts/verify/e2e-diff-main.mjs` のフル実行(回帰確認)とは別に、起動時の初期化確認を手で確かめた画像。
一時検証スクリプト(リポジトリ外・`.tmp-shots/shoot.mjs`、commitしていない)で、ポート18119に配信した
アプリに対し、GitHub API / Asayakeハブ API をモックしてPlaywright(chromium)で操作・撮影した。

## クラウド同期(Asayakeハブ): 保存データ無し

- `hub-confirm-shown.png`: 起動直後、確認画面が出た状態。背景に薄く「本棚を準備中…」のローディング
  テキストが見えるが、確認ダイアログ(`.cfm-overlay`、`--ov-z-dialog`)と重なって操作不能にはなっていない
  (`.cfm-ok`/`.cfm-cancel`とも押せる状態)。文言はinitCloudSyncのconfirm文言と一致。
- `hub-after-ok.png`: OKを押した後。`initEmpty()`で初期化され、警告無しで「すべての本」本棚が描画され、
  標準プラグイン(ダークテーマ切替等のアイコン)もシードされている。
- `hub-after-cancel.png`: キャンセルを押した後。初期化されず、「Asayake ハブは空です。初期化していません。」
  の警告帯(`.status-warn`)が出る。

## GitHub同期: 空リポジトリ

- `github-confirm-shown.png`: 起動直後、確認画面が出た状態。同様にローディングと重なっていない。
  文言はinitGitHubSyncのconfirm文言と一致。
- `github-after-ok.png`: OKを押した後。`initEmpty()`で初期化され、警告無しで「すべての本」本棚が描画される。
- `github-after-cancel.png`: キャンセルを押した後。初期化されず、警告は出ていない(GitHub側は`initGitHubSync`
  のキャンセル時に`_syncError`を立てず単に`return`するため。コードの既存挙動どおりで今回の変更外)。
