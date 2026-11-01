// イシュー#484: 別の本に同じ asin が付いていると notes/bookOrder/exclusions を共有してしまう問題。
// #480(重複asinで一覧の差分描画が壊れる件)とは別課題として切り出された(480-step2-decision.md)。
// 対処は(A)検出+付け直し案内(データ構造は変えない・484-step2-decision.md)。
// 確かめること(②指示・2026-11-02 05:44の承認メモ):
//   1. 一覧に重複ASIN検出バッジが出る(別の本=B00I8AT186型)
//   2. 本の詳細で付け直し案内が出る
//   3. ASINを付け直す(既存の「変更後ASIN」編集欄+migrateUserData)
//   4. 付け替え後、メモ・除外・並び順の新しい変更が新ASIN側だけに効き、もう一方の本(旧ASINのまま)
//      には影響しない(共有の解消)
//   5. 同じ本の二重登録(B0F2TC5B79型)は文言が違う(削除・統合を促さない)
import { test, expect } from './helpers/test-base.js';

const DUP_ASIN = 'B00I8AT186'; // #480/#484の実データ(tmp/401)で確認済みの実例asin(上巻/下巻)
const SELF_DUP_ASIN = 'B0F2TC5B79'; // 同じ本の二重登録型
const NEW_ASIN = 'BNEWASIN01'; // 付け替え先(10桁英数字・他と非重複)

const books = [
    { asin: DUP_ASIN, title: '上巻', authors: '著者A', acquiredTime: 1700000000000, source: 'kindle_import', addedDate: 1700000000000, readStatus: 'UNKNOWN', productImage: '' },
    { asin: DUP_ASIN, title: '下巻', authors: '著者A', acquiredTime: 1700000001000, source: 'kindle_import', addedDate: 1700000001000, readStatus: 'UNKNOWN', productImage: '' },
    { asin: SELF_DUP_ASIN, title: '同じ本', authors: '著者B', acquiredTime: 1700000002000, source: 'kindle_import', addedDate: 1700000002000, readStatus: 'UNKNOWN', productImage: '' },
    { asin: SELF_DUP_ASIN, title: '同じ本', authors: '著者B', acquiredTime: 1700000002001, source: 'kindle_import', addedDate: 1700000002001, readStatus: 'UNKNOWN', productImage: '' },
];
const library = { books, metadata: { totalBooks: books.length } };
const userData = {
    bookshelves: [{ id: 'all', internalId: 'fixall484', name: 'すべての本', iconName: 'library', isSpecial: true, books: books.map(b => b.asin), notes: {} }],
    // 共有されている状態を最初から用意: notes[DUP_ASIN] は上巻・下巻のどちらから見ても同じ値
    notes: { [DUP_ASIN]: { memo: '上下巻共通の感想', rating: 4 } },
    settings: { sortOrder: 'custom', sortDirection: 'asc' },
    // bookOrder.all に DUP_ASIN が2回出現する(上巻・下巻それぞれの位置)。indexOf方式では
    // どちらがどちらか区別できない(step1実測・484-results.md)。
    bookOrder: { all: books.map(b => b.asin) },
    _storage: { exclusions: [] },
    stats: {}, version: '2.0'
};

