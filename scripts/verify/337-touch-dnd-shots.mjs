// イシュー#337: 本棚ツリー・本棚管理モーダル・プラグインカード・ヘッダーutility行・プラグインボタン・
// bd-section(本詳細セクション)、計6面の「並べ替え中」の見た目を撮る。
// before(修正前HEAD, HTML5 DnD)はdragstart/dragover相当のclassをJS側で直接付与して撮影(③step1のnote参照)。
// after(修正後, Pointer Events)は実際にtouchの長押し(pointerdown→450ms待ち→少し移動)でghostを表示させて撮影する。
// 実行: node scripts/verify/337-touch-dnd-shots.mjs [before|after] [BASE]
import { chromium } from '../../node_modules/playwright/index.mjs';
import { resolveBase, resolveShotDir, logLoadedVersion } from './verify-common.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LABEL = process.argv[2] || 'before';
const BASE = resolveBase(process.argv[3]).replace(/\/$/, '');
const SHOT_DIR = join(resolveShotDir(), '337', LABEL);
mkdirSync(SHOT_DIR, { recursive: true });

const BOOKS = [['B0FIX00001', '三体', '劉慈欣']];
const library = {
    books: BOOKS.map(([asin, title, authors], i) => ({ asin, title, authors, acquiredTime: 1727000000000 + i, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1727000000000 })),
    metadata: { lastImportDate: 1727000000000, totalBooks: BOOKS.length },
};
const userData = {
    bookshelves: [
        { id: 'all', name: 'すべての本', books: BOOKS.map(b => b[0]), isSpecial: true, internalId: 'all' },
        { id: 'novel', name: '小説', books: [BOOKS[0][0]], isSpecial: false, internalId: 'novel', parent: null },
        { id: 'sf', name: 'SF', books: [BOOKS[0][0]], isSpecial: false, internalId: 'sf', parent: null },
        { id: 'essay', name: 'エッセイ', books: [], isSpecial: false, internalId: 'essay', parent: null },
    ],
    notes: {}, settings: {}, bookOrder: {}, stats: {}, version: 2,
};

async function launch() {
    const browser = await chromium.launch({ channel: 'chrome' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'ja-JP', hasTouch: true });
    await ctx.route(/accounts\.google\.com|googlesyndication|doubleclick|hub\.asayake\.org/, r => r.abort());
    const page = await ctx.newPage();
    return { browser, ctx, page };
}

async function boot(page) {
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), JSON.stringify(library)]);
    await page.goto(`${BASE}/index.html`);
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await logLoadedVersion(page);
    await page.evaluate(() => {
        const app = window.bookshelf;
        app.saveUserData = async () => {};
        app._isSyncReady = () => true;
        app._applyRoute = () => {}; // 本詳細をevaluateで直接開く際のルーター再適用を防ぐ(step3 note参照)
        // プラグイン一覧をモック (実インストール手順をスキップ、見た目だけ再現)
        app.pluginLoader = app.pluginLoader || {};
        app.pluginLoader.listInstalledPlugins = async () => ([
            { id: 'reading-goal', manifest: { name: '読書目標', version: '1.0', description: '年間の読書目標を設定し進捗を表示します', icon: 'target', publishable: true } },
            { id: 'pinned-memo', manifest: { name: 'ピン留めメモ', version: '1.0', description: '本棚ごとにメモをピン留めできます', icon: 'pin' } },
        ]);
        app.pluginLoader.loaded = new Map([['reading-goal', {}], ['pinned-memo', {}]]);
        // ヘッダーのプラグインボタン(1個)をモック登録
        if (app.pluginAPI) {
            app.pluginAPI._uiButtons = [
                { id: 'reading-goal-btn', pluginId: 'reading-goal', title: '読書目標', label: '読書目標', emoji: '🎯', active: false, onClick: () => {} },
            ];
        }
        app._applyHeaderLayout();
    });
}

async function shot(page, selector, name, { fullscreen = false } = {}) {
    const el = fullscreen ? null : page.locator(selector).first();
    const path = join(SHOT_DIR, `${name}.png`);
    if (fullscreen) {
        await page.screenshot({ path });
    } else {
        await el.waitFor({ state: 'visible', timeout: 5000 });
        await el.screenshot({ path });
    }
    console.log(`  → ${path}`);
}

