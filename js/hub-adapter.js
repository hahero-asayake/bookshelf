// HubStorageAdapter - Asayake ハブ (hahero 運営) への平文私的同期 (ADR-032, 09 §10.5)
//
// StorageAdapter 実装 (Local / GitHub に次ぐ 3 つ目)。GitHub と同様に path ベース I/O を提供し、
// 既存の同期パイプライン (saveUserData / syncToObsidianFolder / 衝突処理) にそのまま乗る。
//
// バックエンドは Cloudflare Worker + R2 (別紙 09 §10)。アダプタは uid を知らず、
// 認証キー (ハブ公開キー hk_…) を載せて path を送るだけ。Worker 側が data/<uid>/ に名前空間化する。
//
// API 契約 (api/data):
//   GET    {apiBase}/data/<path>            → 200 本文 + ETag ヘッダ / 404 = 存在しない (null)
//   PUT    {apiBase}/data/<path>            → If-Match:<etag> で楽観ロック。201/200 + 新 ETag
//                                              412 = 衝突 / 413 = quota 超過 / 401 = 認証失効
//   DELETE {apiBase}/data/<path>            → 204 / 404 も成功扱い
//   GET    {apiBase}/data/<dir>?list=1      → 200 { files:[name…], dirs:[name…] }
//   POST   {apiBase}/data/batch             → { entries:[{op,path,content?,ifMatch?,ifNoneMatch?}] }
//                                              ifMatch/ifNoneMatch 省略 (旧アプリ互換) は無条件で適用。
//                                              200 = 全適用 / 412 = 1件でも不一致で全体不書込 (イシュー#376) /
//                                              409 = worker側補償ロールバック自体が失敗 (partial)
//
// ※ private データは「テキスト (JSON / Markdown)」のみ。バイナリは扱わない。
// ※ インフラ未稼働 (設計のみ)。Worker の JWT 検証・私的 API は本番前に実機検証必須。

// commitBatch の事前HEAD (期待ETag確定) を同時に送る本数の上限 (イシュー#376 ②指示2026-10-26)。
const BATCH_HEAD_CONCURRENCY = 6;

class HubConflictError extends Error {
    constructor(message, path) {
        super(message);
        this.name = 'HubConflictError';
        this.path = path;
    }
}

// 412 受信後にリトライしたが、リモート本文が自分の最終認識と異なっていた (= 他タブ/他デバイスが
// 実際に内容を変えている) ケース。GitHubRemoteChangedError (js/github-adapter.js) と同じ役割
// (イシュー#374・案D)。盲目的に上書きしない防波堤であり、HubConflictError (本当の競合=リトライ
// してもなお412) とは区別する。
class HubRemoteChangedError extends Error {
    constructor(message, path) {
        super(message);
        this.name = 'HubRemoteChangedError';
        this.path = path;
    }
}

class HubAuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'HubAuthError';
    }
}

class HubQuotaError extends Error {
    constructor(message) {
        super(message);
        this.name = 'HubQuotaError';
    }
}

class HubStorageAdapter extends StorageAdapter {
    /**
     * @param {object} config
     * @param {string}   config.apiBase  API ルート (例 "https://api.asayake.example")
     * @param {function} config.getKey   ハブ公開キーを返す (() => string|Promise<string>)。失効時の再発行は auth 層の責務
     */
    constructor({ apiBase, getKey }) {
        super();
        if (!apiBase || typeof getKey !== 'function') {
            throw new Error('HubStorageAdapter requires apiBase and getKey');
        }
        this.apiBase = String(apiBase).replace(/\/+$/, '');
        this._getKey = getKey;
        this._etagCache = new Map();
        // 直前に自分が認識していたリモート本文 (412 リカバリの本文比較に使う)。
        // _writeQueues は同一パスへの write/delete の直列化 (イシュー#374・案D、github-adapter.js と同じ型)。
        this._lastKnownContent = new Map();
        this._writeQueues = new Map();
        this._batch = null;
    }

