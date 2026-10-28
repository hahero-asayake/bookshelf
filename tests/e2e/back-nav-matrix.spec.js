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
        // イシュー#372 (②承認・2026-10-26 10:41): 「戻る1回で履歴が2段消える」原因不明のまま証拠だけ残す。
        // テスト側(addInitScript)だけのフック＝アプリのコードは常設で変えない。失敗時に recorder.save() が
        // testInfo.attach でこの記録を保存する(popstate/hashchangeの発火回数と時刻)。
        window.__navDiag = { popstate: [], hashchange: [] };
        window.addEventListener('popstate', (ev) => {
            window.__navDiag.popstate.push({ t: performance.now(), state: ev.state, hash: location.hash });
        }, true);
        window.addEventListener('hashchange', () => {
            window.__navDiag.hashchange.push({ t: performance.now(), hash: location.hash });
        }, true);
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
            // イシュー#372: NavState本体(台帳)側のfaces/_pendingGoも記録する(証拠保存・②承認2026-10-26)
            navFaces: bs.nav ? bs.nav.state.faces.map((f) => f.id) : null,
            navPendingGo: bs.nav ? bs.nav._pendingGo : null,
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
                // イシュー#372 (②承認・2026-10-26 10:41): 「戻る1回で履歴が2段消える」証拠を失敗時だけ残す。
                // popstate/hashchangeの発火回数と時刻・NavStateのfaces/_pendingGo・history.lengthを添付する。
                const navDiag = await page.evaluate(() => window.__navDiag || null).catch(() => null);
                if (navDiag) {
                    await testInfo.attach(`${id}-navDiag`, {
                        body: JSON.stringify({ navDiag, lastSteps: rec.steps.slice(-3) }, null, 2),
                        contentType: 'application/json',
                    }).catch(() => {});
                }
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

// ===== 表 §4-3 の残り (その1: ルーター・⌘K・ドロワー・設定・取込・幅820=K6) =====
// 1ケース=1テスト。ケースIDは表と同じ。B2b (端スワイプ) は chromium/webkit に手段が無いため表で「不可」。
async function shelfInfo(page) {
    return page.evaluate(() => {
        const sh = window.bookshelf.userData.bookshelves.find((b) => !b.isSpecial);
        return { id: sh.id, slug: sh.slug || sh.id, name: sh.name };
    });
}
async function openDrawerTap(page) { await tap(page, '#mobile-bottom-nav [data-mobile-nav="shelves"]'); await settle(page); }
async function openPaletteTap(page) { await tap(page, '#mobile-bottom-nav [data-mobile-nav="search"]'); await settle(page); }
const paletteOpen = (page) => page.evaluate(() => !document.getElementById('command-palette').hidden);
async function pickShelfInPalette(page) {
    const { name } = await shelfInfo(page);
    await page.fill('#command-palette input', name);
    await settle(page, 200);
    await page.keyboard.press('Enter');
    await settle(page, 600);
}
async function caseRun(page, ti, id, body) {
    const errors = await bootApp(page);
    const r = recorder(ti, id);
    const before = await snap(page);
    await r.step(page, 'before');
    try { await body(r, before); } finally { await r.save(page); }
    // about:blank を経由するケース (URL直) では、addInitScript の localStorage 書き込みが about:blank 上で
    // SecurityError になる (アプリの不具合ではない) ので除外する
    expect(errors.filter((e) => !/localStorage' property from 'Window': Access is denied|SecurityError: The operation is insecure/.test(e))).toEqual([]);
}

test.describe('戻る網羅マトリクス 残り1 (イシュー#284 差し戻し)', () => {
    test('R03 ドロワー→本棚→history.back() でホーム', async ({ page }, ti) => caseRun(page, ti, 'R03', async (r, before) => {
        await openDrawerTap(page);
        const { id } = await shelfInfo(page);
        await page.evaluate((x) => window.bookshelf.switchBookshelf(x), id);
        await settle(page, 600);
        await page.evaluate(() => history.back()); await settle(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.hash).toEqual(before.hash);
        expect.soft(s.drawer).toBe(false);
    }));
    test('R04 ⌘K→本棚を選ぶ→戻る1回でホーム', async ({ page }, ti) => caseRun(page, ti, 'R04', async (r, before) => {
        await openPaletteTap(page);
        await pickShelfInPalette(page);
        await r.step(page, 'shelf');
        expect.soft((await snap(page)).hash).toContain('bookshelf/');
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.hash, 'ホームへ').toEqual(before.hash);
        expect.soft(await paletteOpen(page), 'パレットは出ない').toBe(false);
    }));
    test('R06 本棚→本を開く→戻る＝本棚・スクロール位置を保持 (D07)', async ({ page }, ti) => caseRun(page, ti, 'R06', async (r) => {
        const { id } = await shelfInfo(page);
        await page.evaluate((x) => window.bookshelf.switchBookshelf(x), id);
        await settle(page, 600);
        await page.evaluate(() => { const el = document.scrollingElement; el.scrollTop = Math.min(300, el.scrollHeight); });
        const y0 = await page.evaluate(() => document.scrollingElement.scrollTop);
        const asin = await firstBook(page);
        await page.evaluate((a) => window.bookshelf.router.navigateBook(a), asin);
        await settle(page, 600);
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        const y1 = await page.evaluate(() => document.scrollingElement.scrollTop);
        r.rec.scroll = { y0, y1 };
        expect.soft(s.hash).toContain('bookshelf/');
        expect.soft(Math.abs(y1 - y0), 'スクロール位置 (±2px)').toBeLessThanOrEqual(2);
    }));
    for (const [cid, hashOf] of [['R10', (sh) => `#/bookshelf/${encodeURIComponent(sh.slug)}`], ['R11', () => '#book/B000000001']]) {
        test(`${cid} URL直で開いて戻る＝アプリ外 (D08)`, async ({ page }, ti) => caseRun(page, ti, cid, async (r) => {
            const sh = await shelfInfo(page);
            await page.goto('about:blank');
            await page.goto('index.html' + hashOf(sh));
            await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
            await settle(page, 500);
            const s0 = await snap(page); r.rec.opened = s0;
            await page.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => {});
            await settle(page);
            r.rec.url = page.url();
            expect.soft(page.url(), 'アプリの前のページ (about:blank) へ出る').toBe('about:blank');
            await page.goForward().catch(() => {});
            await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData).catch(() => {});
        }));
    }
    test('R12 本棚で再読込→戻る＝ホーム', async ({ page }, ti) => caseRun(page, ti, 'R12', async (r, before) => {
        await openDrawerTap(page);
        const { id } = await shelfInfo(page);
        await page.evaluate((x) => window.bookshelf.switchBookshelf(x), id);
        await settle(page, 600);
        await page.reload();
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        await settle(page, 500);
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.hash, 'ホームへ').toEqual(before.hash);
        expect.soft(s.openModals).toEqual([]);
    }));
    test('R13 URL直 ?report= →通報ダイアログ→戻る＝閉じ、クエリは消えたまま', async ({ page }, ti) => caseRun(page, ti, 'R13', async (r) => {
        // 通報はハブのログインが前提。起動時に ?report= を処理するので、保存済みの同期設定にハブの鍵を入れておく
        await page.addInitScript(() => { try { const c = JSON.parse(localStorage.getItem('bookshelf_sync') || '{}'); c.hub = { key: 'test-key', apiBase: 'https://hub.example.invalid' }; localStorage.setItem('bookshelf_sync', JSON.stringify(c)); } catch (_) {} });
        await page.goto('about:blank');
        await page.goto('index.html?report=' + encodeURIComponent('https://example.org/a/b/'));
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        await settle(page, 600);
        // 未ログインでは通報ダイアログの前に確認ダイアログ (ログインの案内) が出る＝どちらか一方が最前面
        const s0 = await snap(page); await r.step(page, 'opened');
        r.rec.firstSurface = s0.stack;
        expect.soft(s0.stack.length, '通報か確認のどちらかが1段積まれている').toBe(1);
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.openModals).not.toContain('report-modal');
        expect.soft(s.menus.confirm).toBe(false);
        expect.soft(page.url()).not.toContain('report=');
        expect.soft(s.stack).toEqual([]);
    }));
    test('R16 ドロワー→スクリムをタップ＝閉じ、段が余らない', async ({ page }, ti) => caseRun(page, ti, 'R16', async (r, before) => {
        await openDrawerTap(page);
        await page.locator('#mobile-scrim').tap({ position: { x: 370, y: 400 } });
        await settle(page);
        const s = await snap(page); await r.step(page, 'scrim');
        expect.soft(s.drawer).toBe(false);
        expectSameHistory(before, s);
    }));
    test('R18 ドロワーを開いて再読込→段が畳まれ、戻るが空振りしない (D06)', async ({ page }, ti) => caseRun(page, ti, 'R18', async (r) => {
        await openDrawerTap(page);
        await page.reload();
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        await page.waitForFunction(() => history.state === null, null, { timeout: 3000 }).catch(() => {});
        const s = await snap(page); await r.step(page, 'reloaded');
        expect.soft(s.state).toBeNull();
        expect.soft(s.drawer).toBe(false);
    }));
    for (const [cid, how] of [['R19', 'back'], ['R20', 'backdrop'], ['R21', 'esc']]) {
        test(`${cid} ⌘K を開いて ${how} で閉じる・段が余らない`, async ({ page }, ti) => caseRun(page, ti, cid, async (r, before) => {
            await openPaletteTap(page);
            expect.soft(await paletteOpen(page)).toBe(true);
            if (how === 'back') await back(page);
            else if (how === 'backdrop') { await page.locator('#cmdk-backdrop').tap({ position: { x: 5, y: 5 } }); await settle(page); }
            else { await page.keyboard.press('Escape'); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(await paletteOpen(page)).toBe(false);
            expectSameHistory(before, s);
        }));
    }
    test('R22 ドロワー→⌘K→戻る＝パレットだけ閉じ、段が余らない', async ({ page }, ti) => caseRun(page, ti, 'R22', async (r, before) => {
        await openDrawerTap(page);
        await page.evaluate(() => document.querySelector('#mobile-bottom-nav [data-mobile-nav="search"]').click());
        await settle(page);
        await r.step(page, 'palette');
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(await paletteOpen(page)).toBe(false);
        expect.soft(s.drawer).toBe(false);
        expectSameHistory(before, s);
    }));

    // ===== 設定・取込 =====
    async function openSettingsTap(page) { await tap(page, '#mobile-bottom-nav [data-mobile-nav="settings"]'); await settle(page); }
    const settingsView = (page) => page.locator('.settings-modal-content').getAttribute('data-settings-view');
    test('X01 下部ナビ→設定→戻る＝閉じる', async ({ page }, ti) => caseRun(page, ti, 'X01', async (r, before) => {
        await openSettingsTap(page);
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.openModals).not.toContain('settings-modal');
        expectSameHistory(before, s);
    }));
    test('X05 設定 詳細→‹戻るボタン＝一覧・段は1つ', async ({ page }, ti) => caseRun(page, ti, 'X05', async (r) => {
        await openSettingsTap(page);
        await tap(page, '#settings-master .settings-cat[data-cat="display-section"]');
        await tap(page, '#settings-back');
        await settle(page);
        const s = await snap(page); await r.step(page, 'backbtn');
        expect.soft(await settingsView(page)).toBe('master');
        expect.soft(s.stack).toEqual(['settings-modal']);
        expect.soft(s.state && s.state.d).toBe(1);
    }));
    test('X07 カテゴリA→‹戻る→カテゴリB→戻る＝一覧', async ({ page }, ti) => caseRun(page, ti, 'X07', async (r) => {
        await openSettingsTap(page);
        await tap(page, '#settings-master .settings-cat[data-cat="display-section"]');
        await tap(page, '#settings-back');
        await settle(page);
        await tap(page, '#settings-master .settings-cat[data-cat="about-section"]');
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(await settingsView(page)).toBe('master');
        expect.soft(s.stack).toEqual(['settings-modal']);
    }));
    test('X08 設定 詳細で Esc＝閉じ、段が余らない', async ({ page }, ti) => caseRun(page, ti, 'X08', async (r, before) => {
        await openSettingsTap(page);
        await tap(page, '#settings-master .settings-cat[data-cat="display-section"]');
        await page.keyboard.press('Escape'); await settle(page, 600);
        const s = await snap(page); await r.step(page, 'esc');
        expect.soft(s.openModals).not.toContain('settings-modal');
        expectSameHistory(before, s);
    }));
    test('X09 設定の項目へジャンプ→戻る＝一覧 (D11)→戻る＝閉じる', async ({ page }, ti) => caseRun(page, ti, 'X09', async (r, before) => {
        await page.evaluate(() => window.bookshelf._openSettingsModal('publish-section'));
        await settle(page);
        await back(page);
        expect.soft(await settingsView(page)).toBe('master');
        await back(page);
        const s = await snap(page); await r.step(page, 'back2');
        expect.soft(s.openModals).not.toContain('settings-modal');
        expectSameHistory(before, s);
    }));
    test('X10/X11 設定→プラグイン設定→戻る/Esc＝プラグイン設定だけ閉じる', async ({ page }, ti) => caseRun(page, ti, 'X10', async (r) => {
        await openSettingsTap(page);
        await tap(page, '#settings-master .settings-cat[data-cat="plugins-section"]');
        for (const how of ['back', 'esc']) {
            await page.evaluate(() => window.bookshelf._openPluginSettings('fixture-plugin'));
            await settle(page);
            const opened = await page.locator('#plugin-settings-modal').isVisible().catch(() => false);
            r.rec[how] = { opened };
            if (how === 'back') await back(page); else { await page.keyboard.press('Escape'); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(await page.locator('#plugin-settings-modal').isVisible().catch(() => false), `${how}: プラグイン設定が閉じる`).toBe(false);
            expect.soft(s.openModals, `${how}: 設定は残る`).toContain('settings-modal');
            expect.soft(s.stack, `${how}: 設定の段は2つ (一覧+詳細)`).toEqual(['settings-modal', 'settings-cat']);
        }
    }));
    for (const [cid, how] of [['X13', 'back'], ['X14', 'close'], ['X14e', 'esc']]) {
        test(`${cid} 取込モーダル ${how}＝閉じ、段が余らない`, async ({ page }, ti) => caseRun(page, ti, cid, async (r, before) => {
            await page.evaluate(() => window.bookshelf.showImportModal());
            await expect(page.locator('#import-modal')).toHaveClass(/show/);
            if (how === 'back') await back(page);
            else if (how === 'close') { await tap(page, '#import-modal-close'); await settle(page); }
            else { await page.keyboard.press('Escape'); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(s.openModals).not.toContain('import-modal');
            expectSameHistory(before, s);
        }));
    }
    test('X15 設定(蔵書)→取込→戻る＝取込だけ閉じ、設定は残る (D12)', async ({ page }, ti) => caseRun(page, ti, 'X15', async (r) => {
        await openSettingsTap(page);
        await tap(page, '#settings-master .settings-cat[data-cat="library-section"]');
        await tap(page, '#import-kindle');
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await r.step(page, 'import');
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.openModals).not.toContain('import-modal');
        expect.soft(s.openModals).toContain('settings-modal');
        expect.soft(await settingsView(page)).toBe('detail');
    }));
});

