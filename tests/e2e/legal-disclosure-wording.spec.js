// アフィリエイト開示文言の整理・各ポリシーの施行日明記 (イシュー#410)
//  1. 設定「このアプリについて」のアフィリエイト開示文から、不要な「（公開ページにもその旨が
//     控えめに表示されます）」を削除した (ハヘロ指示 2026-11-01)。この一文が再混入していないか
//     表示で確認する。
//  2. legal/*.html (terms/privacy/tokushoho) の冒頭に「施行日: {{RELEASE_DATE}}」と
//     「施行日より前の版は効力を持たない」旨の1行を追加した。両方が実際に表示されることを確認する。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page) {
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
}

test('設定「このアプリについて」のアフィリエイト開示文に「控えめ」が無い (イシュー#410)', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => window.bookshelf._openSettingsModal('about-section'));
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    const affiliateText = await page.locator('.about-affiliate').innerText();
    expect(affiliateText).toContain('アフィリエイト開示');
    expect(affiliateText).toContain('Amazon.co.jp アソシエイト');
    expect(affiliateText).not.toContain('控えめ');
});

for (const [file, title] of [
    ['legal/terms.html', '利用規約'],
    ['legal/privacy.html', 'プライバシーポリシー'],
    ['legal/tokushoho.html', '特定商取引法に基づく表記'],
]) {
    test(`${title} (${file}) に施行日と旧版無効化の1行がある (イシュー#410)`, async ({ page }) => {
        await page.goto(file);
        await expect(page.locator('h1')).toHaveText(title);
        const updated = await page.locator('p.updated').first().innerText();
        expect(updated).toMatch(/施行日/);
        const effectiveNote = await page.locator('p.effective-note').first().innerText();
        expect(effectiveNote).toContain('施行日から効力を生じます');
        expect(effectiveNote).toContain('施行日以降は効力を持ちません');
        // 改定履歴の節が新設されていること
        await expect(page.locator('h2:text("改定履歴")')).toHaveCount(1);
    });
}
