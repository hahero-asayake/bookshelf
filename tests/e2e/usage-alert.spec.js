// ハブ容量アラートバナー (WP-B3/B4) の回帰テスト
//  0.79 = 非表示 / 0.81 = 警告 / 0.96 = 強警告 / Free 超過 = 書き出し導線つき危機表示
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

// hub 接続キャッシュ (bookshelf_sync.hub) を注入して起動。ネットワークは使わない
async function bootWithHub(page, hub) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.addInitScript(([userData, library, hubJson]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', hub: JSON.parse(hubJson) }));
    }, [fixtureUserData, fixtureLibrary, JSON.stringify(hub)]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
    return errors;
}

const MB = 1024 * 1024;
const baseHub = { key: 'hk_test', apiBase: 'https://hub.example', email: 'e2e@example.com', quotaBytes: 100 * MB, plan: 'free' };

test('使用率 79% ではバナーは出ない', async ({ page }) => {
    const errors = await bootWithHub(page, { ...baseHub, usedBytes: 79 * MB });
    await expect(page.locator('#usage-alert-banner')).toBeHidden();
    expect(errors).toEqual([]);
});

test('使用率 81% で警告バナー + Plus CTA が出る', async ({ page }) => {
    const errors = await bootWithHub(page, { ...baseHub, usedBytes: 81 * MB });
    const banner = page.locator('#usage-alert-banner');
    await expect(banner).toBeVisible();
    await expect(banner).not.toHaveClass(/is-critical/);
    await expect(page.locator('#usage-alert-msg')).toContainText('80%');
    await expect(page.locator('#usage-alert-upgrade')).toBeVisible();
    await expect(page.locator('#usage-alert-export')).toBeHidden();
    expect(errors).toEqual([]);
});

test('使用率 96% で強警告 (is-critical) になる', async ({ page }) => {
    const errors = await bootWithHub(page, { ...baseHub, usedBytes: 96 * MB });
    const banner = page.locator('#usage-alert-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/is-critical/);
    await expect(page.locator('#usage-alert-msg')).toContainText('わずか');
    expect(errors).toEqual([]);
});

test('Free で上限超過 (降格後) は保存不能の案内 + 書き出し導線が出る', async ({ page }) => {
    const errors = await bootWithHub(page, { ...baseHub, usedBytes: 150 * MB });
    const banner = page.locator('#usage-alert-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/is-critical/);
    await expect(page.locator('#usage-alert-msg')).toContainText('超過');
    await expect(page.locator('#usage-alert-export')).toBeVisible();
    await expect(page.locator('#usage-alert-upgrade')).toBeVisible();
    expect(errors).toEqual([]);
});

test('Plus はしきい値内なら出ず、CTA も出ない (91% 警告時に Plus ボタン非表示)', async ({ page }) => {
    const errors = await bootWithHub(page, { ...baseHub, plan: 'plus', quotaBytes: 3 * 1024 * MB, usedBytes: 2.75 * 1024 * MB });
    const banner = page.locator('#usage-alert-banner');
    await expect(banner).toBeVisible();   // 91% 使用 → 警告は出る
    await expect(page.locator('#usage-alert-upgrade')).toBeHidden();  // Plus に CTA は出さない
    expect(errors).toEqual([]);
});

test('閉じると消え、同レベルでは再表示されない', async ({ page }) => {
    const errors = await bootWithHub(page, { ...baseHub, usedBytes: 81 * MB });
    await expect(page.locator('#usage-alert-banner')).toBeVisible();
    await page.locator('#usage-alert-close').click();
    await expect(page.locator('#usage-alert-banner')).toBeHidden();
    // 同じレベルで再描画 → 出ない / 深刻化 (超過) → 再表示
    await page.evaluate(() => window.bookshelf._renderUsageAlert({ key: 'hk_test', apiBase: 'https://hub.example', usedBytes: 82 * 1024 * 1024, quotaBytes: 100 * 1024 * 1024, plan: 'free' }));
    await expect(page.locator('#usage-alert-banner')).toBeHidden();
    await page.evaluate(() => window.bookshelf._renderUsageAlert({ key: 'hk_test', apiBase: 'https://hub.example', usedBytes: 150 * 1024 * 1024, quotaBytes: 100 * 1024 * 1024, plan: 'free' }));
    await expect(page.locator('#usage-alert-banner')).toBeVisible();
    expect(errors).toEqual([]);
});