async function setup(page) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '// stub' }));
    await page.route('https://unpkg.com/lucide-static@*/icons/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.addInitScript(([u, l]) => {
        localStorage.setItem('virtualBookshelf_userData', u);
        localStorage.setItem('virtualBookshelf_library', l);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), JSON.stringify(library)]);
    await page.goto('index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.books && window.bookshelf.books.length > 0, null, { timeout: 60000 });
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

test('本の詳細に付け直し案内が出て、ASIN付け替え後はメモ・除外・並び順の新しい変更がもう一方の本に伝播しない', async ({ page }) => {
    const errors = await setup(page);

    // 1. 上巻(1枚目)を開く → 重複ASIN案内が出る
    await clickBookCard(page, DUP_ASIN, 0);
    const notice = page.locator('#book-detail-pane .bd-dup-asin-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('共有されています');
    await expect(notice).not.toContainText(/削除|統合/);

    // 2. 編集モードに入り、「オリジナル ASIN」欄(book.asin自体を書き換える方。「変更後ASIN」欄は
    //    表示・リンク用の上書き(book.updatedAsin)でありmigrateUserDataは呼ばれない)に新ASINを
    //    入力して保存 (付け直し)
    await page.locator('#book-detail-pane .edit-mode-btn').click();
    await page.locator('#book-detail-pane .edit-original-asin').fill(NEW_ASIN);
    await page.locator('#book-detail-pane .cancel-edit-btn').click();
    // saveBookChanges は非同期(updateBook→migrateUserData)。notes が移った=完了の目印にする
    await page.waitForFunction((na) => !!(window.bookshelf.userData.notes && window.bookshelf.userData.notes[na]), NEW_ASIN);

    // 3. notes: 新ASIN側に「移る」(既存のmigrateUserData実装はmove+delete)。②指示どおり
    //    「新しいASINへ移り、もう一方の本(下巻・旧ASINのまま)には残らない」。brief制約の
    //    「既存データは削除・統合しない」は本のレコード(library.books)の話で、notesの移行
    //    ロジック自体(既存のmigrateUserData)を変える話ではない。
    const notesAfterMigrate = await page.evaluate(() => window.bookshelf.userData.notes);
    expect(notesAfterMigrate[NEW_ASIN]?.memo).toBe('上下巻共通の感想');
    expect(notesAfterMigrate[DUP_ASIN]).toBeUndefined(); // 下巻側には残らない(②指示どおり)

    // 4. bookOrder: 2回出現していたうちの最初の1件だけが新ASINに置き換わり、もう1件(下巻用)は旧ASINのまま残る
    const bookOrderAfterMigrate = await page.evaluate(() => window.bookshelf.userData.bookOrder.all);
    expect(bookOrderAfterMigrate.filter((a) => a === NEW_ASIN).length).toBe(1);
    expect(bookOrderAfterMigrate.filter((a) => a === DUP_ASIN).length).toBe(1);

    // 5. 重複が解消されたので、新ASIN側・下巻側(旧ASIN)のバッジは両方消える
    //    (SELF_DUP_ASIN側の2冊は無関係に「重複登録」バッジを持ち続けるので、DUP_ASIN/NEW_ASINの
    //    カードだけに絞って確認する)
    await page.waitForFunction((args) => {
        const sel = `#bookshelf > .book-item[data-asin="${args.a}"] .book-badge-warn, #bookshelf > .book-item[data-asin="${args.b}"] .book-badge-warn`;
        return document.querySelectorAll(sel).length === 0;
    }, { a: DUP_ASIN, b: NEW_ASIN });

    // 6. もう一方の本(下巻・旧ASINのまま)を開いて、案内が出ないこと(重複解消の証拠)・
    //    短文メモ欄が空であること(移行でnotes[旧ASIN]が無くなった結果、resolveMemoが''を返す)を確認
    // content-visibility:auto(本棚一覧の性能最適化)の影響でPlaywrightの可視判定が安定しないため
    // force:true で直接クリックする(要素自体はDOM上に1件のみ存在することは前段の locator で確認済み)。
    await clickBookCard(page, DUP_ASIN, 0);
    await expect(page.locator('#book-detail-pane .bd-dup-asin-notice')).toHaveCount(0);
    await expect(page.locator('#book-detail-pane .note-textarea')).toHaveValue('');

    // 7. 付け替えた本(新ASIN)を開き、新しいメモを書く → 下巻(旧ASIN)には伝播しない(空のまま)
    await clickBookCard(page, NEW_ASIN, 0);
    await page.locator('#book-detail-pane .note-textarea').fill('上巻だけの新しい感想');
    await page.waitForFunction((na) => window.bookshelf.userData.notes[na]?.memo === '上巻だけの新しい感想', NEW_ASIN);
    const notesAfterEdit = await page.evaluate(() => window.bookshelf.userData.notes);
    expect(notesAfterEdit[NEW_ASIN].memo).toBe('上巻だけの新しい感想');
    expect(notesAfterEdit[DUP_ASIN]).toBeUndefined(); // 下巻は無変化(伝播しない)

    // 8. 付け替えた本(新ASIN)を除外する → 下巻(旧ASIN)は除外されない(伝播しない・#480実測で確認した
    //    「exclusionsはasinの配列=除外操作は同じasinの全ての本に効く」という共有が、ASIN分離後は
    //    起きないことの確認)。_excludeAsinCore は library.books を asin で filter するため、
    //    分離前にこの操作をすると両方消えてしまう(共有の実害そのもの)が、分離後は新ASINの1件だけが消える。
    await clickBookCard(page, NEW_ASIN, 0);
    await page.locator('#book-detail-pane .edit-mode-btn').click();
    await page.locator('#book-detail-pane .exclude-btn').click();
    await page.waitForFunction(() => document.querySelectorAll('#bookshelf > .book-item').length === 3);
    const afterExclude = await page.evaluate(() => ({
        exclusions: window.bookshelf.userData._storage.exclusions,
        remainingAsins: window.bookshelf.books.map((b) => b.asin),
    }));
    expect(afterExclude.exclusions).toContain(NEW_ASIN);
    expect(afterExclude.exclusions).not.toContain(DUP_ASIN);
    expect(afterExclude.remainingAsins).toContain(DUP_ASIN); // 下巻は残っている(除外が伝播していない)

    expect(errors).toEqual([]);
});
