// イシュー#602: 保存先に書けない間 (ローカルフォルダの権限待ち・ハブ/GitHub への書き込み失敗) にした編集が、
// 書けるようになった後も消えないこと。消えたかどうかを、画面 (アプリの状態)・localStorage・保存先の
// 3か所で見る。編集は画面の操作だけで行う (関数の直呼びでは「画面の操作 → 保存 → 保存先」の経路が切れても通るため)。
//
// step1 (再現) の段階: origin/main でどれが落ちるかを記録する。逆向き (保存先の方が新しい) の期待値は
// step2 で決めるので、その test は今の挙動を結果に添付するだけ。
import { test, expect } from './helpers/test-base.js';
import {
    installFakeGitHub, FAKE_GITHUB,
    installFakeLocalFolder, installReloadPermissionPrompt
} from './helpers/storage-fakes.js';
import { createHubStateForTest, mockHubForTest, hubStoreForTest, HUB_BASE } from './helpers/gate-hub.js';
import { openSettingsByClick } from './helpers/settings.js';
import { waitForBookMemoEditor, setBookMemoValue } from './helpers/book-memo.js';

// 画面の操作が詰まった時に、テスト全体の制限時間 (60秒) まで待たずに落とす
test.use({ actionTimeout: 10_000 });

const ASIN_A = 'B0OFFLNA01'; // 繋いでいる間に足す本 (未接続の間にメモを書く)
const ASIN_B = 'B0OFFLNB02'; // 未接続の間に足す本
const ASIN_C = 'B0OTHRDV03'; // 他の端末が足した本 (逆向き)

const shelfFile = (slug) => `private/bookshelves/${slug}.json`;

const remoteSlugs = async (remote) => {
    const meta = await remote.readJSON('private/bookshelves.json');
    return meta && Array.isArray(meta.bookshelves) ? meta.bookshelves.map((b) => b.slug) : [];
};

const remoteAsins = async (remote) => {
    const lib = await remote.readJSON('private/library.json');
    return lib && Array.isArray(lib.books) ? lib.books.map((b) => b.asin) : [];
};

const remoteMemo = async (remote, asin) => {
    const n = await remote.readJSON('private/notes.json');
    return (n && n.notes && n.notes[asin] && n.notes[asin].memo) || '';
};

const confirmOk = async (page) => {
    const cfm = page.locator('.cfm-overlay');
    await cfm.waitFor({ state: 'visible' });
    await cfm.locator('.cfm-ok').click();
    await cfm.waitFor({ state: 'hidden' });
};

/** ツリーの本棚の「…」メニューを開く */
async function openTreeMenu(page, slug) {
    const tree = page.locator('#sidebar-bookshelf-tree');
    const allToggle = tree.locator('.tree-node[data-bookshelf-id="all"] .tree-toggle');
    await expect(allToggle).toBeVisible();
    if (await allToggle.getAttribute('title') === '展開') await allToggle.click();
    const node = tree.locator(`.tree-node[data-bookshelf-id="${slug}"]`);
    await expect(node).toBeVisible();
    await node.hover();
    await node.locator('.tree-more').click();
    await expect(page.locator('#tree-node-menu')).toBeVisible();
}

/** 画面から本棚を作り、保存先に本棚ファイルが届くまで待つ。作られた slug を返す */
async function createShelf(page, remote, name) {
    const before = await remoteSlugs(remote);
    await page.locator('#sidebar-add-bookshelf').click();
    await expect(page.locator('#bookshelf-form-modal')).toHaveClass(/show/);
    await page.locator('#bookshelf-name').fill(name);
    await page.locator('#save-bookshelf-form').click();
    await expect(page.locator('#bookshelf-form-modal')).not.toHaveClass(/show/);
    let slug;
    await expect.poll(async () => {
        slug = (await remoteSlugs(remote)).find((s) => !before.includes(s));
        return slug || null;
    }, { message: `本棚「${name}」が保存先の一覧に届く` }).not.toBeNull();
    await expect.poll(() => remote.has(shelfFile(slug)), { message: `${shelfFile(slug)} が保存先に書かれる` }).toBe(true);
    return slug;
}

