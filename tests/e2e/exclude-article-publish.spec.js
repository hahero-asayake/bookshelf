// イシュー#669 step1: 除外する前から記事に置いてあった本を、画面から除外したあと、
// 記事の閲覧キャンバス・編集キャンバス・本棚ブロックの全画面編集・プレビュー・公開物 (ハブの模擬へ送られたファイル) に
// その本がどう出るかを測る。除外を記事に効かせるかの決まりは、まだ無い (step2 で決める)。
// どの案になっても成り立つ「プレビュー・キャンバスと公開物が一致する」だけを期待にする＝今は赤のまま。
// 観測は [669-obs] の行に JSON で出す (scripts/verify/669-results.md §1 の元)。
import { test, expect } from './helpers/test-base.js';
import { canvas, openArtEditor, openArtPreview, editArtBlockViaMenu } from './helpers/art-editor.js';
import { mockSyncReady, stubScheduleSync } from './helpers/sync.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

const HUB = 'https://mockhub.test';
const X = 'B000000001';           // 除外する本 (本ブロックと本棚ブロックの両方に置く)
const Y = 'B000000002';           // 除外しない本 (本棚ブロックに置く)
const X_TITLE = 'フィクスチャの本 1';
const Y_TITLE = 'フィクスチャの本 2';

// 公開結線 (tests/e2e/publish-article-editor.spec.js の bootAppForPublish) と同じ形。
// export() は state を渡さず storage.loadAll() を読むので、保存先 (メモリ上の Map) にも蔵書を置く。
async function boot(page) {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    const hub = { publishes: [] };
    await page.route(`${HUB}/**`, async (route) => {
        const url = route.request().url();
        if (url.includes('/publish')) {
            const body = route.request().postDataJSON();
            hub.publishes.push({ files: body.files, index: body.index });
            return route.fulfill({ json: { ok: true, siteUrl: `${HUB}/public/sid/` } });
        }
        if (url.includes('/usage')) return route.fulfill({ json: { plan: 'free', usedBytes: 0, quotaBytes: 100 * 1048576 } });
        return route.fulfill({ status: 404, json: {} });
    });
    await page.addInitScript(([userData, library, hubBase]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'local',
            hub: {
                key: 'hk_test', apiBase: hubBase, email: 'test@example.com', plan: 'free',
                publicBase: `${hubBase}/public/sid/`, siteId: 'sid',
                username: 'hahero', bookshelfBase: 'https://bookshelf.asayake.org/hahero/'
            },
            publish: { target: 'hub' }
        }));
    }, [fixtureUserData, fixtureLibrary, HUB]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => { window.HubAuth.renderSignInButton = () => {}; });
    await page.evaluate(([library, notes]) => {
        const mem = new Map();
        mem.set('private/library.json', library);
        mem.set('private/bookshelves.json', { bookshelves: [{ internalId: 'fixall001', slug: 'all', name: 'すべて', isSpecial: true }] });
        mem.set('private/bookshelves/all.json', { books: library.books.map(b => b.asin) });
        mem.set('private/notes.json', { notes });
        window.__mem669 = mem;
        window.__writes669 = [];
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { window.__writes669.push(path); mem.set(path, JSON.parse(JSON.stringify(data))); };
        window.bookshelf.flushSync = async () => {};
    }, [JSON.parse(fixtureLibrary), JSON.parse(fixtureUserData).notes]);
    await mockSyncReady(page, true);
    await stubScheduleSync(page);
    return { errors, hub };
}

const has = (html, s) => (html || '').includes(s);
const look = (html) => ({ xTitle: has(html, X_TITLE), xAsin: has(html, X), xDp: has(html, `/dp/${X}`), yTitle: has(html, Y_TITLE) });

// キャンバスは閲覧でも編集でも build(markBlocks) の生成HTML。各ブロックの <section> に data-art-idx が付く (0=文章・1=本X・2=本棚)
async function readCanvas(page, { edit = false } = {}) {
    await expect(canvas(page).locator('h1')).toBeVisible();
    if (edit) await expect(canvas(page).locator('.art-cv-more').first()).toBeVisible();
    const html = await canvas(page).locator('body').innerHTML();
    const idxs = await canvas(page).locator('[data-art-idx]').evaluateAll(els => els.map(e => e.getAttribute('data-art-idx')));
    return { ...look(html), blockIdxs: idxs, bookMenu: await canvas(page).locator('.art-cv-more[data-blk-idx="1"]').count() };
}

