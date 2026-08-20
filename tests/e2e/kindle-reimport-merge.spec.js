// Kindle 再取込のマージが実UIから到達すること (イシュー#68)。
// #41 で BookManager 側にマージ実装を入れたが、renderBookList/importSelectedBooks の
// 二重フィルタで実UIから一度も呼ばれずデッドコードだった。bbc068f (#41差し戻し) で
// VirtualBookshelf.importSelectedBooks() が選択の有無と無関係に既存ASIN分を合成して
// BookManager へ渡す方式に直り、イシュー#68 では空値キー削除の防御を追加した。
// ここでは内部メソッド直呼びではなく、取込モーダルの実DOM操作 (postMessage 注入 →
// #select-all-books → #import-selected-books、および #kindle-paste-input →
// #import-from-paste) で更新経路を通し、その結果をカード/絞り込み/結果表示/内部状態で検証する。
import { test, expect } from './helpers/test-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUserData = JSON.parse(readFileSync(join(here, '../fixtures/fixture-userdata.json'), 'utf-8'));
const fixtureLibrary = readFileSync(join(here, '../fixtures/fixture-library.json'), 'utf-8');

async function bootApp(page, { exclusions = [] } = {}) {
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    const userData = JSON.parse(JSON.stringify(fixtureUserData));
    userData._storage.exclusions = exclusions;
    await page.addInitScript(([userDataStr, library]) => {
        localStorage.setItem('virtualBookshelf_userData', userDataStr);
        localStorage.setItem('virtualBookshelf_library', library);
        localStorage.setItem('bookshelf_sync', JSON.stringify({ method: 'local' }));
    }, [JSON.stringify(userData), fixtureLibrary]);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.bookshelf && window.bookshelf.userData && (window.bookshelf.books || []).length > 0);
    await page.evaluate(() => { window.bookshelf.saveUserData = async () => {}; });
    return errors;
}

/** ブックマークレット経路 (postMessage) で取込モーダルを実DOM操作し、items を注入して取込を実行する */
async function importViaBookmarklet(page, items) {
    await page.evaluate(() => {
        window.open = () => ({ closed: false });
        window.bookshelf.userData.settings.extensionImportOrigins = [location.origin];
        window.bookshelf.showImportModal();
    });
    await page.locator('#open-amazon-for-import').click();
    await page.evaluate((items) => {
        window.postMessage({ type: 'kindleBookshelfExport', ok: true, items }, location.origin);
    }, items);
    await expect(page.locator('#book-selection')).toBeVisible();
    // 既存ASIN分は checkbox が disabled のまま (新規追加可否のトグル)。
    // 選択できるのは新規分だけだが、bbc068f の設計により既存ASIN分は選択と無関係に
    // 「取り込む」ボタンで自動的にマージされる。
    await page.locator('#select-all-books').click();
    await page.locator('#import-selected-books').click();
}

/** 貼り付け取込経路 (#kindle-paste-input) で取込モーダルを実DOM操作する */
async function importViaPaste(page, items) {
    await page.evaluate(() => window.bookshelf.showImportModal());
    // 方式④「取込データを直接渡す」は初回準備完了フラグが立っていると畳まれる
    // (_renderImportLanes)。このテストは先にブックマークレット経路を実行済みでフラグが
    // 立っているため、details を開いてから貼り付け欄を操作する。
    const dataDetails = page.locator('#import-method-data');
    if (!(await dataDetails.evaluate((el) => el.open))) {
        await dataDetails.locator('summary').click();
    }
    await page.locator('#kindle-paste-input').fill(JSON.stringify(items));
    await page.locator('#import-from-paste').click();
    await expect(page.locator('#book-selection')).toBeVisible();
    await page.locator('#select-all-books').click();
    await page.locator('#import-selected-books').click();
}