    isConnected() {
        return !!this.apiBase;
    }

    // ===== StorageAdapter 実装 =====

    async readJSON(path) {
        const text = await this._read(path);
        if (text == null) return null;
        return text.trim() ? JSON.parse(text) : null;
    }

    async writeJSON(path, data) {
        await this._write(path, JSON.stringify(data, null, 2));
    }

    async readText(path, hooks) {
        return this._read(path, hooks);
    }

    async writeText(path, text) {
        await this._write(path, text);
    }

    async fileExists(path) {
        const res = await this._fetch('GET', this._dataUrl(path), { method: 'HEAD' });
        if (res.status === 404) return false;
        if (!res.ok) throw this._err(res, `HEAD ${path}`);
        const etag = res.headers.get('ETag');
        if (etag) this._etagCache.set(path, etag);
        return true;
    }

    // write と同じキューに乗せる (同一パスへの write→delete / delete→write の連打順序を保証・イシュー#374案D)
    async deleteFile(path) {
        return StorageAdapter._enqueue(this._writeQueues, path, () => this._deleteOnce(path));
    }

    async _deleteOnce(path) {
        const res = await this._fetch('DELETE', this._dataUrl(path));
        if (res.status === 404) { this._etagCache.delete(path); this._lastKnownContent.delete(path); return; }
        if (!res.ok) throw this._err(res, `DELETE ${path}`);
        this._etagCache.delete(path);
        this._lastKnownContent.delete(path);
    }

    async listFiles(dirPath) {
        const data = await this._list(dirPath);
        return data ? (data.files || []) : [];
    }

    async listDirs(dirPath) {
        const data = await this._list(dirPath);
        return data ? (data.dirs || []) : [];
    }

    // ===== バッチ (1 リクエストで複数 put/delete) =====

    beginBatch() { this._batch = []; }

    addBatchEntry(path, content) {
        if (!this._batch) throw new Error('HubStorageAdapter: no active batch (call beginBatch first)');
        this._batch.push({ op: 'put', path, content });
    }

    addBatchDelete(path) {
        if (!this._batch) throw new Error('HubStorageAdapter: no active batch (call beginBatch first)');
        this._batch.push({ op: 'delete', path });
    }

    discardBatch() { this._batch = null; }

    hasBatchEntries() { return Array.isArray(this._batch) && this._batch.length > 0; }

    // 2026-10-26 イシュー#376 (#374 step2 のコメントを更新): worker 側 handleBatch が
    // ifMatch/ifNoneMatch による楽観ロックに対応した (ADR-132 で発見・ADR-xxx で対応)。
    // 各 entry に期待 ETag (ifMatch) または新規作成条件 (ifNoneMatch:'*') を付けて送り、
    // 412 (衝突) は単発 _writeOnce/_recoverFromConflictAndRetry と同じ意味に揃える:
    // 本文が一致すれば成功扱い (lost update にはならない) / 不一致なら上書きせず HubRemoteChangedError。
    async commitBatch() {
        if (!this._batch || this._batch.length === 0) { this._batch = null; return null; }
        const batch = this._batch;
        this._batch = null;
        const entries = await this._prepareBatchEntries(batch);
        return this._commitBatchOnce(entries);
    }

    // 各 entry に ifMatch/ifNoneMatch を付与する。_etagCache に値があればそれを使い (追加の通信無し)、
    // 無ければ単発 _writeOnce と同じく HEAD で1回だけ読んで確定する (キャッシュ無し=初回書込み等)。
    // 404 の delete は「既に無い」=目的達成済みとしてバッチから外す (単発 _deleteOnce の404=成功扱いと同じ)。
    // 2026-10-26 ②指示: plugin seed 等 件数の多いバッチで事前HEADが逐次だとRTT×件数で遅くなる
    // (実測: 標準プラグイン初回シード15entry・逐次で14HEAD=ローカルモックで約20ms→本番はRTT分が
    // 直列に積む)。BATCH_HEAD_CONCURRENCY 本ずつ Promise.all で並行化し、1チャンク≒1RTTに圧縮する。
    async _prepareBatchEntries(batch) {
        const results = new Array(batch.length);
        for (let i = 0; i < batch.length; i += BATCH_HEAD_CONCURRENCY) {
            const chunk = batch.slice(i, i + BATCH_HEAD_CONCURRENCY);
            const resolved = await Promise.all(chunk.map((e) => this._resolveBatchEntry(e)));
            for (let j = 0; j < chunk.length; j++) results[i + j] = resolved[j];
        }
        return results.filter((r) => r !== null); // null = 削除対象が既に無い (バッチから除外)
    }

