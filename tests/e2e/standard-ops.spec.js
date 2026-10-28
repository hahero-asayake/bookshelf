// 標準操作マトリクス打鍵 (docs/ui-standards.md §1 が正)
// 「閉じたい/戻りたい」の標準操作 (ESC / スマホ戻る=履歴統合 / 枠外クリック) が
// 全モーダル・シートで効くことを担保する。新しい面を作ったらここに行を足す。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    // イシュー#35: 未接続のまま記事を編集させないガードを追加した。この E2E は dirHandle を持たない
    // LocalFS のまま動かすため実際には「未接続」判定になってしまい、#art-new 等が disabled になって
    // 打鍵できなくなる。接続済み相当にモックし (publish-article-editor.spec.js と同じパターン)、
    // 記事ストアの読み書きもメモリ上のマップへ差し替える (実 dirHandle が無いままだと
    // openPublishPagesModal() の load() が本当に失敗し、console.error が漏れて誤検知するため)。
    await page.evaluate(() => {
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        // イシュー#35 (B-1): 長文メモの読込失敗を握り潰さなくしたため、実 dirHandle が無いこの E2E では
        // readText が「LocalFSAdapter: dirHandle not set」で本当に失敗し、テンプレート表示に落ちず
        // エディタが作られなくなる (修正後の正しい挙動)。長文メモを開く既存/新規テストが動くよう
        // readText/writeText もメモリ上のマップへ差し替える。
        adapter.readText = async (path) => (mem.has(path) ? mem.get(path) : null);
        adapter.writeText = async (path, text) => { mem.set(path, text); };
        window.bookshelf._isSyncReady = () => true;
    });
    return errors;
}

// ===== PC: ESC で閉じる =====
test('ESC: 設定・取込モーダルが閉じる (PC)', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf._openSettingsModal());
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
    await page.evaluate(() => window.bookshelf.showImportModal());
    await expect(page.locator('#import-modal')).toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
    expect(errors).toEqual([]);
});

test('ESC/枠外クリック: 衝突ダイアログは「何もしない」で閉じる (破壊選択を既定にしない)', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => { window.bookshelf._conflictNotified = false; window.bookshelf._handleSyncConflict('GitHub'); });
    await expect(page.locator('#sync-conflict-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sync-conflict-dialog')).toBeHidden();
    // 枠外クリック
    await page.evaluate(() => { window.bookshelf._conflictNotified = false; window.bookshelf._handleSyncConflict('GitHub'); });
    await expect(page.locator('#sync-conflict-dialog')).toBeVisible();
    await page.locator('.cfm-overlay').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#sync-conflict-dialog')).toBeHidden();
    expect(errors).toEqual([]);
});

test('枠外クリック/Enter/ESC: confirmDialog の基本作法', async ({ page }) => {
    const errors = await bootApp(page);
    // 枠外 = false
    const p1 = page.evaluate(() => window.confirmDialog({ title: 'T', message: 'M' }));
    await page.locator('.cfm-overlay').click({ position: { x: 5, y: 5 } });
    expect(await p1).toBe(false);
    // Enter = true
    const p2 = page.evaluate(() => window.confirmDialog({ title: 'T', message: 'M' }));
    await page.locator('.cfm-box').waitFor();
    await page.keyboard.press('Enter');
    expect(await p2).toBe(true);
    expect(errors).toEqual([]);
});

// ===== イシュー#268: 見たまま編集の新しい面 (＋追加シート・見た目シート・ブロックの⋯メニュー・本棚/本の全画面) =====
// ESC/枠外クリックで「その面だけ」閉じ、記事エディタ (#publish-pages-modal) は残る。全画面の ESC は「完了」(②決裁)。
async function openEditorInEditMode(page) {
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await page.fill('#art-title', '標準操作268');
    await page.click('#art-mode-edit');
    await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().waitFor();
}

// 構成A (イシュー#276): 600px以下は見た目/公開ボタンがヘッダーでなく下部バー (#art-bar-look/#art-bar-publish)
// にある。このファイルは390x844固定 (標準操作マトリクス) のため常に下部バー側だが、
// ヘッダー側が見えていればそちらを優先するフォールバックにして viewport 非依存にしておく。
async function clickLookBtn(page) {
    const headerBtn = page.locator('#art-look-btn');
    if (await headerBtn.isVisible()) await headerBtn.click();
    else await page.click('#art-bar-look');
}
async function clickPublishHeader(page) {
    const headerBtn = page.locator('#art-publish-header');
    if (await headerBtn.isVisible()) await headerBtn.click();
    else await page.click('#art-bar-publish');
}

