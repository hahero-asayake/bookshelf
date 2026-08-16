// 標準操作マトリクス打鍵 (docs/ui-standards.md §1 が正)
// 「閉じたい/戻りたい」の標準操作 (ESC / スマホ戻る=履歴統合 / 枠外クリック) が
// 全モーダル・シートで効くことを担保する。新しい面を作ったらここに行を足す。
import { test, expect } from '@playwright/test';
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
    await page.goto('/index.html');
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

// ===== スマホ: 戻る = 閉じてアプリに留まる (履歴統合) =====
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

    test('公開管理→プレビュー: 戻るはプレビューだけ閉じ、公開管理は残る (C-281)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        // プレビューはブロックが1つ以上ないと警告のみで開かない (公開v2 S3) ため、文章ブロックを1つ追加する
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        await page.click('#art-preview');
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

    test('長文メモ: 変更なしは戻るで閉じる・未保存変更は確認→キャンセルで残り履歴も積み直る (C-281)', async ({ page }) => {
        const errors = await bootApp(page);
        const openMemo = () => page.evaluate(() => {
            const b = window.bookshelf.books[0];
            return window.bookshelf._openBookMemoInAppEditor(b.asin, b);
        });
        await openMemo();
        await expect(page.locator('#book-memo-modal')).toHaveClass(/show/);
        await page.waitForFunction(() => !!window.bookshelf._bookMemoEditor);
        // 変更なし → 戻るで閉じる
        await page.goBack();
        await expect(page.locator('#book-memo-modal')).not.toHaveClass(/show/);
        // 変更あり → 戻る → 破棄確認 → キャンセル → モーダルは残り、履歴も積み直される
        await openMemo();
        await page.waitForFunction(() => !!window.bookshelf._bookMemoEditor);
        await page.evaluate(() => window.bookshelf._bookMemoEditor.value('未保存の変更テスト'));
        await page.goBack();
        await expect(page.locator('.cfm-box')).toBeVisible();
        await page.locator('.cfm-cancel').click();
        await expect(page.locator('#book-memo-modal')).toHaveClass(/show/);
        // もう一度戻ると再び確認が出る (= 履歴の積み直しが効いている)。破棄して閉じる
        await page.goBack();
        await expect(page.locator('.cfm-box')).toBeVisible();
        await page.locator('.cfm-ok').click();
        await expect(page.locator('#book-memo-modal')).not.toHaveClass(/show/);
        expect(errors.filter(e => !/easymde|fontawesome|cdn|net::ERR/i.test(e))).toEqual([]);
    });
});
