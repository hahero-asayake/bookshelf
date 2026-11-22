// イシュー#757: 本の詳細の「所属本棚」を、折り畳める字下げの木 (#753 案2＋折り畳み) で見せる。
// 見本は tests/fixtures/shelves-detail-tree.json (#750 の写し・本20棚・3階層・同名の SF 2つ)。本008 は所属16、本001 は所属5。
// 起動は tests/e2e/shelf-path-label.spec.js と同じ型 (localStorage に見本を入れ、保存だけ差し替える)。
// 確認 (confirmDialog) は文を記録して OK を返す＝外す処理 (今のカスケード) はそのまま走る。
// 揃いは座標で確かめる (getBoundingClientRect・許すずれ 0.5px・#753 の align753 の項目＋(g) 開閉の欄)。
// 文字の高さに依る絶対値は比べない (#748)。高さは同じ実行の中で、畳んだ時と開いた時を比べる。
import { test, expect } from './helpers/test-base.js';
import { devices } from '@playwright/test';
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');
const shelvesFixture = readFileSync(join(here, '../fixtures/shelves-detail-tree.json'), 'utf-8');
const asinOf = (n) => 'B0000' + String(n).padStart(5, '0');
const B001 = asinOf(1);
const B008 = asinOf(8);
const TOL = 0.5;
const LONG_NAME = 'マーケティングとブランドの棚から選んだ2026年に読み返したい本と、その周りで気になった本の一覧';

// 見本を localStorage に入れて起動する。flag: 'bookshelf.flag.detailShelfTree' の値 (null は入れない)。
// rename: { 本棚id: 名前 } (折り返しの揃いを見るため、長い名前に変える)
async function boot(page, { flag = null, rename = {} } = {}) {
    await page.addInitScript(([userData, library, shelvesJson, flagValue, renameMap]) => {
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
        const shelves = fx.shelves.map((s) => ({ ...proto, id: s.id, internalId: s.internalId, name: renameMap[s.id] || s.name, parent: s.parent || allIid, books: expand(s), notes: {}, isSpecial: false }));
        ud.bookshelves = [all, ...shelves];
        for (const s of shelves) ud.bookOrder[s.id] = s.books.slice();
        localStorage.setItem('virtualBookshelf_userData', JSON.stringify(ud));
        localStorage.setItem('virtualBookshelf_library', JSON.stringify(lib));
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        if (flagValue !== null) localStorage.setItem('bookshelf.flag.detailShelfTree', flagValue);
    }, [fixtureUserData, fixtureLibrary, shelvesFixture, flag, rename]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length >= 150);
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        window.__confirms = [];
        window.confirmDialog = async (opts) => { window.__confirms.push(typeof opts === 'string' ? opts : (opts && opts.message) || ''); return true; };
    });
}

const sec = (page) => page.locator('.bd-section[data-section="bookshelves"]').filter({ visible: true }).first();
const press = async (page, loc, mobile) => { if (mobile) await loc.tap(); else await loc.click(); };

async function openDetail(page, asin, { edit = false, mobile = false } = {}) {
    await page.evaluate((x) => { const b = window.bookshelf.books.find((y) => y.asin === x); window.bookshelf.showBookDetail(b); }, asin);
    await expect(sec(page)).toBeVisible();
    if (edit) {
        await press(page, page.locator('.edit-mode-btn').filter({ visible: true }).first(), mobile);
        await expect(page.locator('.bookshelf-select').filter({ visible: true }).first()).toBeVisible();
    }
}

// 見えている行を「段:本棚id(数)」で並べる。開いている行は数の後に v、所属でない行は頭に -
async function rows(page) {
    return sec(page).evaluate((s) => Array.from(s.querySelectorAll('.bd-tree-row')).map((r) => {
        const t = r.querySelector('.bd-tree-toggle');
        const d = (r.getAttribute('style') || '').match(/--bd-depth:(\d+)/)[1];
        return `${r.classList.contains('is-missing') ? '-' : ''}${d}:${r.dataset.bookshelfId}`
            + (t ? `(${t.querySelector('.bd-tree-count').textContent}${t.getAttribute('aria-expanded') === 'true' ? 'v' : ''})` : '');
    }));
}
const row = (page, id) => sec(page).locator(`.bd-tree-row[data-bookshelf-id="${id}"]`);
const toggleOf = (page, id) => row(page, id).locator('.bd-tree-toggle');

