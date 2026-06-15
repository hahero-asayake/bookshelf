// GoogleDriveAdapter - Google Drive REST v3 ベースの StorageAdapter 実装 (T07)
//
// 認証は GIS token model (gdrive-auth.js)。scope は drive.file のみ → アプリが作った
// ファイルしか見えないため、ルートは bookshelf-data フォルダ (rootFolderId)。
//
// path 表現は StorageAdapter 規約 (スラッシュ区切り)。Drive には階層 path の概念が無いので
// path を 1 セグメントずつ files.list で辿り fileId に解決する (Map キャッシュ)。
//
// token は getToken({force}) で取得 (約 1 時間で失効 → 401 時に force 再取得して 1 回リトライ)。
// バッチ commit 相当は無い (storage.js の逐次書きフォールバックに乗る)。

const GDRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const GDRIVE_API = 'https://www.googleapis.com/drive/v3';
const GDRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

class GoogleDriveAdapter extends StorageAdapter {
    /**
     * @param {object} config
     * @param {string} config.rootFolderId  bookshelf-data フォルダの fileId
     * @param {(opts?:{force?:boolean})=>Promise<string>} config.getToken  access token プロバイダ
     */
    constructor({ rootFolderId, getToken }) {
        super();
        if (!rootFolderId || typeof getToken !== 'function') {
            throw new Error('GoogleDriveAdapter requires rootFolderId and getToken');
        }
        this.rootFolderId = rootFolderId;
        this.getToken = getToken;
        // key: 親fileId + '/' + name → fileId (ディレクトリ/ファイル両方)
        this._idCache = new Map();
    }

    isConnected() {
        return !!this.rootFolderId;
    }

    // ===== StorageAdapter 実装 =====

    async readJSON(path) {
        const text = await this.readText(path);
        return text && text.trim() ? JSON.parse(text) : null;
    }

    async writeJSON(path, data) {
        await this.writeText(path, JSON.stringify(data, null, 2));
    }

    async readText(path) {
        const id = await this._resolvePathToId(path);
        if (!id) return null;
        const res = await this._fetch(`${GDRIVE_API}/files/${id}?alt=media`);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(await this._err(res, `download ${path}`));
        return await res.text();
    }

