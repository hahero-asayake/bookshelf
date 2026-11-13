// ボタン名の揺れの検出器 (tests/audit/detectors/button-names.js) の変異検査。
// 同じ操作のボタンが2画面で「閉じる」と「とじる」なら1件、名前がそろっていれば0件であること。
import { test, expect } from '@playwright/test';
import { pinEnvironment } from '../boot.js';
import { collectButtons, buttonVariants } from '../detectors/button-names.js';

async function collectFrom(page, files) {
    const buttons = [];
    for (const [screen, file] of files) {
        await page.goto(`tests/fixtures/audit/${file}`);
        await pinEnvironment(page);
        buttons.push(...await collectButtons(page, screen));
    }
    return buttons;
}

test('誤りを入れた見本で、同じ操作なのに名前が違うボタンを1件検出する', async ({ page }) => {
    const buttons = await collectFrom(page, [['a', 'button-names-a.html'], ['b', 'button-names-b.html']]);
    const result = buttonVariants(buttons);
    expect(result.total).toBe(1);
    expect(result.variants.map((v) => [v.opKey, v.names.map((n) => n.name)])).toEqual([['std:close', ['とじる', '閉じる']]]);
    // 確認ダイアログの実行ボタン (削除する・公開する) は、名前が違っても揺れに数えない
    expect(result.variants.some((v) => v.opKey === 'confirm:ok')).toBe(false);
    // 操作キーが付かないボタンは未分類として別に出す
    expect(result.unclassified.map((b) => b.name)).toEqual(['その他の操作']);
});

test('名前がそろった見本では0件', async ({ page }) => {
    const buttons = await collectFrom(page, [['a', 'button-names-a.html'], ['b', 'button-names-good-b.html']]);
    expect(buttonVariants(buttons).total).toBe(0);
});

test('抽出した取消ボタンの名前を足すと、巡回で開かなかった分の揺れも検出する', async ({ page }) => {
    const buttons = await collectFrom(page, [['a', 'button-names-a.html'], ['b', 'button-names-good-b.html']]);
    const result = buttonVariants(buttons, { 'confirm:cancel': ['キャンセル', 'やめる'] });
    expect(result.total).toBe(1);
    expect(result.variants[0].opKey).toBe('confirm:cancel');
});
