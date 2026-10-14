// スマホの「戻る」網羅マトリクス (イシュー#284)
// 正本の表 = obsidian 80_🚀project/81_🚀development/bookshelf/17_戻る挙動テスト表_20261014.md
// ケースIDは表と同じ (R=ルーター/A=記事エディタ/L=長文メモ/X=設定・取込/G=汎用モーダル/D=確認)。
// 共通期待 E1 (履歴の段が余らない) と E4 (抑制カウンタが0) はケースごとに snap() で記録して検査する。
// 各ケースの履歴記録は tmp/verify-shots/284/<project>/<case>.json に残す (失敗時はスクショも)。
// webkit は BACKNAV_WEBKIT=1 のときだけ playwright.config に追加される (CI では chromium のみ)。
import { test, expect } from './helpers/test-base.js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const OUT_ROOT = join(here, '../../tmp/verify-shots/284');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function bootApp(page) {
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
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

// 履歴まわりの状態を1枚に撮る (E1/E4 の判定材料)
async function snap(page) {
    return page.evaluate(() => {
        const bs = window.bookshelf;
        return {
            len: history.length,
            state: history.state,
            hash: location.hash,
            stack: (bs._modalHistStack || []).map((e) => e.id),
            suppress: bs._histGoPending ? 1 : 0, // 新方式 (イシュー#284 K5): 自分の go の着地待ちが残っていないこと
            settingsHist: bs._settingsHist || 0,
            importHist: !!bs._importHist,
            openModals: Array.from(document.querySelectorAll('.modal.show')).map((m) => m.id),
            artMode: bs._artMode || null,
            drawer: document.body.classList.contains('drawer-open'),
            detailPinned: document.body.classList.contains('book-detail-pinned'),
            menus: {
                artMore: !(document.getElementById('art-more-menu') || { hidden: true }).hidden,
                heading: !!document.querySelector('.mde-heading-menu'),
                confirm: !!document.querySelector('.cfm-overlay'),
            },
        };
    });
}

// popstate の処理 (async close・抑制の消費) が落ち着くまで待つ
async function settle(page, ms = 400) { await page.waitForTimeout(ms); }

// 物理/ジェスチャーの戻る相当 (B2a)。webkit の goBack は「戻れない」時に null を返すだけなので握る
async function back(page) {
    await page.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => {});
    await settle(page);
}

async function tap(page, selector) {
    const loc = page.locator(selector);
    await loc.waitFor({ state: 'visible', timeout: 5000 });
    await loc.tap();
}

function recorder(testInfo, id) {
    const rec = { id, project: testInfo.project.name, steps: [] };
    return {
        rec,
        async step(page, label) { rec.steps.push({ label, ...(await snap(page)) }); },
        async save(page) {
            const dir = join(OUT_ROOT, testInfo.project.name);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, `${id}.json`), JSON.stringify(rec, null, 2));
            if (process.env.BACKNAV_SHOT_ALWAYS === '1' || testInfo.status !== testInfo.expectedStatus || testInfo.errors.length) {
                await page.screenshot({ path: join(dir, `${id}.png`) }).catch(() => {});
            }
        },
    };
}

// E3 (一瞬別画面): 戻る直後を50ms間隔で撮り、ファイルに残す (比較は step4 で画像を並べる)
async function burst(page, testInfo, id, action, frames = 8) {
    const dir = join(OUT_ROOT, testInfo.project.name, 'burst', id);
    mkdirSync(dir, { recursive: true });
    const p = action();
    for (let i = 0; i < frames; i++) {
        await page.screenshot({ path: join(dir, `${String(i).padStart(2, '0')}.png`) }).catch(() => {});
        await page.waitForTimeout(50);
    }
    await p;
}

async function openArticleList(page) {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await expect(page.locator('#publish-pages-modal')).toHaveClass(/show/);
}
async function openNewArticleEdit(page) {
    await openArticleList(page);
    await tap(page, '#art-new');
    await page.fill('#art-title', '戻る284');
    await tap(page, '#art-mode-edit');
    await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().waitFor();
}

async function firstBook(page) {
    return page.evaluate(() => {
        const bs = window.bookshelf;
        const b = (bs.books && bs.books[0]) || bs.bookManager.getAllBooks()[0];
        return b ? b.asin : null;
    });
}

