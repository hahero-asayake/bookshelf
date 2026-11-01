import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:8135';
const fixtureUserData = readFileSync('tests/fixtures/fixture-userdata.json', 'utf-8');
const fixtureLibrary = readFileSync('tests/fixtures/fixture-library.json', 'utf-8');
const HUB = 'https://mockhub.test';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
await page.route(`${HUB}/**`, async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/usage') return route.fulfill({ json: { plan: 'free', usedBytes: 0, quotaBytes: 100 * 1048576, isAdmin: true } });
    return route.fulfill({ status: 404, json: {} });
});
await page.addInitScript(([userData, library, hub]) => {
    localStorage.setItem('virtualBookshelf_userData', userData);
    localStorage.setItem('virtualBookshelf_library', library);
    localStorage.setItem('bookshelf_sync', JSON.stringify({
        method: 'local',
        hub: { key: 'hk_test', apiBase: hub, email: 'test@example.com', plan: 'free', isAdmin: true, siteId: 'sid' }
    }));
}, [fixtureUserData, fixtureLibrary, HUB]);
await page.goto(`${BASE}/index.html`);
await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
await page.evaluate(() => {
    window.HubAuth.renderSignInButton = () => {};
    window.bookshelf.saveUserData = async () => {};
});
await page.evaluate(() => window.bookshelf._openSettingsModal('account-section'));
await page.waitForTimeout(300);

const info = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('#settings-modal *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        if (r.top < 35 || r.top > 70) return; // y=35〜70の範囲に上端がある要素だけ
        const cs = getComputedStyle(el);
        const hasVisual = cs.borderTopWidth !== '0px' || cs.borderBottomWidth !== '0px' || cs.boxShadow !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
        if (!hasVisual) return;
        results.push({ tag: el.tagName, id: el.id, cls: el.className?.toString?.().slice(0, 80), rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }, borderTop: cs.borderTop, borderBottom: cs.borderBottom, boxShadow: cs.boxShadow, bg: cs.backgroundColor });
    });
    return results;
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
