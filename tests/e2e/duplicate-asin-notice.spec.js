// イシュー#484: 別の本に同じ asin が付いていると notes/bookOrder/exclusions を共有してしまう問題。
// #480(重複asinで一覧の差分描画が壊れる件)とは別課題として切り出された(480-step2-decision.md)。
// 対処は(A)検出+付け直し案内(データ構造は変えない・484-step2-decision.md)。
// 確かめること(②指示・2026-11-02 05:44の承認メモ＋06:13の差し戻し訂正):
//   1. 一覧に重複ASIN検出バッジが出る(別の本=B00I8AT186型)
//   2. 本の詳細で付け直し案内が出る
//   3. ASINを付け直す(既存の「オリジナルASIN」編集欄+migrateUserData)
//   4. 付け替え直後: もう一方の本(旧ASINのまま)にメモ・除外・非表示・本棚所属が残っている
//      (旧実装は「移す」=もう一方の本から消えてしまっていた。既存データは削除・統合しない方針に
//      反するため②差し戻しで訂正。新ASIN側には同じ内容がコピーされる)
//   5. その後の新しい変更(メモ・除外)は新ASIN側だけに効き、もう一方の本には伝播しない
//   6. 重複していない本の通常の付け直しは、従来どおり移して元を消す(1ケース)
//   7. 同じ本の二重登録(B0F2TC5B79型)は文言が違う(削除・統合を促さない)
import { test, expect } from './helpers/test-base.js';

const DUP_ASIN = 'B00I8AT186'; // #480/#484の実データ(tmp/401)で確認済みの実例asin(上巻/下巻)
const SELF_DUP_ASIN = 'B0F2TC5B79'; // 同じ本の二重登録型
const SOLO_ASIN = 'B0SOLO0001'; // 重複していない単独本(通常の付け直しケース用)
const NEW_ASIN = 'BNEWASIN01'; // 付け替え先(10桁英数字・他と非重複)
const NEW_ASIN2 = 'BNEWASIN02'; // 単独本の付け替え先

const books = [
    { asin: DUP_ASIN, title: '上巻', authors: '著者A', acquiredTime: 1700000000000, source: 'kindle_import', addedDate: 1700000000000, readStatus: 'UNKNOWN', productImage: '' },
    { asin: DUP_ASIN, title: '下巻', authors: '著者A', acquiredTime: 1700000001000, source: 'kindle_import', addedDate: 1700000001000, readStatus: 'UNKNOWN', productImage: '' },
    { asin: SELF_DUP_ASIN, title: '同じ本', authors: '著者B', acquiredTime: 1700000002000, source: 'kindle_import', addedDate: 1700000002000, readStatus: 'UNKNOWN', productImage: '' },
    { asin: SELF_DUP_ASIN, title: '同じ本', authors: '著者B', acquiredTime: 1700000002001, source: 'kindle_import', addedDate: 1700000002001, readStatus: 'UNKNOWN', productImage: '' },
    { asin: SOLO_ASIN, title: '単独の本', authors: '著者C', acquiredTime: 1700000003000, source: 'kindle_import', addedDate: 1700000003000, readStatus: 'UNKNOWN', productImage: '' },
];
const library = { books, metadata: { totalBooks: books.length } };
const userData = {
    bookshelves: [
        { id: 'all', internalId: 'fixall484', name: 'すべての本', iconName: 'library', isSpecial: true, books: books.map(b => b.asin), notes: {} },
        // 非特殊本棚: DUP_ASIN と SOLO_ASIN が所属している(付け直し後の移行/コピーの確認用)
        { id: 'fiction', internalId: 'fixfiction484', name: 'フィクション', iconName: 'book', isSpecial: false, parent: 'fixall484', books: [DUP_ASIN, SOLO_ASIN], notes: {} }
    ],
    // 共有されている状態を最初から用意: notes[DUP_ASIN] は上巻・下巻のどちらから見ても同じ値
    notes: { [DUP_ASIN]: { memo: '上下巻共通の感想', rating: 4 }, [SOLO_ASIN]: { memo: '単独本のメモ', rating: 2 } },
    settings: { sortOrder: 'custom', sortDirection: 'asc' },
    // bookOrder.all に DUP_ASIN が2回出現する(上巻・下巻それぞれの位置)。indexOf方式では
    // どちらがどちらか区別できない(step1実測・484-results.md)。
    bookOrder: { all: books.map(b => b.asin), fiction: [DUP_ASIN, SOLO_ASIN] },
    // 非表示・除外も最初から共有されている状態にする(②差し戻し2026-11-02で追加検証項目)。
    // hiddenBooks/exclusionsはいずれもapplyFiltersの絞り込みには使われない(本棚一覧表示には
    // 影響しない・コード確認済み)ため、ここに値があっても一覧の表示件数は変わらない。
    hiddenBooks: [DUP_ASIN, SOLO_ASIN],
    _storage: { exclusions: [DUP_ASIN, SOLO_ASIN] },
    stats: {}, version: '2.0'
};

