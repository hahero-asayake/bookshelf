// イシュー#746: 本棚を単独で示す所を、親からのパスで出す (案A)・1行の部品は欄に収まらない時だけ根の側を「… / 」で
// 省く (T1)・本棚の画面の題は名前と「親までのパス」の2行に分ける (M3)。#743 の見本 (tests/fixtures/shelves-path.json・
// 同名「小説 / SF」「漫画 / SF」・3階層・長いパス s18・本150冊) で、15か所の表示を確かめる。
// 起動は tests/e2e/book-detail-shelf-add.spec.js と同じ型 (localStorage に見本を入れ、保存だけ差し替える)。
// 確認の文 (H5 削除・H6 除外・H7 外す・M7 移動) は confirmDialog を「文を記録してキャンセル」に差し替えて読む
// (確認の中身は描いた文のまま・押した後の処理は走らせない)。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const shelvesFixture = readFileSync(join(here, '../fixtures/shelves-path.json'), 'utf-8');

const LONG_SELF = '2026年に読み返したい本';
const LONG_FULL = 'ビジネスと自己啓発 / マーケティングとブランド / ' + LONG_SELF;
const asinOf = (n) => 'B0000' + String(n).padStart(5, '0');

// 見本を localStorage に入れて起動する。flag: 'bookshelf.flag.shelfPath' の値 (null は入れない)。
// topSF: ホームの冊数 Top5 に2つの SF を入れる写し (SF の本を親と同じだけにする)。
async function boot(page, { flag = null, topSF = false } = {}) {
    await page.addInitScript(([userData, library, shelvesJson, flagValue, topSFOn]) => {
        const ud = JSON.parse(userData);
        const lib = JSON.parse(library);
        const fx = JSON.parse(shelvesJson);
        const a = (n) => 'B0000' + String(n).padStart(5, '0');
        const tmpl = lib.books[0];
        lib.books = [];
        for (let n = 1; n <= fx.bookCount; n++) lib.books.push({ ...tmpl, asin: a(n), title: `見本の本 ${String(n).padStart(3, '0')}`, acquiredTime: 1700000000000 + n * 1000 });
        const all = ud.bookshelves.find((b) => b.isSpecial);
        const allIid = all.internalId;
        const proto = ud.bookshelves.find((b) => !b.isSpecial);
        all.books = lib.books.map((b) => b.asin);
        ud.bookOrder = ud.bookOrder || {};
        ud.bookOrder[all.id] = all.books.slice();
        const expand = (s) => {
            const out = [];
            for (const [x, y] of (s.ranges || [])) for (let n = x; n <= y; n++) out.push(a(n));
            for (const n of (s.extra || [])) out.push(a(n));
            return [...new Set(out)];
        };
        const byId = Object.fromEntries(fx.shelves.map((s) => [s.id, s]));
        const shelves = fx.shelves.map((s) => {
            let books = expand(s);
            if (topSFOn && (s.id === 's07' || s.id === 's09')) books = expand(byId[s.id === 's07' ? 's01' : 's02']);
            return { ...proto, id: s.id, internalId: s.internalId, name: s.name, parent: s.parent || allIid, books, notes: {}, isSpecial: false };
        });
        ud.bookshelves = [all, ...shelves];
        for (const s of shelves) ud.bookOrder[s.id] = s.books.slice();
        localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
        localStorage.setItem('virtualBookshelf_library', JSON.stringify(lib));
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        if (flagValue !== null) localStorage.setItem('bookshelf.flag.shelfPath', flagValue);
    }, [fixtureUserData, fixtureLibrary, shelvesFixture, flag, topSF]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length >= 150);
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        window.__confirms = [];
        window.confirmDialog = async (opts) => { window.__confirms.push(typeof opts === 'string' ? opts : (opts && opts.message) || ''); return false; };
    });
}

// 見えている .shelf-path の文字・title・収まり
async function shelfPaths(page, sel) {
    return page.evaluate((s) => Array.from(document.querySelectorAll(s)).filter((e) => e.getClientRects().length)
        .map((e) => ({ text: e.textContent, title: e.getAttribute('title') || '', fits: e.scrollWidth <= e.clientWidth + 1 })), sel);
}

async function openDetailEdit(page, asin) {
    await page.evaluate((x) => { const b = window.bookshelf.books.find((y) => y.asin === x); window.bookshelf.showBookDetail(b); }, asin);
    const pane = page.locator('.bd-section[data-section="bookshelves"]').filter({ visible: true }).first();
    await expect(pane).toBeVisible();
    await page.locator('.edit-mode-btn').filter({ visible: true }).first().click();
    await expect(page.locator('.bookshelf-select').filter({ visible: true }).first()).toBeVisible();
}

