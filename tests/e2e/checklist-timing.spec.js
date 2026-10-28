// イシュー#295: ハヘロ向け実機チェックリスト §6 項目0〜9 (17_戻る挙動テスト表_20261014.md) の自動テスト。
// 「時間差で起きる挙動」(数百ms〜数秒後に一瞬別の画面が出る・自動保存後に状態が変わる等) を
// tests/e2e/helpers/checklist-timing-core.mjs の observe()/judge() で機械判定する。
// bootApp/tap/settle/back 等は tests/e2e/back-nav-matrix.spec.js (イシュー#284) のものを複製した
// (import ではなく複製: あちらは #284 の表に対する抑制カウンタ検査が主目的で返り値の形が異なるため)。
// ケースIDは17表§6の番号に合わせ CHK0〜CHK8 とする (項目9は独立テストにせず、CHK0〜8 の
// observe() 結果から「禁止状態の出現」を afterAll で集計する — _summary.json の chk9 参照)。
// 端スワイプ(B2b)は chromium/webkit に手段が無い (イシュー#295 step1 で確認) ため、
// page.goBack()/goForward() で代替する。17表§5が既に認めている「演出」と「アプリの反応」の
// 切り分けと同じ扱い (スワイプそのものの視覚効果は検証対象にしない)。
//
// 各テストは runCase(page, testInfo, id, judgeOpts, setupAndAct) を1回だけ呼ぶ。setupAndAct は
// 「ブート直後の状態から、観測したい最後の操作までを全部やる」自己完結クロージャにすること — NG時に
// runCase が bootApp() し直して同じクロージャを再実行し、連続スクショつきで再現するため、
// クロージャの外に前提手順を置くと再現が壊れる。
import { test, expect } from './helpers/test-base.js';
import { observe, judge, snapState } from './helpers/checklist-timing-core.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const OUT_ROOT = join(here, '../../tmp/verify-shots/295');
// NGの時は常にスクショを残す。OKでも全部残したい時(②へ見せる代表画像用)は CHECKLIST_SHOT_ALWAYS=1。
const SHOT_ALWAYS = process.env.CHECKLIST_SHOT_ALWAYS === '1';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function bootApp(page) {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        const mem = new Map();
        window.__mem = mem;
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        adapter.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        adapter.readText = async (p) => (mem.has(p) ? mem.get(p) : null);
        adapter.writeText = async (p, t) => { mem.set(p, t); };
        window.bookshelf._isSyncReady = () => true;
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
    });
    return errors;
}

async function settle(page, ms = 400) { await page.waitForTimeout(ms); }
// 物理/ジェスチャーの戻る相当 (B2a・端スワイプの代替)。webkit の goBack は「戻れない」時に null を返す。
async function back(page) { await page.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => {}); await settle(page); }
// 右端スワイプ(進む)の代替。chromium/webkit は goForward で代替する(イシュー#295 step1 結果)。
async function forward(page) { await page.goForward({ waitUntil: 'commit', timeout: 3000 }).catch(() => {}); await settle(page); }
async function tap(page, selector) {
    const loc = page.locator(selector);
    await loc.waitFor({ state: 'visible', timeout: 5000 });
    await loc.tap();
}
async function firstBook(page) {
    return page.evaluate(() => {
        const bs = window.bookshelf;
        const b = (bs.books && bs.books[0]) || bs.bookManager.getAllBooks()[0];
        return b ? b.asin : null;
    });
}
async function shelfInfo(page) {
    return page.evaluate(() => {
        const sh = window.bookshelf.userData.bookshelves.find((b) => !b.isSpecial);
        return { id: sh.id, slug: sh.slug || sh.id, name: sh.name };
    });
}
async function toShelf(page) {
    const { id } = await shelfInfo(page);
    await page.evaluate((x) => window.bookshelf.switchBookshelf(x), id);
    await settle(page, 600);
}
async function openArticleList(page) {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
}
async function openNewArticleEdit(page) {
    await openArticleList(page);
    await tap(page, '#art-new');
    await page.fill('#art-title', 'チェックリスト295');
    await tap(page, '#art-mode-edit');
    await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().waitFor();
}
async function openMemo(page) {
    const asin = await firstBook(page);
    await page.evaluate(async (a) => {
        const bs = window.bookshelf;
        const b = bs.bookManager.getAllBooks().find((x) => x.asin === a);
        await bs._openBookMemoInAppEditor(a, b);
    }, asin);
    await expect(page.locator('#book-memo-modal')).toHaveClass(/show/);
    await page.waitForFunction(() => !!document.querySelector('#book-memo-modal .EasyMDEContainer'), null, { timeout: 10000 }).catch(() => {});
}

