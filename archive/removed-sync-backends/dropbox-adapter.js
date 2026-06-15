// DropboxAdapter - Dropbox API v2 ベースの StorageAdapter 実装 (T08)
//
// App folder 型アプリのため、パスはアプリサンドボックス内の相対 (例 /private/library.json)。
// Dropbox はパスベースなので fileId 解決は不要。中間フォルダは upload 時に自動作成される。
//
// token は getToken({force}) で取得 (約 4h で失効 → 401 時に force 再取得して 1 回リトライ)。
// non-ASCII (日本語ファイル名) は Dropbox-API-Arg ヘッダで \uXXXX エスケープが必須。

const DBX_CONTENT = 'https://content.dropboxapi.com/2';
const DBX_API = 'https://api.dropboxapi.com/2';

class DropboxAdapter extends StorageAdapter {
    /**
     * @param {object} config
     * @param {(opts?:{force?:boolean})=>Promise<string>} config.getToken access token プロバイダ
     */
    constructor({ getToken }) {
        super();
        if (typeof getToken !== 'function') throw new Error('DropboxAdapter requires getToken');
        this.getToken = getToken;
        this._connected = true;
    }

    isConnected() {
        return this._connected;
    }

    // path → Dropbox の絶対パス (App folder ルートからの相対)。先頭スラッシュ必須・末尾スラッシュ削除
    _dbxPath(path) {
        const clean = String(path).replace(/^\/+|\/+$/g, '');
        return '/' + clean;
    }

    // Dropbox-API-Arg ヘッダ用: JSON 内の非 ASCII を \uXXXX にエスケープ (HTTP ヘッダは ASCII のみ)
    _apiArg(obj) {
        return JSON.stringify(obj).replace(/[-￿]/g, c =>
            '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
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
        const res = await this._fetch(`${DBX_CONTENT}/files/download`, {
            method: 'POST',
            headers: { 'Dropbox-API-Arg': this._apiArg({ path: this._dbxPath(path) }) }
        });
        if (res.status === 409) return null; // path/not_found
        if (!res.ok) throw new Error(await this._err(res, `download ${path}`));
        return await res.text();
    }

    async writeText(path, text) {
        const res = await this._fetch(`${DBX_CONTENT}/files/upload`, {
            method: 'POST',
            headers: {
                'Dropbox-API-Arg': this._apiArg({ path: this._dbxPath(path), mode: 'overwrite', mute: true }),
                'Content-Type': 'application/octet-stream'
            },
            body: new TextEncoder().encode(text)
        });
        if (!res.ok) throw new Error(await this._err(res, `upload ${path}`));
    }

    async fileExists(path) {
        const meta = await this._getMetadata(path);
        return !!meta && meta['.tag'] === 'file';
    }

    async deleteFile(path) {
        const res = await this._fetch(`${DBX_API}/files/delete_v2`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: this._dbxPath(path) })
        });
        if (res.status === 409) return; // not_found → 黙って成功
        if (!res.ok) throw new Error(await this._err(res, `delete ${path}`));
    }

    async listFiles(dirPath) {
        return this._list(dirPath, 'file');
    }

    async listDirs(dirPath) {
        return this._list(dirPath, 'folder');
    }

    async _list(dirPath, tag) {
        // ルート ('') は Dropbox では空文字、サブは絶対パス
        const clean = String(dirPath || '').replace(/^\/+|\/+$/g, '');
        const dbxPath = clean ? '/' + clean : '';
        const out = [];
        let res = await this._fetch(`${DBX_API}/files/list_folder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dbxPath })
        });
        if (res.status === 409) return []; // フォルダ無し
        if (!res.ok) throw new Error(await this._err(res, `list ${dirPath}`));
        let data = await res.json();
        const collect = (d) => {
            for (const e of (d.entries || [])) {
                if (e['.tag'] === tag) out.push(e.name);
            }
        };
        collect(data);
        while (data.has_more) {
            res = await this._fetch(`${DBX_API}/files/list_folder/continue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cursor: data.cursor })
            });
            if (!res.ok) throw new Error(await this._err(res, `list continue ${dirPath}`));
            data = await res.json();
            collect(data);
        }
        return out;
    }

    async _getMetadata(path) {
        const res = await this._fetch(`${DBX_API}/files/get_metadata`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: this._dbxPath(path) })
        });
        if (res.status === 409) return null;
        if (!res.ok) throw new Error(await this._err(res, `metadata ${path}`));
        return await res.json();
    }

    // ===== HTTP (token 付与 + 401 リトライ + 429 バックオフ) =====

    async _fetch(url, options = {}, _retry = { auth: false, rate: 0 }) {
        const token = await this.getToken();
        const headers = { ...(options.headers || {}), 'Authorization': `Bearer ${token}` };
        const res = await fetch(url, { ...options, headers });

        if (res.status === 401 && !_retry.auth) {
            await this.getToken({ force: true });
            return this._fetch(url, options, { auth: true, rate: _retry.rate });
        }
        if (res.status === 429 && _retry.rate < 3) {
            const retryAfter = Number(res.headers.get('Retry-After')) || (2 ** _retry.rate);
            await sleep(retryAfter * 1000 + Math.random() * 200);
            return this._fetch(url, options, { auth: _retry.auth, rate: _retry.rate + 1 });
        }
        return res;
    }

    async _err(res, ctx) {
        let detail = `${res.status} ${res.statusText}`;
        try {
            const text = await res.text();
            if (text) detail += `: ${text.slice(0, 200)}`;
        } catch (_) {}
        return `Dropbox ${ctx}: ${detail}`;
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

window.DropboxAdapter = DropboxAdapter;
