// SyncFailure (js/sync-failure.js・イシュー#603) の契約: 失敗の種類 → 文言・自動の再試行の要否。
import { describe, it, expect, afterEach } from 'vitest';
await import('../../js/sync-failure.js');
const { SyncFailure } = globalThis;

const err = (name, message = 'x') => Object.assign(new Error(message), { name });

describe('SyncFailure.classify', () => {
    it('通信・時間切れ・サーバの失敗は自動で再試行する (ハブ・GitHub)', () => {
        const hub = SyncFailure.classify(new Error('通信がタイムアウトしました (10000ms): https://hub'), 'hub');
        expect(hub).toMatchObject({ kind: 'network', retryable: true, reconnect: false });
        expect(hub.message).toBe('Asayake ハブに保存できませんでした。通信が戻ったら「再試行」を押してください。');
        const gh = SyncFailure.classify(new Error('update ref main: 500'), 'github');
        expect(gh.message).toBe('GitHub に保存できませんでした。通信が戻ったら「再試行」を押してください。');
        expect(gh.retryable).toBe(true);
    });

    it('ログイン切れ・接続切れ・容量超過は再試行しない (直らないため)', () => {
        expect(SyncFailure.classify(err('HubAuthError'), 'hub')).toMatchObject({ kind: 'auth', retryable: false, reconnect: true, actionLabel: 'ログインし直す' });
        expect(SyncFailure.classify(err('GitHubAuthError'), 'github')).toMatchObject({ kind: 'auth', retryable: false, reconnect: true, actionLabel: '接続し直す' });
        expect(SyncFailure.classify(err('HubQuotaError'), 'hub')).toMatchObject({ kind: 'quota', retryable: false });
    });

    it('ローカル: フォルダが見つからない・許可が無いは再試行しない／書き込みの失敗は再試行する', () => {
        expect(SyncFailure.classify(err('NotFoundError'), 'local')).toMatchObject({ kind: 'folder-missing', retryable: false, reconnect: true });
        expect(SyncFailure.classify(err('InvalidStateError'), 'local').kind).toBe('folder-missing');
        expect(SyncFailure.classify(err('NotAllowedError'), 'local')).toMatchObject({ kind: 'permission', retryable: false });
        expect(SyncFailure.classify(err('NoModificationAllowedError'), 'local')).toMatchObject({ kind: 'write', retryable: true });
    });

    it('どの文言も「何が起きたか＋次にどうすればよいか」の2文 (docs/ui-standards.md §2-11)', () => {
        const cases = [
            [new Error('x'), 'hub'], [new Error('x'), 'github'], [err('NoModificationAllowedError'), 'local'],
            [err('HubAuthError'), 'hub'], [err('GitHubAuthError'), 'github'], [err('HubQuotaError'), 'hub'],
            [err('NotFoundError'), 'local'], [err('NotAllowedError'), 'local']
        ];
        for (const [e, m] of cases) {
            const { message } = SyncFailure.classify(e, m);
            expect(message.split('。').filter(Boolean)).toHaveLength(2);
            expect(message).toContain('保存できませんでした');
        }
    });
});

describe('SyncFailure.retryDelays', () => {
    afterEach(() => localStorage.removeItem('bookshelf.flag.syncRetryDelaysMs'));

    it('既定は 5秒→15秒→45秒 の3回 (実測前の仮の値)', () => {
        expect(SyncFailure.retryDelays()).toEqual([5000, 15000, 45000]);
        expect(SyncFailure.RETRY_DELAYS_MS).toEqual([5000, 15000, 45000]);
    });

    it('E2E 用のフラグで短く差し替えられる・壊れた値は既定へ戻る', () => {
        localStorage.setItem('bookshelf.flag.syncRetryDelaysMs', '[100,200]');
        expect(SyncFailure.retryDelays()).toEqual([100, 200]);
        localStorage.setItem('bookshelf.flag.syncRetryDelaysMs', '"abc"');
        expect(SyncFailure.retryDelays()).toEqual([5000, 15000, 45000]);
    });
});
