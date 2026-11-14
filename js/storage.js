// BookshelfStorage - 同期フォルダの bookshelf ファイル構造を読み書きする
//
// I/O は StorageAdapter に委譲する。デフォルトでは LocalFSAdapter
// (File System Access API) を使用するが、コンストラクタで他の adapter
// (GitHub / Asayake ハブ) を注入することで切替可能。
//
// ディレクトリ構造 (2026-05-31〜):
//   <同期フォルダ root>/
//     private/                 # アプリ編集データの正本
//       library.json
//       exclusions.json
//       notes.json
//       bookshelves.json
//       bookshelves/all.json
//       bookshelves/<slug>.json
//       books/<ASIN>__<title>.md   # 長文メモ
//       settings.json
//       main.json
//     public/                  # 公開エクスポート出力
//       (アプリが書き出す)
//     plugins/<id>/            # プラグイン (private/public 両方が参照)

// PAR (イシュー#391 R+PAR+TO): 同時実行数を上限(既定4)に制限して tasks (関数の配列、各関数は
// Promise を返す) を並列実行する。loadAll() の直列12本フェッチ(起動時タイムアウトの本線、
// step1実測)を解消するために使う。tasks の順序どおりに結果配列を返す(呼び出し順を保つ)。
async function runLimited(tasks, limit = 4) {
    const results = new Array(tasks.length);
    let idx = 0;
    async function worker() {
        while (idx < tasks.length) {
            const i = idx++;
            results[i] = await tasks[i]();
        }
    }
    const workerCount = Math.max(1, Math.min(limit, tasks.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

const PENDING_SHELF_DELETES_KEY = 'virtualBookshelf_pendingShelfDeletes';

// 記録は1つの配列。文字列＝本棚の slug (イシュー#587 の形のまま)、オブジェクト＝長文メモの記録 (イシュー#594):
//   { kind: 'memo-delete', path }      本の削除で要らなくなったメモのファイル
//   { kind: 'memo-move', from, to }    題名・ASIN の変更でファイル名が変わったメモ (保存時に中身を移す)
// キー名は本棚の時のまま (中身に長文メモの記録も入る)。
function isPendingRecord(r) {
    if (typeof r === 'string') return !!r;
    if (!r || typeof r !== 'object') return false;
    if (r.kind === 'memo-delete') return typeof r.path === 'string' && !!r.path;
    if (r.kind === 'memo-move') return typeof r.from === 'string' && !!r.from && typeof r.to === 'string' && !!r.to;
    return false;
}

function readPendingRecords() {
    try {
        const v = JSON.parse(localStorage.getItem(PENDING_SHELF_DELETES_KEY) || '[]');
        return Array.isArray(v) ? v.filter(isPendingRecord) : [];
    } catch (_) {
        return [];
    }
}

function writePendingRecords(records) {
    try {
        if (records.length) localStorage.setItem(PENDING_SHELF_DELETES_KEY, JSON.stringify(records));
        else localStorage.removeItem(PENDING_SHELF_DELETES_KEY);
    } catch (_) { /* 書けなくても保存そのものは止めない */ }
}

function readPendingShelfDeletes() {
    return readPendingRecords().filter(r => typeof r === 'string');
}

// 本棚の分だけを書き換える (長文メモの記録は残す)
function writePendingShelfDeletes(slugs) {
    writePendingRecords([...slugs, ...readPendingRecords().filter(r => typeof r !== 'string')]);
}

function readPendingMemoRecords() {
    return readPendingRecords().filter(r => typeof r !== 'string');
}

// 長文メモの分だけを書き換える (本棚の slug は残す)。同じ記録は1つにまとめる
function writePendingMemoRecords(records) {
    const seen = new Set();
    const uniq = records.filter(r => {
        const k = JSON.stringify(r);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    writePendingRecords([...readPendingShelfDeletes(), ...uniq]);
}

const memoRecordKey = (r) => JSON.stringify(r);

class BookshelfStorage {
    constructor(adapter) {
        this.adapter = adapter || new LocalFSAdapter();
    }

    // ===== 接続管理 (LocalFSAdapter 互換) =====

    setDirHandle(handle) {
        if (typeof this.adapter.setDirHandle === 'function') {
            this.adapter.setDirHandle(handle);
        }
    }

    hasDirHandle() {
        if (typeof this.adapter.hasDirHandle === 'function') {
            return this.adapter.hasDirHandle();
        }
        return this.adapter.isConnected();
    }

    // ===== 形式判定 =====
    // 'new'        : private/bookshelves/all.json が存在 → 新構造 (private 配下に集約)
    // 'flat'       : root に bookshelves/all.json が存在 → 旧フラット構造 (要マイグレーション)
    // 'pre-notes-split': flat 構造で notes.json が無い (all.json 内 notes 混在)
    // 'legacy'     : 旧 library.json (books が object 形式) のみ
    // 'empty'      : どれも無し → 初回
    async detectFormat() {
        const hasNewAll = await this.adapter.fileExists('private/bookshelves/all.json');
        if (hasNewAll) return 'new';
        const hasFlatAll = await this.adapter.fileExists('bookshelves/all.json');
        const hasFlatNotes = await this.adapter.fileExists('notes.json');
        if (hasFlatAll && hasFlatNotes) return 'flat';
        if (hasFlatAll && !hasFlatNotes) return 'pre-notes-split';
        const legacy = await this.adapter.readJSON('library.json');
        if (legacy && legacy.books && !Array.isArray(legacy.books) && typeof legacy.books === 'object') {
            return 'legacy';
        }
        return 'empty';
    }

    // 旧 flat 構造の notes 分離マイグレーションは廃止。
    // 新構造 (private/ 配下) では最初から notes.json が分離している前提。
    // 旧データを移行する場合は migrateFlatToNew() を使う (未公開のため最小限実装)。
    async migrateNotesSplit() {
        console.warn('migrateNotesSplit() は旧 flat 構造用、新構造では未使用');
    }

    // ===== マイグレーション =====
    // 旧 library.json（単一ファイル統合形式）→ 新構造へ分解
    async migrateFromLegacy() {
        const legacy = await this.adapter.readJSON('library.json');
        if (!legacy || !legacy.books || Array.isArray(legacy.books)) {
            throw new Error('旧形式の library.json が見つかりません');
        }

        const libraryBooks = [];
        const allBooks = [];
        const allNotes = {};

        Object.entries(legacy.books).forEach(([asin, b]) => {
            libraryBooks.push({
                asin,
                title: b.title || '',
                authors: b.authors || '',
                acquiredTime: b.acquiredTime || Date.now(),
                readStatus: b.readStatus || 'UNKNOWN',
                productImage: b.productImage || '',
                source: b.source || 'unknown',
                addedDate: b.addedDate || Date.now(),
                ...(b.updatedAsin ? { updatedAsin: b.updatedAsin } : {}),
                ...(b.originType ? { originType: b.originType } : {}),
                ...(b.statusFromPlatformSearch ? { statusFromPlatformSearch: b.statusFromPlatformSearch } : {}),
                ...(b.lendingType ? { lendingType: b.lendingType } : {}),
                ...(b.lendingStatus ? { lendingStatus: b.lendingStatus } : {})
            });
            allBooks.push(asin);
            if (b.memo || b.rating) {
                allNotes[asin] = {
                    memo: b.memo || '',
                    rating: b.rating || 0,
                    hasDetailMemo: false
                };
            }
        });

        const newLibrary = {
            exportDate: legacy.exportDate || new Date().toISOString(),
            books: libraryBooks
        };

        const allInternalId = generateInternalId();
        const allBookshelf = {
            internalId: allInternalId,
            slug: 'all',
            name: 'すべての本',
            isSpecial: true,
            parent: null,
            defaultBookOrder: 'addedDate-desc',
            appliedPlugins: [],
            books: allBooks
        };
        const notesFile = { notes: allNotes };

        // 旧 bookshelves 配列を新形式に変換（all 以外）
        const userBookshelvesLegacy = (legacy.bookshelves || []).filter(b => b.id !== 'all');
        const bookshelvesMetaEntries = [];
        const bookshelfFilesToWrite = [];
        const usedSlugs = new Set();

        for (const bs of userBookshelvesLegacy) {
            const internalId = generateInternalId();
            let slug = (bs.id || bs.name || internalId)
                .toString()
                .toLowerCase()
                .replace(/[^a-z0-9-_]+/g, '-')
                .replace(/^-+|-+$/g, '');
            if (!slug) slug = internalId;
            // 衝突回避
            let candidateSlug = slug;
            let i = 2;
            while (usedSlugs.has(candidateSlug)) {
                candidateSlug = `${slug}-${i++}`;
            }
            slug = candidateSlug;
            usedSlugs.add(slug);

            bookshelvesMetaEntries.push({
                internalId,
                slug,
                name: bs.name || slug,
                parent: allInternalId,
                appliedPlugins: []
            });

            const bookList = (legacy.bookOrder && legacy.bookOrder[bs.id])
                ? legacy.bookOrder[bs.id]
                : (bs.books || []);

            bookshelfFilesToWrite.push({
                slug,
                data: {
                    internalId,
                    books: bookList,
                    notes: {}
                }
            });
        }

        // bookshelves.json に all を最初のエントリとして含める
        const bookshelvesMeta = {
            bookshelves: [
                {
                    internalId: allInternalId,
                    slug: 'all',
                    name: 'すべての本',
                    isSpecial: true,
                    parent: null,
                    appliedPlugins: []
                },
                ...bookshelvesMetaEntries
            ]
        };

        const settings = legacy.settings || {};
        const privateSettings = {
            version: '2.0',
            affiliateId: settings.affiliateId || '',
            theme: settings.theme || 'light',
            language: 'ja',
            defaultView: settings.defaultView || 'covers',
            booksPerPage: settings.booksPerPage || 50,
            coverSize: settings.coverSize || 'medium',
            showHighlights: settings.showHighlights !== false,
            showImagesInOverview: settings.showImagesInOverview !== false,
            enabledPlugins: [],
            memoOverrideDefault: 'this-bookshelf-only',
            publishExportPath: null,
            extensionImportOrigins: ['http://localhost:*', 'https://hahero-asayake.github.io']
        };

        const privateMain = {
            enabledPlugins: [],
            appliedPlugins: [],
            bookshelves: [allInternalId, ...bookshelvesMetaEntries.map(e => e.internalId)],
            defaultSort: 'addedDate-desc'
        };

        // 一斉書き込み (新構造: 全部 private/ 配下)
        await this.adapter.writeJSON('private/library.json', newLibrary);
        await this.adapter.writeJSON('private/exclusions.json', { excludedASINs: [] });
        await this.adapter.writeJSON('private/notes.json', notesFile);
        await this.adapter.writeJSON('private/bookshelves.json', bookshelvesMeta);
        await this.adapter.writeJSON('private/bookshelves/all.json', allBookshelf);
        for (const { slug, data } of bookshelfFilesToWrite) {
            await this.adapter.writeJSON(`private/bookshelves/${slug}.json`, data);
        }
        await this.adapter.writeJSON('private/settings.json', privateSettings);
        await this.adapter.writeJSON('private/main.json', privateMain);

        return { migrated: true, allInternalId };
    }

    // ===== 空状態の初期化 (新構造: 全部 private/ 配下) =====
    async initEmpty() {
        const allInternalId = generateInternalId();
        await this.adapter.writeJSON('private/library.json', { exportDate: new Date().toISOString(), books: [] });
        await this.adapter.writeJSON('private/exclusions.json', { excludedASINs: [] });
        await this.adapter.writeJSON('private/notes.json', { notes: {} });
        await this.adapter.writeJSON('private/bookshelves.json', {
            bookshelves: [{
                internalId: allInternalId,
                slug: 'all',
                name: 'すべての本',
                iconName: 'library',
                isSpecial: true,
                parent: null,
                appliedPlugins: []
            }]
        });
        await this.adapter.writeJSON('private/bookshelves/all.json', {
            internalId: allInternalId,
            slug: 'all',
            name: 'すべての本',
            iconName: 'library',
            isSpecial: true,
            parent: null,
            defaultBookOrder: 'addedDate-desc',
            appliedPlugins: [],
            books: []
        });
        await this.adapter.writeJSON('private/settings.json', {
            version: '2.0',
            affiliateId: '',
            theme: 'light',
            language: 'ja',
            defaultView: 'covers',
            booksPerPage: 50,
            coverSize: 'medium',
            showHighlights: true,
            showImagesInOverview: true,
            enabledPlugins: [],
            memoOverrideDefault: 'this-bookshelf-only',
            bookMemoOpenWith: 'app-editor',
            extensionImportOrigins: ['http://localhost:*', 'https://hahero-asayake.github.io']
        });
        await this.adapter.writeJSON('private/main.json', {
            enabledPlugins: [],
            appliedPlugins: [],
            bookshelves: [allInternalId],
            defaultSort: 'addedDate-desc'
        });
        return { allInternalId };
    }

    // ===== 一括読み込み (新構造: 全部 private/ 配下) =====
    async loadAll() {
        // PAR (イシュー#391): 固定7本は同時数4で並列取得 (直列だと起動時タイムアウトの本線になる・
        // step1実測)。bookshelvesMeta が確定してから本棚ごとのファイル(本数は蔵書構成に依存)を
        // 同じく同時数4で並列取得する2段構成 (本棚一覧はbookshelvesMetaの中身が無いと分からないため)。
        const [library, exclusionsRaw, notesFileRaw, bookshelvesMetaRaw, allBookshelf, privateSettingsRaw, privateMainRaw, syncStampRaw] =
            await runLimited([
                () => this.adapter.readJSON('private/library.json'),
                () => this.adapter.readJSON('private/exclusions.json'),
                () => this.adapter.readJSON('private/notes.json'),
                () => this.adapter.readJSON('private/bookshelves.json'),
                () => this.adapter.readJSON('private/bookshelves/all.json'),
                () => this.adapter.readJSON('private/settings.json'),
                () => this.adapter.readJSON('private/main.json'),
                // 版の印 (イシュー#612)。中身が壊れていても読み込みは止めない (無いものとして扱う)。通信の失敗は他と同じく投げる
                () => this.adapter.readJSON(BookshelfStorage.SYNC_STAMP_PATH).catch((e) => { if (e instanceof SyntaxError) return null; throw e; })
            ], 4);
        this.syncStamp = (syncStampRaw && typeof syncStampRaw.stamp === 'string') ? syncStampRaw.stamp : null;
        const exclusions = exclusionsRaw || { excludedASINs: [] };
        const notesFile = notesFileRaw || { notes: {} };
        const bookshelvesMeta = bookshelvesMetaRaw || { bookshelves: [] };
        const privateSettings = privateSettingsRaw || {};
        const privateMain = privateMainRaw || {};

        const targets = bookshelvesMeta.bookshelves.filter((meta) => !meta.isSpecial);
        const bookshelfResults = await runLimited(
            targets.map((meta) => async () => ({ meta, data: await this.adapter.readJSON(`private/bookshelves/${meta.slug}.json`) })),
            4
        );
        const bookshelfFiles = {};
        for (const { meta, data } of bookshelfResults) {
            if (data) bookshelfFiles[meta.internalId] = data;
        }

        return {
            library,
            exclusions,
            notes: notesFile.notes || {},
            bookshelvesMeta,
            allBookshelf,
            bookshelfFiles,
            privateSettings,
            privateMain,
            syncStamp: this.syncStamp
        };
    }

    // ===== 個別書き出し (新構造: 全部 private/ 配下) =====
    writeLibrary(data) { return this.adapter.writeJSON('private/library.json', data); }
    writeExclusions(data) { return this.adapter.writeJSON('private/exclusions.json', data); }
    writeBookshelvesMeta(data) { return this.adapter.writeJSON('private/bookshelves.json', data); }
    writeAllBookshelf(data) { return this.adapter.writeJSON('private/bookshelves/all.json', data); }
    writeBookshelfFile(slug, data) { return this.adapter.writeJSON(`private/bookshelves/${slug}.json`, data); }
    writePrivateSettings(data) { return this.adapter.writeJSON('private/settings.json', data); }
    writePrivateMain(data) { return this.adapter.writeJSON('private/main.json', data); }

    readPublicMain() { return this.adapter.readJSON('public/main.json'); }
    readPublicSettings() { return this.adapter.readJSON('public/settings.json'); }
    writePublicMain(data) { return this.adapter.writeJSON('public/main.json', data); }
    writePublicSettings(data) { return this.adapter.writeJSON('public/settings.json', data); }

    readNotes() { return this.adapter.readJSON('private/notes.json'); }
    writeNotes(data) { return this.adapter.writeJSON('private/notes.json', data); }

    deleteBookshelfFile(slug) {
        return this.adapter.deleteFile(`private/bookshelves/${slug}.json`);
    }

    // ===== 本棚ファイルの削除待ち (イシュー#587) =====
    // 本棚の削除・slug 変更で要らなくなった private/bookshelves/<slug>.json は、その場では消さず、
    // 次の保存 (syncToObsidianFolder のまとめ保存) に削除として載せる＝保存先 (ローカル/GitHub/ハブ) を
    // 問わず同じ経路で消える。保存が成功するまで localStorage に覚えておくので、通信失敗・未接続・
    // 再読込をまたいでも次の保存で再試行される。
    queueBookshelfFileDelete(slug) {
        if (!slug || slug === 'all') return;
        const pending = readPendingShelfDeletes();
        if (!pending.includes(slug)) writePendingShelfDeletes([...pending, slug]);
    }

    // 次の保存で消す本棚ファイル。keepSlugs (いまの本棚一覧の slug) は削除待ちから外す＝同じ slug で
    // 作り直した本棚・読み込み直しで戻った本棚のファイルは消さない。
    takeBookshelfFileDeletes(keepSlugs = []) {
        const keep = new Set(keepSlugs);
        const pending = readPendingShelfDeletes();
        const slugs = pending.filter(s => !keep.has(s));
        if (slugs.length !== pending.length) writePendingShelfDeletes(slugs);
        return { slugs, entries: slugs.map(s => ({ op: 'delete', path: `private/bookshelves/${s}.json` })) };
    }

    // 保存が成功した分を削除待ちから外す (保存中に新しく積まれた分は残る)
    clearBookshelfFileDeletes(slugs) {
        const done = new Set(slugs);
        writePendingShelfDeletes(readPendingShelfDeletes().filter(s => !done.has(s)));
    }

    // ===== 汎用 (プラグインスキャン・公開ページ等の二次利用向け) =====
    listDirs(dirPath) { return this.adapter.listDirs(dirPath); }
    listFiles(dirPath) { return this.adapter.listFiles(dirPath); }
    readText(path) { return this.adapter.readText(path); }
    readJSON(path) { return this.adapter.readJSON(path); }
    writeJSON(path, data) { return this.adapter.writeJSON(path, data); }

    // ===== バッチ書き込み =====
    //
    // entries: [
    //   { op: 'put',    path: '...', data: object,        kind: 'json' },  // JSON.stringify される
    //   { op: 'put',    path: '...', data: 'raw text',    kind: 'text' },
    //   { op: 'delete', path: '...' }
    // ]
    // GitHubAdapter なら Trees API で 1 commit にまとめる。LocalFS では順次書く。
    //
    // stamp (任意・イシュー#612): 保存先の版の印。渡すと、同じ書き込みで private/sync-stamp.json に書く。
    //   保存先の種類を問わず、照合を付けずに書く (印なので、後から書いた方が勝ちでよい)。
    //   変えたファイルだけ送る adapter (ハブ) は、他に送る物が無ければ印も書かない (addBatchStamp)。
    //   保存先に今ある印は this.syncStamp に覚える (読んだ時は loadAll・書けた時はここ)。
    async syncBatch(entries, { message, stamp } = {}) {
        if (!Array.isArray(entries) || entries.length === 0) return;
        const a = this.adapter;
        const stampContent = stamp ? JSON.stringify({ stamp }, null, 2) : null;
        if (typeof a.beginBatch === 'function' && typeof a.commitBatch === 'function') {
            a.beginBatch();
            try {
                for (const e of entries) {
                    if (e.op === 'delete') {
                        a.addBatchDelete(e.path);
                    } else {
                        const content = e.kind === 'text'
                            ? String(e.data == null ? '' : e.data)
                            : JSON.stringify(e.data, null, 2);
                        a.addBatchEntry(e.path, content);
                    }
                }
                if (stampContent) {
                    if (typeof a.addBatchStamp === 'function') a.addBatchStamp(BookshelfStorage.SYNC_STAMP_PATH, stampContent);
                    else a.addBatchEntry(BookshelfStorage.SYNC_STAMP_PATH, stampContent);
                }
                this.lastMerged = null;
                const res = await a.commitBatch(message);
                // 送る物が無くて印も書かなかった時 (adapter が lastBatchWroteStamp=false と言う) は、覚えている印を進めない
                if (stampContent && a.lastBatchWroteStamp !== false) this.syncStamp = stamp;
                // 相手の変更と項目ごとに合わせて書いたファイル { path: { local, merged } } (イシュー#612)。呼び出し元が手元へ入れる
                this.lastMerged = a.lastBatchMerged || null;
                return res;
            } catch (err) {
                if (typeof a.discardBatch === 'function') a.discardBatch();
                throw err;
            }
        }
        // バッチ未対応 adapter: 順次書く
        for (const e of entries) {
            if (e.op === 'delete') {
                await a.deleteFile(e.path);
            } else if (e.kind === 'text') {
                await a.writeText(e.path, String(e.data == null ? '' : e.data));
            } else {
                await a.writeJSON(e.path, e.data);
            }
        }
        if (stampContent) {
            await a.writeText(BookshelfStorage.SYNC_STAMP_PATH, stampContent);
            this.syncStamp = stamp;
        }
        return null;
    }

    // 保存ごとに変わる値 (時刻と乱数)。保存先がこの端末と最後に揃えた後に変わったかを見分ける印に使う (イシュー#612・#602)
    newSyncStamp() {
        return `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    // ===== 長文メモ.md =====
    sanitizeFileName(title) {
        if (!title) return 'untitled';
        return title
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, '_')
            .slice(0, 50)
            || 'untitled';
    }

    bookMemoFileName(asin, title) {
        return `${asin}__${this.sanitizeFileName(title)}.md`;
    }

    // 本の (asin, 題名) から作る長文メモのパス (移動待ちを読み替えない素のパス)
    bookMemoPath(asin, title) {
        return `private/books/${this.bookMemoFileName(asin, title)}`;
    }

    // まだ済んでいない移動 (memo-move) の to なら from を返す＝題名・ASIN を変えた直後、次の保存で
    // ファイルが移るまでの間も、新しい題名のまま元のメモを読める (イシュー#594)
    _resolveBookMemoPath(path) {
        const mv = readPendingMemoRecords().find(r => r.kind === 'memo-move' && r.to === path);
        return mv ? mv.from : path;
    }

    readBookMemo(asin, title, hooks) {
        return this.adapter.readText(this._resolveBookMemoPath(this.bookMemoPath(asin, title)), hooks);
    }

    async writeBookMemo(asin, title, content) {
        const fileName = this.bookMemoFileName(asin, title);
        const path = `private/books/${fileName}`;
        await this.adapter.writeText(path, content);
        // 移動待ちの to に書いた＝書いた中身が新しい正。その移動は from を消すだけに変える
        const recs = readPendingMemoRecords();
        if (recs.some(r => r.kind === 'memo-move' && r.to === path)) {
            writePendingMemoRecords(recs.map(r => (r.kind === 'memo-move' && r.to === path) ? { kind: 'memo-delete', path: r.from } : r));
        }
        return fileName;
    }

    bookMemoExists(asin, title) {
        return this.adapter.fileExists(this._resolveBookMemoPath(this.bookMemoPath(asin, title)));
    }

    bookMemoFullPath(asin, title) {
        return this._resolveBookMemoPath(this.bookMemoPath(asin, title));
    }

    // ===== 長文メモのファイルの削除・移動待ち (イシュー#594) =====
    // 本棚ファイルの削除待ち (イシュー#587) と同じ記録に積み、次の保存のまとめ保存に載せる。
    // 保存が成功するまで残るので、未接続・通信失敗・再読込をまたいでも次の保存で再試行される。

    // 本の削除: そのメモのファイルを消す。移動待ちの to を消すなら、元の from を消す
    queueBookMemoDelete(path) {
        if (!path) return;
        const out = readPendingMemoRecords().map(r => (r.kind === 'memo-move' && r.to === path) ? { kind: 'memo-delete', path: r.from } : r);
        out.push({ kind: 'memo-delete', path });
        writePendingMemoRecords(out);
    }

    // 題名・ASIN の変更: from のメモを to へ移す。続けて変えた分はまとめる (A→B→C は A→C、A→B→A は取り消し)
    queueBookMemoMove(from, to) {
        if (!from || !to || from === to) return;
        let src = from;
        const out = [];
        for (const r of readPendingMemoRecords()) {
            if (r.kind === 'memo-move' && r.to === from) { src = r.from; continue; }
            if (r.kind === 'memo-delete' && r.path === to) continue; // これから to へ書くので、to を消す記録は外す
            out.push(r);
        }
        if (src !== to) out.push({ kind: 'memo-move', from: src, to });
        writePendingMemoRecords(out);
    }

    // 次の保存で載せる長文メモの書き込み・削除を作る。
    //   keepPaths: 保存の時点で一覧にある本の今のメモのパス。ここにあるファイルは消さない (同じ ASIN・同じ題名の
    //              別の本 (#484)・題名を元に戻した本のメモを守る)。移動の to がここに無い移動は捨てる
    //              (変更が取り消された・読み込み直しで戻った＝どの本のものでもないファイルを作らない)
    //   openPath:  アプリ内エディタで開いているメモのパス。その移動は次の保存へ回す (エディタの直接の書き込みと上書きし合わない)
    //   caseInsensitiveDeletes: true (ローカル) の時、大文字・小文字だけ違う移動では from を消さない
    //              (大文字小文字を区別しないファイルシステムでは同じファイルを指すため)
    // 移す先が既にある時は、上書きも元の削除もしない (他の端末で書いた内容を失わない)。
    async takeBookMemoOps(keepPaths = [], { openPath = null, caseInsensitiveDeletes = false } = {}) {
        const keep = new Set(keepPaths);
        const entries = [];
        const records = [];
        const dropped = [];
        for (const r of readPendingMemoRecords()) {
            if (r.kind === 'memo-delete') {
                if (keep.has(r.path)) { dropped.push(r); continue; }
                entries.push({ op: 'delete', path: r.path });
                records.push(r);
                continue;
            }
            if (!keep.has(r.to)) { dropped.push(r); continue; }
            if (openPath && r.to === openPath) continue;
            const content = await this.adapter.readText(r.from);
            if (content == null) { dropped.push(r); continue; }
            if (await this.adapter.fileExists(r.to)) {
                console.warn(`長文メモの移動先 ${r.to} が既にあるため、${r.from} から移さずに残します`);
                dropped.push(r);
                continue;
            }
            entries.push({ op: 'put', kind: 'text', path: r.to, data: content });
            const caseOnly = r.from.toLowerCase() === r.to.toLowerCase();
            if (!keep.has(r.from) && !(caseInsensitiveDeletes && caseOnly)) entries.push({ op: 'delete', path: r.from });
            records.push(r);
        }
        if (dropped.length) this.clearBookMemoOps(dropped);
        return { entries, records };
    }

    // 保存が成功した分を外す (保存中に新しく積まれた分は残る)
    clearBookMemoOps(records) {
        const done = new Set(records.map(memoRecordKey));
        writePendingMemoRecords(readPendingMemoRecords().filter(r => !done.has(memoRecordKey(r))));
    }

    buildBookMemoTemplate(book) {
        const now = new Date().toISOString();
        const title = (book.title || '').replace(/"/g, '\\"');
        const authors = (book.authors || '').replace(/"/g, '\\"');
        return `---
asin: ${book.asin}
title: "${title}"
authors: "${authors}"
created: ${now}
updated: ${now}
---

# ${book.title || book.asin}

`;
    }

    // ===== frontmatter ヘルパ (ADR-024: アプリ内では隠し、ファイルには維持) =====

    /**
     * YAML frontmatter と本文を分離する。
     * 先頭が `---` 行のときだけ、最初の終端 `---` 行までを frontmatter とみなす
     * (本文中の `---` 水平線を誤検出しない)。先頭に無ければ frontmatter: null。
     * @param {string} text
     * @returns {{frontmatter: string|null, body: string}}
     *   frontmatter は区切り行を含む生テキスト (joinFrontmatter にそのまま渡す)
     */
    static splitFrontmatter(text) {
        const t = String(text ?? '');
        // 先頭一致 + 最小マッチ。終端は「行頭の --- + 改行 or 文字列末尾」
        const m = t.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
        if (!m) return { frontmatter: null, body: t };
        return { frontmatter: m[0], body: t.slice(m[0].length) };
    }

    /**
     * frontmatter と本文を結合する。frontmatter が null なら body をそのまま返す
     * (frontmatter を勝手に追加しない)。frontmatter 内の `updated:` 行のみ現在時刻に
     * 置換し (無ければ閉じ --- の直前に追加)、他の行は一切変更しない。
     * @param {string|null} frontmatter splitFrontmatter が返した生テキスト
     * @param {string} body
     * @returns {string}
     */
    static joinFrontmatter(frontmatter, body) {
        if (!frontmatter) return body;
        const now = new Date().toISOString();
        let fm = frontmatter;
        if (/^updated:.*$/m.test(fm)) {
            fm = fm.replace(/^updated:.*$/m, `updated: ${now}`);
        } else {
            // 閉じ --- 行の直前に updated 行を追加
            fm = fm.replace(/(\r?\n)---(\r?\n|$)/, `$1updated: ${now}$1---$2`);
        }
        return fm + body;
    }
}

function generateInternalId() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 8; i++) {
        id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return id;
}

// 保存先の版の印のファイル (イシュー#612)。中身は { stamp: '<時刻>-<乱数>' }
BookshelfStorage.SYNC_STAMP_PATH = 'private/sync-stamp.json';
window.BookshelfStorage = BookshelfStorage;
window.generateInternalId = generateInternalId;
