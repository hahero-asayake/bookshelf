// イシュー#594: 長文メモのファイル (private/books/<ASIN>__<題名>.md) が、本の削除・題名の変更・
// ASIN の変更のあとも保存先に取り残されないこと、題名や ASIN を変えてもメモが新しい名前で読めること。
// 3つの保存先 (Asayake ハブ・GitHub・ローカルフォルダ) で同じ3操作を流す回帰テスト
// (門の E2E には数えない。確認の対象が画面ではなく保存先の中身のため)。
//
// 保存先の模擬は tests/e2e/helpers/storage-fakes.js (イシュー#587)。状態は Node 側にあり、
// ページを再読込しても残る。題名・ASIN の変更とメモの読み書きは画面の操作で行う。
// 例外: 本の追加 (前提づくり) と本の削除は、アプリの処理 (addBookManually / deleteBook) を呼ぶ。
// 本の削除は、origin/main (66d9ac4) の画面に押せるボタンが無いため (js/screens/book-detail.js:393 の
// .delete-btn を描く箇所が無い)。deleteBook 自身の確認ダイアログ (confirm) は画面と同じく通す。
import { test, expect } from './helpers/test-base.js';
import { installFakeHub, FAKE_HUB_BASE, installFakeGitHub, FAKE_GITHUB, installFakeLocalFolder } from './helpers/storage-fakes.js';
import { openSettingsByClick } from './helpers/settings.js';
import { waitForBookMemoEditor, setBookMemoValue, getBookMemoValue } from './helpers/book-memo.js';
import { flushSyncNow } from './helpers/sync.js';

// 画面の操作が詰まった時に、テスト全体の制限時間 (60秒) まで待たずに落とす
test.use({ actionTimeout: 10_000 });

const ASIN = 'B0MEMO5941';
const NEW_ASIN = 'B0MEMO5942';
const TITLE = 'メモの本';
const NEW_TITLE = '題名を変えた本';
const BODY = 'MEMO-BODY-594 長文メモの本文';

const memoPath = (asin, title) => `private/books/${asin}__${title}.md`;

const confirmOk = async (page) => {
    const cfm = page.locator('.cfm-overlay');
    await cfm.waitFor({ state: 'visible' });
    await cfm.locator('.cfm-ok').click();
    await cfm.waitFor({ state: 'hidden' });
};

/** 保存先の library.json にある本 (asin → title) */
const remoteBooks = async (remote) => {
    const lib = await remote.readJSON('private/library.json');
    const books = lib && Array.isArray(lib.books) ? lib.books : [];
    return Object.fromEntries(books.map((b) => [b.asin, b.title]));
};

/** 保存先の private/books/ にあるファイル名の一覧 */
const remoteMemoFiles = async (remote) => (await remote.list('private/books')) || [];

// 起動の手順は tests/e2e/shelf-file-delete.spec.js (イシュー#587) と同じ
async function bootWithHub(page) {
    const hub = await installFakeHub(page);
    await page.addInitScript((apiBase) => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'hub',
            hub: { apiBase, key: 'hk_test', uid: 'u1', email: 'memo-file@example.com' }
        }));
    }, FAKE_HUB_BASE);
    await page.goto('index.html');
    await confirmOk(page);
    await expect.poll(() => hub.has('private/bookshelves/all.json')).toBe(true);
    return hub;
}

async function bootWithGitHub(page) {
    const gh = await installFakeGitHub(page);
    await page.addInitScript((cfg) => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'github',
            github: { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, basePath: '', token: 'ght_test' }
        }));
    }, FAKE_GITHUB);
    await page.goto('index.html');
    await confirmOk(page);
    await expect.poll(() => gh.has('private/bookshelves/all.json')).toBe(true);
    return gh;
}

async function bootWithLocalFolder(page) {
    const local = await installFakeLocalFolder(page);
    await page.addInitScript(() => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    });
    await page.goto('index.html');
    await openSettingsByClick(page, 'sync-section');
    await page.locator('#obsidian-sync-btn').click();
    await expect.poll(() => local.has('private/bookshelves/all.json'), { message: '選んだフォルダが初期化される' }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
    return local;
}

