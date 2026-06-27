// UI再設計 P0 (見た目の安全な改善) の回帰テスト
//  - 本棚の編集(⋯)ボタンを常時表示 (hover限定をやめる)
//  - モバイルでフォーム入力を16px以上にしてiOS自動ズームを防ぐ
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

test('P0: 本棚の編集(⋯)ボタンが hover なしで常時表示される', async ({ page }) => {
    await bootApp(page);
    const more = page.locator('#sidebar-bookshelf-tree .tree-more').first();
    await expect(more).toBeVisible(); // 旧: display:none で hover/active 時のみ表示だった
});

test('P0: モバイルではフォーム入力の font-size が 16px 以上 (iOS自動ズーム防止)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await bootApp(page);
    // 旧 14px だった同期設定のフォルダ入力など、<16px だった入力が 16px に揃う
    const sizes = await page.evaluate(() => {
        const ids = ['#github-base-path', '#kindle-paste-input', '#setting-affiliate-id'];
        return ids.map((id) => {
            const el = document.querySelector(id);
            return el ? parseFloat(getComputedStyle(el).fontSize) : null;
        });
    });
    const checked = sizes.filter((s) => s != null);
    expect(checked.length).toBeGreaterThan(0);
    for (const s of checked) expect(s).toBeGreaterThanOrEqual(16);
});
