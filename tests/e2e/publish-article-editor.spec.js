// 記事エディタ (公開v2 S3, ADR-058 §11) の基本操作・プレビュー・公開結線を経路で検証する。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

// initialArticlesJSON: page.reload() 後の再接続を模すため articles.json 相当の初期値を注入したい
// ときだけ渡す (イシュー#135「オン→保存→リロード→オンのまま」検証、bootApp の Map は reload で消えるため
// 前回の writeJSON 結果を Node 側で退避→再注入する必要がある)。
async function bootApp(page, initialArticlesJSON) {
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
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
    // LocalFSAdapter は実 dirHandle を持たない (picker 未操作) ため、記事ストアの読み書きだけ
    // メモリ上のマップへ差し替える (userData/library とは独立した private/publish/articles.json のみ対象)。
    await page.evaluate((initial) => {
        const mem = new Map();
        if (initial) mem.set('private/publish/articles.json', initial);
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        // イシュー#35: 未接続のまま記事を編集させないガードを追加した。この E2E は dirHandle を持たない
        // LocalFS のまま記事ストアだけメモリ差替で動かす都合上、実際には「未接続」判定になってしまうため、
        // 接続済み相当にモックする (bootAppForPublish 等で既に使われているのと同じパターン)。
        window.bookshelf._isSyncReady = () => true;
    }, initialArticlesJSON || null);
    return errors;
}

// イシュー#59: 実データ相当(783冊)の引き出しでビューポート収まりを検証するため、userData の
// "all" 特殊本棚(books配列)と library の両方に count 冊のダミーを注入する。_artRenderDrawer は
// shelf.books を直接参照するため、library だけ増やしても引き出しには反映されない (実測済み)。
function buildManyBooksFixtures(count) {
    const userData = JSON.parse(fixtureUserData);
    const library = JSON.parse(fixtureLibrary);
    const books = [];
    const asins = [];
    for (let i = 1; i <= count; i++) {
        const asin = `B${String(i).padStart(9, '0')}`;
        asins.push(asin);
        books.push({
            asin, title: `ダミー本 ${i} 〜長めのタイトルで折返しも確認する用〜`, authors: `著者${i % 37}`,
            acquiredTime: 1700000000000 + i * 1000, readStatus: 'READ',
            productImage: '', source: 'fixture', addedDate: 1700000000000 + i * 1000
        });
    }
    library.books = books;
    library.metadata = { ...library.metadata, totalBooks: books.length };
    const allShelf = userData.bookshelves.find(s => s.isSpecial);
    allShelf.books = asins;
    return { userData: JSON.stringify(userData), library: JSON.stringify(library) };
}

async function bootAppWithManyBooks(page, count = 800) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    const { userData, library } = buildManyBooksFixtures(count);
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [userData, library]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
    await page.evaluate(() => {
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
        window.bookshelf._isSyncReady = () => true;
    });
    return errors;
}

test.describe('記事エディタ: 作成→編集の基本経路', () => {
    test('新規作成→タイトル/タグ入力→自動保存され一覧に反映される', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await expect(page.locator('#art-edit-view')).toBeVisible();

        await page.fill('#art-title', 'わたしを構成する10冊');
        await page.locator('#art-tag-input').fill('SF');
        await page.locator('.art-sugg-new').click();
        await expect(page.locator('#art-tags .art-tag')).toContainText('SF');

        // debounce (600ms) 経過を待って保存完了を確認
        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });

        await page.click('#art-back');
        await expect(page.locator('#art-list-view')).toBeVisible();
        await expect(page.locator('#art-list .pp-row-title')).toContainText('わたしを構成する10冊');
        expect(errors).toEqual([]);
    });

    test('本棚ブロックを追加し、本の引き出しから本を配置できる (同じ本を複数回)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        // 本の引き出しに (all=5冊) 表示される
        await expect(page.locator('#art-drawer-list .art-drawer-item')).toHaveCount(5);

        // ブロックを追加 → 本棚
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        await expect(page.locator('.art-block[data-index="0"] .art-block-kind')).toHaveText('本棚');

        // 引き出しの本を2回クリック (同じ本を多重配置できる, §11.1)
        const firstDrawerBook = page.locator('#art-drawer-list .art-drawer-item').first();
        await firstDrawerBook.click();
        await firstDrawerBook.click();
        await expect(page.locator('.art-shelf-item')).toHaveCount(2);

        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });
        expect(errors).toEqual([]);
    });

    test('文章ブロックは生 Markdown の textarea で編集できる', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        const textarea = page.locator('.art-block-text textarea');
        await textarea.fill('## はじめに\n\n本文。');
        await expect(textarea).toHaveValue('## はじめに\n\n本文。');
        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });
        expect(errors).toEqual([]);
    });

    test('記事を削除すると一覧から消える', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.fill('#art-title', '削除するテスト記事');
        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });
        await page.click('#art-del');
        await page.click('.cfm-ok');
        await expect(page.locator('#art-list-view')).toBeVisible();
        await expect(page.locator('#art-list')).not.toContainText('削除するテスト記事');
        expect(errors).toEqual([]);
    });
});

test.describe('記事エディタ: プレビュー (PublishArticleGenerator をブラウザ内で呼ぶボタン式)', () => {
    test('ブロックを1つも追加していない状態で押すと警告のみ (モーダルは開かない)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.click('#art-preview');
        await expect(page.locator('#pp-preview-modal')).not.toHaveClass(/show/);
        expect(errors).toEqual([]);
    });

    test('文章+本棚ブロックを追加してプレビューすると、タイトル・本文・本のタイトルが反映される', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.fill('#art-title', 'わたしを構成する10冊');

        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        await page.locator('.art-block-text textarea').fill('## はじめに\n\n本文サンプル。');

        await page.locator('.art-add-btn').last().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').last().click();
        await page.locator('#art-drawer-list .art-drawer-item').first().click();

        await page.click('#art-preview');
        await expect(page.locator('#pp-preview-modal')).toHaveClass(/show/);
        const srcdoc = await page.evaluate(() => document.getElementById('pp-preview-frame').srcdoc);
        expect(srcdoc).toContain('わたしを構成する10冊');
        expect(srcdoc).toContain('はじめに');
        expect(srcdoc).toContain('フィクスチャの本 1');
        expect(srcdoc).toContain('legal/terms.html');       // フッター法務リンク (WP-B5)
        expect(srcdoc).not.toContain('生成できませんでした');
        expect(srcdoc).not.toContain('プレビュー失敗');
        expect(errors).toEqual([]);
    });

    test('星(評価)トグルをオンにするとプレビューに ★★★☆☆ と aria-label が反映される (イシュー#135)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        await page.locator('#art-drawer-list .art-drawer-item').first().click(); // B000000001 (rating:5)

        await page.locator('.art-item-show-toggle[data-show-key="rating"]').first().click();

        await page.click('#art-preview');
        await expect(page.locator('#pp-preview-modal')).toHaveClass(/show/);
        const srcdoc = await page.evaluate(() => document.getElementById('pp-preview-frame').srcdoc);
        expect(srcdoc).toContain('class="bk-rating"');
        expect(srcdoc).toContain('aria-label="評価 5/5"');
        expect(srcdoc).not.toContain('生成できませんでした');
        expect(errors).toEqual([]);
    });

    test('未保存の編集 (自動保存の debounce 中) もプレビューへ反映される', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        // debounce (600ms) が経過する前に即プレビューを押す
        await page.locator('.art-block-text textarea').fill('# まだ保存されていない見出し');
        await page.click('#art-preview');
        const srcdoc = await page.evaluate(() => document.getElementById('pp-preview-frame').srcdoc);
        expect(srcdoc).toContain('まだ保存されていない見出し');
        expect(errors).toEqual([]);
    });

    test('テーマ変更 (レイアウト/配色) がプレビューの data-layout/data-color に反映される', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        await page.locator('.art-block-text textarea').fill('本文');
        await page.selectOption('#art-theme-layout', 'wall');
        await page.selectOption('#art-theme-color', 'black');
        await page.click('#art-preview');
        const srcdoc = await page.evaluate(() => document.getElementById('pp-preview-frame').srcdoc);
        expect(srcdoc).toContain('data-layout="wall"');
        expect(srcdoc).toContain('data-color="black"');
        expect(errors).toEqual([]);
    });

    test('PC幅⇄モバイル幅トグルが効く (docs/ui-standards.md の使い勝手を踏襲)', async ({ page }) => {
        // 戻る (スマホ戻る=履歴統合) の検証は standard-ops.spec.js 側 (390x844) で担保済み
        // (「公開管理→プレビュー: 戻るはプレビューだけ閉じ、公開管理は残る」)。ここは PC 幅トグルの見た目のみ見る。
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        await page.locator('.art-block-text textarea').fill('本文');
        await page.click('#art-preview');
        await expect(page.locator('#pp-preview-modal')).toHaveClass(/show/);
        const stage = page.locator('#pp-preview-modal .pp-preview-stage');
        await expect(stage).not.toHaveClass(/pp-stage-mobile/);
        await page.click('#pp-preview-device');
        await expect(stage).toHaveClass(/pp-stage-mobile/);
        await expect(page.locator('#pp-preview-device')).toContainText('PC 幅');
        await page.click('#pp-preview-device');
        await expect(stage).not.toHaveClass(/pp-stage-mobile/);
        await expect(page.locator('#pp-preview-device')).toContainText('モバイル幅');
        expect(errors).toEqual([]);
    });
});

