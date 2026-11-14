// 監査で巡回する全画面の一覧 (docs/audit/machine-checks.md §1)。データだけを持つ (開き方は open.js)。
//   surfaces  対応する S.define の ID (js/bookshelf.js _defineSurfaces)
//   std1      対応する docs/ui-standards.md §1 の表の行 (「面」の列の先頭の文字)
//   scope     その面の中だけを測る (ポップオーバー・メニュー・バナー・シート・本の詳細の欄など、背後に元の画面が残る面)。
//             背後の画面の崩れは、背後の画面の行で数える (同じ崩れを面の数だけ数えない)
// S.define の全 ID と §1 の表の全行が、ここか EXCLUDED のどちらかに載っていることを
// tests/unit/audit-screens-coverage.test.js が確かめる。
export const SCREENS = [
    { id: 'home', title: 'ホーム', group: 'main' },
    { id: 'home-empty', title: '蔵書0のホーム（初回の案内）', group: 'empty' },
    { id: 'home-edit', title: 'ホームの編集', group: 'main', surfaces: ['dashboard-edit'] },
    { id: 'widget-picker', scope: true, title: 'ウィジェットピッカー', group: 'main', std1: ['ウィジェットピッカー'] },
    { id: 'shelf', title: '本棚の一覧', group: 'main' },
    { id: 'shelf-empty', title: '空の本棚', group: 'empty' },
    { id: 'shelf-tree-menu', scope: true, title: '本棚ツリーの「…」メニュー', group: 'main', std1: ['本棚ツリーの「…」メニュー'] },
    { id: 'popover-filter', scope: true, title: 'フィルターのポップオーバー', group: 'main', std1: ['ヘッダーのポップオーバー'] },
    { id: 'popover-display', scope: true, title: '表示のポップオーバー', group: 'main', std1: ['ヘッダーのポップオーバー'] },
    { id: 'popover-search', scope: true, title: '検索のポップオーバー', group: 'main', std1: ['ヘッダーのポップオーバー'] },
    { id: 'bulk-shelf-popover', scope: true, title: 'まとめて本棚に入れるポップオーバー', group: 'main' },
    { id: 'book-detail', scope: true, title: '本の詳細（PCは右ペイン・スマホはシート）', group: 'main', std1: ['本詳細シート'] },
    { id: 'book-memo', title: '長文メモエディタ', group: 'memo', surfaces: ['book-memo-modal'], std1: ['長文メモエディタ'] },
    { id: 'mde-heading-menu', scope: true, title: '見出しボタンの3択メニュー', group: 'memo', surfaces: ['mde-heading-menu'], std1: ['書式ツールバーの見出しボタンの3択メニュー'] },
    { id: 'drawer', scope: true, title: '左ナビのドロワー', group: 'main', surfaces: ['drawer'], std1: ['ドロワー'] },
    { id: 'command-palette', title: 'コマンドパレット', group: 'main', surfaces: ['command-palette'], std1: ['コマンドパレット'] },
    { id: 'settings', title: '設定の一覧', group: 'settings', surfaces: ['settings-modal'], std1: ['設定モーダル'] },
    { id: 'settings-cat', title: '設定の各節', group: 'settings', surfaces: ['settings-cat'], std1: ['設定モーダル'] },
    { id: 'plugin-settings', title: 'プラグイン設定', group: 'settings', surfaces: ['plugin-settings-modal'], std1: ['プラグイン設定モーダル'] },
    { id: 'import', title: '取込', group: 'manage', surfaces: ['import-modal'], std1: ['取込モーダル'] },
    { id: 'add-book', title: '本の手動追加', group: 'manage', surfaces: ['add-book-modal'], std1: ['手動追加モーダル'] },
    { id: 'exclusions', title: '除外一覧', group: 'manage', surfaces: ['exclusions-modal'], std1: ['除外一覧モーダル'] },
    { id: 'shelves-manage', title: '本棚管理', group: 'shelves', surfaces: ['bookshelf-modal'], std1: ['本棚管理モーダル'] },
    { id: 'shelf-form', title: '本棚フォーム', group: 'shelves', surfaces: ['bookshelf-form-modal'], std1: ['本棚フォームモーダル'] },
    { id: 'icon-picker', title: 'アイコンピッカー', group: 'shelves', surfaces: ['icon-picker-modal'], std1: ['アイコンピッカー'] },
    { id: 'descendants-pick', title: '子孫選択', group: 'shelves', surfaces: ['descendants-pick-modal'], std1: ['子孫選択モーダル'] },
    { id: 'publish-list', title: '記事の一覧', group: 'publish', surfaces: ['publish-pages-modal'], std1: ['公開記事モーダル'] },
    { id: 'art-viewing', title: '記事の閲覧状態', group: 'publish', surfaces: ['art-viewing'], std1: ['記事エディタの多段'] },
    { id: 'art-edit', title: '記事の編集状態', group: 'publish', surfaces: ['art-edit-mode'], std1: ['記事エディタの多段'] },
    { id: 'art-fs', title: 'ブロックの全画面・PCの文章ブロック右ペイン', group: 'publish', surfaces: ['art-fs'], std1: ['記事エディタのブロック全画面'] },
    { id: 'art-add-sheet', scope: true, title: 'ブロックを足すシート', group: 'publish', surfaces: ['art-add-sheet'], std1: ['記事エディタの多段'] },
    { id: 'art-blk-menu', scope: true, title: 'ブロックのメニュー', group: 'publish', surfaces: ['art-blk-menu'], std1: ['記事エディタの多段'] },
    { id: 'art-look-sheet', scope: true, title: '見た目のシート', group: 'publish', surfaces: ['art-look-sheet'], std1: ['記事エディタの多段'] },
    { id: 'art-drawer', scope: true, title: '引き出し', group: 'publish', surfaces: ['art-sheet'], std1: ['記事エディタの多段'] },
    { id: 'art-drawer-shelf-popover', scope: true, title: '引き出しの本棚えらび', group: 'publish' },
    { id: 'art-more-menu', scope: true, title: '記事の ⋯ メニュー', group: 'publish', surfaces: ['art-more-menu'], std1: ['記事エディタの ⋯ メニュー'] },
    { id: 'art-publish', title: '公開パネル', group: 'publish', surfaces: ['art-publish-modal'], std1: ['公開パネル'] },
    { id: 'art-preview', title: '公開プレビュー（中の公開記事ページを含む）', group: 'publish', surfaces: ['pp-preview-modal'], std1: ['公開プレビューモーダル'] },
    { id: 'publish-settings', title: '公開の設定', group: 'publish', surfaces: ['publish-settings-modal'] },
    { id: 'report', title: '記事の通報', group: 'dialogs', surfaces: ['report-modal'], std1: ['記事の通報ダイアログ'] },
    { id: 'confirm', title: '確認ダイアログ（2択）', group: 'dialogs', std1: ['confirmDialog'] },
    { id: 'sync-conflict', title: '衝突の選択ダイアログ（書き込み時）', group: 'dialogs', std1: ['衝突の選択ダイアログ'] },
    { id: 'usage-alert', scope: true, title: '容量アラートバナー', group: 'dialogs', std1: ['容量アラートバナー'] },
    { id: 'mobile-setup-banner', scope: true, title: 'スマホの設定案内バナー', group: 'dialogs' },
];

// 巡回の対象外 (理由つき)
export const EXCLUDED = [
    { name: 'プラグインの面', std1: ['プラグインの面'], reason: '中身はプラグインごとに違う。標準プラグインがこの面を使う場合は SCREENS へ移す' },
    { name: '読込時の衝突ダイアログ (3択)', reason: '書き込み時 (sync-conflict) と同じ定義 (js/bookshelf.js CONFLICT_DIALOG) から出る (イシュー#635・ui-standards §1 は「衝突の選択ダイアログ」の1行)。保存先とこの端末の両方が変わった時だけ出る。再現に保存先の模擬と未接続が要るため、巡回には未投入。動きと既定のボタンは tests/e2e/sync-offline-reconnect.spec.js で見る (イシュー#602)' },
    { name: 'トースト', reason: '数秒で消える表示。文言は抽出 (scripts/extract-ui-strings.mjs) で見る' },
    {
        name: 'プラグインの一覧 (plugins-modal)',
        surfaces: ['plugins-modal'],
        reason: 'S.define の登録だけが残っていて、開く対象が無い。index.html に要素が無く、開く処理も js に無い (js/screens/settings.js の「プラグイン管理 UI」のコメント: showPluginsModal・closePluginsModal は削除済み)',
    },
];
