import { defineConfig } from 'vitest/config';

// アプリのクラスは window.<Class> 公開 (ビルドレス) のため jsdom で読み込む。
// 各テストは `import '../../js/xxx.js'` 後に window から取得する。
export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['tests/unit/**/*.test.js']
    }
});