async function expandAll(page, mobile) {
    for (let i = 0; i < 40; i++) {
        const t = sec(page).locator('.bd-tree-toggle[aria-expanded="false"]').first();
        if (await t.count() === 0) return;
        await press(page, t, mobile);
    }
}
const listHeight = (page) => sec(page).locator('.bd-tree').evaluate((e) => e.getBoundingClientRect().height);

// 揃いの検査 (#753 の align753 の項目＋(g))。返り値は項目ごとの { name, maxDev, pass }
async function alignCheck(page) {
    const a = await sec(page).evaluate((s) => {
        const f = (e) => { if (!e) return null; const q = e.getBoundingClientRect(); return { l: q.left, r: q.right, t: q.top, b: q.bottom }; };
        const list = s.querySelector('.bd-tree');
        return {
            edit: list.classList.contains('is-edit'),
            list: f(list),
            rows: Array.from(list.querySelectorAll('.bd-tree-row')).map((r) => {
                const nm = r.querySelector('.bd-tree-name');
                const range = document.createRange();
                range.selectNodeContents(nm);
                const lines = Array.from(range.getClientRects()).map((q) => ({ l: q.left, t: q.top }));
                return {
                    id: r.dataset.bookshelfId,
                    depth: Number((r.getAttribute('style') || '').match(/--bd-depth:(\d+)/)[1]),
                    missing: r.classList.contains('is-missing'),
                    row: f(r), icon: f(r.querySelector('.bd-tree-icon')), name: f(nm), lines,
                    toggle: f(r.querySelector('.bd-tree-toggle')), count: f(r.querySelector('.bd-tree-count')),
                    x: f(r.querySelector('.remove-from-bookshelf')),
                    nameOverflow: nm.scrollWidth > nm.clientWidth + 1,
                    rowOverflow: r.scrollWidth > r.clientWidth + 1,
                };
            }),
        };
    });
    const grp = (name, vals) => { const v = vals.filter((x) => x != null); const dev = v.length ? Math.max(...v) - Math.min(...v) : 0; return { name, n: v.length, maxDev: +dev.toFixed(2), pass: dev <= TOL }; };
    const R = a.rows;
    const out = [];
    out.push(grp('(a) 行の頭', R.map((r) => r.row.l)));
    const depths = [...new Set(R.map((r) => r.depth))].sort((x, y) => x - y);
    const heads = {};
    for (const d of depths) {
        const g = grp(`(b) 名前の頭 段${d}`, R.filter((r) => r.depth === d).map((r) => r.name.l));
        out.push(g);
        heads[d] = R.find((r) => r.depth === d).name.l;
    }
    const steps = depths.slice(1).map((d) => heads[d] - heads[d - 1]);
    out.push({ ...grp('(b) 段の差 (18px で一定)', steps.length ? [...steps, 18] : [18]), steps: steps.map((x) => +x.toFixed(2)) });
    // (c) 折り返した各行の頭 = 名前の1行目の頭
    let wrapped = 0;
    const lineDevs = [];
    for (const r of R) {
        const byLine = new Map();
        for (const q of r.lines) { const k = Math.round(q.t); byLine.set(k, Math.min(byLine.has(k) ? byLine.get(k) : Infinity, q.l)); }
        const ls = [...byLine.values()];
        if (ls.length > 1) { wrapped++; lineDevs.push(Math.max(...ls) - Math.min(...ls)); }
    }
    out.push({ name: `(c) 折り返しの行頭 (折り返した行 ${wrapped})`, n: wrapped, maxDev: +Math.max(0, ...lineDevs).toFixed(2), pass: lineDevs.every((d) => d <= TOL), wrapped });
    if (a.edit) {
        const xs = R.filter((r) => !r.missing);
        out.push(grp('(d) ×の左端', xs.map((r) => r.x && r.x.l)));
        const bad = xs.filter((r) => !r.x || r.x.r > a.list.r + TOL).length + R.filter((r) => r.missing && r.x).length;
        out.push({ name: '(d) ×の右端 ≤ 一覧の右端・所属の行にだけ×', n: xs.length, maxDev: bad, pass: bad === 0 });
    }
    const ov = R.filter((r) => r.nameOverflow || r.rowOverflow || r.row.r > a.list.r + TOL || (r.toggle && r.name.r > r.toggle.l + TOL)).length;
    out.push({ name: '(e) はみ出し', n: R.length, maxDev: ov, pass: ov === 0 });
    const withT = R.filter((r) => r.toggle);
    out.push(grp('(g) ▸の左端 (▸のある行)', withT.map((r) => r.toggle.l)));
    const cOut = withT.filter((r) => !r.count || r.count.l < r.toggle.l - TOL || r.count.r > r.toggle.r + TOL).length;
    out.push({ name: '(g) 数は▸の欄の中', n: withT.length, maxDev: cOut, pass: cOut === 0 });
    return { rows: R.length, depths, groups: out };
}

