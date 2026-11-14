// lint:e2e-external (scripts/check-e2e-external.mjs・イシュー#637) 自身のテスト。
// fixture (tests/e2e/helpers/test-base.js) を通らない context の作り方を拾い、通る書き方は拾わないこと。
// 末尾の describe は、npm run lint:e2e-external と同じ入口 (node でスクリプトを起動) を通して、
// 今の tests/e2e・tests/visual が0件であること・違反のある木では失敗することを確かめる。
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExternalBypass } from '../../scripts/check-e2e-external.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, '../../scripts/check-e2e-external.mjs');
const rules = (code) => findExternalBypass(code).map((v) => `${v.line}:${v.rule}`);

describe('findExternalBypass: 拾うもの', () => {
    it('A: @playwright/test から test を import (#637 の github-sync-resilience.spec.js の形)', () => {
        expect(rules(`import { test, expect } from '@playwright/test';`)).toEqual(['1:A']);
    });
    it('A: 別名・既定・名前空間の import', () => {
        expect(rules(`import { test as base } from '@playwright/test';`)).toEqual(['1:A']);
        expect(rules(`import * as pw from '@playwright/test';`)).toEqual(['1:A']);
    });
    it('B: newContext の戻り値を変数に受けない (#637 の sort-persist.spec.js の形)', () => {
        expect(rules(`const phone = await (await browser.newContext()).newPage();`)).toEqual(['1:B']);
    });
    it('B: 変数に受けたが blockExternalForTest を掛けていない', () => {
        expect(rules(`const ctx = await browser.newContext({ serviceWorkers: 'allow' });\nconst p = await ctx.newPage();`)).toEqual(['1:B']);
    });
    it('C: browser.newPage()', () => {
        expect(rules(`const p = await browser.newPage();`)).toEqual(['1:C']);
    });
});

describe('findExternalBypass: 拾わないもの', () => {
    it('test-base からの import・expect だけの import・型の import', () => {
        expect(rules(`import { test, expect } from './helpers/test-base.js';`)).toEqual([]);
        expect(rules(`import { expect } from '@playwright/test';`)).toEqual([]);
        expect(rules(`import type { Page } from '@playwright/test';`)).toEqual([]);
    });
    it('newContext の後に blockExternalForTest を掛ける (gate-device.js の形)', () => {
        const code = `const context = await page.context().browser().newContext({\n    baseURL,\n});\nawait blockExternalForTest(context);`;
        expect(rules(code)).toEqual([]);
    });
    it('コメントの中の newContext・newPage', () => {
        expect(rules(`// browser.newContext() で作った context には効かない\n// browser.newPage() も同じ`)).toEqual([]);
    });
});

describe('npm run lint:e2e-external と同じ入口', () => {
    it('今の tests/e2e・tests/visual は0件 (cover-cache-sw.spec.js は許可リスト)', () => {
        const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf-8' });
        expect(r.stderr).toBe('');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('cover-cache-sw.spec.js');
    });
    it('違反のある木では失敗し、場所を出す', () => {
        const root = mkdtempSync(join(tmpdir(), 'lint-e2e-external-'));
        mkdirSync(join(root, 'tests/e2e'), { recursive: true });
        writeFileSync(join(root, 'tests/e2e/leak.spec.js'), `import { test } from '@playwright/test';\n`);
        writeFileSync(join(root, 'tests/e2e/cover-cache-sw.spec.js'), `import { test } from '@playwright/test';\nconst ctx = await browser.newContext();\n`);
        const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf-8' });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('tests/e2e/leak.spec.js:1 [A]');
        expect(r.stderr).not.toContain('cover-cache-sw.spec.js:1');
        // 許可するのは A だけ。blockExternalForTest を掛けない newContext は cover-cache-sw でも違反 (イシュー#647)
        expect(r.stderr).toContain('tests/e2e/cover-cache-sw.spec.js:2 [B]');
    });
    it('該当が無くなった許可リストの行も失敗にする', () => {
        const root = mkdtempSync(join(tmpdir(), 'lint-e2e-external-'));
        mkdirSync(join(root, 'tests/e2e'), { recursive: true });
        writeFileSync(join(root, 'tests/e2e/cover-cache-sw.spec.js'), `import { test } from './helpers/test-base.js';\n`);
        const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf-8' });
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('該当が無くなった例外');
    });
});
