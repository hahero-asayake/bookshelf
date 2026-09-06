// GitHubAdapter - GitHub Contents API ベースの StorageAdapter 実装
//
// 全環境 (PC / iOS PWA / Android) で動作。PAT (Personal Access Token) を使用。
// 必要な PAT スコープ: classic = `repo`, fine-grained = Contents: Read & Write
//
// 単一ファイル単位の PUT で動作する (段階2-1)。
// Trees API による複数ファイル一括 commit + 楽観ロックは段階2-3 で追加。
//
// sha 管理 (イシュー#142 で改訂):
//   - readJSON / readText で取得した sha と本文を _shaCache / _lastKnownContent に保持
//   - writeJSON / writeText 時に sha を載せて PUT (既存ファイル更新)
//   - sha 不一致は 409 (422 ではない、イシュー#142 で実 API 実測して確定)。GitHubConflictError として
//     throw されるが、_write() 内で 1 回だけ自動リカバリを試みる: キャッシュを破棄して最新 sha を
//     取り直し、取得した最新本文が自分が最後に認識していた本文と同じなら (=単なる sha 管理のズレ)
//     そのまま再 PUT して回復する。本文が異なっていれば (=他タブ/他デバイスが実際に内容を変えた)
//     盲目的に上書きすると相手の編集を消すため、再 PUT はせず GitHubRemoteChangedError を投げる。
//     再 PUT してもなお 409 なら本当の競合として GitHubConflictError を投げる。
//   - 422 (サイズ超過・content 不正等) は GitHubValidationError としてレスポンスボディ付きで throw
//     (409 と原因が違うため区別する)
//   - 同一 path への write/delete はパス単位のキューで直列化する (同一タブ内の並行呼び出し対策。
//     複数タブ/複数デバイス間の競合はこのキューでは防げない＝上記の本文比較が担当)
//
// path 表現は StorageAdapter 規約に従う (スラッシュ区切り)。
// basePath が指定されれば各 path にプレフィックス付与。

class GitHubConflictError extends Error {
    constructor(message, path) {
        super(message);
        this.name = 'GitHubConflictError';
        this.path = path;
    }
}

class GitHubValidationError extends Error {
    constructor(message, path, detail) {
        super(message);
        this.name = 'GitHubValidationError';
        this.path = path;
        this.detail = detail;
    }
}

class GitHubRemoteChangedError extends Error {
    constructor(message, path) {
        super(message);
        this.name = 'GitHubRemoteChangedError';
        this.path = path;
    }
}

class GitHubAuthError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GitHubAuthError';
    }
}

class GitHubAdapter extends StorageAdapter {
    /**
     * @param {object} config
     * @param {string} config.owner       リポジトリオーナー (例: "hahero-asayake")
     * @param {string} config.repo        リポジトリ名 (例: "bookshelf-data")
     * @param {string} [config.branch]    対象 branch (default: "main")
     * @param {string} [config.basePath]  repo 内のサブディレクトリ (default: "")
     * @param {string} config.token       PAT
     */
    constructor({ owner, repo, branch = 'main', basePath = '', token }) {
        super();
        if (!owner || !repo || !token) {
            throw new Error('GitHubAdapter requires owner, repo, token');
        }
        this.owner = owner;
        this.repo = repo;
        this.branch = branch;
        this.basePath = (basePath || '').replace(/^\/+|\/+$/g, '');
        this.token = token;
        this._shaCache = new Map();
        this._lastKnownContent = new Map();
        this._writeQueues = new Map();
        // 409 リトライの発火をアプリ層へ伝える (path, status) => void。
        // status: 'retrying' | 'recovered' | 'conflict' | 'remote-changed'。イシュー#142。
        this.onWriteStatus = null;
    }

    _notifyWriteStatus(path, status) {
        if (typeof this.onWriteStatus === 'function') {
            try { this.onWriteStatus(path, status); } catch (_) { /* 通知失敗は書込結果に影響させない */ }
        }
    }

    isConnected() {
        return !!this.token && !!this.owner && !!this.repo;
    }

    /**
     * token を差し替える (refresh 後に呼ぶ)。
     * _headers() が毎リクエスト this.token を参照するため、差し替え後のリクエストから有効。
     */
    setToken(token) {
        this.token = token;
    }

