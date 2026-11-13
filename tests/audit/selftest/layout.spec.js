// 表示崩れの検出器 (tests/audit/detectors/layout.js) の変異検査。
// 誤りを入れた見本で種類ごとに入れた数と同じ件数を検出し、崩れの無い見本で0件であること。6幅のどれでも同じ結果。
import { test, expect } from '@playwright/test';
import { pinEnvironment, platformFonts, AUDIT_FONT } from '../boot.js';
import { detectLayout } from '../detectors/layout.js';
import { countByKind } from '../detectors/common.js';

const ALLOW = [
    { kind: 'clip', selector: '.ell', reason: '見本: 意図した省略表示' },
    { kind: 'clip', selector: '#clip-plain', reason: '見本: 省略表示の指定が無い要素は、載せても除外が効かない' },
];

test('検査の時の文字は、固定した1書体で描かれる', async ({ page }) => {
    await page.goto('tests/fixtures/audit/layout-good.html');
    await pinEnvironment(page);
    expect(await platformFonts(page)).toEqual([AUDIT_FONT]);
});

test('誤りを入れた見本で、種類ごとに入れた数と同じ件数を検出する', async ({ page }) => {
    await page.goto('tests/fixtures/audit/layout-bad.html');
    await pinEnvironment(page);
    const { findings, usedAllow } = await detectLayout(page, { allowlist: ALLOW });
    expect(countByKind(findings)).toEqual({ clip: 2, overflow: 1, pageX: 1, overlap: 1 });
    expect(findings.map((f) => `${f.kind} ${f.ident}`).sort()).toEqual([
        'clip #clip-plain', 'clip #ell-unlisted', 'overflow #wide', 'overlap #sib-a × #sib-b', 'pageX document',
    ]);
    expect(usedAllow.map((a) => a.selector)).toEqual(['.ell']);
});

test('除外リストに載せていない省略表示は検出する', async ({ page }) => {
    await page.goto('tests/fixtures/audit/layout-bad.html');
    await pinEnvironment(page);
    const { findings } = await detectLayout(page, { allowlist: [] });
    expect(findings.filter((f) => f.kind === 'clip').map((f) => f.ident).sort()).toEqual(['#clip-plain', '#ell-listed', '#ell-unlisted']);
});

test('崩れの無い見本では0件', async ({ page }) => {
    await page.goto('tests/fixtures/audit/layout-good.html');
    await pinEnvironment(page);
    const { findings } = await detectLayout(page, { allowlist: ALLOW });
    expect(findings).toEqual([]);
});
