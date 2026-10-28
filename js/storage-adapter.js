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

    /**
     * 同一パスへの書き込み/削除を直列化する汎用キュー (同一タブ内の並行呼び出し対策)。
     * GitHubAdapter の `_writeQueues` (イシュー#11〜) を一般化し、HubStorageAdapter もこれを使う
     * (イシュー#374・案D)。queue は呼び出し側 (adapter インスタンス) が path→Promise の Map として持つ。
     * @param {Map<string, Promise>} queueMap
     * @param {string} path
     * @param {function():Promise} task
     * @returns {Promise}
     */
    static _enqueue(queueMap, path, task) {
        const prev = queueMap.get(path) || Promise.resolve();
        const result = prev.then(task, task);
        queueMap.set(path, result.catch(() => {}));
        return result;
    }

    /**
     * 衝突 (409/412) 受信後のリカバリ共通アルゴリズム。GitHubAdapter の
     * `_recoverFromConflictAndRetry` (ADR-080/081・イシュー#142/#150) を一般化し、
     * HubStorageAdapter もこれを使う (イシュー#374・案D)。
     *
     * 最新の内容を取り直し、「直前に自分が認識していたリモート内容 (knownContent)」と比較する。
     *   一致 (= 誰も割り込んでいない。sha/etag キャッシュのズレだけ。両者とも null = 相手も
     *     自分と同じく「存在しない」と認識している、も含む) → retryPut を1回だけ呼び、その戻り値を
     *     返す (単なる自分の先行書き込みの再送として成功扱い)。
     *   不一致 (= 他タブ/他デバイスが実際に内容を変えている。相手が削除した結果 latestContent が
     *     null になるケースも含む・2026-10-26 イシュー#381で修正=以前は latestContent===null を
     *     無条件で「一致」扱いし、削除されたファイルを盲目的に再作成していた) → 盲目的に上書きせず、
     *     makeRemoteChangedError が作るエラーを投げて中断する (lost update 防止)。
     * retryPut が再び衝突エラーを投げた場合はそのまま呼び出し元へ伝播する (本当の競合)。
     *
     * @param {object} ctx
     * @param {function():Promise<{content:string, token:*}|null>} ctx.getLatest 現在の内容とトークン(sha/etag)。ファイル無しなら null
     * @param {string|null|undefined} ctx.knownContent 直前に自分が認識していたリモート内容
     * @param {function(latest:{content:string,token:*}|null):Promise<*>} ctx.retryPut 1回だけ再送する
     * @param {function(latestContent:string|null):Error} ctx.makeRemoteChangedError 不一致時に投げるエラーを作る
     * @returns {Promise<*>} retryPut の戻り値
     */
    static async recoverFromConflict({ getLatest, knownContent, retryPut, makeRemoteChangedError }) {
        const latest = await getLatest();
        const latestContent = latest ? latest.content : null;
        // 以前は `latestContent !== null` を先に見ていたため、相手が削除して latestContent が
        // null になったケースが素通りして retryPut(null=無条件PUT) に落ち、削除された直後の
        // ファイルを盲目的に再作成してしまっていた (イシュー#381・バッチ側の同種ギャップと対で修正)。
        // null同士の一致 (= 相手も「存在しない」ままで、自分の知識と食い違っていない) だけは
        // そのまま retryPut (= 新規作成の再送) を許す。
        if (knownContent === undefined || latestContent !== knownContent) {
            throw makeRemoteChangedError(latestContent);
        }
        return retryPut(latest);
    }

    /**
     * 失敗したら delayMs 待って retries 回まで再試行する汎用ヘルパー (イシュー#391 TO+D の抽出・
     * #392 step4 で②承認。GitHubAdapter._getContent にベタ書きされていた「5秒タイムアウトで失敗
     * したら2秒待って1回だけ再試行」をここに移す・振る舞いは変えない)。fn は1回分の試行を行う
     * 関数(Promiseを返す)。5xx/429 の判定等、再試行すべきかどうかの分岐は今回未実装(GitHubAdapter
     * のコメントのとおり次回の課題)。
     * @param {function():Promise} fn
     * @param {{retries?:number, delayMs?:number}} [opts]
     */
    static async withRetry(fn, { retries = 1, delayMs = 2000 } = {}) {
        let lastErr;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await fn();
            } catch (e) {
                lastErr = e;
                if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
            }
        }
        throw lastErr;
    }
}

/**
 * 「一覧+版情報 (sha/ETag等)」と前回読んだ版をローカル (localStorage) に対応付けて覚えておき、
 * リモートの版が前回と同じならネットワーク取得をスキップするための共通キャッシュ
 * (イシュー#391 R の抽出・#392 step4 で②承認)。
 *
 * GitHubAdapter(_loadLocalCache/_saveLocalCache/_tryReadFromShaCache/_rememberShaCache)に
 * ベタ書きされていたロジックをここに移した(振る舞いは変えない)。「一覧+版情報の取得手段」
 * (GitHub=tree API 一括 / Hub=listDir の entries) はバックエンドごとに異なるため adapter 側に残し、
 * 「版が一致するかどうかの判定・ローカル保存・読み出し」だけをここに持つ。
 *
 * ns (namespace): adapter が自分の識別子(owner/repo/branch や apiBase 等)から作る localStorage キー。
 * fullPath: adapter 内部のフルパス表現(basePath 等を含めた実パス)。
 */
class VersionCache {
    constructor(ns) {
        this.ns = ns;
        this._data = null; // 遅延読み込み: {[fullPath]: {version, text}}
    }

    _load() {
        if (this._data) return this._data;
        try {
            const raw = localStorage.getItem(this.ns);
            this._data = raw ? JSON.parse(raw) : {};
        } catch (_) { this._data = {}; }
        return this._data;
    }

    _save() {
        try { localStorage.setItem(this.ns, JSON.stringify(this._data || {})); }
        catch (_) { /* QuotaExceeded等は諦める(キャッシュが使えないだけで機能は壊れない) */ }
    }

    /**
     * remoteVersion (リモートの一覧取得で分かった版) がローカル保存分と一致すれば本文を返す。
     * 比較前に弱い ETag 接頭辞 (W/) を正規化する(#392 step6 本番実測で発見: listDir の entries[].etag
     * は R2 の httpEtag をそのまま返す強い ETag だが、GET レスポンスの ETag ヘッダは本番の
     * Cloudflare 経由で `W/"..."` に変わることがあり、文字列比較だけだと値が同じでも常にミスする
     * =「変更なしでも毎回GET」という本末転倒になっていた。GitHub の sha にはこの接頭辞が付かない
     * ため正規化しても無害)。
     * @param {string} fullPath
     * @param {string|undefined} remoteVersion 一覧に無い(取得失敗・旧応答・truncated等)なら undefined
     * @returns {string|undefined} ヒットすれば本文、ミスなら undefined (呼び出し側は通常取得にフォールバック)
     */
    read(fullPath, remoteVersion) {
        if (remoteVersion === undefined) return undefined;
        const entry = this._load()[fullPath];
        if (entry && VersionCache._stripWeak(entry.version) === VersionCache._stripWeak(remoteVersion)) return entry.text;
        return undefined;
    }

    static _stripWeak(v) {
        return typeof v === 'string' ? v.replace(/^W\//, '') : v;
    }

    remember(fullPath, version, text) {
        const local = this._load();
        local[fullPath] = { version, text };
        this._save();
    }
}

window.StorageAdapter = StorageAdapter;
window.VersionCache = VersionCache;