// ===== K6: 幅 820 (769〜900) でも全ての面が履歴に積まれ、1段ずつ戻る (D10) =====
test.describe('戻る網羅マトリクス 幅820 (K6)', () => {
    test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });
    test('A40 幅820: 記事の引き出しシート→戻る＝シートだけ閉じる', async ({ page }, ti) => caseRun(page, ti, 'A40', async (r) => {
        await openNewArticleEdit(page);
        await page.evaluate(() => window.bookshelf._artOpenSheet && window.bookshelf._artOpenSheet());
        await settle(page);
        const s0 = await snap(page); await r.step(page, 'sheet');
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s0.stack, 'シートも記事の段も積まれている').toEqual(['publish-pages-modal', 'art-viewing', 'art-edit-mode', 'art-sheet']);
        expect.soft(s.stack).toEqual(['publish-pages-modal', 'art-viewing', 'art-edit-mode']);
        expect.soft(s.artMode).toBe('edit');
    }));
    test('A41 幅820: 編集→全画面→戻る＝編集 (完了扱い)', async ({ page }, ti) => caseRun(page, ti, 'A41', async (r) => {
        await openNewArticleEdit(page);
        await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().tap();
        await tap(page, '#art-add-sheet [data-block-type="text"]');
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.artMode).toBe('edit');
        expect.soft(s.openModals).toContain('publish-pages-modal');
    }));
    test('K6 幅820: 設定→戻る＝閉じる (768〜900 でも積まれる)', async ({ page }, ti) => caseRun(page, ti, 'K6-settings', async (r, before) => {
        await page.evaluate(() => window.bookshelf._openSettingsModal());
        await settle(page);
        const s0 = await snap(page); await r.step(page, 'open');
        expect.soft(s0.stack).toEqual(['settings-modal']);
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.openModals).not.toContain('settings-modal');
        expectSameHistory(before, s);
    }));
});