    async _resolveBatchEntry(e) {
        const path = this._normalize(e.path);
        let ifMatch = this._etagCache.get(path);
        if (ifMatch === undefined) {
            const head = await this._fetch('GET', this._dataUrl(path), { method: 'HEAD' });
            if (head.ok) {
                ifMatch = head.headers.get('ETag') || undefined;
                if (ifMatch) this._etagCache.set(path, ifMatch);
            } else if (head.status === 404) {
                if (e.op === 'delete') return null; // 削除対象が既に無い: 削除不要
                return { op: 'put', path, content: e.content, ifNoneMatch: '*' };
            } else {
                throw this._err(head, `HEAD ${path}`);
            }
        }
        const entry = e.op === 'delete' ? { op: 'delete', path } : { op: 'put', path, content: e.content };
        if (ifMatch) entry.ifMatch = ifMatch;
        return entry;
    }

    async _commitBatchOnce(entries) {
        if (entries.length === 0) { this._etagCache.clear(); return true; } // 全entryが事前判定で既に不要だった
        const res = await this._fetch('POST', `${this.apiBase}/data/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries })
        });
        if (res.status === 409) {
            // worker 側の補償ロールバック自体が失敗した (partial:true・ADR-xxx 参照)。
            // この回では直せない状態なので、盲目的な再送はせずそのまま呼び出し元へ伝える。
            throw new Error(`hub batch write failed on server (partial compensation): ${res.body ? String(res.body).slice(0, 200) : ''}`);
        }
        if (res.status === 412) return this._recoverBatchConflictAndRetry(entries, res);
        if (!res.ok) throw this._err(res, 'POST data/batch');
        this._etagCache.clear();
        for (const e of entries) this._lastKnownContent.set(e.path, e.op === 'delete' ? undefined : e.content);
        return true;
    }

    /**
     * batch 412 受信後のリカバリ (_recoverFromConflictAndRetry の複数 entry 版・イシュー#376)。
     * レスポンスの conflicts:[{path,etag}] ごとに最新内容を取り直し、
     *   本文が自分が送ろうとした内容と一致 → 既に反映済み (自分の先行書込の再送 or 他タブが
     *     同じ内容を書いた)。lost update ではないので成功扱いとしてそのentryを再送対象から外す。
     *   本文が自分の知っていた内容 (_lastKnownContent) と一致 → ETag キャッシュのズレだけ。
     *     新しい ETag に差し替えて再送対象に残す。
     *   それ以外 → 他タブ/他デバイスが実際に内容を変えている。盲目的に上書きせず HubRemoteChangedError。
     * 差し替え後に1回だけ再送し、それでも 409/412 なら本当の競合として HubConflictError。
     */
    async _recoverBatchConflictAndRetry(entries, res) {
        const conflicts = (res.json && Array.isArray(res.json.conflicts)) ? res.json.conflicts : null;
        if (!conflicts) {
            // worker が conflicts 詳細を返さない (想定外の応答) → 個別判定できないので安全側に倒す
            throw new HubConflictError('batch conflict on hub (data changed since read, no conflict detail)', null);
        }
        const conflictPaths = new Set(conflicts.map(c => c.path));
        const retry = [];
        for (const e of entries) {
            if (!conflictPaths.has(e.path)) { retry.push(e); continue; }
            console.warn(`[HubStorageAdapter] batch 412 on ${e.path}: etag を破棄して最新状態を取り直します`);
            this._etagCache.delete(e.path);
            const latestRes = await this._fetch('GET', this._dataUrl(e.path));
            if (!latestRes.ok && latestRes.status !== 404) throw this._err(latestRes, `GET ${e.path}`);
            const latestContent = latestRes.status === 404 ? null : latestRes.body;
            const latestEtag = latestRes.status === 404 ? undefined : (latestRes.headers.get('ETag') || undefined);
            const knownContent = this._lastKnownContent.get(e.path);
            const wantContent = e.op === 'delete' ? null : e.content;

            if (latestContent === wantContent) {
                // 既に望む状態になっている (delete なら既に無い / put なら同じ内容が既にある)
                if (latestEtag) this._etagCache.set(e.path, latestEtag);
                this._lastKnownContent.set(e.path, wantContent === null ? undefined : wantContent);
                continue; // 再送不要
            }
            if (latestContent !== null && knownContent !== undefined && latestContent === knownContent) {
                // 自分の ETag キャッシュがズレていただけ (リモートは自分が最後に認識した内容のまま)
                const next = { ...e, ifMatch: latestEtag };
                delete next.ifNoneMatch;
                if (!next.ifMatch) delete next.ifMatch;
                retry.push(next);
                continue;
            }
            if (latestContent === null && e.ifNoneMatch === '*') {
                // 新規作成を試みた対象が (head 判定後に) 実際には無かった → そのまま続行
                retry.push(e);
                continue;
            }
            console.error(`[HubStorageAdapter] ${e.path} はリモートで内容が変わっている。上書きせず中断します`);
            throw new HubRemoteChangedError(`${e.path} は他の場所で更新されています。内容を確認して保存し直してください。`, e.path);
        }
        if (retry.length === 0) { this._etagCache.clear(); return true; }
        const res2 = await this._fetch('POST', `${this.apiBase}/data/batch`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: retry })
        });
        if (res2.status === 409 || res2.status === 412) {
            throw new HubConflictError('batch conflict on hub (data changed since read)', null);
        }
        if (!res2.ok) throw this._err(res2, 'POST data/batch (retry)');
        this._etagCache.clear();
        for (const e of retry) this._lastKnownContent.set(e.path, e.op === 'delete' ? undefined : e.content);
        return true;
    }

    // ===== 公開 (共有ハブへのサイト投稿, ADR-033) =====
    // 公開ページ群を /publish に POST し、sites/<siteId>/ を今回集合で置換する。
    // 私的同期 (data/) とは別経路。deleteMissing=true で今回出力に無いファイルをサーバ側で削除。
    // affiliateTag: 本人の Amazon アフィタグ。Worker が uid レコードに記録し、Plus 時に /go が
    //   クリック時に解決して使う (ADR-034追補)。空文字なら送らない。
    // index: 索引 (ADR-099) 用の記事メタ [{publicId,title,description,tags,coverUrl,publishedAt,modifiedAt}]。
    //   サーバは files に置いた記事 (<publicId>/index.html) の分だけを D1 に載せ、deleteMissing 時は無い記事の行を消す。
    //   省略 (旧呼び出し) ならメタは送らない (サーバは files の集合で削除同期だけ行う)。
    // @returns {Promise<{ok, siteId, siteUrl, published, indexed}>}
    async publishSite(files, deleteMissing = true, affiliateTag = '', index = null) {
        const payload = {
            // encoding='base64' (og.png 等のバイナリ) は Worker がデコードして R2 に置く。未指定は従来どおり文字列。
            files: (files || []).map(f => f.encoding
                ? { path: this._normalize(f.path), content: f.content || '', encoding: f.encoding }
                : { path: this._normalize(f.path), content: f.content || '' }),
            deleteMissing: !!deleteMissing
        };
        if (affiliateTag) payload.affiliateTag = String(affiliateTag);
        if (Array.isArray(index)) payload.index = index;
        const res = await this._fetch('POST', `${this.apiBase}/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.status === 413) throw new HubQuotaError('ハブの保存容量がいっぱいで公開できません。不要なデータを減らすか、Plus へのアップグレードをご検討ください。');
        if (res.status === 429) throw new Error('短時間に操作が集中しました。少し時間をおいてから、もう一度公開してください。');
        if (res.status >= 500) throw new Error('ハブ側で一時的なエラーが発生しました。時間をおいて再試行してください。');
        if (!res.ok) throw this._err(res, 'POST publish');
        return res.json;
    }

