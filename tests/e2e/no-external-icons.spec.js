// アイコンの外部取得0 (イシュー#565)
// js/icons.js の unpkg.com/lucide-static@latest 実行時取得を撤去し、全部同梱にした。
// test-base.js も unpkg を route しなくなったので、取得が復活すればここで実リクエストとして見える。
// 起動→ホーム→本棚→設定→⌘K パレットを通して、アイコン系の外部ホストへの通信が0件であること、
// また test-base.js が既知として潰しているホスト以外への外部通信が0件であることを確かめる。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openSettingsByClick } from './helpers/settings.js';
import { openCommandPalette } from './helpers/nav.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

// test-base.js が route で潰している既知の外部 (GIS/AdSense/書影)。アイコンとは無関係
const KNOWN_STUBBED = /(^|\.)(google\.com|googlesyndication\.com|doubleclick\.net|gstatic\.com|ssl-images-amazon\.com|media-amazon\.com)$/;

for (const vp of [{ name: 'PC', width: 1280, height: 800 }, { name: 'スマホ幅', width: 390, height: 844 }]) {
    test(`アイコンを外部から取得しない (${vp.name})`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const external = [];
        page.on('request', (req) => {
            const u = new URL(req.url());
            if (u.protocol.startsWith('http') && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
                external.push(u.hostname + u.pathname);
            }
        });
        await page.addInitScript(([userData, library]) => {
            localStorage.setItem('virtualBookshelf_userData', userData);
            localStorage.setItem('virtualBookshelf_library', library);
            localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
        }, [fixtureUserData, fixtureLibrary]);
        await page.goto('index.html');
        await page.waitForFunction(() => window.bookshelf && (window.bookshelf.books || []).length > 0);
        await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });

        await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
        await expect(page.locator('.book-item').first()).toBeVisible();
        if (vp.width >= 1000) {
            await openSettingsByClick(page);
            await expect(page.locator('#settings-modal')).toBeVisible();
            await page.keyboard.press('Escape');
        }
        await openCommandPalette(page);
        await expect(page.locator('#command-palette')).toBeVisible();

        // 描画された data-icon はすべて SVG が入っている (未同梱の空アイコンが無い)
        const emptyIcons = await page.evaluate(() => [...document.querySelectorAll('[data-icon]')]
            .filter((el) => !el.querySelector('svg')).map((el) => el.dataset.icon));
        expect([...new Set(emptyIcons)]).toEqual([]);

        expect(external.filter((h) => /unpkg\.com|jsdelivr\.net|lucide/.test(h))).toEqual([]);
        expect(external.filter((h) => !KNOWN_STUBBED.test(h.split('/')[0]))).toEqual([]);
    });
}