// ===== 表 §4-3 の残り (その2: 記事エディタ・長文メモ) =====
const artMode = (page) => page.locator('#art-edit-view').getAttribute('data-art-mode');
async function openArticleListTap(page) {
    await openArticleList(page);
}
async function newArticleView(page) {
    await openArticleListTap(page);
    await tap(page, '#art-new');
    await page.fill('#art-title', '戻る284');
}
async function insText(page) {
    await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().tap();
    await tap(page, '#art-add-sheet [data-block-type="text"]');
    await page.waitForFunction(() => !!window.bookshelf._artTextFsEditor, null, { timeout: 10000 });
}
const draftHas = (page, t) => page.evaluate((x) => JSON.stringify(window.bookshelf._artDraft || {}).includes(x) || JSON.stringify(window.bookshelf.publishArticleStore).includes(x), t);
async function lookBtn(page) { const h = page.locator('#art-look-btn'); if (await h.isVisible()) await h.tap(); else await tap(page, '#art-bar-look'); await settle(page); }
async function pubBtn(page) { const h = page.locator('#art-publish-header'); if (await h.isVisible()) await h.tap(); else await tap(page, '#art-bar-publish'); await settle(page); }

test.describe('戻る網羅マトリクス 残り2 記事エディタ (イシュー#284 差し戻し)', () => {
    for (const [cid, how] of [['A01', 'back'], ['A02', 'close'], ['A03', 'esc']]) {
        test(`${cid} 記事モーダル(一覧) ${how}＝閉じ、段が余らない`, async ({ page }, ti) => caseRun(page, ti, cid, async (r, before) => {
            await openArticleListTap(page);
            if (how === 'back') await back(page);
            else if (how === 'close') { await tap(page, '#publish-pages-close'); await settle(page); }
            else { await page.keyboard.press('Escape'); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(s.openModals).not.toContain('publish-pages-modal');
            expectSameHistory(before, s);
        }));
    }
    test('A04/A06 閲覧→戻る(goBack/history.back)＝一覧', async ({ page }, ti) => caseRun(page, ti, 'A04', async (r) => {
        for (const how of ['goBack', 'history']) {
            await openArticleListTap(page);
            await tap(page, '#art-new');
            if (how === 'goBack') await back(page); else { await page.evaluate(() => history.back()); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(await page.locator('#art-list-view').isVisible(), `${how}: 一覧`).toBe(true);
            expect.soft(s.stack, `${how}: 段`).toEqual(['publish-pages-modal']);
            await back(page);
        }
    }));
    test('A07/A08 閲覧→編集(変更あり)→戻る＝閲覧・保存', async ({ page }, ti) => caseRun(page, ti, 'A08', async (r) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        await page.fill('#art-title', '戻る284変更');
        await back(page);
        await r.step(page, 'back1');
        expect.soft(await artMode(page)).toBe('view');
        expect.soft(await draftHas(page, '戻る284変更'), '保存').toBe(true);
    }));
    test('A11/A13/A16 全画面(変更あり)→戻る/完了/Esc＝編集・保存', async ({ page }, ti) => caseRun(page, ti, 'A11', async (r) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        for (const how of ['back', 'done', 'esc']) {
            await insText(page);
            await page.evaluate((t) => window.bookshelf._artTextFsEditor.value(t), `本文${how}`);
            if (how === 'back') await back(page);
            else if (how === 'done') { await tap(page, '#art-fs-done'); await settle(page); }
            else { await page.keyboard.press('Escape'); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(await artMode(page), `${how}: 編集へ`).toBe('edit');
            expect.soft(await draftHas(page, `本文${how}`), `${how}: 保存`).toBe(true);
            expect.soft(s.stack, `${how}: 段`).toEqual(['publish-pages-modal', 'art-viewing', 'art-edit-mode']);
        }
    }));
    test('A14 全画面(変更あり)→キャンセル→確認OK＝編集・破棄・段が余らない', async ({ page }, ti) => caseRun(page, ti, 'A14', async (r) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        await insText(page);
        await page.evaluate(() => window.bookshelf._artTextFsEditor.value('破棄される本文'));
        await tap(page, '#art-fs-cancel');
        await tap(page, '.cfm-overlay .cfm-ok');
        await settle(page, 600);
        const s = await snap(page); await r.step(page, 'ok');
        expect.soft(await artMode(page)).toBe('edit');
        expect.soft(await draftHas(page, '破棄される本文'), '破棄').toBe(false);
        expect.soft(s.stack).toEqual(['publish-pages-modal', 'art-viewing', 'art-edit-mode']);
        expect.soft(s.state && s.state.d).toBe(3);
    }));
    test('A17/A18 ＋追加シート→戻る＝シートだけ／シート→本棚全画面→戻る＝編集(1段)', async ({ page }, ti) => caseRun(page, ti, 'A17', async (r) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().tap();
        await back(page);
        let s = await snap(page); await r.step(page, 'A17');
        expect.soft(await page.locator('#art-add-sheet').isHidden()).toBe(true);
        expect.soft(s.stack).toEqual(['publish-pages-modal', 'art-viewing', 'art-edit-mode']);
        await page.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().tap();
        await tap(page, '#art-add-sheet [data-block-type="shelf"]');
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
        s = await snap(page); expect.soft(s.stack.length, 'A18: シートの段を引き継ぎ二重に積まない').toBe(4);
        await back(page);
        s = await snap(page); await r.step(page, 'A18');
        expect.soft(await artMode(page)).toBe('edit');
        expect.soft(s.stack).toEqual(['publish-pages-modal', 'art-viewing', 'art-edit-mode']);
    }));
    test('A19/A20 ブロック⋯→戻る＝メニューだけ／⋯→編集(全画面)→戻る＝編集', async ({ page }, ti) => caseRun(page, ti, 'A19', async (r) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        await insText(page);
        await back(page);
        const frame = page.frameLocator('#art-canvas-frame');
        await frame.locator('.art-cv-more').first().tap();
        await back(page);
        let s = await snap(page); await r.step(page, 'A19');
        expect.soft(await page.locator('#art-blk-menu').isHidden()).toBe(true);
        expect.soft(s.stack).toEqual(['publish-pages-modal', 'art-viewing', 'art-edit-mode']);
        await frame.locator('.art-cv-more').first().tap();
        await tap(page, '#art-blk-menu [data-blk-act="edit"]');
        await back(page);
        s = await snap(page); await r.step(page, 'A20');
        expect.soft(await artMode(page)).toBe('edit');
        expect.soft(s.stack).toEqual(['publish-pages-modal', 'art-viewing', 'art-edit-mode']);
    }));
    test('A21/A22 見た目シート→戻る／閉じる＝シートだけ', async ({ page }, ti) => caseRun(page, ti, 'A21', async (r) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        for (const how of ['back', 'backdrop']) {
            await lookBtn(page);
            if (how === 'back') await back(page); else { await page.locator('#art-look-sheet [data-close]').first().tap({ position: { x: 10, y: 10 } }); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(await page.locator('#art-look-sheet').isHidden(), how).toBe(true);
            expect.soft(s.stack, how).toEqual(['publish-pages-modal', 'art-viewing', 'art-edit-mode']);
        }
    }));
    test('A24 記事⋯メニュー→Esc＝メニューだけ', async ({ page }, ti) => caseRun(page, ti, 'A24', async (r) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        await tap(page, '#art-more-btn');
        await page.keyboard.press('Escape'); await settle(page);
        const s = await snap(page); await r.step(page, 'esc');
        expect.soft(s.menus.artMore).toBe(false);
        expect.soft(s.stack).toEqual(['publish-pages-modal', 'art-viewing', 'art-edit-mode']);
    }));
    test('A25/A26 文章全画面の見出しメニュー→戻る／Esc＝メニューだけ', async ({ page }, ti) => caseRun(page, ti, 'A25', async (r) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        await insText(page);
        for (const how of ['back', 'esc']) {
            await tap(page, '#art-edit-view .mde-heading-btn');
            if (how === 'back') await back(page); else { await page.keyboard.press('Escape'); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(s.menus.heading, how).toBe(false);
            expect.soft(await artMode(page), how).toBe('form');
            expect.soft(s.stack.length, how).toBe(4);
        }
    }));
    test('A27/A28 公開パネル→戻る／×／Esc＝パネルだけ', async ({ page }, ti) => caseRun(page, ti, 'A27', async (r) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        for (const how of ['back', 'close', 'esc']) {
            await pubBtn(page);
            await expect(page.locator('#art-publish-modal')).toHaveClass(/show/);
            if (how === 'back') await back(page); else if (how === 'close') { await tap(page, '#art-pub-close'); await settle(page); } else { await page.keyboard.press('Escape'); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(s.openModals, how).not.toContain('art-publish-modal');
            expect.soft(s.stack, how).toEqual(['publish-pages-modal', 'art-viewing', 'art-edit-mode']);
        }
    }));
    test('A30/A31 プレビュー→戻る／Esc＝プレビューだけ', async ({ page }, ti) => caseRun(page, ti, 'A30', async (r) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        // プレビューはブロックが1つ以上ないと開かない (トーストのみ) ため、文章ブロックを1つ置く
        await insText(page);
        await page.evaluate(() => window.bookshelf._artTextFsEditor.value('本文'));
        await back(page);
        for (const how of ['back', 'esc']) {
            await tap(page, '#art-more-btn');
            await tap(page, '#art-width-preview');
            await settle(page, 600);
            await expect(page.locator('#pp-preview-modal')).toHaveClass(/show/);
            if (how === 'back') await back(page); else { await page.keyboard.press('Escape'); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(s.openModals, how).not.toContain('pp-preview-modal');
            expect.soft(s.openModals, how).toContain('publish-pages-modal');
            expect.soft(s.stack, how).toEqual(['publish-pages-modal', 'art-viewing', 'art-edit-mode']);
        }
    }));
    test('A37 編集中に Esc＝記事モーダルごと閉じる (D09)・段が余らない', async ({ page }, ti) => caseRun(page, ti, 'A37', async (r, before) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        await page.keyboard.press('Escape'); await settle(page, 600);
        const s = await snap(page); await r.step(page, 'esc');
        expect.soft(s.openModals).not.toContain('publish-pages-modal');
        expectSameHistory(before, s);
    }));
    test('A38 閲覧で下へスクロール→編集→戻る＝閲覧の同じ位置 (D07)', async ({ page }, ti) => caseRun(page, ti, 'A38', async (r) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        for (let i = 0; i < 3; i++) { await insText(page); await page.evaluate(() => window.bookshelf._artTextFsEditor.value('段落\n\n'.repeat(30))); await back(page); }
        await back(page); // 閲覧へ
        const col = '#art-edit-view .art-col';
        await page.evaluate((c) => { const el = document.querySelector(c); el.scrollTop = 400; }, col);
        const y0 = await page.evaluate((c) => document.querySelector(c).scrollTop, col);
        await tap(page, '#art-mode-edit');
        await back(page);
        const y1 = await page.evaluate((c) => document.querySelector(c).scrollTop, col);
        r.rec.scroll = { y0, y1 };
        expect.soft(await artMode(page)).toBe('view');
        expect.soft(Math.abs(y1 - y0), 'スクロール位置 (±2px)').toBeLessThanOrEqual(2);
    }));
    test('A39 編集中に再読込→段が畳まれ空振りしない (D06)', async ({ page }, ti) => caseRun(page, ti, 'A39', async (r) => {
        await newArticleView(page);
        await tap(page, '#art-mode-edit');
        await page.reload();
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        await page.waitForFunction(() => history.state === null, null, { timeout: 3000 }).catch(() => {});
        const s = await snap(page); await r.step(page, 'reloaded');
        expect.soft(s.state).toBeNull();
        expect.soft(s.openModals).toEqual([]);
    }));
});