    // ===== 接続テスト (UI からの「接続確認」用) =====

    async testConnection() {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}`;
        const { status, ok, statusText, json } = await StorageAdapter.fetchJSON(url, { headers: this._headers() });
        if (status === 401) throw new GitHubAuthError('GitHub authentication failed (invalid token)');
        if (status === 404) throw new Error(`Repository not found: ${this.owner}/${this.repo}`);
        if (!ok) {
            throw new Error(`GitHub API error: ${status} ${statusText}`);
        }
        return {
            defaultBranch: json.default_branch,
            private: json.private,
            permissions: json.permissions
        };
    }

    // ===== StorageAdapter 実装 =====

    async readJSON(path) {
        const content = await this._getContent(path);
        if (!content || content.type !== 'file') return null;
        const text = this._decodeBase64(content.content);
        this._shaCache.set(path, content.sha);
        this._lastKnownContent.set(path, text);
        return text.trim() ? JSON.parse(text) : null;
    }

    async writeJSON(path, data) {
        const text = JSON.stringify(data, null, 2);
        await this._write(path, text);
    }

    async readText(path) {
        const content = await this._getContent(path);
        if (!content || content.type !== 'file') return null;
        const text = this._decodeBase64(content.content);
        this._shaCache.set(path, content.sha);
        this._lastKnownContent.set(path, text);
        return text;
    }

    async writeText(path, text) {
        await this._write(path, text);
    }

    async fileExists(path) {
        const content = await this._getContent(path);
        return !!content && content.type === 'file';
    }

    async deleteFile(path) {
        return this._enqueue(path, () => this._deleteOnce(path));
    }

    async _deleteOnce(path) {
        let sha = this._shaCache.get(path);
        if (!sha) {
            const existing = await this._getContent(path);
            if (!existing) return;
            sha = existing.sha;
        }
        await this._deleteContent(path, sha);
        this._shaCache.delete(path);
        this._lastKnownContent.delete(path);
    }

    async listFiles(dirPath) {
        const content = await this._getContent(dirPath);
        if (!content || !Array.isArray(content)) return [];
        return content.filter(e => e.type === 'file').map(e => e.name);
    }

    async listDirs(dirPath) {
        const content = await this._getContent(dirPath);
        if (!content || !Array.isArray(content)) return [];
        return content.filter(e => e.type === 'dir').map(e => e.name);
    }

    // ===== バッチコミット (Trees API) =====
    //
    // 段階2-3 実装。複数ファイルを 1 commit にまとめる。
    // フロー:
    //   beginBatch() で蓄積開始
    //     ↓ addBatchEntry / addBatchDelete を任意回数
    //   commitBatch(message) で:
    //     1. 現在の branch ref → 最新 commit sha
    //     2. その commit から base tree sha
    //     3. 各 put: blob を作って sha 取得
    //        各 delete: tree entry に sha:null を置く
    //     4. base_tree + 変更 entries で新 tree を作成
    //     5. 新 commit を作成 (parents = 旧 commit)
    //     6. ref を新 commit sha に向ける (force: false = 楽観ロック)
    //        → 422 = 他で更新あり → GitHubConflictError
    //
    // discardBatch() で破棄。バッチ中に commitBatch を呼ばずに新たに beginBatch すると上書き。

    beginBatch() {
        this._batch = [];
    }

    addBatchEntry(path, content) {
        if (!this._batch) throw new Error('GitHubAdapter: no active batch (call beginBatch first)');
        this._batch.push({ op: 'put', path, content });
    }

    addBatchDelete(path) {
        if (!this._batch) throw new Error('GitHubAdapter: no active batch (call beginBatch first)');
        this._batch.push({ op: 'delete', path });
    }

    discardBatch() {
        this._batch = null;
    }

    hasBatchEntries() {
        return Array.isArray(this._batch) && this._batch.length > 0;
    }

    async commitBatch(message) {
        if (!this._batch || this._batch.length === 0) {
            this._batch = null;
            return null;
        }
        const batch = this._batch;
        this._batch = null;

        // 1. 現在の branch ref を取得
        // _getContent と同じ Cache-Control 脆弱性を抱える (イシュー#150)。こちらは 409 ではなく
        // 6. の ref 更新が 422 でconflict検知するだけでリトライ機構が無いため、古い ref を
        // ブラウザキャッシュから拾うと「実は最新ではないbase treeで作ったcommit」が422で弾かれず
        // 気づかれにくい形で失敗しうる。no-store で必ず最新を取る。
        const refUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/git/refs/heads/${encodeURIComponent(this.branch)}`;
        const refRes = await StorageAdapter.fetchJSON(refUrl, { headers: this._headers(), cache: 'no-store' });
        if (!refRes.ok) throw new Error(this._ghErr(refRes, `get ref ${this.branch}`));
        const latestCommitSha = refRes.json.object.sha;

