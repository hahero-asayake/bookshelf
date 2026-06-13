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
        baseURL: 'http://localhost:8000'
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } }
    ]
});