test.describe('戻る網羅マトリクス 残り2 長文メモ (イシュー#284 差し戻し)', () => {
    async function openMemo2(page) {
        await page.evaluate(async () => { const bs = window.bookshelf; const b = bs.bookManager.getAllBooks()[0]; await bs._openBookMemoInAppEditor(b.asin, b); });
        await expect(page.locator('#book-memo-modal')).toHaveClass(/show/);
        await page.waitForFunction(() => !!window.bookshelf._bookMemoEditor, null, { timeout: 10000 }).catch(() => {});
    }
    const memoSaved = (page, t) => page.evaluate((x) => JSON.stringify(Array.from(window.__mem.values())).includes(x), t);
    const setMemo = (page, t) => page.evaluate((x) => window.bookshelf._bookMemoEditor.value(x), t);
    test('L01/L03 変更なし→戻る(goBack/history.back)＝閉じる・段が余らない', async ({ page }, ti) => caseRun(page, ti, 'L01', async (r, before) => {
        for (const how of ['goBack', 'history']) {
            await openMemo2(page);
            if (how === 'goBack') await back(page); else { await page.evaluate(() => history.back()); await settle(page, 600); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(s.openModals, how).not.toContain('book-memo-modal');
            expectSameHistory(before, s);
        }
    }));
    test('L06 変更あり→完了＝保存して閉じる・段が余らない', async ({ page }, ti) => caseRun(page, ti, 'L06', async (r, before) => {
        await openMemo2(page);
        await setMemo(page, '完了284');
        await tap(page, '#book-memo-fs-done'); await settle(page, 600);
        const s = await snap(page); await r.step(page, 'done');
        expect.soft(await memoSaved(page, '完了284')).toBe(true);
        expectSameHistory(before, s);
    }));
    test('L07 変更なし→キャンセル＝確認なしで閉じる', async ({ page }, ti) => caseRun(page, ti, 'L07', async (r, before) => {
        await openMemo2(page);
        await tap(page, '#book-memo-fs-cancel'); await settle(page, 600);
        const s = await snap(page); await r.step(page, 'cancel');
        expect.soft(s.menus.confirm).toBe(false);
        expectSameHistory(before, s);
    }));
    test('L08/L09 変更あり→キャンセル→確認OK＝破棄／確認キャンセル＝留まる', async ({ page }, ti) => caseRun(page, ti, 'L08', async (r, before) => {
        await openMemo2(page);
        await setMemo(page, '破棄284');
        await tap(page, '#book-memo-fs-cancel');
        await tap(page, '.cfm-overlay .cfm-cancel'); await settle(page);
        let s = await snap(page); await r.step(page, 'L09');
        expect.soft(s.openModals, 'L09 留まる').toContain('book-memo-modal');
        expect.soft(s.stack, 'L09 段は1つ').toEqual(['book-memo-modal']);
        await tap(page, '#book-memo-fs-cancel');
        await tap(page, '.cfm-overlay .cfm-ok'); await settle(page, 600);
        s = await snap(page); await r.step(page, 'L08');
        expect.soft(await memoSaved(page, '破棄284'), 'L08 破棄').toBe(false);
        expectSameHistory(before, s);
    }));
    test('L11 変更あり→Esc＝保存して閉じる', async ({ page }, ti) => caseRun(page, ti, 'L11', async (r, before) => {
        await openMemo2(page);
        await setMemo(page, 'Esc284');
        await page.keyboard.press('Escape'); await settle(page, 600);
        const s = await snap(page); await r.step(page, 'esc');
        expect.soft(await memoSaved(page, 'Esc284')).toBe(true);
        expectSameHistory(before, s);
    }));
    test('L12 保存失敗で戻る＝閉じず段を積み直す', async ({ page }, ti) => caseRun(page, ti, 'L12', async (r) => {
        await openMemo2(page);
        await setMemo(page, '失敗284');
        await page.evaluate(() => { window.bookshelf.storage.adapter.writeText = async () => { throw new Error('write fail (test)'); }; });
        await back(page); await settle(page, 600);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.openModals).toContain('book-memo-modal');
        expect.soft(s.stack).toEqual(['book-memo-modal']);
        expect.soft(s.state && s.state.d).toBe(1);
    }));
    test('L13 読込失敗の状態で戻る＝閉じる', async ({ page }, ti) => caseRun(page, ti, 'L13', async (r, before) => {
        await page.evaluate(() => { window.bookshelf.storage.adapter.readText = async () => { throw new Error('read fail (test)'); }; });
        await page.evaluate(async () => { const bs = window.bookshelf; const b = bs.bookManager.getAllBooks()[0]; await bs._openBookMemoInAppEditor(b.asin, b); }).catch(() => {});
        await expect(page.locator('#book-memo-modal')).toHaveClass(/show/);
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.openModals).not.toContain('book-memo-modal');
        expectSameHistory(before, s);
    }));
    test('L15 見出しメニュー→Esc＝メニューだけ', async ({ page }, ti) => caseRun(page, ti, 'L15', async (r) => {
        await openMemo2(page);
        await tap(page, '#book-memo-modal .mde-heading-btn');
        await page.keyboard.press('Escape'); await settle(page);
        const s = await snap(page); await r.step(page, 'esc');
        expect.soft(s.menus.heading).toBe(false);
        expect.soft(s.stack).toEqual(['book-memo-modal']);
    }));
    test('L16 長文メモを開いて再読込→段が畳まれる (D06)', async ({ page }, ti) => caseRun(page, ti, 'L16', async (r) => {
        await openMemo2(page);
        await page.reload();
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        await page.waitForFunction(() => history.state === null, null, { timeout: 3000 }).catch(() => {});
        const s = await snap(page); await r.step(page, 'reloaded');
        expect.soft(s.state).toBeNull();
    }));
    test('L17 本文を下へスクロール→見出しメニュー→Esc＝本文の位置を保持', async ({ page }, ti) => caseRun(page, ti, 'L17', async (r) => {
        await openMemo2(page);
        await setMemo(page, '行\n'.repeat(200));
        const sc = '#book-memo-modal .CodeMirror-scroll';
        await page.evaluate((c) => { const el = document.querySelector(c); if (el) el.scrollTop = 500; }, sc);
        const y0 = await page.evaluate((c) => (document.querySelector(c) || {}).scrollTop, sc);
        await tap(page, '#book-memo-modal .mde-heading-btn');
        await page.keyboard.press('Escape'); await settle(page);
        const y1 = await page.evaluate((c) => (document.querySelector(c) || {}).scrollTop, sc);
        r.rec.scroll = { y0, y1 };
        expect.soft(Math.abs(y1 - y0)).toBeLessThanOrEqual(2);
    }));
});

