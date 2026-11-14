// イシュー#664：フォルダにつないだまま本を除外して書き出すと、除外した本が all.json の books に残る (#662 で発見)。
// 決まり (設計書 06_データ仕様書「all.json の books = library − exclusions」・02_基本設計書「書誌の正本 = library.json」)：
//   library.json は除外した本も含む全書誌 (3)・exclusions.json に除外した ASIN・all.json の books と bookOrder.all は除外を引いた 2。
// R は書き出しの完了を待ってから再読込 (保存先を採る想定)、L は待たずに再読込 (手元を採る想定)、
// S は書き出しの後にもう一度保存してから待たずに再読込 (書き出しで置き換わった bookOrder.all が端末の控えへ入る経路)、
// U は除外を取り消して書き出す (all.json が 3 に戻り重複しない)。
// 入口は window.bookshelf の除外・取り消し (確認の窓は通す)。S の2回目の保存は saveUserData を直接呼ぶ (次の編集の保存の代わり)。
// E664_OUT を付けると1回ごとの記録を JSONL で残す。
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { stubFolderPickerForTest, connectLocalFolderForTest } from './helpers/gate-local.js';

const EXPORT_JSON = readFileSync(new URL('../fixtures/gate-kindle-export.json', import.meta.url), 'utf-8');
const OUT = process.env.E664_OUT || '';
const TARGET = 'B0GATEIMP3';
const allShelf = (page) => page.locator('#sidebar-bookshelf-tree [data-bookshelf-id="all"]');

test.use({ viewport: { width: 1280, height: 800 } });

async function pasteImport(page, json) {
    await page.locator('[data-import-action="open-paste"]').click();
    await page.locator('#kindle-paste-input').fill(json);
    await page.locator('#import-from-paste').click();
    await expect(page.locator('#book-selection')).toBeVisible();
    await page.locator('#select-all-books').click();
    await page.locator('#import-selected-books').click();
    await expect(page.locator('#import-results')).toContainText('取込結果');
}

// フォルダの中身・端末の控え・メモリの値をまとめて読む
const readState = (page, dirName) => page.evaluate(async (name) => {
    const out = {};
    const readJson = async (dir, file) => JSON.parse(await (await (await dir.getFileHandle(file)).getFile()).text());
    try {
        let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
        dir = await dir.getDirectoryHandle('private');
        try { out.lib = ((await readJson(dir, 'library.json')).books || []).map((b) => b.asin); } catch (e) { out.lib = null; }
        try { out.excl = (await readJson(dir, 'exclusions.json')).excludedASINs || []; } catch (e) { out.excl = null; }
        try {
            const sh = await dir.getDirectoryHandle('bookshelves');
            out.allJson = (await readJson(sh, 'all.json')).books || [];
        } catch (e) { out.allJson = null; }
    } catch (e) { out.err = String(e && e.name); }
    try {
        const u = JSON.parse(localStorage.getItem('virtualBookshelf_userData') || 'null');
        out.ctrlOrderAll = u && u.bookOrder && Array.isArray(u.bookOrder.all) ? u.bookOrder.all : null;
        const sh = u && (u.bookshelves || []).find((b) => b.isSpecial);
        out.ctrlShelfBooks = sh && Array.isArray(sh.books) ? sh.books : null;
    } catch (e) { out.ctrlErr = true; }
    try {
        const ud = window.bookshelf && window.bookshelf.userData;
        const sh = ud && (ud.bookshelves || []).find((b) => b.isSpecial);
        out.memOrderAll = ud && ud.bookOrder && Array.isArray(ud.bookOrder.all) ? [...ud.bookOrder.all] : null;
        out.memShelfBooks = sh && Array.isArray(sh.books) ? [...sh.books] : null;
        out.memSameArray = !!(sh && ud.bookOrder && sh.books === ud.bookOrder.all);
        out.decision = window.bookshelf ? (window.bookshelf._lastLoadDecision || null) : null;
    } catch (e) { out.memErr = true; }
    out.pending = localStorage.getItem('virtualBookshelf_pendingSync');
    return out;
}, dirName);

const treeCount = async (page) => (await allShelf(page).locator('.bsr-count').textContent().catch(() => '?')) || '?';

// 書き出しの完了＝exclusions.json が want の除外を持ち、未反映の印が消える
async function waitExported(page, dirName, wantExcluded) {
    await expect.poll(async () => {
        const s = await readState(page, dirName);
        const has = Array.isArray(s.excl) && s.excl.includes(TARGET);
        return has === wantExcluded && s.pending !== '1';
    }, { timeout: 20000, message: '書き出しの完了 (exclusions.json と未反映の印)' }).toBe(true);
    await page.waitForTimeout(500);
}

const callApp = (page, method, asin) => page.evaluate(async ({ method, asin }) => {
    window.confirmDialog = async () => true;
    await window.bookshelf[method](asin);
}, { method, asin });

