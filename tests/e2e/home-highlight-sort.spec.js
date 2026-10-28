// イシュー#398: ホームの本棚ハイライト (_renderBookshelfHighlights → _renderBookshelfCard) が
// この端末の並び順の設定 (#387 sortOrder/sortDirection) に合わせて並ぶことを固定する。
// 以前は userData.bookOrder (ドラッグで決めた順) があれば sortOrder を無視して無条件にそれを使い、
// 並び順をタイトル順/取得日順に変えてもハイライトだけ古い順のまま変わらなかった (ハヘロ報告 10/29)。
//
// シード/起動は tests/e2e/sort-persist.spec.js の seed()/boot() と同じ型 (同期先 adapter を
// 偽物に差し替えて実ネットワークに出ない・switchBookshelf('all') まで進める)。本テストは
// 永続化ではなく「並び順設定→ハイライトの見た目」の経路を見るため push/reload は行わない。
//
// 2026-10-29 ②指摘で2点修正:
//  (1) firstAlt() が <img alt> を読んでいたが、test-base.js の共通fixtureが
//      images-na.ssl-images-amazon.com への表紙リクエストを1x1の透明PNGで応答するため、
//      _setupCoverFallback (naturalWidth<=1 を「読み込み失敗」とみなす既存の仕様どおりの挙動)
//      が load イベントで即座に <img> をプレースホルダdivへ差し替えてしまい、alt を読むタイミング
//      次第で失敗/タイムアウトしていた(実行環境依存の見かけ上のflakeに見えたが、原因はテスト側が
//      表紙読み込みレースに弱い作りだったこと)。<img>かプレースホルダdivかに関わらず残る外側の
//      .bookshelf-preview-book に data-asin を持たせる形にアプリ側を直し(js/bookshelf.js
//      _renderBookshelfCard)、asin で順序を確認するようにした。
//  (2) 1回読みの getAttribute を素の expect().toBe() で比べず、expect.poll で安定を待つ
//      (プロジェクト既定の型・publish系e2eのcommitBatch待ちと同じ考え方)。
import { test, expect } from './helpers/test-base.js';

// タイトルは登録順 (idx 昇順) と逆アルファベットにする (idx0='L' … idx11='A')。
// 「タイトル昇順 = idx降順」「登録順(旧実装の既定) ≠ タイトル順」を区別できるようにするため。
const N = 12;
const asin = (i) => `B0SORTA${String(i).padStart(3, '0')}`;
const titleOf = (i) => String.fromCharCode('L'.charCodeAt(0) - i); // idx0:'L' .. idx11:'A'
const BOOKS = Array.from({ length: N }, (_, i) => ({
    asin: asin(i), title: titleOf(i), authors: `著者${i}`,
    acquiredTime: 1700000000000 + i * 1000, // idxが大きいほど新しい(値が大きい)
    readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000,
}));
const ALL_ASINS = BOOKS.map((b) => b.asin);
const SHELF_A_ASINS = ALL_ASINS.slice(0, 10); // 10冊(>8)の通常本棚。idx0..9 = titleOf 'L'..'C'

const library = { books: BOOKS, metadata: { lastImportDate: 1700000000000, totalBooks: N } };
function makeUserData() {
    return {
        bookshelves: [
            { id: 'all', name: 'すべての本', isSpecial: true, books: ALL_ASINS.slice(), internalId: 'all' },
            { id: 'shelfA', name: '棚A', isSpecial: false, books: SHELF_A_ASINS.slice(), internalId: 'shelfA' },
        ],
        notes: {}, settings: { sortOrder: 'title', sortDirection: 'asc' }, bookOrder: {}, stats: {}, version: 2,
    };
}

async function seed(page, userData, lib = library) {
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), JSON.stringify(lib)]);
}

