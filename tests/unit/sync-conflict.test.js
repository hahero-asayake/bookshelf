// 同期の衝突 (イシュー#616): 衝突の判定 (StorageAdapter.isRemoteConflict / isRemoteChanged) と、
// 衝突中の印 (SyncConfigManager.markConflict / conflict / clearConflict) の決まり。
//  - 4つの衝突エラー (楽観ロックの Conflict・中身が変わっていた RemoteChanged) は、どれも3択に回す
//  - 印は同じ保存先の間だけ効く。トークンの更新では外れない。保存先を切り替えた・設定を消した・退会して作り直した
//    (つなぎ先が変わった) 時は外れる。端末内の未同期の記録 (virtualBookshelf_pendingSync) には触らない
// 3択に回る経路そのものは門のE2E (tests/e2e/gate/j6-4-sync-conflict.spec.js) が確かめる。
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../js/storage-adapter.js');
await import('../../js/sync-config.js');
const StorageAdapter = window.StorageAdapter;
const SyncConfigManager = window.SyncConfigManager;

const err = (name) => Object.assign(new Error(name), { name });
const hubConfig = (uid, key = 'hk_1') => {
    const d = SyncConfigManager.defaults();
    return { ...d, method: 'hub', hub: { ...d.hub, apiBase: 'https://hub.example', uid, key } };
};
const githubConfig = (repo) => {
    const d = SyncConfigManager.defaults();
    return { ...d, method: 'github', github: { ...d.github, owner: 'me', repo, branch: 'main', token: 't' } };
};

describe('StorageAdapter.isRemoteConflict (衝突の判定は1か所)', () => {
    it('ハブ・GitHub の Conflict と RemoteChanged の4つを衝突とみなす', () => {
        for (const name of ['HubConflictError', 'GitHubConflictError', 'HubRemoteChangedError', 'GitHubRemoteChangedError']) {
            expect(StorageAdapter.isRemoteConflict(err(name))).toBe(true);
        }
    });
    it('通信・認証・容量の失敗や空の値は衝突ではない', () => {
        for (const e of [err('TypeError'), err('HubAuthError'), err('HubQuotaError'), err('GitHubAuthError'), null, undefined, {}]) {
            expect(StorageAdapter.isRemoteConflict(e)).toBe(false);
        }
    });
    it('isRemoteChanged は中身が他で変わっていた2つだけ', () => {
        expect(StorageAdapter.isRemoteChanged(err('HubRemoteChangedError'))).toBe(true);
        expect(StorageAdapter.isRemoteChanged(err('GitHubRemoteChangedError'))).toBe(true);
        expect(StorageAdapter.isRemoteChanged(err('HubConflictError'))).toBe(false);
        expect(StorageAdapter.isRemoteChanged(err('GitHubConflictError'))).toBe(false);
    });
});

describe('衝突中の印 (virtualBookshelf_syncConflict)', () => {
    beforeEach(() => { localStorage.clear(); });

    it('印を残すと同じ保存先では残り、消すと無くなる', () => {
        SyncConfigManager.save(hubConfig('u1'));
        expect(SyncConfigManager.conflict()).toBeNull();
        SyncConfigManager.markConflict();
        expect(SyncConfigManager.conflict()).not.toBeNull();
        SyncConfigManager.clearConflict();
        expect(SyncConfigManager.conflict()).toBeNull();
    });

    it('同じ保存先のままトークンだけ保存し直しても印は外れない', () => {
        SyncConfigManager.save(hubConfig('u1', 'hk_1'));
        SyncConfigManager.markConflict();
        SyncConfigManager.save(hubConfig('u1', 'hk_2'));
        expect(SyncConfigManager.conflict()).not.toBeNull();
    });

    it('保存先を切り替えると印は外れ、端末内の未同期の記録は残る', () => {
        SyncConfigManager.save(hubConfig('u1'));
        localStorage.setItem('virtualBookshelf_pendingSync', '1');
        SyncConfigManager.markConflict();
        SyncConfigManager.save(githubConfig('data'));
        expect(SyncConfigManager.conflict()).toBeNull();
        expect(localStorage.getItem('virtualBookshelf_syncConflict')).toBeNull();
        expect(localStorage.getItem('virtualBookshelf_pendingSync')).toBe('1');
    });

    it('GitHub のつなぎ先 (リポジトリ) を変えても印は外れる', () => {
        SyncConfigManager.save(githubConfig('data'));
        SyncConfigManager.markConflict();
        SyncConfigManager.save(githubConfig('data2'));
        expect(SyncConfigManager.conflict()).toBeNull();
    });

    it('保存先の設定を消すと印も消える', () => {
        SyncConfigManager.save(hubConfig('u1'));
        SyncConfigManager.markConflict();
        SyncConfigManager.clear();
        expect(localStorage.getItem('virtualBookshelf_syncConflict')).toBeNull();
    });

    it('退会して作り直した (save を通らずにつなぎ先が変わった) 保存先では、前の印を見ずに捨てる', () => {
        SyncConfigManager.save(hubConfig('u1'));
        SyncConfigManager.markConflict();
        localStorage.setItem('bookshelf_sync', JSON.stringify(hubConfig('u2')));
        expect(SyncConfigManager.conflict()).toBeNull();
        expect(localStorage.getItem('virtualBookshelf_syncConflict')).toBeNull();
    });
});
