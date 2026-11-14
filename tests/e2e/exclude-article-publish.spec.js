// イシュー#669: 除外する前から記事に置いてあった本を、画面から除外したあと、記事の閲覧キャンバス・編集キャンバス・
// 本棚ブロックの全画面編集・公開前チェック・プレビュー・公開物 (ハブの模擬へ送られたファイル) にその本がどう出るかを確かめる。
// 決まり (ADR・02 D-7): 除外した本は、記事に置いたままでも公開に出さない。記事のデータは書き換えず、除外を取り消すと次の公開から戻る。
// 判定は generator の publishableLibMap の1か所 (公開・キャンバス・プレビューが同じ build を通る)。
// 編集画面は「除外中」の印を出す。公開中の記事に入っている本は、除外の確認文で件数を知らせる。
// step1 (aed567d) の観測は scripts/verify/669-results.md §1。観測は [669-obs] の行に JSON で出す (§3 の元)。
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
const look = (html) => ({ xTitle: has(html, X_TITLE), xAsin: has(html, X), yTitle: has(html, Y_TITLE) });

// キャンバスは閲覧でも編集でも build(markBlocks) の生成HTML。各ブロックの <section> に data-art-idx が付く (0=文章・1=本X・2=本棚)。
// 編集状態だけ、枠・⋯・除外中の印 (.art-cv-excluded) を足す。
// キャンバスは同じ iframe へ doc.open/write で描き直す (80ms 後に予約・_artQueueCanvas)。開き直しや編集への切替の直後は
// 前の文書が残るため、操作の前に今の文書へ印を付け、印の無い (描き直された) 文書になってから読む。
async function markCanvasStale(page) {
    await page.evaluate(() => { const d = document.getElementById('art-canvas-frame')?.contentDocument; if (d && d.body) d.body.setAttribute('data-stale669', '1'); });
}
async function waitCanvasFresh(page) {
    await expect.poll(() => page.evaluate(() => {
        const d = document.getElementById('art-canvas-frame')?.contentDocument;
        return !!(d && d.body && !d.body.hasAttribute('data-stale669') && d.querySelector('h1'));
    }), { timeout: 5000 }).toBe(true);
}

async function readCanvas(page, { edit = false } = {}) {
    await waitCanvasFresh(page);
    await expect(canvas(page).locator('h1')).toBeVisible();
    if (edit) await expect(canvas(page).locator('.art-cv-more').first()).toBeVisible();
    const html = await canvas(page).locator('body').innerHTML();
    const idxs = await canvas(page).locator('[data-art-idx]').evaluateAll(els => els.map(e => e.getAttribute('data-art-idx')));
    return { ...look(html), blockIdxs: idxs, excludedNotes: await canvas(page).locator('.art-cv-excluded').allInnerTexts() };
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

// 公開パネル (公開前チェックの文を読む) →「公開する/更新する」→ (初回だけの同意) → ハブの模擬が受けたファイルを読む
async function publish(page, hub) {
    const before = hub.publishes.length;
    if (await page.locator('#art-mode-edit').isVisible()) await page.locator('#art-mode-edit').click();
    const headerBtn = page.locator('#art-publish-header');
    if (await headerBtn.isVisible()) await headerBtn.click();
    else await page.click('#art-bar-publish');
    await expect(page.locator('#art-publish-modal')).toHaveClass(/show/);
    // 公開前チェックの行は畳まれている (見出しは「公開できます（確認N件）」) ＝畳まれた中身も読む
    const panelText = await page.locator('#art-publish-modal').textContent();
    const go = page.locator('#art-pub-go');
    await expect(go).toBeEnabled();
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
        panelText,
        paths: files.map(f => f.path),
        withX: files.filter(f => typeof f.content === 'string' && (has(f.content, X) || has(f.content, X_TITLE))).map(f => f.path),
        article: look(article && article.content),
        indexHasX: has(JSON.stringify(index || null), X) || has(JSON.stringify(index || null), X_TITLE)
    };
}

async function openEditor(page, id) {
    await markCanvasStale(page);
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await openArtEditor(page, id);
}

async function backToShelf(page) {
    if (await page.locator('#art-back').isVisible()) await page.click('#art-back');
    for (let i = 0; i < 4 && (await page.locator('#publish-pages-modal.show').count()) > 0; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
    }
}

test.use({ viewport: { width: 1280, height: 800 } });

