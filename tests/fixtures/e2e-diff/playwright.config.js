import { defineConfig } from '@playwright/test';

// イシュー#510: e2e-diff-main.mjsの流し直し(file:line + --project)がテスト名の特殊文字・
// 同一行の複数テスト(test.eachループ相当)でも正しく対象を絞れることを確認する専用config。
// このフォルダ配下のspecだけを対象にする(本体の tests/e2e/ スイートとは完全に分離・
// testDir='tests/e2e'の本体playwright.config.jsには含まれないため本体の件数に影響しない)。
// spec側は page 等のブラウザfixtureを使わないダミーテストのみ(ブラウザ起動・webServer不要・
// CIのvitestジョブ(ブラウザ未インストール環境)でも通る)。
export default defineConfig({
    testDir: '.',
    projects: [{ name: 'chromium' }],
});
