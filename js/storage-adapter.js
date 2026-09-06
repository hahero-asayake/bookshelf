// StorageAdapter - 同期ストレージの抽象基底クラス
//
// bookshelf は同期方式を切り替えられる (Local FS / GitHub / Asayake ハブ)。
// この基底クラスは「path 文字列ベースの最小 I/O インタフェース」を定義する。
// 具象クラスは継承して各 API を実装する。
//
// パス表現: スラッシュ区切り。例 "bookshelves/all.json", "books/B0XXXX__title.md"
// 戻り値の規約: 読み込み系は「存在しない場合 null」を返し、例外を投げない。

class StorageAdapter {
    /**
     * 接続状態。書き込み可能かを返す。
     * @returns {boolean}
     */
    isConnected() {
        return false;
    }

    /**
     * JSON ファイル読み込み。存在しなければ null。
     * @param {string} path
     * @returns {Promise<object|null>}
     */
    async readJSON(path) {
        throw new Error('StorageAdapter.readJSON() must be implemented');
    }

    /**
     * JSON ファイル書き込み。親ディレクトリは必要に応じて作成する。
     * @param {string} path
     * @param {object} data
     * @returns {Promise<void>}
     */
    async writeJSON(path, data) {
        throw new Error('StorageAdapter.writeJSON() must be implemented');
    }

    /**
     * テキストファイル読み込み。存在しなければ null。
     * @param {string} path
     * @returns {Promise<string|null>}
     */
    async readText(path) {
        throw new Error('StorageAdapter.readText() must be implemented');
    }

    /**
     * テキストファイル書き込み。
     * @param {string} path
     * @param {string} text
     * @returns {Promise<void>}
     */
    async writeText(path, text) {
        throw new Error('StorageAdapter.writeText() must be implemented');
    }

    /**
     * ファイル存在確認。
     * @param {string} path
     * @returns {Promise<boolean>}
     */
    async fileExists(path) {
        throw new Error('StorageAdapter.fileExists() must be implemented');
    }

    /**
     * ファイル削除。存在しない場合は黙って成功扱い。
     * @param {string} path
     * @returns {Promise<void>}
     */
    async deleteFile(path) {
        throw new Error('StorageAdapter.deleteFile() must be implemented');
    }

    /**
     * ディレクトリ内のファイル一覧。
     * 戻り値は path 直下のエントリ名 (ファイルのみ、ディレクトリは含めない)。
     * 存在しない場合は []。
     * @param {string} dirPath
     * @returns {Promise<string[]>}
     */
    async listFiles(dirPath) {
        throw new Error('StorageAdapter.listFiles() must be implemented');
    }

    /**
     * ディレクトリ内のサブディレクトリ一覧。
     * プラグインスキャン (plugins/<id>/) で使用。
     * @param {string} dirPath
     * @returns {Promise<string[]>}
     */
    async listDirs(dirPath) {
        throw new Error('StorageAdapter.listDirs() must be implemented');
    }

    /**
     * fetch() をタイムアウト付きで実行し、レスポンス本文まで読み切って返す (イシュー#134/#143)。
     *
     * なぜ: #134 では Response をそのまま返す fetchWithTimeout を実装したが、これは「ヘッダ受信まで」
     * しかタイムアウトを保証しない欠陥があった。fetch() の Promise はレスポンスヘッダを受信した時点で
     * resolve するため、finally の clearTimeout もそこで実行されてしまい、以後どれだけ本文の送信が
     * 遅延・停止しても abort は発火しない (イシュー#143 で実機再現・特定)。
     *
     * このメソッドは「ヘッダ受信から本文読了まで」を1つのタイマーで覆う。加えて、Response を返さず
     * 本文まで読み切った結果を返すことで、呼び出し側が res.text()/res.json() を無防備に書いて
     * 同じ穴を再現する余地を構造的に無くす。StorageAdapter の具象クラスは素の fetch() は勿論、
     * Response を直接扱う実装もせず、これ (または fetchJSON) を経由すること。
     * @param {string} url
     * @param {RequestInit} [init]
     * @param {number} [timeoutMs=10000] 10秒: ハブ/GitHub 双方の通常応答 (概ね数百ms〜2秒) に
     *   対して十分な余裕を持たせつつ、無応答時に「生成中…」が体感で壊れて見えるほど長引かせない値。
     * @param {{onHeaders?:function, onBody?:function}} [hooks] イシュー#156: 段階トレース用の任意コールバック。
     *   onHeaders はヘッダ受信直後 (本文読み取り開始前)、onBody は本文読み切り直後に呼ばれる。どちらも
     *   省略可・戻り値は無視する (計装のみ・成否やタイミングに一切影響しない)。
     * @returns {Promise<{status:number, ok:boolean, statusText:string, headers:Headers, body:string}>}
     */
    static async fetchText(url, init = {}, timeoutMs = 10000, hooks = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...init, signal: controller.signal });
            if (typeof hooks.onHeaders === 'function') hooks.onHeaders({ status: res.status, ok: res.ok });
            const body = await res.text();
            if (typeof hooks.onBody === 'function') hooks.onBody();
            return { status: res.status, ok: res.ok, statusText: res.statusText, headers: res.headers, body };
        } catch (e) {
            if (e.name === 'AbortError') {
                throw new Error(`通信がタイムアウトしました (${timeoutMs}ms): ${url}`);
            }
            throw e;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * fetchText の結果を JSON.parse する。本文が空、または JSON として不正な場合は
     * 例外を投げず json:null を返す (呼び出し側は status/ok で成否判定してから json を使う設計のため、
     * エラーレスポンスの本文が非JSONでも呼び出し側の分岐を壊さない)。
     * @param {{onHeaders?:function, onBody?:function}} [hooks] fetchText 参照 (イシュー#156)。
     * @returns {Promise<{status, ok, statusText, headers, body, json}>}
     */
    static async fetchJSON(url, init = {}, timeoutMs = 10000, hooks = {}) {
        const result = await StorageAdapter.fetchText(url, init, timeoutMs, hooks);
        let json = null;
        if (result.body) {
            try { json = JSON.parse(result.body); } catch (_) { /* 呼び出し側は json===null なら body を使う */ }
        }
        return { ...result, json };
    }

    /**
     * fetch 以外の Promise (File System Access API 等、AbortController を受け付けない API) に
     * タイムアウトを掛ける汎用ヘルパー (イシュー#153)。LocalFSAdapter.readText/readJSON はこれまで
     * fetchText/fetchJSON のタイムアウト保護の外にあり、権限プロンプト待ちやハンドル失効時に
     * 無期限で pending する余地があった。元の Promise 自体はキャンセルできない (FS API に signal は
     * 無い) ため、タイムアウト後もバックグラウンドで実行され続ける点に注意 (諦めてエラーを返すだけ)。
     * @template T
     * @param {Promise<T>} promise
     * @param {number} timeoutMs
     * @param {string} label エラーメッセージに含める操作名
     * @returns {Promise<T>}
     */
    static async withTimeout(promise, timeoutMs, label) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label}がタイムアウトしました (${timeoutMs}ms)`)), timeoutMs);
        });
        try {
            return await Promise.race([promise, timeout]);
        } finally {
            clearTimeout(timer);
        }
    }
}

window.StorageAdapter = StorageAdapter;
