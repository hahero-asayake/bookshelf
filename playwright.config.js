import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 60_000,
    // 開発サーバー。ローカルで既に :8000 が立っていればそれを使う
    webServer: {
        command: 'python -m http.server 8000',
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
        { name: 'chromium', use: { browserName: 'chromium' } }
    ]
});