test.describe('記事エディタ: 公開結線 (PublishArticleGenerator.build → 公開先アダプタへ push)', () => {
    const HUB = 'https://mockhub.test';

    async function bootAppForPublish(page) {
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
                return route.fulfill({ json: { ok: true, siteUrl: `${HUB}/public/sid/` } });
            }
            if (url.includes('/usage')) {
                return route.fulfill({ json: { plan: 'free', usedBytes: 0, quotaBytes: 100 * 1048576 } });
            }
            return route.fulfill({ status: 404, json: {} });
        });

        await page.addInitScript(([userData, library, hub]) => {
            localStorage.setItem('virtualBookshelf_userData', userData);
            localStorage.setItem('virtualBookshelf_library', library);
            // method は local のまま (adapter 差し替えのタイミング問題を避ける)。
            // 公開先だけハブに向け、_isSyncReady() をテスト側でモックして「保存先未設定」ガードを通す。
            // username は設定済みにしておく (S6・ADR-076: 未設定だと公開ボタンがブロックされる。
            // その挙動自体は tests/e2e/username-publish-gate.spec.js が別途検証する)。
            localStorage.setItem('bookshelf_sync', JSON.stringify({
                method: 'local',
                hub: {
                    key: 'hk_test', apiBase: hub, email: 'test@example.com', plan: 'free',
                    publicBase: `${hub}/public/sid/`, siteId: 'sid',
                    username: 'hahero', bookshelfBase: 'https://bookshelf.asayake.org/hahero/'
                },
                publish: { target: 'hub' }
            }));
        }, [fixtureUserData, fixtureLibrary, HUB]);
        await page.goto('/index.html');
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
        await page.evaluate(([library, notes]) => {
            const mem = new Map();
            // export() は state を渡さず app.storage.loadAll() を使う実経路なので、蔵書データも仕込む
            // (notes.json も渡さないと build() 側の評価/短文メモが読めず、localStorage の userData とは
            // 別経路のため揃わない・イシュー#135 で星の生成HTML検証時に判明)。
            mem.set('private/library.json', library);
            mem.set('private/bookshelves.json', { bookshelves: [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }] });
            mem.set('private/bookshelves/all.json', { books: library.books.map(b => b.asin) });
            mem.set('private/notes.json', { notes });
            const adapter = window.bookshelf.storage.adapter;
            adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
            adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
            window.bookshelf.flushSync = async () => {};
            window.bookshelf._isSyncReady = () => true;
        }, [JSON.parse(fixtureLibrary), JSON.parse(fixtureUserData).notes]);
        return { errors, hubCaptured };
    }

    test('「公開する」→同意→push まで通る。生成HTMLに記事タイトル・本の内容が反映される', async ({ page }) => {
        const { errors, hubCaptured } = await bootAppForPublish(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.fill('#art-title', 'わたしを構成する10冊');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        await page.locator('.art-block-text textarea').fill('## はじめに\n\n本文サンプル。');
        await page.locator('.art-add-btn').last().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').last().click();
        await page.locator('#art-drawer-list .art-drawer-item').first().click();
        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });

        await page.click('#art-publish');
        // 無料プラン (ハブ) は初回公開時に同意ダイアログが挟まる
        await expect(page.locator('.cfm-box')).toBeVisible();
        await page.click('.cfm-ok');

        await expect.poll(() => hubCaptured.files).not.toBeNull();
        const paths = hubCaptured.files.map(f => f.path);
        expect(paths).toContain('index.html');
        expect(paths.some(p => p.endsWith('/index.html') && p !== 'index.html')).toBe(true);
        const articleHtml = hubCaptured.files.find(f => f.path !== 'index.html').content;
        expect(articleHtml).toContain('わたしを構成する10冊');
        expect(articleHtml).toContain('はじめに');
        expect(articleHtml).toContain('フィクスチャの本 1');
        expect(hubCaptured.deleteMissing).toBe(true);

        // published 状態・lastBuiltAt・「公開を取り消す」ボタンが反映される
        const id = await page.evaluate(() => window.bookshelf._artEditingId);
        const article = await page.evaluate((id) => window.bookshelf.publishArticleStore.get(id), id);
        expect(article.published).toBe(true);
        // lastBuiltAt 更新はエラーを握り潰す実装 (js/exporter.js) のため、失敗時は errors 側に
        // console.error が残る (イシュー#104)。ここで一緒に出して真因を一発で追えるようにする。
        expect(article.lastBuiltAt, `lastBuiltAt is falsy. console errors: ${JSON.stringify(errors)}`).toBeTruthy();
        await expect(page.locator('#art-unpublish')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('星(評価)トグルをオンにすると生成HTMLに★★★☆☆とaria-labelが含まれる (イシュー#135)', async ({ page }) => {
        const { errors, hubCaptured } = await bootAppForPublish(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.fill('#art-title', '評価つき記事');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        await page.locator('#art-drawer-list .art-drawer-item').first().click(); // B000000001 (rating:5)

        await page.locator('.art-item-show-toggle[data-show-key="rating"]').first().click();
        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });

        await page.click('#art-publish');
        await expect(page.locator('.cfm-box')).toBeVisible();
        await page.click('.cfm-ok');

        await expect.poll(() => hubCaptured.files).not.toBeNull();
        const articleHtml = hubCaptured.files.find(f => f.path !== 'index.html').content;
        expect(articleHtml).toContain('class="bk-rating"');
        expect(articleHtml).toContain('aria-label="評価 5/5"');
        expect(errors).toEqual([]);
    });

    test('公開を取り消すと published=false になり再度 push される (削除同期)', async ({ page }) => {
        const { errors, hubCaptured } = await bootAppForPublish(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.fill('#art-title', '取り消しテスト');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        await page.locator('.art-block-text textarea').fill('本文');
        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });

        await page.click('#art-publish');
        await page.click('.cfm-ok');
        await expect.poll(() => hubCaptured.files).not.toBeNull();
        hubCaptured.files = null;

        await page.click('#art-unpublish');
        await page.click('.cfm-ok'); // 「公開を取り消す」確認 (danger ボタン)
        await expect.poll(() => hubCaptured.files).not.toBeNull();
        // published=false の記事は build に渡らないため、index.html だけが再 push される
        expect(hubCaptured.files.map(f => f.path)).toEqual(['index.html']);

        const id = await page.evaluate(() => window.bookshelf._artEditingId);
        const article = await page.evaluate((id) => window.bookshelf.publishArticleStore.get(id), id);
        expect(article.published).toBe(false);
        await expect(page.locator('#art-unpublish')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('一覧の「公開」ボタンからも公開でき、一覧に公開中バッジが反映される', async ({ page }) => {
        const { errors, hubCaptured } = await bootAppForPublish(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.fill('#art-title', '一覧から公開');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        await page.locator('.art-block-text textarea').fill('本文');
        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });

        await page.click('#art-back');
        await expect(page.locator('#art-list-view')).toBeVisible();
        await page.click('.pp-row [data-act="publish"]');
        await page.click('.cfm-ok');
        await expect.poll(() => hubCaptured.files).not.toBeNull();

        await expect(page.locator('.pp-row .pp-status-on')).toBeVisible();
        expect(errors).toEqual([]);
    });
});

