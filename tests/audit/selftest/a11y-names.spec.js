// 名前の無い部品の検出器 (tests/audit/detectors/a11y-names.js) の変異検査。
// 誤りを入れた見本で入れた数と同じ件数を検出し、正しい見本で0件であること。
import { test, expect } from '@playwright/test';
import { pinEnvironment } from '../boot.js';
import { detectA11yNames } from '../detectors/a11y-names.js';
import { countByKind } from '../detectors/common.js';

test('誤りを入れた見本で、入れた数と同じ件数を検出する', async ({ page }) => {
    await page.goto('tests/fixtures/audit/a11y-names-bad.html');
    await pinEnvironment(page);
    const findings = await detectA11yNames(page);
    const own = findings.filter((f) => f.kind !== 'axe');
    expect(countByKind(own)).toEqual({ button: 1, image: 1, input: 1, inputPlaceholderOnly: 1, link: 1, select: 1 });
    expect(own.map((f) => f.ident).sort()).toEqual(['#bad-icon-button', '#bad-img', '#bad-input', '#bad-link', '#bad-placeholder', '#bad-select']);
    // axe は placeholder を名前として認めるので、placeholder だけの入力は自前の検査だけが検出する
    const axe = findings.filter((f) => f.kind === 'axe').map((f) => f.ident).sort();
    expect(axe).toEqual(['button-name: #bad-icon-button', 'image-alt: #bad-img', 'label: #bad-input', 'link-name: #bad-link', 'select-name: #bad-select']);
});

test('名前のある見本では0件', async ({ page }) => {
    await page.goto('tests/fixtures/audit/a11y-names-good.html');
    await pinEnvironment(page);
    expect(await detectA11yNames(page)).toEqual([]);
});