const toastText = (page, text) => page.locator('#toast-container .toast').filter({ hasText: text });

for (const [label, vp, mobile] of [['スマホ390', { width: 390, height: 844 }, true], ['PC1280', { width: 1280, height: 860 }, false]]) {
    test.describe(`本棚の階層パス (イシュー#746)・${label}`, () => {
        test.use({ viewport: vp, hasTouch: mobile, isMobile: mobile, ...(mobile ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}) });

        test('H1・M1・H3・H6・H8：本の詳細の選択肢・チップ・通知・確認・子孫の選択がパスで出る', async ({ page }) => {
            await boot(page);
            // M1: 本001 は 小説 / SF / 海外 と 漫画 / SF の両方に入っている
            await openDetailEdit(page, asinOf(1));
            await expect.poll(async () => (await shelfPaths(page, '.bd-chip .shelf-path')).map((c) => c.text)).toEqual(expect.arrayContaining(['小説 / SF', '漫画 / SF', '小説 / SF / 海外']));
            const chips = await shelfPaths(page, '.bd-chip .shelf-path');
            expect(chips.every((c) => c.fits)).toBe(true);
            expect(chips.map((c) => c.text)).toContain('小説'); // 1階層は名前だけ
            // H6: 漫画 / SF のチップの × → 確認の文
            await page.locator('.bd-chip[data-bookshelf-id="s09"] .bd-chip-remove').filter({ visible: true }).first().click();
            await expect.poll(() => page.evaluate(() => window.__confirms.join('\n'))).toContain('を「漫画 / SF」から除外しますか？');
            // H1: 選択肢の文字 (本150 はどの本棚にも入っていない)
            await openDetailEdit(page, asinOf(150));
            const opts = await page.locator('.bookshelf-select').filter({ visible: true }).first().locator('option').allTextContents();
            expect(opts).toEqual(expect.arrayContaining(['小説 / SF', '漫画 / SF', '小説 / SF / 海外', '小説']));
            // H3: 「漫画 / SF」に追加 → 通知
            await page.locator('.bookshelf-select').filter({ visible: true }).first().selectOption('s09');
            await page.locator('.add-to-bookshelf').filter({ visible: true }).first().click();
            await expect(toastText(page, '「漫画 / SF」に追加しました')).toBeVisible();
            // (c) 長いパス s18 への追加の通知は根の側が省かれ、自身が残る
            await page.locator('.bookshelf-select').filter({ visible: true }).first().selectOption('s18');
            await page.locator('.add-to-bookshelf').filter({ visible: true }).first().click();
            await expect(toastText(page, `「… / ${LONG_SELF}」に追加しました`)).toBeVisible();
            // 本文の1文 (改行の前まで) が2行までに収まる (SHELF_LABEL_TEXT_MAX の確かめ・イシュー#746 step1 の申し送り)
            const mainLines = await page.evaluate((self) => {
                const msg = Array.from(document.querySelectorAll('#toast-container .toast-message')).find((e) => e.textContent.includes(`「… / ${self}」に追加しました`));
                const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT);
                const node = walker.nextNode();
                const end = node.textContent.indexOf('\n');
                const r = document.createRange();
                r.setStart(node, 0); r.setEnd(node, end < 0 ? node.textContent.length : end);
                return new Set(Array.from(r.getClientRects()).map((x) => Math.round(x.top))).size;
            }, LONG_SELF);
            expect(mainLines).toBeLessThanOrEqual(2);
            // H8: 子孫のある「小説」へ追加 → 子孫の選択の行がパス
            await page.locator('.bookshelf-select').filter({ visible: true }).first().selectOption('s01');
            await page.locator('.add-to-bookshelf').filter({ visible: true }).first().click();
            await expect(page.locator('#descendants-pick-modal')).toBeVisible();
            await expect.poll(async () => (await shelfPaths(page, '#descendants-pick-list .shelf-path')).map((x) => x.text)).toEqual(expect.arrayContaining(['小説 / SF', '小説 / SF / 海外', '小説 / ミステリー / 古典']));
            await page.locator('#descendants-pick-skip').click();
        });

        test('H2・H4・H7・H5・M6・M7：一括の一覧・通知・確認と、削除・親の選択・移動の文がパスで出る', async ({ page }) => {
            await boot(page);
            // H2・H4・H7: 「漫画 / SF」を開き、複数選択で2冊を選ぶ (画面のボタンと本のクリック)
            await page.evaluate(() => window.bookshelf.switchBookshelf('s09'));
            await page.locator('#toggle-select-mode').filter({ visible: true }).first().click();
            const items = page.locator('#bookshelf .book-item');
            await expect(items.first()).toBeVisible();
            await items.nth(0).click();
            await items.nth(1).click();
            await expect(page.locator('#bookshelf .book-item.selected')).toHaveCount(2);
            // H2: 「本棚に追加」の一覧に2つの SF が別の文字で出る
            await page.locator('#bulk-add-shelf').click();
            await expect(page.locator('#bulk-shelf-popover')).toBeVisible();
            await expect.poll(async () => (await shelfPaths(page, '#bulk-shelf-list .shelf-path')).map((x) => x.text)).toEqual(expect.arrayContaining(['小説 / SF', '漫画 / SF']));
            expect((await shelfPaths(page, '#bulk-shelf-list .shelf-path')).every((x) => x.fits)).toBe(true);
            // H4: 「漫画 / SF」へ追加 → 通知
            await page.locator('#bulk-shelf-list [data-bs-internal="s09x"]').click();
            await expect(toastText(page, '2 冊を「漫画 / SF」に追加しました')).toBeVisible();
            // H7: 「本棚から外す」→ 確認の文
            await page.locator('#bulk-remove-shelf').click();
            await expect.poll(() => page.evaluate(() => window.__confirms.join('\n'))).toContain('冊を「漫画 / SF」から外しますか？');
            // H5: 小説 / SF の削除の確認 (木の「…」が呼ぶ関数)・子孫の一覧もパス
            await page.evaluate(() => window.bookshelf.deleteBookshelf('s07'));
            await expect.poll(() => page.evaluate(() => window.__confirms.join('\n'))).toContain('本棚「小説 / SF」を削除しますか？');
            const c = await page.evaluate(() => window.__confirms.join('\n'));
            expect(c).toContain('・小説 / SF / 海外');
            expect(await page.evaluate(() => window.bookshelf.userData.bookshelves.some((b) => b.id === 's07'))).toBe(true);
            // M6: 本棚の作成の「親」の選択肢
            await page.evaluate(() => window.bookshelf.showBookshelfForm());
            const parents = await page.locator('#bookshelf-parent option').allTextContents();
            expect(parents).toEqual(expect.arrayContaining(['小説 / SF', '漫画 / SF', '（トップ階層）']));
            await page.keyboard.press('Escape');
            // M7: 海外 の編集で親を「漫画 / SF」に変えて保存 → 移動の確認の文
            await page.evaluate(() => window.bookshelf.showBookshelfForm(window.bookshelf.bookshelfManager.getById('s16x')));
            await page.locator('#bookshelf-parent').selectOption('s09x');
            await page.locator('#save-bookshelf-form').click();
            await expect.poll(() => page.evaluate(() => window.__confirms.join('\n'))).toContain('「小説 / SF / 海外」を「漫画 / SF」の下へ移動します');
            expect(await page.evaluate(() => window.__confirms.join('\n'))).toContain('・漫画 / SF: +');
        });

        test('M2・M3・M4・M5：パレット・題・ホームのカード・冊数がパスで出て、長いパスは T1 で収まる', async ({ page }) => {
            await boot(page, { topSF: true });
            // M4・M5: ホーム
            await expect.poll(async () => (await shelfPaths(page, '.widget-bookshelves-grid .shelf-path')).map((x) => x.text)).toEqual(expect.arrayContaining(['小説 / SF', '漫画 / SF']));
            const cards = await shelfPaths(page, '.widget-bookshelves-grid .shelf-path');
            expect(cards.every((x) => x.fits)).toBe(true);
            const long = cards.find((x) => x.title === LONG_FULL || x.text === LONG_FULL);
            if (long && mobile) expect(long.text.endsWith(LONG_SELF)).toBe(true);
            await expect.poll(async () => (await shelfPaths(page, '.rs-shelves .shelf-path')).map((x) => x.text)).toEqual(expect.arrayContaining(['小説 / SF', '漫画 / SF']));
            // M2: パレット「SF」は2つの SF だけ (子の 海外・国内 は出ない)
            await page.keyboard.press('Control+k');
            await expect(page.locator('#cmdk-input')).toBeVisible();
            await page.locator('#cmdk-input').fill('SF');
            await expect.poll(async () => (await shelfPaths(page, '.cmdk-item-title .shelf-path')).map((x) => x.text).sort()).toEqual(['小説 / SF', '漫画 / SF']);
            // (b) パレット「2026」: スマホは T1・PC は全文
            await page.locator('#cmdk-input').fill('2026');
            await expect.poll(async () => (await shelfPaths(page, '.cmdk-item-title .shelf-path')).filter((x) => x.fits && x.text.endsWith(LONG_SELF)).length).toBe(1);
            const pal = (await shelfPaths(page, '.cmdk-item-title .shelf-path'))[0];
            expect(pal.fits).toBe(true);
            expect(pal.text.endsWith(LONG_SELF)).toBe(true);
            if (mobile) { expect(pal.text.startsWith('… / ')).toBe(true); expect(pal.title).toBe(LONG_FULL); } else expect(pal.text).toBe(LONG_FULL);
            await page.keyboard.press('Escape');
            // M3・(e): 漫画 / SF を開く → 題は「SF」・下の行は「漫画」・流れる文字なし
            await page.evaluate(() => window.bookshelf.switchBookshelf('s09'));
            await expect(page.locator('#current-bookshelf-title')).toHaveText('SF');
            await expect(page.locator('#current-bookshelf-path')).toHaveText('漫画');
            await expect(page.locator('#current-bookshelf-title.is-marquee')).toHaveCount(0);
            // s18: 下の行は親まで・スマホは T1 でいちばん近い親が残る
            await page.evaluate(() => window.bookshelf.switchBookshelf('s18'));
            await expect(page.locator('#current-bookshelf-title')).toHaveText(LONG_SELF);
            await expect.poll(async () => (await shelfPaths(page, '#current-bookshelf-path .shelf-path'))[0]?.fits).toBe(true);
            const pth = (await shelfPaths(page, '#current-bookshelf-path .shelf-path'))[0];
            expect(pth.text.endsWith('マーケティングとブランド')).toBe(true);
            if (mobile) expect(pth.text.startsWith('… / ')).toBe(true); else expect(pth.text).toBe('ビジネスと自己啓発 / マーケティングとブランド');
            await expect(page.locator('#current-bookshelf-title.is-marquee')).toHaveCount(0);
            // 1階層は下の行を出さない
            await page.evaluate(() => window.bookshelf.switchBookshelf('s02'));
            await expect(page.locator('#current-bookshelf-title')).toHaveText('漫画');
            await expect(page.locator('#current-bookshelf-path')).toBeHidden();
        });

        test('(g) 低3：左の木・管理の一覧は名前だけのまま', async ({ page }) => {
            await boot(page);
            // 木の行 (.bsr-label) は描かれている分だけを見る (畳まれた子は描かれないことがある)
            const labels = await page.evaluate(() => Array.from(document.querySelectorAll('.bsr-label')).map((e) => e.textContent));
            expect(labels.some((t) => t.includes(' / '))).toBe(false);
            // L3: トップ階層に空の「SF」を作って開くと、案内は名前だけ
            await page.evaluate(() => {
                const ud = window.bookshelf.userData;
                const all = ud.bookshelves.find((b) => b.isSpecial);
                ud.bookshelves.push({ id: 'sfx', internalId: 'sfxx', name: '空の棚', parent: all.internalId, books: [], notes: {}, isSpecial: false });
                window.bookshelf.switchBookshelf('sfx');
            });
            await expect(page.getByText('「空の棚」にはまだ本がありません')).toBeVisible();
        });

        test('(f) 切り替え off：全部名前だけ・題の下の行なし・.shelf-path が無い', async ({ page }) => {
            await boot(page, { flag: '0' });
            await openDetailEdit(page, asinOf(1));
            await expect(page.locator('.bd-chip .shelf-path')).toHaveCount(0);
            const chipTexts = await page.locator('.bd-chip').filter({ visible: true }).allTextContents();
            expect(chipTexts.map((t) => t.replace('×', '').trim()).filter((t) => t === 'SF').length).toBe(2);
            await openDetailEdit(page, asinOf(150));
            await page.locator('.bookshelf-select').filter({ visible: true }).first().selectOption('s09');
            await page.locator('.add-to-bookshelf').filter({ visible: true }).first().click();
            await expect(toastText(page, '「SF」に追加しました')).toBeVisible();
            await page.evaluate(() => window.bookshelf.switchBookshelf('s09'));
            await expect(page.locator('#current-bookshelf-title')).toHaveText('SF');
            await expect(page.locator('#current-bookshelf-path')).toBeHidden();
            expect(await page.locator('.shelf-path').count()).toBe(0);
        });
    });
}
