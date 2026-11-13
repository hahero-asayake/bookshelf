// 監査の巡回でアプリを起動する (docs/audit/machine-checks.md §2・§4)。
// tests/visual/screens.spec.js と同じ固定データを localStorage に入れ、時刻を固定し、外部への通信を止める。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pinEnvironment, assertAuditFont, FIXED_TIME } from './boot.js';
import { mockSyncReady } from '../e2e/helpers/sync.js';

const here = dirname(fileURLToPath(import.meta.url));
// データ3種 (標準・多数・長い名前) のうち、今あるのは標準だけ
const DATA = {
    standard: () => ({
        userData: readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8'),
        library: readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8'),
    }),
};
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

export async function bootApp(page, { data = 'standard' } = {}) {
    const { userData, library } = DATA[data]();
    await page.clock.install({ time: FIXED_TIME });
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
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    await pinEnvironment(page);
    await assertAuditFont(page);
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
