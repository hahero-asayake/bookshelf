/**
 * BookManager - 蔵書の CRUD 管理を担当するクラス
 * kindle.json からのインポート、手動追加、削除機能を提供
 */
class BookManager {
    constructor() {
        this.library = {
            books: [],
            metadata: {
                lastImportDate: null,
                totalBooks: 0,
                manuallyAdded: 0,
                importedFromKindle: 0
            }
        };
        // イシュー#398: 蔵書の追加・削除・更新のたびに進める版数。getAllBooks() は library.books の
        // 参照をそのまま返す (push/splice は参照を保ったまま内容だけ変える・updateBook はフィールドの
        // in-place書換) ため、呼び出し側が「参照が同じなら蔵書は変わっていない」という判定をできない
        // (#397 A1 で __bibV を導入したのと同じ理由)。全蔵書の並び順キャッシュ(ホーム本棚ハイライト用)の
        // 無効化判定に使う。
        this._rev = 0;
    }

    _bumpRev() {
        this._rev++;
    }

    getRev() {
        return this._rev;
    }

    /**
     * ライブラリデータを初期化・読み込み
     */
    async initialize() {
        // まずLocalStorageから確認
        const savedLibrary = localStorage.getItem('virtualBookshelf_library');
        if (savedLibrary) {
            try {
                const parsed = JSON.parse(savedLibrary);
                if (parsed && Array.isArray(parsed.books) && parsed.metadata && typeof parsed.metadata === 'object') {
                    this.library = parsed;
                    return;
                }
                console.warn('localStorage の library 形式が不正のため破棄します', parsed);
                localStorage.removeItem('virtualBookshelf_library');
            } catch (error) {
                console.warn('localStorage の library パース失敗、破棄します', error);
                localStorage.removeItem('virtualBookshelf_library');
            }
        }
        
        // ローカル保存が無ければ空の蔵書 (初回は welcome を出す。サーバー側サンプルの自動読込はしない: ADR-053)
        this.library = {
            books: [],
            metadata: {
                totalBooks: 0,
                manuallyAdded: 0,
                importedFromKindle: 0,
                lastImportDate: null
            }
        };
    }

    async importSelectedBooks(selectedBooks) {
        const importedBooks = [];
        const updatedBooks = [];
        const duplicateBooks = [];
        const errorBooks = [];

        // 既存の本を asin で引けるように (再取込時のステータス更新用)
        const existingByAsin = new Map(this.library.books.map(book => [book.asin, book]));

        // Amazon 生値のステータス系フィールドのみ (イシュー#41)。書誌・addedDate・並び順・メモ・readStatus は触らない
        // (readStatus は選択の有無と無関係に自動更新される対象のため、ユーザーの読書記録を上書きしない)。
        const STATUS_FIELDS = ['originType', 'statusFromPlatformSearch', 'lendingType', 'lendingStatus'];

        for (const book of selectedBooks) {
            try {
                const existing = existingByAsin.get(book.asin);
                if (existing) {
                    // 同一 ASIN の再取込: ステータス系だけ Amazon 最新値で更新。
                    // 値が無いフィールドは既存のキーごと削除 (Amazon 側で無くなった = 未設定に戻す)。
                    // ただし payload 自体にそのキーの概念が無い (旧形式 exporter・貼り付け/ファイル取込等で
                    // ステータス系フィールドを持たないデータが来た場合) は削除しない (イシュー#68)。
                    let changed = false;
                    for (const key of STATUS_FIELDS) {
                        if (!(key in book)) continue;
                        const newVal = book[key];
                        if (newVal) {
                            if (existing[key] !== newVal) { existing[key] = newVal; changed = true; }
                        } else if (key in existing) {
                            delete existing[key];
                            changed = true;
                        }
                    }
                    if (changed) {
                        // イシュー#397 A1: existing はオブジェクト参照を変えずにフィールドだけ書き換える
                        // (同一参照のまま)。呼び出し側(bookshelf.js _bookCardKey)が参照の同一性だけで
                        // JSON.stringify(book)をキャッシュしていると、この書き換えが見えず古いバッジの
                        // ままになる(実測で確認・kindle-reimport-merge.spec.jsで検出)。参照は同じでも
                        // 中身が変わったと分かるよう、軽量なバージョン番号を進める。非列挙にして
                        // JSON.stringify(book)自体やlibrary.jsonの書き出しに混ざらないようにする。
                        Object.defineProperty(existing, '__bibV', { value: (existing.__bibV || 0) + 1, enumerable: false, configurable: true, writable: true });
                        updatedBooks.push(existing);
                    } else {
                        duplicateBooks.push({
                            title: book.title,
                            asin: book.asin,
                            reason: '既に存在'
                        });
                    }
                    continue;
                }

                // 本を追加
                const bookToAdd = {
                    ...book,
                    source: 'kindle_import',
                    addedDate: Date.now()
                };

                this.library.books.push(bookToAdd);
                importedBooks.push(bookToAdd);

            } catch (error) {
                console.error(`本の処理エラー: ${book.title}`, error);
                errorBooks.push({
                    title: book.title,
                    asin: book.asin,
                    reason: error.message
                });
            }
        }

        // メタデータを更新
        this.library.metadata = {
            totalBooks: this.library.books.length,
            manuallyAdded: this.library.books.filter(b => b.source === 'manual_add').length,
            importedFromKindle: this.library.books.filter(b => b.source === 'kindle_import').length,
            lastImportDate: Date.now()
        };
        if (importedBooks.length || updatedBooks.length) this._bumpRev();

        // ライブラリを保存
        await this.saveLibrary();

        console.log(`選択インポート完了: ${importedBooks.length}件追加, ${updatedBooks.length}件ステータス更新`);

        return {
            success: true,
            total: selectedBooks.length,
            added: importedBooks.length,
            updated: updatedBooks.length,
            skipped: duplicateBooks.length + errorBooks.length,
            imported: importedBooks,
            statusUpdated: updatedBooks,
            duplicates: duplicateBooks,
            errors: errorBooks
        };
    }


