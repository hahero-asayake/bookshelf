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
//
// 以下4関数はU9 G3-1(イシュー#551)で追加。`_artFlushSave`/`_artFlushRemoteNow`/
// `_artEditingId`への直接参照をテスト側から無くすための(c)集約先(#536の教訓=保存を即時
// 確定させる呼び出しは実クリック等へ置き換えず、決定性のためテスト用ヘルパーに留める)。
// - flushArtSave(page): 記事のメモリ保存(_artFlushSave)を確定させる。戻り値なし。
// - flushArtRemoteNow(page): 記事のリモート保存(_artFlushRemoteNow)を確定させる。戻り値なし。
// - flushArtSaveAndRemote(page): メモリ保存→リモート保存を元の呼び方どおり1回のevaluate内で
//   連結して確定させる(2回のevaluateに分けない=ブラウザ側のPromiseチェーンのタイミングを保つ)。
//   戻り値なし。
// - getArtEditingId(page): 現在編集中の記事id(_artEditingId)を返す。
//
// 以下9関数はU9 G3-2(イシュー#552)で追加。`_artDraft`/`_artTextFsEditor`ほか
// (docs/char/u9-g3-2-plan.md)への直接参照をテスト側から無くすための(c)集約先。
// `_artDraft`は下書き中身の検証・ブロック状態の読み取り・テスト前の状態設定を全て含む
// ため、DOM側に型/内容を1:1で示す属性が無いことを確認した上で全件(c)にした(同plan.md §3)。
// - getArtDraft(page): 下書きオブジェクト(_artDraft)全体を返す。
// - waitForArtDraft(page): 下書きオブジェクトが生成されるまで待つ(expect.poll)。
// - getArtBlocks(page): 下書きのブロック配列(_artDraft.blocks)を返す(無ければ[])。
//   map/find/length等の加工は呼び出し元のJSのまま(期待値・アサーションは変えない)。
// - setArtBlocks(page, blocks): ブロック配列を直接セットし、同じevaluate内で
//   _artRenderBlocks()を呼んで即時反映する(2回のevaluateに分けない=セット+再描画の
//   タイミングを保つ)。
// - setArtDraftField(page, key, value): 下書きの単一フィールドに直接代入する
//   (テスト前の状態設定用。②指示により(a)化しない)。
// - waitForArtTextFsEditor(page): 全画面MDEエディタのインスタンスが生成されるまで待つ。
// - setArtTextFsEditorValue(page, markdown): 全画面MDEエディタへ本文を直接セットする。
// - getArtTextFsEditorBoldToolbarHtml(page): 全画面MDEエディタの太字ツールバーのHTMLを返す。
// - buildArtPublicPreviewHtml(page): 現在の下書き(_artDraft)から公開ページ相当のHTMLを
//   生成する(article-pc-pane.spec.jsの本文幅一致検証専用。元のブロックを1つの関数に封じた
//   だけで、_artDraft/_artBuildPreviewStateへの参照箇所自体は変えていない)。
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
    const before = (await getArtBlocks(page)).length;
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
    await expect.poll(async () => (await getArtBlocks(page)).length).toBe(before + 1);
    if (type === 'text' && textMode === 'inline') {
        await expect(canvas(page).locator('.art-cv-ta')).toBeVisible();
    } else {
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        if (type === 'text') await waitForArtTextFsEditor(page);
    }
}

/** @param {import('@playwright/test').Page} page */
export async function flushArtSave(page) {
    await page.evaluate(() => window.bookshelf._artFlushSave());
}

/** @param {import('@playwright/test').Page} page */
export async function flushArtRemoteNow(page) {
    await page.evaluate(() => window.bookshelf._artFlushRemoteNow());
}

/** @param {import('@playwright/test').Page} page */
export async function flushArtSaveAndRemote(page) {
    await page.evaluate(() => window.bookshelf._artFlushSave().then(() => window.bookshelf._artFlushRemoteNow()));
}

/** @param {import('@playwright/test').Page} page */
export async function getArtEditingId(page) {
    return page.evaluate(() => window.bookshelf._artEditingId);
}

/** @param {import('@playwright/test').Page} page */
export function getArtDraft(page) {
    return page.evaluate(() => window.bookshelf._artDraft);
}

/** @param {import('@playwright/test').Page} page */
export async function waitForArtDraft(page) {
    await expect.poll(() => page.evaluate(() => !!window.bookshelf._artDraft)).toBe(true);
}

/** @param {import('@playwright/test').Page} page */
export function getArtBlocks(page) {
    return page.evaluate(() => window.bookshelf._artDraft.blocks || []);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {any[]} blocks
 */
export function setArtBlocks(page, blocks) {
    return page.evaluate((bs) => {
        window.bookshelf._artDraft.blocks = bs;
        window.bookshelf._artRenderBlocks();
    }, blocks);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} key
 * @param {*} value
 */
export function setArtDraftField(page, key, value) {
    return page.evaluate(([k, v]) => { window.bookshelf._artDraft[k] = v; }, [key, value]);
}

/** @param {import('@playwright/test').Page} page */
export async function waitForArtTextFsEditor(page) {
    await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} markdown
 */
export function setArtTextFsEditorValue(page, markdown) {
    return page.evaluate((md) => window.bookshelf._artTextFsEditor.value(md), markdown);
}

/** @param {import('@playwright/test').Page} page */
export function getArtTextFsEditorBoldToolbarHtml(page) {
    return page.evaluate(() => window.bookshelf._artTextFsEditor.toolbarElements.bold.innerHTML);
}

/** @param {import('@playwright/test').Page} page */
export function buildArtPublicPreviewHtml(page) {
    return page.evaluate(async () => {
        const app = window.bookshelf;
        const a = { ...app._artDraft, id: app._artDraft.id || '_p', slug: 'p', publicId: 'p' };
        const r = await app.publishArticleGenerator.build([a], { state: app._artBuildPreviewState() });
        return r.files.find(f => f.path.endsWith('index.html') && f.content.includes('class="article"')).content;
    });
}
