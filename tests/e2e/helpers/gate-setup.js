// 門のE2E (テスト名に `@gate` と観測点ID・イシュー#583) の「前提」の置き場。
// 書き方の決まりは tests/e2e/gate/README.md。前提の区間 (test.step('前提: …')) は、この helpers/ の関数の
// 呼び出しだけで組む (lint:e2e-gate が確かめる)。ここでは内部に触ってよいが、アプリ自身のファイル
// (index.html・js/・css/・sw.js) への通信は差し替えない = 本物のコードを通す。
//
// 使う順番: seedLibraryForTest → bootAppForTest → stubStorageForTest (→ 必要なら sync.js の mockSyncReady)。
// seed は「アプリが読み込まれる前」に入れる必要があり、stub は「読み込まれた後」でないと差し替える相手が無い。
//
// ほかの組み合わせ (イシュー#590 で追加。どれも「開く前」に呼ぶ物を先に、「開いた後」に呼ぶ物を後に):
// - 初回の状態 (蔵書0・保存先を決めていない): 何も入れずに bootAppForTest だけ。
// - iPhone 相当 (フォルダを選べない端末): emulatePhoneCapabilitiesForTest → bootAppForTest
//   (画面の大きさ・タッチは spec 側の test.use で決める)。
// - 再読込で設定が残るかを見る: seedLibraryOnceForTest → bootAppForTest (stubStorageForTest は呼ばない =
//   保存を止めない。seedLibraryForTest は読み込みのたびに入れ直すので、保存した設定を上書きしてしまう)。
// - 多数の蔵書で測る (J3-5): seedManyBooksForTest → bootAppForTest → throttleCpuForTest。
// - 保存先のフォルダにつなぐ: gate-local.js の mockFolderPickerForTest → bootAppForTest →
//   connectLocalFolderForTest (→ 本が要るなら fillFolderWithBooksForTest)。
// - 外部の応答の模擬は前提の最初に呼ぶ: GitHub は gate-github.js、Amazon は gate-amazon.js。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), 'utf-8');

/** 蔵書と利用者データ (tests/fixtures の見本・「フィクスチャの本 1」ほか) を入れ、保存先の方式をローカルにしておく。
 * アプリを開く前に呼ぶ。
 * @param {import('@playwright/test').Page} page */
export async function seedLibraryForTest(page) {
    await page.addInitScript(([userData, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixture('fixture-userdata.json'), fixture('fixture-library.json')]);
}

/** アプリを開き、蔵書の読み込みが終わるまで待つ。
 * @param {import('@playwright/test').Page} page */
export async function bootAppForTest(page) {
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
}

/** 保存先 (ローカルのフォルダ) の読み書きをメモリに置き換える。ヘッドレスではフォルダを選べないための模擬で、
 * 保存→読み直しはメモリの中で成り立つ。ハブのログインボタンの描画 (外部の Google のスクリプト) も止める。
 * アプリを開いた後に呼ぶ。
 * @param {import('@playwright/test').Page} page */
export async function stubStorageForTest(page) {
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        const mem = new Map();
        const adapter = window.bookshelf.storage.adapter;
        adapter.readJSON = async (p) => (mem.has(p) ? JSON.parse(JSON.stringify(mem.get(p))) : null);
        adapter.writeJSON = async (p, d) => { mem.set(p, JSON.parse(JSON.stringify(d))); };
        adapter.readText = async (p) => (mem.has(p) ? mem.get(p) : null);
        adapter.writeText = async (p, t) => { mem.set(p, t); };
        if (window.HubAuth) window.HubAuth.renderSignInButton = () => {};
    });
}

/** iPhone 相当の端末の能力にする = フォルダを選ぶ API (showDirectoryPicker) が無い状態でアプリを開く。
 * iOS Safari・Android のブラウザにはこの API が無い。chromium の携帯エミュレーション (isMobile・hasTouch) では
 * 残ってしまうため、ここで消す (イシュー#590 J1-2)。画面の大きさ・タッチは spec 側の test.use で決める。
 * アプリを開く前に呼ぶ。
 * @param {import('@playwright/test').Page} page */
export async function emulatePhoneCapabilitiesForTest(page) {
    await page.addInitScript(() => {
        try { delete window.showDirectoryPicker; } catch (_) { /* 消せない時は下で隠す */ }
        try { delete Window.prototype.showDirectoryPicker; } catch (_) { /* 同上 */ }
    });
}

/** seedLibraryForTest と同じ蔵書を入れるが、最初に開いた時の1回だけ入れる (再読込では入れ直さない)。
 * 再読込のあとも、利用者が変えた設定 (並び順など・localStorage に保存される) が残るかを見る時に使う
 * (seedLibraryForTest は読み込みのたびに入れ直すので、変えた設定を上書きしてしまう)。アプリを開く前に呼ぶ。
 * @param {import('@playwright/test').Page} page */