    /**
     * AmazonリンクからASINを抽出
     */
    extractASINFromUrl(url) {
        const patterns = [
            /amazon\.co\.jp\/dp\/([A-Z0-9]{10})/,
            /amazon\.co\.jp\/.*\/dp\/([A-Z0-9]{10})/,
            /amazon\.com\/dp\/([A-Z0-9]{10})/,
            /amazon\.com\/.*\/dp\/([A-Z0-9]{10})/,
            /\/([A-Z0-9]{10})(?:\/|\?|$)/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    /**
     * ASIN から書籍情報を自動取得（複数APIの組み合わせ）
     */
    async fetchBookDataFromAmazon(asin) {
        console.log(`書籍情報取得開始: ${asin}`);

        try {
            // Google Books APIで検索（実際に動作）
            const googleBooksData = await this.fetchFromGoogleBooks(asin);
            if (googleBooksData && googleBooksData.title && googleBooksData.title !== 'タイトル未取得') {
                console.log('Google Books で取得成功:', googleBooksData);
                return googleBooksData;
            }
        } catch (error) {
            console.log('Google Books 検索失敗:', error.message);
        }

        // Google Books で見つからない場合はテンプレートを返す
        console.log('自動取得失敗、テンプレートで代替');
        return this.generateSmartBookData(asin);
    }

    /**
     * Google Books APIから書籍情報を取得
     */
    async fetchFromGoogleBooks(asin) {
        try {
            console.log(`Google Books API検索: ${asin}`);

            // ISBNとして検索
            let url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${asin}`;
            let response = await fetch(url);
            let data = await response.json();

            console.log('Google Books ISBN検索結果:', data);

            if (data.items && data.items.length > 0) {
                const book = data.items[0].volumeInfo;
                console.log('見つかった書籍:', book);

                return {
                    asin: asin,
                    title: book.title || 'タイトル未取得',
                    authors: book.authors ? book.authors.join(', ') : '著者未取得',
                    acquiredTime: Date.now(),
                    readStatus: 'UNKNOWN',
                    productImage: book.imageLinks ?
                        (book.imageLinks.large || book.imageLinks.medium || book.imageLinks.thumbnail) :
                        `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.L.jpg`
                };
            }

            // ISBNで見つからない場合、一般検索を試行
            url = `https://www.googleapis.com/books/v1/volumes?q=${asin}`;
            response = await fetch(url);
            data = await response.json();

            console.log('Google Books 一般検索結果:', data);

            if (data.items && data.items.length > 0) {
                const book = data.items[0].volumeInfo;
                console.log('一般検索で見つかった書籍:', book);

                return {
                    asin: asin,
                    title: book.title || 'タイトル未取得',
                    authors: book.authors ? book.authors.join(', ') : '著者未取得',
                    acquiredTime: Date.now(),
                    readStatus: 'UNKNOWN',
                    productImage: book.imageLinks ?
                        (book.imageLinks.large || book.imageLinks.medium || book.imageLinks.thumbnail) :
                        `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.L.jpg`
                };
            }

            throw new Error('書籍が見つかりませんでした');

        } catch (error) {
            console.warn('Google Books API エラー:', error);
            throw error;
        }
    }


    /**
     * スマートな書籍データを生成（実用的なアプローチ）
     */
    generateSmartBookData(asin) {
        // ASIN形式で本の種類を推測し、より実用的な情報を提供
        let title, authors;

        if (asin.startsWith('B') && asin.length === 10) {
            // Kindle本の場合
            title = '';  // 空にして手動入力を促す
            authors = '';
        } else if (/^\d{9}[\dX]$/.test(asin)) {
            // ISBN-10の場合
            title = '';
            authors = '';
        } else {
            // その他
            title = '';
            authors = '';
        }

        return {
            asin: asin,
            title: title,
            authors: authors,
            acquiredTime: Date.now(),
            readStatus: 'UNKNOWN',
            productImage: `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.L.jpg`
        };
    }



    /**
     * 表示・リンク用の有効なASINを取得
     */
    getEffectiveASIN(book) {
        return book.updatedAsin || book.asin;
    }

    /**
     * Amazon商品画像URLを取得。
     * Kindle 取込が保存した恒久 CDN URL (m.media-amazon.com/images/I/…) を最優先で使う。
     * /images/P/<ASIN> の組み立ては旧エンドポイントで、Kindle の B0… ASIN だと画像を
     * 持たないことがある (200 で 1x1 GIF が返る) ため、保存 URL が無い本のフォールバック。
     * updatedAsin (版差し替え) があるときは差し替え先の表紙を出すため組み立てを優先する。
     */
    getProductImageUrl(book) {
        if (!book.updatedAsin && typeof book.productImage === 'string' && /^https:\/\//.test(book.productImage)) {
            return book.productImage;
        }
        const effectiveAsin = this.getEffectiveASIN(book);
        return `https://images-na.ssl-images-amazon.com/images/P/${effectiveAsin}.01.L.jpg`;
    }

    /**
     * 表紙の <img> を出すべきか (出し分け条件の唯一の正)。
     * productImage が空でも ASIN があれば組み立て URL で表示を試みる。
     * 読み込みに失敗した場合は共通フォールバック (_setupCoverFallback) が生成表紙に差し替える。
     */
    hasCoverImage(book) {
        return !!(book.productImage || this.getEffectiveASIN(book));
    }

    /**
     * AmazonアフィリエイトリンクURLを生成
     */
    getAmazonUrl(book, affiliateId = null) {
        const effectiveAsin = this.getEffectiveASIN(book);
        let url = `https://www.amazon.co.jp/dp/${effectiveAsin}`;

        if (affiliateId) {
            url += `?tag=${affiliateId}`;
        }

        return url;
    }

    /**
     * Kindle 電子書籍か (ASIN が B 始まりの 10 桁)。ISBN ベース (紙書籍) は false。
     * 取込元が Kindle ライブラリなのでほぼ true だが、手動追加の紙書籍を除外する。
     */
    isKindleBook(book) {
        const asin = this.getEffectiveASIN(book) || '';
        return /^B[0-9A-Z]{9}$/.test(asin);
    }

    /**
     * 本を開く Kindle URL。method で開き方を切替 (設定 settings.kindleOpenWith):
     *  - 'web' (既定): Kindle Cloud Reader (ブラウザ)。`https://read.amazon.co.jp/?asin=<ASIN>`。
     *    Amazon ログイン済み＋所有でその本のリーダーが開く。未所有/未ログインはライブラリ/ログインに着地。
     *    全環境で動作 (モバイル含む)。
     *  - 'app': Kindle ネイティブアプリの URL スキーム。`kindle://book?action=open&asin=<ASIN>`。
     *    端末に Kindle アプリが入っていれば直接開く。未対応プラットフォーム/未インストールでは効かない。
     */
    getKindleReadUrl(book, method = 'web') {
        const effectiveAsin = this.getEffectiveASIN(book);
        if (method === 'app') {
            return `kindle://book?action=open&asin=${effectiveAsin}`;
        }
        return `https://read.amazon.co.jp/?asin=${effectiveAsin}`;
    }

    /**
     * 手動で書籍を追加
     */
    async addBookManually(bookData) {
        const asin = bookData.asin;

        if (!asin || !this.isValidASIN(asin)) {
            throw new Error('有効なASINが必要です');
        }

        // 重複チェック
        if (this.library.books.find(book => book.asin === asin)) {
            throw new Error('この本は既に蔵書に追加されています');
        }

        const newBook = {
            asin: asin,
            title: bookData.title || 'タイトル未設定',
            authors: bookData.authors || '著者未設定',
            acquiredTime: bookData.acquiredTime || Date.now(),
            readStatus: bookData.readStatus || 'UNKNOWN',
            productImage: bookData.productImage || `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.L.jpg`,
            source: 'manual_add',
            addedDate: Date.now(),
            ...(bookData.originType ? { originType: bookData.originType } : {}),
            ...(bookData.statusFromPlatformSearch ? { statusFromPlatformSearch: bookData.statusFromPlatformSearch } : {}),
            ...(bookData.lendingType ? { lendingType: bookData.lendingType } : {}),
            ...(bookData.lendingStatus ? { lendingStatus: bookData.lendingStatus } : {})
        };

        this.library.books.push(newBook);
        this.library.metadata.totalBooks = this.library.books.length;
        this.library.metadata.manuallyAdded = this.library.books.filter(book => book.source === 'manual_add').length;
        this._bumpRev();

        await this.saveLibrary();
        return newBook;
    }

    /**
     * Amazonリンクから書籍を追加
     */
    async addBookFromAmazonUrl(url) {
        const asin = this.extractASINFromUrl(url);
        if (!asin) {
            throw new Error('有効なAmazonリンクではありません');
        }

        // Amazon APIから書籍情報を取得（簡易版）
        const bookData = await this.fetchBookDataFromAmazon(asin);
        return await this.addBookManually(bookData);
    }

    /**
     * 書籍を削除
     */
    async deleteBook(asin, hardDelete = false) {
        const bookIndex = this.library.books.findIndex(book => book.asin === asin);
        
        if (bookIndex === -1) {
            throw new Error('指定された書籍が見つかりません');
        }

        if (hardDelete) {
            // 完全削除
            this.library.books.splice(bookIndex, 1);
            this.library.metadata.totalBooks = this.library.books.length;

            // ソース別カウント更新
            this.library.metadata.manuallyAdded = this.library.books.filter(book => book.source === 'manual_add').length;
            this.library.metadata.importedFromKindle = this.library.books.filter(book => book.source === 'kindle_import').length;
            this._bumpRev();
        }

        await this.saveLibrary();
        return true;
    }

    /**
     * 蔵書を全てクリア
     */
    async clearAllBooks() {
        this.library.books = [];
        this.library.metadata = {
            totalBooks: 0,
            manuallyAdded: 0,
            importedFromKindle: 0,
            lastImportDate: null
        };
        this._bumpRev();

        await this.saveLibrary();
        return true;
    }

    /**
     * 書籍情報を更新
     */
    async updateBook(asin, updates) {
        const bookIndex = this.library.books.findIndex(book => book.asin === asin);
        if (bookIndex === -1) {
            throw new Error('指定された書籍が見つかりません');
        }

        const book = this.library.books[bookIndex];

        // undefinedの場合はプロパティを削除
        Object.keys(updates).forEach(key => {
            if (updates[key] === undefined) {
                delete book[key];
            } else {
                book[key] = updates[key];
            }
        });

        // メタデータを更新
        this.library.metadata.totalBooks = this.library.books.length;
        this.library.metadata.manuallyAdded = this.library.books.filter(b => b.source === 'manual_add').length;
        this.library.metadata.importedFromKindle = this.library.books.filter(b => b.source === 'kindle_import').length;
        this._bumpRev();

        await this.saveLibrary();
        return book;
    }

    /**
     * ASINの妥当性チェック
     */
    isValidASIN(asin) {
        return /^[A-Z0-9]{10}$/.test(asin);
    }

    /**
     * 取得日時 (acquiredTime・ミリ秒) を、日付だけの欄 (type="date") の値 'YYYY-MM-DD' にする。
     * 閲覧の表示 (toLocaleDateString) と同じ、端末のタイムゾーンの日付で作る
     * (toISOString は UTC の日付になり、閲覧と1日ずれることがある・イシュー#631)。
     * 数として読めない値は '' (空の欄) を返す。
     * 欄と取得日時の変換は、これと dateInputToAcquiredTime が唯一の正。
     */
    acquiredTimeToDateInput(acquiredTime) {
        const date = new Date(Number(acquiredTime));
        if (Number.isNaN(date.getTime())) return '';
        const pad = (n, width) => String(n).padStart(width, '0');
        return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
    }

    /**
     * 日付だけの欄の値 'YYYY-MM-DD' を、取得日時 (ミリ秒) にする。その日の、端末のタイムゾーンの0時。
     * new Date('YYYY-MM-DD') は UTC の0時になり、UTC より西では前の日として表示されるので使わない (イシュー#631)。
     * 形式が違う値・実在しない日付は null を返す。
     */
    dateInputToAcquiredTime(value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
        if (!m) return null;
        const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
        return date.getTime();
    }

    /**
     * ライブラリデータをファイルに保存（エクスポート用）
     */
    async saveLibrary() {
        // LocalStorage に保存
        localStorage.setItem('virtualBookshelf_library', JSON.stringify(this.library));
        
        // ダウンロード可能な形でエクスポート
        return this.library;
    }


    /**
     * 統計情報を取得
     */
    getStatistics() {
        const books = this.library.books;
        return {
            total: books.length,
            read: books.filter(book => book.readStatus === 'READ').length,
            unread: books.filter(book => book.readStatus === 'UNKNOWN').length,
            manuallyAdded: books.filter(book => book.source === 'manual_add').length,
            importedFromKindle: books.filter(book => book.source === 'kindle_import').length,
            lastImportDate: this.library.metadata.lastImportDate
        };
    }

    /**
     * 全ての書籍を取得
     */
    getAllBooks() {
        return this.library.books;
    }

    /**
     * ASIN で書籍を検索
     */
    findBookByASIN(asin) {
        return this.library.books.find(book => book.asin === asin);
    }

    /**
     * 同じ ASIN を持つ本をグループ化して返す (イシュー#484)。
     * notes/bookOrder/exclusions 等が asin をキーにしているため、別の本に同じ ASIN が
     * 付いていると設定を共有してしまう問題の検出に使う。データは変更しない(検出のみ)。
     * 戻り値: [{ asin, books, sameTitle }]。sameTitle=true は同じ本の二重登録
     * (B0F2TC5B79型・実害小)、false は別の本に同じASINが付いた状態 (B00I8AT186型・対処対象)。
     * 重複が無ければ空配列。
     */
    findDuplicateAsinGroups() {
        const byAsin = new Map();
        for (const book of this.library.books) {
            if (!byAsin.has(book.asin)) byAsin.set(book.asin, []);
            byAsin.get(book.asin).push(book);
        }
        const groups = [];
        for (const [asin, books] of byAsin) {
            if (books.length < 2) continue;
            const sameTitle = books.every(b => b.title === books[0].title);
            groups.push({ asin, books, sameTitle });
        }
        return groups;
    }

    /**
     * タイトルまたは著者で書籍を検索
     */
    searchBooks(query) {
        const lowercaseQuery = query.toLowerCase();
        return this.library.books.filter(book => 
            book.title.toLowerCase().includes(lowercaseQuery) ||
            book.authors.toLowerCase().includes(lowercaseQuery)
        );
    }
}

// BookManager の自動エクスポート処理（定期保存）
class AutoSaveManager {
    constructor(bookManager) {
        this.bookManager = bookManager;
        this.setupAutoSave();
    }

    setupAutoSave() {
        // 5分ごとに自動保存
        setInterval(() => {
            this.bookManager.saveLibrary();
        }, 5 * 60 * 1000);

        // ページ離脱時の保存
        window.addEventListener('beforeunload', () => {
            this.bookManager.saveLibrary();
        });
    }
}
// クラスは window.<ClassName> 公開 (プロジェクト流儀 / テストの jsdom import 用)
window.BookManager = BookManager;
window.AutoSaveManager = AutoSaveManager;
