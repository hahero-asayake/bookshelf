import { defineConfig } from 'vitest/config';

// アプリのクラスは window.<Class> 公開 (ビルドレス) のため jsdom で読み込む。
// 各テストは `import '../../js/xxx.js'` 後に window から取得する。
export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['tests/unit/**/*.test.js'],
        // CI では落ちたテストの名前と行を check-run の注記にも出す (ジョブのログは未認証では読めない・イシュー#701)
        reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
        // 単体テストは外へ接続しない: 差し替えていない fetch を失敗させ、呼んだテストを落とす (イシュー#701)
        setupFiles: ['./tests/unit/helpers/no-network.setup.js']
    }
});
