// GitHubAdapter - GitHub Contents API ベースの StorageAdapter 実装
//
// 全環境 (PC / iOS PWA / Android) で動作。PAT (Personal Access Token) を使用。
// 必要な PAT スコープ: classic = `repo`, fine-grained = Contents: Read & Write
//
// 単一ファイル単位の PUT で動作する (段階2-1)。
// Trees API による複数ファイル一括 commit + 楽観ロックは段階2-3 で追加。
//
// sha 管理:
//   - readJSON / readText で取得した sha を _shaCache に保持
//   - writeJSON / writeText 時に sha を載せて PUT (既存ファイル更新)
//   - sha 不一致 (422) は GitHubConflictError として throw
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
    }

    isConnected() {
        return !!this.token && !!this.owner && !!this.repo;
    }

    // ===== 接続テスト (UI からの「接続確認」用) =====

    async testConnection() {
        const url = `https://api.github.com/repos/${this.owner}/${this.repo}`;
        const res = await fetch(url, { headers: this._headers() });
        if (res.status === 401) throw new GitHubAuthError('GitHub authentication failed (invalid token)');
        if (res.status === 404) throw new Error(`Repository not found: ${this.owner}/${this.repo}`);
        if (!res.ok) {
            throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
        }
        const data = await res.json();
        return {
            defaultBranch: data.default_branch,
            private: data.private,
            permissions: data.permissions
        };
    }

    // ===== StorageAdapter 実装 =====

    async readJSON(path) {
        const content = await this._getContent(path);
        if (!content || content.type !== 'file') return null;
        this._shaCache.set(path, content.sha);
        const text = this._decodeBase64(content.content);
        return text.trim() ? JSON.parse(text) : null;
    }

    async writeJSON(path, data) {
        const text = JSON.stringify(data, null, 2);
        await this._write(path, text);
    }

    async readText(path) {
        const content = await this._getContent(path);
        if (!content || content.type !== 'file') return null;
        this._shaCache.set(path, content.sha);
        return this._decodeBase64(content.content);
    }

    async writeText(path, text) {
        await this._write(path, text);
    }

    async fileExists(path) {
        const content = await this._getContent(path);
        return !!content && content.type === 'file';
    }

    async deleteFile(path) {
        let sha = this._shaCache.get(path);
        if (!sha) {
            const existing = await this._getContent(path);
            if (!existing) return;
            sha = existing.sha;
        }
        await this._deleteContent(path, sha);
        this._shaCache.delete(path);
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
        const refUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/git/refs/heads/${encodeURIComponent(this.branch)}`;
        const refRes = await fetch(refUrl, { headers: this._headers() });
        if (!refRes.ok) throw new Error(await this._ghErr(refRes, `get ref ${this.branch}`));
        const refData = await refRes.json();
        const latestCommitSha = refData.object.sha;

        // 2. 既存 commit の base tree sha
        const commitUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/git/commits/${latestCommitSha}`;
        const commitRes = await fetch(commitUrl, { headers: this._headers() });
        if (!commitRes.ok) throw new Error(await this._ghErr(commitRes, `get commit ${latestCommitSha}`));
        const commitData = await commitRes.json();
        const baseTreeSha = commitData.tree.sha;

        // 3. Tree entries 構築 (put = blob 作成, delete = sha:null)
        const treeEntries = [];
        for (const e of batch) {
            const fullPath = this._fullPath(e.path);
            if (e.op === 'delete') {
                treeEntries.push({ path: fullPath, mode: '100644', type: 'blob', sha: null });
            } else {
                const blobRes = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/git/blobs`, {
                    method: 'POST',
                    headers: { ...this._headers(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: this._encodeBase64(e.content),
                        encoding: 'base64'
                    })
                });
                if (!blobRes.ok) throw new Error(await this._ghErr(blobRes, `create blob ${e.path}`));
                const blobData = await blobRes.json();
                treeEntries.push({ path: fullPath, mode: '100644', type: 'blob', sha: blobData.sha });
            }
        }

        // 4. Tree を作成
        const treeRes = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/git/trees`, {
            method: 'POST',
            headers: { ...this._headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                base_tree: baseTreeSha,
                tree: treeEntries
            })
        });
        if (!treeRes.ok) throw new Error(await this._ghErr(treeRes, 'create tree'));
        const treeData = await treeRes.json();

        // 5. Commit を作成
        const msg = message || `chore(bookshelf): batch update ${batch.length} file(s)`;
        const newCommitRes = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/git/commits`, {
            method: 'POST',
            headers: { ...this._headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: msg,
                tree: treeData.sha,
                parents: [latestCommitSha]
            })
        });
        if (!newCommitRes.ok) throw new Error(await this._ghErr(newCommitRes, 'create commit'));
        const newCommitData = await newCommitRes.json();

        // 6. Ref を更新 (force: false = 楽観ロック)
        const updateRefRes = await fetch(refUrl, {
            method: 'PATCH',
            headers: { ...this._headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha: newCommitData.sha, force: false })
        });
        if (updateRefRes.status === 422) {
            throw new GitHubConflictError(`Branch ${this.branch} was updated since batch start`, this.branch);
        }
        if (!updateRefRes.ok) throw new Error(await this._ghErr(updateRefRes, `update ref ${this.branch}`));

        // 書き込み後はキャッシュした sha を全部破棄 (Tree 経由で更新したので個別 sha は古い)
        this._shaCache.clear();
        return newCommitData.sha;
    }

    async _ghErr(res, ctx) {
        let detail = `${res.status} ${res.statusText}`;
        try {
            const data = await res.json();
            if (data && data.message) detail += `: ${data.message}`;
        } catch (_) {}
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
        const res = await fetch(url, { headers: this._headers() });
        if (res.status === 404) return null;
        if (res.status === 401) throw new GitHubAuthError('GitHub authentication failed');
        if (res.status === 403) {
            const remaining = res.headers.get('X-RateLimit-Remaining');
            if (remaining === '0') {
                const reset = res.headers.get('X-RateLimit-Reset');
                throw new Error(`GitHub rate limit exceeded. Reset at ${new Date(Number(reset) * 1000).toLocaleString()}`);
            }
            throw new Error(`GitHub API forbidden: ${res.status} ${res.statusText}`);
        }
        if (!res.ok) {
            throw new Error(`GitHub API error: ${res.status} ${res.statusText} on GET ${path}`);
        }
        return await res.json();
    }

    async _putContent(path, content, { sha = null, message = null } = {}) {
        const url = this._apiUrl(path);
        const body = {
            message: message || `chore(bookshelf): update ${this._fullPath(path)}`,
            content: this._encodeBase64(content),
            branch: this.branch
        };
        if (sha) body.sha = sha;

        const res = await fetch(url, {
            method: 'PUT',
            headers: { ...this._headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.status === 401) throw new GitHubAuthError('GitHub authentication failed');
        if (res.status === 409 || res.status === 422) {
            throw new GitHubConflictError(`sha conflict on ${path}`, path);
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`GitHub API error: ${res.status} ${res.statusText} on PUT ${path}\n${text}`);
        }
        const data = await res.json();
        return data.content && data.content.sha;
    }

    async _deleteContent(path, sha) {
        const url = this._apiUrl(path);
        const body = {
            message: `chore(bookshelf): delete ${this._fullPath(path)}`,
            sha,
            branch: this.branch
        };
        const res = await fetch(url, {
            method: 'DELETE',
            headers: { ...this._headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.status === 404) return;
        if (res.status === 401) throw new GitHubAuthError('GitHub authentication failed');
        if (res.status === 409 || res.status === 422) {
            throw new GitHubConflictError(`sha conflict on delete ${path}`, path);
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`GitHub API error: ${res.status} ${res.statusText} on DELETE ${path}\n${text}`);
        }
    }

    async _write(path, text) {
        let sha = this._shaCache.get(path);
        if (!sha) {
            // 新規かもしれないが、既存があれば sha を取得する必要がある
            const existing = await this._getContent(path);
            if (existing && existing.type === 'file' && existing.sha) {
                sha = existing.sha;
                this._shaCache.set(path, sha);
            }
        }
        const newSha = await this._putContent(path, text, { sha });
        if (newSha) this._shaCache.set(path, newSha);
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
window.GitHubAuthError = GitHubAuthError;