const BACKENDS = [
    { name: 'Asayake ハブ', boot: bootWithHub },
    { name: 'GitHub', boot: bootWithGitHub },
    { name: 'ローカルフォルダ', boot: bootWithLocalFolder }
];

/** 前提づくり: 手動追加の処理で本を1冊足し、保存先の library.json に届くまで待つ */
async function addBook(page, remote, asin, title) {
    // 保存の途中で足さない (保存中に足した本が保存先に届かないことがあった)
    await expect.poll(() => page.evaluate(() => !window.bookshelf._syncInProgress && !window.bookshelf._pendingSync),
        { message: '起動後の保存が終わっている' }).toBe(true);
    await page.evaluate(async ({ asin, title }) => {
        document.getElementById('manual-asin').value = asin;
        document.getElementById('manual-title').value = title;
        document.getElementById('manual-authors').value = 'テスト著者';
        await window.bookshelf.addBookManually();
    }, { asin, title });
    await expect.poll(() => page.evaluate((a) => window.bookshelf.books.some((b) => b.asin === a), asin), { message: `本 ${asin} がアプリに入る` }).toBe(true);
    // 追加後の保存は予約されるだけなので、保存をその場で走らせてから、保存先に届いたことを確かめて進む
    await flushSyncNow(page);
    await expect.poll(async () => (await remoteBooks(remote))[asin], { message: `本 ${asin} が保存先に届く` }).toBe(title);
}

/** 「すべての本」の一覧から本をクリックして、右の詳細を開く */
async function openDetail(page, asin) {
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await page.locator(`#bookshelf .book-item[data-asin="${asin}"]`).click();
    await expect(page.locator('body')).toHaveClass(/book-detail-pinned/);
}

/** 詳細の「長文メモを書く/開く」からアプリ内エディタを開き、いまの本文を返す (閉じずに返す) */
async function openMemoFromDetail(page, asin) {
    await openDetail(page, asin);
    await page.locator(`#book-detail-pane .memo-file-btn[data-asin="${asin}"]`).click();
    await waitForBookMemoEditor(page);
    return getBookMemoValue(page);
}

/** 詳細から長文メモを書き、完了 (Esc＝保存して閉じる) で保存して、保存先にファイルが届くまで待つ */
async function writeMemo(page, remote, asin, title) {
    await openMemoFromDetail(page, asin);
    await setBookMemoValue(page, BODY);
    await page.keyboard.press('Escape');
    await expect.poll(() => remote.has(memoPath(asin, title)), { message: `${memoPath(asin, title)} が保存先に書かれる` }).toBe(true);
}

/** 詳細の編集モードで題名・ASIN を書き換え、「編集を終える」(＝保存) を押す */
async function editBook(page, asin, { title, newAsin }) {
    await openDetail(page, asin);
    await page.locator(`#book-detail-pane .edit-mode-btn[data-asin="${asin}"]`).click();
    if (title !== undefined) await page.locator(`#book-detail-pane .edit-title[data-asin="${asin}"]`).fill(title);
    if (newAsin !== undefined) await page.locator(`#book-detail-pane .edit-original-asin[data-asin="${asin}"]`).fill(newAsin);
    await page.locator(`#book-detail-pane .cancel-edit-btn[data-asin="${asin}"]`).click();
}

/** 保存先の観測を、期待の値になるか timeout まで待って最後の値を返す (落とさずに全観測点を記録するため) */
async function settle(fn, want, timeout = 8000) {
    const end = Date.now() + timeout;
    let v = await fn();
    while (v !== want && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 250));
        v = await fn();
    }
    return v;
}

/** 保存先の様子を結果に添付する (落ちた時に、どのファイルが残ったか・どんな削除要求が来たかを見る) */
async function attachRemoteState(remote) {
    await test.info().attach('保存先の private/books', {
        body: JSON.stringify({ files: await remoteMemoFiles(remote), deleteRequests: remote.deleteRequests || null }, null, 2),
        contentType: 'application/json'
    });
}

