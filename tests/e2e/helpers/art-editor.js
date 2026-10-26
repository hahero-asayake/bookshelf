// 記事エディタ: iframeキャンバス取得・ブロック追加の共通ヘルパー (イシュー#372)
//
// critical-path/preview-real-adapter/smoke/publish-panel/username-publish-gate/
// publish-conflict-hub/publish-article-editor.spec.js の7ファイルに同一実装の
// addBlock/canvas がコピーされていた(ハヘロ方針「個別に作るからバグが出る」)。
// CIで実際に addBlock(publish-article-editor.spec.js:2504) が①②(#372 step3)と
// 同じ型で落ちたため、1本化する。
//
// ins-btn→add-sheet の開き方は①②で直した型に寄せるが、トップレベルのクリック再試行
// (toPass)は「ブロック数が +1 される」まで続けると2重クリックで2個追加されうる
// (②差し戻し指示)。そのため再試行は「シートを開く→項目が見えるまで」だけに限定し、
// 項目(data-block-type)のクリックは1回だけ行う。その後「ブロック数が+1(2つ増えたら失敗)」
// を数えて確認する。
import { expect } from './test-base.js';

export function canvas(page) { return page.frameLocator('#art-canvas-frame'); }

/**
 * @param {import('@playwright/test').Page} page
 * @param {'text'|'book'|'shelf'} type
 * @param {'first'|'last'} pos
 * @param {{ textMode?: 'form'|'inline' }} [opts]
 *   textMode: 'form' (既定・#276 step3以降の型=全画面EasyMDE) | 'inline' (旧キャンバスその場入力=.art-cv-ta)
 */
export async function addBlock(page, type, pos = 'last', { textMode = 'form' } = {}) {
    const done = page.locator('#art-fs-done');
    if (await done.isVisible()) await done.click();
    const edit = page.locator('#art-mode-edit');
    if (await edit.isVisible()) await edit.click();
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
    const before = await page.evaluate(() => (window.bookshelf._artDraft.blocks || []).length);
    const btns = canvas(page).locator('.art-cv-ins-btn');
    await expect(btns).toHaveCount(before + 1);
    // シートを開く: ins-btnのclickがCI実機でまれに届かない窓がある(#372)。開くまでだけリトライし、
    // 項目クリックはこのtoPassの外で1回だけ行う(2重クリックでブロックが2つ増える事故を避ける)。
    await expect(async () => {
        await (pos === 'first' ? btns.first() : btns.last()).click();
        await expect(page.locator('#art-add-sheet [data-block-type="' + type + '"]')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await page.locator('#art-add-sheet [data-block-type="' + type + '"]').click();
    // ブロック数が+1であること(2つ増えたら失敗=期待値は変えていない、+1固定)を確認する
    await expect.poll(() => page.evaluate(() => (window.bookshelf._artDraft.blocks || []).length)).toBe(before + 1);
    if (type === 'text' && textMode === 'inline') {
        await expect(canvas(page).locator('.art-cv-ta')).toBeVisible();
    } else {
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        if (type === 'text') await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
    }
}