test('ESC/枠外クリック: ＋追加シートは自分だけ閉じ、エディタは残る (イシュー#268)', async ({ page }) => {
    const errors = await bootApp(page);
    await openEditorInEditMode(page);
    const frame = page.frameLocator('#art-canvas-frame');
    await frame.locator('.art-cv-ins-btn').last().click();
    await expect(page.locator('#art-add-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#art-add-sheet')).toBeHidden();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await frame.locator('.art-cv-ins-btn').last().click();
    await expect(page.locator('#art-add-sheet')).toBeVisible();
    await page.locator('#art-add-sheet .art-add-sheet-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#art-add-sheet')).toBeHidden();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    expect(errors).toEqual([]);
});

test('ESC/枠外クリック: 見た目シートは自分だけ閉じ、エディタは残る (イシュー#268)', async ({ page }) => {
    const errors = await bootApp(page);
    await openEditorInEditMode(page);
    await page.click('#art-look-btn');
    await expect(page.locator('#art-look-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#art-look-sheet')).toBeHidden();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await page.click('#art-look-btn');
    await page.locator('#art-look-sheet .art-add-sheet-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#art-look-sheet')).toBeHidden();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    expect(errors).toEqual([]);
});

test('ESC/枠外クリック: ブロックの⋯メニューは自分だけ閉じ、全画面はESCで完了扱い (イシュー#268)', async ({ page }) => {
    const errors = await bootApp(page);
    await openEditorInEditMode(page);
    const frame = page.frameLocator('#art-canvas-frame');
    await frame.locator('.art-cv-ins-btn').last().click();
    await page.click('#art-add-sheet [data-block-type="shelf"]');
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
    await page.keyboard.press('Escape'); // 全画面の ESC = 完了 (ブロックは残る)
    await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    expect(await page.evaluate(() => window.bookshelf._artDraft.blocks.length)).toBe(1);
    await frame.locator('.art-cv-more').first().click();
    await expect(page.locator('#art-blk-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#art-blk-menu')).toBeHidden();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await frame.locator('.art-cv-more').first().click();
    await expect(page.locator('#art-blk-menu')).toBeVisible();
    await page.locator('#art-edit-view .art-hd').click({ position: { x: 2, y: 2 } }); // 枠外 (メニューの外) をクリック
    await expect(page.locator('#art-blk-menu')).toBeHidden();
    expect(errors).toEqual([]);
});

// ===== スマホ: 戻る = 閉じてアプリに留まる (履歴統合) =====
test('ESC/枠外クリック: 記事エディタの ⋯ メニューと公開パネルは自分だけ閉じ、エディタは残る (イシュー#230)', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await page.fill('#art-title', '標準操作');
    await page.evaluate(() => window.bookshelf._artFlushSave());
    await page.click('#art-more-btn');
    await expect(page.locator('#art-more-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#art-more-menu')).toBeHidden();
    await page.click('#art-more-btn');
    await page.mouse.click(640, 5);
    await expect(page.locator('#art-more-menu')).toBeHidden();
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    // イシュー#268: 公開はヘッダーの編集状態に出る
    await page.click('#art-mode-edit');
    await page.click('#art-publish-header');
    await expect(page.locator('#art-publish-modal')).toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#art-publish-modal')).not.toHaveClass(/show/);
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    await page.click('#art-publish-header');
    await page.mouse.click(5, 5);
    await expect(page.locator('#art-publish-modal')).not.toHaveClass(/show/);
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
    expect(errors).toEqual([]);
});