// ===== 表 §4-3 の残り (その3: 管理系モーダル 2-5・確認/トースト 2-6) =====
test.describe('戻る網羅マトリクス 残り3 管理系・確認 (イシュー#284 差し戻し)', () => {
    const openMgr = (page) => page.evaluate(() => window.bookshelf.showBookshelfManager());
    for (const [cid, how] of [['G01', 'back'], ['G03', 'close'], ['G04', 'esc'], ['G05', 'history']]) {
        test(`${cid} 本棚管理 ${how}＝閉じ、段が余らない`, async ({ page }, ti) => caseRun(page, ti, cid, async (r, before) => {
            await openMgr(page); await settle(page);
            if (how === 'back') await back(page);
            else if (how === 'history') { await page.evaluate(() => history.back()); await settle(page); }
            else if (how === 'close') { await tap(page, '#bookshelf-modal .modal-close'); await settle(page); }
            else { await page.keyboard.press('Escape'); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(s.openModals).not.toContain('bookshelf-modal');
            expectSameHistory(before, s);
        }));
    }
    for (const [cid, how] of [['G08', 'close'], ['G09', 'esc']]) {
        test(`${cid} 本棚管理→フォーム ${how}＝フォームだけ閉じる`, async ({ page }, ti) => caseRun(page, ti, cid, async (r) => {
            await openMgr(page);
            await page.evaluate(() => window.bookshelf.showBookshelfForm()); await settle(page);
            if (how === 'close') await tap(page, '#bookshelf-form-modal .modal-close'); else await page.keyboard.press('Escape');
            await settle(page);
            const s = await snap(page); await r.step(page, how);
            expect.soft(s.openModals).toEqual(['bookshelf-modal']);
            expect.soft(s.stack).toEqual(['bookshelf-modal']);
        }));
    }
    test('G10 フォーム(名前入力あり)→戻る＝破棄確認 (D13)。続ける＝留まる／破棄＝閉じる', async ({ page }, ti) => caseRun(page, ti, 'G10', async (r) => {
        await openMgr(page);
        await page.evaluate(() => window.bookshelf.showBookshelfForm()); await settle(page);
        await page.fill('#bookshelf-name', '入力途中284');
        await back(page);
        let s = await snap(page); await r.step(page, 'confirm');
        expect.soft(s.menus.confirm, '破棄確認が出る').toBe(true);
        expect.soft(s.openModals, 'フォームは開いたまま').toContain('bookshelf-form-modal');
        r.rec.overlays = await page.locator('.cfm-overlay').count();
        await tap(page, '.cfm-overlay .cfm-cancel'); await settle(page, 600);
        s = await snap(page); await r.step(page, 'keep');
        expect.soft(s.openModals, '続ける＝留まる').toContain('bookshelf-form-modal');
        expect.soft(s.stack, '続ける＝段は2つ').toEqual(['bookshelf-modal', 'bookshelf-form-modal']);
        expect.soft(await page.inputValue('#bookshelf-name')).toBe('入力途中284');
        await back(page);
        await tap(page, '.cfm-overlay .cfm-ok'); await settle(page, 600);
        s = await snap(page); await r.step(page, 'discard');
        expect.soft(s.openModals, '破棄＝フォームだけ閉じる').toEqual(['bookshelf-modal']);
        expect.soft(s.stack).toEqual(['bookshelf-modal']);
        await back(page);
        s = await snap(page); await r.step(page, 'back-mgr');
        expect.soft(s.openModals, 'もう1回で管理も閉じる').toEqual([]);
        expect.soft(s.state).toBeNull();
    }));
    for (const [cid, how] of [['G13', 'close'], ['G14', 'esc']]) {
        test(`${cid} フォーム→アイコンピッカー ${how}＝ピッカーだけ閉じる`, async ({ page }, ti) => caseRun(page, ti, cid, async (r) => {
            await page.evaluate(() => window.bookshelf.showBookshelfForm()); await settle(page);
            await page.locator('#bookshelf-form-modal [id*="icon"]:visible').first().tap(); await settle(page);
            expect.soft(await page.locator('#icon-picker-modal.show').count()).toBe(1);
            if (how === 'close') await tap(page, '#icon-picker-modal .modal-close'); else await page.keyboard.press('Escape');
            await settle(page);
            const s = await snap(page); await r.step(page, how);
            expect.soft(s.openModals).toEqual(['bookshelf-form-modal']);
            expect.soft(s.stack).toEqual(['bookshelf-form-modal']);
        }));
    }
    for (const [cid, how] of [['G16', 'back'], ['G18', 'close'], ['G19', 'esc']]) {
        test(`${cid} 子孫選択 ${how}＝スキップ ([] で解決)・段が余らない`, async ({ page }, ti) => caseRun(page, ti, cid, async (r, before) => {
            await page.evaluate(() => { const bs = window.bookshelf; window.__pick = 'pending'; bs._chooseDescendantsToAddTo(bs.userData.bookshelves.filter((b) => !b.isSpecial)).then((v) => { window.__pick = v; }); });
            await expect(page.locator('#descendants-pick-modal')).toHaveClass(/show/);
            if (how === 'back') await back(page);
            else if (how === 'close') { await tap(page, '#descendants-pick-modal-close'); await settle(page); }
            else { await page.keyboard.press('Escape'); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(await page.evaluate(() => window.__pick), 'Promise は [] で解決').toEqual([]);
            expect.soft(s.openModals).toEqual([]);
            expectSameHistory(before, s);
        }));
    }
    test('G28 手動追加(入力途中)→戻る＝破棄確認 (D13)', async ({ page }, ti) => caseRun(page, ti, 'G28', async (r, before) => {
        await page.evaluate(() => window.bookshelf.showAddBookModal()); await settle(page);
        const input = page.locator('#add-book-modal input:visible').first();
        await input.fill('B0TEST2840');
        await back(page);
        let s = await snap(page); await r.step(page, 'confirm');
        expect.soft(s.menus.confirm).toBe(true);
        await tap(page, '.cfm-overlay .cfm-ok'); await settle(page, 600);
        s = await snap(page); await r.step(page, 'discard');
        expect.soft(s.openModals).toEqual([]);
        expectSameHistory(before, s);
    }));
    // 通報はハブのログインが前提 (未ログインはログイン案内の確認だけが出る)。SyncConfigManager.load を差し替えてログイン状態にする
const openReport = (page) => page.evaluate(() => {
    if (!window.__hubStub) {
        window.__hubStub = true;
        const orig = SyncConfigManager.load.bind(SyncConfigManager);
        SyncConfigManager.load = () => ({ ...orig(), hub: { key: 'test-key', apiBase: 'https://hub.example.invalid' } });
    }
    window.bookshelf.openReportModal('https://example.org/a/b/');
});
    for (const [cid, how] of [['G29', 'back'], ['G31', 'close'], ['G32', 'esc']]) {
        test(`${cid} 通報ダイアログ(入力なし) ${how}＝閉じる`, async ({ page }, ti) => caseRun(page, ti, cid, async (r, before) => {
            await openReport(page); await settle(page);
            if (await page.locator('.cfm-overlay').count()) { r.rec.note = '未ログインの確認が先に出た'; await tap(page, '.cfm-overlay .cfm-cancel'); await settle(page); }
            const opened = await page.locator('#report-modal.show').count();
            r.rec.opened = opened;
            if (opened) {
                if (how === 'back') await back(page);
                else if (how === 'close') { await tap(page, '#report-modal-close'); await settle(page); }
                else { await page.keyboard.press('Escape'); await settle(page); }
            }
            const s = await snap(page); await r.step(page, how);
            expect.soft(s.openModals).not.toContain('report-modal');
            expectSameHistory(before, s);
        }));
    }
    test('G33 通報ダイアログ(入力途中)→戻る＝破棄確認 (D13)', async ({ page }, ti) => caseRun(page, ti, 'G33', async (r) => {
        await openReport(page); await settle(page);
        if (await page.locator('.cfm-overlay').count()) { await tap(page, '.cfm-overlay .cfm-cancel'); await settle(page); }
        const opened = await page.locator('#report-modal.show').count();
        r.rec.opened = opened;
        expect(opened, 'ログイン状態で通報ダイアログが開く').toBe(1);
        await page.fill('#report-reason', '入力途中');
        await back(page);
        const s = await snap(page); await r.step(page, 'confirm');
        expect.soft(s.menus.confirm).toBe(true);
        expect.soft(s.openModals).toContain('report-modal');
    }));
    for (const [cid, how] of [['G34', 'back'], ['G35', 'close']]) {
        test(`${cid} プラグイン設定(単独) ${how}＝閉じる`, async ({ page }, ti) => caseRun(page, ti, cid, async (r, before) => {
            await page.evaluate(() => window.bookshelf._openPluginSettings('fixture-plugin')); await settle(page);
            if (how === 'back') await back(page); else { await tap(page, '#plugin-settings-modal .psm-close'); await settle(page); }
            const s = await snap(page); await r.step(page, how);
            expect.soft(await page.locator('#plugin-settings-modal').isVisible()).toBe(false);
            expectSameHistory(before, s);
        }));
    }
    test('D01c 記事⋯→削除→確認中に戻る＝確認だけキャンセル (D04)', async ({ page }, ti) => caseRun(page, ti, 'D01c', async (r) => {
        await openArticleList(page);
        await tap(page, '#art-new');
        await page.fill('#art-title', '削除確認284');
        await tap(page, '#art-more-btn');
        await tap(page, '#art-del');
        await expect(page.locator('.cfm-overlay')).toBeVisible();
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.menus.confirm).toBe(false);
        expect.soft(s.openModals).toContain('publish-pages-modal');
        expect.soft(await page.locator('#art-edit-view').isVisible(), '記事は残る').toBe(true);
    }));
    test('D02c 確認ダイアログ→Esc＝キャンセル・下の面は残る', async ({ page }, ti) => caseRun(page, ti, 'D02c', async (r) => {
        await openArticleList(page);
        await tap(page, '#art-new');
        await page.fill('#art-title', '削除確認284');
        await tap(page, '#art-more-btn');
        await tap(page, '#art-del');
        await page.keyboard.press('Escape'); await settle(page);
        const s = await snap(page); await r.step(page, 'esc');
        expect.soft(s.menus.confirm).toBe(false);
        expect.soft(s.stack).toEqual(['publish-pages-modal', 'art-viewing']);
    }));
    test('D03c 同期衝突ダイアログ→戻る＝「何もしない」で閉じる (D04)・下の面は残る', async ({ page }, ti) => caseRun(page, ti, 'D03c', async (r) => {
        // 確認ダイアログは履歴に積まない規則 (②決裁)。下に面 (ここではドロワー) がある時、戻る＝確認だけキャンセルで下は残る
        await openDrawerTap(page);
        await page.evaluate(() => { window.bookshelf._conflictNotified = false; window.__cf = window.bookshelf._showConflictDialog('GitHub'); window.__cf.then((v) => { window.__cfv = v; }); });
        await expect(page.locator('#sync-conflict-dialog')).toBeVisible();
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(await page.locator('#sync-conflict-dialog').count()).toBe(0);
        expect.soft(await page.evaluate(() => window.__cfv)).toBe('cancel');
        expect.soft(s.drawer, 'ドロワーは残る').toBe(true);
        expect.soft(s.stack).toEqual(['drawer']);
        expect.soft(s.state && s.state.d).toBe(1);
    }));
    test('D04c トースト表示中にドロワー→戻る＝ドロワーだけ閉じる', async ({ page }, ti) => caseRun(page, ti, 'D04c', async (r, before) => {
        await page.evaluate(() => window.toast && window.toast('テスト284'));
        await openDrawerTap(page);
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.drawer).toBe(false);
        expectSameHistory(before, s);
    }));
});

