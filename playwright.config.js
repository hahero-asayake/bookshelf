import { defineConfig, devices } from '@playwright/test';

// webkit (iPhone相当) は CI では入れていないため、BACKNAV_WEBKIT=1 のときだけ戻る網羅マトリクス
// (イシュー#284)・チェックリスト自動化 (イシュー#295)・進む冪等化/transition無効化 (イシュー#330) に限って足す
const extraProjects = process.env.BACKNAV_WEBKIT === '1'
    ? [{ name: 'webkit', testMatch: /back-nav-matrix\.spec\.js|checklist-timing\.spec\.js|forward-reopen-idempotent\.spec\.js|touch-reorder\.spec\.js|overlay-front\.spec\.js|bookshelf-clip-373\.spec\.js|bookshelf-clip-385\.spec\.js/, use: { ...devices['iPhone 13'] } }]
    : [];

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
        command: 'python3 -m http.server 8000',
        port: 8000,
        reuseExistingServer: true
    },
    use: {
        baseURL: 'http://localhost:8000',
        // Service Worker をブロック。index.html は controllerchange で location.reload() するため、
        // SW 初回制御の発火タイミング次第でテストが「navigation で context 破棄」になる (フレーク源)。
        // E2E はアプリのロジック検証が目的で SW キャッシュは不要なので一律ブロックして決定化する。
        serviceWorkers: 'block'
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
        ...extraProjects
    ]
});
