// lint:e2e-wait (scripts/check-e2e-async-wait.mjs・イシュー#607) 自身のテスト。
// waitForFunction に async 関数を渡す書き方(Promise が真とみなされ待たずに通る)を拾い、同期の述語・expect.poll は拾わないこと。
// 末尾の describe は、npm run lint:e2e-wait と同じ入口(node でスクリプトを起動)を通して、今の tests/e2e が0件であることを確かめる。
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findAsyncWaits, findHeavyAriaWaits, lintAsyncWaits } from '../../scripts/check-e2e-async-wait.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '../../scripts/check-e2e-async-wait.mjs');

describe('findAsyncWaits: 拾うもの', () => {
    it('async のアロー関数 (#607 で見つかった gate-local.js の形)', () => {
        const code = `export async function waitFor(page) {
    await page.waitForFunction(async ([name]) => {
        const root = await navigator.storage.getDirectory();
        return !!(await root.getDirectoryHandle(name));
    }, ['x'], { polling: 200 });
}`;
        expect(findAsyncWaits(code)).toEqual([{ line: 2, text: 'async 関数を渡している' }]);
    });
    it('async の関数式と、frame など page 以外の waitForFunction', () => {
        const code = `await frame.waitForFunction(async function () { return true; });`;
        expect(findAsyncWaits(code)).toHaveLength(1);
    });
    it('同じファイルで async 関数として宣言・代入した名前を渡す', () => {
        const code = `async function ready() { return true; }
const done = async () => false;
await page.waitForFunction(ready);
await page.waitForFunction(done);`;
        expect(findAsyncWaits(code).map((v) => v.line)).toEqual([3, 4]);
    });
});

describe('findAsyncWaits: 拾わないもの', () => {
    it('同期の述語 (今の tests/e2e の waitForFunction はこの形)', () => {
        const code = `await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
await page.waitForFunction(function () { return document.readyState === 'complete'; });
await page.waitForFunction('window.ready === true');`;
        expect(findAsyncWaits(code)).toEqual([]);
    });
    it('expect.poll に async の evaluate を渡す (#607 の直し方)', () => {
        const code = `await expect.poll(() => page.evaluate(async () => (await navigator.storage.getDirectory()) !== null)).toBe(true);`;
        expect(findAsyncWaits(code)).toEqual([]);
    });
    it('同期の関数の名前を渡す', () => {
        const code = `const ready = () => window.ready === true;
await page.waitForFunction(ready);`;
        expect(findAsyncWaits(code)).toEqual([]);
    });
});

// ページ全体を写す待ち (イシュー#640)。大量の蔵書の spec の頭 (seedManyBooksForTest の既定は 913冊)
const MANY = `import { seedManyBooksForTest } from '../helpers/gate-setup.js';
await seedManyBooksForTest(page);
`;

describe('findHeavyAriaWaits: 大量の蔵書の spec で拾うもの (#640)', () => {
    it('見えない・無いことを待つ (toBeHidden・not.toBeVisible・not.toBeAttached)', () => {
        const code = `${MANY}await expect(page.locator('#dialog')).toBeHidden();
await expect(page.locator('#dialog')).not.toBeVisible();
await expect.soft(page.locator('#dialog')).not.toBeAttached();`;
        expect(findHeavyAriaWaits(code).map((v) => v.line)).toEqual([3, 4, 5]);
    });
    it('ページ単位 (toHaveURL・toHaveTitle)', () => {
        const code = `${MANY}await expect(page).toHaveURL(/#\\/shelf/);
await expect(page).toHaveTitle('AsayakeBookshelf');`;
        expect(findHeavyAriaWaits(code).map((v) => v.line)).toEqual([3, 4]);
    });
    it('大きな入れ物 (body・#bookshelf) への matcher', () => {
        const code = `${MANY}await expect(page.locator('body')).toHaveClass(/mobile/);
await expect(page.locator('#bookshelf')).toHaveAttribute('data-view', 'grid');`;
        const found = findHeavyAriaWaits(code);
        expect(found.map((v) => v.line)).toEqual([3, 4]);
        expect(found[0].text).toContain('大きな入れ物 (body)');
    });
});

describe('findHeavyAriaWaits: 全ファイルで拾うもの (#640)', () => {
    it('見えない印 (#gate-timings・data-gate-) を写しを作る matcher で待つ (#629 の J3-5 の元の形)。小さい spec でも拾う', () => {
        const code = `await expect(page.locator('#gate-timings')).toHaveAttribute('data-gate-sort-order-count', '1');
await expect(page.locator('[data-gate-x="1"]')).toBeVisible();`;
        expect(findHeavyAriaWaits(code).map((v) => v.line)).toEqual([1, 2]);
    });
});