    // ===== 内部 =====

    async _read(path, hooks) {
        const res = await this._fetch('GET', this._dataUrl(path), {}, hooks);
        if (res.status === 404) return null;
        if (!res.ok) throw this._err(res, `GET ${path}`);
        const etag = res.headers.get('ETag');
        if (etag) this._etagCache.set(path, etag);
        this._lastKnownContent.set(path, res.body);
        return res.body;
    }

    // 同一パスへの write/delete を直列化する (同一タブ内の並行呼び出し対策・イシュー#374案D)。
    // github-adapter.js の _write/_enqueue と同じ型 (StorageAdapter._enqueue を共用)。
    async _write(path, text) {
        return StorageAdapter._enqueue(this._writeQueues, path, () => this._writeOnce(path, text));
    }

    async _writeOnce(path, text) {
        // 楽観ロック: 既知の ETag があれば If-Match。無ければ一度 read して現状 ETag を得てから上書き
        let etag = this._etagCache.get(path);
        if (etag === undefined) {
            const head = await this._fetch('GET', this._dataUrl(path), { method: 'HEAD' });
            if (head.ok) {
                etag = head.headers.get('ETag') || undefined;
                if (etag) this._etagCache.set(path, etag);
            } else if (head.status !== 404) {
                throw this._err(head, `HEAD ${path}`);
            }
        }
        try {
            await this._putOnce(path, text, etag);
            this._lastKnownContent.set(path, text);
        } catch (e) {
            if (!(e instanceof HubConflictError)) throw e;
            await this._recoverFromConflictAndRetry(path, text);
        }
    }