function record(testInfo, scene, res) {
    if (!process.env.ALIGN_OUT) return;
    appendFileSync(process.env.ALIGN_OUT, JSON.stringify({ project: testInfo.project.name, device: testInfo.titlePath[1], scene, ...res }) + '\n');
}

for (const [label, mobile, use] of [
    ['390 幅 (スマホ・iPhone の UA・タッチ)', true, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: devices['iPhone 13'].userAgent }],
    ['PC 幅 (1280×800)', false, { viewport: { width: 1280, height: 800 } }],
]) {
    test.describe(label, () => {
        test.use(use);

        test('(1) 畳んだ時: 根の行だけを出し、下の所属の数と ▸ を出す', async ({ page }) => {
            await boot(page);
            await openDetail(page, B008, { mobile });
            await expect(sec(page).locator('.bd-chips-row.is-tree')).toHaveCount(1);
            expect(await rows(page)).toEqual(['0:s01(3)', '0:s02(1)', '0:s03(2)', '0:s04(3)', '0:s05', '0:s06(1)']);
            const t = toggleOf(page, 's01');
            await expect(t).toHaveAttribute('aria-expanded', 'false');
            await expect(t).toHaveAttribute('aria-label', '「小説」の下の3つを開く');
            await expect(t.locator('svg')).toHaveCount(1);
            await expect(row(page, 's05').locator('.bd-tree-toggle')).toHaveCount(0);
            await openDetail(page, B001, { mobile });
            expect(await rows(page)).toEqual(['0:s01(2)', '0:s02(1)']);
        });

        test('(2) 開いた時: ▸ で子が出る・行を押しても開く・全部を開く・畳むと消える', async ({ page }) => {
            await boot(page);
            await openDetail(page, B008, { mobile });
            const hClosed = await listHeight(page);
            await press(page, toggleOf(page, 's01'), mobile);
            expect(await rows(page)).toEqual(['0:s01(3v)', '1:s07(1)', '1:s08', '0:s02(1)', '0:s03(2)', '0:s04(3)', '0:s05', '0:s06(1)']);
            await expect(toggleOf(page, 's01')).toHaveAttribute('aria-label', '「小説」の下の3つを畳む');
            await expect(toggleOf(page, 's01')).toBeFocused();
            await press(page, row(page, 's04').locator('.bd-tree-name'), mobile);
            expect((await rows(page)).filter((r) => /s04|s12|s13|s19/.test(r))).toEqual(['0:s04(3v)', '1:s12(1)', '1:s13']);
            await expandAll(page, mobile);
            const all = await rows(page);
            expect(all).toEqual(['0:s01(3v)', '1:s07(1v)', '2:s16', '1:s08', '0:s02(1v)', '1:s09', '0:s03(2v)', '1:s11(1v)', '2:s18',
                '0:s04(3v)', '1:s12(1v)', '2:s19', '1:s13', '0:s05', '0:s06(1v)', '1:s15']);
            const hOpen = await listHeight(page);
            expect(hOpen).toBeGreaterThan(hClosed);
            await press(page, toggleOf(page, 's01'), mobile);
            const after = await rows(page);
            expect(after.some((r) => /s07|s08|s16/.test(r))).toBe(false);
            expect(after[0]).toBe('0:s01(3)');
            expect(after).toHaveLength(13);
        });

        test('(3) 編集の ×: 「小説 / SF / 海外」だけを外すと親は残り、「小説」を外すと下の段も消える (確認の文は今のまま)', async ({ page }) => {
            await boot(page);
            await openDetail(page, B008, { edit: true, mobile });
            await press(page, toggleOf(page, 's01'), mobile);
            await press(page, toggleOf(page, 's07'), mobile);
            await expect(row(page, 's16').locator('.remove-from-bookshelf')).toHaveAttribute('title', '「小説 / SF / 海外」から外す');
            await expect(row(page, 's01').locator('.remove-from-bookshelf')).toHaveAttribute('title', '「小説」から外す（下の段も外れる）');
            await press(page, row(page, 's16').locator('.remove-from-bookshelf'), mobile);
            await expect(page.locator('.toast', { hasText: '「小説 / SF / 海外」から除外しました' })).toBeVisible({ timeout: 5000 });
            expect(await page.evaluate(() => window.__confirms)).toEqual(['「見本の本 008」を「小説 / SF / 海外」から除外しますか？\n\n本自体は削除されず、この本棚からのみ削除されます。']);
            // 外すと詳細は閉じる (今の動き)。開き直して全部を開く
            await openDetail(page, B008, { edit: true, mobile });
            await expandAll(page, mobile);
            const r1 = await rows(page);
            expect(r1.slice(0, 3)).toEqual(['0:s01(2v)', '1:s07', '1:s08']);
            expect(r1.some((r) => r.includes('s16'))).toBe(false);
            await press(page, row(page, 's01').locator('.remove-from-bookshelf'), mobile);
            await expect(page.locator('.toast', { hasText: '「小説」から除外しました' })).toBeVisible({ timeout: 5000 });
            const c2 = (await page.evaluate(() => window.__confirms))[1];
            expect(c2).toContain('「見本の本 008」を「小説」から除外しますか？');
            expect(c2).toContain('子孫本棚にも含まれているため、自動カスケード削除されます:');
            await openDetail(page, B008, { edit: true, mobile });
            await expandAll(page, mobile);
            const r2 = await rows(page);
            expect(r2.some((r) => /s01|s07|s08/.test(r))).toBe(false);
            expect(r2.filter((r) => r.startsWith('0:')).map((r) => r.replace(/\(.*$/, ''))).toEqual(['0:s02', '0:s03', '0:s04', '0:s05', '0:s06']);
        });

        test('(4) 追加の後: 本001 に「小説 / ミステリー / 古典」を足すと、その行まで開いて見え、祖先の自動追加の通知が出る', async ({ page }) => {
            await boot(page);
            await openDetail(page, B001, { edit: true, mobile });
            expect(await rows(page)).toEqual(['0:s01(2)', '0:s02(1)']);
            await sec(page).locator('.bookshelf-select').selectOption('s20');
            await press(page, sec(page).locator('.add-to-bookshelf'), mobile);
            await expect(page.locator('.toast', { hasText: '祖先にも自動追加: 小説 / ミステリー' })).toBeVisible({ timeout: 5000 });
            await expect(row(page, 's20')).toBeVisible();
            expect(await rows(page)).toEqual(['0:s01(4v)', '1:s07(1)', '1:s08(1v)', '2:s20', '0:s02(1)']);
        });

        test('(5) 本棚の画面 (小説 / SF) から開いた時: その本棚まで開いて、名前を強調する', async ({ page }) => {
            await boot(page);
            await page.evaluate(() => window.bookshelf.switchBookshelf('s07'));
            await openDetail(page, B001, { mobile });
            expect(await rows(page)).toEqual(['0:s01(2v)', '1:s07(1v)', '2:s16', '0:s02(1)']);
            await expect(sec(page).locator('.bd-tree-row.is-context')).toHaveCount(1);
            await expect(row(page, 's07')).toHaveClass(/is-context/);
            const bg = await row(page, 's07').locator('.bd-tree-name').evaluate((e) => getComputedStyle(e).backgroundColor);
            const accent = await page.evaluate(() => { const d = document.createElement('span'); d.style.background = 'var(--accent)'; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; });
            expect(bg).toBe(accent);
        });

        test('(6) 閲覧⇄編集で開閉が残り、閉じて開き直すと既定 (畳む) に戻る', async ({ page }) => {
            await boot(page);
            await openDetail(page, B001, { mobile });
            await press(page, toggleOf(page, 's01'), mobile);
            const opened = ['0:s01(2v)', '1:s07(1)', '0:s02(1)'];
            expect(await rows(page)).toEqual(opened);
            await press(page, page.locator('.edit-mode-btn').filter({ visible: true }).first(), mobile);
            await expect(sec(page).locator('.bd-tree.is-edit')).toHaveCount(1);
            expect(await rows(page)).toEqual(opened);
            await press(page, page.locator('.cancel-edit-btn').filter({ visible: true }).first(), mobile);
            await expect(sec(page).locator('.bd-tree.is-edit')).toHaveCount(0);
            expect(await rows(page)).toEqual(opened);
            await page.evaluate(() => window.bookshelf.closeModal());
            await expect(page.locator('body')).not.toHaveClass(/book-detail-pinned/);
            await openDetail(page, B001, { mobile });
            expect(await rows(page)).toEqual(['0:s01(2)', '0:s02(1)']);
        });

        test("(7) 切り替え '0' で前の形 (チップ) に戻る", async ({ page }) => {
            await boot(page, { flag: '0' });
            await openDetail(page, B001, { edit: true, mobile });
            await expect(sec(page).locator('.bd-tree')).toHaveCount(0);
            await expect(sec(page).locator('.bd-chips-row')).not.toHaveClass(/is-tree/);
            await expect(sec(page).locator('.bd-chip')).toHaveCount(5);
            await expect(sec(page).locator('.bd-chip .remove-from-bookshelf')).toHaveCount(5);
        });

        test('揃い: 全部を開いた木で、行・名前・× ・▸ の線が座標でそろう (本008 閲覧/編集・本001 編集・長い名前)', async ({ page }, testInfo) => {
            const scenes = [];
            await boot(page, { rename: { s18: LONG_NAME } });
            await openDetail(page, B008, { mobile });
            await expandAll(page, mobile);
            scenes.push(['本008 閲覧 (長い名前 s18)', await alignCheck(page)]);
            await press(page, page.locator('.edit-mode-btn').filter({ visible: true }).first(), mobile);
            await expect(sec(page).locator('.bd-tree.is-edit')).toHaveCount(1);
            scenes.push(['本008 編集 (長い名前 s18)', await alignCheck(page)]);
            await openDetail(page, B001, { edit: true, mobile });
            await expandAll(page, mobile);
            scenes.push(['本001 編集', await alignCheck(page)]);
            for (const [scene, res] of scenes) {
                record(testInfo, scene, res);
                const failed = res.groups.filter((g) => !g.pass);
                expect(failed, `${scene}: ${JSON.stringify(failed)}`).toEqual([]);
            }
            // 長い名前は折り返していて、その揃いも見ている (スマホでは必ず折り返す)
            if (mobile) expect(scenes[0][1].groups.find((g) => g.name.startsWith('(c)')).wrapped).toBeGreaterThan(0);
            expect(scenes[0][1].rows).toBe(16);
        });
    });
}
