import { defineConfig, devices } from '@playwright/test';
import { CHAR_DEVICES } from './tests/char-devices.js';

// webkit (iPhone相当) は CI では入れていないため、BACKNAV_WEBKIT=1 のときだけ戻る網羅マトリクス
// (イシュー#284)・チェックリスト自動化 (イシュー#295)・進む冪等化/transition無効化 (イシュー#330) に限って足す
const extraProjects = process.env.BACKNAV_WEBKIT === '1'
    ? [{ name: 'webkit', testMatch: /back-nav-matrix\.spec\.js|checklist-timing\.spec\.js|forward-reopen-idempotent\.spec\.js|touch-reorder\.spec\.js|overlay-front\.spec\.js|bookshelf-clip-373\.spec\.js|bookshelf-clip-385\.spec\.js|focus-trap-deeplink\.spec\.js|art-canvas-tap-edit\.spec\.js/, use: { ...devices['iPhone 13'] } }]
    : [];

// 門のE2E (@gate・tests/e2e/gate/) を webkit (iPhone相当・390タッチ) でも流す project (イシュー#589・G-6)。
// GATE_WEBKIT=1 の時だけ足す = project 指定なしの既定実行・e2e-diff-main・char・visual の件数を変えない。
// #580 のタップの回帰 (art-canvas-tap-edit) もここで流す。CI の webkit レグがこの project を流す。
// webkit (iPhone 13) では成り立たない門のE2E (イシュー#590 の分) は testIgnore で外す (@gate に test.skip は付けない決まり):
const GATE_WEBKIT_IGNORE = [
    /tests[\\/]e2e[\\/]gate[\\/]j1-2-storage-choice-pc\.spec\.js$/,      // PC (フォルダを選べる端末) の選択肢を見る。iPhone 相当は j1-2-storage-choice-phone が受け持つ
    /tests[\\/]e2e[\\/]gate[\\/]j1-3-connect-local\.spec\.js$/,          // 保存先「この端末のフォルダ」は PC 専用 (iPhone では選べない)
    /tests[\\/]e2e[\\/]gate[\\/]j1-3-connect-github\.spec\.js$/,         // 1280幅の PC の設定画面で操作する (iPhone の UA では別の画面になる)
    /tests[\\/]e2e[\\/]gate[\\/]j2-[1-5]-[a-z-]+\.spec\.js$/,             // 取込は PC 専用 (C-248・iPhone では「PCで取り込んでください」の案内だけ)
    /tests[\\/]e2e[\\/]gate[\\/]j3-[1-3]-[a-z-]+\.spec\.js$/,             // 1280幅の PC の左ペイン (本棚ツリー・表示) で操作する
    /tests[\\/]e2e[\\/]gate[\\/]j3-4-back-forward-esc-pc\.spec\.js$/,    // PC の Esc で詳細を閉じる (スマホに Esc キーは無い・390幅は j3-4-…-phone)
    /tests[\\/]e2e[\\/]gate[\\/]j3-5-many-books\.spec\.js$/,             // CPU を遅くするのに Chrome DevTools (CDP) を使う = chromium だけ
    /tests[\\/]e2e[\\/]gate[\\/]j4-memo\.spec\.js$/,                     // 前提が「この端末のフォルダ」(PC 専用・Safari に queryPermission が無く再読込でつなぎ直せない)
];
const gateWebkitProjects = process.env.GATE_WEBKIT === '1'
    // j8-offline は外す: Playwright の WebKit は電波なしの間 SW のキャッシュからも読めない (イシュー#589 step2 で実測。
    // 最小の SW でも再読込が失敗する = アプリではなく Playwright の制約)。iPhone の電波なしは人の実機 H1 で見る。
    // j6-1-local-restart も外す: ローカルのフォルダ保存は PC の Chrome/Edge 専用の機能 (ADR-046・iPhone では選べない)。
    // Playwright の WebKit には OPFS (navigator.storage.getDirectory) も無い (イシュー#607 で実測)。他の j6 系は外さない。
    ? [{ name: 'gate-webkit', testMatch: /tests[\\/]e2e[\\/]gate[\\/].*\.spec\.js$|art-canvas-tap-edit\.spec\.js$/, testIgnore: [/j8-offline\.spec\.js$/, /[\\/]j6-1-local-restart\.spec\.js$/, ...GATE_WEBKIT_IGNORE], use: { ...devices['iPhone 13'] } }]
    : [];