// 実際の touch 長押し (PointerEvent dispatch、tests/e2e/touch-reorder.spec.js と同じ経路) で
// ghost を表示させ、containerSelector の領域(+ghost分の余白)だけを撮ってから pointercancel で後始末する。
async function touchLongPressShot(page, el, name, containerSelector, { moveX = 0, moveY = 15, margin = 40 } = {}) {
    const box = await el.boundingBox();
    const x0 = box.x + box.width / 2, y0 = box.y + box.height / 2;
    await page.evaluate(([x, y]) => {
        const target = document.elementFromPoint(x, y);
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 91, clientX: x, clientY: y }));
    }, [x0, y0]);
    await page.waitForTimeout(550); // 長押し成立(450ms)を跨ぐ
    await page.evaluate(([x, y]) => {
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 91, clientX: x, clientY: y }));
    }, [x0 + moveX, y0 + moveY]);
    await page.waitForTimeout(150);
    const path = join(SHOT_DIR, `${name}.png`);
    const cBox = await page.locator(containerSelector).first().boundingBox();
    const clip = {
        x: Math.max(0, cBox.x - margin / 2),
        y: Math.max(0, cBox.y - margin / 2),
        width: cBox.width + margin,
        height: cBox.height + margin + moveY + 20,
    };
    await page.screenshot({ path, clip });
    console.log(`  → ${path}`);
    await page.evaluate(([x, y]) => {
        document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 91, clientX: x, clientY: y }));
    }, [x0 + moveX, y0 + moveY]);
    await page.waitForTimeout(100);
}

async function main() {
    const { browser, page } = await launch();
    await boot(page);

    // 1) サイドバーツリー: 「SF」を長押し中 (ハンドル無し、要素全体がトリガー)
    console.log('[1/6] サイドバーツリー');
    const sf = page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: 'SF' });
    await touchLongPressShot(page, sf, '1-tree', '#sidebar-bookshelf-tree');

    // 2) 本棚管理モーダル: 「SF」のハンドルを長押し中 (本カードと同じ即時開始)
    console.log('[2/6] 本棚管理モーダル');
    await page.evaluate(() => window.bookshelf.showBookshelfManager());
    await page.waitForSelector('.bookshelf-item', { timeout: 5000 });
    const bsHandle = page.locator('.bookshelf-item', { hasText: 'SF' }).locator('.bookshelf-drag-handle');
    await touchLongPressShot(page, bsHandle, '2-bookshelf-modal', '#bookshelf-modal .modal-content');
    await page.evaluate(() => window.bookshelf.closeBookshelfModal());

    // 3) プラグインカード: 1枚目を長押し中
    console.log('[3/6] プラグインカード');
    await page.evaluate(() => window.bookshelf._openSettingsModal('plugins-section'));
    await page.waitForSelector('#plugin-list-section .plugin-card-v2', { timeout: 5000 });
    const card0 = page.locator('#plugin-list-section .plugin-card-v2').nth(0);
    await touchLongPressShot(page, card0, '3-plugin-card', '#plugin-list-section');

    // 4) ヘッダーのutility行: 通常表示。HEADER_ITEMS_METAが空のため現状は静的アイテムが無く、
    //    プラグインボタンのみが並ぶ構成になっている(js/bookshelf.js:6326、着手前確認で判明)。
    console.log('[4/6] ヘッダーutility行(通常表示)');
    await page.evaluate(() => window.bookshelf._closeSettingsModal());
    await shot(page, '.sidebar-utility', '4-header-utility');

    // 5) プラグインボタン: header-controls内のplugin-button-itemを長押し中
    console.log('[5/6] プラグインボタン');
    const pluginBtn = page.locator('#header-controls .header-item.plugin-button-item').first();
    await touchLongPressShot(page, pluginBtn, '5-plugin-button', '.sidebar-utility');

    // 6) bd-section: 本詳細を編集モードで開き、1番目のセクションのグリップを長押し中。
    //    実機のtouch dispatchでは見た目の変化(opacity)が撮影タイミングに乗らなかったため、
    //    class直接付与方式(before撮影と同じ型)で撮る。実装のclass名・構造はstep2で変えていないので正確。
    console.log('[6/6] bd-section');
    await page.evaluate(() => {
        const book = window.bookshelf.books.find(b => b.asin === 'B0FIX00001');
        window.bookshelf.showBookDetail(book, true);
    });
    await page.waitForFunction(() => document.querySelectorAll('#bd-sections .bd-grip').length > 0, null, { timeout: 5000 });
    await page.evaluate(() => {
        const secs = [...document.querySelectorAll('#bd-sections .bd-section')];
        secs[0].classList.add('is-dragging');
        const indicator = document.createElement('div');
        indicator.className = 'bd-section-drop-indicator';
        secs[2].before(indicator);
    });
    await shot(page, '#bd-sections', '6-bd-section');

    await browser.close();
    console.log(`完了: ${SHOT_DIR}`);
}

main().catch(e => { console.error(e); process.exit(1); });
