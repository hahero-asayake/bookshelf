// イシュー#639: 読込時の3択 (#load-conflict-dialog・ADR-162) を選ばずに閉じた後、保存先へ書いていないことが
// 画面から分かるか (設定の同期欄・状態バー)、公開が止まるかを、ローカルフォルダとハブの2経路で見る。
// 編集・公開は画面の操作で行う (関数の直呼びでは「画面の操作 → 保存 → 保存先」の経路が切れても通るため)。
//
// step1 (再現) の段階: 期待値は直した後の姿で書く (origin/main では赤になる)。見えた物は test.info().attach に残す。
import { test, expect } from './helpers/test-base.js';
import { installFakeLocalFolder, installReloadPermissionPrompt } from './helpers/storage-fakes.js';
import { createHubStateForTest, mockHubForTest, hubStoreForTest, publicBaseOf, seedHubDataForTest, seedHubLoginForTest, waitForHubStartupForTest, waitForHubFileContainsForTest, HUB_BASE } from './helpers/gate-hub.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { prepareOtherDeviceForTest, closeOtherDeviceForTest } from './helpers/gate-device.js';
import { openSettingsByClick } from './helpers/settings.js';
import {
    addBlock, flushArtSaveAndRemote, getArtEditingId, waitForArtTextFsEditor, setArtTextFsEditorValue,
    showArtList, openArtSheet, closeArtSheet
} from './helpers/art-editor.js';

// 画面の操作が詰まった時に、テスト全体の制限時間 (60秒) まで待たずに落とす
test.use({ actionTimeout: 10_000 });

const ASIN_A = 'B0LCUNSA01'; // 書ける間に足す本 (後でメモを書く)
const ASIN_B = 'B0LCUNSB02'; // 書けない間に足す本 (この端末の未保存の編集)
const ASIN_C = 'B0LCOTHC03'; // 他の端末が足した本 (保存先の変更)

const shelfFile = (slug) => `private/bookshelves/${slug}.json`;

const remoteAsins = async (remote) => {
    const lib = await remote.readJSON('private/library.json');
    return lib && Array.isArray(lib.books) ? lib.books.map((b) => b.asin) : [];
};

const confirmOk = async (page) => {
    const cfm = page.locator('.cfm-overlay');
    await cfm.waitFor({ state: 'visible' });
    await cfm.locator('.cfm-ok').click();
    await cfm.waitFor({ state: 'hidden' });
};

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

/** 画面に見えている物を集める: 状態バー (表示・文・失敗の種類)・設定の同期欄 (文)・未反映の印 */
async function observe(page) {
    const bar = page.locator('#app-status-bar');
    const barVisible = await bar.isVisible();
    const barText = barVisible ? (await bar.innerText()).replace(/\s+/g, ' ').trim() : '';
    const failureKinds = await bar.locator('[data-sync-failure]').evaluateAll((els) => els.map((e) => e.getAttribute('data-sync-failure')));
    if (!(await page.locator('#settings-modal').isVisible())) await openSettingsByClick(page, 'sync-section');
    const syncStatus = ((await page.locator('#obsidian-sync-status').textContent()) || '').trim();
    const syncPath = ((await page.locator('#obsidian-sync-path').textContent()) || '').trim();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-modal')).toBeHidden();
    const pendingSync = await page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingSync'));
    return { barVisible, barText, failureKinds, syncStatus, syncPath, pendingSync };
}

/** push 前の確認に見せる画像: 「未保存」の状態バーと設定の同期欄を、PC 幅と 390 幅で撮る (合否には使わない) */
async function takeShots(page, label) {
    const orig = page.viewportSize();
    const files = [];
    try {
        for (const [width, height, tag] of [[1280, 800, 'pc'], [390, 844, '390']]) {
            await page.setViewportSize({ width, height });
            await page.waitForTimeout(400);
            const bar = test.info().outputPath(`${label}-${tag}-statusbar.png`);
            await page.screenshot({ path: bar });
            files.push(bar);
            await openSettingsByClick(page, 'sync-section');
            const syncEl = page.locator('#obsidian-sync-status');
            if (await syncEl.isVisible()) await syncEl.scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);
            const sync = test.info().outputPath(`${label}-${tag}-sync.png`);
            await page.screenshot({ path: sync });
            files.push(sync);
            await page.keyboard.press('Escape');
            await expect(page.locator('#settings-modal')).toBeHidden();
        }
    } catch (e) {
        await test.info().attach(`${label}: 画像を撮れなかった`, { body: String(e && e.message), contentType: 'text/plain' });
        if (await page.locator('#settings-modal').isVisible()) await page.keyboard.press('Escape');
    } finally {
        if (orig) await page.setViewportSize(orig);
    }
    for (const f of files) await test.info().attach(f.split('/').pop(), { path: f, contentType: 'image/png' });
}

