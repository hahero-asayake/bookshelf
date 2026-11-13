// lint:e2e-gate のテスト用の見本(実行はしない)。テスト名と @gate の付け方が崩れている。
import { test, expect } from './helpers/test-base.js';

const body = async ({ page }) => {
    await test.step('操作: アプリを開く', async () => {
        await page.goto('index.html');
    });
    await test.step('確認: 題名が見える', async () => {
        await expect(page.locator('h1')).toBeVisible();
    });
};

test('@gate 観測点IDが無い', async ({ page }) => {
    await test.step('操作: アプリを開く', async () => {
        await page.goto('index.html');
    });
    await test.step('確認: 題名が見える', async () => {
        await expect(page.locator('h1')).toBeVisible();
    });
});

test('@gate J9-9 表に無い観測点ID', async ({ page }) => {
    await test.step('操作: アプリを開く', async () => {
        await page.goto('index.html');
    });
    await test.step('確認: 題名が見える', async () => {
        await expect(page.locator('h1')).toBeVisible();
    });
});

for (const width of [390, 1440]) {
    test(`@gate J3-4 幅${width}で迷子にならない`, body);
}

test.skip('@gate J3-5 流れないテスト', async ({ page }) => {
    await test.step('操作: アプリを開く', async () => {
        await page.goto('index.html');
    });
    await test.step('確認: 題名が見える', async () => {
        await expect(page.locator('h1')).toBeVisible();
    });
});

test.describe('@gate まとめて付ける', () => {
    test('J3-3 並べ替えが残る', body);
});

test('J4-1 タグのオプションで付ける', { tag: '@gate' }, body);
