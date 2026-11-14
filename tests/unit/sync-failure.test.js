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

// イシュー#639: 保存先へ書くのを止めている間 (3択をまだ選んでいない) の印。失敗とは別の名前1つで、理由で種類を分ける
describe('SyncFailure.holdError と、止めている間の種類', () => {
    it('印は SyncHoldError の1つの名前で、理由 (reason) を持つ', () => {
        const e = SyncFailure.holdError('load-conflict');
        expect(e).toBeInstanceOf(Error);
        expect(e.name).toBe('SyncHoldError');
        expect(e.reason).toBe('load-conflict');
    });

    it('読込時の3択 (load-conflict): 再試行せず、「選ぶ」で3択を開き直す。保存先の種類によらず同じ文', () => {
        for (const method of ['local', 'hub', 'github']) {
            const f = SyncFailure.classify(SyncFailure.holdError('load-conflict'), method);
            expect(f).toMatchObject({ kind: 'load-conflict', retryable: false, reconnect: false, hold: true, actionLabel: '選ぶ' });
            expect(f.message).toBe('保存先とこの端末の両方が変わっているため、保存先へ保存していません。「選ぶ」から、どちらの内容を使うか選んでください。');
        }
    });

    it('書き込み時の3択 (sync-conflict): 再試行せず、「選ぶ」で3択を開き直す', () => {
        const f = SyncFailure.classify(SyncFailure.holdError('sync-conflict'), 'hub');
        expect(f).toMatchObject({ kind: 'sync-conflict', retryable: false, reconnect: false, hold: true, actionLabel: '選ぶ' });
        expect(f.message).toContain('保存先へ保存していません');
    });

    it('ふつうの失敗には hold が付かない (状態バーのボタンは設定を開く)', () => {
        expect(SyncFailure.classify(new Error('timeout'), 'hub').hold).toBeUndefined();
        expect(SyncFailure.classify(err('HubAuthError'), 'hub').hold).toBeUndefined();
    });

    it('公開を止めた時の文は「何が起きたか＋次にどうすればよいか」', () => {
        expect(SyncFailure.HOLD_PUBLISH_MESSAGE).toContain('公開を止めました');
        expect(SyncFailure.HOLD_PUBLISH_MESSAGE).toContain('「選ぶ」');
    });
});

describe('SyncFailure.loadFailure (起動の読込が通信で失敗した時・イシュー#666)', () => {
    it('ハブと GitHub で文を分け、どちらも「何が起きたか＋この端末の内容＋次にどうすればよいか」', () => {
        expect(SyncFailure.loadFailure('hub')).toEqual({ kind: 'load-network', retryable: true, actionLabel: '再試行',
            message: 'Asayake ハブから読み込めませんでした。この端末の内容を表示しています。通信が戻ったら「再試行」を押してください。' });
        expect(SyncFailure.loadFailure('github')).toEqual({ kind: 'load-network', retryable: true, actionLabel: '再試行',
            message: 'GitHub から読み込めませんでした。この端末の内容を表示しています。通信が戻ったら「再試行」を押してください。' });
    });

    it('文に出す手 (「再試行」) とボタンの名前が同じ・呼ぶたびに別の物を返す (呼んだ側が書き換えても次に響かない)', () => {
        const a = SyncFailure.loadFailure('hub');
        expect(a.message).toContain(`「${a.actionLabel}」`);
        a.message = 'x';
        expect(SyncFailure.loadFailure('hub').message).not.toBe('x');
    });
});
