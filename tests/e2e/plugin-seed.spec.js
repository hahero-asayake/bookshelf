// 標準機能5個の初回シード・欠損復元 (ADR-059) の E2E: ensureStandardPlugins() を「アプリ起動」経由で通す。
//
// 全新規ユーザーが必ず通る経路 (起動 → 同期先接続済み → ensureStandardPlugins → loadEnabledPlugins) なので、
// ここが壊れると新規ユーザー全員の標準機能 (作者/シリーズ分類・ダークテーマ・ハイライト・メモひな形) が消える。
// 関数の直呼びでは「起動時にその順序で呼ばれること」「シード直後の同じ起動サイクルで読み込まれること」を
// 担保できないため、実物の HubStorageAdapter でアプリを起動し、ハブの通信だけをモックする。
//
// ハブの私的データ API (js/hub-adapter.js 冒頭の契約) を Node 側の Map で再現する。状態が Node 側にあるので
// ページをリロードしても残る＝「2回目以降の起動」(欠損復元・既存ファイルへの非破壊) を再現できる。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const HUB = 'https://hub.example/api';
const STANDARD_IDS = ['author-grouping', 'dark-theme', 'highlights-builtin', 'series-grouping', 'memo-templates'];
const SORTED_STANDARD_IDS = [...STANDARD_IDS].sort();

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
// 配布元 (リポジトリ同梱・本番でも静的配信される plugins-sample/) の実ファイル
const sampleFile = (id, name) => readFileSync(join(here, '../../plugins-sample', id, name), 'utf8');

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,PUT,POST,DELETE,HEAD,OPTIONS',
    'access-control-expose-headers': 'ETag'
};

/** ハブの私的データ API のモック。store = path → 本文、writes = 書き込みログ (put/delete の順) */
async function installMockHub(page) {
    const store = new Map();
    const etags = new Map();
    const writes = [];
    let seq = 0;
    const put = (path, text) => { store.set(path, text); etags.set(path, `"e${++seq}"`); writes.push({ op: 'put', path }); };
    const del = (path) => { store.delete(path); etags.delete(path); writes.push({ op: 'delete', path }); };

    await page.route(`${HUB}/**`, async (route) => {
        const req = route.request();
        const method = req.method();
        const url = new URL(req.url());
        const rel = decodeURIComponent(url.pathname.replace(/^\/api\//, ''));
        const json = (status, body) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });

        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        if (rel === 'usage') return json(200, { plan: 'free', usedBytes: 0, quotaBytes: 100 * 1048576 });

        if (rel === 'data/batch' && method === 'POST') {
            for (const e of JSON.parse(req.postData()).entries) {
                if (e.op === 'delete') del(e.path); else put(e.path, e.content);
            }
            return json(200, { ok: true });
        }
        if (rel.startsWith('data/')) {
            const path = rel.slice('data/'.length);
            if (url.searchParams.get('list') === '1') {
                const prefix = `${path.replace(/\/+$/, '')}/`;
                const files = new Set();
                const dirs = new Set();
                for (const p of store.keys()) {
                    if (!p.startsWith(prefix)) continue;
                    const rest = p.slice(prefix.length);
                    const i = rest.indexOf('/');
                    if (i < 0) files.add(rest); else dirs.add(rest.slice(0, i));
                }
                return json(200, { files: [...files], dirs: [...dirs] });
            }
            if (method === 'PUT') {
                put(path, req.postData() || '');
                return route.fulfill({ status: 200, headers: { ...CORS, ETag: etags.get(path) }, body: '' });
            }
            if (method === 'DELETE') { del(path); return route.fulfill({ status: 204, headers: CORS }); }
            if (method === 'GET' || method === 'HEAD') {
                if (!store.has(path)) return route.fulfill({ status: 404, headers: CORS, body: '' });
                return route.fulfill({ status: 200, headers: { ...CORS, ETag: etags.get(path), 'content-type': 'text/plain; charset=utf-8' }, body: method === 'HEAD' ? '' : store.get(path) });
            }
        }
        return route.fulfill({ status: 404, headers: CORS, body: '' });
    });
    return { store, writes };
}

/** ハブ接続済みの状態でアプリを起動する。空のハブでは「新規データで初期化しますか？」の confirm が出る (承諾する) */
async function bootWithHub(page) {
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    const mock = await installMockHub(page);
    await page.addInitScript((hub) => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'hub',
            hub: { apiBase: hub, key: 'hk_test', uid: 'u1', email: 'seed@example.com' }
        }));
    }, HUB);
    await page.goto('/index.html');
    return { ...mock, dialogs };
}

const loadedPluginIds = (page) => page.evaluate(() => {
    const l = window.bookshelf && window.bookshelf.pluginLoader;
    return l ? [...l.loaded.keys()].sort() : [];
});

/** store 内の plugins/ 配下にあるプラグイン id (ディレクトリ名) の一覧 */
const seededIds = (store) => [...new Set([...store.keys()].filter((k) => k.startsWith('plugins/')).map((k) => k.split('/')[1]))].sort();

