// SyncFailure — 保存 (同期) の失敗の種類と、利用者に見せる文言を決める1か所 (イシュー#603)。
//
// 保存先 (ハブ/GitHub/ローカル) への書き込みが失敗した時、状態バー・設定の同期欄・記事エディタの注意帯は
// すべてここで決めた文言を使う (失敗ごとに個別の文言を書かない)。文言は「何が起きたか＋次にどうすればよいか」
// (docs/ui-standards.md §2-11)。retryable=true の種類だけ、アプリが自動で再試行する (js/bookshelf.js _runPendingSync)。
//   SyncFailure.classify(error, method) → { kind, retryable, reconnect, message, actionLabel }
//   SyncFailure.RETRY_DELAYS_MS                 自動の再試行の間隔 (実測前の仮の値・ADR に記録)
//   SyncFailure.RETRYING_MESSAGE                自動の再試行の途中に出す文
//   SyncFailure.holdError(reason)               保存先へ書くのを止めている間の印のエラー (イシュー#639)
//   SyncFailure.HOLD_PUBLISH_MESSAGE            止めている間に公開を止めた時の文
//   SyncFailure.loadFailure(method)             起動時の保存先 (ハブ/GitHub) からの読み込みが通信で失敗した時の種類と文 (イシュー#666)
(function () {
    'use strict';

    // 自動の再試行の間隔 (1回目の失敗の5秒後・その15秒後・その45秒後の3回)。実測前の仮の値。
    const RETRY_DELAYS_MS = [5000, 15000, 45000];
    const RETRYING_MESSAGE = '保存できていない変更があります。自動で再試行しています。';
    const HOLD_PUBLISH_MESSAGE = '保存先とこの端末の両方が変わっているため、公開を止めました。状態バーの「選ぶ」で使う内容を選んでから、もう一度公開してください。';

    // 保存先へ書くのを止めている間 (利用者が3択で選ぶまで書かない) の印。失敗とは別の名前1つにまとめ、
    // 止めている理由 (reason) で種類を分ける: 'load-conflict' = 読込時の3択 (イシュー#602)・'sync-conflict' = 書き込み時の3択 (イシュー#616)
    function holdError(reason) {
        const e = new Error(`sync hold: ${reason}`); // 利用者には出さない (出す文は classify の message)
        e.name = 'SyncHoldError';
        e.reason = reason;
        return e;
    }

    function classify(error, method) {
        const name = (error && error.name) || '';
        // 止めている間は、直らない種類と同じく再試行せず、すぐ出す。hold=true は「選ぶ」で3択を開き直す印
        if (name === 'SyncHoldError') {
            if (error.reason === 'sync-conflict') {
                return { kind: 'sync-conflict', retryable: false, reconnect: false, hold: true, actionLabel: '選ぶ',
                    message: '別の端末で保存先が更新されたため、保存先へ保存していません。「選ぶ」から、どちらの内容を使うか選んでください。' };
            }
            return { kind: 'load-conflict', retryable: false, reconnect: false, hold: true, actionLabel: '選ぶ',
                message: '保存先とこの端末の両方が変わっているため、保存先へ保存していません。「選ぶ」から、どちらの内容を使うか選んでください。' };
        }
        if (method === 'hub' && name === 'HubAuthError') {
            return { kind: 'auth', retryable: false, reconnect: true, actionLabel: 'ログインし直す',
                message: 'Asayake ハブのログインが切れたため、保存できませんでした。設定からログインし直してください。' };
        }
        if (method === 'github' && name === 'GitHubAuthError') {
            return { kind: 'auth', retryable: false, reconnect: true, actionLabel: '接続し直す',
                message: 'GitHub の接続が切れたため、保存できませんでした。設定から接続し直してください。' };
        }
        if (method === 'hub' && name === 'HubQuotaError') {
            return { kind: 'quota', retryable: false, reconnect: false, actionLabel: '確認',
                message: 'Asayake ハブの保存容量がいっぱいのため、保存できませんでした。不要なデータを減らすか、Plus に切り替えてください。' };
        }
        if (method !== 'hub' && method !== 'github') {
            if (name === 'NotFoundError' || name === 'InvalidStateError') {
                return { kind: 'folder-missing', retryable: false, reconnect: true, actionLabel: '確認',
                    message: '保存先のフォルダが見つからないため、保存できませんでした。設定からフォルダを選び直してください。' };
            }
            if (name === 'NotAllowedError' || name === 'SecurityError') {
                return { kind: 'permission', retryable: false, reconnect: true, actionLabel: '確認',
                    message: 'フォルダへの書き込みが許可されていないため、保存できませんでした。設定の「フォルダを選ぶ」から許可してください。' };
            }
            return { kind: 'write', retryable: true, reconnect: false, actionLabel: '確認',
                message: 'フォルダに保存できませんでした。「再試行」で直らないときは、設定からフォルダを選び直してください。' };
        }
        // 通信の失敗・時間切れ (js/storage-adapter.js の「通信がタイムアウトしました」)・サーバの失敗
        return { kind: 'network', retryable: true, reconnect: false, actionLabel: '確認',
            message: method === 'github'
                ? 'GitHub に保存できませんでした。通信が戻ったら「再試行」を押してください。'
                : 'Asayake ハブに保存できませんでした。通信が戻ったら「再試行」を押してください。' };
    }

    // 起動時の保存先からの読み込みが、ログイン切れ以外 (通信の失敗・時間切れ・サーバの失敗) で失敗した時 (イシュー#666)。
    // 状態バーの行と設定の同期欄に、この文と「再試行」(読み直す) を出す。ログイン切れの文はここで決めない (js/bookshelf.js の catch)
    function loadFailure(method) {
        return { kind: 'load-network', retryable: true, actionLabel: '再試行',
            message: method === 'github'
                ? 'GitHub から読み込めませんでした。この端末の内容を表示しています。通信が戻ったら「再試行」を押してください。'
                : 'Asayake ハブから読み込めませんでした。この端末の内容を表示しています。通信が戻ったら「再試行」を押してください。' };
    }

    // E2E だけが待ち時間を短く差し替える (localStorage 'bookshelf.flag.syncRetryDelaysMs' = JSON の数値配列)
    function retryDelays() {
        try {
            const raw = localStorage.getItem('bookshelf.flag.syncRetryDelaysMs');
            const v = raw ? JSON.parse(raw) : null;
            if (Array.isArray(v) && v.length && v.every((n) => Number.isFinite(n) && n >= 0)) return v;
        } catch (_) { /* 既定へ */ }
        return RETRY_DELAYS_MS;
    }

    const api = { classify, loadFailure, retryDelays, holdError, RETRY_DELAYS_MS, RETRYING_MESSAGE, HOLD_PUBLISH_MESSAGE };
    if (typeof window !== 'undefined') window.SyncFailure = api;
    if (typeof globalThis !== 'undefined') globalThis.SyncFailure = api;
})();