async function setup(page) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), JSON.stringify(library)]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && window.bookshelf.books && window.bookshelf.books.length > 0, null, { timeout: 60000 }); // userData も待つ (books だけだと起動の途中の null の userData で switchBookshelf が落ちることがある・イシュー#674)
    await page.evaluate(() => {
        window.bookshelf.saveUserData = async () => {};
        // 除外は confirmDialog (カスタムUI・ADR-131 overlays.open経由) の承諾が要る。
        // 検証対象は除外ロジック自体(_excludeAsinCore)なので、確認ダイアログは常にOKにする。
        window.confirmDialog = async () => true;
        window.bookshelf.switchBookshelf('all');
    });
    await page.waitForFunction((n) => document.querySelectorAll('#bookshelf > .book-item').length === n, books.length);
    return errors;
}

// 本詳細ペインが開いて一覧(左ペイン)が狭まった後、content-visibility:auto下のカードで
// Playwrightの可視判定(bounding box)が安定しないことがある(実機で検出)。ネイティブ click() を
// 直接呼んで座標判定を避ける(操作対象はアプリのクリックハンドラそのものなので経路は変えていない)。
async function clickBookCard(page, asin, index = 0) {
    await page.evaluate(([a, i]) => {
        document.querySelectorAll(`#bookshelf > .book-item[data-asin="${a}"]`)[i].click();
    }, [asin, index]);
}

// 編集モードで「オリジナルASIN」欄に新ASINを入力して保存する(付け直し操作そのもの)。
async function repointOriginalAsin(page, newAsin) {
    await page.locator('#book-detail-pane .edit-mode-btn').click();
    await page.locator('#book-detail-pane .edit-original-asin').fill(newAsin);
    await page.locator('#book-detail-pane .cancel-edit-btn').click();
    await page.waitForFunction((na) => !!(window.bookshelf.userData.notes && window.bookshelf.userData.notes[na]), newAsin);
}

test('重複ASIN検出バッジが一覧に出る(別の本=ASIN共有・同じ本の二重登録=重複登録で文言を分ける)', async ({ page }) => {
    await setup(page);
    // 別の本に同じASIN(B00I8AT186型): 上巻・下巻の両方に「ASIN共有」バッジが出る
    const dupCards = page.locator(`#bookshelf > .book-item[data-asin="${DUP_ASIN}"]`);
    await expect(dupCards).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
        const badge = dupCards.nth(i).locator('.book-badge-warn');
        await expect(badge).toHaveText('ASIN共有');
    }
    // 同じ本の二重登録(B0F2TC5B79型): 「重複登録」で文言が違う(削除・統合を促す語を含まない)
    const selfDupCards = page.locator(`#bookshelf > .book-item[data-asin="${SELF_DUP_ASIN}"]`);
    await expect(selfDupCards).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
        const badge = selfDupCards.nth(i).locator('.book-badge-warn');
        await expect(badge).toHaveText('重複登録');
        const title = await badge.getAttribute('title');
        // 「削除の必要はありません」のような否定形は許すが、削除・統合を促す文言は禁止(②指示)
        expect(title).not.toMatch(/削除してください|統合してください|片方を消して|どちらかを削除/);
    }
});

