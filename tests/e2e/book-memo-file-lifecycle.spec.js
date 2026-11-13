// イシュー#594: 長文メモのファイル (private/books/<ASIN>__<題名>.md) が、本の削除・題名の変更・
// ASIN の変更のあとも保存先に取り残されないこと、題名や ASIN を変えてもメモが新しい名前で読めること。
// 3つの保存先 (Asayake ハブ・GitHub・ローカルフォルダ) で同じ3操作を流す回帰テスト
// (門の E2E には数えない。確認の対象が画面ではなく保存先の中身のため)。
//
// 保存先の模擬は tests/e2e/helpers/storage-fakes.js (イシュー#587)。状態は Node 側にあり、
// ページを再読込しても残る。題名・ASIN の変更とメモの読み書きは画面の操作で行う。
// 本の追加 (前提づくり) も画面の操作 (設定の「蔵書」→ 手動で追加)。例外は本の削除で、アプリの処理 (deleteBook) を呼ぶ。
// 本の削除は、origin/main (66d9ac4) の画面に押せるボタンが無いため (js/screens/book-detail.js:393 の
// .delete-btn を描く箇所が無い)。deleteBook 自身の確認ダイアログ (confirm) は画面と同じく通す。
import { test, expect } from './helpers/test-base.js';
import { installFakeHub, FAKE_HUB_BASE, installFakeGitHub, FAKE_GITHUB, installFakeLocalFolder } from './helpers/storage-fakes.js';
import { openSettingsByClick } from './helpers/settings.js';
import { waitForBookMemoEditor, setBookMemoValue, getBookMemoValue } from './helpers/book-memo.js';

// 画面の操作が詰まった時に、テスト全体の制限時間 (60秒) まで待たずに落とす
test.use({ actionTimeout: 10_000 });

const ASIN = 'B0MEMO5941';
const NEW_ASIN = 'B0MEMO5942';
const BODY = 'MEMO-BODY-594 長文メモの本文';

// 長文メモのファイル名の作り方 (js/storage.js sanitizeFileName と同じ: 使えない文字と空白を _ にし、50字で切る)
const fileTitle = (t) => (t ? t.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 50) : '') || 'untitled';
const memoPath = (asin, title) => `private/books/${asin}__${fileTitle(title)}.md`;

// 題名の2通り: ふつうの題名と、ファイル名に使えない文字・空白を含む題名
const TITLE_CASES = [
    { label: '', title: 'メモの本', newTitle: '題名を変えた本' },
    { label: '・使えない文字と空白を含む題名', title: 'メモ: 本/特殊?"<>|*\\ 題', newTitle: '題名 を/変えた:本?' }
];

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
        // 保存先を「この端末のフォルダ」に決めた人 (決めた印つき・イシュー#596。印の無い local は設定がハブを見せる)
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', methodChosen: true }));
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

/** 前提づくり: 画面の操作 (設定の「蔵書」→ 手動で追加) で本を1冊足し、保存先の library.json に届くまで待つ
 *  (#587 の E2E と同じく「画面の操作 → 保存先を poll」。手順は dashboard-stats-after-manual-add.spec.js と同じ)。
 *  addBookManually を直接呼ぶと、起動時の読み込みが終わる前に足した本が読み込みで上書きされて消えることがあった
 *  (step4 の e2e-diff の全体並列実行で1回・594-results.md) */