        // 2. 既存 commit の base tree sha
        const commitUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/git/commits/${latestCommitSha}`;
        const commitRes = await StorageAdapter.fetchJSON(commitUrl, { headers: this._headers() });
        if (!commitRes.ok) throw new Error(this._ghErr(commitRes, `get commit ${latestCommitSha}`));
        const baseTreeSha = commitRes.json.tree.sha;

        // 3. Tree entries 構築 (put = blob 作成, delete = sha:null)
        const treeEntries = [];
        for (const e of batch) {
            const fullPath = this._fullPath(e.path);
            if (e.op === 'delete') {
                treeEntries.push({ path: fullPath, mode: '100644', type: 'blob', sha: null });
            } else {
                const blobRes = await StorageAdapter.fetchJSON(`https://api.github.com/repos/${this.owner}/${this.repo}/git/blobs`, {
                    method: 'POST',
                    headers: { ...this._headers(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: this._encodeBase64(e.content),
                        encoding: 'base64'
                    })
                });
                if (!blobRes.ok) throw new Error(this._ghErr(blobRes, `create blob ${e.path}`));
                treeEntries.push({ path: fullPath, mode: '100644', type: 'blob', sha: blobRes.json.sha });
            }
        }

        // 4. Tree を作成
        const treeRes = await StorageAdapter.fetchJSON(`https://api.github.com/repos/${this.owner}/${this.repo}/git/trees`, {
            method: 'POST',
            headers: { ...this._headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                base_tree: baseTreeSha,
                tree: treeEntries
            })
        });
        if (!treeRes.ok) throw new Error(this._ghErr(treeRes, 'create tree'));

        // 5. Commit を作成
        const msg = message || `chore(bookshelf): batch update ${batch.length} file(s)`;
        const newCommitRes = await StorageAdapter.fetchJSON(`https://api.github.com/repos/${this.owner}/${this.repo}/git/commits`, {
            method: 'POST',
            headers: { ...this._headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: msg,
                tree: treeRes.json.sha,
                parents: [latestCommitSha]
            })
        });
        if (!newCommitRes.ok) throw new Error(this._ghErr(newCommitRes, 'create commit'));

        // 6. Ref を更新 (force: false = 楽観ロック)
        const updateRefRes = await StorageAdapter.fetchJSON(refUrl, {
            method: 'PATCH',
            headers: { ...this._headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha: newCommitRes.json.sha, force: false })
        });
        if (updateRefRes.status === 422) {
            throw new GitHubConflictError(`Branch ${this.branch} was updated since batch start`, this.branch);
        }
        if (!updateRefRes.ok) throw new Error(this._ghErr(updateRefRes, `update ref ${this.branch}`));

        // 書き込み後はキャッシュした sha を全部破棄 (Tree 経由で更新したので個別 sha は古い)
        this._shaCache.clear();
        return newCommitRes.json.sha;
    }

    _ghErr(fetchResult, ctx) {
        let detail = `${fetchResult.status} ${fetchResult.statusText}`;
        if (fetchResult.json && fetchResult.json.message) detail += `: ${fetchResult.json.message}`;
        return `${ctx}: ${detail}`;
    }

    // ===== 楽観ロック管理 (段階2-3 で本格利用) =====

    /**
     * 書込み前に最新 sha を再取得 (キャッシュ無視) して衝突検知用に使う。
     * @param {string} path
     * @returns {Promise<string|null>} 最新 sha、ファイル無ければ null
     */
    async refreshSha(path) {
        const content = await this._getContent(path);
        const sha = content && content.type === 'file' ? content.sha : null;
        if (sha) {
            this._shaCache.set(path, sha);
        } else {
            this._shaCache.delete(path);
        }
        return sha;
    }

    getCachedSha(path) {
        return this._shaCache.get(path) || null;
    }

    clearShaCache() {
        this._shaCache.clear();
    }

    // ===== 内部: HTTP =====

    _headers() {
        return {
            'Authorization': `Bearer ${this.token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
    }

    _fullPath(path) {
        return this.basePath ? `${this.basePath}/${path}` : path;
    }

    _apiUrl(path) {
        const full = this._fullPath(path);
        // path 内のスラッシュは保持しつつ、他の特殊文字 (日本語タイトル含む) はエンコード
        const encoded = full.split('/').map(encodeURIComponent).join('/');
        return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encoded}`;
    }

    async _getContent(path) {
        const url = `${this._apiUrl(path)}?ref=${encodeURIComponent(this.branch)}`;
        // GitHub Contents API の GET は `Cache-Control: private, max-age=60` を返す (実測)。
        // このURL(?ref=付き)はPUT/DELETE(クエリ無し)と別URLのため、書込成功時のブラウザ自動キャッシュ
        // 無効化が効かず、60秒間ブラウザキャッシュから古い sha が返り続けることがある。409 リカバリ
        // (_recoverFromConflictAndRetry) がこの古い sha を「最新」として再取得してしまうと、実際には
        // 競合していないのに何度リトライしても 409 になる (イシュー#150で実機再現・特定)。
        // no-store で必ずネットワークから最新を取る。
        const { status, ok, statusText, headers, json } = await StorageAdapter.fetchJSON(url, { headers: this._headers(), cache: 'no-store' });
        if (status === 404) return null;
        if (status === 401) throw new GitHubAuthError('GitHub authentication failed');
        if (status === 403) {
            const remaining = headers.get('X-RateLimit-Remaining');
            if (remaining === '0') {
                const reset = headers.get('X-RateLimit-Reset');
                throw new Error(`GitHub rate limit exceeded. Reset at ${new Date(Number(reset) * 1000).toLocaleString()}`);
            }
            throw new Error(`GitHub API forbidden: ${status} ${statusText}`);
        }
        if (!ok) {
            throw new Error(`GitHub API error: ${status} ${statusText} on GET ${path}`);
        }
        return json;
    }

    async _putContent(path, content, { sha = null, message = null } = {}) {
        const url = this._apiUrl(path);
        const body = {
            message: message || `chore(bookshelf): update ${this._fullPath(path)}`,
            content: this._encodeBase64(content),
            branch: this.branch
        };
        if (sha) body.sha = sha;

        const { status, ok, statusText, body: text, json } = await StorageAdapter.fetchJSON(url, {
            method: 'PUT',
            headers: { ...this._headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (status === 401) throw new GitHubAuthError('GitHub authentication failed');
        if (status === 409) {
            throw new GitHubConflictError(`sha conflict on ${path}`, path);
        }
        if (status === 422) {
            throw new GitHubValidationError(`GitHub validation error on PUT ${path}: ${text}`, path, text);
        }
        if (!ok) {
            throw new Error(`GitHub API error: ${status} ${statusText} on PUT ${path}\n${text}`);
        }
        return json.content && json.content.sha;
    }

    async _deleteContent(path, sha) {
        const url = this._apiUrl(path);
        const body = {
            message: `chore(bookshelf): delete ${this._fullPath(path)}`,
            sha,
            branch: this.branch
        };
        const { status, ok, statusText, body: text } = await StorageAdapter.fetchJSON(url, {
            method: 'DELETE',
            headers: { ...this._headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (status === 404) return;
        if (status === 401) throw new GitHubAuthError('GitHub authentication failed');
        if (status === 409) {
            throw new GitHubConflictError(`sha conflict on delete ${path}`, path);
        }
        if (status === 422) {
            throw new GitHubValidationError(`GitHub validation error on DELETE ${path}: ${text}`, path, text);
        }
        if (!ok) {
            throw new Error(`GitHub API error: ${status} ${statusText} on DELETE ${path}\n${text}`);
        }
    }

    // ===== 書き込みキュー (同一パスへの write/delete を直列化。同一タブ内の並行呼び出し対策) =====

    _enqueue(path, task) {
        const prev = this._writeQueues.get(path) || Promise.resolve();
        const result = prev.then(task, task);
        this._writeQueues.set(path, result.catch(() => {}));
        return result;
    }

    async _write(path, text) {
        return this._enqueue(path, () => this._writeOnce(path, text));
    }

    async _writeOnce(path, text) {
        let sha = this._shaCache.get(path);
        if (!sha) {
            // 新規かもしれないが、既存があれば sha を取得する必要がある
            const existing = await this._getContent(path);
            if (existing && existing.type === 'file' && existing.sha) {
                sha = existing.sha;
                this._shaCache.set(path, sha);
                this._lastKnownContent.set(path, this._decodeBase64(existing.content));
            }
        }
        try {
            const newSha = await this._putContent(path, text, { sha });
            if (newSha) this._shaCache.set(path, newSha);
            this._lastKnownContent.set(path, text);
        } catch (e) {
            if (!(e instanceof GitHubConflictError)) throw e;
            await this._recoverFromConflictAndRetry(path, text);
        }
    }

    /**
     * 409 受信後のリカバリ (イシュー#142)。
     * 最新 sha/本文を取り直し、リモート本文が自分の最終認識と同じなら (=単なる sha キャッシュの
     * ズレ) そのまま同じ内容で 1 回だけ再 PUT する。異なっていれば他タブ/他デバイスが実際に
     * 内容を変えているので、盲目的に上書きせず GitHubRemoteChangedError を投げて呼び出し元に
     * 知らせる。再 PUT してもなお 409 なら本当の競合として GitHubConflictError を投げる。
     */
    async _recoverFromConflictAndRetry(path, text) {
        console.warn(`[GitHubAdapter] 409 on ${path}: sha を破棄して最新状態を取り直します`);
        this._notifyWriteStatus(path, 'retrying');
        this._shaCache.delete(path);
        const latest = await this._getContent(path);
        const latestSha = latest && latest.type === 'file' ? latest.sha : null;
        const latestContent = latest && latest.type === 'file' ? this._decodeBase64(latest.content) : null;
        const knownContent = this._lastKnownContent.get(path);

        if (latestContent !== null && (knownContent === undefined || latestContent !== knownContent)) {
            console.error(`[GitHubAdapter] ${path} はリモートで内容が変わっている。上書きせず中断します`);
            this._notifyWriteStatus(path, 'remote-changed');
            throw new GitHubRemoteChangedError(`${path} は他の場所で更新されています。内容を確認して保存し直してください。`, path);
        }

        if (latestSha) {
            this._shaCache.set(path, latestSha);
            this._lastKnownContent.set(path, latestContent);
        }

        try {
            const retrySha = await this._putContent(path, text, { sha: latestSha });
            if (retrySha) this._shaCache.set(path, retrySha);
            this._lastKnownContent.set(path, text);
            console.warn(`[GitHubAdapter] 409 on ${path}: リトライで回復しました`);
            this._notifyWriteStatus(path, 'recovered');
        } catch (e2) {
            if (e2 instanceof GitHubConflictError) {
                console.error(`[GitHubAdapter] ${path} はリトライ後も 409 (本当の競合)`);
                this._notifyWriteStatus(path, 'conflict');
            }
            throw e2;
        }
    }

    // ===== Base64 (UTF-8 対応) =====

    _encodeBase64(text) {
        const bytes = new TextEncoder().encode(text);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    _decodeBase64(b64) {
        const cleaned = (b64 || '').replace(/\s+/g, '');
        const binary = atob(cleaned);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    }
}

window.GitHubAdapter = GitHubAdapter;
window.GitHubConflictError = GitHubConflictError;
window.GitHubValidationError = GitHubValidationError;
window.GitHubRemoteChangedError = GitHubRemoteChangedError;
window.GitHubAuthError = GitHubAuthError;