for (const { name, boot } of BACKENDS) {
    test.describe(`長文メモのファイルが取り残されない: ${name} (イシュー#594)`, () => {
        test('本を削除すると、保存先からその本の長文メモのファイルが消える', async ({ page }) => {
            const remote = await boot(page);
            await addBook(page, remote, ASIN, TITLE);
            await writeMemo(page, remote, ASIN, TITLE);

            // deleteBook は確認に native の confirm を使う (画面に削除ボタンは無い＝js/screens/book-detail.js:393)
            const dialogs = [];
            page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
            await page.evaluate((asin) => window.bookshelf.deleteBook(asin), ASIN);
            expect(dialogs.length, '削除の確認が1回出る').toBe(1);
            await expect.poll(() => page.evaluate((asin) => window.bookshelf.books.some((b) => b.asin === asin), ASIN), { message: 'アプリから本が消える' }).toBe(false);

            // 削除後の保存を走らせ、保存先まで届いた (library.json から消えた) のを先に確かめる
            await flushSyncNow(page);
            await expect.poll(async () => Object.keys(await remoteBooks(remote)), { message: '削除後の library.json が保存先に届く' }).not.toContain(ASIN);
            try {
                await expect.poll(() => remote.has(memoPath(ASIN, TITLE)), {
                    timeout: 8000,
                    message: `削除した本の長文メモ ${memoPath(ASIN, TITLE)} が保存先に残っていない`
                }).toBe(false);
            } finally {
                await attachRemoteState(remote);
            }
        });

        test('題名を変えると、長文メモが新しい名前で読め、古いファイルが残らない', async ({ page }) => {
            const remote = await boot(page);
            await addBook(page, remote, ASIN, TITLE);
            await writeMemo(page, remote, ASIN, TITLE);

            await editBook(page, ASIN, { title: NEW_TITLE });
            await expect.poll(async () => (await remoteBooks(remote))[ASIN], { message: '新しい題名が保存先に届く' }).toBe(NEW_TITLE);

            try {
                // 3つの観測点を全部記録する (1つ目で止めない)
                expect.soft(await settle(() => remote.has(memoPath(ASIN, NEW_TITLE)), true), `新しい名前 ${memoPath(ASIN, NEW_TITLE)} が保存先にある`).toBe(true);
                expect.soft(await settle(() => remote.has(memoPath(ASIN, TITLE)), false), `古い名前 ${memoPath(ASIN, TITLE)} が保存先に残っていない`).toBe(false);
                const shown = await openMemoFromDetail(page, ASIN);
                expect.soft(shown, '題名を変えた後に詳細から長文メモを開くと、書いた本文が出る').toContain(BODY);
            } finally {
                await attachRemoteState(remote);
            }
        });

        test('ASIN を変えると、長文メモが新しい名前で読め、古いファイルが残らない', async ({ page }) => {
            const remote = await boot(page);
            await addBook(page, remote, ASIN, TITLE);
            await writeMemo(page, remote, ASIN, TITLE);

            await editBook(page, ASIN, { newAsin: NEW_ASIN });
            await expect.poll(async () => Object.keys(await remoteBooks(remote)), { message: '新しい ASIN が保存先に届く' }).toEqual([NEW_ASIN]);

            try {
                expect.soft(await settle(() => remote.has(memoPath(NEW_ASIN, TITLE)), true), `新しい名前 ${memoPath(NEW_ASIN, TITLE)} が保存先にある`).toBe(true);
                expect.soft(await settle(() => remote.has(memoPath(ASIN, TITLE)), false), `古い名前 ${memoPath(ASIN, TITLE)} が保存先に残っていない`).toBe(false);
                const shown = await openMemoFromDetail(page, NEW_ASIN);
                expect.soft(shown, 'ASIN を変えた後に詳細から長文メモを開くと、書いた本文が出る').toContain(BODY);
            } finally {
                await attachRemoteState(remote);
            }
        });
    });
}
