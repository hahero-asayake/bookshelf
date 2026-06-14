// HubStorageAdapter - Asayake ハブ (hahero 運営) への平文私的同期 (ADR-032, 09 §10.5)
//
// 5 つ目の StorageAdapter 実装。GitHub/Drive/Dropbox と同様に path ベース I/O を提供し、
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
//   POST   {apiBase}/data/batch             → { entries:[{op:'put',path,content}|{op:'delete',path}] }
//                                              200 = 全適用 / 409|412 = 衝突
//
// ※ private データは「テキスト (JSON / Markdown)」のみ。バイナリは扱わない。
// ※ インフラ未稼働 (設計のみ)。Worker の JWT 検証・私的 API は本番前に実機検証必須。

class HubConflictError extends Error {
    constructor(message, path) {
        super(message);
        this.name = 'HubConflictError';
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

    async readText(path) {
        return this._read(path);
    }

    async writeText(path, text) {
        await this._write(path, text);
    }

    async fileExists(path) {
        const res = await this._fetch('GET', this._dataUrl(path), { method: 'HEAD' });
        if (res.status === 404) return false;
        if (!res.ok) throw await this._err(res, `HEAD ${path}`);
        const etag = res.headers.get('ETag');
        if (etag) this._etagCache.set(path, etag);
        return true;
    }

    async deleteFile(path) {
        const res = await this._fetch('DELETE', this._dataUrl(path));
        if (res.status === 404) { this._etagCache.delete(path); return; }
        if (!res.ok) throw await this._err(res, `DELETE ${path}`);
        this._etagCache.delete(path);
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

    async commitBatch() {
        if (!this._batch || this._batch.length === 0) { this._batch = null; return null; }
        const entries = this._batch.map(e => {
            if (e.op === 'delete') return { op: 'delete', path: this._normalize(e.path) };
            return { op: 'put', path: this._normalize(e.path), content: e.content };
        });
        this._batch = null;
        const res = await this._fetch('POST', `${this.apiBase}/data/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries })
        });
        if (res.status === 409 || res.status === 412) {
            throw new HubConflictError('batch conflict on hub (data changed since read)', null);
        }
        if (!res.ok) throw await this._err(res, 'POST data/batch');
        // Tree 相当の一括更新後は ETag キャッシュを破棄 (個別 ETag は古い)
        this._etagCache.clear();
        return true;
    }

    // ===== 公開 (共有ハブへのサイト投稿, ADR-033) =====
    // 公開ページ群を /publish に POST し、sites/<siteId>/ を今回集合で置換する。
    // 私的同期 (data/) とは別経路。deleteMissing=true で今回出力に無いファイルをサーバ側で削除。
    // @returns {Promise<{ok, siteId, siteUrl, published}>}
    async publishSite(files, deleteMissing = true) {
        const payload = {
            files: (files || []).map(f => ({ path: this._normalize(f.path), content: f.content || '' })),
            deleteMissing: !!deleteMissing
        };
        const res = await this._fetch('POST', `${this.apiBase}/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.status === 413) throw new HubQuotaError('ハブの公開容量上限に達しました');
        if (!res.ok) throw await this._err(res, 'POST publish');
        return await res.json();
    }

    // ===== 内部 =====

    async _read(path) {
        const res = await this._fetch('GET', this._dataUrl(path));
        if (res.status === 404) return null;
        if (!res.ok) throw await this._err(res, `GET ${path}`);
        const etag = res.headers.get('ETag');
        if (etag) this._etagCache.set(path, etag);
        return await res.text();
    }

    async _write(path, text) {
        // 楽観ロック: 既知の ETag があれば If-Match。無ければ一度 read して現状 ETag を得てから上書き
        let etag = this._etagCache.get(path);
        if (etag === undefined) {
            const head = await this._fetch('GET', this._dataUrl(path), { method: 'HEAD' });
            if (head.ok) {
                etag = head.headers.get('ETag') || undefined;
                if (etag) this._etagCache.set(path, etag);
            } else if (head.status !== 404) {
                throw await this._err(head, `HEAD ${path}`);
            }
        }
        const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
        if (etag) headers['If-Match'] = etag;
        const res = await this._fetch('PUT', this._dataUrl(path), { method: 'PUT', headers, body: text });
        if (res.status === 412) throw new HubConflictError(`etag conflict on ${path}`, path);
        if (res.status === 413) throw new HubQuotaError('ハブの保存容量上限に達しました');
        if (!res.ok) throw await this._err(res, `PUT ${path}`);
        const newEtag = res.headers.get('ETag');
        if (newEtag) this._etagCache.set(path, newEtag); else this._etagCache.delete(path);
    }

    async _list(dirPath) {
        const res = await this._fetch('GET', `${this._dataUrl(dirPath)}?list=1`);
        if (res.status === 404) return null;
        if (!res.ok) throw await this._err(res, `LIST ${dirPath}`);
        return await res.json();
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
    async _fetch(method, url, init = {}) {
        const key = await this._key();
        const headers = { ...(init.headers || {}), 'Authorization': `Bearer ${key}` };
        const res = await fetch(url, { method: init.method || method, headers, body: init.body });
        if (res.status === 401) throw new HubAuthError('Asayake ハブの認証が失効しました。再接続してください');
        return res;
    }

    async _err(res, ctx) {
        let detail = `${res.status} ${res.statusText}`;
        try { const t = await res.text(); if (t) detail += `: ${t.slice(0, 200)}`; } catch (_) {}
        return new Error(`Hub API error (${ctx}): ${detail}`);
    }
}

if (typeof window !== 'undefined') {
    window.HubStorageAdapter = HubStorageAdapter;
    window.HubConflictError = HubConflictError;
    window.HubAuthError = HubAuthError;
    window.HubQuotaError = HubQuotaError;
}
if (typeof globalThis !== 'undefined') {
    globalThis.HubStorageAdapter = HubStorageAdapter;
    globalThis.HubConflictError = HubConflictError;
    globalThis.HubAuthError = HubAuthError;
    globalThis.HubQuotaError = HubQuotaError;
}
