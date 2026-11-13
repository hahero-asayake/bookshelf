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
//
// 以下はU9 G3-3(イシュー#553)で追加。シート/プレビュー/公開操作系`_artOpenSheet`以下
// 16名54件(docs/char/u9-g3-3-plan.md)の(c)集約先(このコメントブロックは(c)分のみ。
// (a)化分=`_artOpenSheet`/`_artCloseSheet`/`_artOpenPublishPanel`/`_artEditBlock`
// の1件/`_artOpenEditor`はstep3で別途追加)。
// - setArtPreviewStallMs(page, ms) / setArtPreviewHardDeadlineMs(page, ms): bookshelf.js
//   70,78行のコメントで明記済みの意図的なテスト注入点を集約。元のテストは同じevaluate内で
//   他のモック(build/readBookMemo差し替え等)も設定しているが、いずれも非同期の連結(.then()
//   チェーンや直後のタイマー発火)を持たない独立した同期代入のため、代入部分だけをこの関数に
//   切り出しても元のタイミングは変わらない(G1/G3-2の「分割禁止」は.then()連結等が対象で、
//   本件はそれに該当しない)。
// - openArtPreview(page): critical-path/preview-real-adapter/publish-article-editor/
//   publish-panel/smoke/username-publish-gate.spec.jsの6ファイルに同一実装がコピペされて
//   いた`openPreview()`をそのまま移設(addBlock/canvasが#372でコピペされていたのと同じ構図)。
//   ロジックは変更していない(#art-more-btnが見える時は実クリック、見えない時だけ内部呼び出し
//   にフォールバック)。各ファイル内の`leaveForm()`は_art*参照を持たない(lint対象外)ため
//   依存させず、同等の1行をこの関数内に複製した。
// - runArtRenderList(page) / runArtRenderPublishPanel(page): 状態変更後に即時再描画させる
//   内部呼び出し(article-editor.js:413,3177)。公開窓口なし。
// - showArtList(page): `_artShowList()`。テストの前提構築(記事作成後に一覧へ戻す後始末)のみ。
// - spyOnArtPublish(page) / wasArtPublishCalled(page): `_artPublish`を一時的に差し替えて
//   呼び出し記録を取るスパイ実装(publish-article-editor.spec.js、`_artPublishCalled`と
//   同一箇所)。公開操作の再現ではないため(c)。
// - unpublishArticleTwice(page, id) / deleteArticleTwice(page, id): 記事単位in-flightガード
//   (`_artRunExclusive`)の検証用。`Promise.all`で同時に2回呼び、2回目が無視されることを
//   確認する決定性テスト(publish-conflict-hub.spec.js)。実クリックの二度押しは正確な同時
//   実行を保証できずフレークになるため(c)のまま集約する。
// - editArtBlockForSetup(page, blockId): `_artEditBlock(blockId)`をテストの前提構築
//   (全画面編集に入って#art-blocksを見えるようにするだけ)として使う箇所専用(c)。ブロックの
//   「⋯」メニュー→「編集」の実クリックで到達できる箇所は(a)化してstep3の別関数へ分ける。
//
// 以下はU9 G3-3(イシュー#553)step3で追加。(a)化分の実クリック集約先。
// - openArtEditor(page, id): `_artOpenEditor(id)`。id===nullは`#art-new`クリック(新規作成)、
//   id有りは一覧行の`[data-act="edit"]`クリック。
// - editArtBlockViaMenu(page, blockIdx): ブロックの「⋯」(`.art-cv-more[data-blk-idx]`、
//   キャンバスiframe内)→メニューの「編集」(`#art-blk-menu [data-blk-act="edit"]`)を実クリック。
//
// `_artOpenSheet`/`_artCloseSheet`は一度(a)化を撤回したが、②指摘(2026-11-13差し戻し)で原因を
// 特定し再実装した。原因：イシュー#529(A-c)により、900px以下で本棚ブロックを追加すると
// `_artEditBlock`→`_artOpenSheet()`が自動発火し、引き出しは「完了」を押すまで開いたまま
// (article-editor.js:295-301)。このため`addBlock(page,'shelf',...)`直後は既に`#art-drawer`が
// `is-open`で、スクリム(`#art-sheet-scrim`)がキャンバスiframe内の`.art-shelf-add`を覆い、
// クリックが60秒タイムアウトする。実装時に成功していたように見えた箇所は、呼び出し元の
// テストがワイド viewport(デフォルト900px超)だったため`sheetOpen`ガードで実クリック自体が
// スキップされていたに過ぎない(本当の narrow 経路は未検証だった)。
// - openArtSheet(page) / closeArtSheet(page): `#art-drawer.is-open`を先に確認し、既に開いて
//   いれば(900px以下で#529が既に開いている場合)何もしない。開いていない場合のみ、900px以下
//   で`.art-shelf-add`をクリックする(900px超は元々シートを開かないため何もしない)。
//   `_artCloseSheet()`自身が「開いていなければno-op」であることに合わせ、closeArtSheetも
//   `is-open`の時だけ`#art-sheet-close`をクリックする。
// - openArtSheetInternal(page) / closeArtSheetInternal(page): ブロックが1つも無い状態で
//   シートだけを開閉するテスト(back-nav-matrix.spec.js A40)専用の(c)。ブロック単位の
//   ボタン(`.art-shelf-add`/`.art-book-pick`)がDOMに存在しないため実クリック導線が無い。
// - openArtPublishPanelReopen(page): `_artOpenPublishPanel()`の再オープン専用(c)。
//   パネルが既に開いた状態(`publishViaPanel`後は開いたまま)では`#art-publish-header`が
//   `#art-publish-modal`に覆われクリックできないため、再描画のみの内部呼び出しに留める。
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