/** 画面から本棚を削除する (ツリーの「…」→ 削除 → 確認ダイアログで「削除する」) */
async function deleteShelf(page, slug) {
    await openTreeMenu(page, slug);
    await page.locator('#tree-node-menu [data-act="delete"]').click();
    await confirmOk(page);
}

/** 設定 → 蔵書 →「手動で追加」で本を1冊足す */
async function addBook(page, asin, title) {
    await openSettingsByClick(page, 'library-section');
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
    await page.waitForFunction((a) => {
        const lib = JSON.parse(localStorage.getItem('virtualBookshelf_library') || '{}');
        return (lib.books || []).some((b) => b.asin === a);
    }, asin);
}

/** 本の詳細の短文メモを書く (入力で自動保存。localStorage に入るまで待つ) */
async function editMemo(page, asin, text) {
    // 一覧を「すべての本」にする (移動だけ。確かめる対象の操作ではない)
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await page.waitForFunction((a) => !!document.querySelector(`#bookshelf > .book-item[data-asin="${a}"]`), asin);
    // content-visibility 下のカードは可視判定が揺れるので、ネイティブ click でアプリのハンドラを呼ぶ
    await page.evaluate((a) => document.querySelector(`#bookshelf > .book-item[data-asin="${a}"]`).click(), asin);
    await page.locator('#book-detail-pane .note-textarea').fill(text);
    await page.waitForFunction(([a, t]) => {
        const ud = JSON.parse(localStorage.getItem('virtualBookshelf_userData') || '{}');
        return !!(ud.notes && ud.notes[a] && ud.notes[a].memo === t);
    }, [asin, text]);
}

/** アプリの状態・localStorage から、3つの編集が残っているかを集める */
async function collectLocal(page, slug) {
    return page.evaluate(([a, b, s]) => {
        const app = window.bookshelf;
        const lib = JSON.parse(localStorage.getItem('virtualBookshelf_library') || '{}');
        const ud = JSON.parse(localStorage.getItem('virtualBookshelf_userData') || '{}');
        return {
            app: {
                bookB: (app.books || []).some((x) => x.asin === b),
                shelfExists: !!app.bookshelfManager.getBySlug(s),
                memoA: (app.userData.notes && app.userData.notes[a] && app.userData.notes[a].memo) || ''
            },
            localStorage: {
                bookB: (lib.books || []).some((x) => x.asin === b),
                shelfExists: (ud.bookshelves || []).some((x) => x.id === s),
                memoA: (ud.notes && ud.notes[a] && ud.notes[a].memo) || '',
                pendingSync: localStorage.getItem('virtualBookshelf_pendingSync')
            }
        };
    }, [ASIN_A, ASIN_B, slug]);
}

async function collectRemote(remote, slug) {
    return {
        bookB: (await remoteAsins(remote)).includes(ASIN_B),
        shelfInList: (await remoteSlugs(remote)).includes(slug),
        shelfFile: await remote.has(shelfFile(slug)),
        memoA: await remoteMemo(remote, ASIN_A)
    };
}

/** 3か所それぞれで「本Bがある・本棚が無い・本Aのメモが未接続中の内容」を確かめる (落ちても全部記録する) */
function expectEditsKept(where, got, memo) {
    expect.soft(got.bookB, `${where}: 未接続の間に足した本が残る`).toBe(true);
    if ('shelfExists' in got) expect.soft(got.shelfExists, `${where}: 未接続の間に消した本棚が戻らない`).toBe(false);
    if ('shelfInList' in got) expect.soft(got.shelfInList, `${where}: 消した本棚が一覧に戻らない`).toBe(false);
    if ('shelfFile' in got) expect.soft(got.shelfFile, `${where}: 消した本棚のファイルが残らない`).toBe(false);
    expect.soft(got.memoA, `${where}: 未接続の間に書いたメモが残る`).toBe(memo);
}

