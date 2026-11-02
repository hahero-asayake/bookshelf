import { defineConfig } from '@playwright/test';
import { CHAR_DEVICES } from './tests/char-devices.js';

// イシュー#502 (U1 §3-3): 画面の見た目の基準(スクリーンショット比較)専用の設定。
// playwright.config.js の projects には入れない方針(U0=#501 がキャラクタリゼーションテスト用
// の6端末projectsをそこに足しているため、衝突を避ける)。testDir を tests/visual/ に分けて、
// 通常の `npm run test:e2e` / CI(reporter未指定時はgithub出力が無い)には一切入らない
// スタンドアロン設定にする。
//
// PORT/baseURLの規則は playwright.config.js と完全に同じにする(worktree分離=イシュー#413・
// PORT優先→PLAYWRIGHT_BASE_URLのport→既定8000)。実行時はこのイシュー専用のPORT=8102を使う。
const PORT = process.env.PORT
    || (process.env.PLAYWRIGHT_BASE_URL ? new URL(process.env.PLAYWRIGHT_BASE_URL).port : '')
    || '8000';

// U0(イシュー#501)が playwright.config.js に足した6端末と、名前・viewport・タッチ設定を
// 完全に合わせる(brief の注意「端末の名前と設定をU0側に合わせる」)。定義自体は
// tests/char-devices.js に1本化済み(②指摘・DRY)。

export default defineConfig({
    testDir: 'tests/visual',
    timeout: 60_000,
    // このファイル専用の結果置き場(通常のtest-results/と混ざらないようにする)
    outputDir: 'test-results-visual',
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
    // 計画§3-3の閾値(0.1%)。スナップショットパスをOS接尾辞込みで tests/visual/__screenshots__/ に固定する。
    expect: {
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.001,
            threshold: 0.2,
            animations: 'disabled',
            caret: 'hide',
        },
    },
    snapshotPathTemplate: 'tests/visual/__screenshots__/{arg}-{projectName}-{platform}{ext}',
    projects: CHAR_DEVICES.map(({ name, width, height, touch }) => ({
        name,
        use: {
            browserName: 'chromium',
            viewport: { width, height },
            ...(touch ? { hasTouch: true, isMobile: true } : {}),
        },
    })),
});
