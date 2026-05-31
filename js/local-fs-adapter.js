// LocalFSAdapter - File System Access API ベースの StorageAdapter 実装
//
// 同期フォルダ (ユーザが picker で選択した directory handle) をルートとして
// 読み書きする。Chrome / Edge / Android Capacitor (SAF) で動作。
// Firefox / Safari (iOS PWA 含む) では File System Access API が無いため利用不可。
//
// path は "bookshelves/all.json" のようなスラッシュ区切り文字列。
// adapter 内で split して FileSystemDirectoryHandle を辿る。

class LocalFSAdapter extends StorageAdapter {
    constructor() {
        super();
        this.dirHandle = null;
    }

    // ===== 接続管理 =====

    setDirHandle(handle) {
        this.dirHandle = handle;
    }

    hasDirHandle() {
        return !!this.dirHandle;
    }

    isConnected() {
        return !!this.dirHandle;
    }

    // ===== パス解決 =====

    _splitPath(path) {
        const parts = path.split('/').filter(Boolean);
        if (parts.length === 0) {
            throw new Error('LocalFSAdapter: empty path');
        }
        return {
            dirParts: parts.slice(0, -1),
            fileName: parts[parts.length - 1]
        };
    }

    async _resolveDir(pathParts, { create = false } = {}) {
        if (!this.dirHandle) {
            throw new Error('LocalFSAdapter: dirHandle not set');
        }
        let dir = this.dirHandle;
        for (const name of pathParts) {
            dir = await dir.getDirectoryHandle(name, { create });
        }
        return dir;
    }

    // ===== StorageAdapter 実装 =====

    async readJSON(path) {
        const { dirParts, fileName } = this._splitPath(path);
        try {
            const dir = await this._resolveDir(dirParts);
            const fileHandle = await dir.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            const text = await file.text();
            return text.trim() ? JSON.parse(text) : null;
        } catch (e) {
            if (e.name === 'NotFoundError') return null;
            throw e;
        }
    }

    async writeJSON(path, data) {
        const { dirParts, fileName } = this._splitPath(path);
        const dir = await this._resolveDir(dirParts, { create: true });
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();
    }

    async readText(path) {
        const { dirParts, fileName } = this._splitPath(path);
        try {
            const dir = await this._resolveDir(dirParts);
            const fileHandle = await dir.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            return await file.text();
        } catch (e) {
            if (e.name === 'NotFoundError') return null;
            throw e;
        }
    }

    async writeText(path, text) {
        const { dirParts, fileName } = this._splitPath(path);
        const dir = await this._resolveDir(dirParts, { create: true });
        const fileHandle = await dir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
    }

    async fileExists(path) {
        const { dirParts, fileName } = this._splitPath(path);
        try {
            const dir = await this._resolveDir(dirParts);
            await dir.getFileHandle(fileName);
            return true;
        } catch (e) {
            return false;
        }
    }

    async deleteFile(path) {
        const { dirParts, fileName } = this._splitPath(path);
        try {
            const dir = await this._resolveDir(dirParts);
            await dir.removeEntry(fileName);
        } catch (e) {
            if (e.name !== 'NotFoundError') throw e;
        }
    }

    async listFiles(dirPath) {
        const parts = dirPath.split('/').filter(Boolean);
        try {
            const dir = await this._resolveDir(parts);
            const names = [];
            for await (const [name, entry] of dir.entries()) {
                if (entry.kind === 'file') names.push(name);
            }
            return names;
        } catch (e) {
            if (e.name === 'NotFoundError') return [];
            throw e;
        }
    }

    async listDirs(dirPath) {
        const parts = dirPath.split('/').filter(Boolean);
        try {
            const dir = await this._resolveDir(parts);
            const names = [];
            for await (const [name, entry] of dir.entries()) {
                if (entry.kind === 'directory') names.push(name);
            }
            return names;
        } catch (e) {
            if (e.name === 'NotFoundError') return [];
            throw e;
        }
    }
}

window.LocalFSAdapter = LocalFSAdapter;