test.describe('記事エディタ: スマホでの操作 (390x844・タッチ有効)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('ブロックのドラッグ並び替えが機能する (Pointer Events)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        await page.locator('.art-block-text textarea').first().fill('block-A');
        await page.locator('.art-add-btn').last().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').last().click();
        await page.locator('.art-block-text textarea').last().fill('block-B');

        const orderOf = () => page.evaluate(() => window.bookshelf._artDraft.blocks.map(b => b.markdown));
        await expect.poll(orderOf).toEqual(['block-A', 'block-B']);

        // .art-col は内側スクロール領域 (イシュー#59 A/B)。2ブロック目のフォーカスでブラウザが
        // 自動スクロールすることがあるため、座標取得前に先頭へ戻して両ブロックが見える状態にする。
        await page.evaluate(() => { const col = document.querySelector('.art-col'); if (col) col.scrollTop = 0; });
        const gripA = page.locator('.art-block').nth(0).locator('.art-block-grip');
        const blockB = page.locator('.art-block').nth(1);
        const gripBox = await gripA.boundingBox();
        const targetBox = await blockB.boundingBox();
        await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
        await page.mouse.up();

        await expect.poll(orderOf).toEqual(['block-B', 'block-A']);
        expect(errors).toEqual([]);
    });

    test('プレビューを開いて戻ると、プレビューだけ閉じエディタは残る (履歴統合)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        await page.locator('.art-block-text textarea').fill('本文');

        await page.click('#art-preview');
        await expect(page.locator('#pp-preview-modal')).toHaveClass(/show/);
        await page.goBack();
        await expect(page.locator('#pp-preview-modal')).not.toHaveClass(/show/);
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);

        // さらに戻ると記事エディタモーダル自体も閉じる
        await page.goBack();
        await expect(page.locator('#publish-pages-modal')).not.toHaveClass(/show/);
        expect(page.url()).toContain('index.html');
        expect(errors).toEqual([]);
    });

    test('本棚ブロック内の本のドラッグ並び替えが機能する (Pointer Events, A-1回帰)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        await page.locator('#art-drawer-list .art-drawer-item').nth(0).click();
        await page.locator('#art-drawer-list .art-drawer-item').nth(1).click();

        const orderOf = () => page.evaluate(() => window.bookshelf._artDraft.blocks[0].items.map(it => it.asin));
        const before = await orderOf();
        expect(before).toHaveLength(2);

        const items = page.locator('.art-shelf-item');
        const gripA = items.nth(0).locator('.art-shelf-item-grip');
        const itemB = items.nth(1);
        const gripBox = await gripA.boundingBox();
        const targetBox = await itemB.boundingBox();
        await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
        await page.mouse.up();

        await expect.poll(orderOf).toEqual([before[1], before[0]]);
        expect(errors).toEqual([]);
    });
});

// 実機報告「ドラッグが効かない」(2026-08-16) の再現用。上のドラッグ2件は 390x844+hasTouch
// でしか打っておらず、本人が触っているのは PC 幅のマウス操作なので同じ経路を素の viewport
// (1280x720・タッチ無し) でも打つ。pointerType が touch と mouse で分岐する余地を潰す。
test.describe('記事エディタ: PC幅での操作 (1280x720・マウス)', () => {
    test('ブロックのドラッグ並び替えが機能する (Pointer Events)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        await page.locator('.art-block-text textarea').first().fill('block-A');
        await page.locator('.art-add-btn').last().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').last().click();
        await page.locator('.art-block-text textarea').last().fill('block-B');

        const orderOf = () => page.evaluate(() => window.bookshelf._artDraft.blocks.map(b => b.markdown));
        await expect.poll(orderOf).toEqual(['block-A', 'block-B']);

        // .art-col は内側スクロール領域 (イシュー#59 A/B)。2ブロック目のフォーカスでブラウザが
        // 自動スクロールすることがあるため、座標取得前に先頭へ戻して両ブロックが見える状態にする。
        await page.evaluate(() => { const col = document.querySelector('.art-col'); if (col) col.scrollTop = 0; });
        const gripA = page.locator('.art-block').nth(0).locator('.art-block-grip');
        const blockB = page.locator('.art-block').nth(1);
        const gripBox = await gripA.boundingBox();
        const targetBox = await blockB.boundingBox();
        await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
        await page.mouse.up();

        await expect.poll(orderOf).toEqual(['block-B', 'block-A']);
        expect(errors).toEqual([]);
    });

    test('本棚ブロック内の本のドラッグ並び替えが機能する', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        await page.locator('#art-drawer-list .art-drawer-item').nth(0).click();
        await page.locator('#art-drawer-list .art-drawer-item').nth(1).click();

        const orderOf = () => page.evaluate(() => window.bookshelf._artDraft.blocks[0].items.map(it => it.asin));
        const before = await orderOf();
        expect(before).toHaveLength(2);

        const items = page.locator('.art-shelf-item');
        const gripA = items.nth(0).locator('.art-shelf-item-grip');
        const itemB = items.nth(1);
        const gripBox = await gripA.boundingBox();
        const targetBox = await itemB.boundingBox();
        await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
        await page.mouse.up();

        await expect.poll(orderOf).toEqual([before[1], before[0]]);
        expect(errors).toEqual([]);
    });
});

test.describe('記事エディタ: A系実機バグ回帰 (イシュー#29)', () => {
    test('3種のブロックすべてに操作バー(グリップ/複製/削除)が付く (A-2回帰)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        await page.locator('.art-add-btn').last().click();
        await page.locator('.art-add-menu-item[data-block-type="book"]').last().click();
        await page.locator('.art-add-btn').last().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').last().click();
        await expect(page.locator('.art-block')).toHaveCount(3);

        const blocks = page.locator('.art-block');
        for (let i = 0; i < 3; i++) {
            const block = blocks.nth(i);
            await expect(block.locator('.art-block-grip')).toBeVisible();
            await expect(block.locator('.art-block-dup')).toBeVisible();
            await expect(block.locator('.art-block-del')).toBeVisible();
        }
        expect(errors).toEqual([]);
    });

    test('本ブロックは複製・削除ボタンで実際に操作できる (A-2回帰)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="book"]').first().click();
        await expect(page.locator('.art-block')).toHaveCount(1);

        await page.locator('.art-block-dup').first().click();
        await expect(page.locator('.art-block')).toHaveCount(2);

        await page.locator('.art-block-del').first().click();
        await expect(page.locator('.art-block')).toHaveCount(1);
        expect(errors).toEqual([]);
    });

    test('本棚ブロックが0冊のとき空状態の案内が縦に潰れず表示される (A-3回帰)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();

        await expect(page.locator('.art-block-body .pp-empty')).toBeVisible();
        // 密度の既定はコンパクト (B) なので .art-shelf-list 側で潰れないことを見る
        const box = await page.locator('.art-shelf-list').boundingBox();
        expect(box.height).toBeGreaterThan(40);
        expect(box.width).toBeGreaterThan(200);
        expect(errors).toEqual([]);
    });

    test('プレビューを複数回開閉してもコンソールエラー・script混入が起きない (A-4回帰)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
        await page.locator('.art-block-text textarea').first().fill('本文');

        for (let i = 0; i < 3; i++) {
            await page.click('#art-preview');
            await expect(page.locator('#pp-preview-modal')).toHaveClass(/show/);
            const srcdoc = await page.evaluate(() => document.getElementById('pp-preview-frame').srcdoc);
            expect(srcdoc).not.toContain('<script');
            await page.click('#pp-preview-close');
            await expect(page.locator('#pp-preview-modal')).not.toHaveClass(/show/);
        }
        expect(errors).toEqual([]);
    });
});

