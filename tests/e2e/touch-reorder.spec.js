// イシュー#337: 本棚ツリー・本棚管理モーダル・プラグインカード・ヘッダーutility行・bd-section の
// Pointer Events 並べ替えを、タッチ(長押し)経路で固定する。
//
// タッチの発生方法: 当初 chromium は CDPSession 経由の Input.dispatchTouchEvent (実ブラウザの
// touch→PointerEvent 変換を通す最も忠実な経路) を試したが、本リポジトリの環境では touchStart/Move/End
// を送っても並べ替えが一切発火しないことを実測した (hasTouch:true を付けても不変、原因未特定)。
// CDP は Chromium 専用で webkit では最初から使えないこともあり、chromium/webkit 共通で
// PointerEvent(pointerType:'touch') を要素へ直接 dispatch する方式に統一した。アプリ側の
// pointerdown/pointermove/pointerup ハンドラ (_bindPointerReorder) を実際に駆動するため、
// 「関数を直接呼ぶのではなく pointer イベントの経路を通す」という要件は満たす
// (ブラウザ内蔵のタッチ→ポインタ変換レイヤーだけを迂回する)。
import { test, expect } from './helpers/test-base.js';

const BOOKS = [['B0FIX00001', '三体', '劉慈欣']];
const library = {
    books: BOOKS.map(([asin, title, authors], i) => ({ asin, title, authors, acquiredTime: 1727000000000 + i, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1727000000000 })),
    metadata: { lastImportDate: 1727000000000, totalBooks: 1 },
};
const userData = {
    bookshelves: [
        { id: 'all', name: 'すべての本', books: [BOOKS[0][0]], isSpecial: true, internalId: 'all' },
        { id: 'novel', name: '小説', books: [BOOKS[0][0]], isSpecial: false, internalId: 'novel', parent: null },
        { id: 'sf', name: 'SF', books: [BOOKS[0][0]], isSpecial: false, internalId: 'sf', parent: null },
        { id: 'essay', name: 'エッセイ', books: [], isSpecial: false, internalId: 'essay', parent: null },
    ],
    notes: {}, settings: {}, bookOrder: {}, stats: {}, version: 2,
};

async function bootApp(page) {
    const errors = [];
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        // listInstalledPlugins だけモックしているため、pluginLoader 側の実ファイル読み込み(未配置)が
        // 警告を出すことがある(webkitで実測)。今回のPointer Events化とは無関係なテスト用モック不足。
        if (/\[pluginLoader\] .+ 読み込み失敗/.test(msg.text())) return;
        errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        // webkit(iPhone UA)では _setupMobileBanner が「クラウド未設定」の全画面案内を出し、
        // ツリー等の通常UIが隠れる(js/bookshelf.js:246 hasDirPicker判定)。method変更では
        // SyncConfigManager側のフォールバックで消えなかったため、showDirectoryPicker を
        // ダミーで生やして早期returnさせる(実際には呼ばれない、_isSyncReady差し替え済み)。
        if (!('showDirectoryPicker' in window)) window.showDirectoryPicker = () => {};
    }, [JSON.stringify(userData), JSON.stringify(library)]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => {
        const app = window.bookshelf;
        app.saveUserData = async () => {};
        app._isSyncReady = () => true;
        // ルーター(hashchange)の非同期な再適用が showBookDetail(book, true) を showBookDetail(book, false)
        // で上書きしてしまう現象を実測した(bd-sectionテスト用、直接関数呼び出しとURLハッシュが不整合なため)。
        // E2E専用の割り切りとして _applyRoute を無効化する。
        app._applyRoute = () => {};
        // モバイル幅(webkit=iPhone 13)ではサイドバーがドロワーで畳まれており、ツリー/ヘッダーの
        // 要素は DOM 上に存在しても画面外にある(elementFromPointがnullを返す)。開いておく。
        if (typeof app._openDrawer === 'function') app._openDrawer();
        app.pluginLoader = app.pluginLoader || {};
        app.pluginLoader.listInstalledPlugins = async () => ([
            { id: 'reading-goal', manifest: { name: '読書目標', version: '1.0', description: 'd1', icon: 'target' } },
            { id: 'pinned-memo', manifest: { name: 'ピン留めメモ', version: '1.0', description: 'd2', icon: 'pin' } },
        ]);
        app.pluginLoader.loaded = new Map([['reading-goal', {}], ['pinned-memo', {}]]);
        if (app.pluginAPI) {
            app.pluginAPI._uiButtons = [
                { id: 'btn-a', pluginId: 'reading-goal', title: 'A', label: 'A', emoji: '🎯', active: false, onClick: () => {} },
                { id: 'btn-b', pluginId: 'pinned-memo', title: 'B', label: 'B', emoji: '📌', active: false, onClick: () => {} },
            ];
        }
        app._applyHeaderLayout();
    });
    return errors;
}