    async _putOnce(path, text, etag) {
        const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
        if (etag) headers['If-Match'] = etag;
        const res = await this._fetch('PUT', this._dataUrl(path), { method: 'PUT', headers, body: text });
        if (res.status === 412) throw new HubConflictError(`etag conflict on ${path}`, path);
        if (res.status === 413) throw new HubQuotaError('ハブの保存容量上限に達しました');
        if (!res.ok) throw this._err(res, `PUT ${path}`);
        const newEtag = res.headers.get('ETag');
        if (newEtag) this._etagCache.set(path, newEtag); else this._etagCache.delete(path);
        return newEtag;
    }

    /**
     * 412 受信後のリカバリ (github-adapter.js の _recoverFromConflictAndRetry と同じ意味・ADR-xxx・
     * イシュー#374案D)。最新 ETag/本文を取り直し、自分の最終認識と同じなら (=単なる ETag キャッシュ
     * のズレ) そのまま同じ内容で 1 回だけ再 PUT する (=自分の先行書き込みの再送として成功扱い)。
     * 異なっていれば他タブ/他デバイスが実際に内容を変えているので、盲目的に上書きせず
     * HubRemoteChangedError を投げて呼び出し元に知らせる (lost update 防止)。再 PUT してもなお
     * 412 なら本当の競合として HubConflictError を投げる。アルゴリズムの核は
     * StorageAdapter.recoverFromConflict (github-adapter.js と共通)。
     */
    async _recoverFromConflictAndRetry(path, text) {
        console.warn(`[HubStorageAdapter] 412 on ${path}: etag を破棄して最新状態を取り直します`);
        this._etagCache.delete(path);
        const knownContent = this._lastKnownContent.get(path);
        try {
            await StorageAdapter.recoverFromConflict({
                getLatest: async () => {
                    const res = await this._fetch('GET', this._dataUrl(path));
                    if (res.status === 404) return null;
                    if (!res.ok) throw this._err(res, `GET ${path}`);
                    return { content: res.body, token: res.headers.get('ETag') || undefined };
                },
                knownContent,
                retryPut: async (latest) => {
                    if (latest && latest.token) {
                        this._etagCache.set(path, latest.token);
                        this._lastKnownContent.set(path, latest.content);
                    }
                    return this._putOnce(path, text, latest ? latest.token : undefined);
                },
                makeRemoteChangedError: () => {
                    console.error(`[HubStorageAdapter] ${path} はリモートで内容が変わっている。上書きせず中断します`);
                    return new HubRemoteChangedError(`${path} は他の場所で更新されています。内容を確認して保存し直してください。`, path);
                }
            });
            this._lastKnownContent.set(path, text);
            console.warn(`[HubStorageAdapter] 412 on ${path}: リトライで回復しました`);
        } catch (e2) {
            if (e2 instanceof HubConflictError) {
                console.error(`[HubStorageAdapter] ${path} はリトライ後も 412 (本当の競合)`);
            }
            throw e2;
        }
    }