// E1+E4: 開く前の snap と閉じた後の snap が揃っているか
function expectSameHistory(before, after) {
    expect.soft(after.suppress, 'E4 抑制カウンタが0に戻る').toBe(0);
    expect.soft(after.stack, 'E1 履歴スタックが空').toEqual(before.stack);
    expect.soft(after.state, 'E1 history.state が開く前と同じ').toEqual(before.state);
}

test.describe('戻る網羅マトリクス (イシュー#284)', () => {
    // ===== 仮説H1: 同期の連続 history.back() で抑制カウンタが余るか =====
    test('A36 記事: 閲覧中に×で閉じた後、段も抑制カウンタも残らない (H1)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'A36');
        const before = await snap(page);
        await r.step(page, 'before');
        await openArticleList(page);
        await tap(page, '#art-new'); // 一覧→閲覧(新規)
        await r.step(page, 'opened-view');
        await page.evaluate(() => document.getElementById('publish-pages-close').click()); // ×は狭幅の編集/閲覧では隠れる場合がある＝クリック経路(closePublishPagesModal)を直接通す
        await settle(page, 800);
        const after = await snap(page);
        await r.step(page, 'after-close');
        expect.soft(after.openModals).toEqual([]);
        expectSameHistory(before, after);
        // 閉じた後の戻る1回が無視されないこと (余った抑制で空振りしない)
        await page.evaluate(() => { window.__pop = 0; window.addEventListener('popstate', () => { window.__pop++; }); });
        await r.save(page);
        expect(errors).toEqual([]);
    });

    test('A35 記事: 編集中に×で閉じた後、段も抑制カウンタも残らない・保存される (H1)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'A35');
        const before = await snap(page);
        await r.step(page, 'before');
        await openNewArticleEdit(page);
        await r.step(page, 'opened-edit');
        await page.evaluate(() => document.getElementById('publish-pages-close').click()); // ×は狭幅の編集/閲覧では隠れる場合がある＝クリック経路(closePublishPagesModal)を直接通す
        await settle(page, 800);
        const after = await snap(page);
        await r.step(page, 'after-close');
        expect.soft(after.openModals).toEqual([]);
        expectSameHistory(before, after);
        // 記事の保存は _artFlushSave → publishArticleStore.create/update({persist:false}) でまずストアのメモリへ入り、
        // ファイル (adapter.writeJSON) への書き出しは後段の一括コミット。旧判定はメモリMap (=書き出し先) だけを
        // 見ていたため、保存済みでも false になっていた (step2〜4 の A35「保存される」NG はテスト側の誤り)。
        const saved = await page.evaluate(() => { try { return JSON.stringify(window.bookshelf.publishArticleStore).includes('戻る284'); } catch (_) { return false; } });
        expect.soft(saved, '保存される').toBe(true);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    test('A35b 記事: 編集中に×→再度開いて戻る1回で一覧が閉じる (余った抑制で戻るが無視されない)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'A35b');
        await openNewArticleEdit(page);
        await page.evaluate(() => document.getElementById('publish-pages-close').click()); // ×は狭幅の編集/閲覧では隠れる場合がある＝クリック経路(closePublishPagesModal)を直接通す
        await settle(page, 800);
        await r.step(page, 'after-close');
        await openArticleList(page);
        await r.step(page, 'reopened');
        await back(page);
        await r.step(page, 'after-back1');
        const s = await snap(page);
        expect.soft(s.openModals, '戻る1回で記事モーダルが閉じる').toEqual([]);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    // ===== #279 多段の一気通貫 =====
    test('A32 記事: 全画面→編集→閲覧→一覧→閉じる を戻る1回ずつ', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'A32');
        const before = await snap(page);
        await openNewArticleEdit(page);
        const frame = page.frameLocator('#art-canvas-frame');
        await frame.locator('.art-cv-ins-btn').last().tap();
        await tap(page, '#art-add-sheet [data-block-type="text"]');
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        await r.step(page, 'fs');
        await burst(page, ti, 'A32-fs', () => back(page));
        await r.step(page, 'back1');
        expect.soft(await page.locator('#art-edit-view').getAttribute('data-art-mode'), '1回目=編集へ').toBe('edit');
        await back(page);
        await r.step(page, 'back2');
        expect.soft(await page.locator('#art-edit-view').getAttribute('data-art-mode'), '2回目=閲覧へ').toBe('view');
        await back(page);
        await r.step(page, 'back3');
        expect.soft(await page.locator('#art-list-view').isVisible(), '3回目=一覧へ').toBe(true);
        await burst(page, ti, 'A32-close', () => back(page));
        await r.step(page, 'back4');
        const after = await snap(page);
        expect.soft(after.openModals, '4回目=閉じる').toEqual([]);
        expectSameHistory(before, after);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    test('A34 記事: 同じ4段を history.back() (B1) で', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'A34');
        const before = await snap(page);
        await openNewArticleEdit(page);
        const frame = page.frameLocator('#art-canvas-frame');
        await frame.locator('.art-cv-ins-btn').last().tap();
        await tap(page, '#art-add-sheet [data-block-type="text"]');
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        const b1 = async () => { await page.evaluate(() => history.back()); await settle(page); };
        await b1(); await r.step(page, 'back1');
        expect.soft(await page.locator('#art-edit-view').getAttribute('data-art-mode')).toBe('edit');
        await b1(); await r.step(page, 'back2');
        expect.soft(await page.locator('#art-edit-view').getAttribute('data-art-mode')).toBe('view');
        await b1(); await r.step(page, 'back3');
        expect.soft(await page.locator('#art-list-view').isVisible()).toBe(true);
        await b1(); await r.step(page, 'back4');
        const after = await snap(page);
        expect.soft(after.openModals).toEqual([]);
        expectSameHistory(before, after);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    test('A10 記事: 編集→完了ボタン→戻るで一覧 (完了が段を畳む)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'A10');
        await openNewArticleEdit(page);
        await r.step(page, 'edit');
        const done = page.locator('#art-bar-done:visible, #art-mode-done:visible').first();
        await done.tap();
        await settle(page);
        await r.step(page, 'after-done');
        expect.soft(await page.locator('#art-edit-view').getAttribute('data-art-mode')).toBe('view');
        await back(page);
        await r.step(page, 'back1');
        expect.soft(await page.locator('#art-list-view').isVisible(), '戻る1回で一覧').toBe(true);
        expect.soft((await snap(page)).suppress).toBe(0);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    // ===== D01: 積まないメニューを開いたまま戻る =====
    test('A23 記事: ⋯メニューを開いたまま戻る → メニューだけ閉じる (D01)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'A23');
        await openNewArticleEdit(page);
        await tap(page, '#art-more-btn');
        await r.step(page, 'menu-open');
        await back(page);
        const s = await snap(page);
        await r.step(page, 'back1');
        expect.soft(s.menus.artMore, 'メニューが閉じる').toBe(false);
        expect.soft(s.artMode, '編集の段は残る').toBe('edit');
        await r.save(page);
        expect(errors).toEqual([]);
    });

    // ===== D04: 確認ダイアログ表示中に戻る =====
    test('A15 記事: 全画面キャンセルの確認表示中に戻る → 確認だけキャンセル (D04)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'A15');
        await openNewArticleEdit(page);
        const frame = page.frameLocator('#art-canvas-frame');
        await frame.locator('.art-cv-ins-btn').last().tap();
        await tap(page, '#art-add-sheet [data-block-type="text"]');
        await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
        await page.evaluate(() => window.bookshelf._artTextFsEditor.value('変更あり'));
        await tap(page, '#art-fs-cancel');
        await expect(page.locator('.cfm-overlay')).toBeVisible();
        await r.step(page, 'confirm-open');
        await back(page);
        const s = await snap(page);
        await r.step(page, 'back1');
        expect.soft(s.menus.confirm, '確認が閉じる').toBe(false);
        expect.soft(s.artMode, '全画面は残る').toBe('form');
        await r.save(page);
        expect(errors).toEqual([]);
    });

    // ===== D05: 公開パネル→設定へのリンク =====
    test('A29 記事: 公開パネル→設定リンク→戻る (D05・#259型)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'A29');
        await openNewArticleEdit(page);
        const pub = page.locator('#art-publish-header:visible, #art-bar-publish:visible').first();
        await pub.tap();
        await expect(page.locator('#art-publish-modal')).toHaveClass(/show/);
        await r.step(page, 'panel');
        const link = page.locator('#art-publish-modal .art-pub-link[data-settings]').first();
        await link.tap();
        await settle(page, 600);
        await r.step(page, 'settings-open');
        const s1 = await snap(page);
        expect.soft(s1.openModals).toContain('settings-modal');
        await back(page);
        await r.step(page, 'back1');
        // D11: 設定の特定項目へジャンプした時は、戻る1回目で設定の一覧、2回目で設定が閉じて記事エディタへ
        expect.soft(await page.locator('.settings-modal-content').getAttribute('data-settings-view'), '戻る1回目=設定の一覧').toBe('master');
        expect.soft((await snap(page)).artMode, '裏の記事は編集のまま').toBe('edit');
        await back(page);
        await r.step(page, 'back2');
        const s2 = await snap(page);
        expect.soft(s2.openModals, '戻る2回目で設定が閉じ記事エディタに戻る').not.toContain('settings-modal');
        expect.soft(s2.artMode, '裏の記事は編集のまま').toBe('edit');
        expect.soft(s2.openModals).toContain('publish-pages-modal');
        expect.soft(s2.suppress).toBe(0);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    // ===== D03: スマホの本詳細シート =====
    test('R08/R09 本詳細シート: 戻るバー・戻る (D03)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'R08');
        const asin = await firstBook(page);
        const before = await snap(page);
        await r.step(page, 'before');
        await page.evaluate((a) => window.bookshelf.router.navigateBook(a), asin);
        await settle(page, 600);
        await r.step(page, 'detail-open');
        const s0 = await snap(page);
        // R09: 戻る
        await back(page);
        await r.step(page, 'R09-back1');
        const s1 = await snap(page);
        expect.soft(s1.hash, 'R09 戻る1回で本詳細のハッシュが外れる').not.toContain('book/');
        // R08: もう一度開いて戻るバー
        await page.evaluate((a) => window.bookshelf.router.navigateBook(a), asin);
        await settle(page, 600);
        await r.step(page, 'detail-open2');
        const backBar = page.locator('#mobile-detail-back');
        if (await backBar.isVisible()) {
            await backBar.tap();
            await settle(page);
            await r.step(page, 'R08-backbar');
            const s2 = await snap(page);
            expect.soft(s2.detailPinned, 'R08 戻るバーでシートが閉じる').toBe(false);
            expect.soft(s2.hash, 'R08 戻るバー後にハッシュの段が残らない').not.toContain('book/');
        } else {
            r.rec.note = `戻るバーが見えない (pinned=${s0.detailPinned})`;
        }
        r.rec.before = before;
        await r.save(page);
        expect(errors).toEqual([]);
    });

    // ===== R23: ドロワー→設定 (#259型) =====
    test('R23 ドロワー→設定→戻る1回で設定が閉じ、もう一段余らない', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'R23');
        const before = await snap(page);
        await tap(page, '#mobile-bottom-nav [data-mobile-nav="shelves"]');
        await settle(page);
        await r.step(page, 'drawer');
        await page.evaluate(() => document.querySelector('#mobile-bottom-nav [data-mobile-nav="settings"]').click()); // ドロワーを開いたまま(スクリムがタップを遮るため click を直接送る)下部ナビの「設定」(#259型の実経路)
        await settle(page, 600);
        await r.step(page, 'settings');
        await back(page);
        await r.step(page, 'back1');
        const s = await snap(page);
        expect.soft(s.openModals, '設定が閉じる').not.toContain('settings-modal');
        expect.soft(s.drawer, 'ドロワーは出ない').toBe(false);
        expect.soft(s.settingsHist).toBe(0);
        expect.soft(s.suppress).toBe(0);
        expect.soft(s.state, '段が余らない').toEqual(before.state);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    // ===== 設定の2段 =====
    test('X03/X04 設定: 詳細→一覧→閉じる を戻る1回ずつ', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'X04');
        const before = await snap(page);
        await page.evaluate(() => window.bookshelf._openSettingsModal());
        await tap(page, '#settings-master .settings-cat[data-cat="display-section"]');
        await r.step(page, 'detail');
        await back(page);
        await r.step(page, 'back1');
        expect.soft(await page.locator('.settings-modal-content').getAttribute('data-settings-view'), '1回目=一覧').toBe('master');
        await back(page);
        await r.step(page, 'back2');
        const s = await snap(page);
        expect.soft(s.openModals, '2回目=閉じる').not.toContain('settings-modal');
        expect.soft(s.state).toEqual(before.state);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    test('X06 設定: 詳細で×→段が2つとも畳まれる', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'X06');
        const before = await snap(page);
        await page.evaluate(() => window.bookshelf._openSettingsModal());
        await tap(page, '#settings-master .settings-cat[data-cat="display-section"]');
        await r.step(page, 'detail');
        await tap(page, '#settings-modal .modal-close');
        await settle(page, 600);
        await r.step(page, 'after-close');
        const s = await snap(page);
        expect.soft(s.openModals).not.toContain('settings-modal');
        expect.soft(s.state, '段が余らない').toEqual(before.state);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    // ===== D06: 再読込後 =====
    test('X12 設定を開いて再読込→戻るが空振りしない (D06)', async ({ page }, ti) => {
        await bootApp(page);
        const r = recorder(ti, 'X12');
        await page.evaluate(() => window.bookshelf._openSettingsModal());
        await r.step(page, 'settings');
        await page.reload();
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        await r.step(page, 'reloaded');
        // D06: 起動時に残った段を畳む (戻る1回目が空振りしない)。この後の戻るはアプリ外へ出る (D08) ので打たない
        await page.waitForFunction(() => history.state === null, null, { timeout: 3000 }).catch(() => {});
        await r.step(page, 'normalized');
        const s0 = await snap(page);
        expect.soft(s0.state, '再読込後に行き先のない段が残らない').toBeNull();
        expect.soft(s0.openModals).toEqual([]);
        await r.save(page);
    });

    // ===== 長文メモ =====
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

    test('L04 長文メモ: 変更ありで戻る→保存して閉じる・段が余らない', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'L04');
        const before = await snap(page);
        await openMemo(page);
        await page.evaluate(() => { const ed = window.bookshelf._bookMemoEditor || window.bookshelf.bookMemoEditor; if (ed) ed.value('戻る保存284'); });
        await r.step(page, 'memo');
        await burst(page, ti, 'L04', () => back(page));
        await settle(page, 600);
        await r.step(page, 'back1');
        const s = await snap(page);
        expect.soft(s.openModals).not.toContain('book-memo-modal');
        expectSameHistory(before, s);
        const saved = await page.evaluate(() => JSON.stringify(Array.from(window.__mem.values())).includes('戻る保存284'));
        expect.soft(saved, '保存される').toBe(true);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    test('L14 長文メモ: 見出しメニューを開いたまま戻る→メニューだけ閉じる (D01)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'L14');
        await openMemo(page);
        await tap(page, '#book-memo-modal .mde-heading-btn');
        await expect(page.locator('.mde-heading-menu')).toBeVisible();
        await r.step(page, 'menu');
        await back(page);
        await r.step(page, 'back1');
        const s = await snap(page);
        expect.soft(s.menus.heading, 'メニューが閉じる').toBe(false);
        expect.soft(s.openModals, '長文メモは残る').toContain('book-memo-modal');
        await r.save(page);
        expect(errors).toEqual([]);
    });

    test('L10 長文メモ: キャンセルの確認表示中に戻る→確認だけキャンセル (D04)', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'L10');
        await openMemo(page);
        await page.evaluate(() => { const ed = window.bookshelf._bookMemoEditor || window.bookshelf.bookMemoEditor; if (ed) ed.value('確認284'); });
        await tap(page, '#book-memo-fs-cancel');
        await expect(page.locator('.cfm-overlay')).toBeVisible();
        await r.step(page, 'confirm');
        await back(page);
        await r.step(page, 'back1');
        const s = await snap(page);
        expect.soft(s.menus.confirm, '確認が閉じる').toBe(false);
        expect.soft(s.openModals, '長文メモは残る').toContain('book-memo-modal');
        await r.save(page);
        expect(errors).toEqual([]);
    });

    // ===== ドロワー・⌘K・本棚選択 =====
    test('R01 ドロワー→本棚を選ぶ→戻る1回でホーム', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'R01');
        const before = await snap(page);
        await page.evaluate(() => window.bookshelf._openDrawer());
        await settle(page);
        const item = page.locator('#sidebar [data-bookshelf-id], .sidebar [data-bookshelf-id], [data-shelf-id]').first();
        if (await item.count()) await item.tap();
        else await page.evaluate(() => { const bs = window.bookshelf; const sh = bs.userData.bookshelves.find((b) => !b.isSpecial) || bs.userData.bookshelves[0]; bs.switchBookshelf(sh.id); });
        await settle(page, 600);
        await r.step(page, 'shelf');
        await burst(page, ti, 'R01', () => back(page));
        await r.step(page, 'back1');
        const s = await snap(page);
        expect.soft(s.hash, 'ホームへ').toEqual(before.hash);
        expect.soft(s.drawer).toBe(false);
        expect.soft(s.suppress).toBe(0);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    test('R14/R17 ドロワー: 戻る・Esc で閉じて段が余らない', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'R14');
        const before = await snap(page);
        await page.evaluate(() => window.bookshelf._openDrawer());
        await back(page);
        await r.step(page, 'R14-back');
        let s = await snap(page);
        expect.soft(s.drawer).toBe(false);
        expectSameHistory(before, s);
        await page.evaluate(() => window.bookshelf._openDrawer());
        await page.keyboard.press('Escape');
        await settle(page);
        await r.step(page, 'R17-esc');
        s = await snap(page);
        expect.soft(s.drawer).toBe(false);
        expectSameHistory(before, s);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    // ===== 汎用モーダルの3段入れ子 =====
    test('G15 本棚管理→フォーム→アイコンピッカー を戻る1回ずつ', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'G15');
        const before = await snap(page);
        await page.evaluate(() => window.bookshelf.showBookshelfManager ? window.bookshelf.showBookshelfManager() : null);
        if (!(await page.locator('#bookshelf-modal').evaluate((m) => m.classList.contains('show')).catch(() => false))) {
            await page.evaluate(() => document.getElementById('bookshelf-modal') && window.bookshelf._modalHistPush && window.bookshelf.openBookshelfModal && window.bookshelf.openBookshelfModal());
        }
        const mgrOpen = await page.locator('#bookshelf-modal.show').count();
        await page.evaluate(() => window.bookshelf.showBookshelfForm());
        await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
        const iconBtn = page.locator('#bookshelf-form-modal [id*="icon"]:visible').first();
        let pickerOpen = 0;
        if (await iconBtn.count()) { await iconBtn.tap(); await settle(page); pickerOpen = await page.locator('#icon-picker-modal.show').count(); }
        await r.step(page, 'stacked');
        r.rec.note = `manager=${mgrOpen} picker=${pickerOpen}`;
        const n = (await snap(page)).stack.length;
        for (let i = 0; i < n; i++) { await back(page); await r.step(page, `back${i + 1}`); }
        const s = await snap(page);
        expect.soft(s.openModals).toEqual([]);
        expectSameHistory(before, s);
        await r.save(page);
        expect(errors).toEqual([]);
    });

    test('G20/G24 除外一覧・手動追加: 戻る・×・Esc で閉じ段が余らない', async ({ page }, ti) => {
        const errors = await bootApp(page);
        const r = recorder(ti, 'G20');
        const before = await snap(page);
        for (const [open, id] of [['showExclusionsModal', 'exclusions-modal'], ['showAddBookModal', 'add-book-modal']]) {
            for (const how of ['back', 'close', 'esc']) {
                await page.evaluate((fn) => window.bookshelf[fn](), open);
                await expect(page.locator(`#${id}`)).toHaveClass(/show/);
                if (how === 'back') await back(page);
                else if (how === 'close') { await tap(page, `#${id} .modal-close`); await settle(page); }
                else { await page.keyboard.press('Escape'); await settle(page); }
                await r.step(page, `${id}-${how}`);
                const s = await snap(page);
                expect.soft(s.openModals, `${id} ${how}`).not.toContain(id);
                expectSameHistory(before, s);
            }
        }
        await r.save(page);
        expect(errors).toEqual([]);
    });
});
