// 監査の巡回でアプリを起動する (docs/audit/machine-checks.md §2・§4)。
// 固定データを localStorage に入れ、時刻を固定し、外部への通信を止める (型は tests/visual/screens.spec.js と同じ)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pinEnvironment, assertAuditFont, FIXED_TIME } from './boot.js';
import { mockSyncReady } from '../e2e/helpers/sync.js';
import { genScale } from '../perf/fixtures/gen-scale.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, '../fixtures', name), 'utf-8');

// 長い名前のデータ: 標準のデータの ID はそのままに、題・著者・本棚名・短文メモを長くし、本棚を3つ (2段の入れ子) にする
function longNames() {
    const library = JSON.parse(read('fixture-library.json'));
    const userData = JSON.parse(read('fixture-userdata.json'));
    library.books.forEach((book, k) => {
        // 題は全角120字。1冊目は空白の無い英数40字を含む
        book.title = k === 0
            ? `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD${'長い題名の見本'.repeat(12)}`
            : `${'とても長い題名の本の見本です'.repeat(9).slice(0, 119)}${k}`;
        book.authors = Array.from({ length: 10 }, (_, n) => `名前の長い著者その${n + 1}`).join(', ');
    });
    const longShelfName = '名前がとても長い本棚の見本です'.repeat(3).slice(0, 40);
    for (const shelf of userData.bookshelves) {
        if (shelf.isSpecial) continue;
        shelf.name = longShelfName;
        shelf.description = '説明も長い本棚の見本です。'.repeat(8);
    }
    userData.bookshelves.push(
        { id: 'longchild', internalId: 'longchild01', name: `子の${longShelfName}`.slice(0, 40), iconName: 'library', description: '', parent: 'fixshelf01', isPublic: false, books: ['B000000001', 'B000000002'], notes: {}, createdAt: '2026-06-12T00:00:00.000Z' },
        { id: 'longother', internalId: 'longother01', name: `別の${longShelfName}`.slice(0, 40), iconName: 'library', description: '', parent: 'fixall001', isPublic: false, books: ['B000000004'], notes: {}, createdAt: '2026-06-12T00:00:00.000Z' },
    );
    for (const note of Object.values(userData.notes || {})) {
        if (typeof note.memo === 'string') note.memo = '短文メモが長い場合の見本です。'.repeat(20);   // 全角300字
    }
    return { userData: JSON.stringify(userData), library: JSON.stringify(library) };
}

// 本が0冊のデータ (初回の案内・空の本棚)
function emptyData() {
    const library = JSON.parse(read('fixture-library.json'));
    const userData = JSON.parse(read('fixture-userdata.json'));
    library.books = [];
    userData.bookshelves = userData.bookshelves.filter((shelf) => shelf.id === 'all');
    userData.bookshelves[0].books = [];
    userData.notes = {};
    return { userData: JSON.stringify(userData), library: JSON.stringify(library) };
}

// データ (docs/audit/machine-checks.md §2)。anchors は、開き方が使う本棚と本の ID
const DATA = {
    standard: () => ({ userData: read('fixture-userdata.json'), library: read('fixture-library.json'), anchors: { shelfId: 'fixshelf', asin: 'B000000002' } }),
    many: () => {
        const scale = genScale({ shelves: 12, perShelf: 130 });   // 本780冊・本棚12
        return { userData: JSON.stringify(scale.userData), library: JSON.stringify(scale.library), anchors: { shelfId: 'shelf1', asin: 'B000000002' } };
    },
    long: () => ({ ...longNames(), anchors: { shelfId: 'fixshelf', asin: 'B000000002' } }),
    empty: () => ({ ...emptyData(), anchors: {}, empty: true }),
};
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** ダーク = 標準プラグイン dark-theme を有効にした状態 (tests/e2e/ux-u4-contrast.spec.js と同じ入れ方) */
async function enableDarkTheme(page) {
    await page.evaluate(async () => {
        const mod = await import('/plugins-sample/dark-theme/index.js');
        const api = window.bookshelf.pluginAPI.forPlugin('dark-theme');
        mod.activate(api, { id: 'dark-theme' });
        localStorage.setItem('plugin-dark-theme:on', '1');
        document.body.classList.add('plugin-dark');
    });
}

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/**
 * アプリを起動し、開き方に渡す文脈 { data, theme, anchors } を返す。
 * ua: 'ios' は、起動の時にスマホと判定された時だけ出る画面 (スマホの設定案内バナー) のための指定。
 * UA を iPhone にし、showDirectoryPicker を無くす (tests/e2e/ux-h-series.spec.js の asMobile と同じ型)
 */
export async function bootApp(page, { data = 'standard', theme = 'light', ua = null } = {}) {
    const { userData, library, anchors, empty } = DATA[data]();
    await page.clock.install({ time: FIXED_TIME });
    if (ua === 'ios') {
        await page.addInitScript((value) => {
            Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => value });
            try { delete window.showDirectoryPicker; } catch (_) { /* 無ければそのまま */ }
            try { delete Object.getPrototypeOf(window).showDirectoryPicker; } catch (_) { /* 無ければそのまま */ }
        }, IOS_UA);
    }
    // test-base.js が差し替える表紙のホストは images-na だけなので、もう1つのホストもここで固定の画像にする
    await page.route('https://m.media-amazon.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG }));
    // GIS の外部読込を避けるためサインインボタン描画をスタブ化 (visual と同じ)
    await page.addInitScript(() => {
        window.addEventListener('DOMContentLoaded', () => {
            if (window.HubAuth) window.HubAuth.renderSignInButton = (el) => { if (el) el.dataset.stub = '1'; };
        });
    });
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [userData, library]);
    await page.goto('index.html');
    await page.waitForFunction((wantBooks) => window.bookshelf && window.bookshelf.userData
        && (!wantBooks || (window.bookshelf.books || []).length > 0), !empty);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    if (theme === 'dark') await enableDarkTheme(page);
    await pinEnvironment(page);
    await assertAuditFont(page);
    return { data, theme, anchors };
}

/** 公開(記事)系の画面で使う: 保存先の実 I/O をメモリへ差し替え、未接続ガードを外す (visual と同じ型) */
export async function mockPublishAdapter(page) {
    await page.evaluate(() => {
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (path) => (mem.has(path) ? JSON.parse(JSON.stringify(mem.get(path))) : null);
        adapter.writeJSON = async (path, data) => { mem.set(path, JSON.parse(JSON.stringify(data))); };
    });
    await mockSyncReady(page, true);
}
