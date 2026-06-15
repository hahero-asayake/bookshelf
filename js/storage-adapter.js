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
}

window.StorageAdapter = StorageAdapter;