test.describe('標準プラグインの初回シード・欠損復元 (起動経路・ADR-059)', () => {
    test('新規ユーザー: 起動すると標準5個が plugins/ へ書き込まれ、.seed に配布時ハッシュが記録され、同じ起動で読み込まれる', async ({ page }) => {
        const { store, dialogs } = await bootWithHub(page);

        // 同じ起動サイクルで読み込まれる (ensureStandardPlugins が loadEnabledPlugins より先に走る)
        await expect.poll(() => loadedPluginIds(page), { timeout: 30_000 }).toEqual(SORTED_STANDARD_IDS);
        expect(dialogs.length, '空のハブでは初期化の確認が1回だけ出る').toBe(1);
        expect(dialogs[0]).toContain('新規データで初期化');

        // (a) 標準5個だけが書き戻る (標準外の plugins-sample/reading-goal 等は入らない)
        expect(seededIds(store)).toEqual(SORTED_STANDARD_IDS);
        for (const id of STANDARD_IDS) {
            const manifestText = sampleFile(id, 'manifest.json');
            const indexText = sampleFile(id, 'index.js');
            expect(store.get(`plugins/${id}/manifest.json`), `${id}: manifest.json が配布元と一致`).toBe(manifestText);
            expect(store.get(`plugins/${id}/index.js`), `${id}: index.js が配布元と一致`).toBe(indexText);

            // (c) .seed に version と各ファイルの SHA-256 (16進64桁) が記録される
            const seed = JSON.parse(store.get(`plugins/${id}/.seed`));
            expect(seed.version, `${id}: .seed の version`).toBe(JSON.parse(manifestText).version);
            expect(seed.files['manifest.json'], `${id}: manifest.json のハッシュ`).toMatch(/^sha256:[0-9a-f]{64}$/);
            expect(seed.files['index.js'], `${id}: index.js のハッシュ`).toMatch(/^sha256:[0-9a-f]{64}$/);
            expect(seed.files['manifest.json']).toBe(`sha256:${sha256(manifestText)}`);
            expect(seed.files['index.js']).toBe(`sha256:${sha256(indexText)}`);
        }

        const failed = await page.evaluate(() => [...window.bookshelf.pluginLoader.failedToLoad.entries()]);
        expect(failed, '標準プラグインの読み込み失敗が無い').toEqual([]);
    });

    test('disabledPlugins に入れた標準プラグインはシードされず、それ以外は plugins/ が空でも書き戻る', async ({ page }) => {
        const { store, writes } = await bootWithHub(page);
        await expect.poll(() => loadedPluginIds(page), { timeout: 30_000 }).toEqual(SORTED_STANDARD_IDS);

        // アカウント側の状態を作る: plugins/ を空にし (新しい端末・空のプラグインフォルダ相当)、設定で標準2個を無効化しておく
        const DISABLED = ['dark-theme', 'memo-templates'];
        for (const k of [...store.keys()].filter((k) => k.startsWith('plugins/'))) store.delete(k);
        const settings = JSON.parse(store.get('private/settings.json'));
        settings.disabledPlugins = DISABLED;
        store.set('private/settings.json', JSON.stringify(settings, null, 2));
        writes.length = 0;

        await page.reload();
        const enabled = SORTED_STANDARD_IDS.filter((id) => !DISABLED.includes(id));
        // 読み込みまで終わっていれば、その前段の ensureStandardPlugins も完了している
        await expect.poll(() => loadedPluginIds(page), { timeout: 30_000 }).toEqual(enabled);
        expect(await page.evaluate(() => window.bookshelf.userData.settings.disabledPlugins), 'アプリが無効化リストを読めている').toEqual(DISABLED);

        // (b) 無効化した2個は書き込まれない・有効な3個は書き戻る
        expect(seededIds(store)).toEqual(enabled);
        expect(writes.filter((w) => DISABLED.some((id) => w.path.startsWith(`plugins/${id}/`))), '無効化した標準プラグインへの書き込みが無い').toEqual([]);
        for (const id of enabled) {
            expect(JSON.parse(store.get(`plugins/${id}/.seed`)).files['index.js'], `${id}: .seed が記録される`).toBe(`sha256:${sha256(sampleFile(id, 'index.js'))}`);
        }
    });

    test('一部欠損 (plugins/<id>/ ごと消えた) は復元され、在る標準プラグイン (ユーザー編集済み含む) には書き込まない', async ({ page }) => {
        const { store, writes } = await bootWithHub(page);
        await expect.poll(() => loadedPluginIds(page), { timeout: 30_000 }).toEqual(SORTED_STANDARD_IDS);

        // series-grouping を丸ごと消し、author-grouping の index.js はユーザーが編集した状態にする
        const EDITED = 'export function activate() { window.__editedAuthorGrouping = true; }\n';
        for (const k of [...store.keys()].filter((k) => k.startsWith('plugins/series-grouping/'))) store.delete(k);
        store.set('plugins/author-grouping/index.js', EDITED);
        const authorSeedBefore = store.get('plugins/author-grouping/.seed');
        writes.length = 0;

        await page.reload();
        await expect.poll(() => loadedPluginIds(page), { timeout: 30_000 }).toEqual(SORTED_STANDARD_IDS);

        // (a変形) 欠損した series-grouping だけが配布元どおり復元され、.seed も再記録される
        expect(store.get('plugins/series-grouping/manifest.json')).toBe(sampleFile('series-grouping', 'manifest.json'));
        expect(store.get('plugins/series-grouping/index.js')).toBe(sampleFile('series-grouping', 'index.js'));
        expect(JSON.parse(store.get('plugins/series-grouping/.seed')).files['index.js']).toBe(`sha256:${sha256(sampleFile('series-grouping', 'index.js'))}`);
        expect(writes.filter((w) => w.path.startsWith('plugins/')).map((w) => w.path).sort(), '書き込みは欠損した series-grouping の3ファイルだけ').toEqual([
            'plugins/series-grouping/.seed', 'plugins/series-grouping/index.js', 'plugins/series-grouping/manifest.json'
        ]);

        // 非破壊: 在るプラグインはユーザー編集ごと一切触らない (index.js も .seed も据え置き)
        expect(store.get('plugins/author-grouping/index.js')).toBe(EDITED);
        expect(store.get('plugins/author-grouping/.seed')).toBe(authorSeedBefore);
    });
});