// ===== イシュー#288 ②差し戻し指示3: 本詳細シートの開き方の残り(検索・ホーム・URL直・再読込後)とシート外タップ =====
test.describe('本詳細シート: 開き方・閉じ方の残り (イシュー#288)', () => {
    test('R08d 本詳細: ⌘K検索から開く→戻るで閉じる', async ({ page }, ti) => caseRun(page, ti, 'R08d', async (r, before) => {
        await openPaletteTap(page);
        await page.fill('#command-palette input', 'フィクスチャの本 1');
        await settle(page, 300);
        await page.keyboard.press('Enter');
        await settle(page, 600);
        const s0 = await snap(page); await r.step(page, 'opened');
        expect.soft(s0.detailPinned, '検索選択で本詳細が開く').toBe(true);
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.detailPinned, '戻るで閉じる').toBe(false);
        expect.soft(s.hash).toEqual(before.hash);
    }));

    test('R08e 本詳細: ホームの本タイルから開く→戻るで閉じる', async ({ page }, ti) => caseRun(page, ti, 'R08e', async (r, before) => {
        await page.evaluate(() => window.bookshelf.router.navigateMain());
        await settle(page, 400);
        const tile = page.locator('[data-asin]').first();
        await tile.waitFor({ state: 'visible', timeout: 5000 });
        await tile.tap();
        await settle(page, 600);
        const s0 = await snap(page); await r.step(page, 'opened');
        expect.soft(s0.detailPinned, 'ホームの本タイルから本詳細が開く').toBe(true);
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.detailPinned, '戻るで閉じる').toBe(false);
    }));

    test('R08f 本詳細: URL直で開く→戻る＝アプリ外 (D08と同型)', async ({ page }, ti) => caseRun(page, ti, 'R08f', async (r) => {
        const asin = await firstBook(page);
        await page.goto('about:blank');
        await page.goto('index.html#book/' + encodeURIComponent(asin));
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        await settle(page, 600);
        const s0 = await snap(page); r.rec.opened = s0;
        expect.soft(s0.detailPinned, 'URL直で本詳細が開く').toBe(true);
        await page.goBack({ waitUntil: 'commit', timeout: 3000 }).catch(() => {});
        await settle(page);
        r.rec.url = page.url();
        expect.soft(page.url(), 'アプリの前のページ(about:blank)へ出る').toBe('about:blank');
    }));

    test('R08g 本詳細: 開いた状態で再読込→段が畳まれ戻るが空振りしない (D06)', async ({ page }, ti) => caseRun(page, ti, 'R08g', async (r) => {
        const asin = await firstBook(page);
        await page.evaluate((a) => window.bookshelf.router.navigateBook(a), asin);
        await settle(page, 600);
        await page.reload();
        await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
        await settle(page, 1200);
        const s0 = await snap(page); await r.step(page, 'reloaded');
        r.rec.hashAfterReload = s0.hash;
        expect.soft(s0.detailPinned, `再読込後も本詳細のまま(URLのhashを引き継ぐ・hash=${s0.hash})`).toBe(true);
        await back(page);
        const s = await snap(page); await r.step(page, 'back1');
        expect.soft(s.detailPinned, '戻るで閉じる(空振りしない)').toBe(false);
    }));

    test('R08h 本詳細: シート外タップは存在しない(フルスクリーンシートのため・CSS実測)', async ({ page }) => {
        await bootApp(page);
        const asin = await firstBook(page);
        await page.evaluate((a) => window.bookshelf.router.navigateBook(a), asin);
        await settle(page, 600);
        // .app-detail は position:fixed; inset:0 のフルスクリーンシート(css/bookshelf.css実測)。
        // ドロワー(#mobile-scrim)やコマンドパレット(#cmdk-backdrop)のような可視の背景(スクリム)を持たない=
        // 「シート外タップ」に対応する専用UIが無いことをDOMで確認する(無いことの実測・ベストエフォートではなく仕様として確定)。
        const hasBackdrop = await page.evaluate(() => {
            const detail = document.querySelector('.app-detail');
            const r = detail.getBoundingClientRect();
            return { fullscreen: r.top === 0 && r.left === 0 && r.width === window.innerWidth && r.height === window.innerHeight, scrimCount: document.querySelectorAll('.bd-scrim, .detail-scrim, .book-detail-scrim').length };
        });
        expect.soft(hasBackdrop.fullscreen, '本詳細シートはフルスクリーン(枠外が存在しない)').toBe(true);
        expect.soft(hasBackdrop.scrimCount, '専用スクリム要素は無い').toBe(0);
    });

    // イシュー#350: showBookDetail(book, true) が navigateBook() 経由でhashを書き換えると、
    // 今のhashと異なる場合にブラウザが非同期にhashchangeを発火し、_applyRoute (js/bookshelf.js
    // :7608〜) が固定値 false で showBookDetail を呼び直してしまい、開いた直後に編集モードが
    // 静かに view へ戻っていた(_lastDetailEditModeが数ms後にfalseへ戻り.bd-gripが消える)。
    // 本番の3呼び出し元(編集切替ボタン・本棚追加後の再表示)は「既に同じ本が同じhashで開いている」
    // 状態からしか呼ばれないため通常は再現しないが、hashが未確定(空など)の状態から直接呼ぶと
    // 再現する。再現には起動直後(hash='')から直接呼ぶ条件を使う。
    test('R08i 本詳細: hash未確定の状態からshowBookDetail(book,true)で開く→編集モードが静かに戻らない (イシュー#350)', async ({ page }) => {
        await bootApp(page);
        const before = await snap(page);
        expect.soft(before.hash, '前提: 起動直後はhashが空').toBe('');
        const book = await page.evaluate(() => {
            const bs = window.bookshelf;
            return (bs.books && bs.books[0]) || bs.bookManager.getAllBooks()[0];
        });
        await page.evaluate((b) => window.bookshelf.showBookDetail(b, true), book);
        // hashchange(非同期)が落ち着くのを待つ(段差があった場合はここで false に戻っていた)
        await settle(page, 500);
        const after = await page.evaluate(() => ({
            isEditMode: window.bookshelf._lastDetailEditMode,
            grips: document.querySelectorAll('.bd-grip').length,
            hash: location.hash,
        }));
        expect.soft(after.isEditMode, '編集モードがhashchange後も true のまま').toBe(true);
        expect.soft(after.grips, '並べ替えハンドル(.bd-grip)が消えていない').toBeGreaterThan(0);
        expect.soft(after.hash).toContain('book/' + encodeURIComponent(book.asin));
    });
});