test('実UI操作: 既存ASIN再取込でバッジ付与・書誌/addedDate/短文メモ/並び順維持・更新数実数化・除外済み不変', async ({ page }) => {
    const errors = await bootApp(page, { exclusions: ['B0EXCLUDED1'] });
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(5);

    const beforeOrder = await page.evaluate(() => window.bookshelf.userData.bookOrder.all.slice());
    const beforeAsin2 = await page.evaluate(() => window.bookshelf.userData.notes['B000000002']);

    const items = [
        // 既存 B000000001: 借用中KUへ変化。title/readStatus はフィクスチャ側 ('READ') を維持すべき
        { title: 'フィクスチャの本 1 (Amazon側タイトル変化・無視すべき)', authors: '著者A', acquiredTime: 1700000000000, readStatus: 'UNKNOWN', asin: 'B000000001', productImage: '', originType: 'Ku', statusFromPlatformSearch: 'Active', lendingType: 'KU', lendingStatus: 'OnLoan' },
        // 既存 B000000002 (短文メモ「テストメモ」あり): 返却済みKUへ変化
        { title: 'フィクスチャの本 2', authors: '著者A', acquiredTime: 1700000001000, readStatus: 'UNKNOWN', asin: 'B000000002', productImage: '', originType: 'Ku', statusFromPlatformSearch: 'Revoked', lendingType: 'KU', lendingStatus: 'Terminated' },
        // 新規1件
        { title: '新規本', authors: '著者N', acquiredTime: 1700000020000, readStatus: 'UNKNOWN', asin: 'B0NEWITEM1', productImage: '', originType: 'Purchase', statusFromPlatformSearch: 'Active' },
        // 除外済み ASIN (蔵書に存在しない・exclusions 登録済み)。増えても変わってもいけない
        { title: '除外済みの本', authors: '著者X', acquiredTime: 1700000030000, readStatus: 'UNKNOWN', asin: 'B0EXCLUDED1', productImage: '', originType: 'Purchase', statusFromPlatformSearch: 'Active' }
    ];

    await importViaBookmarklet(page, items);

    // (c) 結果表示の「更新」が実数になる (既存2件が更新対象、除外済みは対象外)
    await expect(page.locator('#import-results')).toBeVisible();
    await expect(page.locator('#import-results .stat-value.warning')).toHaveText('2');
    await expect(page.locator('#import-results .stat-value.success')).toHaveText('1'); // 新規追加1件

    await page.evaluate(() => window.bookshelf.closeImportModal());

    // (d) 除外済み本は増えも変わりもしない: 蔵書は 5(既存) + 1(新規) = 6 件 (除外済みは含まれない)
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(6);
    await expect(page.locator('#bookshelf .book-item[data-asin="B0EXCLUDED1"]')).toHaveCount(0);

    // (a) 既存本のカードに KU バッジが付く
    const b1 = page.locator('#bookshelf .book-item[data-asin="B000000001"]');
    await expect(b1.locator('.book-badge')).toContainText('KU');
    const b2 = page.locator('#bookshelf .book-item[data-asin="B000000002"]');
    await expect(b2.locator('.book-badge').filter({ hasText: '利用終了' })).toHaveCount(1);
    await expect(b2.locator('.book-badge').filter({ hasText: 'KU' })).toHaveCount(1);

    // 絞り込みで拾える
    await page.locator('#toggle-filter').click();
    await page.locator('#kindle-seg .rseg[data-kindle="kuprime"]').click();
    await expect(page.locator('#bookshelf .book-item')).toHaveCount(2); // B000000001, B000000002
    await page.locator('#kindle-filter-reset').click();

    // (b) 書誌・addedDate・短文メモ・並び順が維持される
    const after1 = await page.evaluate(() => window.bookshelf.books.find(b => b.asin === 'B000000001'));
    expect(after1.title).toBe('フィクスチャの本 1'); // Amazon側の変化タイトルは無視
    expect(after1.addedDate).toBe(1700000000000);
    expect(after1.readStatus).toBe('READ'); // readStatus は STATUS_FIELDS 対象外 (イシュー#68)

    const afterAsin2 = await page.evaluate(() => window.bookshelf.userData.notes['B000000002']);
    expect(afterAsin2).toEqual(beforeAsin2); // 短文メモ「テストメモ」維持

    const afterOrder = await page.evaluate(() => window.bookshelf.userData.bookOrder.all);
    // 新規追加 (B0NEWITEM1) は先頭に挿入されるが、更新分 (既存ASIN) は挿入されない＝
    // 新規分を除いた既存部分の相対順序が変わらないことを検証する
    expect(afterOrder.filter(id => id !== 'B0NEWITEM1')).toEqual(beforeOrder);
    expect(afterOrder).toContain('B0NEWITEM1');

    expect(errors.filter(e => !/net::ERR/.test(e))).toEqual([]);
});