test.describe('記事エディタ: 表示密度改善 (B, イシュー#29)', () => {
    async function addShelfWithBooks(page, n) {
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        const drawerItems = page.locator('#art-drawer-list .art-drawer-item');
        const count = Math.min(n, await drawerItems.count());
        for (let i = 0; i < count; i++) { await drawerItems.nth(i).click(); }
    }

    test('本棚ブロックの既定密度はコンパクトリスト (1行1冊・34pxサムネ)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 3);

        await expect(page.locator('.art-shelf-list')).toBeVisible();
        await expect(page.locator('.art-shelf-grid')).toHaveCount(0);
        await expect(page.locator('.art-shelf-item').first().locator('.art-item-show-toggle').first()).toHaveText('短');
        expect(errors).toEqual([]);
    });

    test('密度切替でコンパクト⇄カードが入れ替わり、トグル文言も連動する', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 2);

        await page.locator('.art-density-toggle').click();
        await expect(page.locator('.art-shelf-grid')).toBeVisible();
        await expect(page.locator('.art-shelf-list')).toHaveCount(0);
        await expect(page.locator('.art-shelf-item').first().locator('.art-item-show-toggle').first()).toHaveText('短文');

        await page.locator('.art-density-toggle').click();
        await expect(page.locator('.art-shelf-list')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('「畳む」でブロック本体が隠れ、見出しバーだけ残る', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 2);

        await expect(page.locator('.art-block-body').first()).toBeVisible();
        await page.locator('.art-collapse-toggle').click();
        await expect(page.locator('.art-block-body').first()).toBeHidden();
        await expect(page.locator('.art-block').first()).toHaveClass(/is-collapsed/);

        await page.locator('.art-collapse-toggle').click();
        await expect(page.locator('.art-block-body').first()).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('並び替え支援: 先頭へ/末尾へボタンで即座に順番が変わる', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 3);

        const orderOf = () => page.evaluate(() => window.bookshelf._artDraft.blocks[0].items.map(it => it.asin));
        const before = await orderOf();
        await page.locator('.art-shelf-item').last().locator('.art-item-to-first').click();
        const after = await orderOf();
        expect(after[0]).toBe(before[before.length - 1]);
        expect(errors).toEqual([]);
    });

    test('並び替え支援: 一括指定 (タイトル順) で全アイテムが並び替わる', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 5);

        // 並び順の一括指定は選択式 (イシュー#55): 選択バーは1件以上選択したときだけ出るため、
        // まず1件選び「すべて選択」で全件を対象にしてから並び順を選ぶ。
        await page.locator('.art-item-check').first().click();
        await page.locator('.art-sel-all-btn').click();
        await page.locator('.art-shelf-sort-sel').selectOption('title');
        const titles = await page.evaluate(() => {
            const items = window.bookshelf._artDraft.blocks[0].items;
            return items.map(it => (window.bookshelf.books.find(b => b.asin === it.asin) || {}).title);
        });
        const sorted = [...titles].sort((a, b) => a.localeCompare(b, 'ja'));
        expect(titles).toEqual(sorted);
        expect(errors).toEqual([]);
    });

    // 「同じ本も何度でも配置可」の注記は不要 (本人指摘) のため削除した (イシュー#133)。
    test('「同じ本も何度でも配置可」の注記は表示されない (イシュー#133)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await expect(page.locator('.art-drawer-note')).toHaveCount(0);
        await expect(page.locator('#art-drawer')).not.toContainText('同じ本も何度でも配置可');
        expect(errors).toEqual([]);
    });

    test('本の引き出しはコンパクトリスト (1行1冊・34pxサムネ、イシュー#34)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        await expect(page.locator('.art-drawer-grid')).toHaveCount(0);
        const item = page.locator('#art-drawer-list .art-drawer-item').first();
        const box = await item.boundingBox();
        expect(box.height).toBeLessThanOrEqual(48);
        const coverBox = await item.locator('.art-cover').boundingBox();
        expect(Math.round(coverBox.width)).toBe(34);
        expect(Math.round(coverBox.height)).toBe(34);
        // fixture の全冊は未配置なので NEW バッジが出る
        await expect(item.locator('.art-drawer-item-badge')).toHaveText('NEW');
        expect(errors).toEqual([]);
    });

    test('引き出しの検索でタイトル/著者を絞り込み、絞り込んだままでも配置できる (イシュー#34)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        const search = page.locator('#art-drawer-search');
        const drawerItems = page.locator('#art-drawer-list .art-drawer-item');

        await expect(drawerItems).toHaveCount(5);

        await search.fill('3');
        await expect(drawerItems).toHaveCount(1);

        await search.fill('著者C');
        await expect(drawerItems).toHaveCount(2);

        // 絞り込んだ状態から本棚ブロックを追加し、同じ本を複数回配置できる (多重配置, ADR-058 §11.1)
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        await drawerItems.first().click();
        await drawerItems.first().click();
        await expect(page.locator('.art-shelf-item')).toHaveCount(2);

        await search.fill('');
        await expect(drawerItems).toHaveCount(5);

        await search.fill('zzz');
        await expect(drawerItems).toHaveCount(0);
        await expect(page.locator('.art-drawer-empty')).toBeVisible();
        expect(errors).toEqual([]);
    });
});

// 引き出しに本棚セレクタを付け、all固定だった引き出しを本棚で絞れるようにした (イシュー#99)。
// #133 で <select> からボタン+ポップオーバー (アイコン+パス表記) へ置換。
// 設計: 階層フラット列挙・ALL先頭固定/既定・検索と直列合成・配置済みブロックは無影響。
test.describe('記事エディタ: 引き出しの本棚セレクタ (イシュー#99・#133)', () => {
    async function pickDrawerShelf(page, internalId) {
        await page.click('#art-drawer-shelf-btn');
        await page.locator(`#art-drawer-shelf-popover [data-shelf-internal="${internalId}"]`).click();
    }

    test('本棚を選ぶとその本だけが並び、検索と併用でき、配置できる。本棚を切り替えても配置済みブロックは変化しない', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        const shelfLabel = page.locator('#art-drawer-shelf-label');
        const drawerItems = page.locator('#art-drawer-list .art-drawer-item');
        const search = page.locator('#art-drawer-search');

        // 既定は all (5冊, 既存の使い方を変えない)
        await expect(shelfLabel).toHaveText('すべての本');
        await expect(drawerItems).toHaveCount(5);

        // 本棚Bを選ぶ→Bの本だけが並ぶ (テスト本棚=3冊)
        await pickDrawerShelf(page, 'fixshelf01');
        await expect(drawerItems).toHaveCount(3);
        await expect(shelfLabel).toHaveText('テスト本棚');

        // 検索と併用できる (本棚内でさらにタイトルで絞る)
        await search.fill('3');
        await expect(drawerItems).toHaveCount(1);
        await expect(drawerItems.first()).toContainText('フィクスチャの本 3');

        // 絞り込んだ状態からクリックで配置できる
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        await drawerItems.first().click();
        await expect(page.locator('.art-shelf-item')).toHaveCount(1);
        await expect(page.locator('.art-shelf-item').first()).toContainText('フィクスチャの本 3');

        // 本棚を切り替えても、既に配置済みのブロックは変化しない
        await search.fill('');
        await pickDrawerShelf(page, 'fixall001');
        await expect(drawerItems).toHaveCount(5);
        await expect(page.locator('.art-shelf-item')).toHaveCount(1);
        await expect(page.locator('.art-shelf-item').first()).toContainText('フィクスチャの本 3');

        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });
        expect(errors).toEqual([]);
    });

    test('本棚セレクタはアイコン付きカスタムリストで、ALL が先頭かつ既定選択', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        await expect(page.locator('#art-drawer-shelf-label')).toHaveText('すべての本');
        await page.click('#art-drawer-shelf-btn');
        const items = page.locator('#art-drawer-shelf-popover .art-drawer-shelf-item');
        const labels = await items.allTextContents();
        expect(labels[0]).toContain('すべての本');
        expect(labels.some(t => t.includes('テスト本棚'))).toBe(true);
        await expect(page.locator('#art-drawer-shelf-popover [data-shelf-internal="fixall001"]')).toHaveAttribute('aria-selected', 'true');
        // アイコンが乗っている (項目2)
        await expect(items.first().locator('.bs-popover-icon')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('キーボードで開閉・選択できる: トリガーへ Tab → Enter で開く → Tab → Enter で選択 → Esc で閉じてフォーカスが戻る', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        const btn = page.locator('#art-drawer-shelf-btn');
        await btn.focus();
        await expect(btn).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('#art-drawer-shelf-popover')).toBeVisible();
        await expect(btn).toHaveAttribute('aria-expanded', 'true');

        // Tab で1件目 (すべての本) → 2件目 (テスト本棚) の順にフォーカス移動し Enter で選択
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await expect(page.locator('#art-drawer-shelf-label')).toHaveText('テスト本棚');
        await expect(page.locator('#art-drawer-list .art-drawer-item')).toHaveCount(3);

        // Esc で閉じてトリガーへフォーカスが戻る
        await page.click('#art-drawer-shelf-btn');
        await expect(page.locator('#art-drawer-shelf-popover')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#art-drawer-shelf-popover')).toBeHidden();
        await expect(btn).toBeFocused();

        expect(errors).toEqual([]);
    });
});

