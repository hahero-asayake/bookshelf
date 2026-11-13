// #556 総点検の残り (イシュー#568)
// - モーダルを開いている間、Tab で背後へフォーカスが漏れない (共通層 = js/overlay-manager.js)
// - #/publish・#/publish/settings・#/settings の直リンク着地から✕で閉じると、URL が今の画面と揃い、
//   戻る1回で閉じた面が開き直らない
// - SW 登録の reg が空でも登録後処理で例外を出さない (index.html)
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openSettingsByClick } from './helpers/settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function seed(page) {
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
}
async function bootApp(page, hash) {
    await seed(page);
    await page.goto('index.html' + (hash || ''));
    await page.waitForFunction(() => window.bookshelf && (window.bookshelf.books || []).length > 0);
}

// ホームで起動し、本棚へ hash で移る = 着地の前にアプリ内のエントリが2つある (閉じた後の戻る1回がアプリの外へ出ないことを見るため)
async function bootFromHomeToShelf(page) {
    await bootApp(page);
    await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = '#/bookshelf/all'; });
    await page.waitForTimeout(500);
}

// Tab を n 回押し、そのたびにフォーカスが sel の中にあるかを数える
async function tabLeaks(page, sel, n, allowSel) {
    let leaks = 0;
    const outside = [];
    for (let i = 0; i < n; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(([s, a]) => {
            const root = document.querySelector(s);
            const allow = a ? document.querySelector(a) : null;
            const ae = document.activeElement;
            // body = 面の最後の要素から Tab でページの外 (ブラウザの UI) へ出た状態。背後の要素ではないので漏れに数えない
            // (dialog.showModal と同じ振る舞い。次の Tab で面の最初の要素へ戻る)
            const inside = !!(ae && (ae === document.body || (root && root.contains(ae)) || (allow && allow.contains(ae))));
            return { inside, at: ae ? (ae.id || ae.className || ae.tagName) : null };
        }, [sel, allowSel || null]);
        if (!r.inside) { leaks++; outside.push(String(r.at).slice(0, 40)); }
    }
    return { leaks, outside };
}

test.describe('モーダルの Tab が背後へ漏れない PC', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    // PC の設定は「行き先」の1つ (ui-standards §4-2・閉じるボタンが無くサイドバーから出る) なので、サイドバーは操作できるまま残す
    test('設定を開いて Tab 20回でフォーカスが設定とサイドバーの外へ出ない', async ({ page }) => {
        await bootApp(page);
        const btn = page.locator('#sidebar-settings');
        await btn.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#settings-modal')).toBeVisible();
        const r = await tabLeaks(page, '#settings-modal', 20, '#app-sidebar');
        expect(r.leaks, '外へ出た先: ' + r.outside.join(' / ')).toBe(0);
    });

    test('公開記事の一覧を開いて Tab 20回でフォーカスが一覧の外へ出ない', async ({ page }) => {
        await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        const r = await tabLeaks(page, '#publish-pages-modal', 20);
        expect(r.leaks, '外へ出た先: ' + r.outside.join(' / ')).toBe(0);
    });

    test('パレットを開いて Tab 20回でフォーカスがパレットの外へ出ない', async ({ page }) => {
        await bootApp(page);
        await page.keyboard.press('Control+k');
        await expect(page.locator('#command-palette')).toBeVisible();
        const r = await tabLeaks(page, '#command-palette', 20);
        expect(r.leaks, '外へ出た先: ' + r.outside.join(' / ')).toBe(0);
    });
});

// 直リンク着地 → ✕ → URL と画面が揃う・戻るで開き直らない
const isShown = (page, id) => page.evaluate((i) => {
    const el = document.getElementById(i);
    return !!(el && el.classList.contains('show'));
}, id);