/** 直した後の姿: 保存先へ書いていないことが状態バーと同期欄に出る (期待値。origin/main では赤) */
function expectUnsavedShown(where, got) {
    expect.soft(got.barVisible, `${where}: 状態バーが出る`).toBe(true);
    expect.soft(got.failureKinds, `${where}: 状態バーに「保存先へ未保存」の行がある`).toContain('load-conflict');
    expect.soft(got.syncStatus, `${where}: 同期欄が「同期済み」と言わない`).not.toContain('同期済み');
    expect.soft(got.syncStatus, `${where}: 同期欄が「保存済み」と言わない`).not.toContain('保存済み');
}

// ===== ローカルフォルダ: 権限待ちの間の編集と、他の端末の更新 → 「フォルダを選ぶ」で繋ぎ直す =====

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

// 他の端末での更新を模擬: フォルダの library.json に本C (exportDate も他の端末の保存と同じく変わる)
async function otherDeviceUpdateLocal(page, dirName) {
    await page.evaluate(async ([dir, c]) => {
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
    }, [dirName, ASIN_C]);
}

test.describe('ローカルフォルダ: 読込時の3択を選ばずに閉じた後 (イシュー#639)', () => {
    // ローカルフォルダは PC の Chrome/Edge だけで選べる (ADR-046)。iPhone 相当 (webkit) では流さない
    test.skip(({ browserName }) => browserName === 'webkit', 'ローカルフォルダは PC の Chrome/Edge だけ (ADR-046)');
    test('閉じた後と、閉じた後に編集した後に、保存先へ書いていないことが状態バーと同期欄に出る', async ({ page }) => {
        // 自動の再試行の間隔を短くする (止めている間に再試行の行にならないことを、時間を進めて確かめるため)
        await page.addInitScript(() => localStorage.setItem('bookshelf.flag.syncRetryDelaysMs', '[300,300,300]'));
        const { local, perm } = await bootLocalWithPrompt(page);
        await addBook(page, ASIN_A, '繋いでいる間に足した本');
        await expect.poll(() => remoteAsins(local), { message: '本Aがフォルダに届く' }).toContain(ASIN_A);
        await perm.promptOnNextReload();
        await page.reload();
        await expect(page.locator('#app-status-bar')).toContainText('保存先が未設定');
        await otherDeviceUpdateLocal(page, local.dirName);
        await addBook(page, ASIN_B, '未接続中に足した本');

        await openSettingsByClick(page, 'sync-section');
        await page.locator('#obsidian-sync-btn').click();
        const dlg = page.locator('#load-conflict-dialog');
        await expect(dlg).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dlg).toBeHidden();
        await page.waitForTimeout(1500);
        const afterClose = await observe(page);

        // 閉じた後にもう一度編集する (保存が走る＝保留中は書かずに戻る)
        await editMemo(page, ASIN_A, 'この端末で書いたメモ');
        await page.waitForTimeout(2500);
        const afterEdit = await observe(page);
        const folderHasB = (await remoteAsins(local)).includes(ASIN_B);

        await test.info().attach('記録 (ローカルフォルダ)', {
            body: JSON.stringify({ afterClose, afterEdit, folderHasB }, null, 2),
            contentType: 'application/json'
        });
        expect.soft(folderHasB, 'フォルダへは書かない (本Bは無い)').toBe(false);
        expectUnsavedShown('閉じた後', afterClose);
        expectUnsavedShown('閉じた後に編集した後', afterEdit);

        // ① 自動の再試行はしない: 再試行の間隔を短くしてあっても (bootLocalWithPrompt の前に入れた印)、
        // 行は警告のまま・「再試行」のボタンも出ない
        const row = page.locator('#app-status-bar [data-sync-failure="load-conflict"]');
        await expect(row).toHaveClass(/status-warn/);
        await expect(row.locator('[data-status-action="retry-sync"]')).toHaveCount(0);

        // 再読込でもう一度聞かれる (許可は戻っている)。閉じると、また「未保存」が出る
        await page.reload();
        await expect(dlg).toBeVisible({ timeout: 15_000 });
        await page.keyboard.press('Escape');
        await expect(dlg).toBeHidden();
        await expect(row).toBeVisible();

        // push 前の確認に見せる画像 (PC 幅・390 幅)
        await takeShots(page, 'local-unsaved');

        // ③ 状態バーの「選ぶ」から開き直し、「この端末の内容で保存先を上書き」を選ぶと、表示が消えてフォルダへ書かれる
        await row.locator('[data-status-action="resolve-hold"]').click();
        await expect(dlg).toBeVisible();
        await dlg.locator('.cfm-local').click();
        await expect(dlg).toBeHidden();
        await expect(row).toHaveCount(0);
        await expect.poll(() => remoteAsins(local), { message: '上書きで本Bがフォルダに届く' }).toContain(ASIN_B);
        const afterChoose = await observe(page);
        await test.info().attach('記録 (ローカルフォルダ・上書きを選んだ後)', { body: JSON.stringify(afterChoose, null, 2), contentType: 'application/json' });
        expect.soft(afterChoose.failureKinds, '選んだ後は「未保存」の行が無い').not.toContain('load-conflict');
        expect.soft(afterChoose.syncStatus, '選んだ後の同期欄は「同期済み」').toContain('同期済み');
    });
});

