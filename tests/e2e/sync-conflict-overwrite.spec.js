// 書き込みで衝突した時の「この端末の内容で保存先を上書き」(イシュー#645)。
// 2台 (端末Aと別の端末B) で同じ保存先を開き、Aが先に短文メモを書いて保存先に届いたあと、Bが古い版のまま同じ本の短文メモを
// 書くと、Bに書き込み時の選択 (#sync-conflict-dialog) が出る。そこで「この端末の内容で保存先を上書き」を押すと、
// 保存先を読み直してから (GitHub は tree の控えも取り直す) Bの内容で書き、次の保存も衝突しないことを、利用者の操作だけで見る。
// 読み直しに失敗した時 (通信なし) は、何も書かずに知らせ、衝突中の印と未反映の印を残して選び直せることも見る。
// 衝突はハブの模擬 (gate-hub.js) の ETag 照合と、GitHub の模擬 (gate-github.js) のまとめ保存の照合で起きる。内部からの注入はしない。
import { test, expect } from './helpers/test-base.js';
import { bootAppForTest } from './helpers/gate-setup.js';
import { createHubStateForTest, seedHubDataForTest, seedHubLoginForTest, mockHubForTest, waitForHubStartupForTest, waitForHubFileContainsForTest, hubStoreForTest } from './helpers/gate-hub.js';
import { createMockGitHubForTest, seedGitHubDataForTest, seedGitHubLoginForTest, mockGitHubForTest, waitForGitHubFileContainsForTest } from './helpers/gate-github.js';
import { prepareOtherDeviceForTest, closeOtherDeviceForTest } from './helpers/gate-device.js';

const BOOK = 'フィクスチャの本 1';
const MEMO_A = '#645 端末Aが先に書いた短文メモ';
const MEMO_B = '#645 端末Bが古い版のまま書いた短文メモ';
const MEMO_B2 = '#645 上書きの後に端末Bが続けて書いた短文メモ';
const OVERWRITE = 'この端末の内容で保存先を上書き';

const bookButton = (page) => page.getByRole('button', { name: BOOK, exact: true }).first();
const memoBox = (page) => page.locator('.note-textarea[data-scope="all"]:visible').first();
const savedNote = (page) => page.locator('.save-note-status:visible').first();
const conflictDialog = (page) => page.locator('#sync-conflict-dialog');

// GitHub の模擬の main が指すファイルの中身
function repoFile(gh, path) {
    const tree = gh.trees.get(gh.commits.get(gh.head).tree);
    const sha = tree.get(path);
    return sha ? String(gh.blobs.get(sha)) : null;
}

function githubStore() {
    const gh = createMockGitHubForTest();
    seedGitHubDataForTest(gh);
    return {
        store: gh,
        prepare: async (page) => { await seedGitHubLoginForTest(page, gh); await mockGitHubForTest(page, gh); },
        waitNotes: (text) => waitForGitHubFileContainsForTest(gh, 'private/notes.json', text),
        notes: () => repoFile(gh, 'private/notes.json') || ''
    };
}

function hubStore() {
    const hub = createHubStateForTest();
    seedHubDataForTest(hub);
    return {
        store: hub,
        prepare: async (page) => { await seedHubLoginForTest(page, hub, { method: 'hub', library: false }); await mockHubForTest(page, hub); },
        waitNotes: (text) => waitForHubFileContainsForTest(hub, 'private/notes.json', text),
        notes: () => JSON.stringify(hubStoreForTest(hub).readJSON('private/notes.json') || {})
    };
}

/** 端末Aと端末Bで開き、Aが先に書いた後にBが古い版のまま書いて、Bに書き込み時の選択が出るところまで進める */
async function makeWriteConflict(page, s, { beforeOpenOther } = {}) {
    await s.prepare(page);
    await bootAppForTest(page);
    await waitForHubStartupForTest(page);
    const other = await prepareOtherDeviceForTest(page, s.store);
    if (beforeOpenOther) await beforeOpenOther(other);
    await other.goto('index.html');
    await expect(other.locator('#loading')).toBeHidden({ timeout: 15000 });
    await expect(bookButton(other)).toBeVisible();

    await bookButton(page).click();
    await memoBox(page).fill(MEMO_A);
    await expect(savedNote(page)).toContainText('保存しました');
    await s.waitNotes(MEMO_A);

    await bookButton(other).click();
    await memoBox(other).fill(MEMO_B);
    await expect(savedNote(other)).toContainText('保存しました');
    await expect(conflictDialog(other)).toBeVisible({ timeout: 20000 });
    return other;
}

