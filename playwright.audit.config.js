import { defineConfig } from '@playwright/test';
import { CHAR_DEVICES } from './tests/char-devices.js';

// 監査の機械検査 (門(c)・イシュー#585・docs/audit/machine-checks.md)。
// 名前の無い部品・ボタン名の揺れ・表示崩れを、6端末(tests/char-devices.js)で巡回して検出する。
// playwright.visual.config.js と同じ型のスタンドアロン設定 (`npm run test:e2e` には入らない)。
// 実行には PORT と PLAYWRIGHT_BASE_URL を必ず付ける:
//   PORT=8185 PLAYWRIGHT_BASE_URL=http://localhost:8185 npx playwright test -c playwright.audit.config.js
const PORT = process.env.PORT
    || (process.env.PLAYWRIGHT_BASE_URL ? new URL(process.env.PLAYWRIGHT_BASE_URL).port : '')
    || '8000';

export default defineConfig({
    testDir: 'tests/audit',
    timeout: 120_000,
    outputDir: 'test-results-audit',
    reporter: 'list',
    webServer: {
        command: `python3 -m http.server ${PORT}`,
        port: Number(PORT),
        reuseExistingServer: true,
    },
    use: {
        baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`,
        serviceWorkers: 'block',
    },
    projects: CHAR_DEVICES.map(({ name, width, height, touch }) => ({
        name,
        use: {
            browserName: 'chromium',
            viewport: { width, height },
            ...(touch ? { hasTouch: true, isMobile: true } : {}),
        },
    })),
});