test('回帰: ステータス系フィールドを持たない取込ソース(貼り付け・旧形式JSON)でも既存ASINのステータスが消えない', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));

    // 1回目: bookmarklet 経由で B000000003 を KU 本 (借用中) として取込
    await importViaBookmarklet(page, [
        { title: 'フィクスチャの本 3', authors: '著者B', acquiredTime: 1700000002000, readStatus: 'UNKNOWN', asin: 'B000000003', productImage: '', originType: 'Ku', statusFromPlatformSearch: 'Active', lendingType: 'KU', lendingStatus: 'OnLoan' }
    ]);
    await page.evaluate(() => window.bookshelf.closeImportModal());
    const b3 = page.locator('#bookshelf .book-item[data-asin="B000000003"]');
    await expect(b3.locator('.book-badge')).toContainText('KU');

    // 2回目: 貼り付け取込で、originType/statusFromPlatformSearch/lendingType/lendingStatus の
    // キー自体を一切持たない旧形式 payload (title/authors/acquiredTime/asin のみ) を流す。
    // このとき既存のステータス系フィールドが黙って削除されてはいけない (イシュー#68 案F)。
    await importViaPaste(page, [
        { title: 'フィクスチャの本 3', authors: '著者B', acquiredTime: 1700000002000, asin: 'B000000003' }
    ]);
    await page.evaluate(() => window.bookshelf.closeImportModal());

    await expect(b3.locator('.book-badge')).toContainText('KU'); // バッジが消えていない
    const after3 = await page.evaluate(() => window.bookshelf.books.find(b => b.asin === 'B000000003'));
    expect(after3.originType).toBe('Ku');
    expect(after3.statusFromPlatformSearch).toBe('Active');
    expect(after3.lendingType).toBe('KU');
    expect(after3.lendingStatus).toBe('OnLoan');
});

test('回帰: 手動追加由来の readStatus は再取込で Amazon 値に黙って戻らない', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => window.bookshelf.switchBookshelf('all'));

    // 実UI操作で手動追加 (読了日あり = readStatus:'READ')。
    // #add-book-manually は設定モーダル「蔵書」セクション内にあるため先に開く
    // (standard-ops.spec.js と同じ _openSettingsModal ショートカットを使用)。
    await page.evaluate(() => window.bookshelf._openSettingsModal('library-section'));
    await expect(page.locator('#settings-modal')).toHaveClass(/show/);
    await page.locator('#add-book-manually').click();
    await page.locator('#manual-asin').fill('B0MANUALRD');
    await page.locator('#manual-title').fill('手動追加した既読本');
    await page.locator('#manual-acquired-date').fill('2026-01-01');
    await page.locator('#add-manually').click();
    await expect(page.locator('#bookshelf .book-item[data-asin="B0MANUALRD"]')).toHaveCount(1);
    await page.locator('#add-book-modal-close').click();
    await expect(page.locator('#add-book-modal')).not.toHaveClass(/show/);
    const beforeManual = await page.evaluate(() => window.bookshelf.books.find(b => b.asin === 'B0MANUALRD'));
    expect(beforeManual.readStatus).toBe('READ');

    // 同一 ASIN を Kindle 蔵書側にも持っていた想定で再取込 (借用中KUとして Amazon 側属性を更新)
    await importViaBookmarklet(page, [
        { title: '手動追加した既読本', authors: '', acquiredTime: 1700000040000, readStatus: 'UNKNOWN', asin: 'B0MANUALRD', productImage: '', originType: 'Ku', statusFromPlatformSearch: 'Active', lendingType: 'KU', lendingStatus: 'OnLoan' }
    ]);
    await page.evaluate(() => window.bookshelf.closeImportModal());

    const afterManual = await page.evaluate(() => window.bookshelf.books.find(b => b.asin === 'B0MANUALRD'));
    expect(afterManual.readStatus).toBe('READ'); // Amazon 側 'UNKNOWN' に黙って戻らない
    expect(afterManual.originType).toBe('Ku'); // ステータス系は正しく更新される
});