for (const [name, makeStore] of [['GitHub', githubStore], ['Asayake ハブ', hubStore]]) {
    test(`${name}: 書き込みで衝突した時に「この端末の内容で保存先を上書き」を選ぶと、保存先が端末の内容になり、続けて書いても衝突しない`, async ({ page }) => {
        const s = makeStore();
        const other = await makeWriteConflict(page, s);
        const dlg = conflictDialog(other);

        // 読込時と同じ3つが出て、最初のフォーカスは書き出す
        await expect(dlg.getByRole('button')).toHaveCount(3);
        await expect(dlg.getByRole('button', { name: '保存先の内容を読み込む' })).toBeVisible();
        await expect(dlg.getByRole('button', { name: OVERWRITE })).toBeVisible();
        await expect(dlg.getByRole('button', { name: 'この端末の内容を書き出す' })).toBeFocused();
        await expect(dlg).toContainText('どちらの内容を使うか選んでください。');

        await dlg.getByRole('button', { name: OVERWRITE }).click();
        await expect(dlg).toHaveCount(0);

        // 保存先が端末Bの内容になる (端末Aの短文メモは残らない)
        await s.waitNotes(MEMO_B);
        expect(s.notes()).not.toContain(MEMO_A);
        await expect(memoBox(other)).toHaveValue(MEMO_B);

        // 続けて書いても衝突せずに届く
        await memoBox(other).fill(MEMO_B2);
        await expect(savedNote(other)).toContainText('保存しました');
        await s.waitNotes(MEMO_B2);
        await expect(conflictDialog(other)).toHaveCount(0);

        // 端末Bを開き直しても、端末の内容 (続けて書いた短文メモ) が入る
        await other.reload();
        await expect(other.locator('#loading')).toBeHidden({ timeout: 15000 });
        await expect(other.getByText('最新のデータを確認しています…')).toHaveCount(0, { timeout: 15000 });
        await expect(memoBox(other).or(bookButton(other)).first()).toBeVisible();
        if (!(await memoBox(other).isVisible())) await bookButton(other).click();
        await expect(memoBox(other)).toHaveValue(MEMO_B2);
        await expect(conflictDialog(other)).toHaveCount(0);

        await closeOtherDeviceForTest(other);
    });
}

// ハブの一覧の控え (js/hub-adapter.js の ETAG_MAP_TTL_MS=3秒) の内側で上書きを選んでも、読み直しが一覧を取り直して書ける (イシュー#679)。
// 端末Bの時計 (Date.now) を止めて、起動の読込で取った一覧から3秒たたない状態を必ず作る (タイマーは動く)。
// 直す前は、上書きの読み直しが衝突より前の一覧のまま古い版を返し、上書きのまとめ書きがまた 412 になって届かなかった
test('Asayake ハブ: 前の一覧から3秒たたないうちに上書きを選んでも、読み直しで一覧を取り直し、保存先が端末の内容になる', async ({ page }) => {
    const s = hubStore();
    const other = await makeWriteConflict(page, s, { beforeOpenOther: (o) => o.clock.setFixedTime(new Date()) });
    const dlg = conflictDialog(other);
    await dlg.getByRole('button', { name: OVERWRITE }).click();
    await expect(dlg).toHaveCount(0);
    await s.waitNotes(MEMO_B);
    expect(s.notes()).not.toContain(MEMO_A);
    await expect(conflictDialog(other)).toHaveCount(0);
    await closeOtherDeviceForTest(other);
});

test('GitHub: 上書きを選んだ時に保存先を読み直せないと、何も書かずに知らせ、衝突中の印と未反映の印を残して選び直せる', async ({ page }) => {
    const s = githubStore();
    const other = await makeWriteConflict(page, s);
    const dlg = conflictDialog(other);
    const headBefore = s.store.head;

    // 端末Bから保存先への通信を落とす
    const writes = [];
    other.on('request', (req) => { if (req.url().startsWith('https://api.github.com/') && req.method() !== 'GET') writes.push(req.method()); });
    const offline = (route) => route.abort('internetdisconnected');
    await other.context().route('https://api.github.com/**', offline);

    await dlg.getByRole('button', { name: OVERWRITE }).click();
    await expect(other.getByText('保存先を読み込めなかったので、上書きしていません。')).toBeVisible();
    // 選び直せる (同じ選択がもう一度出る)。印は残り、保存先は端末Aのまま・書き込みは0
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: OVERWRITE })).toBeVisible();
    const marks = await other.evaluate(() => ({
        conflict: localStorage.getItem('virtualBookshelf_syncConflict'),
        pending: localStorage.getItem('virtualBookshelf_pendingSync')
    }));
    expect(marks.conflict).not.toBeNull();
    expect(marks.pending).toBe('1');
    expect(s.store.head).toBe(headBefore);
    expect(s.notes()).toContain(MEMO_A);
    expect(writes).toEqual([]);

    // 通信が戻ってから選び直すと、端末Bの内容で上書きされる
    await other.context().unroute('https://api.github.com/**', offline);
    await dlg.getByRole('button', { name: OVERWRITE }).click();
    await s.waitNotes(MEMO_B);
    expect(s.notes()).not.toContain(MEMO_A);
    await expect(conflictDialog(other)).toHaveCount(0);

    await closeOtherDeviceForTest(other);
});