export async function seedLibraryOnceForTest(page) {
    await page.addInitScript(([userData, library]) => {
        if (sessionStorage.getItem('gate-seeded')) return;
        sessionStorage.setItem('gate-seeded', '1');
        localStorage.setItem('virtualBookshelf_userData', userData);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [fixture('fixture-userdata.json'), fixture('fixture-library.json')]);
}

/** 多数の蔵書 (既定 913冊) を入れる。中身は tests/e2e/sort-perf-budget.spec.js と同じ作り方
 * (書名「…物語 第n話 〜…〜」・購入日はばらばら・並び順は購入日の新しい順)。J3-5 の条件を sort-perf と揃えるため。
 * 最初に開いた時の1回だけ入れる。アプリを開く前に呼ぶ。
 * @param {import('@playwright/test').Page} page
 * @param {number} [n] */
export async function seedManyBooksForTest(page, n = 913) {
    const TITLE_PARTS = ['ことばの', 'それから', '夜明けの', '静かな', '遠い街の', '記憶の中の', '小さな', '最後の'];
    const AUTHOR_PARTS = ['山田', '佐藤', '鈴木', '高橋', '田中', '渡辺'];
    const books = Array.from({ length: n }, (_, i) => {
        const k = i + 1;
        return {
            asin: `B${String(k).padStart(9, '0')}`,
            title: `${TITLE_PARTS[k % TITLE_PARTS.length]}物語 第${k}話 〜${'あいうえお'.repeat(2)}〜`,
            authors: `${AUTHOR_PARTS[k % AUTHOR_PARTS.length]}${AUTHOR_PARTS[(k * 7) % AUTHOR_PARTS.length]}`,
            acquiredTime: 1700000000000 + ((k * 104729) % n) * 1000,
            readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000 + k * 1000,
        };
    });
    const library = { books, metadata: { totalBooks: books.length } };
    const userData = {
        bookshelves: [{ id: 'all', internalId: 'fixallgate', name: 'すべての本', iconName: 'library', isSpecial: true, books: books.map((b) => b.asin), notes: {} }],
        notes: {}, settings: { sortOrder: 'acquiredTime', sortDirection: 'desc' }, bookOrder: {}, stats: {}, version: '2.0',
    };
    await page.addInitScript(([u, l]) => {
        if (sessionStorage.getItem('gate-seeded')) return;
        sessionStorage.setItem('gate-seeded', '1');
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), JSON.stringify(library)]);
}

/** CPU を rate 倍遅くする (Chrome DevTools の CPU スロットリング)。sort-perf-budget.spec.js と同じ6倍が既定。
 * chromium だけで使える。アプリを開いた後に呼ぶ。
 * @param {import('@playwright/test').Page} page
 * @param {number} [rate] */
export async function throttleCpuForTest(page, rate = 6) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

/** ページの中で、操作から次の描画までの時間を測って、画面の隠し要素 #gate-timings の data 属性に書き出す (J3-5)。
 * 測る区間は tests/e2e/sort-perf-budget.spec.js の tFrame (操作 → rAF → rAF) に近い = 操作のイベントが届いた時から、アプリの処理が
 * 終わって次の描画 (requestAnimationFrame → setTimeout 0) までの ms。テスト側の時計 (Playwright の往復が乗る) を
 * 使わないので、BUDGET と同じ物差しで比べられる。 再読込のあとも測れるよう、アプリを開く前に呼ぶ (addInitScript)。書き出す属性 (回数も書く):
 * - 並び順 (#sort-order) を変えた: data-gate-sort-order-ms・data-gate-sort-order-count
 * - 昇順・降順 (#sort-direction) を押した: data-gate-sort-direction-ms・data-gate-sort-direction-count
 * - 一覧の本 (#bookshelf .book-item) を押した (押した時からアプリが click を処理して次の描画まで): data-gate-open-detail-ms・data-gate-open-detail-count
 * テストは、記録が済むのを「#gate-timings[data-gate-<名前>-count="<回数>"] が1つ見つかる」(toHaveCount) で待つ。
 * expect(…).toHaveAttribute では待たない: 913冊・CPU 6倍の下では、その問い合わせがページを数秒塞ぎ、ここで測る値
 * そのものが遅れる (イシュー#629 で実測。toHaveCount・locator.getAttribute では塞がらない)。
 * @param {import('@playwright/test').Page} page */
export async function recordInPageTimingsForTest(page) {
    await page.addInitScript(() => {
        const rootOf = () => {
            let root = document.getElementById('gate-timings');
            if (!root) { root = document.createElement('div'); root.id = 'gate-timings'; root.hidden = true; document.body.appendChild(root); }
            return root;
        };
        // 記録先は、アプリを開く時に作っておく (テストが待つ相手が、最初から在る要素になる)
        if (document.body) rootOf(); else document.addEventListener('DOMContentLoaded', rootOf, { once: true });
        const record = (name, t0) => {
            requestAnimationFrame(() => setTimeout(() => {
                const root = rootOf();
                root.setAttribute(`data-gate-${name}-ms`, String(Math.round(performance.now() - t0)));
                const n = Number(root.getAttribute(`data-gate-${name}-count`) || '0') + 1;
                root.setAttribute(`data-gate-${name}-count`, String(n));
            }, 0));
        };
        // capture で受ける = アプリの処理より先に時刻を取る
        document.addEventListener('change', (e) => {
            if (e.target && e.target.id === 'sort-order') record('sort-order', performance.now());
        }, true);
        document.addEventListener('click', (e) => {
            const el = e.target instanceof Element ? e.target : null;
            if (el && el.closest('#sort-direction')) record('sort-direction', performance.now());
        }, true);
        // 本を押した時は、押した時 (pointerdown) から、アプリが click を処理して次の描画までを測る。押したあと一覧が
        // 描き直されて click の的が一覧から外れることがあるので、click では的を見ず、直前の pointerdown で決める
        let pressedAt = null;
        document.addEventListener('pointerdown', (e) => {
            const el = e.target instanceof Element ? e.target : null;
            pressedAt = el && el.closest('#bookshelf .book-item') ? performance.now() : null;
        }, true);
        document.addEventListener('click', () => {
            if (pressedAt === null) return;
            const t0 = pressedAt;
            pressedAt = null;
            record('open-detail', t0);
        }, true);
    });
}