// ===== ローカルフォルダ: 権限待ち (要再接続) の間の編集 =====

/** 設定 → 同期 →「フォルダを選ぶ」で繋ぐ (初回・繋ぎ直しとも同じ操作) */
async function pickFolder(page) {
    await openSettingsByClick(page, 'sync-section');
    await page.locator('#obsidian-sync-btn').click();
    await expect(page.locator('#obsidian-sync-status')).toContainText('同期済み');
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
}

async function bootLocalWithPrompt(page) {
    const local = await installFakeLocalFolder(page);
    const perm = await installReloadPermissionPrompt(page);
    await page.addInitScript(() => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', methodChosen: true })); // 保存先を「この端末のフォルダ」に決めた人 (イシュー#596 の印)
    });
    await page.goto('index.html');
    await pickFolder(page);
    await expect.poll(() => local.has(shelfFile('all')), { message: '選んだフォルダが初期化される' }).toBe(true);
    return { local, perm };
}

test.describe('ローカルフォルダ: 未接続の間の編集が、繋ぎ直した後も残る (イシュー#602)', () => {
    test('権限待ちの間に本の追加・本棚の削除・メモ編集をして繋ぎ直す', async ({ page }) => {
        const { local, perm } = await bootLocalWithPrompt(page);
        await addBook(page, ASIN_A, '繋いでいる間に足した本');
        await expect.poll(() => remoteAsins(local), { message: '本Aがフォルダに届く' }).toContain(ASIN_A);
        const slug = await createShelf(page, local, '未接続中に消す本棚');

        await perm.promptOnNextReload();
        await page.reload();
        await expect(page.locator('#app-status-bar')).toContainText('保存先が未設定');

        const MEMO = '未接続中に書いたメモ';
        await addBook(page, ASIN_B, '未接続中に足した本');
        await deleteShelf(page, slug);
        await editMemo(page, ASIN_A, MEMO);
        const beforeReconnect = await collectLocal(page, slug);

        await pickFolder(page);
        await page.waitForTimeout(2500); // 繋ぎ直した後の保存を待つ

        const after = await collectLocal(page, slug);
        const remote = await collectRemote(local, slug);
        await test.info().attach('結果', {
            body: JSON.stringify({ beforeReconnect, after, folder: remote }, null, 2),
            contentType: 'application/json'
        });
        expectEditsKept('画面', after.app, MEMO);
        expectEditsKept('localStorage', after.localStorage, MEMO);
        expectEditsKept('フォルダ', remote, MEMO);
    });

    // 他の端末での更新を模擬: フォルダの library.json に本C (exportDate も他の端末の保存と同じく変わる)、notes.json に本Aのメモ
    async function otherDeviceUpdate(page, dirName) {
        await page.evaluate(async ([dir, c, a]) => {
            const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(dir);
            const priv = await root.getDirectoryHandle('private');
            const readJ = async (name) => JSON.parse(await (await (await priv.getFileHandle(name)).getFile()).text());
            const writeJ = async (name, data) => {
                const w = await (await priv.getFileHandle(name, { create: true })).createWritable();
                await w.write(JSON.stringify(data, null, 2));
                await w.close();
            };
            const lib = await readJ('library.json');
            lib.books.push({ asin: c, title: '他の端末で足した本', authors: '', acquiredTime: Date.now(), readStatus: 'UNKNOWN', productImage: '', source: 'manual_add', addedDate: Date.now() });
            lib.exportDate = new Date(Date.now() + 1000).toISOString();
            await writeJ('library.json', lib);
            const notes = await readJ('notes.json');
            notes.notes = notes.notes || {};
            notes.notes[a] = { memo: '他の端末で書いたメモ' };
            await writeJ('notes.json', notes);
        }, [dirName, ASIN_C, ASIN_A]);
    }

    /** 両方が変わった状態を作り、「フォルダを選ぶ」で繋ぎ直してダイアログが出るところまで進める */
    async function bothChangedAndReconnect(page, { deleteSlug } = {}) {
        const { local, perm } = await bootLocalWithPrompt(page);
        await addBook(page, ASIN_A, '繋いでいる間に足した本');
        await expect.poll(() => remoteAsins(local), { message: '本Aがフォルダに届く' }).toContain(ASIN_A);
        const slug = deleteSlug ? await createShelf(page, local, '未接続中に消す本棚') : null;
        await perm.promptOnNextReload();
        await page.reload();
        await expect(page.locator('#app-status-bar')).toContainText('保存先が未設定');
        await otherDeviceUpdate(page, local.dirName);
        await addBook(page, ASIN_B, '未接続中に足した本');
        await editMemo(page, ASIN_A, 'この端末で書いたメモ');
        if (slug) await deleteShelf(page, slug);
        await openSettingsByClick(page, 'sync-section');
        await page.locator('#obsidian-sync-btn').click();
        const dlg = page.locator('#load-conflict-dialog');
        await expect(dlg).toBeVisible();
        return { local, dlg, slug };
    }

    const appState = (page) => page.evaluate(([a, b, c]) => {
        const app = window.bookshelf;
        return {
            bookB: (app.books || []).some((x) => x.asin === b),
            bookC: (app.books || []).some((x) => x.asin === c),
            memoA: (app.userData.notes && app.userData.notes[a] && app.userData.notes[a].memo) || '',
            pendingSync: localStorage.getItem('virtualBookshelf_pendingSync')
        };
    }, [ASIN_A, ASIN_B, ASIN_C]);

    test('他の端末だけが更新した (この端末に未保存の編集は無い): 聞かずに保存先の内容を採る', async ({ page }) => {
        const { local, perm } = await bootLocalWithPrompt(page);
        await addBook(page, ASIN_A, '繋いでいる間に足した本');
        await expect.poll(() => remoteAsins(local), { message: '本Aがフォルダに届く' }).toContain(ASIN_A);
        await expect.poll(() => page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingSync')), { message: '保存が済んで未反映の印が消える' }).toBeNull();
        await perm.promptOnNextReload();
        await page.reload();
        await expect(page.locator('#app-status-bar')).toContainText('保存先が未設定');
        await otherDeviceUpdate(page, local.dirName);
        await pickFolder(page);
        await expect.poll(() => appState(page).then((s) => s.bookC), { message: '他の端末の本Cが採られる' }).toBe(true);
        expect.soft((await appState(page)).memoA).toBe('他の端末で書いたメモ');
        await expect(page.locator('#load-conflict-dialog')).toHaveCount(0);
    });

    test('両方が変わった: ダイアログを選ばずに閉じると、手元の表示のまま保存先へは書かず、次に開いた時にもう一度聞く', async ({ page }) => {
        const { local, dlg } = await bothChangedAndReconnect(page);
        // 既定 (最初のフォーカス) は何も消えない「書き出す」。上書きは危険な操作の見た目
        await expect(dlg.locator('.cfm-export')).toBeFocused();
        await expect(dlg.locator('.cfm-local')).toHaveClass(/btn-danger/);
        await expect(dlg.locator('.cfm-remote')).toHaveClass(/btn-danger/);
        // Enter は既定の「書き出す」＝何も消えない (書き出した後にもう一度聞かれる)
        const download = page.waitForEvent('download');
        await page.keyboard.press('Enter');
        await download;
        await expect(dlg).toBeVisible();
        // Esc は選ばずに閉じる
        await page.keyboard.press('Escape');
        await expect(dlg).toBeHidden();
        await page.waitForTimeout(2000);
        const after = await appState(page);
        expect.soft(after.bookB, '手元の本Bは表示に残る').toBe(true);
        expect.soft(after.memoA, '手元のメモは表示に残る').toBe('この端末で書いたメモ');
        expect.soft(after.pendingSync, '未反映の印は残る').toBe('1');
        expect.soft(await remoteAsins(local), 'フォルダへは書かない (本Bは無い)').not.toContain(ASIN_B);
        expect.soft(await remoteMemo(local, ASIN_A), 'フォルダのメモは他の端末のまま').toBe('他の端末で書いたメモ');
        // 次に開いた時 (許可は戻っている) にもう一度聞く
        await page.reload();
        await expect(page.locator('#load-conflict-dialog')).toBeVisible();
        // 枠外クリックも選ばずに閉じる＝保存先へは書かない
        await page.locator('.cfm-overlay').click({ position: { x: 5, y: 5 } });
        await expect(page.locator('#load-conflict-dialog')).toBeHidden();
        await page.waitForTimeout(1500);
        expect.soft(await remoteAsins(local), '枠外クリックの後もフォルダへは書かない').not.toContain(ASIN_B);
    });

    test('両方が変わった:「この端末の内容で保存先を上書き」を選ぶと、手元が残り保存先も手元になる', async ({ page }) => {
        const { local, dlg } = await bothChangedAndReconnect(page);
        await dlg.locator('.cfm-local').click();
        await expect(dlg).toBeHidden();
        await expect.poll(() => remoteAsins(local), { message: '手元の本Bが保存先に書かれる' }).toContain(ASIN_B);
        const after = await appState(page);
        expect.soft(after.bookB).toBe(true);
        expect.soft(after.bookC, '他の端末の本Cは採らない (この端末を選んだ)').toBe(false);
        expect.soft(after.memoA).toBe('この端末で書いたメモ');
        expect.soft(await remoteMemo(local, ASIN_A)).toBe('この端末で書いたメモ');
        await expect.poll(() => page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingSync')), { message: '書けたら未反映の印が消える' }).toBeNull();
    });

    test('両方が変わった:「保存先の内容を読み込む」を選ぶと、保存先が採られ、削除待ちが保存先に残すべき本棚ファイルを消さない', async ({ page }) => {
        const { local, dlg, slug } = await bothChangedAndReconnect(page, { deleteSlug: true });
        await dlg.locator('.cfm-remote').click();
        await expect(dlg).toBeHidden();
        const after = await appState(page);
        expect.soft(after.bookB, '手元の本Bは捨てる (保存先を選んだ)').toBe(false);
        expect.soft(after.bookC, '他の端末の本Cが採られる').toBe(true);
        expect.soft(after.memoA).toBe('他の端末で書いたメモ');
        expect.soft(after.pendingSync).toBeNull();
        expect.soft(await page.evaluate((s) => !!window.bookshelf.bookshelfManager.getBySlug(s), slug), '保存先にある本棚は戻る').toBe(true);
        // 次の保存 (本を1冊足す) の後も、保存先に残すと決めた本棚のファイルは消えない
        await addBook(page, 'B0AFTERRM9', '読み込んだ後に足した本');
        await expect.poll(() => remoteAsins(local), { message: '次の保存が届く' }).toContain('B0AFTERRM9');
        expect.soft(await remote_has(local, slug), '削除待ちが本棚ファイルを消さない').toBe(true);
        expect.soft((await remoteSlugs(local)).includes(slug)).toBe(true);
    });
    test('両方が変わった:「保存先の内容を読み込む」を選ぶと、手元で消した本の長文メモのファイルを次の保存で消さない', async ({ page }) => {
        const { local, perm } = await bootLocalWithPrompt(page);
        const TITLE = '長文メモのある本';
        const memoFile = `private/books/${ASIN_A}__${TITLE}.md`;
        await addBook(page, ASIN_A, TITLE);
        await expect.poll(() => remoteAsins(local), { message: '本Aがフォルダに届く' }).toContain(ASIN_A);
        // 長文メモを書く (本の詳細 →「長文メモを書く」→ 本文 →「完了」)
        await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
        await page.evaluate((a) => document.querySelector(`#bookshelf > .book-item[data-asin="${a}"]`).click(), ASIN_A);
        await page.locator(`#book-detail-pane .memo-file-btn[data-asin="${ASIN_A}"]`).click();
        await waitForBookMemoEditor(page);
        await setBookMemoValue(page, '長文メモの本文 602');
        await page.locator('#book-memo-fs-done').click();
        await expect(page.locator('#book-memo-modal')).not.toHaveClass(/show/);
        await expect.poll(() => local.has(memoFile), { message: '長文メモのファイルがフォルダに書かれる' }).toBe(true);

        await perm.promptOnNextReload();
        await page.reload();
        await expect(page.locator('#app-status-bar')).toContainText('保存先が未設定');
        await otherDeviceUpdate(page, local.dirName);
        // 未接続の間に本Aを削除する。画面に削除ボタンが無いので、#594 の E2E と同じく deleteBook を呼び、確認画面は画面で通す
        await page.evaluate((a) => {
            window.__e2eDelete = 'pending';
            window.bookshelf.deleteBook(a).then(() => { window.__e2eDelete = 'done'; }, (e) => { window.__e2eDelete = `error: ${e.message}`; });
        }, ASIN_A);
        await confirmOk(page);
        await expect.poll(() => page.evaluate(() => window.__e2eDelete), { message: 'deleteBook が終わる' }).toBe('done');
        expect(await page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingShelfDeletes')), '長文メモの削除待ちが積まれている').toContain('memo-delete');

        await openSettingsByClick(page, 'sync-section');
        await page.locator('#obsidian-sync-btn').click();
        const dlg = page.locator('#load-conflict-dialog');
        await expect(dlg).toBeVisible();
        await dlg.locator('.cfm-remote').click();
        await expect(dlg).toBeHidden();
        await expect.poll(() => page.evaluate((a) => (window.bookshelf.books || []).some((x) => x.asin === a), ASIN_A), { message: '保存先にある本Aが戻る' }).toBe(true);
        // 次の保存 (本を1冊足す) の後も、保存先に残すと決めた本の長文メモのファイルは消えない
        await addBook(page, 'B0AFTERRM9', '読み込んだ後に足した本');
        await expect.poll(() => remoteAsins(local), { message: '次の保存が届く' }).toContain('B0AFTERRM9');
        expect(await local.has(memoFile), '削除待ちが長文メモのファイルを消さない').toBe(true);
    });
});

const remote_has = (remote, slug) => remote.has(shelfFile(slug));

test.describe('ローカルフォルダ: 初めてつなぐ時 (イシュー#602)', () => {
    test('手元に本がある状態で空のフォルダを初めてつなぐと、手元の本が残り、フォルダにも書かれる', async ({ page }) => {
        const local = await installFakeLocalFolder(page);
        await page.addInitScript(() => {
            localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local', methodChosen: true })); // 保存先を「この端末のフォルダ」に決めた人 (イシュー#596 の印)
        });
        await page.goto('index.html');
        await addBook(page, ASIN_B, '初めてつなぐ前に足した本');
        await pickFolder(page);
        await expect.poll(() => remoteAsins(local), { message: 'フォルダに手元の本が書かれる' }).toContain(ASIN_B);
        const after = await page.evaluate((b) => {
            const lib = JSON.parse(localStorage.getItem('virtualBookshelf_library') || '{}');
            return {
                app: (window.bookshelf.books || []).some((x) => x.asin === b),
                localStorage: (lib.books || []).some((x) => x.asin === b)
            };
        }, ASIN_B);
        expect.soft(after.app).toBe(true);
        expect.soft(after.localStorage).toBe(true);
    });
});

// ===== ハブ・GitHub: 書き込みに失敗している間 (未同期の印は立つ) の編集 → 再読込 =====
//
// 書き込みだけを失敗させ (読み込みは通す)、未同期の印 (virtualBookshelf_pendingSync) が立ったまま再読込する。
// 印が立っている時の手元優先 (_applyLoadedState) が、本の追加・本棚の削除まで守るかを見る。

/** ハブの模擬 (tests/e2e/helpers/gate-hub.js) を取り付ける。読み口は他の保存先と同じ形。cfg = ログイン済みの保存先の設定 */
async function installHub(page) {
    const state = createHubStateForTest({ usedBytes: 0, email: 'offline-edit@example.com' });
    await mockHubForTest(page, state);
    const store = hubStoreForTest(state);
    return {
        has: async (path) => store.has(path),
        readJSON: async (path) => store.readJSON(path),
        cfg: { method: 'hub', hub: { apiBase: HUB_BASE, key: state.key, uid: state.uid, siteId: state.siteId, email: state.email, plan: state.plan } }
    };
}

async function bootWithHub(page) {
    const remote = await installHub(page);
    await page.addInitScript((cfg) => {
        localStorage.setItem('bookshelf_sync', JSON.stringify(cfg));
    }, remote.cfg);
    await page.goto('index.html');
    await confirmOk(page);
    await expect.poll(() => remote.has(shelfFile('all'))).toBe(true);
    return { remote, pattern: `${HUB_BASE}/**` };
}

async function bootWithGitHub(page) {
    const remote = await installFakeGitHub(page);
    await page.addInitScript((cfg) => {
        localStorage.setItem('bookshelf_sync', JSON.stringify({
            method: 'github',
            github: { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, basePath: '', token: 'ght_test' }
        }));
    }, FAKE_GITHUB);
    await page.goto('index.html');
    await confirmOk(page);
    await expect.poll(() => remote.has(shelfFile('all'))).toBe(true);
    return { remote, pattern: 'https://api.github.com/**' };
}

const failWrites = async (route) => {
    const m = route.request().method();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.fallback();
    return route.fulfill({ status: 503, body: 'offline (e2e)' });
};

for (const { name, boot } of [{ name: 'Asayake ハブ', boot: bootWithHub }, { name: 'GitHub', boot: bootWithGitHub }]) {
    test.describe(`${name}: 書き込みに失敗している間の編集が、再読込の後も残る (イシュー#602)`, () => {
        test('書き込み失敗中に本の追加・本棚の削除・メモ編集をして、再読込する', async ({ page }) => {
            const { remote, pattern } = await boot(page);
            await addBook(page, ASIN_A, '繋いでいる間に足した本');
            await expect.poll(() => remoteAsins(remote), { message: '本Aが保存先に届く' }).toContain(ASIN_A);
            const slug = await createShelf(page, remote, '書けない間に消す本棚');

            await page.route(pattern, failWrites);
            const MEMO = '書けない間に書いたメモ';
            await addBook(page, ASIN_B, '書けない間に足した本');
            await deleteShelf(page, slug);
            await editMemo(page, ASIN_A, MEMO);
            await page.waitForTimeout(2000); // 保存 (失敗する) を走らせる
            const beforeReload = await collectLocal(page, slug);
            await page.unroute(pattern, failWrites);

            await page.reload();
            await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData);
            await page.waitForTimeout(3000); // 読込と、読込後の再送を待つ

            const after = await collectLocal(page, slug);
            const remoteGot = await collectRemote(remote, slug);
            await test.info().attach('結果', {
                body: JSON.stringify({ beforeReload, after, remote: remoteGot }, null, 2),
                contentType: 'application/json'
            });
            expectEditsKept('画面', after.app, MEMO);
            expectEditsKept('localStorage', after.localStorage, MEMO);
            expectEditsKept('保存先', remoteGot, MEMO);
        });
    });
}

// ===== ハブ・GitHub: 初めてつなぐ時・ログアウトしていた間の編集 =====
//
// ログイン (Google・GitHub の画面) は E2E で通せないので、保存先の設定 (bookshelf_sync) を直接書いて
// 「ログインした・ログアウトした」後の状態を作る。編集は画面の操作で行う。

const GH_CFG = { method: 'github', github: { owner: FAKE_GITHUB.owner, repo: FAKE_GITHUB.repo, branch: FAKE_GITHUB.branch, basePath: '', token: 'ght_test' } };
const setSyncConfig = (page, cfg) => page.evaluate((c) => localStorage.setItem('bookshelf_sync', JSON.stringify(c)), cfg);
const appHasBook = (page, asin) => page.evaluate((a) => (window.bookshelf.books || []).some((x) => x.asin === a), asin);

for (const { name, install, cfgOf, loggedOut } of [
    { name: 'Asayake ハブ', install: installHub, cfgOf: (remote) => remote.cfg, loggedOut: { method: 'local', hub: { apiBase: HUB_BASE } } },
    { name: 'GitHub', install: installFakeGitHub, cfgOf: () => GH_CFG, loggedOut: { method: 'local' } }
]) {
    test.describe(`${name}: 初めてつなぐ時・ログアウトしていた間の編集 (イシュー#602)`, () => {
        test('手元に本がある状態で空の保存先を初めてつなぐと、手元の本が残り、保存先にも書かれる', async ({ page }) => {
            const remote = await install(page);
            const cfg = cfgOf(remote);
            await page.goto('index.html');
            await addBook(page, ASIN_B, '初めてつなぐ前に足した本');
            await setSyncConfig(page, cfg);
            await page.reload();
            await confirmOk(page); // 空の保存先の「新規データで初期化しますか？」
            await expect.poll(() => remoteAsins(remote), { message: '保存先に手元の本が書かれる' }).toContain(ASIN_B);
            expect.soft(await appHasBook(page, ASIN_B), '画面に手元の本が残る').toBe(true);
        });

        test('ログアウトしていた間に足した本とメモが、ログインし直した後も残る', async ({ page }) => {
            const remote = await install(page);
            const cfg = cfgOf(remote);
            await page.goto('index.html');
            await setSyncConfig(page, cfg);
            await page.reload();
            await confirmOk(page);
            await expect.poll(() => remote.has(shelfFile('all'))).toBe(true);
            await addBook(page, ASIN_A, 'ログイン中に足した本');
            await expect.poll(() => remoteAsins(remote), { message: '本Aが保存先に届く' }).toContain(ASIN_A);
            await expect.poll(() => page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingSync')), { message: '保存が済んで未反映の印が消える' }).toBeNull();

            // ログアウトした後の状態 (鍵・トークンが無く、この端末だけの保存に戻る)
            await setSyncConfig(page, loggedOut);
            await page.reload();
            await expect(page.locator('#app-status-bar')).toBeVisible();
            const MEMO = 'ログアウト中に書いたメモ';
            await addBook(page, ASIN_B, 'ログアウト中に足した本');
            await editMemo(page, ASIN_A, MEMO);

            // ログインし直した後の状態
            await setSyncConfig(page, cfg);
            await page.reload();
            await expect.poll(() => remoteAsins(remote), { message: 'ログアウト中に足した本が保存先に届く' }).toContain(ASIN_B);
            await expect.poll(() => remoteMemo(remote, ASIN_A), { message: 'ログアウト中のメモが保存先に届く' }).toBe(MEMO);
            expect.soft(await appHasBook(page, ASIN_B), '画面に残る').toBe(true);
            await expect(page.locator('#load-conflict-dialog')).toHaveCount(0);
        });
    });
}
