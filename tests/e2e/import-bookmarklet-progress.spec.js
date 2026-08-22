// Amazon 側「取込中」進捗オーバーレイの検証 (イシュー#89)。
// 実 Amazon への実ログイン E2E は不可なため、tests/fixtures/amazon-mock.html
// (window.csrfToken 定義済みの最小ページ) 上でブックマークレット本体を eval し、
// GetContentOwnershipData 相当の ajax エンドポイントを context.route でスタブする。
// 実蔵書規模の9ページ (100件×8+60件=860件、Active安全弁を満たす) を返し、
// 中間表示 (n<total) を最低1回観測できることを合否条件にする (件数更新未実装なら不合格)。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

const TOTAL_ITEMS = 860; // 実蔵書規模 (100件×8+60件=9ページ、②指定)
const PAGE_DELAY_MS = 200; // ②指定の約200ms。startIndex に応じてわずかにずらし、並列fetchでも中間表示を複数回観測できるようにする

async function bootApp(page) {
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

async function getBookmarkletCode(page) {
    await page.evaluate(() => window.bookshelf.showImportModal());
    const href = await page.locator('#kindle-bookmarklet-link').getAttribute('href');
    return decodeURIComponent(href.replace(/^javascript:/, ''));
}

function makeItems(startIndex, count) {
    return Array.from({ length: count }, (_, i) => {
        const idx = startIndex + i;
        return {
            title: 'Book ' + idx, authors: 'Author ' + idx, acquiredTime: 1700000000000 + idx,
            readStatus: 'UNKNOWN', asin: 'B' + String(idx).padStart(9, '0'), productImage: '',
            originType: 'Purchase', statusFromPlatformSearch: 'Active', lendingType: null, lendingStatus: null
        };
    });
}

async function installAmazonAjaxMock(context) {
    await context.route('https://www.amazon.co.jp/hz/mycd/digital-console/ajax', async (route) => {
        const postData = route.request().postData() || '';
        const params = new URLSearchParams(postData);
        const activityInput = JSON.parse(params.get('activityInput') || '{}');
        const startIndex = (activityInput.fetchCriteria && activityInput.fetchCriteria.startIndex) || 0;
        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS + (startIndex / 100) * 30));
        const count = Math.max(0, Math.min(100, TOTAL_ITEMS - startIndex));
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': 'http://localhost:8000', 'Access-Control-Allow-Credentials': 'true' },
            body: JSON.stringify({ success: true, GetContentOwnershipData: { numberOfItems: TOTAL_ITEMS, items: makeItems(startIndex, count) } })
        });
    });
}

async function installHubRelayMock(context, onRelay) {
    await context.route('https://mock-hub.example/kindle/relay', async (route) => {
        const body = JSON.parse(route.request().postData() || '{}');
        if (onRelay) onRelay(body);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': 'http://localhost:8000', 'Access-Control-Allow-Credentials': 'true' },
            body: JSON.stringify({ ok: true })
        });
    });
}

async function waitForMidProgress(targetPage) {
    await targetPage.waitForFunction(() => {
        const el = document.getElementById('bs-import-progress');
        if (!el) return false;
        const m = el.textContent.match(/（(\d+)\/(\d+)件）/);
        return !!m && parseInt(m[1], 10) < parseInt(m[2], 10);
    }, null, { timeout: 30000 });
    // 進捗中 (closable=false) はページ操作を奪わない固定バナーであること (全画面暗幕ではない・
    // pointer-events:none でクリックを妨げない) を確認する。②レビュー指摘の是正:
    // fetch はタイムアウトしないため、全画面暗幕のままだと Amazon 側が無応答の時に
    // リロードするまで操作不能になっていた。
    const box = await targetPage.locator('#bs-import-progress').boundingBox();
    expect(box.height).toBeLessThan(120);
    const pointerEvents = await targetPage.locator('#bs-import-progress').evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(pointerEvents).toBe('none');
}

test('hub relay 経由: 中間表示(n<total)→完了パネル、relay に POST された内容を確認', async ({ page, context }) => {
    await bootApp(page);
    await installAmazonAjaxMock(context);
    const relayPayloads = [];
    await installHubRelayMock(context, (b) => relayPayloads.push(b));

    const code = await getBookmarkletCode(page);
    const mockPage = await context.newPage();
    await mockPage.goto('/tests/fixtures/amazon-mock.html?bs_relay=test-relay-id&bs_hub=https://mock-hub.example');
    await mockPage.evaluate((src) => { eval(src); }, code);

    await waitForMidProgress(mockPage);
    await mockPage.waitForFunction(() => {
        const el = document.getElementById('bs-import-progress');
        return !!el && el.textContent.includes('bookshelf タブに戻ってください');
    }, null, { timeout: 30000 });

    expect(relayPayloads.length).toBe(1);
    expect(relayPayloads[0].items.length).toBe(TOTAL_ITEMS);
    // 閉じるボタン付きで残る (自動で消えない)
    await expect(mockPage.locator('#bs-import-progress button')).toBeVisible();
});