test('本の詳細に付け直し案内が出て、付け替え直後はもう一方の本に設定が残り(コピー)、その後の新しい変更は伝播しない', async ({ page }) => {
    const errors = await setup(page);

    // 1. 上巻(1枚目)を開く → 重複ASIN案内が出る
    await clickBookCard(page, DUP_ASIN, 0);
    const notice = page.locator('#book-detail-pane .bd-dup-asin-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('共有されています');
    // 「不要な方は削除してください」(付け直し後に両方へ内容が残る旨の案内)は②の追加指示どおりの
    // 正しい文言。禁止すべきは二重登録型(SELF_DUP_ASIN)側の「削除・統合を促す」文言だけ(1本目のテストで確認)。

    // 2. 編集モードに入り、「オリジナル ASIN」欄(book.asin自体を書き換える方。「変更後ASIN」欄は
    //    表示・リンク用の上書き(book.updatedAsin)でありmigrateUserDataは呼ばれない)に新ASINを
    //    入力して保存 (付け直し)
    await repointOriginalAsin(page, NEW_ASIN);

    // 3. 付け替え直後(②差し戻しで訂正): もう一方の本(下巻・旧ASINのまま)は library.books に
    //    まだ残っているため、notes/hiddenBooks/exclusions/bookshelves[].books は「コピー」になり、
    //    旧ASIN側にもそのまま残る(削除しない)。新ASIN側にも同じ内容がある。
    const afterMigrate = await page.evaluate(() => ({
        notes: window.bookshelf.userData.notes,
        hiddenBooks: window.bookshelf.userData.hiddenBooks,
        exclusions: window.bookshelf.userData._storage.exclusions,
        fictionBooks: window.bookshelf.userData.bookshelves.find((b) => b.id === 'fiction').books,
        bookOrderAll: window.bookshelf.userData.bookOrder.all,
    }));
    // notes: 両方に同じ内容が残る
    expect(afterMigrate.notes[NEW_ASIN]?.memo).toBe('上下巻共通の感想');
    expect(afterMigrate.notes[DUP_ASIN]?.memo).toBe('上下巻共通の感想'); // 下巻側にも残る(②訂正)
    // hiddenBooks: 両方に残る
    expect(afterMigrate.hiddenBooks).toContain(NEW_ASIN);
    expect(afterMigrate.hiddenBooks).toContain(DUP_ASIN);
    // exclusions: 両方に残る
    expect(afterMigrate.exclusions).toContain(NEW_ASIN);
    expect(afterMigrate.exclusions).toContain(DUP_ASIN);
    // 本棚所属: 両方に残る
    expect(afterMigrate.fictionBooks).toContain(NEW_ASIN);
    expect(afterMigrate.fictionBooks).toContain(DUP_ASIN);
    // bookOrder: ②指示どおり現状の実装のまま(重複2件のうち1件だけが新ASINに置き換わる・コピーではない)
    expect(afterMigrate.bookOrderAll.filter((a) => a === NEW_ASIN).length).toBe(1);
    expect(afterMigrate.bookOrderAll.filter((a) => a === DUP_ASIN).length).toBe(1);
    expect(afterMigrate.bookOrderAll.length).toBe(books.length); // 並びは蔵書と同じ5件 (新ASINを2回入れない・イシュー#674)

    // 4. もう一方の本(下巻・旧ASINのまま)を開く。下巻はもうDUP_ASINを使う本が1件だけになった
    //    (上巻は新ASINへ移った)ので重複ではなくなり案内は出ない。ただしメモは「コピー」された
    //    ままなので、まだ元の内容が残っている(不要なら利用者が消す・案内文にその旨を記載済み)。
    await clickBookCard(page, DUP_ASIN, 0);
    await expect(page.locator('#book-detail-pane .bd-dup-asin-notice')).toHaveCount(0);
    await expect(page.locator('#book-detail-pane .note-textarea')).toHaveValue('上下巻共通の感想');

    // 5. 付け替えた本(新ASIN)を開き、新しいメモを書く → 下巻(旧ASIN)には伝播しない(元の値のまま)
    await clickBookCard(page, NEW_ASIN, 0);
    await page.locator('#book-detail-pane .note-textarea').fill('上巻だけの新しい感想');
    await page.waitForFunction((na) => window.bookshelf.userData.notes[na]?.memo === '上巻だけの新しい感想', NEW_ASIN);
    const notesAfterEdit = await page.evaluate(() => window.bookshelf.userData.notes);
    expect(notesAfterEdit[NEW_ASIN].memo).toBe('上巻だけの新しい感想');
    expect(notesAfterEdit[DUP_ASIN].memo).toBe('上下巻共通の感想'); // 下巻は無変化(伝播しない)

    // 6. 付け替えた本(新ASIN)をさらに除外する → 下巻(旧ASIN)は一覧から消えない(伝播しない・#480実測
    //    で確認した「exclusionsはasinの配列=除外操作は同じasinの全ての本に効く」という共有が、
    //    ASIN分離後は起きないことの確認)。_excludeAsinCore は library.books を asin で filter する
    //    ため、分離前にこの操作をすると両方消えてしまう(共有の実害そのもの)が、分離後は新ASIN側の
    //    1件だけが消える。
    await clickBookCard(page, NEW_ASIN, 0);
    await page.locator('#book-detail-pane .edit-mode-btn').click();
    await page.locator('#book-detail-pane .exclude-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('#bookshelf > .book-item').length === 4);
    const afterExclude = await page.evaluate(() => ({
        remainingAsins: window.bookshelf.books.map((b) => b.asin),
    }));
    expect(afterExclude.remainingAsins).toContain(DUP_ASIN); // 下巻は残っている(除外が伝播していない)
    expect(afterExclude.remainingAsins).not.toContain(NEW_ASIN); // 上巻(新ASIN)は除外されて消えた

    expect(errors).toEqual([]);
});

test('重複していない単独本の通常の付け直しは、従来どおり移して元を消す', async ({ page }) => {
    await setup(page);
    // SOLO_ASINは最初から1冊しかない(重複なし)。付け直すとmigrateUserDataの
    // oldAsinStillUsed判定はfalseになり、従来どおりmove+deleteになる。
    await clickBookCard(page, SOLO_ASIN, 0);
    await expect(page.locator('#book-detail-pane .bd-dup-asin-notice')).toHaveCount(0); // 重複が無いので案内は出ない
    await repointOriginalAsin(page, NEW_ASIN2);

    const after = await page.evaluate(() => ({
        notes: window.bookshelf.userData.notes,
        hiddenBooks: window.bookshelf.userData.hiddenBooks,
        exclusions: window.bookshelf.userData._storage.exclusions,
        fictionBooks: window.bookshelf.userData.bookshelves.find((b) => b.id === 'fiction').books,
    }));
    expect(after.notes[NEW_ASIN2]?.memo).toBe('単独本のメモ');
    expect(after.notes[SOLO_ASIN]).toBeUndefined(); // 旧ASIN側は消える(move+delete、従来どおり)
    expect(after.hiddenBooks).toContain(NEW_ASIN2);
    expect(after.hiddenBooks).not.toContain(SOLO_ASIN);
    expect(after.exclusions).toContain(NEW_ASIN2);
    expect(after.exclusions).not.toContain(SOLO_ASIN);
    expect(after.fictionBooks).toContain(NEW_ASIN2);
    expect(after.fictionBooks).not.toContain(SOLO_ASIN);
});