const n = (a) => (Array.isArray(a) ? a.length : null);
const hasTarget = (a) => (Array.isArray(a) ? a.includes(TARGET) : null);
const brief = (s) => ({
    lib: n(s.lib), libHas: hasTarget(s.lib), excl: s.excl, allJson: n(s.allJson), allJsonHas: hasTarget(s.allJson),
    allJsonDup: Array.isArray(s.allJson) ? s.allJson.length - new Set(s.allJson).size : null,
    ctrlOrderAll: n(s.ctrlOrderAll), ctrlOrderAllHas: hasTarget(s.ctrlOrderAll), ctrlShelfBooks: n(s.ctrlShelfBooks),
    memOrderAll: n(s.memOrderAll), memOrderAllHas: hasTarget(s.memOrderAll), memShelfBooks: n(s.memShelfBooks),
    memSameArray: s.memSameArray, decision: s.decision, pending: s.pending
});

const SCENARIOS = [
    { id: 'R', title: '除外を書き出してから再読込 (保存先を採る)' },
    { id: 'L', title: '除外の直後に待たずに再読込 (手元を採る)' },
    { id: 'S', title: '除外を書き出した後にもう一度保存し、待たずに再読込' },
    { id: 'U', title: '除外を書き出してから取り消して書き出す' },
];

for (const sc of SCENARIOS) {
    test(`664-${sc.id} フォルダにつないだまま${sc.title}と、除外した本は all.json・控え・すべての本に入らない`, async ({ page }, testInfo) => {
        const dirName = `e664-${sc.id}-${testInfo.repeatEachIndex}-${testInfo.retry}`;
        await stubFolderPickerForTest(page, dirName);
        await bootAppForTest(page);
        await connectLocalFolderForTest(page);
        await page.locator('#dashboard-welcome button[data-dw="import"]').click();
        await expect(page.locator('#import-modal')).toHaveClass(/show/);
        await pasteImport(page, EXPORT_JSON);
        await expect.poll(async () => n((await readState(page, dirName)).allJson), { timeout: 20000 }).toBe(3);
        await page.waitForTimeout(500);
        await page.keyboard.press('Escape');

        await callApp(page, 'excludeBook', TARGET);
        const rec = { sc: sc.id, n: testInfo.repeatEachIndex };
        if (sc.id !== 'L') {
            await waitExported(page, dirName, true);
            rec.exported = { ...brief(await readState(page, dirName)), tree: await treeCount(page) };
        }
        if (sc.id === 'S') {
            await page.evaluate(async () => { await window.bookshelf.saveUserData(); });
        }
        if (sc.id === 'U') {
            await callApp(page, 'unexcludeBook', TARGET);
            await waitExported(page, dirName, false);
            const s = await readState(page, dirName);
            rec.unexcluded = { ...brief(s), tree: await treeCount(page) };
            if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); appendFileSync(OUT, JSON.stringify(rec) + '\n'); }
            expect.soft(n(s.allJson), '取り消し後の all.json の books').toBe(3);
            expect.soft(rec.unexcluded.allJsonDup, '取り消し後の all.json の重複').toBe(0);
            expect.soft(n(s.lib), '取り消し後の library.json').toBe(3);
            expect.soft(rec.unexcluded.tree, '取り消し後の すべての本 の冊数').toBe('3');
            return;
        }
        rec.beforeReload = { ...brief(await readState(page, dirName)), tree: await treeCount(page) };

        await page.reload();
        await expect(allShelf(page)).toBeVisible({ timeout: 20000 });
        const counts = [];
        for (let i = 0; i < 16; i++) {
            counts.push(await treeCount(page));
            await page.waitForTimeout(250);
        }
        rec.dialog = await page.locator('#load-conflict-dialog, #sync-conflict-dialog').filter({ visible: true }).count();
        rec.counts = [...new Set(counts)].join('>');
        rec.afterReload = brief(await readState(page, dirName));
        // 再読込の後の保存 (手元を採った時の書き出し) を待ってから、フォルダと控えをもう一度読む (最大8秒)
        if (!rec.dialog) {
            await expect.poll(async () => (await readState(page, dirName)).pending !== '1', { timeout: 8000 }).toBe(true).catch(() => {});
            await page.waitForTimeout(500);
        }
        const settled = await readState(page, dirName);
        rec.settled = { ...brief(settled), tree: await treeCount(page) };
        if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); appendFileSync(OUT, JSON.stringify(rec) + '\n'); }

        // 決まりどおりの期待 (直す前は赤になる見込みの行がある)
        if (rec.exported) {
            expect.soft(rec.exported.lib, '書き出し後の library.json (除外した本も含む全書誌)').toBe(3);
            expect.soft(rec.exported.allJson, '書き出し後の all.json の books').toBe(2);
            expect.soft(rec.exported.memOrderAll, '書き出し後のメモリの bookOrder.all').toBe(2);
        }
        expect.soft(counts[counts.length - 1], '再読込の後の すべての本 の冊数').toBe('2');
        expect.soft(n(settled.ctrlOrderAll), '再読込の後の端末の控えの bookOrder.all').toBe(2);
        expect.soft(rec.settled.tree, '再読込の後の保存を待った後の すべての本 の冊数').toBe('2');
        if (!rec.dialog) expect.soft(n(settled.allJson), '再読込の後のフォルダの all.json の books').toBe(2);
    });
}