// sort-persist.spec.js の boot() と同じ要点だけ (同期アダプタを無害化し switchBookshelf('all') まで進める)。
async function boot(page) {
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0);
    await page.evaluate(() => {
        const bs = window.bookshelf; const a = bs.storage.adapter;
        a.beginBatch = () => {}; a.addBatchEntry = () => {}; a.addBatchDelete = () => {}; a.discardBatch = () => {};
        a.commitBatch = async () => ({}); a.fileExists = async () => false; a.readJSON = async () => null;
        a.writeJSON = async () => {}; a.writeText = async () => {};
        bs.storage.detectFormat = async () => 'new';
        bs.syncMethod = 'hub'; bs._isSyncReady = () => true; bs._ensureFreshGitHubToken = async () => true; bs.obsidianDirHandle = null;
        bs.switchBookshelf('all');
    });
}

// #sort-order は絞り込みパネル (fp-select) の中にあり既定では畳まれている＝change イベントを直接送る
// (ハンドラは同じ・sort-persist.spec.js と同じ型)。
const setSortOrder = (page, v) => page.evaluate((v) => {
    const s = document.getElementById('sort-order'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
const toggleSortDirection = (page) => page.evaluate(() => document.getElementById('sort-direction').click());
const goHome = (page) => page.click('.sidebar-brand');

// 表紙<img>は読み込み結果次第でプレースホルダdivに差し替わるため alt は見ない。
// 外側の .bookshelf-preview-book (data-asin) で先頭の本を判定する。
const firstAsin = (page, shelfId) => page.locator(`.bookshelf-preview[data-bookshelf-id="${shelfId}"] .bookshelf-preview-books .bookshelf-preview-book`).first().getAttribute('data-asin');
// 1回読みで比べない(dashboard.render()の再描画完了前の値を掴むことがある)。expect.pollで安定を待つ。
const expectFirstAsin = (page, shelfId, want) => expect.poll(() => firstAsin(page, shelfId), { timeout: 10000 }).toBe(want);

test.describe('#398 ホームの本棚ハイライトが並び順の設定に合う', () => {
    test('タイトル昇順(既定)：all本棚は先頭8冊の最小タイトルが先頭、棚Aもその本棚の中で先頭になる', async ({ page }) => {
        await seed(page, makeUserData());
        await page.goto('index.html');
        await boot(page);
        await goHome(page);
        // all: idx11..4 が昇順タイトル上位8件 → 先頭は idx11 ('A')
        await expectFirstAsin(page, 'all', asin(11));
        // shelfA: idx0..9 の中でタイトル最小は idx9 ('C')
        await expectFirstAsin(page, 'shelfA', asin(9));
    });

    test('タイトル降順に変えてホームへ戻ると反映される', async ({ page }) => {
        await seed(page, makeUserData());
        await page.goto('index.html');
        await boot(page);
        await toggleSortDirection(page); // asc→desc
        await goHome(page);
        // all: 降順の先頭は idx0 ('L')
        await expectFirstAsin(page, 'all', asin(0));
    });

    test('取得日(acquiredTime)に変えてホームへ戻ると反映される', async ({ page }) => {
        await seed(page, makeUserData());
        await page.goto('index.html');
        await boot(page);
        await setSortOrder(page, 'acquiredTime'); // 既定asc → idxが大きいほど新しい(値大)なので昇順先頭はidx0
        await goHome(page);
        await expectFirstAsin(page, 'all', asin(0));
        await toggleSortDirection(page); // desc → 先頭はidx11(最新)
        await goHome(page);
        await expectFirstAsin(page, 'all', asin(11));
    });

    test('自由な並び(custom・bookOrder)の時はbookOrderを使う(sortOrderの値は見ない)', async ({ page }) => {
        const ud = makeUserData();
        ud.settings.sortOrder = 'custom';
        ud.bookOrder = { all: [asin(5), asin(0), asin(11)] }; // タイトル順/取得日順どちらとも異なる並び
        await seed(page, ud);
        await page.goto('index.html');
        await boot(page);
        await goHome(page);
        await expectFirstAsin(page, 'all', asin(5));
    });

    test('ホームを表示中に並び順を変えた場合も、その場で表示が更新される', async ({ page }) => {
        await seed(page, makeUserData());
        await page.goto('index.html');
        await boot(page);
        await goHome(page);
        await expectFirstAsin(page, 'all', asin(11)); // タイトル昇順(既定)の先頭
        // ホームに居るまま並び順を変える(この画面構成では並び順の操作UIはホームから開けないため、
        // UIハンドラが呼ぶ _saveSortPrefs を直接呼ぶ。ナビゲーションは一切行わない=「表示中に変えた」を保つ)。
        await page.evaluate(() => {
            const bs = window.bookshelf;
            bs.sortOrder = 'acquiredTime'; bs.sortDirection = 'desc';
            bs._saveSortPrefs();
        });
        await expectFirstAsin(page, 'all', asin(11)); // idx11 = 最新 = acquiredTime降順の先頭。たまたまtitle側と同一idx
        // 区別のため、titleでは先頭にならないはずのacquiredTime昇順にも変えて確認する
        await page.evaluate(() => {
            const bs = window.bookshelf;
            bs.sortOrder = 'acquiredTime'; bs.sortDirection = 'asc';
            bs._saveSortPrefs();
        });
        await expectFirstAsin(page, 'all', asin(0)); // idx0 = 最古 = acquiredTime昇順の先頭 (直前との差分で検証済み)
    });

    test('913冊規模でも、並び替え変更1回あたり全蔵書の並べ替えは本棚数に比例しない(キャッシュが効く)', async ({ page }) => {
        const BIG_N = 913;
        const bigAsin = (i) => `B0BIG${String(i).padStart(5, '0')}`;
        const bigBooks = Array.from({ length: BIG_N }, (_, i) => ({
            asin: bigAsin(i), title: `書名${i}`, authors: `著者${i}`,
            acquiredTime: 1700000000000 + i * 1000, readStatus: 'READ', productImage: '', source: 'fixture', addedDate: 1700000000000,
        }));
        const bigAsins = bigBooks.map((b) => b.asin);
        // 6本棚(all含む)に分割。本棚ごとに全件ソートしていたら本棚数倍のコストになるはず。
        const SHELF_COUNT = 5;
        const shelves = [{ id: 'all', name: 'すべての本', isSpecial: true, books: bigAsins.slice(), internalId: 'all' }];
        for (let s = 0; s < SHELF_COUNT; s++) {
            shelves.push({ id: `s${s}`, name: `棚${s}`, isSpecial: false, books: bigAsins.filter((_, i) => i % SHELF_COUNT === s), internalId: `s${s}` });
        }
        const bigUserData = { bookshelves: shelves, notes: {}, settings: { sortOrder: 'title', sortDirection: 'asc' }, bookOrder: {}, stats: {}, version: 2 };
        await seed(page, bigUserData, { books: bigBooks, metadata: { lastImportDate: 1700000000000, totalBooks: BIG_N } });
        await page.goto('index.html');
        await boot(page);
        await goHome(page);

        // 並び順を変えてから、この1回のホーム再描画で _bookCompareFn (全蔵書ソートの比較関数の構築)
        // が何回呼ばれるかを数える。6本棚(all+5)あるが、キャッシュが効いていれば1回だけのはず
        // (本棚ごとに全件ソートし直すなら6回に増える)。
        await page.evaluate(() => {
            const bs = window.bookshelf;
            window.__cmpCalls = 0;
            const orig = bs._bookCompareFn.bind(bs);
            bs._bookCompareFn = (...args) => { window.__cmpCalls++; return orig(...args); };
        });
        const t0 = Date.now();
        await page.evaluate(() => {
            const bs = window.bookshelf;
            bs.sortOrder = 'acquiredTime'; bs.sortDirection = 'desc';
            bs._saveSortPrefs(); // ホーム表示中なので dashboard.render() が即走る
        });
        const elapsedMs = Date.now() - t0;
        const cmpCalls = await page.evaluate(() => window.__cmpCalls);
        expect(cmpCalls).toBe(1); // 本棚数(6)に比例していない
        expect(elapsedMs).toBeLessThan(3000); // 緩い上限(CI変動を許容)。本棚ごとに913件再ソートするほど重くはならない

        // 正しさも確認: all本棚の先頭は最新(idx912)
        await expectFirstAsin(page, 'all', bigAsin(912));
    });
});