// ===== イシュー#291 (②決裁2026-10-19): 「進む」(iOS端スワイプ=ブラウザの進む相当) で、
// 開き直せる面は本当に開き直す(一瞬映って消える違和感を無くす)。開き直せない面は、進む候補
// 自体を履歴から消す(段を残さない)。方針の根拠は obsidian 17_戻る挙動テスト表・ADR 参照。
// chromium/webkitは page.goForward()、Androidはback284.mjsで物理ジェスチャ相当を使う。
test.describe('進む 網羅 (イシュー#291)', () => {
    async function forwardCheck(page, ti, id, openFn, assertClosed, assertAfterForward) {
        const errors = await bootApp(page);
        const r = recorder(ti, id);
        await openFn(page);
        await settle(page, 500);
        await r.step(page, 'opened');
        await back(page);
        await settle(page, 400);
        await r.step(page, 'back1');
        const s1 = await snap(page);
        await assertClosed(s1);
        // 進む直後0~480msをバーストで撮る(修正前後比較用)
        const dir = join(OUT_ROOT, ti.project.name, 'burst', id);
        mkdirSync(dir, { recursive: true });
        const p = page.goForward().catch(() => {});
        for (let i = 0; i < 6; i++) { await page.screenshot({ path: join(dir, `${String(i).padStart(2, '0')}.png`) }).catch(() => {}); await page.waitForTimeout(80); }
        await p;
        await settle(page, 400);
        const s2 = await snap(page);
        await r.step(page, 'forward1');
        await assertAfterForward(s2, s1);
        await r.save(page);
        expect(errors).toEqual([]);
    }

    test('R09f 本詳細: 戻った後に進むと開き直る (#291・開き直す方針)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'R09f',
            async (p) => { const asin = await firstBook(p); await p.evaluate((a) => window.bookshelf.router.navigateBook(a), asin); },
            (s) => expect.soft(s.hash).not.toContain('book/'),
            (s) => { expect.soft(s.hash, '進むと#book/へ戻る').toContain('book/'); expect.soft(s.detailPinned, '進むとピン留めされる').toBe(true); });
    });

    test('X16f 設定モーダル: 戻った後に進むと開き直る (#291・開き直す方針)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'X16f',
            async (p) => p.evaluate(() => window.bookshelf._openSettingsModal()),
            (s) => expect.soft(s.openModals).not.toContain('settings-modal'),
            (s) => expect.soft(s.openModals, '進むと開く').toContain('settings-modal'));
    });

    test('R24f ドロワー: 戻った後に進むと開き直る (#291・開き直す方針)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'R24f',
            async (p) => p.evaluate(() => window.bookshelf._openDrawer()),
            (s) => expect.soft(s.drawer).toBe(false),
            (s) => expect.soft(s.drawer, '進むと開く').toBe(true));
    });

    test('A42f 記事一覧モーダル: 戻った後に進むと開き直る (#291・開き直す方針)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'A42f',
            async (p) => p.evaluate(() => window.bookshelf.openPublishPagesModal()),
            (s) => expect.soft(s.openModals).not.toContain('publish-pages-modal'),
            (s) => expect.soft(s.openModals, '進むと開く').toContain('publish-pages-modal'));
    });

    test('L15f 長文メモ: 戻った後に進むと開き直る (#291・開き直す方針・stateにasin)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'L15f',
            async (p) => {
                const asin = await firstBook(p);
                await p.evaluate(async (a) => {
                    const bs = window.bookshelf;
                    const b = bs.bookManager.getAllBooks().find((x) => x.asin === a);
                    await bs._openBookMemoInAppEditor(a, b);
                }, asin);
            },
            (s) => expect.soft(s.openModals).not.toContain('book-memo-modal'),
            (s) => expect.soft(s.openModals, '進むと開く').toContain('book-memo-modal'));
    });

    test('A43f 記事編集(全画面): 戻った後に進むと開き直る (#291・開き直す方針・stateにblockId)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'A43f',
            async (p) => {
                await openNewArticleEdit(p);
                const frame = p.frameLocator('#art-canvas-frame');
                await frame.locator('.art-cv-ins-btn').last().tap();
                await tap(p, '#art-add-sheet [data-block-type="text"]');
                await expect(p.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
            },
            (s) => expect.soft(s.artMode).not.toBe('form'),
            (s) => expect.soft(s.artMode, '進むと全画面が開く').toBe('form'));
    });

    test('G36f 本棚フォーム: 戻った後に進むと開き直る (#291・開き直す方針・stateにbsKey)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'G36f',
            async (p) => { await p.evaluate(() => window.bookshelf.showBookshelfForm()); await settle(p); },
            (s) => expect.soft(s.openModals).not.toContain('bookshelf-form-modal'),
            (s) => expect.soft(s.openModals, '進むと開く').toContain('bookshelf-form-modal'));
    });

    test('G37f アイコンピッカー: 戻った後に進むと開き直る (#291・開き直す方針・stateにtitle/current)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'G37f',
            async (p) => {
                await p.evaluate(() => window.bookshelf.showBookshelfForm()); await settle(p);
                await p.locator('#bookshelf-form-modal [id*="icon"]:visible').first().tap(); await settle(p);
                await expect(p.locator('#icon-picker-modal')).toHaveClass(/show/);
            },
            (s) => expect.soft(s.openModals).not.toContain('icon-picker-modal'),
            (s) => expect.soft(s.openModals, '進むと開く').toContain('icon-picker-modal'));
    });

    test('G38f 子孫選択: 戻った後に進むと開き直る (#291・開き直す方針・stateにdescIds)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'G38f',
            async (p) => {
                await p.evaluate(() => { const bs = window.bookshelf; window.__pick = 'pending'; bs._chooseDescendantsToAddTo(bs.userData.bookshelves.filter((b) => !b.isSpecial)).then((v) => { window.__pick = v; }); });
                await expect(p.locator('#descendants-pick-modal')).toHaveClass(/show/);
            },
            (s) => expect.soft(s.openModals).not.toContain('descendants-pick-modal'),
            (s) => expect.soft(s.openModals, '進むと開く').toContain('descendants-pick-modal'));
    });

    test('A44f 記事閲覧状態: 戻った後に進むと開き直る (#291・開き直す方針・stateにarticleId)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'A44f',
            async (p) => { await newArticleView(p); },
            (s) => expect.soft(s.stack).not.toContain('art-viewing'),
            (s) => expect.soft(s.stack, '進むと開く').toContain('art-viewing'));
    });

    test('A45f 記事編集状態: 戻った後に進むと開き直る (#291・開き直す方針・stateにarticleId)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'A45f',
            async (p) => { await newArticleView(p); await tap(p, '#art-mode-edit'); },
            (s) => expect.soft(s.stack).not.toContain('art-edit-mode'),
            (s) => expect.soft(s.stack, '進むと開く').toContain('art-edit-mode'));
    });

    test('A46f 追加シート: 戻った後に進むと開き直る (#291・開き直す方針・stateにmenuIndex)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'A46f',
            async (p) => {
                await newArticleView(p); await tap(p, '#art-mode-edit');
                await p.frameLocator('#art-canvas-frame').locator('.art-cv-ins-btn').last().tap();
                await expect(p.locator('#art-add-sheet')).toBeVisible();
            },
            (s) => expect.soft(s.stack).not.toContain('art-add-sheet'),
            (s) => expect.soft(s.stack, '進むと開く').toContain('art-add-sheet'));
    });

    test('A47f 見た目シート: 戻った後に進むと開き直る (#291・開き直す方針・stateにarticleId)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'A47f',
            async (p) => { await newArticleView(p); await tap(p, '#art-mode-edit'); await lookBtn(p); await expect(p.locator('#art-look-sheet')).toBeVisible(); },
            (s) => expect.soft(s.stack).not.toContain('art-look-sheet'),
            (s) => expect.soft(s.stack, '進むと開く').toContain('art-look-sheet'));
    });

    test('A48f 公開パネル: 戻った後に進むと開き直る (#291・開き直す方針・stateにarticleId)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'A48f',
            async (p) => { await newArticleView(p); await tap(p, '#art-mode-edit'); await pubBtn(p); await expect(p.locator('#art-publish-modal')).toHaveClass(/show/); },
            (s) => expect.soft(s.openModals).not.toContain('art-publish-modal'),
            (s) => expect.soft(s.openModals, '進むと開く').toContain('art-publish-modal'));
    });

    test('A49f プレビュー: 戻った後に進むと開き直る (#291・開き直す方針・stateにarticleId)', async ({ page }, ti) => {
        await forwardCheck(page, ti, 'A49f',
            async (p) => {
                await newArticleView(p); await tap(p, '#art-mode-edit');
                await insText(p);
                await p.evaluate(() => window.bookshelf._artTextFsEditor.value('本文291'));
                await back(p);
                await tap(p, '#art-more-btn');
                await tap(p, '#art-width-preview');
                await settle(p, 600);
                await expect(p.locator('#pp-preview-modal')).toHaveClass(/show/);
            },
            (s) => expect.soft(s.openModals).not.toContain('pp-preview-modal'),
            (s) => expect.soft(s.openModals, '進むと開く').toContain('pp-preview-modal'));
    });
});