    async _list(dirPath) {
        const res = await this._fetch('GET', `${this._dataUrl(dirPath)}?list=1`);
        if (res.status === 404) return null;
        if (!res.ok) throw this._err(res, `LIST ${dirPath}`);
        return res.json;
    }

    // path の正規化 + 検証 (パストラバーサル拒否)
    _normalize(path) {
        const p = String(path || '').replace(/^\/+/, '');
        if (p.split('/').some(seg => seg === '..' || seg === '.')) {
            throw new Error(`HubStorageAdapter: unsafe path "${path}"`);
        }
        return p;
    }

    _dataUrl(path) {
        const norm = this._normalize(path);
        const encoded = norm.split('/').map(encodeURIComponent).join('/');
        return `${this.apiBase}/data/${encoded}`;
    }

    async _key() {
        const key = await this._getKey();
        if (!key) throw new HubAuthError('Asayake ハブに接続していません (キー無し)');
        return key;
    }

    // method 引数はログ用。実際の method は init.method を優先
    async _fetch(method, url, init = {}, hooks) {
        const key = await this._key();
        const headers = { ...(init.headers || {}), 'Authorization': `Bearer ${key}` };
        // no-store: GitHubAdapter と同じ理由 (イシュー#150・#374案D) で、ブラウザの自動キャッシュに
        // よる古い ETag/本文の再取得を防ぐ。全リクエスト (GET/HEAD/PUT/DELETE/POST) に一律適用して
        // よい (非 GET はそもそもキャッシュされないため実害は無い・1か所にまとめる)。
        const res = await StorageAdapter.fetchJSON(url, { method: init.method || method, headers, body: init.body, cache: 'no-store' }, undefined, hooks);
        if (res.status === 401) throw new HubAuthError('Asayake ハブの認証が失効しました。再接続してください');
        return res;
    }

    _err(res, ctx) {
        let detail = `${res.status} ${res.statusText}`;
        if (res.body) detail += `: ${res.body.slice(0, 200)}`;
        return new Error(`Hub API error (${ctx}): ${detail}`);
    }
}

if (typeof window !== 'undefined') {
    window.HubStorageAdapter = HubStorageAdapter;
    window.HubConflictError = HubConflictError;
    window.HubRemoteChangedError = HubRemoteChangedError;
    window.HubAuthError = HubAuthError;
    window.HubQuotaError = HubQuotaError;
}
if (typeof globalThis !== 'undefined') {
    globalThis.HubStorageAdapter = HubStorageAdapter;
    globalThis.HubConflictError = HubConflictError;
    globalThis.HubRemoteChangedError = HubRemoteChangedError;
    globalThis.HubAuthError = HubAuthError;
    globalThis.HubQuotaError = HubQuotaError;
}
