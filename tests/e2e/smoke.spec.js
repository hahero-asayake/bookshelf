// スモークテスト: 起動・基本操作のリグレッション網
// フィクスチャを localStorage に注入して起動する (同期フォルダ不要の localStorage フォールバック経路)。
// ⚠️ 大量冊数の描画テストは書かない (ヘッドレス + content-visibility の制約、COMMON 参照)
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

/** フィクスチャ注入 + console error 収集付きで起動し、app 初期化を待つ */
async function bootApp(page) {
    const errors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    // 実データ書込防止 (フィクスチャ起動なので同期先は無いが念のため)
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

test('起動してホーム (ダッシュボード) が描画される', async ({ page }) => {
    const errors = await bootApp(page);
    await expect(page.locator('#dashboard .dashboard-widget').first()).toBeVisible();
    expect(await page.evaluate(() => window.bookshelf.books.length)).toBe(5);
    expect(errors).toEqual([]);
});

test('本棚へ切替 → フィクスチャの本が描画される', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(3);
    await expect(page.locator('#current-bookshelf-title')).toHaveText('テスト本棚');
    expect(errors).toEqual([]);
});

test('⌘K が開いて本棚名で検索 → 遷移', async ({ page }) => {
    const errors = await bootApp(page);
    await page.keyboard.press('Control+k');
    await expect(page.locator('#command-palette')).toBeVisible();
    await page.locator('#cmdk-input').fill('テスト本棚');
    const item = page.locator('#cmdk-results .cmdk-item', { hasText: 'テスト本棚' }).first();
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.locator('#current-bookshelf-title')).toHaveText('テスト本棚');
    expect(errors).toEqual([]);
});

test('本クリック → 右ペインに詳細', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
    await page.locator('#bookshelf .book-item[data-asin="B000000002"]').click();
    await expect(page.locator('body')).toHaveClass(/book-detail-pinned/);
    await expect(page.locator('#book-detail-pane')).toContainText('フィクスチャの本 2');
    expect(errors).toEqual([]);
});

test('評価フィルタで件数が変わり、funnel が点灯する', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(3);
    await page.locator('#toggle-filter').click();
    await page.locator('#rating-seg .rseg[data-rating="5"]').click();
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(2); // ★5 は 2 冊
    await expect(page.locator('#toggle-filter')).toHaveClass(/has-active-filter/);
    await page.locator('#rating-filter-reset').click();
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(3);
    expect(errors).toEqual([]);
});

test('設定→同期: ハブ方式を選ぶとハブパネルが出る (ADR-033)', async ({ page }) => {
    const errors = await bootApp(page);
    // GIS の外部読込を避けるためサインインボタン描画をスタブ化
    await page.evaluate(() => { window.HubAuth.renderSignInButton = (el) => { if (el) el.dataset.stub = '1'; }; });
    await page.evaluate(() => window.bookshelf._openSettingsModal());
    // 同期方式に hub オプションがある
    await expect(page.locator('#sync-method-select option[value="hub"]')).toHaveCount(1);
    // hub を選択 → ハブパネルが表示
    await page.selectOption('#sync-method-select', 'hub');
    await expect(page.locator('#sync-config-hub')).toBeVisible();
    await expect(page.locator('#hub-auth-disconnected')).toBeVisible();
    expect(errors).toEqual([]);
});

test('設定→アカウント: 同期方式と独立してログイン面が出る (A)', async ({ page }) => {
    const errors = await bootApp(page);
    // GIS の外部読込を避けるためサインインボタン描画をスタブ化
    await page.evaluate(() => { window.HubAuth.renderSignInButton = (el) => { if (el) el.dataset.stub = '1'; }; });
    // サイドバーのアカウントチップは未接続時「ログイン」
    await expect(page.locator('#sidebar-account-label')).toHaveText('ログイン');
    await page.evaluate(() => window.bookshelf._openSettingsModal());
    // 同期=hub を選ばずに、アカウントセクションでログインできる
    await expect(page.locator('#account-section')).toBeVisible();
    await expect(page.locator('#account-disconnected')).toBeVisible();
    await expect(page.locator('#account-gsi-button')).toHaveAttribute('data-stub', '1');
    expect(errors).toEqual([]);
});

test('公開: 新規作成→本棚選択→プレビューが生成される (slug上書きバグ回帰)', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#pp-new');
    await expect(page.locator('#pp-edit-view')).toBeVisible();
    await page.selectOption('#pp-style', 'shelf-sections'); // selectOption は option の attach を待つ
    // 本棚を1つ選ぶ (最初の行=「すべて」)
    await page.click('#pp-shelves .bs-pick-row');
    await page.click('#pp-preview');
    // iframe srcdoc に本のタイトルが入り、失敗メッセージは出ない
    const srcdoc = await page.evaluate(() => document.getElementById('pp-preview-frame').srcdoc);
    expect(srcdoc).toContain('フィクスチャの本');
    expect(srcdoc).not.toContain('生成できませんでした');
    expect(srcdoc).not.toContain('プレビュー失敗');
    expect(errors).toEqual([]);
});

test('設定→公開: 公開先をハブに切替えるとハブ公開ブロックが出る (ADR-033)', async ({ page }) => {
    const errors = await bootApp(page);
    await page.evaluate(() => { window.HubAuth.renderSignInButton = (el) => { if (el) el.dataset.stub = '1'; }; });
    await page.evaluate(() => window.bookshelf._openSettingsModal());
    // 既定は GitHub ブロック表示、ハブブロックは隠れている
    await expect(page.locator('#publish-config-github')).toBeVisible();
    await expect(page.locator('#publish-config-hub')).toBeHidden();
    // 公開先=ハブ → ハブブロック表示・GitHub ブロック非表示
    await page.selectOption('#publish-target-select', 'hub');
    await expect(page.locator('#publish-config-hub')).toBeVisible();
    await expect(page.locator('#publish-config-github')).toBeHidden();
    // 設定に target=hub が保存される
    const target = await page.evaluate(() => JSON.parse(localStorage.getItem('bookshelf_sync')).publish.target);
    expect(target).toBe('hub');
    expect(errors).toEqual([]);
});