// 本棚ブロックの一括操作を選択式にし Undo を付けた (イシュー#55)。
// 設計: 選択なしのブロックバーは要素5個以下・1件以上選択で選択バーが出る・一括適用は Undo 付きトースト。
test.describe('本棚ブロックの操作整理 (イシュー#55)', () => {
    async function addShelfWithBooks(page, n) {
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        const drawerItems = page.locator('#art-drawer-list .art-drawer-item');
        const count = Math.min(n, await drawerItems.count());
        for (let i = 0; i < count; i++) { await drawerItems.nth(i).click(); }
    }

    test('選択なしのとき、ブロックバーの操作要素は5個以下 (ラベルを除く)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 4);

        await expect(page.locator('.art-shelf-selbar')).toHaveCount(0);
        const count = await page.locator('.art-block-bar').first().locator('button, select, .art-block-grip').count();
        expect(count).toBeLessThanOrEqual(5);
        expect(errors).toEqual([]);
    });

    test('行を1件チェックすると選択バーが出て一括操作が使え、選択解除で消える', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 3);

        await expect(page.locator('.art-shelf-selbar')).toHaveCount(0);
        await page.locator('.art-item-check').first().click();
        await expect(page.locator('.art-shelf-selbar')).toBeVisible();
        await expect(page.locator('.art-sel-show-sel')).toBeEnabled();
        await expect(page.locator('.art-shelf-sort-sel')).toBeEnabled();

        await page.locator('.art-sel-clear-btn').click();
        await expect(page.locator('.art-shelf-selbar')).toHaveCount(0);
        expect(errors).toEqual([]);
    });

    test('一括適用 (メモ表示) 後にトーストが出て「元に戻す」で適用前の状態に戻る', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 4);

        const snapshot = () => page.evaluate(() => window.bookshelf._artDraft.blocks[0].items.map(
            it => ({ id: it.id, show: { ...it.show }, order: it.order })
        ));
        const before = await snapshot();

        await page.locator('.art-item-check').nth(0).click();
        await page.locator('.art-item-check').nth(1).click();
        await page.locator('.art-sel-show-sel').selectOption('shortMemo:show');

        const toast = page.locator('.toast');
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('2冊に適用しました');
        const undoBtn = toast.locator('.toast-action');
        await expect(undoBtn).toBeVisible();

        // 適用されたことも確認しておく (Undo 前後の対比を明確にするため)
        const applied = await snapshot();
        expect(applied.find(it => it.id === before[0].id).show.shortMemo).toBe(true);
        expect(applied.find(it => it.id === before[1].id).show.shortMemo).toBe(true);

        await undoBtn.click();
        const after = await snapshot();
        expect(after).toEqual(before);
        expect(errors).toEqual([]);
    });

    test('「すべて選択」で全件選択でき、部分選択のときマスターチェックが Mixed になる', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 4);

        await page.locator('.art-item-check').first().click();
        await page.locator('.art-sel-all-btn').click();
        const allChecked = await page.locator('.art-item-check').evaluateAll(els => els.every(e => e.checked));
        expect(allChecked).toBe(true);

        await page.locator('.art-item-check').first().click(); // 1件外して部分選択にする
        const indeterminate = await page.locator('.art-shelf-select-all').evaluate(el => el.indeterminate);
        expect(indeterminate).toBe(true);
        expect(errors).toEqual([]);
    });

    test('各行の短/長トグルは枠なしで、オン時に aria-pressed と下線バー (色以外の手掛かり) が付く', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 1);

        const toggle = page.locator('.art-item-show-toggle').first();
        const off = await toggle.evaluate(el => {
            const s = getComputedStyle(el);
            return { top: s.borderTopStyle, left: s.borderLeftStyle, right: s.borderRightStyle, bottomColor: s.borderBottomColor, pressed: el.getAttribute('aria-pressed') };
        });
        expect(off.top).toBe('none');
        expect(off.left).toBe('none');
        expect(off.right).toBe('none');
        expect(off.pressed).toBe('false');

        await toggle.click();
        const on = await toggle.evaluate(el => {
            const s = getComputedStyle(el);
            return { bottomWidth: parseFloat(s.borderBottomWidth), bottomColor: s.borderBottomColor, pressed: el.getAttribute('aria-pressed') };
        });
        expect(on.pressed).toBe('true');
        expect(on.bottomWidth).toBeGreaterThan(0);
        // 色以外の手掛かり: on/off で下線の色そのものが切り替わっている (幅は常時2pxで固定・色で on/off を示す実装)
        expect(on.bottomColor).not.toBe(off.bottomColor);
        expect(errors).toEqual([]);
    });
});

// イシュー#133 項目3/5: 追加先ブロックの明示 (Nielsen #1 システム状態の可視性) とまとめて追加+歯止め。
test.describe('記事エディタ: 追加先ブロックの明示・まとめて追加 (イシュー#133)', () => {
    test('ブロックA作成→A強調→引き出しから追加→Aに入る。ブロックB作成→B強調に切替→引き出しから追加→Bに入る（Aは変化しない）', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        // ブロックA作成: 追加直後は自動的に追加先としてアクティブになる
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        const blockA = page.locator('.art-block').nth(0);
        await expect(blockA).toHaveClass(/is-add-target/);
        await expect(page.locator('#art-drawer-target-hint')).toContainText('本棚ブロック1');

        // 引き出しから1冊クリック→Aに入る
        await page.locator('#art-drawer-list .art-drawer-item').first().click();
        await expect(blockA.locator('.art-shelf-item')).toHaveCount(1);

        // ブロックB作成 (末尾へ追加): 自動的にBがアクティブへ切り替わり、Aの強調は外れる
        // .art-add-menu-item は先頭/末尾の各追加メニューに存在するため、開いた .art-add 内でスコープする
        // (グローバルな .first() だと閉じたままの先頭メニュー側にマッチしてクリックできない)。
        const lastAdd = page.locator('.art-add').last();
        await lastAdd.locator('.art-add-btn').click();
        await lastAdd.locator('.art-add-menu-item[data-block-type="shelf"]').click();
        const blockB = page.locator('.art-block').nth(1);
        await expect(blockB).toHaveClass(/is-add-target/);
        await expect(blockA).not.toHaveClass(/is-add-target/);
        await expect(page.locator('#art-drawer-target-hint')).toContainText('本棚ブロック2');

        // 引き出しから1冊クリック→Bに入る (Aは変化しない)
        await page.locator('#art-drawer-list .art-drawer-item').nth(1).click();
        await expect(blockB.locator('.art-shelf-item')).toHaveCount(1);
        await expect(blockA.locator('.art-shelf-item')).toHaveCount(1);

        // ブロックAをクリック→Aが再びアクティブになる (画面と実際の追加先が一致する)
        await blockA.click();
        await expect(blockA).toHaveClass(/is-add-target/);
        await expect(blockB).not.toHaveClass(/is-add-target/);
        await expect(page.locator('#art-drawer-target-hint')).toContainText('本棚ブロック1');
        await page.locator('#art-drawer-list .art-drawer-item').nth(2).click();
        await expect(blockA.locator('.art-shelf-item')).toHaveCount(2);
        await expect(blockB.locator('.art-shelf-item')).toHaveCount(1);

        expect(errors).toEqual([]);
    });

    test('まとめて追加: 検索で絞り込んだ状態は絞り込んだ分だけ追加され、閾値未満は確認ダイアログを挟まない', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();

        await page.locator('#art-drawer-search').fill('3');
        await expect(page.locator('#art-drawer-list .art-drawer-item')).toHaveCount(1);
        const addAllBtn = page.locator('#art-drawer-add-all');
        await expect(addAllBtn).toContainText('表示中の1冊を追加');

        await addAllBtn.click();
        await expect(page.locator('.cfm-box')).toHaveCount(0);
        await expect(page.locator('.art-shelf-item')).toHaveCount(1);
        await expect(page.locator('.art-shelf-item').first()).toContainText('フィクスチャの本 3');

        // 絞り込みを解除すると「すべての本」5冊が対象になる (閾値未満のためここも確認なし)
        await page.locator('#art-drawer-search').fill('');
        await expect(addAllBtn).toContainText('表示中の5冊を追加');

        expect(errors).toEqual([]);
    });

    test('まとめて追加: 実データ相当(800冊)で閾値(50冊)超は確認ダイアログが出て、キャンセルなら追加されずOKなら全件追加される', async ({ page }) => {
        const errors = await bootAppWithManyBooks(page, 800);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();

        const addAllBtn = page.locator('#art-drawer-add-all');
        await expect(addAllBtn).toContainText('表示中の800冊を追加');

        // キャンセル: 追加されない
        await addAllBtn.click();
        await expect(page.locator('.cfm-box')).toBeVisible();
        await expect(page.locator('.cfm-message')).toContainText('800');
        await page.locator('.cfm-cancel').click();
        await expect(page.locator('.cfm-box')).toHaveCount(0);
        await expect(page.locator('.art-shelf-item')).toHaveCount(0);

        // OK: 表示中の800冊が全件追加される
        await addAllBtn.click();
        await page.locator('.cfm-ok').click();
        await expect(page.locator('.art-shelf-item')).toHaveCount(800, { timeout: 15000 });

        expect(errors).toEqual([]);
    });
});

