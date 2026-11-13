// lint:e2e-wait (scripts/check-e2e-async-wait.mjs・イシュー#607) 自身のテスト。
// waitForFunction に async 関数を渡す書き方(Promise が真とみなされ待たずに通る)を拾い、同期の述語・expect.poll は拾わないこと。
// 末尾の describe は、npm run lint:e2e-wait と同じ入口(node でスクリプトを起動)を通して、今の tests/e2e が0件であることを確かめる。
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findAsyncWaits } from '../../scripts/check-e2e-async-wait.mjs';

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

describe('npm run lint:e2e-wait と同じ入口', () => {
    it('今の tests/e2e (spec と helpers) は0件で、終了コード0', () => {
        const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf-8' });
        expect(r.stderr).toBe('');
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/^OK: tests\/e2e 配下 \d+ ファイルに、waitForFunction へ async 関数を渡す所は0件/);
    });
});