test.describe('直リンク着地した面を閉じた時の URL と戻る', () => {
    test('アプリ内で #/publish へ移って閉じると URL が元の画面に戻り 戻る1回で開き直らない', async ({ page }) => {
        await bootFromHomeToShelf(page);
        const before = await page.evaluate(() => location.hash);
        await page.evaluate(() => { location.hash = '#/publish'; });
        await expect.poll(() => isShown(page, 'publish-pages-modal')).toBe(true);
        await page.evaluate(() => document.getElementById('publish-pages-close').click());
        await expect.poll(() => isShown(page, 'publish-pages-modal')).toBe(false);
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => location.hash)).toBe(before);
        await page.goBack();
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => !!window.bookshelf), '戻る1回でアプリの外へ出ない').toBe(true);
        expect(await isShown(page, 'publish-pages-modal')).toBe(false);
    });

    // 起動 (新しい文書の読み込み) で #/publish に着地する。閉じたら URL がホームになり、再読込しても開き直らない。
    // 着地エントリが最初のエントリなので、戻るはアプリを開く前へ出る (= 起動前に戻る。開き直す段は残らない)
    test('起動時に #/publish へ着地して閉じると URL が着地のまま残らず 再読込で開き直らない', async ({ page }) => {
        await seed(page);
        await page.goto('index.html#/publish');
        await page.waitForFunction(() => window.bookshelf && (window.bookshelf.books || []).length > 0);
        await expect.poll(() => isShown(page, 'publish-pages-modal')).toBe(true);
        await page.evaluate(() => document.getElementById('publish-pages-close').click());
        await expect.poll(() => isShown(page, 'publish-pages-modal')).toBe(false);
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => location.hash)).not.toBe('#/publish');
        expect(await page.evaluate(() => history.state && history.state.nav && history.state.nav.faces.length), '段が残っていない').toBeFalsy();
        await page.reload();
        await page.waitForFunction(() => window.bookshelf && (window.bookshelf.books || []).length > 0);
        await page.waitForTimeout(800);
        expect(await isShown(page, 'publish-pages-modal')).toBe(false);
    });

    test('アプリ内で #/publish/settings へ移って閉じると 戻る1回で公開の設定が開き直らない', async ({ page }) => {
        await bootFromHomeToShelf(page);
        await page.evaluate(() => { location.hash = '#/publish/settings'; });
        await expect.poll(() => isShown(page, 'publish-settings-modal')).toBe(true);
        await page.evaluate(() => {
            const b = document.querySelector('#publish-settings-modal .modal-close');
            if (b) b.click();
        });
        await expect.poll(() => isShown(page, 'publish-settings-modal')).toBe(false);
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => location.hash)).not.toBe('#/publish/settings');
        await page.goBack();
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => !!window.bookshelf), '戻る1回でアプリの外へ出ない').toBe(true);
        expect(await isShown(page, 'publish-settings-modal')).toBe(false);
    });

    test('アプリ内で #/settings へ移って閉じると URL と画面が揃い 戻る1回で設定が開き直らない', async ({ page }) => {
        // 設定の出口 ← ホーム は狭幅だけに出る (PC は行き先の1つで←も×も無い・index.html settings-modal-close)
        await page.setViewportSize({ width: 390, height: 844 });
        await bootFromHomeToShelf(page);
        await page.evaluate(() => { location.hash = '#/settings'; });
        await expect.poll(() => isShown(page, 'settings-modal')).toBe(true);
        await page.evaluate(() => {
            const b = document.getElementById('settings-modal-close');
            if (b) b.click();
        });
        await expect.poll(() => isShown(page, 'settings-modal')).toBe(false);
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => location.hash)).not.toBe('#/settings');
        await page.goBack();
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => !!window.bookshelf), '戻る1回でアプリの外へ出ない').toBe(true);
        expect(await isShown(page, 'settings-modal')).toBe(false);
    });
});

test.describe('SW 登録の後処理', () => {
    test('register が空の登録を返しても登録失敗の警告を出さない', async ({ page }) => {
        const warns = [];
        page.on('console', (m) => { if (m.type() === 'warning' && /Service Worker/.test(m.text())) warns.push(m.text()); });
        await page.addInitScript(() => {
            if (navigator.serviceWorker) {
                navigator.serviceWorker.register = () => Promise.resolve(undefined);
            }
        });
        await bootApp(page);
        await page.waitForTimeout(500);
        expect(warns).toEqual([]);
    });
});

test.describe('モーダルの Tab が背後へ漏れない 狭幅', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('狭幅で設定を開いて Tab 20回でフォーカスが設定の外へ出ない', async ({ page }) => {
        await bootApp(page);
        await openSettingsByClick(page);
        await expect(page.locator('#settings-modal')).toBeVisible();
        const r = await tabLeaks(page, '#settings-modal', 20);
        expect(r.leaks, '外へ出た先: ' + r.outside.join(' / ')).toBe(0);
    });

    test('狭幅で公開記事の一覧を開いて Tab 20回でフォーカスが一覧の外へ出ない', async ({ page }) => {
        await bootApp(page);
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        const r = await tabLeaks(page, '#publish-pages-modal', 20);
        expect(r.leaks, '外へ出た先: ' + r.outside.join(' / ')).toBe(0);
    });

    test('閉じたら背後の inert が外れ 元から inert の本棚はそのまま', async ({ page }) => {
        await bootApp(page);
        const before = await page.evaluate(() => Array.from(document.querySelectorAll('[inert]')).map((e) => e.id || e.className));
        await page.evaluate(() => window.bookshelf.openPublishPagesModal());
        await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
        expect(await page.evaluate(() => document.querySelectorAll('[inert]').length)).toBeGreaterThan(before.length);
        await page.evaluate(() => document.getElementById('publish-pages-close').click());
        await expect(page.locator('#publish-pages-modal')).not.toHaveClass(/show/);
        const after = await page.evaluate(() => Array.from(document.querySelectorAll('[inert]')).map((e) => e.id || e.className));
        expect(after).toEqual(before);
    });
});