// イシュー#133 項目6: 短/長トグルが何の話か分からない (本人指摘) への説明+メモ内容。
// hover-only は使えない (ui-standards/ux-heuristics) ため、フォーカス/タッチでも同じ内容に到達できることを検証する。
test.describe('記事エディタ: 短/長トグルの説明+メモ内容 (イシュー#133)', () => {
    async function addShelfWithBooks(page, n) {
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        const drawerItems = page.locator('#art-drawer-list .art-drawer-item');
        const count = Math.min(n, await drawerItems.count());
        for (let i = 0; i < count; i++) { await drawerItems.nth(i).click(); }
    }

    test('キーボードフォーカスでツールチップが表示され、実際のメモ内容が入る。Escで閉じる', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 2); // fixture: B000000001=メモ無, B000000002=memo:"テストメモ"

        const item2 = page.locator('.art-shelf-item').nth(1); // B000000002
        const shortToggle = item2.locator('.art-item-show-toggle[data-show-key="shortMemo"]');
        await expect(shortToggle).toHaveAttribute('aria-describedby', 'art-item-tooltip');

        await shortToggle.focus();
        const tip = page.locator('#art-item-tooltip');
        await expect(tip).toBeVisible();
        await expect(tip).toContainText('短文メモを表示する');
        await expect(tip).toContainText('テストメモ');

        // Esc で閉じる (title 属性だけでなく、フォーカス経由でも同じ内容に到達できたことの確認込み)
        await page.keyboard.press('Escape');
        await expect(tip).toBeHidden();

        // 長トグル (このメモはメモ内容なし=hasDetailMemo 無し) にフォーカス → 「長文メモなし」
        const longToggle = item2.locator('.art-item-show-toggle[data-show-key="longMemo"]');
        await longToggle.focus();
        await expect(tip).toBeVisible();
        await expect(tip).toContainText('長文メモを表示する');
        await expect(tip).toContainText('長文メモなし');

        // blur でも消える (フォーカスが外れたら閉じる)
        await longToggle.blur();
        await expect(tip).toBeHidden();

        expect(errors).toEqual([]);
    });

    test('短文メモが空の本は「短文メモなし」、長文メモありの本は「長文メモあり」と出る', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 1); // B000000001 = 短文メモ無

        // fixture に長文メモありのケースが無いため hasDetailMemo を動的付与
        await page.evaluate(() => {
            const notes = window.bookshelf.userData.notes;
            notes['B000000001'] = { ...(notes['B000000001'] || {}), hasDetailMemo: true };
        });

        const item = page.locator('.art-shelf-item').first();
        const tip = page.locator('#art-item-tooltip');

        await item.locator('.art-item-show-toggle[data-show-key="shortMemo"]').focus();
        await expect(tip).toContainText('短文メモなし');

        await item.locator('.art-item-show-toggle[data-show-key="longMemo"]').focus();
        await expect(tip).toContainText('長文メモあり');

        expect(errors).toEqual([]);
    });

    test('ホバーでもツールチップが表示される (フォーカス到達経路と同じ内容)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 2);

        const shortToggle = page.locator('.art-shelf-item').nth(1).locator('.art-item-show-toggle[data-show-key="shortMemo"]');
        await shortToggle.hover();
        const tip = page.locator('#art-item-tooltip');
        await expect(tip).toBeVisible();
        await expect(tip).toContainText('テストメモ');

        await page.mouse.move(0, 0);
        await expect(tip).toBeHidden();

        expect(errors).toEqual([]);
    });
});

test.describe('記事エディタ: 短/長トグルのツールチップ タッチ到達 (390x844・タッチ有効, イシュー#133)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('tap すると一定時間ツールチップが表示され、トグルも実行される', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        await page.locator('#art-drawer-list .art-drawer-item').nth(1).click(); // B000000002

        const shortToggle = page.locator('.art-shelf-item').first().locator('.art-item-show-toggle[data-show-key="shortMemo"]');
        await expect(shortToggle).not.toHaveClass(/is-on/);

        await shortToggle.tap();
        const tip = page.locator('#art-item-tooltip');
        await expect(tip).toBeVisible();
        await expect(tip).toContainText('テストメモ');
        // tap はトグルも実行する (表示/非表示の切替と、内容を見る手掛かりを両立させる設計)
        await expect(shortToggle).toHaveClass(/is-on/);

        // 一定時間後に自動で消える (タッチには hover/focusout に相当する「離れる」操作が無いため)
        await expect(tip).toBeHidden({ timeout: 4000 });

        expect(errors).toEqual([]);
    });
});