async function readPreview(page) {
    await openArtPreview(page);
    await expect(page.locator('#pp-preview-modal')).toHaveClass(/show/);
    await expect.poll(() => page.evaluate(() => document.getElementById('pp-preview-progress')?.hidden ?? true)).toBe(true);
    await expect.poll(() => page.evaluate(() => (document.getElementById('pp-preview-frame').srcdoc || '').length)).toBeGreaterThan(0);
    const srcdoc = await page.evaluate(() => document.getElementById('pp-preview-frame').srcdoc);
    await page.keyboard.press('Escape');
    await expect(page.locator('#pp-preview-modal')).not.toHaveClass(/show/);
    return look(srcdoc);
}

// 公開パネル→「公開する/更新する」→ (初回だけの同意) → ハブの模擬が受けたファイルを読む
async function publish(page, hub) {
    const before = hub.publishes.length;
    if (await page.locator('#art-mode-edit').isVisible()) await page.locator('#art-mode-edit').click();
    const headerBtn = page.locator('#art-publish-header');
    if (await headerBtn.isVisible()) await headerBtn.click();
    else await page.click('#art-bar-publish');
    await expect(page.locator('#art-publish-modal')).toHaveClass(/show/);
    const go = page.locator('#art-pub-go');
    const goEnabled = await go.isEnabled();
    if (!goEnabled) return { goEnabled, files: null };
    await go.click();
    await expect.poll(async () => {
        if (await page.locator('.cfm-box').isVisible()) await page.click('.cfm-ok');
        return hub.publishes.length;
    }).toBeGreaterThan(before);
    const { files, index } = hub.publishes[hub.publishes.length - 1];
    await expect(page.locator('.toast-success', { hasText: '公開しました' }).last()).toBeVisible();
    await page.click('#art-pub-close');
    const article = files.find(f => f.path !== 'index.html' && f.path.endsWith('/index.html'));
    return {
        goEnabled,
        paths: files.map(f => f.path),
        withX: files.filter(f => typeof f.content === 'string' && (has(f.content, X) || has(f.content, X_TITLE))).map(f => f.path),
        article: look(article && article.content),
        indexHasX: has(JSON.stringify(index || null), X) || has(JSON.stringify(index || null), X_TITLE),
        indexBooks: (index || []).map(i => i.books)
    };
}

test.use({ viewport: { width: 1280, height: 800 } });