describe('findHeavyAriaWaits: 拾わないもの (#640)', () => {
    it('小さい spec (蔵書を大量に入れない) の toBeHidden・toHaveURL・body (5冊のページでは1件あたり数〜30ms)', () => {
        const code = `await expect(page.locator('#dialog')).toBeHidden();
await expect(page).toHaveURL(/#\\/shelf/);
await expect(page.locator('body')).toHaveClass(/mobile/);`;
        expect(findHeavyAriaWaits(code)).toEqual([]);
    });
    it('大量の spec でも、写しを作らない形 (toHaveCount・expect.poll・waitForURL) と、見える小さな要素への matcher', () => {
        const code = `${MANY}await expect(page.locator('#gate-timings[data-gate-sort-order-count="1"]')).toHaveCount(1);
await expect.poll(() => page.locator('#gate-timings').getAttribute('data-gate-sort-order-ms')).not.toBeNull();
await expect(page.locator('#dialog:visible')).toHaveCount(0);
await page.waitForURL(/#\\/shelf/);
await expect(page.locator('#sort-order')).toBeVisible();
await expect(page.locator('.bsr-count')).toHaveText('913');`;
        expect(findHeavyAriaWaits(code)).toEqual([]);
    });
    it('期待値を配列で渡す形 (〜.array は写しを作らない)', () => {
        const code = `await expect(page.locator('#gate-timings li')).toHaveText(['a', 'b']);`;
        expect(findHeavyAriaWaits(code)).toEqual([]);
    });
});

describe('findHeavyAriaWaits: 大量の蔵書の見分け方の境目 (99 と 100)', () => {
    const hidden = `await expect(page.locator('#dialog')).toBeHidden();`;
    it('Array.from({ length: 99 }) は大量とみなさず、100 は大量とみなす', () => {
        expect(findHeavyAriaWaits(`const books = Array.from({ length: 99 }, (_, i) => i);\n${hidden}`)).toEqual([]);
        expect(findHeavyAriaWaits(`const books = Array.from({ length: 100 }, (_, i) => i);\n${hidden}`)).toHaveLength(1);
    });
    it('const の名前で渡した長さも読む (const N = 100)', () => {
        expect(findHeavyAriaWaits(`const N = 99;\nconst books = Array.from({ length: N });\n${hidden}`)).toEqual([]);
        expect(findHeavyAriaWaits(`const N = 100;\nconst books = Array.from({ length: N });\n${hidden}`)).toHaveLength(1);
    });
    it('seedManyBooksForTest は引数なし (既定 913冊)・100 以上なら大量、99 なら大量とみなさない', () => {
        expect(findHeavyAriaWaits(`await seedManyBooksForTest(page, 99);\n${hidden}`)).toEqual([]);
        expect(findHeavyAriaWaits(`await seedManyBooksForTest(page, 100);\n${hidden}`)).toHaveLength(1);
        expect(findHeavyAriaWaits(`await seedManyBooksForTest(page);\n${hidden}`)).toHaveLength(1);
    });
});

describe('陰性対照: 門のE2E J3-5 (913冊) を lint の入口に通す (#640)', () => {
    const J35 = readFileSync(join(here, '../e2e/gate/j3-5-many-books.spec.js'), 'utf-8');
    const lintCopy = (code) => {
        const dir = mkdtempSync(join(tmpdir(), 'lint-e2e-wait-'));
        writeFileSync(join(dir, 'j3-5-many-books.spec.js'), code);
        return lintAsyncWaits({ dir });
    };
    it('元の J3-5 は0件 (記録は toHaveCount で待ち、見える小さな要素だけに toBeVisible・toHaveText・toContainText を使う)', () => {
        expect(lintCopy(J35).violations).toEqual([]);
    });
    it('J3-5 の写しに toBeHidden を1行足すと、その行で落ちる', () => {
        const anchor = "await page.keyboard.press('Escape');";
        expect(J35).toContain(anchor);
        const at = J35.slice(0, J35.indexOf(anchor)).split('\n').length + 1;
        const broken = J35.replace(anchor, `${anchor}\n        await expect(page.locator('#sort-order')).toBeHidden();`);
        const { violations } = lintCopy(broken);
        expect(violations).toHaveLength(1);
        expect(violations[0].line).toBe(at);
        expect(violations[0].text).toContain('大量の蔵書の spec で toBeHidden');
    });
});

describe('npm run lint:e2e-wait と同じ入口', () => {
    it('今の tests/e2e (spec と helpers) は0件で、終了コード0', () => {
        const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf-8' });
        expect(r.stderr).toBe('');
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/^OK: tests\/e2e 配下 \d+ ファイルに、waitForFunction へ async 関数を渡す所は0件・ページ全体を写す待ち \(#640\) も0件/);
    });
});