// ===== ハブ: 書き込みに失敗している間の編集と、他の端末の更新 → 再読込 =====

async function fillTextBlock(page, markdown) {
    await waitForArtTextFsEditor(page);
    await setArtTextFsEditorValue(page, markdown);
    await leaveForm(page);
}
async function leaveForm(page) {
    const done = page.locator('#art-fs-done');
    if (await done.isVisible()) await done.click();
}

/** 公開する記事を作る (tests/e2e/publish-conflict-hub.spec.js の createArticleWithBook と同じ手順) */
async function createArticleWithBook(page, title) {
    await page.evaluate(() => window.bookshelf.openPublishPagesModal());
    await page.click('#art-new');
    await page.fill('#art-title', title);
    await addBlock(page, 'text', 'first');
    await fillTextBlock(page, '本文サンプル。');
    await addBlock(page, 'shelf', 'last');
    await openArtSheet(page);
    await page.locator('#art-drawer-list .art-drawer-item').first().click();
    await closeArtSheet(page);
    await leaveForm(page);
    await flushArtSaveAndRemote(page);
    await expect(page.locator('#art-save-status')).toHaveText('保存しました', { timeout: 3000 });
    const id = await getArtEditingId(page);
    await showArtList(page);
    await closePublishPages(page);
    return id;
}

/** 記事の一覧 (#publish-pages-modal) が開いていれば Esc で閉じる */
async function closePublishPages(page) {
    const modal = page.locator('#publish-pages-modal');
    for (let i = 0; i < 3 && await modal.isVisible(); i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
    }
    await expect(modal).toBeHidden();
}

const failWrites = async (route) => {
    const m = route.request().method();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.fallback();
    return route.fulfill({ status: 503, body: 'offline (e2e)' });
};

// 他の端末での更新を模擬: ハブの library.json に本C (exportDate も他の端末の保存と同じく変わる)
function otherDeviceUpdateHub(state) {
    const lib = JSON.parse(state.files.get('private/library.json').content);
    lib.books.push({ asin: ASIN_C, title: '他の端末で足した本', authors: '', acquiredTime: Date.now(), readStatus: 'UNKNOWN', productImage: '', source: 'manual_add', addedDate: Date.now() });
    lib.exportDate = new Date(Date.now() + 1000).toISOString();
    state.seq += 1;
    state.files.set('private/library.json', { content: JSON.stringify(lib), etag: `"v${state.seq}"` });
}