// chromium/webkit 共通: PointerEvent(pointerType:'touch') を直接 dispatch (上の注記参照)。
async function touchLongPressDrag(page, browserName, fromBox, toPoint) {
    const x0 = fromBox.x + fromBox.width / 2, y0 = fromBox.y + fromBox.height / 2;
    await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 77, clientX: x, clientY: y }));
    }, [x0, y0]);
    await page.waitForTimeout(550); // 長押し成立 (450ms) を跨ぐ
    await page.evaluate(([x, y]) => {
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 77, clientX: x, clientY: y }));
    }, [x0, y0 + 4]);
    await page.evaluate(([x, y]) => {
        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 77, clientX: x, clientY: y }));
    }, [toPoint.x, toPoint.y]);
    await page.waitForTimeout(100);
    await page.evaluate(([x, y]) => {
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 77, clientX: x, clientY: y }));
    }, [toPoint.x, toPoint.y]);
    await page.waitForTimeout(200);
}

async function mouseDrag(page, fromBox, toPoint) {
    const x0 = fromBox.x + fromBox.width / 2, y0 = fromBox.y + fromBox.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0, y0 + 5, { steps: 3 });
    await page.mouse.move(toPoint.x, toPoint.y, { steps: 5 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(200);
}

test.describe('touch-reorder (イシュー#337)', () => {
    // hasTouch: CDP Input.dispatchTouchEvent / PointerEvent(pointerType:'touch') のどちらも、
    // context が touch 非対応だと無視されることがあるため明示的に有効化する。
    // viewport 未指定だとデフォルト(1280x720)のままになり、本詳細パネル下部の bd-section が
    // 画面外に出て elementFromPoint が null を返す(イシュー#337 bd-section 原因切り分けで実測)。
    test.use({ hasTouch: true, viewport: { width: 1280, height: 900 } });

    test('サイドバーツリー: 長押しで並べ替え、順序が保存される', async ({ page, context, browserName }) => {
        await context.grantPermissions?.([]).catch(() => {});
        const errors = await bootApp(page);
        const before = await page.evaluate(() => [...document.querySelectorAll('#sidebar-bookshelf-tree .tree-node')].map(n => n.dataset.internalId));
        expect(before).toEqual(['all', 'novel', 'sf', 'essay']);

        const sf = page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: 'SF' });
        const essay = page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: 'エッセイ' });
        const sfBox = await sf.boundingBox();
        const essayBox = await essay.boundingBox();
        await touchLongPressDrag(page, browserName, sfBox, { x: essayBox.x + essayBox.width / 2, y: essayBox.y + essayBox.height - 3 });

        const after = await page.evaluate(() => [...document.querySelectorAll('#sidebar-bookshelf-tree .tree-node')].map(n => n.dataset.internalId));
        expect(after).toEqual(['all', 'novel', 'essay', 'sf']);
        // 保存値: userData.bookshelves の並び順にも反映されている
        const savedOrder = await page.evaluate(() => window.bookshelf.userData.bookshelves.map(b => b.internalId));
        expect(savedOrder).toEqual(['all', 'novel', 'essay', 'sf']);
        expect(errors).toEqual([]);
    });

    test('本棚管理モーダル: ハンドルの長押しで並べ替え (本カードと同じ即時開始)', async ({ page, browserName }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf.showBookshelfManager());
        await page.waitForSelector('.bookshelf-item');
        const before = await page.evaluate(() => [...document.querySelectorAll('.bookshelf-item')].map(i => i.dataset.internalId));
        expect(before).toEqual(['all', 'novel', 'sf', 'essay']);

        const handle = page.locator('.bookshelf-item', { hasText: 'SF' }).locator('.bookshelf-drag-handle');
        const essayItem = page.locator('.bookshelf-item', { hasText: 'エッセイ' });
        const hBox = await handle.boundingBox();
        const eBox = await essayItem.boundingBox();
        // ハンドル付きは即時開始なので長押し待ちは不要だが、同じヘルパーで経路を統一する
        await touchLongPressDrag(page, browserName, hBox, { x: eBox.x + eBox.width / 2, y: eBox.y + eBox.height - 3 });

        const after = await page.evaluate(() => [...document.querySelectorAll('.bookshelf-item')].map(i => i.dataset.internalId));
        expect(after).toEqual(['all', 'novel', 'essay', 'sf']);
        expect(errors).toEqual([]);
    });

    test('プラグインカード: 長押しで並べ替え、pluginOrderV1 に保存される', async ({ page, browserName }) => {
        const errors = await bootApp(page);
        await page.evaluate(() => window.bookshelf._openSettingsModal('plugins-section'));
        await page.waitForSelector('#plugin-list-section .plugin-card-v2');
        const before = await page.evaluate(() => [...document.querySelectorAll('#plugin-list-section .plugin-card-v2')].map(c => c.dataset.pluginId));
        expect(before.length).toBe(2);

        const cards = page.locator('#plugin-list-section .plugin-card-v2');
        const c0Box = await cards.nth(0).boundingBox();
        const c1Box = await cards.nth(1).boundingBox();
        // pcard-head 等の操作系を避け、カード下部 (説明文付近) を起点にする
        const fromBox = { x: c0Box.x + 10, y: c0Box.y + c0Box.height - 10, width: 1, height: 1 };
        await touchLongPressDrag(page, browserName, fromBox, { x: c1Box.x + 10, y: c1Box.y + c1Box.height - 5 });

        const after = await page.evaluate(() => [...document.querySelectorAll('#plugin-list-section .plugin-card-v2')].map(c => c.dataset.pluginId));
        expect(after).toEqual([...before].reverse());
        const savedOrder = await page.evaluate(() => JSON.parse(localStorage.getItem('pluginOrderV1') || '[]'));
        expect(savedOrder).toEqual(after);
        expect(errors).toEqual([]);
    });

    test('ヘッダーutility行: プラグインボタンを長押しで並べ替え', async ({ page, browserName }) => {
        const errors = await bootApp(page);
        await page.waitForSelector('#header-controls .header-item.plugin-button-item');
        const before = await page.evaluate(() => [...document.querySelectorAll('#header-controls .header-item')].map(i => i.dataset.placementId));
        expect(before.length).toBe(2);

        const items = page.locator('#header-controls .header-item');
        const i0Box = await items.nth(0).boundingBox();
        const i1Box = await items.nth(1).boundingBox();
        // elementFromPoint が実要素(.header-item)に当たる位置でないと targetEl が取れず何も起きない。
        // item1 の内側・右寄り (「左半分」でない) を指せば、末尾 (idx=2) 挿入になり item0 と入れ替わる。
        await touchLongPressDrag(page, browserName, i0Box, { x: i1Box.x + i1Box.width - 3, y: i1Box.y + i1Box.height / 2 });

        const after = await page.evaluate(() => [...document.querySelectorAll('#header-controls .header-item')].map(i => i.dataset.placementId));
        expect(after).toEqual([...before].reverse());
        expect(errors).toEqual([]);
    });

    // 原因判明・解消済み: このファイルに viewport 指定が無く、デフォルト(1280x720)のままだった。
    // bd-section は本詳細パネルの下の方にあるため、720px高だと grip のドラッグ先(長文メモ/基本情報)が
    // 画面外に出て document.elementFromPoint が null を返し、ドロップ位置を一度も検出できなかった
    // (describe 先頭の test.use に viewport:900 を追加して解消、console.log デバッグで実測)。
    // 合わせて実装側(_bindPointerReorder)にも、ドラッグ経路が textarea 等を跨いだ時に備えた
    // 保険を追加した(user-select:none・selectstart抑止・reflow強制・フォームコントロールの
    // pointer-events一時無効化)。これらは直接の原因ではなかったが、害が無く頑健性が上がるため残す。
    test('bd-section: グリップのマウスドラッグで並べ替え、detailSectionOrder に保存される', async ({ page }) => {
        const errors = await bootApp(page);
        // 本詳細パネルは開いた直後ごく短時間だけ要素が入れ替わるタイミング依存があり (step2 note参照)、
        // Playwright の locator 経由 (auto-waitで安定を待つ) だとタイムアウトする。
        // evaluate で同期的に座標を取得してから操作することでこれを回避する。
        await page.evaluate(() => {
            const book = window.bookshelf.books.find(b => b.asin === 'B0FIX00001');
            window.bookshelf.showBookDetail(book, true);
        });
        await page.waitForFunction(() => document.querySelectorAll('#bd-sections .bd-grip').length > 0);
        await page.waitForTimeout(300); // レイアウト安定待ち(showBookDetail直後の描画完了を待つ)
        const before = await page.evaluate(() => [...document.querySelectorAll('#bd-sections .bd-section')].map(s => s.dataset.section));
        expect(before).toEqual(['bookshelves', 'short-memo', 'long-memo', 'basic-info']);

        const rects = await page.evaluate(() => {
            const grip = document.querySelectorAll('#bd-sections .bd-grip')[0].getBoundingClientRect();
            const target = document.querySelectorAll('#bd-sections .bd-section')[2].getBoundingClientRect();
            return {
                grip: { x: grip.x, y: grip.y, width: grip.width, height: grip.height },
                target: { x: target.x, y: target.y, width: target.width, height: target.height },
            };
        });
        const toPoint = { x: rects.target.x + rects.target.width / 2, y: rects.target.y + rects.target.height - 3 };
        await mouseDrag(page, rects.grip, toPoint);

        const after = await page.evaluate(() => [...document.querySelectorAll('#bd-sections .bd-section')].map(s => s.dataset.section));
        expect(after).not.toEqual(before);
        expect(after).toContain('bookshelves');
        const savedOrder = await page.evaluate(() => window.bookshelf.userData.settings.detailSectionOrder);
        expect(savedOrder).toEqual(after);
        expect(errors).toEqual([]);
    });

    test('マウスドラッグ: サイドバーツリーの並べ替え (PCの挙動を固定、chromium)', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'マウスドラッグの代表例はchromiumのみで固定する');
        const errors = await bootApp(page);
        const sf = page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: 'SF' });
        const essay = page.locator('#sidebar-bookshelf-tree .tree-node', { hasText: 'エッセイ' });
        const sfBox = await sf.boundingBox();
        const essayBox = await essay.boundingBox();
        await mouseDrag(page, sfBox, { x: essayBox.x + essayBox.width / 2, y: essayBox.y + essayBox.height - 3 });

        const after = await page.evaluate(() => [...document.querySelectorAll('#sidebar-bookshelf-tree .tree-node')].map(n => n.dataset.internalId));
        expect(after).toEqual(['all', 'novel', 'essay', 'sf']);
        expect(errors).toEqual([]);
    });
});