test('postMessage(opener)経由: window.close() 前に完了表示が出て、opener が4フィールド付きデータを受信する。close が黙って無視された場合は1秒後に閉じるボタン付きパネルへ切り替わる', async ({ page, context }) => {
    await bootApp(page);
    await installAmazonAjaxMock(context);

    // window.close() を「呼ばれたこと + 呼ばれた時点のパネル本文」を記録するだけにし、実際には
    // 閉じない。Chrome は script が開いていないウィンドウの close() を呼んでも例外を投げず
    // 黙って無視するため、この「呼ばれたが閉じない」状態こそが②レビューで指摘された実運用の
    // 詰まりパターン (旧実装は try/catch の catch に頼っており、この無視ケースを検出できなかった)。
    await context.addInitScript(() => {
        window.__bsCloseCalled = false;
        window.__bsPanelTextAtClose = null;
        window.close = function () {
            window.__bsCloseCalled = true;
            const el = document.getElementById('bs-import-progress');
            window.__bsPanelTextAtClose = el ? el.textContent : null;
        };
    });

    await page.evaluate(() => {
        window.__received = null;
        window.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'kindleBookshelfExport') window.__received = e.data;
        });
    });

    const code = await getBookmarkletCode(page);
    const popupPromise = page.waitForEvent('popup');
    await page.evaluate(() => { window.open('/tests/fixtures/amazon-mock.html', '_blank'); });
    const popup = await popupPromise;
    await popup.waitForLoadState();
    await popup.evaluate((src) => { eval(src); }, code);

    await waitForMidProgress(popup);
    await popup.waitForFunction(() => window.__bsCloseCalled === true, null, { timeout: 30000 });

    const panelTextAtClose = await popup.evaluate(() => window.__bsPanelTextAtClose);
    expect(panelTextAtClose).toContain('冊を bookshelf に送信しました');

    // close が (テストのフックにより) 無視され続ける状況で、1秒後にパネルが閉じるボタン付きの
    // 全画面パネルへ自動的に切り替わることを確認する。切り替わらなければ、閉じるボタンの無い
    // 暗幕がリロードするまで残り続ける旧実装のバグが再発している。
    await popup.waitForFunction(() => {
        const el = document.getElementById('bs-import-progress');
        return !!el && !!el.querySelector('button') && el.textContent.includes('このタブは閉じてください');
    }, null, { timeout: 3000 });

    await page.waitForFunction(() => window.__received && window.__received.ok === true, null, { timeout: 5000 });
    const received = await page.evaluate(() => window.__received);
    expect(received.items.length).toBe(TOTAL_ITEMS);
    for (const key of ['originType', 'statusFromPlatformSearch', 'lendingType', 'lendingStatus']) {
        expect(received.items[0]).toHaveProperty(key);
    }
});

test('clipboard経由: 完了パネルが自動で消えず、閉じるボタンで消える', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await bootApp(page);
    await installAmazonAjaxMock(context);

    const code = await getBookmarkletCode(page);
    const mockPage = await context.newPage();
    await mockPage.goto('/tests/fixtures/amazon-mock.html');
    await mockPage.evaluate((src) => { eval(src); }, code);

    await waitForMidProgress(mockPage);
    await mockPage.waitForFunction(() => {
        const el = document.getElementById('bs-import-progress');
        return !!el && el.textContent.includes('クリップボードにコピーしました');
    }, null, { timeout: 30000 });

    // 自動で消えないこと
    await mockPage.waitForTimeout(1000);
    await expect(mockPage.locator('#bs-import-progress')).toBeVisible();

    const clip = await mockPage.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(clip).length).toBe(TOTAL_ITEMS);

    // 閉じるボタンで消える
    await mockPage.locator('#bs-import-progress button').click();
    await expect(mockPage.locator('#bs-import-progress')).toHaveCount(0);
});

test('csrfToken 不在: 失敗パネルが閉じるボタン付きで出る', async ({ page, context }) => {
    await bootApp(page);
    const code = await getBookmarkletCode(page);
    const mockPage = await context.newPage();
    await mockPage.goto('about:blank');
    await mockPage.evaluate((src) => { eval(src); }, code);

    await mockPage.waitForFunction(() => {
        const el = document.getElementById('bs-import-progress');
        return !!el && el.textContent.includes('Amazonの蔵書一覧ページ');
    }, null, { timeout: 5000 });

    await expect(mockPage.locator('#bs-import-progress button')).toBeVisible();
    await mockPage.locator('#bs-import-progress button').click();
    await expect(mockPage.locator('#bs-import-progress')).toHaveCount(0);
});