test('除外した本は記事に置いたままでも公開に出ず、プレビュー・キャンバスと一致し、取り消すと次の公開で戻る (#669)', async ({ page }) => {
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

    await test.step('除外の前に公開する (公開物に X が出る＝この後の「公開中の記事」の前提)', async () => {
        await openEditor(page, id);
        obs.publishBefore = await publish(page, hub);
        await backToShelf(page);
    });

    await test.step('画面から本 X を除外する。確認文に「公開中の記事 1 件」が出る', async () => {
        await page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"] .bsr-label').click();
        await expect(page.locator('body')).toHaveClass(/app-view-bookshelf/);
        await page.locator(`#bookshelf .book-item[data-asin="${X}"]`).first().click();
        await page.locator(`.edit-mode-btn[data-asin="${X}"]`).first().click();
        await page.locator(`.exclude-btn[data-asin="${X}"]`).first().click();
        await expect(page.locator('.cfm-box')).toBeVisible();
        obs.confirmText = await page.locator('.cfm-box').innerText();
        await page.locator('.cfm-ok').click();
        await expect(page.locator('.toast-success', { hasText: '除外しました' })).toBeVisible();
        // 同期の書き出しが保存先へ書く形 (bookshelf.js の syncToObsidianFolder: exclusions.json={excludedASINs}・
        // library.json は除外を含む全書誌のまま) を、メモリ上の保存先へ写す (この spec は同期を止めているため)。
        obs.storageAfterExclude = await page.evaluate((x) => {
            const mem = window.__mem669;
            mem.set('private/exclusions.json', { excludedASINs: [...(window.bookshelf.userData._storage.exclusions || [])] });
            return { exclusions: mem.get('private/exclusions.json').excludedASINs, libraryHasX: mem.get('private/library.json').books.some(b => b.asin === x) };
        }, X);
        await page.keyboard.press('Escape');
    });

    await test.step('除外の後: 閲覧キャンバス・編集キャンバス・本棚ブロックの全画面編集・プレビュー・公開前チェック・公開', async () => {
        await openEditor(page, id);
        obs.viewCanvas = await readCanvas(page);
        await markCanvasStale(page);
        await page.locator('#art-mode-edit').click();
        obs.editCanvas = await readCanvas(page, { edit: true });
        // 本棚ブロックは 3つめ (idx=2)。全画面編集の配置の行 (.art-fs-ttl と印)
        await editArtBlockViaMenu(page, 2);
        await expect(page.locator('.art-fs-ttl').first()).toBeVisible();
        obs.shelfFsTitles = await page.locator('.art-fs-ttl').allInnerTexts();
        obs.shelfFsMarks = await page.locator('.art-fs-body .art-item-excluded, #art-fs-body .art-item-excluded').count()
            || await page.locator('.art-item-excluded').count();
        await page.click('#art-fs-done');
        obs.preview = await readPreview(page);
        obs.publish = await publish(page, hub);
    });

    await test.step('除外を取り消した後 (設定の「除外した本」→元に戻す): キャンバス・プレビュー・公開に X が戻る', async () => {
        await backToShelf(page);
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
        await openEditor(page, id);
        obs.viewCanvasAfterUndo = await readCanvas(page);
        obs.previewAfterUndo = await readPreview(page);
        obs.publishAfterUndo = await publish(page, hub);
    });

    console.log('[669-obs] ' + JSON.stringify(obs));

    // 前提: 除外の前は公開物に X が出ていた。除外しても保存先の library.json には X の書誌が残る (02:95・取り消しのため)
    expect(obs.publishBefore.article.xTitle).toBe(true);
    expect(obs.storageAfterExclude).toEqual({ exclusions: [X], libraryHasX: true });
    // 除外の確認文: 公開中の記事に入っていることを知らせる
    expect.soft(obs.confirmText).toContain('公開中の記事 1 件に入っています');
    // 除外の後: 公開物に X は出ない (本ブロック・本棚ブロックの中とも)。Y は出る。X が入るファイルは無い
    expect.soft(obs.publish.article).toEqual({ xTitle: false, xAsin: false, yTitle: true });
    expect.soft(obs.publish.withX).toEqual([]);
    expect.soft(obs.publish.indexHasX).toBe(false);
    // 書き手が見る記事＝公開される記事 (プレビュー・閲覧キャンバスとも X が出ない)
    expect.soft(obs.preview).toEqual(obs.publish.article);
    expect.soft({ xTitle: obs.viewCanvas.xTitle, xAsin: obs.viewCanvas.xAsin, yTitle: obs.viewCanvas.yTitle }).toEqual(obs.publish.article);
    // 編集画面: 本ブロック・本棚ブロックに「除外中」の印。全画面編集の行は ASIN だけでなく題と印を出す
    expect.soft(obs.editCanvas.excludedNotes).toEqual(['除外中の本です。公開されません', '除外した本 1 冊は公開されません']);
    expect.soft(obs.shelfFsTitles).toEqual([X_TITLE, Y_TITLE]);
    expect.soft(obs.shelfFsMarks).toBeGreaterThan(0);
    // 公開前チェック: 除外した本を「本」「書影の無い本」に数えない (Y の1冊だけ)
    expect.soft(obs.publish.panelText).toContain('1冊（除外した本 2 冊は公開に出ません）');
    expect.soft(obs.publish.panelText).toContain('書影の無い本が1冊');
    // 取り消した後は、キャンバス・プレビュー・公開に X が戻る (記事のデータは書き換えていない)
    expect.soft(obs.viewCanvasAfterUndo.xTitle).toBe(true);
    expect.soft(obs.previewAfterUndo.xTitle).toBe(true);
    expect.soft(obs.publishAfterUndo.article).toEqual({ xTitle: true, xAsin: true, yTitle: true });
    expect(errors).toEqual([]);
});
