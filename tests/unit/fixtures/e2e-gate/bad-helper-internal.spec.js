// lint:e2e-gate のテスト用の見本(実行はしない)。名前の規則には当たらないが、本体を辿ると内部に届く関数を
// 操作・確認の区間で呼んでいる(helpers のものと、spec 内の自作のもの)。
import { test, expect } from './helpers/test-base.js';
import { seedLibraryForTest } from './helpers/setup.js';
import { addBlockAndCount, countBlocks, setBlocks } from './helpers/ops.js';

async function readTitle(page) {
    return page.evaluate(() => document.title);
}

test('@gate J5-2 内部から動かし、内部を読んで確かめている', async ({ page }) => {
    await test.step('前提: 蔵書を入れて起動する', async () => {
        await seedLibraryForTest(page);
    });
    await test.step('操作: ブロックを足す', async () => {
        await setBlocks(page, []);
        await addBlockAndCount(page);
    });
    await test.step('確認: ブロックが1つある', async () => {
        expect(await countBlocks(page)).toBe(1);
        expect(await readTitle(page)).toBe('AsayakeBookshelf');
    });
});