async function addBook(page, remote, asin, title) {
    await openSettingsByClick(page, 'library-section');
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await page.locator('#add-book-manually').click();
    await page.locator('#manual-asin').fill(asin);
    await page.locator('#manual-title').fill(title);
    await page.locator('#add-manually').click();
    await expect(page.locator('#add-book-results')).toContainText('書籍を追加しました');
    await page.locator('#add-book-modal-close').click();
    await expect(page.locator('#add-book-modal')).not.toHaveClass(/show/);
    if (await page.locator('#settings-modal').isVisible()) {
        await page.keyboard.press('Escape');
        await expect(page.locator('#settings-modal')).toBeHidden();
    }
    try {
        await expect.poll(async () => (await remoteBooks(remote))[asin], { message: `本 ${asin} が保存先に届く` }).toBe(title);
    } catch (e) {
        await attachDiag(page, remote, `本 ${asin} が保存先に届かなかった`);
        throw e;
    }
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

/** 詳細から長文メモを書き、「完了」(保存して閉じる) で保存して、画面が閉じ保存先にファイルが届くまで待つ */
async function writeMemo(page, remote, asin, title) {
    await openMemoFromDetail(page, asin);
    await setBookMemoValue(page, BODY);
    // 利用者の操作に合わせて「完了」(保存して閉じる) を押す (スマホでは Esc を押せない)。画面が閉じたのを確かめてから進む
    await page.locator('#book-memo-fs-done').click();
    await expect(page.locator('#book-memo-modal')).not.toHaveClass(/show/);
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

for (const { name, boot } of BACKENDS) for (const { label, title: TITLE, newTitle: NEW_TITLE } of TITLE_CASES) {
    test.describe(`長文メモのファイルが取り残されない: ${name}${label} (イシュー#594)`, () => {
        test('本を削除すると、保存先からその本の長文メモのファイルが消える', async ({ page }) => {
            const remote = await boot(page);
            await addBook(page, remote, ASIN, TITLE);
            await writeMemo(page, remote, ASIN, TITLE);

            // deleteBook の確認はアプリ独自の確認画面 (.cfm-overlay「…を完全削除しますか？」)。native の confirm ではない
            // (step3 の実測: dialog イベントは0件・確認画面が出たまま deleteBook が待っていた)。
            // 画面に削除ボタンは無い (js/screens/book-detail.js:393) ので deleteBook を呼び、確認画面で OK を押す
            await page.evaluate((asin) => {
                window.__e2eDelete = 'running';
                window.bookshelf.deleteBook(asin).then(() => { window.__e2eDelete = 'done'; }, (e) => { window.__e2eDelete = `error: ${e.message}`; });
            }, ASIN);
            await expect(page.locator('.cfm-overlay')).toContainText('完全削除しますか');
            await confirmOk(page);
            try {
                await expect.poll(() => page.evaluate(() => window.__e2eDelete), { message: 'deleteBook が終わる' }).toBe('done');
                await expect.poll(async () => Object.keys(await remoteBooks(remote)), { message: '削除後の library.json が保存先に届く' }).not.toContain(ASIN);
            } catch (e) {
                await attachDiag(page, remote, 'deleteBook が終わらない／削除が届かない');
                throw e;
            }
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

const FAILABLE = BACKENDS.filter((b) => b.name !== 'ローカルフォルダ');
const TITLE = 'メモの本';
const NEW_TITLE = '題名を変えた本';

for (const { name, boot } of BACKENDS) {
    test.describe(`長文メモ: 変更してすぐ再読込 ${name} (イシュー#594)`, () => {
        // fixme: 本の編集が保存前の再読込で戻る件 (別イシュー予定)。題名を変えてすぐ再読込すると、題名の変更そのものが
        // 古い題名に戻る (「未保存あり」の印が立っている間に再読込しても同じ・594-results.md の step3 の実測)。
        // 長文メモの側は壊れない (移す記録は「移す先がどの本のものでもない」として捨てられ、メモは古い題名のまま読める)。
        // その件が直ったら fixme を外す。
        test.fixme('題名を変えてすぐ再読込しても、新しい名前で読め、次の保存で古いファイルが消える', async ({ page }) => {
            const remote = await boot(page);
            await addBook(page, remote, ASIN, TITLE);
            await writeMemo(page, remote, ASIN, TITLE);

            await editBook(page, ASIN, { title: NEW_TITLE });
            // アプリに新しい題名が入り、移す記録が端末に残った所で、保存先への保存が終わるのを待たずに再読込する
            await expect.poll(() => page.evaluate((a) => (window.bookshelf.books.find((b) => b.asin === a) || {}).title, ASIN), { message: 'アプリに新しい題名が入る' }).toBe(NEW_TITLE);
            await expect.poll(() => page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingShelfDeletes') || ''), { message: '移す記録が端末に残る' }).toContain('memo-move');
            // 端末に「未保存あり」の印 (_scheduleSync が立て、保存の成功で外す) が立っている間に再読込する。
            // 印が立つ前に再読込すると、題名の変更そのものが保存先の古い内容で戻る (アプリ側の既存の動き・594-results.md)
            await expect.poll(() => page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingSync')), { message: '未保存ありの印が立つ' }).toBe('1');
            await page.reload();

            try {
                await expect.poll(async () => (await remoteBooks(remote))[ASIN], { message: '再読込の後の保存で新しい題名が届く' }).toBe(NEW_TITLE);
            } catch (e) {
                await attachDiag(page, remote, '再読込の後に新しい題名が届かない');
                console.log(`DIAG pending ${await page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingShelfDeletes'))} pendingSync=${await page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingSync'))} appTitle=${await page.evaluate((a) => (window.bookshelf.books.find((b) => b.asin === a) || {}).title, ASIN)}`);
                throw e;
            }
            try {
                expect.soft(await settle(() => remote.has(memoPath(ASIN, NEW_TITLE)), true), '新しい名前が保存先にある').toBe(true);
                expect.soft(await settle(() => remote.has(memoPath(ASIN, TITLE)), false), '古い名前が保存先に残っていない').toBe(false);
                expect.soft(await openMemoFromDetail(page, ASIN), '再読込の後も新しい題名で本文が出る').toContain(BODY);
            } finally {
                await attachRemoteState(remote);
            }
        });
    });
}

for (const { name, boot } of FAILABLE) {
    test.describe(`長文メモ: 保存先に書けない間の変更 ${name} (イシュー#594)`, () => {
        test('書けない間に題名を変えても、記録が残り、次の保存で新しい名前へ移って古いファイルが消える', async ({ page }) => {
            const remote = await boot(page);
            await addBook(page, remote, ASIN, TITLE);
            await writeMemo(page, remote, ASIN, TITLE);

            remote.failNextWrites(1); // 次の保存を失敗させる (#587 の E2E と同じ模擬の手段)
            await editBook(page, ASIN, { title: NEW_TITLE });
            await expect.poll(() => remote.failuresLeft(), { message: '題名を変えた後の保存が失敗する' }).toBe(0);
            expect(await page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingShelfDeletes') || ''), '移す記録が残っている').toContain('memo-move');
            expect(await remote.has(memoPath(ASIN, TITLE)), '失敗した時点では古い名前のまま').toBe(true);

            // 次の保存 (別の本を足す) で移る
            await addBook(page, remote, NEW_ASIN, '2冊目の本');
            try {
                expect.soft(await settle(() => remote.has(memoPath(ASIN, NEW_TITLE)), true), '新しい名前が保存先にある').toBe(true);
                expect.soft(await settle(() => remote.has(memoPath(ASIN, TITLE)), false), '古い名前が保存先に残っていない').toBe(false);
                expect.soft(await openMemoFromDetail(page, ASIN), '新しい題名で本文が出る').toContain(BODY);
            } finally {
                await attachRemoteState(remote);
            }
        });
    });
}

test.describe('長文メモ: フォルダ未接続の間の変更 ローカルフォルダ (イシュー#594)', () => {
    // fixme: #602 (ローカル保存で、未接続の間の編集が繋ぎ直すと上書きされて戻る)。繋ぎ直すと、未接続の間に変えた
    // 題名が保存先の古い題名に戻る (594-results.md の step3 の実測)。長文メモの側は壊れない (移す記録は捨てられ、
    // メモは古い題名のまま読める)。#602 が直ったら fixme を外す。
    test.fixme('フォルダ未接続の間に題名を変え、繋ぎ直した後の保存で新しい名前へ移って古いファイルが消える', async ({ page }) => {
        // #587 の E2E と同じ形: 印が立っている間だけ queryPermission が 'prompt' を返す＝再読込後に「要再接続」になる
        await page.addInitScript(() => {
            const orig = FileSystemHandle.prototype.queryPermission;
            FileSystemHandle.prototype.queryPermission = function (...args) {
                return localStorage.getItem('__e2e_perm_prompt') === '1' ? Promise.resolve('prompt') : orig.apply(this, args);
            };
        });
        const local = await bootWithLocalFolder(page);
        await addBook(page, local, ASIN, TITLE);
        await writeMemo(page, local, ASIN, TITLE);

        await page.evaluate(() => localStorage.setItem('__e2e_perm_prompt', '1'));
        await page.reload();
        await expect(page.locator('#app-status-bar')).toContainText('保存先が未設定');
        await editBook(page, ASIN, { title: NEW_TITLE });
        await expect.poll(() => page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingShelfDeletes') || ''), { message: '移す記録が端末に残る' }).toContain('memo-move');
        expect(await local.has(memoPath(ASIN, TITLE)), '未接続の間は保存先は古い名前のまま').toBe(true);

        await page.evaluate(() => localStorage.removeItem('__e2e_perm_prompt'));
        await openSettingsByClick(page, 'sync-section');
        await page.locator('#obsidian-sync-btn').click();
        await expect(page.locator('#obsidian-sync-status')).toContainText('同期済み');
        await page.keyboard.press('Escape');

        try {
            await expect.poll(async () => (await remoteBooks(local))[ASIN], { message: '繋ぎ直した後の保存で新しい題名が届く' }).toBe(NEW_TITLE);
            expect.soft(await settle(() => local.has(memoPath(ASIN, NEW_TITLE)), true), '新しい名前が保存先にある').toBe(true);
            expect.soft(await settle(() => local.has(memoPath(ASIN, TITLE)), false), '古い名前が保存先に残っていない').toBe(false);
            expect.soft(await openMemoFromDetail(page, ASIN), '新しい題名で本文が出る').toContain(BODY);
        } catch (e) {
            await attachDiag(page, local, '繋ぎ直した後に新しい題名が届かない');
            throw e;
        } finally {
            await attachRemoteState(local);
        }
    });
});
