// per-shelf-memo プラグインのフルアプリ実機スモーク (headless chromium)。
// localStorage フィクスチャで本体を起動 (同期フォルダ不要) し、
// per-shelf-memo/index.js の activate ロジック (ADR-041 疎結合加算モデルの dogfood) を
// このテストファイル自身に inline 実装して有効化する。
//
// plugins-sample/per-shelf-memo は repo から削除される予定 (標準機能5個への絞り込み) のため、
// 動的 import ('/plugins-sample/per-shelf-memo/index.js') には依存しない。実体が消えても
// このテストが拡張点契約 (registerDetailSection の ctx.bookshelf を使った本棚別メモの
// 合成表示・保存) を検証し続けられるようにするため (実体は git 履歴に残る)。
// 本棚から本を開いたときに detailSection の ctx.bookshelf が実アプリから正しく配線され、
// 合成表示・保存・本棚文脈なしの分岐が動くことを検証する。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8');
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

/** フィクスチャ起動 + 同期をインメモリにスタブ + per-shelf-memo を有効化 */
async function boot(page) {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixtureUserData, fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    // writePluginFile/readPluginFile が動くよう同期先をインメモリにスタブ
    await page.evaluate(() => {
        const s = (window.__store = {});
        window.bookshelf.storage = {
            async syncBatch(entries) { for (const e of entries) s[e.path] = e.data; },
            async readText(path) { return path in s ? s[path] : null; },
        };
        window.bookshelf._isSyncReady = () => true;
    });
    // per-shelf-memo/index.js の activate ロジックを inline 実装して有効化
    // (plugins-sample/per-shelf-memo/index.js と同一ロジック。動的 import はしない)
    await page.evaluate(() => {
        const api = window.bookshelf.pluginAPI.forPlugin('per-shelf-memo');
        const cache = new Map();   // shelfSlug -> { asin: memo } (書込成功した断面のみ保持)
        const corrupt = new Set(); // JSON 破損で読めなかった slug
        const timers = new Map();

        async function loadShelf(slug) {
            if (cache.has(slug)) return cache.get(slug);
            let text = null;
            try { text = await api.readPluginFile(`${slug}.json`); }
            catch (e) { return {}; }
            if (!text) return {};
            let data = {};
            try { data = JSON.parse(text) || {}; }
            catch (e) { corrupt.add(slug); return {}; }
            cache.set(slug, data);
            return data;
        }
        async function saveShelf(slug, data) {
            try {
                await api.writePluginFile(`${slug}.json`, JSON.stringify(data, null, 2));
                cache.set(slug, data);
                return true;
            } catch (e) { return false; }
        }
        function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

        api.registerDetailSection({
            id: 'per-shelf-memo',
            async render(host, book, ctx) {
                if (!book) { host.innerHTML = ''; return; }
                const token = (host.__psmToken = (host.__psmToken || 0) + 1);
                const asin = book.asin;
                const shelf = ctx && ctx.bookshelf;

                const note = api.getNote(asin);
                const allMemo = (note && note.memo) || '';

                if (!shelf || shelf.isSpecial) {
                    host.innerHTML = `<h3 class="pds-title">本棚別メモ</h3>
                        <p class="pds-empty">本棚を開いた状態でこの本を開くと、その本棚専用のメモを書けます。</p>`;
                    return;
                }

                const data = await loadShelf(shelf.id);
                if (host.__psmToken !== token) return;

                if (corrupt.has(shelf.id)) {
                    host.innerHTML = `<h3 class="pds-title">本棚別メモ</h3>
                        <p class="pds-empty">この本棚のメモデータが壊れているため、安全のため編集を停止しています。</p>`;
                    return;
                }

                const shelfMemo = data[asin] || '';
                host.innerHTML = `
                    <h3 class="pds-title">「${escapeHtml(shelf.name || shelf.id)}」のメモ</h3>
                    <textarea class="psm-textarea" rows="3" placeholder="この本棚だけのメモ…">${escapeHtml(shelfMemo)}</textarea>
                    <div class="psm-status" aria-live="polite"></div>
                    ${allMemo ? `<p class="psm-all"><span class="psm-all-label">共通メモ</span>${escapeHtml(allMemo)}</p>` : ''}
                `;

                const ta = host.querySelector('.psm-textarea');
                const status = host.querySelector('.psm-status');
                ta.addEventListener('input', () => {
                    status.textContent = '入力中…';
                    const key = `${shelf.id}::${asin}`;
                    if (timers.has(key)) clearTimeout(timers.get(key));
                    timers.set(key, setTimeout(async () => {
                        timers.delete(key);
                        const next = { ...(await loadShelf(shelf.id)) };
                        const raw = ta.value;
                        if (raw.trim()) next[asin] = raw; else delete next[asin];
                        const ok = await saveShelf(shelf.id, next);
                        status.textContent = ok ? '保存しました' : '保存に失敗 (同期先が未接続)';
                        if (ok) setTimeout(() => { if (status.textContent === '保存しました') status.textContent = ''; }, 1500);
                    }, 400));
                });
            }
        });
    });
    return errors;
}

test('本棚から本を開くと ctx.bookshelf が配線され、本棚別メモを保存→再表示できる', async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('fixshelf'));
    await page.locator('#bookshelf .book-item[data-asin="B000000002"]').click();

    const sec = page.locator('#book-detail-pane .plugin-detail-section[data-plugin-section="per-shelf-memo"]');
    await expect(sec).toBeVisible();
    // ctx.bookshelf が実アプリの文脈本棚として渡っている (タイトルに本棚名)
    await expect(sec.locator('.pds-title')).toContainText('テスト本棚');
    const ta = sec.locator('.psm-textarea');
    await expect(ta).toBeVisible();

    // 入力 → 専用ストアへ保存
    await ta.fill('テスト本棚だけのメモ');
    await expect(sec.locator('.psm-status')).toHaveText('保存しました', { timeout: 3000 });
    const saved = await page.evaluate(() => window.__store['plugins/per-shelf-memo/data/fixshelf.json']);
    expect(JSON.parse(saved).B000000002).toBe('テスト本棚だけのメモ');

    // 別の本へ → 戻ると保存値が残る
    await page.locator('#bookshelf .book-item[data-asin="B000000001"]').click();
    await expect(sec.locator('.psm-textarea')).toHaveValue('');
    await page.locator('#bookshelf .book-item[data-asin="B000000002"]').click();
    await expect(sec.locator('.psm-textarea')).toHaveValue('テスト本棚だけのメモ');

    expect(errors).toEqual([]);
});

test('特殊本棚(すべて)から開くと編集UIは出さず案内を表示する', async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await page.locator('#bookshelf .book-item[data-asin="B000000002"]').click();

    const sec = page.locator('#book-detail-pane .plugin-detail-section[data-plugin-section="per-shelf-memo"]');
    await expect(sec).toBeVisible();
    await expect(sec.locator('.pds-empty')).toContainText('本棚を開いた状態');
    await expect(sec.locator('.psm-textarea')).toHaveCount(0);
    expect(errors).toEqual([]);
});