// 1ケース分の観測+判定+記録。setupAndAct は「ブート直後からの全手順」を含む自己完結クロージャ
// であること (NG時にここで bootApp() からやり直して再現するため)。
const SUMMARY = [];
async function runCase(page, testInfo, id, judgeOpts, setupAndAct) {
    const dir = join(OUT_ROOT, testInfo.project.name, id);
    await setupAndAct(page);
    let records = await observe(page, { ms: judgeOpts.ms ?? 3000, step: judgeOpts.step ?? 100 });
    let verdict = judge(records, judgeOpts);
    const needShots = !verdict.ok || SHOT_ALWAYS;
    if (needShots) {
        // 再現: もう一度ブートして同じ手順を踏み、今度は連続スクショつきで記録する (証拠を残す)。
        await bootApp(page);
        await setupAndAct(page);
        mkdirSync(dir, { recursive: true });
        records = await observe(page, { ms: judgeOpts.ms ?? 3000, step: judgeOpts.step ?? 100, dir });
        verdict = judge(records, judgeOpts);
    }
    mkdirSync(join(OUT_ROOT, testInfo.project.name), { recursive: true });
    writeFileSync(join(OUT_ROOT, testInfo.project.name, `${id}.json`), JSON.stringify({ id, verdict, records }, null, 1));
    SUMMARY.push({ id, project: testInfo.project.name, ok: verdict.ok, forbiddenFrame: verdict.forbiddenFrame, driftFrame: verdict.driftFrame, reasons: verdict.reasons, shots: needShots });
    return verdict;
}

