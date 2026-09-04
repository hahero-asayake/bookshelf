// 公開ボタンの username ゲート (S6・ADR-076・イシュー#126 B2-b)
//  - _artPublishArticle (js/bookshelf.js) は、公開先がハブかつ cfg.hub.username 未設定なら
//    公開処理をブロックし、設定画面 (アカウント節) への導線を出す (ゲートはハブ公開時のみ)。
//  - username 表示・設定フォーム自体の単体的な検証は tests/e2e/account-username.spec.js が持つ。
//    ここでは「公開ボタン→ブロック→設定→再公開が通る」までの一連の導線を経路で検証する。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const HUB = 'https://mockhub.test';

// publish-article-editor.spec.js の bootAppForPublish と同型 (dirHandle 未接続対策の adapter 差替え含む)。
// username だけ差し替え可能にし、/username エンドポイントは呼び出し側が page.route で任意に足す。
async function bootAppForPublish(page, { username = null } = {}) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    const hubCaptured = { files: null, deleteMissing: null };
    await page.route(`${HUB}/**`, async (route) => {
        const url = route.request().url();
        if (url.includes('/publish')) {
            const body = route.request().postDataJSON();
            hubCaptured.files = body.files;
            hubCaptured.deleteMissing = body.deleteMissing;
            const base = username ? `https://bookshelf.asayake.org/${username}/` : `${HUB}/public/sid/`;
            return route.fulfill({ json: { ok: true, siteUrl: base } });
        }
        if (url.includes('/usage')) {
            return route.fulfill({ json: { plan: 'free', usedBytes: 0, quotaBytes: 100 * 1048576, username, bookshelfBase: username ? `https://bookshelf.asayake.org/${username}/` : null } });
        }
        // /username は各テストが必要に応じて上書きする (未指定なら 404)
        return route.fulfill({ status: 404, json: {} });
    });

    await page.addInitScript(([userData, library, hub, uname]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'local',
            hub: {
                key: 'hk_test', apiBase: hub, email: 'test@example.com', plan: 'free',
                publicBase: `${hub}/public/sid/`, siteId: 'sid',
                username: uname, bookshelfBase: uname ? `https://bookshelf.asayake.org/${uname}/` : null
            },
            publish: { target: 'hub' }
        }));
    }, [fixtureUserData, fixtureLibrary, HUB, username]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
    await page.evaluate((library) => {
        const mem = new Map();
        mem.set('private/library.json', library);
        mem.set('private/bookshelves.json', { bookshelves: [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }] });
        mem.set('private/bookshelves/all.json', { books: library.books.map(b => b.asin) });
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        window.bookshelf.flushSync = async () => {};
        window.bookshelf._isSyncReady = () => true;
    }, JSON.parse(fixtureLibrary));
    return { errors, hubCaptured };
}

// 記事編集画面で最小構成の記事 (タイトル+文章ブロック) を作り保存する
async function createArticle(page, title) {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await page.fill('#art-title', title);
    await page.locator('.art-add-btn').first().click();
    await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
    await page.locator('.art-block-text textarea').fill('本文サンプル。');
    await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });
}

test('(1) username 未設定でハブ公開しようとするとブロックされ、設定を促すダイアログが出る', async ({ page }) => {
    const { errors, hubCaptured } = await bootAppForPublish(page, { username: null });
    await createArticle(page, 'ゲート確認記事');

    await page.click('#art-publish');
    // 初回公開は無料プランのアフィリエイト同意ダイアログが先に出る (username ゲートより前段)
    await expect(page.locator('.cfm-box')).toBeVisible();
    await page.click('.cfm-ok');

    // 同意後、username 未設定によるブロックダイアログが出る
    await expect(page.locator('.cfm-box')).toBeVisible();
    await expect(page.locator('.cfm-message')).toContainText('ユーザー名');
    await expect(page.locator('.cfm-message')).toContainText('アカウント');

    // OK (「設定を開く」) を押すと account-section へ遷移する
    await page.click('.cfm-ok');
    await expect(page.locator('#account-section')).toBeVisible();
    await expect(page.locator('#account-username-current')).toContainText('未設定');

    // 公開は実行されていない (published のまま false・push もされていない)
    const id = await page.evaluate(() => window.bookshelf._artEditingId);
    const article = await page.evaluate((id) => window.bookshelf.publishArticleStore.get(id), id);
    expect(article.published).toBe(false);
    expect(hubCaptured.files).toBeNull();
    expect(errors).toEqual([]);
});