// 門ではない E2E のうち、webkit (iPhone 相当) でも流すもの (イシュー#604: 支払い管理からの戻り・
// イシュー#599: 保存先へ届く前に再読込した新規記事が一覧に戻る)
gateWebkitProjects.forEach((p) => { p.testMatch = [p.testMatch, /billing-portal-return\.spec\.js$/, /article-orphan-draft\.spec\.js$/]; });

// worktree分離(イシュー#413)でport衝突を避けるため環境変数化。PORT優先、未指定ならPLAYWRIGHT_BASE_URLの
// portを使い、どちらも無ければ既定の8000(従来どおり)。webServer.command/portとuse.baseURLの両方に使う
// ＝PLAYWRIGHT_BASE_URLだけ指定してもwebServerが別portで素通り/起動してしまう不整合を防ぐ。
const PORT = process.env.PORT
    || (process.env.PLAYWRIGHT_BASE_URL ? new URL(process.env.PLAYWRIGHT_BASE_URL).port : '')
    || '8000';

// キャラクタリゼーションテスト (イシュー#501) 専用の6端末。tests/e2e/char/ 配下の spec だけを対象にする
// (既存 project の testMatch/testIgnore で住み分け、既存 spec の実行対象・結果を変えない)。
// 端末の定義(390/768/820/1024はタッチ、1440/1920はマウス)はtests/char-devices.jsに1本化
// (イシュー#502のplaywright.visual.config.jsと二重管理していたDRY違反を②指摘で解消。2026-11-03)。
const CHAR_TEST_MATCH = /tests[\\/]e2e[\\/]char[\\/].*\.spec\.js$/;
const charProjects = CHAR_DEVICES.map(({ name, width, height, touch }) => ({
    name,
    testMatch: CHAR_TEST_MATCH,
    use: {
        browserName: 'chromium',
        viewport: { width, height },
        ...(touch ? { hasTouch: true, isMobile: true } : {})
    }
}));

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 60_000,
    // CI では github reporter で check-run の annotation に失敗テストを出す
    // (未認証の公開APIでも読める、イシュー#349)。list は人間向けの進捗表示用に残す。
    // json は自前の annotation 補完 (scripts/ci-annotate-failures.mjs) の入力。
    reporter: process.env.CI
        ? [['github'], ['list'], ['json', { outputFile: 'test-results/e2e.json' }]]
        : 'list',
    // 開発サーバー。ローカルで既に :8000 が立っていればそれを使う
    webServer: {
        command: `python3 -m http.server ${PORT}`,
        port: Number(PORT),
        reuseExistingServer: true
    },
    use: {
        // サブパス付きで流す場合はここを末尾'/'付きにすること(例: 'https://example.com/sub/')。
        // page.goto()側は先頭'/'なしの相対パス('index.html'等)に統一している(イシュー#396/#399)。
        // PLAYWRIGHT_BASE_URL で上書き可(未指定時はPORT/既定の8000から組み立て・イシュー#399/#413)。
        baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`,
        // Service Worker をブロック。index.html は controllerchange で location.reload() するため、
        // SW 初回制御の発火タイミング次第でテストが「navigation で context 破棄」になる (フレーク源)。
        // E2E はアプリのロジック検証が目的で SW キャッシュは不要なので一律ブロックして決定化する。
        serviceWorkers: 'block'
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: CHAR_TEST_MATCH },
        ...extraProjects,
        ...gateWebkitProjects,
        ...charProjects
    ]
});