// 星(評価)トグル: 短文/長文メモと同じ仕組みに show.rating を乗せた (イシュー#135)。
test.describe('記事エディタ: 星(評価)トグル (イシュー#135)', () => {
    async function addShelfWithBooks(page, n) {
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="shelf"]').first().click();
        const drawerItems = page.locator('#art-drawer-list .art-drawer-item');
        const count = Math.min(n, await drawerItems.count());
        for (let i = 0; i < count; i++) { await drawerItems.nth(i).click(); }
    }

    test('アイテムの星トグルはオン→保存→リロード→オンのまま (articles.json 永続化)', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 1);

        const ratingToggle = page.locator('.art-item-show-toggle[data-show-key="rating"]').first();
        await expect(ratingToggle).not.toHaveClass(/is-on/);
        await ratingToggle.click();
        await expect(ratingToggle).toHaveClass(/is-on/);
        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });

        // articles.json 相当の書込結果を退避し、reload 後の新しい adapter へ再注入する
        // (bootApp の Map はブラウザコンテキストごと消えるため、reload では自動的に持ち越されない)。
        const persisted = await page.evaluate(() => window.bookshelf.storage.adapter.readJSON('private/publish/articles.json'));
        expect(persisted).toBeTruthy();

        const errors2 = await bootApp(page, persisted);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await expect(page.locator('.pp-row')).toHaveCount(1);
        await page.locator('.pp-row [data-act="edit"]').first().click();

        const ratingToggleAfter = page.locator('.art-item-show-toggle[data-show-key="rating"]').first();
        await expect(ratingToggleAfter).toHaveClass(/is-on/);
        await expect(ratingToggleAfter).toHaveAttribute('aria-pressed', 'true');
        expect(errors).toEqual([]);
        expect(errors2).toEqual([]);
    });

    test('ブロック単位の星トグルも同じ操作感でオン/オフでき、短文/長文メモと並ぶ', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="book"]').first().click();
        await page.locator('#art-drawer-list .art-drawer-item').first().click();

        const toggles = page.locator('.art-book-show-toggle');
        await expect(toggles).toHaveCount(3);
        const ratingToggle = page.locator('.art-book-show-toggle[data-show-key="rating"]');
        await expect(ratingToggle).toHaveText('評価');
        await expect(ratingToggle).not.toHaveClass(/is-on/);
        await ratingToggle.click();
        await expect(ratingToggle).toHaveClass(/is-on/);
        expect(errors).toEqual([]);
    });

    test('一括操作セレクトに評価の表示/非表示が6択目として入り、選択した本にだけ適用される', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addShelfWithBooks(page, 2);

        await page.locator('.art-item-check').first().click();
        const options = await page.locator('.art-sel-show-sel option').allTextContents();
        expect(options).toEqual(['表示の一括変更…', '短文メモを表示', '短文メモを隠す', '長文メモを表示', '長文メモを隠す', '評価を表示', '評価を隠す']);

        await page.locator('.art-sel-show-sel').selectOption('rating:show');
        await expect(page.locator('.toast')).toContainText('1冊に適用しました');

        const shows = await page.evaluate(() => window.bookshelf._artDraft.blocks[0].items.map(it => !!(it.show && it.show.rating)));
        expect(shows).toEqual([true, false]);
        expect(errors).toEqual([]);
    });
});

// イシュー#35: 同期先への保存・読込の失敗を握り潰さず画面に出す (例外の握り潰し修正)。
// この describe の各テストは意図的に adapter を失敗させるため、console.error が出ることを許容する
// (errors 配列を捕捉はするが空であることは assert しない)。
test.describe('保存/読込の失敗が画面に出る (イシュー#35)', () => {
    test('保存に失敗すると #art-save-status がエラー表示になり、直ると「保存しました」に変わる', async ({ page }) => {
        await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        // writeJSON を必ず失敗させる (通信/認証/権限エラー等を想定)
        await page.evaluate(() => {
            window.bookshelf.storage.adapter.writeJSON = async () => { throw new Error('write failed'); };
        });
        await page.fill('#art-title', '保存できるはずのタイトル');
        await expect(page.locator('#art-save-status')).toHaveClass(/is-error/, { timeout: 3000 });
        await expect(page.locator('#art-save-status')).toContainText('保存できませんでした');
        await expect(page.locator('#art-save-retry')).toBeVisible();

        // 復旧: writeJSON を成功に戻して「もう一度保存」を押すと表示が変わる (成功/失敗で表示が変わることの検証)
        await page.evaluate(() => {
            const mem = new Map();
            window.bookshelf.storage.adapter.writeJSON = async (path, data) => { mem.set(path, data); };
        });
        await page.click('#art-save-retry');
        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });
        await expect(page.locator('#art-save-status')).not.toHaveClass(/is-error/);
        await expect(page.locator('#art-save-retry')).toBeHidden();
    });

    test('記事一覧の読込に失敗すると異常行が出て「0件」とは区別される・新規作成もできない', async ({ page }) => {
        await bootApp(page);
        await page.evaluate(() => {
            window.bookshelf.storage.adapter.readJSON = async () => { throw new Error('read failed'); };
        });
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());

        await expect(page.locator('#art-list .pp-error')).toBeVisible();
        await expect(page.locator('#art-list')).not.toContainText('まだ公開記事がありません');
        await expect(page.locator('#art-new')).toBeDisabled();
    });

    test('読込失敗がハブの認証切れのときは再ログイン文言＋「設定を開く」で設定モーダルが開く', async ({ page }) => {
        await bootApp(page);
        await page.evaluate(() => {
            window.bookshelf.storage.adapter.readJSON = async () => { throw new window.HubAuthError('認証切れ'); };
        });
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());

        await expect(page.locator('#art-list .pp-error')).toContainText('認証が切れました');
        await page.click('#art-list [data-act="open-settings"]');
        await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    });

    test('保存先に未接続のまま開くと通知が出て新規作成できない (編集させない)', async ({ page }) => {
        await bootApp(page);
        await page.evaluate(() => { window.bookshelf._isSyncReady = () => false; });
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());

        await expect(page.locator('#art-store-notice')).toBeVisible();
        await expect(page.locator('#art-store-notice-text')).toContainText('接続していない');
        await expect(page.locator('#art-new')).toBeDisabled();
    });

    // 記事以外の握り潰し (B-1): 長文メモの読込失敗がテンプレートと取り違えられ、保存すると
    // 既存メモを上書きしてしまう事故を防ぐ。
    test('長文メモの読込に失敗すると、テンプレートで開かず読み込めなかった旨が出て保存が止まる', async ({ page }) => {
        await bootApp(page);
        await page.evaluate(() => {
            window.bookshelf.storage.adapter.readText = async () => { throw new Error('read failed'); };
        });
        await page.evaluate(() => {
            const b = window.bookshelf.books[0];
            return window.bookshelf._openBookMemoInAppEditor(b.asin, b);
        });

        await expect(page.locator('#book-memo-modal')).toHaveClass(/show/);
        await expect(page.locator('#book-memo-status')).toContainText('読み込めませんでした');
        // エディタは作られず、保存導線 (_bookMemoEditorContext) も張られていない (保存を止める)
        expect(await page.evaluate(() => !!window.bookshelf._bookMemoEditor)).toBe(false);
        expect(await page.evaluate(() => window.bookshelf._bookMemoEditorContext)).toBeNull();
    });
});

// イシュー#42: ブロックが増えるほど末尾の「+ ブロックを追加」メニューが画面外に出て選べなくなる回帰。
// toBeVisible() は DOM 上可視なだけで通ってしまうため使わず、getBoundingClientRect() で
// ビューポート内に収まっているかを実測する。
async function addTextBlocks(page, count) {
    for (let i = 0; i < count; i++) {
        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();
    }
}

async function expectMenuWithinViewport(page, btnLocator) {
    await btnLocator.click();
    const menu = page.locator('.art-add-menu:not([hidden])');
    await expect(menu).toHaveCount(1);
    const viewport = page.viewportSize();
    const expectBoxWithin = (box) => {
        expect(box).not.toBeNull();
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    };
    expectBoxWithin(await menu.boundingBox());
    // アンカー(ボタン)自身も画面内にあること (イシュー#82 完了条件)
    expectBoxWithin(await btnLocator.boundingBox());
    // メニュー全3項目 (文章/本棚/本) それぞれが画面内にあること (イシュー#82 完了条件)
    const items = menu.locator('.art-add-menu-item');
    await expect(items).toHaveCount(3);
    for (let i = 0; i < 3; i++) expectBoxWithin(await items.nth(i).boundingBox());
    // 次のケースに影響しないよう閉じる
    await btnLocator.click();
}

function registerAddMenuViewportTests() {
    for (const blockCount of [0, 3, 10]) {
        test(`ブロック${blockCount}個: 先頭・末尾の追加メニューがビューポート内に収まる`, async ({ page }) => {
            const errors = await bootApp(page);
            await page.evaluate(() => window.bookshelf.openPublishPagesModal());
            await page.click('#art-new');

            await addTextBlocks(page, blockCount);
            await expect(page.locator('.art-block')).toHaveCount(blockCount);

            await expectMenuWithinViewport(page, page.locator('.art-add-btn').first());
            await expectMenuWithinViewport(page, page.locator('.art-add-btn').last());
            expect(errors).toEqual([]);
        });
    }
}

test.describe('記事エディタ: ブロック追加メニューがビューポート内に収まる (PC幅・1280x720, イシュー#42)', () => {
    test.use({ viewport: { width: 1280, height: 720 } });
    registerAddMenuViewportTests();
});