test.describe('スマホ戻る (履歴統合)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('設定モーダル: 戻るで閉じてアプリに留まる', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf._openSettingsModal());
        await expect(page.locator('#settings-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#settings-modal')).not.toHaveClass(/show/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    test('取込モーダル: 戻るで閉じてアプリに留まる (2026-07-27 統合・再発防止)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.showImportModal());
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
        expect(page.url()).toContain('index.html');   // about:blank へ離脱しない
        expect(errors).toEqual([]);
    });

    test('取込モーダル: × で閉じても履歴が汚れない (直後の戻るでアプリ離脱しない)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
        await page.evaluate(() => window.bookshelf.showImportModal());
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await page.locator('#import-modal-close').click();
        await expect(page.locator('#import-modal')).not.toHaveClass(/show/);
        await page.waitForTimeout(200);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    test('除外一覧モーダル: 戻るで閉じてアプリに留まる (C-281)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.showExclusionsModal());
        await expect(page.locator('#exclusions-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#exclusions-modal')).not.toHaveClass(/show/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    test('設定→除外一覧: 戻るは除外一覧だけ閉じ、設定は残る (C-281)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf._openSettingsModal('library-section'));
        await expect(page.locator('#settings-modal')).toHaveClass(/show/);
        await page.evaluate(() => window.bookshelf.showExclusionsModal());
        await expect(page.locator('#exclusions-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#exclusions-modal')).not.toHaveClass(/show/);
        await expect(page.locator('#settings-modal')).toHaveClass(/show/);
        expect(errors).toEqual([]);
    });

    test('手動追加モーダル: 戻るで閉じる・×で閉じても履歴が汚れない (C-281)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.showAddBookModal());
        await expect(page.locator('#add-book-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#add-book-modal')).not.toHaveClass(/show/);
        expect(page.url()).toContain('index.html');
        // × で閉じたときは自前で積んだ履歴を掃除する (直後の戻るでアプリ離脱しない)
        await page.evaluate(() => window.bookshelf.showAddBookModal());
        await page.locator('#add-book-modal-close').click();
        await expect(page.locator('#add-book-modal')).not.toHaveClass(/show/);
        await page.waitForTimeout(200);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    test('本詳細シート: 戻るで閉じてアプリに留まる', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
        await page.locator('#bookshelf .book-item').first().click();
        await expect(page.locator('body')).toHaveClass(/book-detail-pinned/);
        await page.goBack();
        await expect(page.locator('body')).not.toHaveClass(/book-detail-pinned/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    // ===== C-281 全面棚卸しで統合した面 =====

    test('公開管理モーダル: 戻るで閉じてアプリに留まる (C-281)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#publish-pages-modal')).not.toHaveClass(/show/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    // イシュー#268: 見たまま編集の新しい面も戻る=その面だけ閉じる (全画面は「完了」扱い)
    test('記事エディタ: ＋追加シート・見た目シート・⋯メニューは戻るでその面だけ閉じ、エディタは残る (イシュー#268)', async ({ page }) => {
        const errors = await bootApp(page);
        await openEditorInEditMode(page);
        const frame = page.frameLocator('#art-canvas-frame');
        await frame.locator('.art-cv-ins-btn').last().click();
        await expect(page.locator('#art-add-sheet')).toBeVisible();
        await page.goBack();
        await expect(page.locator('#art-add-sheet')).toBeHidden();
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        await clickLookBtn(page);
        await expect(page.locator('#art-look-sheet')).toBeVisible();
        await page.goBack();
        await expect(page.locator('#art-look-sheet')).toBeHidden();
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        // ⋯メニュー (ブロックを1つ作ってから)。イシュー#276: 文章も挿入直後は全画面(EasyMDE)に入るため、
        // 戻る(=完了)で編集状態へ戻してからキャンバスの⋯を操作する
        await frame.locator('.art-cv-ins-btn').last().click();
        await page.click('#art-add-sheet [data-block-type="text"]');
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        await page.goBack();
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
        await frame.locator('.art-cv-more').first().click();
        await expect(page.locator('#art-blk-menu')).toBeVisible();
        await page.goBack();
        await expect(page.locator('#art-blk-menu')).toBeHidden();
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    test('記事エディタ: 本棚の全画面は戻るで「完了」扱いになり、エディタは残る (＋シート経由・⋯編集経由とも, イシュー#268)', async ({ page }) => {
        const errors = await bootApp(page);
        await openEditorInEditMode(page);
        const frame = page.frameLocator('#art-canvas-frame');
        await frame.locator('.art-cv-ins-btn').last().click();
        await page.click('#art-add-sheet [data-block-type="shelf"]');
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        await page.goBack();
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        expect(await page.evaluate(() => window.bookshelf._artDraft.blocks.length)).toBe(1);
        // ⋯→編集 で開き直し、戻るで閉じる。公開記事モーダルはまだ残る (段飛ばししない・イシュー#279)
        await frame.locator('.art-cv-more').first().click();
        await page.click('#art-blk-menu [data-blk-act="edit"]');
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        await page.goBack();
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    // イシュー#279 (②承認4段構造): 編集→閲覧→一覧→エディタを閉じる、の4段を1回のgoBackで1段だけ
    // 閉じる。編集中のブロック追加は、一覧へ戻る前に保存される。
    test('記事エディタ: 戻るは編集→閲覧→一覧→エディタを閉じる、の順に1段ずつ (イシュー#279)', async ({ page }) => {
        const errors = await bootApp(page);
        await openEditorInEditMode(page);
        const frame = page.frameLocator('#art-canvas-frame');
        await frame.locator('.art-cv-ins-btn').last().click();
        await page.click('#art-add-sheet [data-block-type="text"]');
        await page.goBack(); // 文章ブロック全画面→完了→edit
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);

        // 1段目: edit→view (完了扱いで保存)
        await page.goBack();
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'view');
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        await expect(page.locator('#art-list-view')).toBeHidden();
        expect(await page.evaluate(() => window.bookshelf._artDraft.blocks.length)).toBe(1); // 保存済み

        // 2段目: view→一覧 (エディタは残る)
        await page.goBack();
        await expect(page.locator('#art-list-view')).toBeVisible();
        await expect(page.locator('#art-edit-view')).toBeHidden();
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        await expect(page.locator('#art-list .pp-row')).toHaveCount(1); // 一覧に保存済みの記事が反映

        // 3段目: 一覧→エディタごと閉じ、元の画面(アプリ本体)に戻る
        await page.goBack();
        await expect(page.locator('#publish-pages-modal')).not.toHaveClass(/show/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    // イシュー#276 step3: 文章ブロックも本棚・本と同じ全画面 (EasyMDE) に入るため、戻る/ESCとも「完了」扱いになる。
    test('記事エディタ: 文章ブロックの全画面 (EasyMDE) も戻る/ESCで「完了」扱いになり、エディタは残る (イシュー#276)', async ({ page }) => {
        const errors = await bootApp(page);
        await openEditorInEditMode(page);
        const frame = page.frameLocator('#art-canvas-frame');
        await frame.locator('.art-cv-ins-btn').last().click();
        await page.click('#art-add-sheet [data-block-type="text"]');
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        await expect(page.locator('#art-fs-title')).toHaveText('文章を編集');
        await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
        await page.evaluate(() => { window.bookshelf._artTextFsEditor.value('ESCテスト本文'); });
        await page.keyboard.press('Escape');
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
        expect(await page.evaluate(() => window.bookshelf._artDraft.blocks[0].markdown)).toBe('ESCテスト本文');
        // もう一度開いて今度は戻る (物理バック) で確認
        await frame.locator('.art-cv-more').first().click();
        await page.click('#art-blk-menu [data-blk-act="edit"]');
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
        await page.goBack();
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        expect(errors).toEqual([]);
    });

    // イシュー#276 step1(C)・step3: 本棚・本・文章いずれの全画面でも「キャンセル」で変更があれば確認が出て、
    // その確認ダイアログ自体はESC/枠外クリックで「編集を続ける」(=閉じない) 扱いになる (confirmDialog既定動作)。
    test('記事エディタ: 全画面キャンセルの確認ダイアログはESC/枠外クリックで「編集を続ける」になる (イシュー#276)', async ({ page }) => {
        const errors = await bootApp(page);
        await openEditorInEditMode(page);
        const frame = page.frameLocator('#art-canvas-frame');
        await frame.locator('.art-cv-ins-btn').last().click();
        await page.click('#art-add-sheet [data-block-type="shelf"]');
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        // 本を1冊追加 (変更あり状態を作る)
        await page.evaluate(() => window.bookshelf._artOpenSheet && window.bookshelf._artOpenSheet());
        await page.locator('#art-drawer-list .art-drawer-item').first().click();
        await page.evaluate(() => window.bookshelf._artCloseSheet && window.bookshelf._artCloseSheet());
        await page.click('#art-fs-cancel');
        await expect(page.locator('.cfm-overlay')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.cfm-overlay')).toHaveCount(0);
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form'); // 閉じていない
        await page.click('#art-fs-cancel');
        await expect(page.locator('.cfm-overlay')).toBeVisible();
        await page.locator('.cfm-overlay').click({ position: { x: 5, y: 5 } }); // 枠外クリック
        await expect(page.locator('.cfm-overlay')).toHaveCount(0);
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        expect(errors).toEqual([]);
    });

    test('公開管理→公開パネル: 戻るはパネルだけ閉じ、公開管理は残る (イシュー#230)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.click('#art-mode-edit'); // イシュー#268: 公開は編集状態のヘッダー (構成A・600px以下は下部バー)
        await clickPublishHeader(page);
        await expect(page.locator('#art-publish-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#art-publish-modal')).not.toHaveClass(/show/);
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        expect(errors).toEqual([]);
    });

    test('公開管理→プレビュー: 戻るはプレビューだけ閉じ、公開管理は残る (C-281)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        // プレビューはブロックが1つ以上ないと警告のみで開かない (公開v2 S3) ため、文章ブロックを1つ追加する
        // イシュー#268: 追加は編集状態のキャンバスの＋→シート、プレビューは記事メニュー⋯「表示幅を切り替えて見る」
        await page.fill('#art-title', '戻る確認');
        await page.click('#art-mode-edit');
        await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().click();
        await page.click('#art-add-sheet [data-block-type="text"]');
        // イシュー#276: 文章も挿入直後は全画面(EasyMDE)に入るため、完了で編集状態へ戻してから操作する
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        await page.click('#art-fs-done');
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'edit');
        await page.evaluate(() => window.bookshelf._artFlushSave());
        await page.click('#art-more-btn');
        await page.click('#art-width-preview');
        await expect(page.locator('#pp-preview-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#pp-preview-modal')).not.toHaveClass(/show/);
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        expect(errors).toEqual([]);
    });

    test('本棚管理→フォーム: 戻るはフォーム→管理→閉の順に1段ずつ (C-281)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.showBookshelfManager());
        await expect(page.locator('#bookshelf-modal')).toHaveClass(/show/);
        await page.click('#add-bookshelf');
        await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#bookshelf-form-modal')).not.toHaveClass(/show/);
        await expect(page.locator('#bookshelf-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#bookshelf-modal')).not.toHaveClass(/show/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    test('コマンドパレット: 戻るで閉じてアプリに留まる (C-281)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf._openPalette());
        await expect(page.locator('#command-palette')).toBeVisible();
        await page.goBack();
        await expect(page.locator('#command-palette')).toBeHidden();
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    test('ドロワー: 戻るで閉じてアプリに留まる (C-281)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf._openDrawer());
        await expect(page.locator('body')).toHaveClass(/drawer-open/);
        await page.goBack();
        await expect(page.locator('body')).not.toHaveClass(/drawer-open/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    test('プラグイン設定モーダル: 戻るで閉じてアプリに留まる (C-281)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf._openPluginSettings('dark-theme'));
        await expect(page.locator('#plugin-settings-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#plugin-settings-modal')).not.toHaveClass(/show/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    // イシュー#282 (②決裁B): 長文メモの外枠を文章ブロック等と同じ型に統一したのに合わせ、閉じ方の
    // 規則も揃えた。戻る/Escは「完了」扱い(保存して閉じる・確認なし)、キャンセル(ボタン)だけが
    // 変更があれば確認を出す (旧C-281の「戻る=未保存確認」は撤廃。記事エディタの art-fs-done と
    // 同じ規則・この表現の元ネタは standard-ops.spec.js:382「文章ブロックの全画面も戻る/ESCで
    // 『完了』扱い」と同型)。保存の永続化は readText/写writeText のメモリMap (bootApp) 経由で
    // 再オープンして確かめる。
    test('長文メモ: 戻る/Escは完了扱い(保存して閉じる・確認なし)、キャンセルのみ破棄確認 (イシュー#282・旧C-281置き換え)', async ({ page }) => {
        const errors = await bootApp(page);
        const openMemo = () => page.evaluate(() => {
            const b = window.bookshelf.books[0];
            return window.bookshelf._openBookMemoInAppEditor(b.asin, b);
        });
        const waitEditor = () => page.waitForFunction(() => !!window.bookshelf._bookMemoEditor);
        const memoValue = () => page.evaluate(() => window.bookshelf._bookMemoEditor.value());

        await openMemo();
        await expect(page.locator('#book-memo-modal')).toHaveClass(/show/);
        await waitEditor();
        // 変更なし → 戻るで閉じる (確認なし)
        await page.goBack();
        await expect(page.locator('#book-memo-modal')).not.toHaveClass(/show/);

        // 変更あり → 戻る → 確認は出ず、保存して閉じる (新規則)
        await openMemo();
        await waitEditor();
        await page.evaluate(() => window.bookshelf._bookMemoEditor.value('戻るテスト本文'));
        await page.goBack();
        await expect(page.locator('.cfm-box')).toHaveCount(0);
        await expect(page.locator('#book-memo-modal')).not.toHaveClass(/show/);
        // 永続化確認: 開き直すと保存された内容が読み込める
        await openMemo();
        await waitEditor();
        expect(await memoValue()).toBe('戻るテスト本文');

        // 変更あり → Esc → 同じく確認は出ず、保存して閉じる
        await page.evaluate(() => window.bookshelf._bookMemoEditor.value('Escテスト本文'));
        await page.keyboard.press('Escape');
        await expect(page.locator('.cfm-box')).toHaveCount(0);
        await expect(page.locator('#book-memo-modal')).not.toHaveClass(/show/);
        await openMemo();
        await waitEditor();
        expect(await memoValue()).toBe('Escテスト本文');

        // キャンセル(ボタン)は変更があれば確認。「編集を続ける」なら閉じず変更も残る
        await page.evaluate(() => window.bookshelf._bookMemoEditor.value('キャンセルテスト本文'));
        await page.click('#book-memo-fs-cancel');
        await expect(page.locator('.cfm-box')).toBeVisible();
        await page.locator('.cfm-cancel').click(); // 編集を続ける
        await expect(page.locator('#book-memo-modal')).toHaveClass(/show/);
        expect(await memoValue()).toBe('キャンセルテスト本文');
        // 「変更を破棄」なら保存せず閉じる (直前の保存=Escテスト本文のまま残るはず)
        await page.click('#book-memo-fs-cancel');
        await expect(page.locator('.cfm-box')).toBeVisible();
        await page.locator('.cfm-ok').click(); // 変更を破棄
        await expect(page.locator('#book-memo-modal')).not.toHaveClass(/show/);
        await openMemo();
        await waitEditor();
        expect(await memoValue()).toBe('Escテスト本文');

        expect(errors.filter(e => !/easymde|fontawesome|cdn|net::ERR/i.test(e))).toEqual([]);
    });
});

// ===== 重なり管理役 (イシュー#367 step2): 小段階の面は data-layer (開いた順) と CSS の帯で重なり、決め打ち z-index を持たない =====
test('重なり管理役: アイコンピッカー (面の帯 1000+n) の上に confirmDialog (ダイアログ帯 1800+n) が積まれ、閉じると data-layer が外れる (PC)', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => { window.__pick = window.bookshelf.openIconPicker({ title: 'テスト' }); });
    const picker = page.locator('#icon-picker-modal');
    await expect(picker).toHaveClass(/show/);
    await expect(picker).toHaveAttribute('data-layer', '0');
    expect(Number(await picker.evaluate((el) => getComputedStyle(el).zIndex))).toBe(1000); // 帯 1000+0 (旧 99999 !important ではない)
    await expect(picker.locator('.modal-content')).toHaveClass(/ov-md/); // ②決裁 2026-10-26: ピッカーは中
    await page.evaluate(() => { window.__cfm = window.confirmDialog({ title: '確認', message: 'テスト' }); });
    const cfm = page.locator('.cfm-overlay');
    await expect(cfm).toHaveAttribute('data-layer', '1');
    expect(Number(await cfm.evaluate((el) => getComputedStyle(el).zIndex))).toBe(1801);
    await expect(cfm.locator('.cfm-box')).toHaveClass(/ov-sm/);
    expect(await page.evaluate(() => window.overlays.stackInfo().map((f) => f.kind))).toEqual(['modal', 'dialog']);
    // 最前面は confirm (アイコンピッカーの中心点で elementFromPoint が .cfm-overlay 配下)
    expect(await page.evaluate(() => {
        const r = document.querySelector('#icon-picker-modal .modal-content').getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!(top && top.closest('.cfm-overlay'));
    })).toBe(true);
    await page.keyboard.press('Escape'); // confirm = cancel (下の面は残す)
    await expect(cfm).toHaveCount(0);
    expect(await page.evaluate(() => window.__cfm)).toBe(false);
    await expect(picker).toHaveClass(/show/);
    await expect(picker).toHaveAttribute('data-layer', '0');
    await page.keyboard.press('Escape'); // ピッカー = キャンセル (共通 ESC → ×)
    await expect(picker).not.toHaveClass(/show/);
    await expect(picker).not.toHaveAttribute('data-layer');
    expect(await page.evaluate(() => window.__pick)).toBeNull();
    expect(await page.evaluate(() => window.overlays.stackInfo())).toEqual([]);
    expect(errors).toEqual([]);
});