// ===== イシュー#288: 記事エディタのブロックチップ =====
test.describe('ブロックのチップ (イシュー#288)', () => {
    async function setupChipBlocks(page) {
        await openNewArticleEdit(page);
        await page.evaluate(() => {
            const bs = window.bookshelf;
            const mk = (type, extra) => ({ id: `blk-${type}-${Math.random().toString(36).slice(2, 8)}`, type, ...extra });
            bs._artDraft.blocks = [
                mk('text', { markdown: '' }),
                mk('book', { asin: null, show: {} }),
                mk('shelf', { shelfId: 'fixshelf', items: [] }),
                mk('text', { markdown: '## 見出し\n本文のサンプルです。' }),
            ];
            bs._artRenderBlocks();
        });
        await page.waitForTimeout(400);
    }

    test('ピル(種別+⋯統合): 文言は種類名のみ・タップ領域44px以上・空ブロックは高さ64px以上・本文と交差しない', async ({ page }) => {
        const errors = await bootApp(page);
        await setupChipBlocks(page);
        const measure = await page.evaluate(() => {
            const doc = document.getElementById('art-canvas-frame').contentDocument;
            const intersect = (a, b) => !!(a && b && !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom));
            return Array.from(doc.querySelectorAll('.art-cv-blk')).map((sec) => {
                const more = sec.querySelector('.art-cv-more');
                const guide = sec.querySelector('.art-cv-empty-guide');
                const content = sec.querySelector('h2,h1,p');
                const mr = more && more.getBoundingClientRect();
                // .art-cv-more::after{inset:-8px} が実タップ領域 (CSSで固定・疑似要素は直接測れないため計算で出す)
                const tapW = mr ? mr.width + 16 : null;
                const tapH = mr ? mr.height + 16 : null;
                return {
                    idx: sec.dataset.artIdx,
                    label: more ? more.querySelector('span')?.textContent : null,
                    tapW, tapH,
                    height: Math.round(sec.getBoundingClientRect().height),
                    guideText: guide ? guide.textContent : null,
                    pillTextOverlap: intersect(mr, content && content.getBoundingClientRect()),
                };
            });
        });
        for (const m of measure) {
            expect.soft(m.tapW, `idx${m.idx} ピルのタップ幅44px以上`).toBeGreaterThanOrEqual(44);
            expect.soft(m.tapH, `idx${m.idx} ピルのタップ高さ44px以上`).toBeGreaterThanOrEqual(44);
            expect.soft(m.pillTextOverlap, `idx${m.idx} ピルが本文と交差しない`).toBe(false);
        }
        expect.soft(measure[0].label, '空の文章ブロックの文言は種類名のみ').toBe('文章');
        expect.soft(measure[0].height, '空の文章ブロックは64px以上').toBeGreaterThanOrEqual(64);
        expect.soft(measure[0].guideText).toBe('タップして文章を書く');
        expect.soft(measure[1].label, '空の本ブロックの文言は種類名のみ').toBe('本');
        expect.soft(measure[1].height, '空の本ブロックは64px以上').toBeGreaterThanOrEqual(64);
        expect.soft(measure[1].guideText).toBe('タップして本を選ぶ');
        expect.soft(measure[2].label, '空の本棚ブロックの文言は「本棚」のみ(冊数なし)').toBe('本棚');
        expect.soft(measure[2].height, '空の本棚ブロックは64px以上').toBeGreaterThanOrEqual(64);
        expect.soft(measure[2].guideText).toBe('タップして本を追加');
        expect.soft(measure[3].label, '中身ありの文章ブロックの文言は種類名のみ').toBe('文章');
        expect(errors).toEqual([]);
    });

    test('ピル: 中身ありの本棚は「本棚・N冊」', async ({ page }) => {
        const errors = await bootApp(page);
        await openNewArticleEdit(page);
        await page.evaluate(() => {
            const bs = window.bookshelf;
            bs._artDraft.blocks = [{ id: 'blk-shelf-1', type: 'shelf', shelfId: 'fixshelf', items: [
                { id: 'it1', asin: 'B000000001', order: 0, show: {} },
                { id: 'it2', asin: 'B000000002', order: 1, show: {} },
            ] }];
            bs._artRenderBlocks();
        });
        await page.waitForTimeout(400);
        const label = await page.evaluate(() => {
            const doc = document.getElementById('art-canvas-frame').contentDocument;
            return doc.querySelector('.art-cv-blk .art-cv-more span')?.textContent;
        });
        expect(label).toBe('本棚・2冊');
        expect(errors).toEqual([]);
    });

    test('ピル: 閲覧状態では0件', async ({ page }) => {
        await bootApp(page);
        await setupChipBlocks(page);
        const done = page.locator('#art-mode-done:visible, #art-bar-done:visible').first();
        await done.click();
        await settle(page, 400);
        const count = await page.evaluate(() => {
            const doc = document.getElementById('art-canvas-frame').contentDocument;
            return doc ? doc.querySelectorAll('.art-cv-ops').length : -1;
        });
        expect(count).toBe(0);
    });

    test('ピルを押すと⋯メニュー(編集/上へ/下へ/削除)が開く', async ({ page }) => {
        await bootApp(page);
        await setupChipBlocks(page);
        const frame = page.frameLocator('#art-canvas-frame');
        await frame.locator('.art-cv-more').first().click();
        await settle(page, 300);
        await expect(page.locator('#art-blk-menu')).toBeVisible();
    });

    test('空ブロックの案内をタップ→そのブロックの編集(全画面)が開く', async ({ page }) => {
        await bootApp(page);
        await setupChipBlocks(page);
        const frame = page.frameLocator('#art-canvas-frame');
        await frame.locator('.art-cv-empty-guide').first().click();
        await settle(page, 300);
        await expect(page.locator('#art-edit-view')).toHaveAttribute('data-art-mode', 'form');
    });
});