test.describe('Asayake ハブ: 読込時の3択を選ばずに閉じた後 (イシュー#639)', () => {
    test('閉じた後に、保存先へ書いていないことが出て、公開が止まる', async ({ page }) => {
        const state = createHubStateForTest({ usedBytes: 0, email: 'load-conflict@example.com' });
        await mockHubForTest(page, state);
        const store = hubStoreForTest(state);
        const cfg = {
            method: 'hub', methodChosen: true,
            // 公開の名義 (username) まで入れる (無いと公開の入口が「ユーザー名を設定してください」で先に止まる)
            hub: {
                apiBase: HUB_BASE, key: state.key, uid: state.uid, siteId: state.siteId, email: state.email, plan: state.plan,
                publicBase: `${HUB_BASE}/public/${state.siteId}/`, username: state.username, bookshelfBase: publicBaseOf(state)
            },
            publish: { target: 'hub' }
        };
        // 入れるのはこのタブで最初の1回だけ (再読込のたびに入れ直すとアプリが書いた設定を上書きする)
        await page.addInitScript((c) => {
            if (sessionStorage.getItem('lcuSeeded')) return;
            sessionStorage.setItem('lcuSeeded', '1');
            localStorage.setItem('bookshelf_sync', JSON.stringify(c));
        }, cfg);
        const publishPosts = [];
        page.on('request', (req) => {
            if (req.method() === 'POST' && req.url() === `${HUB_BASE}/publish`) publishPosts.push(req.url());
        });

        await page.goto('index.html');
        await confirmOk(page); // 空の保存先の「新規データで初期化しますか？」
        await expect.poll(() => store.has(shelfFile('all'))).toBe(true);
        await addBook(page, ASIN_A, '書ける間に足した本');
        await expect.poll(() => remoteAsins(store), { message: '本Aが保存先に届く' }).toContain(ASIN_A);
        const articleId = await createArticleWithBook(page, '保留中の公開の確認');
        await expect.poll(() => page.evaluate(() => localStorage.getItem('virtualBookshelf_pendingSync')), { message: '保存が済んで未反映の印が消える' }).toBeNull();

        // 書き込みだけ失敗させて、この端末で編集する (未反映の印が立つ)
        await page.route(`${HUB_BASE}/**`, failWrites);
        await addBook(page, ASIN_B, '書けない間に足した本');
        await page.waitForTimeout(2000);
        otherDeviceUpdateHub(state);
        await page.unroute(`${HUB_BASE}/**`, failWrites);

        await page.reload();
        const dlg = page.locator('#load-conflict-dialog');
        await expect(dlg).toBeVisible({ timeout: 15_000 });
        await page.keyboard.press('Escape');
        await expect(dlg).toBeHidden();
        await page.waitForTimeout(1500);
        const afterClose = await observe(page);

        // ② 公開を画面から押す (#603 の公開ガードのE2E と同じ入口)
        const tryPublish = async () => {
            const postsBefore = publishPosts.length;
            await page.evaluate(() => window.bookshelf.openPublishPagesModal());
            await page.locator(`#art-list [data-id="${articleId}"] [data-act="publish"]`).click();
            // 公開の前の確認 (同意など) が出たら、その文を残して進める
            const cfm = page.locator('.cfm-overlay');
            const confirms = [];
            const shown = await cfm.first().waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
            if (shown) {
                confirms.push((await cfm.first().innerText()).replace(/\s+/g, ' ').trim());
                await cfm.first().locator('.cfm-ok').click();
            }
            // 止めた時の知らせ (toast は数秒で消えるので、出るのを待って文を残す)
            const stopToast = page.locator('.toast', { hasText: '公開を止めました' }).first();
            const toastSeen = await stopToast.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
            const toasts = toastSeen ? [(await stopToast.textContent()).replace(/\s+/g, ' ').trim()] : [];
            await page.waitForTimeout(1500); // 止まらなかった場合の公開の送信を待って数える
            const article = await page.evaluate((id) => window.bookshelf.publishArticleStore.get(id), articleId);
            const got = { confirms, posts: publishPosts.length - postsBefore, toasts, published: !!(article && article.published), remoteHasB: (await remoteAsins(store)).includes(ASIN_B) };
            await closePublishPages(page);
            return got;
        };
        const publish = await tryPublish();

        // 閉じた後にもう一度編集する (保存が走る＝保留中は書かずに戻る)
        await addBook(page, 'B0LCUNSD04', '閉じた後に足した本');
        await page.waitForTimeout(2500);
        const afterEdit = await observe(page);

        await test.info().attach('記録 (ハブ)', {
            body: JSON.stringify({ afterClose, publish, afterEdit }, null, 2),
            contentType: 'application/json'
        });
        expectUnsavedShown('閉じた後', afterClose);
        expect.soft(publish.posts, '公開の送信は0件').toBe(0);
        expect.soft(publish.toasts.join(' / '), '公開を止めた理由が出る').toContain('公開を止めました');
        expect.soft(publish.published, '記事は公開済みにならない').toBe(false);
        expectUnsavedShown('閉じた後に編集した後', afterEdit);

        // 再読込をまたいでも、保留がある間は公開が止まる (再読込でもう一度聞かれ、選ばずに閉じた後)
        await page.reload();
        await expect(dlg).toBeVisible({ timeout: 15_000 });
        await page.keyboard.press('Escape');
        await expect(dlg).toBeHidden();
        const row = page.locator('#app-status-bar [data-sync-failure="load-conflict"]');
        await expect(row).toBeVisible();
        const publishAfterReload = await tryPublish();
        await test.info().attach('記録 (ハブ・再読込の後の公開)', { body: JSON.stringify(publishAfterReload, null, 2), contentType: 'application/json' });
        expect.soft(publishAfterReload.posts, '再読込の後も公開の送信は0件').toBe(0);
        expect.soft(publishAfterReload.toasts.join(' / '), '再読込の後も公開を止めた理由が出る').toContain('公開を止めました');

        // push 前の確認に見せる画像 (PC 幅・390 幅)
        await takeShots(page, 'hub-unsaved');

        // ③ 状態バーの「選ぶ」から開き直し、「保存先の内容を読み込む」を選ぶと、表示が消えて保存先の内容 (他の端末の本C) になる
        await row.locator('[data-status-action="resolve-hold"]').click();
        await expect(dlg).toBeVisible();
        await dlg.locator('.cfm-remote').click();
        await expect(dlg).toBeHidden();
        await expect(row).toHaveCount(0);
        const afterChoose = await observe(page);
        const hasC = await page.evaluate((c) => (window.bookshelf.books || []).some((b) => b.asin === c), ASIN_C);
        await test.info().attach('記録 (ハブ・読み込むを選んだ後)', { body: JSON.stringify({ afterChoose, hasC }, null, 2), contentType: 'application/json' });
        expect.soft(afterChoose.failureKinds, '選んだ後は「未保存」の行が無い').not.toContain('load-conflict');
        expect.soft(afterChoose.syncStatus, '選んだ後の同期欄は「保存済み」').toContain('保存済み');
        expect.soft(hasC, '保存先の内容 (他の端末の本C) になる').toBe(true);
    });
});