test('(2)(3) 設定画面から username 設定 (fetch スタブ) →成功表示・保存→再度公開すると通る', async ({ page }) => {
    const { errors, hubCaptured } = await bootAppForPublish(page, { username: null });
    await page.route(`${HUB}/username`, async (route) => {
        const body = route.request().postDataJSON();
        await route.fulfill({ json: { username: body.username, bookshelfBase: `https://bookshelf.asayake.org/${body.username}/` } });
    });
    await createArticle(page, 'ゲート確認記事2');

    // 1回目の公開: 無料プラン同意 → username 未設定でブロック
    await page.click('#art-publish');
    await expect(page.locator('.cfm-box')).toBeVisible();
    await page.click('.cfm-ok'); // 無料プラン同意
    await expect(page.locator('.cfm-box')).toBeVisible();
    await page.click('.cfm-ok'); // 設定を開く

    // (2) 設定画面から username を設定する
    await expect(page.locator('#account-section')).toBeVisible();
    await page.fill('#account-username-input', 'taro-books');
    await page.click('#account-username-save');
    await expect(page.locator('#account-username-current')).toContainText('taro-books');
    await expect(page.locator('#account-username-current')).not.toHaveClass(/is-unset/);
    const savedUsername = await page.evaluate(() => SyncConfigManager.load().hub.username);
    expect(savedUsername).toBe('taro-books'); // 保存されている

    // 設定モーダルを閉じ、記事一覧から再度公開する (エディタは開き直しで一覧に戻る)
    await page.click('#settings-modal-close');
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.locator('#art-list [data-act="publish"]').first().click();
    // 同意は 1 回目の試行時 (ブロックされる前) に既に済んでいるため、2 回目はダイアログ無しで公開が通る

    // (3) 公開が通る
    await expect.poll(() => hubCaptured.files).not.toBeNull();
    expect(hubCaptured.files.some(f => f.path !== 'index.html')).toBe(true);
    expect(errors).toEqual([]);
});

test('(4) Worker のバリデーションエラー (予約語等) は設定画面のフォーム脇に表示される', async ({ page }) => {
    const errors = (await bootAppForPublish(page, { username: null })).errors;
    await page.route(`${HUB}/username`, async (route) => {
        await route.fulfill({ status: 400, json: { error: 'invalid or reserved username' } });
    });
    await createArticle(page, 'ゲート確認記事3');

    await page.click('#art-publish');
    await expect(page.locator('.cfm-box')).toBeVisible();
    await page.click('.cfm-ok'); // 無料プラン同意
    await expect(page.locator('.cfm-box')).toBeVisible();
    await page.click('.cfm-ok'); // 設定を開く
    await expect(page.locator('#account-section')).toBeVisible();

    await page.fill('#account-username-input', 'top'); // 予約語のつもり (Worker がエラーを返す想定)
    await page.click('#account-username-save');

    await expect(page.locator('#account-username-error')).toBeVisible();
    await expect(page.locator('#account-username-error')).toContainText('使えません');
    // 失敗時は未設定のまま=公開は依然ブロックされる状態
    await expect(page.locator('#account-username-current')).toContainText('未設定');
    // 400 レスポンス自体の「Failed to load resource」はこのテストの意図した失敗なので除外
    expect(errors.filter((e) => !e.includes('Failed to load resource'))).toEqual([]);
});

test('username 設定済みならブロックされず公開が通る (ゲート非対象の正常系)', async ({ page }) => {
    const { errors, hubCaptured } = await bootAppForPublish(page, { username: 'hahero' });
    await createArticle(page, 'ゲート確認記事4');

    await page.click('#art-publish');
    // 設定済みなのでブロックダイアログではなく、無料プラン同意ダイアログが最初に出る
    await expect(page.locator('.cfm-box')).toBeVisible();
    await expect(page.locator('.cfm-message')).not.toContainText('ユーザー名を設定');
    await page.click('.cfm-ok');

    await expect.poll(() => hubCaptured.files).not.toBeNull();
    expect(errors).toEqual([]);
});

test('公開先が GitHub (自前 repo) のときは username ゲートを適用しない', async ({ page }) => {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    // GitHub 接続済み (token あり) だとページ起動時に api.github.com/user/installations を実際に叩く
    // 既存の初期化動作がある (このテストの関心=ゲート判定とは無関係) ため、ダミー応答でモックしておく。
    await page.route('https://api.github.com/**', (route) => route.fulfill({ status: 200, json: { installations: [] } }));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'local',
            github: { token: 'ghu_x', login: 'hahero-asayake' },
            hub: { key: '', apiBase: '', username: null },
            publish: { target: 'github', owner: 'hahero-asayake', repo: 'bookshelf-public', branch: 'main' }
        }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
    await page.evaluate((library) => {
        const mem = new Map();
        mem.set('private/library.json', library);
        mem.set('private/bookshelves.json', { bookshelves: [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }] });
        mem.set('private/bookshelves/all.json', { books: library.books.map(b => b.asin) });
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        window.bookshelf.flushSync = async () => {};
        window.bookshelf._isSyncReady = () => true;
        // GitHubAdapter の実 API 呼び出しは踏ませない (このテストの関心はゲートの有無だけ)
        window.bookshelf._runPublishExport = async () => ({ ok: true, result: { siteUrl: 'https://hahero-asayake.github.io/bookshelf-public/', errors: [] } });
    }, JSON.parse(fixtureLibrary));

    await createArticle(page, 'GitHub公開はゲート対象外');
    await page.click('#art-publish');
    // username 未設定でもブロックされず、そのまま公開成功トーストが出る (同意ダイアログも出ない=target=github)
    await expect(page.locator('.toast-success')).toBeVisible();
    const id = await page.evaluate(() => window.bookshelf._artEditingId);
    const article = await page.evaluate((id) => window.bookshelf.publishArticleStore.get(id), id);
    expect(article.published).toBe(true);
    expect(errors).toEqual([]);
});
