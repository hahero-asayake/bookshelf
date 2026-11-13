// lint:e2e-gate のテスト用の見本(実行はしない)。操作の区間で open*・show*・*Internal のヘルパーを呼んでいる。
import { test, expect } from './helpers/test-base.js';
import { openSettingsByClick, openEditorInternal, showList } from './helpers/ops.js';

test('@gate J5-1 画面を内部から開くヘルパーで開いている', async ({ page }) => {
    await test.step('操作: 設定と記事の一覧を開く', async () => {
        await page.goto('index.html');
        await openSettingsByClick(page);
        await openEditorInternal(page);
        await showList(page);
    });
    await test.step('確認: 一覧が見える', async () => {
        await expect(page.locator('#art-list')).toBeVisible();
    });
});
