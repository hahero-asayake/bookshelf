// lint:e2e-gate のテスト用の見本ヘルパー(実行はしない・構文木で読まれるだけ)。
// クリックだけのもの = 操作の区間で使える
export async function clickAddBlock(page) {
    await page.locator('.art-cv-ins-btn').last().click();
    await page.locator('#art-add-sheet [data-block-type="shelf"]').click();
}

// 内部を読む = 確認の区間で使えない(名前は open*・show*・*Internal ではない)
export function getDraft(page) {
    return page.evaluate(() => window.bookshelf._artDraft);
}

export async function countBlocks(page) {
    const draft = await getDraft(page);
    return draft.blocks.length;
}

// クリックはするが、件数を内部から読む(本体を2段辿ると evaluate に届く)
export async function addBlockAndCount(page) {
    await clickAddBlock(page);
    return countBlocks(page);
}

// 内部から動かす = 操作の区間で使えない
export async function setBlocks(page, blocks) {
    await page.evaluate((b) => { window.bookshelf._artDraft.blocks = b; }, blocks);
}

// 名前の規則(open*・show*・*Internal)に当たるもの。中身がクリックだけでも使えない
export async function openSettingsByClick(page) {
    await page.locator('#settings-btn').click();
}

export function openEditorInternal(page) {
    return page.evaluate(() => window.bookshelf._artOpenSheet());
}

export async function showList(page) {
    await page.locator('#art-list-tab').click();
}

// 互いに呼び合う(循環)。内部には届かないので使える
export async function pingA(page, n = 0) {
    if (n < 2) await pingB(page, n + 1);
}

export async function pingB(page, n) {
    await page.locator('#ping').click();
    await pingA(page, n);
}