// ===== 同じ種類の箇所 (b): 書き込み時の3択 (#sync-conflict-dialog・イシュー#616) を選ばずに閉じた後 =====
// step1 では見えた物を残すだけ (同じ仕組みに含めるかは step1 の tp で決める)。手順は門の E2E J6-4 と同じ。
test.describe('同じ種類 (b): 書き込み時の3択を選ばずに閉じた後 (イシュー#639 step1 の記録)', () => {
    test('2台で同じ本の短文メモを書いて衝突させ、端末Bで3択を Esc で閉じた後の表示を残す', async ({ page }) => {
        const BOOK = 'フィクスチャの本 1';
        const bookButton = (p) => p.getByRole('button', { name: BOOK, exact: true }).first();
        const memoBox = (p) => p.locator('.note-textarea[data-scope="all"]:visible').first();
        const savedNote = (p) => p.locator('.save-note-status:visible').first();
        const hub = createHubStateForTest();
        seedHubDataForTest(hub);
        await seedHubLoginForTest(page, hub, { method: 'hub', library: false });
        await mockHubForTest(page, hub);
        await bootAppForTest(page);
        await waitForHubStartupForTest(page);
        const other = await prepareOtherDeviceForTest(page, hub);
        try {
            await other.goto('index.html');
            await expect(other.locator('#loading')).toBeHidden({ timeout: 15000 });
            await expect(bookButton(other)).toBeVisible();
            await bookButton(page).click();
            await memoBox(page).fill('端末Aが先に書いたメモ');
            await expect(savedNote(page)).toContainText('保存しました');
            await waitForHubFileContainsForTest(hub, 'private/notes.json', '端末Aが先に書いたメモ');
            await bookButton(other).click();
            await memoBox(other).fill('端末Bが古い版のまま書いたメモ');
            await expect(savedNote(other)).toContainText('保存しました');
            const dlg = other.locator('#sync-conflict-dialog');
            await expect(dlg).toBeVisible({ timeout: 20000 });
            await other.keyboard.press('Escape');
            await expect(dlg).toBeHidden();
            await other.waitForTimeout(1500);
            const afterClose = await observe(other);
            const hubHasB = JSON.stringify(hubStoreForTest(hub).readJSON('private/notes.json') || {}).includes('端末Bが古い版のまま書いたメモ');
            await test.info().attach('記録 (b) 書き込み時の3択を閉じた後', {
                body: JSON.stringify({ afterClose, hubHasB }, null, 2),
                contentType: 'application/json'
            });
        } finally {
            await closeOtherDeviceForTest(other);
        }
    });
});