test('除外する前から記事に置いた本を除外すると、プレビュー・キャンバスと公開物で出方が一致する (#669 step1・今は赤)', async ({ page }) => {
    test.setTimeout(120_000);
    const { errors, hub } = await boot(page);
    const obs = {};

    // 除外する前に記事を作る (本ブロック X・本棚ブロック X と Y・文章)。本だけのブロックを足す画面の入口は
    // #528 で無くなったため、既存の記事として保存先に置く (除外する前から記事にあった、という前提の再現)。
    const id = await page.evaluate(async ([x, y]) => {
        const a = await window.bookshelf.publishArticleStore.create({
            title: '除外の実測669', sourceShelfId: 'fixall001',
            blocks: [
                { type: 'text', markdown: '本文669' },
                { type: 'book', asin: x, show: { shortMemo: true, rating: false, longMemo: false } },
                { type: 'shelf', shelfId: 'fixall001', items: [{ asin: x }, { asin: y }] }
            ]
        });
        return a.id;
    }, [X, Y]);

    await test.step('画面から本 X を除外する (本の詳細の編集→除外→確認)', async () => {
        await page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-label').click();
        await expect(page.locator('body')).toHaveClass(/app-view-bookshelf/);
        await page.locator(`#bookshelf .book-item[data-asin="${X}"]`).first().click();
        await page.locator(`.edit-mode-btn[data-asin="${X}"]`).first().click();
        await page.locator(`.exclude-btn[data-asin="${X}"]`).first().click();
        await page.locator('.cfm-ok').click();
        await expect(page.locator('.toast-success', { hasText: '除外しました' })).toBeVisible();
        // 同期の書き出しが保存先へ書く形 (bookshelf.js の syncToObsidianFolder: exclusions.json={excludedASINs}・
        // library.json は除外を含む全書誌のまま) を、メモリ上の保存先へ写す (この spec は同期を止めているため)。
        obs.storageAfterExclude = await page.evaluate(() => {
            const mem = window.__mem669;
            mem.set('private/exclusions.json', { excludedASINs: [...(window.bookshelf.userData._storage.exclusions || [])] });
            return { exclusions: mem.get('private/exclusions.json').excludedASINs, libraryHasX: mem.get('private/library.json').books.some(b => b.asin === 'B000000001'), appBooksHasX: window.bookshelf.books.some(b => b.asin === 'B000000001') };
        });
        await page.keyboard.press('Escape');
    });

    await test.step('除外の後: 記事の閲覧キャンバス・編集キャンバス・本棚ブロックの全画面編集・プレビュー・公開', async () => {
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await openArtEditor(page, id);
        obs.viewCanvas = await readCanvas(page);
        await page.locator('#art-mode-edit').click();
        obs.editCanvas = await readCanvas(page, { edit: true });
        // 本棚ブロックは 3つめ (idx=2)。全画面編集の中の配置の表示を読む
        await editArtBlockViaMenu(page, 2);
        await expect(page.locator('#art-fs-done')).toBeVisible();
        // 本棚ブロックの全画面編集の配置の行 (.art-fs-ttl＝article-editor.js の _artRenderShelfFs・this.books に無ければ題の代わりに ASIN)
        await expect(page.locator('.art-fs-ttl').first()).toBeVisible();
        obs.shelfFsTitles = await page.locator('.art-fs-ttl').allInnerTexts();
        await page.click('#art-fs-done');
        obs.preview = await readPreview(page);
        obs.publish = await publish(page, hub);
        obs.writesAfterPublish = await page.evaluate(() => [...new Set(window.__writes669)]);
    });

    await test.step('除外を取り消した後 (設定の「除外した本」→元に戻す): プレビュー・公開', async () => {
        if (await page.locator('#art-back').isVisible()) await page.click('#art-back');
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.bookshelf.showExclusionsModal());
        await expect(page.locator('#exclusions-modal')).toHaveClass(/show/);
        await page.locator(`#exclusions-list .unexclude-btn[data-asin="${X}"]`).click();
        await expect(page.locator(`#exclusions-list .unexclude-btn[data-asin="${X}"]`)).toHaveCount(0);
        await page.evaluate(() => {
            window.__mem669.set('private/exclusions.json', { excludedASINs: [...(window.bookshelf.userData._storage.exclusions || [])] });
        });
        for (let i = 0; i < 4 && (await page.locator('#settings-modal.show, #exclusions-modal.show').count()) > 0; i++) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(150);
        }
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await openArtEditor(page, id);
        // 開き直した直後のキャンバスは前の文書のまま残る (描き直しは 80ms 後に予約・_artQueueCanvas) ＝本Xが出るまで最大5秒読み直す
        const t0 = Date.now();
        await expect.poll(async () => (await readCanvas(page)).xTitle, { timeout: 5000 }).toBe(true).catch(() => {});
        obs.viewCanvasAfterUndo = { ...(await readCanvas(page)), waitedMs: Date.now() - t0 };
        obs.previewAfterUndo = await readPreview(page);
        obs.publishAfterUndo = await publish(page, hub);
    });

    console.log('[669-obs] ' + JSON.stringify(obs));
    test.info().annotations.push({ type: '669-obs', description: JSON.stringify(obs) });

    // どの案になっても成り立つこと: 公開物に本 X が出るかは、プレビュー・キャンバスと一致する
    expect.soft(obs.publish.article.xTitle, '除外の後: 公開物の本Xの題 = プレビュー').toBe(obs.preview.xTitle);
    expect.soft(obs.publish.article.xTitle, '除外の後: 公開物の本Xの題 = 閲覧キャンバス').toBe(obs.viewCanvas.xTitle);
    // 対照: 取り消した後はどこにも出る
    expect.soft(obs.previewAfterUndo.xTitle, '取り消し後: プレビューに本X').toBe(true);
    expect.soft(obs.publishAfterUndo.article.xTitle, '取り消し後: 公開物に本X').toBe(true);
    expect.soft(obs.publish.article.yTitle, '除外の後も本Yは公開物に出る').toBe(true);
    expect(errors).toEqual([]);
});
