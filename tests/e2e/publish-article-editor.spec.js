// 記事エディタ (公開v2 S3, ADR-058 §11) の基本操作・プレビュー・公開結線を経路で検証する。
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
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
    // LocalFSAdapter は実 dirHandle を持たない (picker 未操作) ため、記事ストアの読み書きだけ
    // メモリ上のマップへ差し替える (userData/library とは独立した private/publish/articles.json のみ対象)。
    await page.evaluate(() => {
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
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
            localStorage.setItem('bookshelf_sync', JSON.stringify({
                method: 'local',
                hub: { key: 'hk_test', apiBase: hub, email: 'test@example.com', plan: 'free', publicBase: `${hub}/public/sid/`, siteId: 'sid' },
                publish: { target: 'hub' }
            }));
        }, [fixtureUserData, fixtureLibrary, HUB]);
        await page.goto('/index.html');
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
        await page.evaluate((library) => {
            const mem = new Map();
            // export() は state を渡さず app.storage.loadAll() を使う実経路なので、蔵書データも仕込む
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
        expect(article.lastBuiltAt).toBeTruthy();
        await expect(page.locator('#art-unpublish')).toBeVisible();
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

        await page.locator('.art-shelf-sort-sel').selectOption('title');
        const titles = await page.evaluate(() => {
            const items = window.bookshelf._artDraft.blocks[0].items;
            return items.map(it => (window.bookshelf.books.find(b => b.asin === it.asin) || {}).title);
        });
        const sorted = [...titles].sort((a, b) => a.localeCompare(b, 'ja'));
        expect(titles).toEqual(sorted);
        expect(errors).toEqual([]);
    });

    test('右ペインの説明文が短い定型文になっている', async ({ page }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await page.click('#art-new');
        const note = await page.locator('.art-drawer-note').textContent();
        expect(note.length).toBeLessThanOrEqual(20);
        expect(errors).toEqual([]);
    });
});