test.describe('記事エディタ: ブロック追加メニューがビューポート内に収まる (スマホ幅・390x844・タッチ有効, イシュー#42)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
    registerAddMenuViewportTests();
});

// イシュー#59: 新規作成直後 (ブロック0個・実データ相当800冊の引き出し) にモーダルがビューポートに
// 収まらず外側スクロールが要る回帰。toBeVisible() は DOM 上可視なだけで通ってしまうため使わず、
// scrollHeight/clientHeight と getBoundingClientRect() を実測して判定する。
async function rectOf(page, selector) {
    return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    }, selector);
}

test.describe('記事エディタ: 新規作成直後がビューポートに収まる (実データ相当800冊, イシュー#59)', () => {
    for (const vp of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }]) {
        test(`${vp.width}x${vp.height}: モーダルが外側スクロール無しで収まり、引き出しだけが内側スクロールする`, async ({ page }) => {
            await page.setViewportSize(vp);
            const errors = await bootAppWithManyBooks(page);
            await page.evaluate(() => window.bookshelf.openPublishPagesModal());
            await page.click('#art-new');
            await page.waitForSelector('#art-edit-view:not([hidden])');

            const modal = await rectOf(page, '.modal-content');
            expect(modal.scrollHeight).toBeLessThanOrEqual(modal.clientHeight);

            const editView = await rectOf(page, '#art-edit-view');
            expect(editView.top).toBeGreaterThanOrEqual(0);
            expect(editView.bottom).toBeLessThanOrEqual(vp.height);

            const side = await rectOf(page, '.art-side');
            expect(side.top).toBeGreaterThanOrEqual(0);
            expect(side.bottom).toBeLessThanOrEqual(vp.height);

            // 内側スクロールが引き出しリストの1箇所だけであること (二重スクロールにしない)
            const drawerList = await rectOf(page, '.art-drawer-list');
            expect(drawerList.scrollHeight).toBeGreaterThan(drawerList.clientHeight);

            expect(errors).toEqual([]);
        });
    }
});

test.describe('記事エディタ: 新規作成直後のスマホ幅が横スクロールせず引き出しに到達できる (390x844・タッチ有効, イシュー#59)', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('横スクロールが発生せず、下へスクロールすれば引き出しの本が見える', async ({ page }) => {
        const errors = await bootAppWithManyBooks(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await page.waitForSelector('#art-edit-view:not([hidden])');

        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollWidth).toBeLessThanOrEqual(390);

        await page.locator('.art-side').scrollIntoViewIfNeeded();
        await expect(page.locator('#art-drawer-list .art-drawer-item').first()).toBeVisible();

        expect(errors).toEqual([]);
    });
});

test.describe('記事エディタ: 空状態の案内 (イシュー#59)', () => {
    test('ブロック0個のとき案内が表示され、ブロックを1個追加すると消える', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');

        await expect(page.locator('.art-empty')).toHaveCount(1);
        await expect(page.locator('.art-empty')).toContainText('ブロックがありません');

        await page.locator('.art-add-btn').first().click();
        await page.locator('.art-add-menu-item[data-block-type="text"]').first().click();

        await expect(page.locator('.art-block')).toHaveCount(1);
        await expect(page.locator('.art-empty')).toHaveCount(0);

        expect(errors).toEqual([]);
    });
});

// イシュー#82 回帰1: #art-edit-view[hidden] が同詳細度の後勝ちルールで無効化され、一覧と編集が
// 同時に表示されていた。toBeVisible() は DOM 上可視なだけで通ってしまう (hidden が効いていなくても
// display:flex で表示されていれば true になる) ため使わず、getComputedStyle().display で実測する。
async function displayOf(page, selector) {
    return page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).display, selector);
}

test.describe('記事エディタ: 一覧⇄編集ビューの相互排他表示 (イシュー#82)', () => {
    test('記事2件以上ある状態で 新規作成→編集→←で一覧 を通しても、一覧に戻った時点で編集ビューが非表示になる', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());

        // 記事を2件作る (依頼に沿って「記事が既に存在する状態」を再現する)
        await page.click('#art-new');
        await page.fill('#art-title', '記事1');
        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });
        await page.click('#art-back');

        await page.click('#art-new');
        await page.fill('#art-title', '記事2');
        await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });
        await page.click('#art-back');

        await expect(page.locator('#art-list .pp-row')).toHaveCount(2);
        // 一覧表示中は編集ビューが非表示であること
        expect(await displayOf(page, '#art-edit-view')).toBe('none');

        // 一覧の行から編集を開く (逆方向: 開いたら一覧が非表示になること)
        await page.locator('#art-list .pp-row').first().locator('[data-act="edit"]').click();
        await page.waitForSelector('#art-edit-view:not([hidden])');
        expect(await displayOf(page, '#art-list-view')).toBe('none');

        // ← で一覧へ戻ると、編集ビューが非表示に戻ること (回帰1本体)
        await page.click('#art-back');
        await page.waitForSelector('#art-list-view:not([hidden])');
        expect(await displayOf(page, '#art-edit-view')).toBe('none');
        expect(await displayOf(page, '#art-list-view')).not.toBe('none');

        // 再度編集へ入っても同じく一覧側が非表示になること (往復で崩れないことの確認)
        await page.locator('#art-list .pp-row').last().locator('[data-act="edit"]').click();
        await page.waitForSelector('#art-edit-view:not([hidden])');
        expect(await displayOf(page, '#art-list-view')).toBe('none');
        expect(await displayOf(page, '#art-edit-view')).not.toBe('none');

        expect(errors).toEqual([]);
    });
});

// イシュー#82 回帰2: .art-col が overflow:auto のスクロールコンテナ化 (イシュー#59) した結果、
// position:absolute だった .art-add-menu が中間スクロール位置でクリップされ、3項目目が見切れていた。
// 先頭/末尾のアンカーだけでは再現しない (フリップ判定で回避されるため)。中間までスクロールした
// 状態で開いたときも、既存の expectMenuWithinViewport と同じ基準 (getBoundingClientRect() で
// top>=0 && bottom<=innerHeight, 横も同様) で全項目+アンカーが収まることを検証する。
test.describe('記事エディタ: スクロールコンテナ中間位置でもブロック追加メニューがクリップされない (イシュー#82, 1280x720)', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('10ブロックで .art-col を中間までスクロールした位置の追加ボタンでも、メニュー全3項目+アンカーが画面内に収まる', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        await addTextBlocks(page, 10);
        await expect(page.locator('.art-block')).toHaveCount(10);

        // Playwright の自動 scrollIntoView に頼ると端に寄ってしまい再現しないため、
        // .art-col を明示的に中間スクロールしてから force click する。
        await page.evaluate(() => {
            const col = document.querySelector('.art-col');
            col.scrollTop = (col.scrollHeight - col.clientHeight) / 2;
        });
        const btns = page.locator('.art-add-btn');
        const count = await btns.count();
        const artColRect = await page.evaluate(() => document.querySelector('.art-col').getBoundingClientRect().toJSON());
        let targetIdx = Math.floor(count / 2);
        for (let i = 0; i < count; i++) {
            const r = await btns.nth(i).boundingBox();
            if (r && r.y > artColRect.top + 40 && r.y < artColRect.top + artColRect.height / 2 + 40) { targetIdx = i; break; }
        }
        const targetBtn = btns.nth(targetIdx);
        await targetBtn.click({ force: true });

        const menu = page.locator('.art-add-menu:not([hidden])');
        await expect(menu).toHaveCount(1);
        // 祖先 (.art-col) の overflow:auto に影響されない position:fixed であることも確認する
        // (position:absolute へ戻す退行が起きると、このアサーションだけが検知できる)
        expect(await page.evaluate(() => getComputedStyle(document.querySelector('.art-add-menu:not([hidden])')).position)).toBe('fixed');

        const viewport = page.viewportSize();
        const expectBoxWithin = (box) => {
            expect(box).not.toBeNull();
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        };
        expectBoxWithin(await targetBtn.boundingBox());
        const items = menu.locator('.art-add-menu-item');
        await expect(items).toHaveCount(3);
        for (let i = 0; i < 3; i++) expectBoxWithin(await items.nth(i).boundingBox());

        expect(errors).toEqual([]);
    });
});