test.describe('ハヘロ向け実機チェックリスト §6 自動化 (イシュー#295)', () => {
    test('CHK0 本詳細: 戻る→進むで一瞬も映らず詳細がそのまま開く (#291)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        let detailHashBeforeBack;
        const v = await runCase(page, ti, 'CHK0', { ms: 3000, expectFinal: { hash: (h) => h.includes('book/') }, forbidden: (r) => r.hash === '' || r.hash === '#/' }, async (p) => {
            await toShelf(p);
            const asin = await firstBook(p);
            await p.evaluate((a) => window.bookshelf.router.navigateBook(a), asin);
            await settle(p, 600);
            detailHashBeforeBack = (await snapState(p)).hash;
            await back(p); // 戻る(端スワイプの代替) — 本棚に戻る
            await settle(p, 300);
            await forward(p); // 続けて進む(端スワイプの代替) — 一瞬も映らず詳細がそのまま開くか
        });
        expect.soft(v.ok, `CHK0: ${v.reasons.join(' / ')}`).toBe(true);
        const final = await snapState(page);
        expect.soft(final.hash, '進むで同じ本詳細に戻る').toEqual(detailHashBeforeBack);
        expect(errors).toEqual([]);
    });

    test('CHK1 ドロワー→本棚→戻る→ホーム(メニューは出ない)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const before = await snapState(page);
        const v = await runCase(page, ti, 'CHK1', { ms: 3000, expectFinal: { hash: before.hash, drawer: false }, forbidden: (r) => r.drawer || r.openModals.length > 0 }, async (p) => {
            await p.evaluate(() => window.bookshelf._openDrawer());
            await settle(p);
            // back-nav-matrix.spec.js の R01 と同じ型: ドロワー内の本棚リスト項目を直接タップする。
            // toShelf(p)(下部ナビのタップ)で代用すると、ドロワーが開いている間に下部ナビの座標を
            // 実タップした際に別要素に当たる(Androidで実測・イシュー#295 step3)ため使わない。
            const item = p.locator('#sidebar [data-bookshelf-id], .sidebar [data-bookshelf-id], [data-shelf-id]').first();
            if (await item.count()) await item.tap();
            else await p.evaluate(() => { const bs = window.bookshelf; const sh = bs.userData.bookshelves.find((b) => !b.isSpecial) || bs.userData.bookshelves[0]; bs.switchBookshelf(sh.id); });
            await settle(p, 600);
            await back(p);
        });
        expect.soft(v.ok, `CHK1: ${v.reasons.join(' / ')}`).toBe(true);
        expect(errors).toEqual([]);
    });

    test('CHK2 スクロール→本を開く→戻る→本棚の同じ位置', async ({ page }, ti) => {
        const errors = await bootApp(page);
        let y0;
        const v = await runCase(page, ti, 'CHK2', { ms: 3000, forbidden: (r) => r.openModals.length > 0 || r.detailPinned }, async (p) => {
            await toShelf(p);
            await p.evaluate(() => { const el = document.scrollingElement; el.scrollTop = Math.min(300, el.scrollHeight); });
            y0 = await p.evaluate(() => document.scrollingElement.scrollTop);
            const asin = await firstBook(p);
            await p.evaluate((a) => window.bookshelf.router.navigateBook(a), asin);
            await settle(p, 600);
            await back(p);
        });
        const y1 = (await snapState(page)).scrollTop;
        expect.soft(v.ok, `CHK2: ${v.reasons.join(' / ')}`).toBe(true);
        expect.soft(Math.abs(y1 - y0), 'スクロール位置 (±2px)').toBeLessThanOrEqual(2);
        expect(errors).toEqual([]);
    });

    test('CHK3 長文メモに1文字→戻る→閉じる→再度開くと文字が残る', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const v = await runCase(page, ti, 'CHK3', { ms: 3000, expectFinal: { openModals: (m) => !m.includes('book-memo-modal') }, forbidden: (r) => r.openModals.includes('book-memo-modal') }, async (p) => {
            await openMemo(p);
            await p.evaluate(() => { const ed = window.bookshelf._bookMemoEditor || window.bookshelf.bookMemoEditor; if (ed) ed.value('戻る295保存'); });
            await back(p);
        });
        expect.soft(v.ok, `CHK3 戻る直後3秒: ${v.reasons.join(' / ')}`).toBe(true);
        // 時間差本番: 一度閉じたあと、もう一度開いて文字が残っているか (600msデバウンス保存後の確認)
        await openMemo(page);
        const persisted = await page.evaluate(() => { const ed = window.bookshelf._bookMemoEditor || window.bookshelf.bookMemoEditor; return ed ? ed.value() : null; });
        expect.soft(persisted, '再度開くと書いた文字が残っている').toBe('戻る295保存');
        expect(errors).toEqual([]);
    });

    test('CHK4 長文メモ見出しメニュー中に戻る→メニューだけ閉じる', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const v = await runCase(page, ti, 'CHK4', {
            ms: 3000,
            expectFinal: { headingMenuOpen: false, openModals: (m) => m.includes('book-memo-modal') },
            forbidden: (r) => !r.openModals.includes('book-memo-modal'),
        }, async (p) => {
            await openMemo(p);
            await tap(p, '#book-memo-modal .mde-heading-btn');
            await expect(p.locator('.mde-heading-menu')).toBeVisible();
            await back(p);
        });
        expect.soft(v.ok, `CHK4: ${v.reasons.join(' / ')}`).toBe(true);
        expect(errors).toEqual([]);
    });

    test('CHK5 記事: 全画面→編集→閲覧→一覧→閉じる、戻る4回を1段ずつ', async ({ page }, ti) => {
        const errors = await bootApp(page);
        let before;
        const v = await runCase(page, ti, 'CHK5', { ms: 3000, expectFinal: { openModals: (m) => m.length === 0 } }, async (p) => {
            before = await snapState(p);
            await openNewArticleEdit(p);
            const frame = p.frameLocator('#art-canvas-frame');
            await frame.locator('.art-cv-ins-btn').last().tap();
            await tap(p, '#art-add-sheet [data-block-type="text"]');
            await expect(p.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
            await back(p);
            expect.soft(await p.locator('#art-edit-view').getAttribute('data-art-mode'), '1回目=編集へ').toBe('edit');
            await back(p);
            expect.soft(await p.locator('#art-edit-view').getAttribute('data-art-mode'), '2回目=閲覧へ').toBe('view');
            await back(p);
            expect.soft(await p.locator('#art-list-view').isVisible(), '3回目=一覧へ').toBe(true);
            await back(p); // 4回目=記事が閉じて元の画面に戻る (この最後の観測窓が主眼)
        });
        expect.soft(v.ok, `CHK5 4回目close: ${v.reasons.join(' / ')}`).toBe(true);
        const final = await snapState(page);
        expect.soft(final.hash, '元の画面に戻る').toEqual(before.hash);
        expect(errors).toEqual([]);
    });

    test('CHK6 記事編集→×で閉じる→戻る1回で効く(空振りしない)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        let before, closedSnap;
        const v = await runCase(page, ti, 'CHK6', { ms: 3000 }, async (p) => {
            before = await snapState(p);
            await toShelf(p);
            await openNewArticleEdit(p);
            await p.evaluate(() => document.getElementById('publish-pages-close').click());
            await settle(p, 800);
            closedSnap = await snapState(p);
            await back(p);
        });
        const afterOneBack = await snapState(page);
        expect.soft(JSON.stringify(afterOneBack) === JSON.stringify(closedSnap), '戻る1回で効く(空振りしない)').toBe(false);
        expect.soft(afterOneBack.hash, '戻る1回でさらに1つ前(ホーム)へ').toEqual(before.hash);
        expect.soft(v.ok, `CHK6 observe: ${v.reasons.join(' / ')}`).toBe(true);
        expect(errors).toEqual([]);
    });

    test('CHK7 記事編集→公開パネル→設定リンク→戻る2回 (D05・#259型)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const v = await runCase(page, ti, 'CHK7', { ms: 3000, expectFinal: { openModals: (m) => !m.includes('settings-modal') && m.includes('publish-pages-modal') } }, async (p) => {
            await openNewArticleEdit(p);
            const pub = p.locator('#art-publish-header:visible, #art-bar-publish:visible').first();
            await pub.tap();
            await expect(p.locator('#art-publish-modal')).toHaveClass(/show/);
            const link = p.locator('#art-publish-modal .art-pub-link[data-settings]').first();
            await link.tap();
            await settle(p, 600);
            expect.soft((await snapState(p)).openModals).toContain('settings-modal');
            await back(p);
            expect.soft(await p.locator('.settings-modal-content').getAttribute('data-settings-view'), '戻る1回目=設定の一覧').toBe('master');
            await back(p); // 戻る2回目=設定が閉じ記事エディタに戻る (この観測窓が主眼)
        });
        expect.soft(v.ok, `CHK7 戻る2回目: ${v.reasons.join(' / ')}`).toBe(true);
        expect(errors).toEqual([]);
    });

    test('CHK8 設定カテゴリ→戻る2回で設定が閉じる', async ({ page }, ti) => {
        const errors = await bootApp(page);
        let before;
        const v = await runCase(page, ti, 'CHK8', { ms: 3000, expectFinal: { openModals: (m) => !m.includes('settings-modal') } }, async (p) => {
            before = await snapState(p);
            await p.evaluate(() => window.bookshelf._openSettingsModal());
            await tap(p, '#settings-master .settings-cat[data-cat="display-section"]');
            await back(p);
            expect.soft(await p.locator('.settings-modal-content').getAttribute('data-settings-view'), '戻る1回目=一覧').toBe('master');
            await back(p); // 戻る2回目=設定が閉じる (この観測窓が主眼)
        });
        expect.soft(v.ok, `CHK8 戻る2回目: ${v.reasons.join(' / ')}`).toBe(true);
        const final = await snapState(page);
        expect.soft(final.hash).toEqual(before.hash);
        expect(errors).toEqual([]);
    });

    test.afterAll(async () => {
        // 項目9: CHK0〜8 の観測すべてから「禁止状態(forbiddenFrame)の出現」を横断集計する
        // (独立テストにはしない・申し送りどおり)。
        mkdirSync(OUT_ROOT, { recursive: true });
        const chk9 = {
            totalCases: SUMMARY.length,
            anyForbiddenFlash: SUMMARY.filter((s) => s.forbiddenFrame !== null && s.forbiddenFrame !== undefined),
            anyDelayedDrift: SUMMARY.filter((s) => s.driftFrame !== null && s.driftFrame !== undefined),
        };
        writeFileSync(join(OUT_ROOT, `_summary-${process.pid}.json`), JSON.stringify({ cases: SUMMARY, chk9 }, null, 1));
    });
});