/** @param {import('@playwright/test').Page} page @param {number} ms */
export function setArtPreviewStallMs(page, ms) {
    return page.evaluate((v) => { window.bookshelf._artPreviewStallMs = v; }, ms);
}

/** @param {import('@playwright/test').Page} page @param {number} ms */
export function setArtPreviewHardDeadlineMs(page, ms) {
    return page.evaluate((v) => { window.bookshelf._artPreviewHardDeadlineMs = v; }, ms);
}

/** プレビューは記事メニュー ⋯ →「表示幅を切り替えて見る」(#art-more-btnが無い幅では内部呼び出し)
 * @param {import('@playwright/test').Page} page */
export async function openArtPreview(page) {
    const done = page.locator('#art-fs-done');
    if (await done.isVisible()) await done.click();
    if (!(await page.locator('#art-more-btn').isVisible())) { await page.evaluate(() => { window.bookshelf._artPreview(); }); return; }
    await page.click('#art-more-btn');
    await page.click('#art-width-preview');
}

/** @param {import('@playwright/test').Page} page */
export function runArtRenderList(page) {
    return page.evaluate(() => window.bookshelf._artRenderList());
}

/** @param {import('@playwright/test').Page} page */
export function runArtRenderPublishPanel(page) {
    return page.evaluate(() => window.bookshelf._artRenderPublishPanel());
}

/** @param {import('@playwright/test').Page} page */
export function showArtList(page) {
    return page.evaluate(() => window.bookshelf._artShowList());
}

/** `_artPublish`を一時差し替えて呼び出し記録を取るスパイ(公開操作の再現ではない)
 * @param {import('@playwright/test').Page} page */
export function spyOnArtPublish(page) {
    return page.evaluate(() => {
        const orig = window.bookshelf._artPublish.bind(window.bookshelf);
        window.bookshelf._artPublishCalled = false;
        window.bookshelf._artPublish = async (...args) => { window.bookshelf._artPublishCalled = true; return orig(...args); };
    });
}

/** @param {import('@playwright/test').Page} page */
export function wasArtPublishCalled(page) {
    return page.evaluate(() => window.bookshelf._artPublishCalled);
}

/** 記事単位in-flightガードの検証用: 同時に2回呼び、2回目が無視されることを確認する
 * @param {import('@playwright/test').Page} page @param {string} id */
export function unpublishArticleTwice(page, id) {
    return page.evaluate((id) => Promise.all([
        window.bookshelf._artUnpublish(id),
        window.bookshelf._artUnpublish(id)
    ]), id);
}

