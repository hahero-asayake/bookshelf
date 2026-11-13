// Lucide の全セットを同じオリジン (js/vendor/lucide) から読む (イシュー#565 step5)
// inline (LUCIDE_ICONS) に無い名前を、プラグインや利用者のデータが指定した時に、
// 先頭2文字のテキスト (例 "us" "mo") に崩れず Lucide の図形で出ること・外部へ取りに行かないことを確かめる。
//   - 標準プラグインが使う未 inline の4つ (users・moon・list-plus・layers) を、プラグイン API の addUIButton
//     (manifest.icon と同じく entry.iconName → renderIcon の経路) で指定する
//   - 利用者の本棚アイコンに未 inline の名前 (anchor) を設定し、サイドバーのツリーに出す
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

const PLUGIN_ICONS = ['users', 'moon', 'list-plus', 'layers'];

async function bootApp(page, external) {
    page.on('request', (req) => {
        const u = new URL(req.url());
        if (/unpkg\.com|jsdelivr\.net|lucide/.test(u.hostname)) external.push(u.href);
    });
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
}

// [data-icon-value=name] の中身が図形 (<path> 等) で、テキスト描画 (<text>) でないこと
async function iconShape(page, name) {
    return page.evaluate((n) => {
        const els = [...document.querySelectorAll(`[data-icon-value="${n}"]`)];
        if (!els.length) return 'none';
        return els.every((el) => /<(path|circle|rect|line|polyline|polygon|ellipse)\b/.test(el.innerHTML) && !/<text\b/.test(el.innerHTML)) ? 'shape' : 'text';
    }, name);
}

for (const vp of [{ name: 'PC', width: 1280, height: 800 }, { name: 'スマホ幅', width: 390, height: 844 }]) {
    test.describe(`未 inline の Lucide 名が図形で出る (${vp.name})`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        test('標準プラグインのアイコン4つ (addUIButton で指定)', async ({ page }) => {
            const external = [];
            await bootApp(page, external);
            const inline = await page.evaluate((names) => names.filter((n) => window.LUCIDE_ICONS[n]), PLUGIN_ICONS);
            expect(inline, 'この4つは inline に無い前提 (vendor から読む経路を通す)').toEqual([]);
            // addUIButton のボタンは内部 pool (#plugin-buttons・hidden) に入り、ヘッダー配置で表へ出る。
            // どちらでも描画は _applyIconToButton → renderIcon(iconName) + data-icon-value (後追い差し替え) の同じ経路
            await page.evaluate((names) => {
                for (const n of names) {
                    const api = window.bookshelf.pluginAPI.forPlugin(`t565-${n}`);
                    api.addUIButton({ id: `t565-btn-${n}`, label: n, title: n, iconName: n, onClick() {} });
                }
            }, PLUGIN_ICONS);
            const pooled = await page.evaluate(() => document.querySelectorAll('#plugin-buttons [data-icon-value]').length);
            test.info().annotations.push({ type: 'pool', description: String(pooled) });
            for (const n of PLUGIN_ICONS) {
                await expect.poll(() => iconShape(page, n), { message: n }).toBe('shape');
            }
            expect(external).toEqual([]);
        });

        test('本棚アイコンに未 inline の名前 (anchor) を設定してもツリーで図形になる', async ({ page }) => {
            const external = [];
            await bootApp(page, external);
            expect(await page.evaluate(() => !!window.LUCIDE_ICONS.anchor)).toBe(false);
            await page.evaluate(() => {
                const bs = window.bookshelf.bookshelfManager.getBookshelves().find((b) => !b.isSpecial);
                window.bookshelf.bookshelfManager.update(bs.id, { iconName: 'anchor' });
                window.bookshelf.showBookshelfManager(); // 本棚の管理一覧 (bookshelf-list-icon[data-icon-value])
            });
            await expect.poll(() => iconShape(page, 'anchor')).toBe('shape');
            expect(external).toEqual([]);
        });
    });
}