    async writeText(path, text) {
        const { dir, name } = this._splitPath(path);
        const parentId = await this._resolveDirId(dir, { create: true });
        const existingId = await this._lookupChild(parentId, name);
        if (existingId) {
            // 既存ファイル更新 (media のみ差し替え)
            const res = await this._fetch(`${GDRIVE_UPLOAD}/files/${existingId}?uploadType=media`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
                body: text
            });
            if (!res.ok) throw new Error(await this._err(res, `update ${path}`));
        } else {
            // 新規作成 (multipart: metadata + media)
            const id = await this._multipartCreate(parentId, name, text);
            this._idCache.set(this._cacheKey(parentId, name), id);
        }
    }

    async fileExists(path) {
        const id = await this._resolvePathToId(path);
        return !!id;
    }

    async deleteFile(path) {
        const id = await this._resolvePathToId(path);
        if (!id) return;
        const res = await this._fetch(`${GDRIVE_API}/files/${id}`, { method: 'DELETE' });
        if (res.status === 404) { this._invalidate(path); return; }
        if (!res.ok) throw new Error(await this._err(res, `delete ${path}`));
        this._invalidate(path);
    }

    async listFiles(dirPath) {
        return this._list(dirPath, 'file');
    }

    async listDirs(dirPath) {
        return this._list(dirPath, 'dir');
    }

    async _list(dirPath, kind) {
        const dirId = await this._resolveDirId(dirPath, { create: false });
        if (!dirId) return [];
        const out = [];
        let pageToken = null;
        do {
            const params = new URLSearchParams({
                q: `'${dirId}' in parents and trashed=false`,
                fields: 'nextPageToken,files(id,name,mimeType)',
                pageSize: '1000'
            });
            if (pageToken) params.set('pageToken', pageToken);
            const res = await this._fetch(`${GDRIVE_API}/files?${params}`);
            if (!res.ok) throw new Error(await this._err(res, `list ${dirPath}`));
            const data = await res.json();
            for (const f of (data.files || [])) {
                const isDir = f.mimeType === GDRIVE_FOLDER_MIME;
                if ((kind === 'dir') === isDir) out.push(f.name);
                // 解決キャッシュも温める
                this._idCache.set(this._cacheKey(dirId, f.name), f.id);
            }
            pageToken = data.nextPageToken || null;
        } while (pageToken);
        return out;
    }

    // ===== path → fileId 解決 =====

    _splitPath(path) {
        const clean = String(path).replace(/^\/+|\/+$/g, '');
        const idx = clean.lastIndexOf('/');
        return idx < 0
            ? { dir: '', name: clean }
            : { dir: clean.slice(0, idx), name: clean.slice(idx + 1) };
    }

    _cacheKey(parentId, name) {
        return `${parentId}/${name}`;
    }

    // ファイル path 全体を fileId に解決 (無ければ null)
    async _resolvePathToId(path) {
        const { dir, name } = this._splitPath(path);
        const parentId = await this._resolveDirId(dir, { create: false });
        if (!parentId) return null;
        return await this._lookupChild(parentId, name);
    }

    // ディレクトリ path を fileId に解決。create=true なら無いフォルダを作る
    async _resolveDirId(dirPath, { create }) {
        let parentId = this.rootFolderId;
        const clean = String(dirPath || '').replace(/^\/+|\/+$/g, '');
        if (!clean) return parentId;
        for (const seg of clean.split('/')) {
            let childId = await this._lookupChild(parentId, seg, { foldersOnly: true });
            if (!childId) {
                if (!create) return null;
                childId = await this._createFolder(parentId, seg);
            }
            parentId = childId;
        }
        return parentId;
    }

    // 親フォルダ直下の name を fileId に解決 (キャッシュ優先)。無ければ null
    async _lookupChild(parentId, name, { foldersOnly = false } = {}) {
        const key = this._cacheKey(parentId, name);
        if (this._idCache.has(key)) return this._idCache.get(key);
        const safeName = String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        let q = `'${parentId}' in parents and name='${safeName}' and trashed=false`;
        if (foldersOnly) q += ` and mimeType='${GDRIVE_FOLDER_MIME}'`;
        const params = new URLSearchParams({ q, fields: 'files(id,name,mimeType)', pageSize: '1' });
        const res = await this._fetch(`${GDRIVE_API}/files?${params}`);
        if (!res.ok) throw new Error(await this._err(res, `lookup ${name}`));
        const data = await res.json();
        const file = (data.files || [])[0];
        if (!file) return null;
        this._idCache.set(key, file.id);
        return file.id;
    }

    async _createFolder(parentId, name) {
        const res = await this._fetch(`${GDRIVE_API}/files?fields=id`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, mimeType: GDRIVE_FOLDER_MIME, parents: [parentId] })
        });
        if (!res.ok) throw new Error(await this._err(res, `mkdir ${name}`));
        const data = await res.json();
        this._idCache.set(this._cacheKey(parentId, name), data.id);
        return data.id;
    }

    async _multipartCreate(parentId, name, text) {
        const boundary = '-------bookshelf' + Math.random().toString(36).slice(2);
        const metadata = { name, parents: [parentId] };
        const body =
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
            JSON.stringify(metadata) +
            `\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n` +
            text +
            `\r\n--${boundary}--`;
        const res = await this._fetch(`${GDRIVE_UPLOAD}/files?uploadType=multipart&fields=id`, {
            method: 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body
        });
        if (!res.ok) throw new Error(await this._err(res, `create ${name}`));
        const data = await res.json();
        return data.id;
    }

    // path のキャッシュエントリを無効化 (削除時)
    _invalidate(path) {
        const { name } = this._splitPath(path);
        for (const key of [...this._idCache.keys()]) {
            if (key.endsWith(`/${name}`)) this._idCache.delete(key);
        }
    }

    clearCache() {
        this._idCache.clear();
    }

    // ===== HTTP (token 付与 + 401 リトライ + レート制限バックオフ) =====

    async _fetch(url, options = {}, _retry = { auth: false, rate: 0 }) {
        const token = await this.getToken();
        const headers = { ...(options.headers || {}), 'Authorization': `Bearer ${token}` };
        const res = await fetch(url, { ...options, headers });

        // 401: token 失効 → 強制再取得して 1 回だけリトライ
        if (res.status === 401 && !_retry.auth) {
            await this.getToken({ force: true });
            return this._fetch(url, options, { ...dupRetry(_retry), auth: true });
        }
        // 403 (userRateLimitExceeded) / 429: 指数バックオフ最大 3 回
        if ((res.status === 429 || res.status === 403) && _retry.rate < 3) {
            const retriable = res.status === 429 || /rateLimit|userRateLimitExceeded/i.test(await peekError(res));
            if (retriable) {
                await sleep(2 ** _retry.rate * 500 + Math.random() * 200);
                return this._fetch(url, options, { ...dupRetry(_retry), rate: _retry.rate + 1 });
            }
        }
        return res;
    }

    async _err(res, ctx) {
        let detail = `${res.status} ${res.statusText}`;
        try {
            const data = await res.json();
            if (data && data.error && data.error.message) detail += `: ${data.error.message}`;
        } catch (_) {}
        return `Google Drive ${ctx}: ${detail}`;
    }
}

function dupRetry(r) { return { auth: r.auth, rate: r.rate }; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function peekError(res) {
    try { return JSON.stringify(await res.clone().json()); } catch (_) { return ''; }
}

window.GoogleDriveAdapter = GoogleDriveAdapter;