/** @param {import('@playwright/test').Page} page @param {string} id */
export function deleteArticleTwice(page, id) {
    return page.evaluate((id) => Promise.all([
        window.bookshelf._artDelete(id),
        window.bookshelf._artDelete(id)
    ]), id);
}

/** テストの前提構築専用(全画面編集に入って#art-blocksを見えるようにするだけ)。
 * 実クリック導線がある箇所はstep3の別関数(editArtBlockViaMenu)を使う。
 * @param {import('@playwright/test').Page} page @param {string} blockId */
export function editArtBlockForSetup(page, blockId) {
    return page.evaluate((id) => window.bookshelf._artEditBlock(id), blockId);
}

/** 記事エディタを開く。id===nullは新規作成(#art-new)、idありは一覧行の編集ボタン。
 * @param {import('@playwright/test').Page} page @param {string|null} id */
export async function openArtEditor(page, id) {
    if (id === null) { await page.click('#art-new'); return; }
    await page.locator(`#art-list [data-id="${id}"] [data-act="edit"]`).click();
}

/** ブロックの「⋯」メニュー→「編集」を実クリックして全画面編集へ入る。
 * @param {import('@playwright/test').Page} page @param {number} blockIdx */
export async function editArtBlockViaMenu(page, blockIdx) {
    await canvas(page).locator(`.art-cv-more[data-blk-idx="${blockIdx}"]`).click();
    await page.locator('#art-blk-menu [data-blk-act="edit"]').click();
}

/** 本の引き出しを開く。既に開いている場合(イシュー#529・本棚ブロック追加直後は「完了」まで
 * 開いたまま)は何もしない。開いていない場合のみ、900px以下で`.art-shelf-add`をクリックする
 * (900px超は元々シートを開かず常駐パネルの畳み解除のみを行うため何もしない)。
 * @param {import('@playwright/test').Page} page */
export async function openArtSheet(page) {
    const isOpen = await page.evaluate(() => !!document.getElementById('art-drawer')?.classList.contains('is-open'));
    if (isOpen) return;
    if (!(await page.evaluate(() => window.matchMedia('(max-width: 900px)').matches))) return;
    await canvas(page).locator('.art-shelf-add').last().click();
}

/** 本の引き出しを閉じる。開いている時だけ`#art-sheet-close`をクリックする
 * (`_artCloseSheet()`自身が「開いていなければno-op」なのと同じ挙動)。
 * @param {import('@playwright/test').Page} page */
export async function closeArtSheet(page) {
    const isOpen = await page.evaluate(() => !!document.getElementById('art-drawer')?.classList.contains('is-open'));
    if (!isOpen) return;
    await page.click('#art-sheet-close');
}

/** ブロックが1つも無い状態でシートだけを開閉するテスト専用(c)。ブロック単位のボタン
 * (`.art-shelf-add`/`.art-book-pick`)が無く実クリック導線が存在しないため内部呼び出しのまま。
 * @param {import('@playwright/test').Page} page */
export function openArtSheetInternal(page) {
    return page.evaluate(() => window.bookshelf._artOpenSheet && window.bookshelf._artOpenSheet());
}

/** @param {import('@playwright/test').Page} page */
export function closeArtSheetInternal(page) {
    return page.evaluate(() => window.bookshelf._artCloseSheet && window.bookshelf._artCloseSheet());
}

/** `_artOpenPublishPanel()`の再オープン専用(c)。パネルが既に開いた状態では`#art-publish-header`
 * が`#art-publish-modal`に覆われクリックできないため、再描画のみの内部呼び出しに留める。
 * @param {import('@playwright/test').Page} page */
export function openArtPublishPanelReopen(page) {
    return page.evaluate(() => window.bookshelf._artOpenPublishPanel());
}

/** 複数記事をpersist:falseで作成し、同じevaluate内で`_artRenderList()`を呼んで一覧へ即時反映する
 * (作成→再描画の連結を保つ=2回のevaluateに分けない)。
 * @param {import('@playwright/test').Page} page @param {object[]} articles */
export function createArticlesAndRenderList(page, articles) {
    return page.evaluate(async (arts) => {
        const store = window.bookshelf.publishArticleStore;
        for (const a of arts) await store.create(a, { persist: false });
        window.bookshelf._artRenderList();
    }, articles);
}
