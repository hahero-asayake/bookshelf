// HubAuth - Asayake ハブの認証 (Google Sign-In → ハブ公開キー hk_ 発行) (ADR-032 / 09 §10)
//
// フロー:
//   1. Google Identity Services の「Sign in with Google」ボタンを描画
//   2. ユーザがログイン → GIS が ID トークン (JWT, aud=HUB_GOOGLE_CLIENT_ID) を callback で返す
//   3. その ID トークンを POST /session に渡す → Worker が検証し uid を確定 → ハブ公開キー hk_ を発行
//   4. hk_ キー・siteId・plan/quota/used を bookshelf_sync.hub に保存 (HubStorageAdapter が利用)
//
// hk_ キーは長命 (KV に保存、切断まで有効)。以後の同期/公開は hk_ キーの Bearer 認証のみで動く。
// ID トークンは /session の一度きりにしか使わない (毎回の同期では不要)。401 時は再ログイン。
//
// ⚠️ HUB_GOOGLE_CLIENT_ID は Worker env の GOOGLE_CLIENT_ID と一致必須 (aud 検証)。
//    また Google Cloud Console で「承認済み JavaScript 生成元」にアプリ配信元
//    (https://hahero-asayake.github.io ・ https://asayake.org) を登録しておくこと。

const HUB_API_BASE = 'https://hub.asayake.org';
// ハブ専用の Web OAuth クライアント ID (公開情報)。Worker の GOOGLE_CLIENT_ID と一致させる。
const HUB_GOOGLE_CLIENT_ID = '368547907822-r79adn6052laipf20ram49br1skhv7ru.apps.googleusercontent.com';
const HUB_GIS_SRC = 'https://accounts.google.com/gsi/client';

class HubAuth {
    static isConfigured() {
        return !!HUB_GOOGLE_CLIENT_ID && !HUB_GOOGLE_CLIENT_ID.startsWith('REPLACE_ME');
    }

    static isConnected() {
        const h = (SyncConfigManager.load().hub) || {};
        return !!(h.key && h.apiBase);
    }

    // GIS スクリプトを遅延ロード (ハブ選択時のみ)
    static async _loadGis() {
        if (window.google && window.google.accounts && window.google.accounts.id) return;
        if (!HubAuth._gisPromise) {
            HubAuth._gisPromise = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = HUB_GIS_SRC;
                s.async = true;
                s.defer = true;
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('Google ログインの読み込みに失敗しました'));
                document.head.appendChild(s);
            });
        }
        await HubAuth._gisPromise;
    }

    /**
     * 「Sign in with Google」ボタンを container に描画する。
     * ログイン完了で onConnected(session) を呼ぶ (session = 保存済み hub 設定)。
     * @param {HTMLElement} container
     * @param {{onConnected?:function, onError?:function}} [handlers]
     */
    static async renderSignInButton(container, { onConnected, onError } = {}) {
        if (!container) return;
        if (!HubAuth.isConfigured()) {
            container.textContent = 'ハブの Google クライアント ID が未設定です。';
            return;
        }
        try {
            await HubAuth._loadGis();
        } catch (e) {
            container.textContent = 'Google ログインを読み込めませんでした。通信環境をご確認ください。';
            if (onError) onError(e);
            return;
        }
        window.google.accounts.id.initialize({
            client_id: HUB_GOOGLE_CLIENT_ID,
            auto_select: false,
            cancel_on_tap_outside: true,
            callback: async (resp) => {
                try {
                    if (!resp || !resp.credential) throw new Error('ログインがキャンセルされました');
                    const session = await HubAuth._exchange(resp.credential);
                    if (onConnected) onConnected(session);
                } catch (e) {
                    console.error('ハブ認証エラー:', e);
                    if (onError) onError(e);
                }
            }
        });
        container.innerHTML = '';
        window.google.accounts.id.renderButton(container, {
            theme: 'outline', size: 'large', type: 'standard',
            text: 'signin_with', shape: 'pill', logo_alignment: 'left'
        });
    }

    // ID トークンを /session に渡し、ハブ公開キーを取得して設定に保存
    static async _exchange(idToken) {
        const res = await fetch(`${HUB_API_BASE}/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
        });
        if (!res.ok) {
            let detail = '';
            try { detail = (await res.text()).slice(0, 200); } catch (_) {}
            throw new Error(`ハブ認証に失敗しました (${res.status})${detail ? ': ' + detail : ''}`);
        }
        const data = await res.json();
        const cfg = SyncConfigManager.load();
        cfg.hub = {
            ...(cfg.hub || {}),
            apiBase: data.apiBase || HUB_API_BASE,
            key: data.key,
            uid: data.uid,
            siteId: data.siteId || '',
            email: data.email || null,
            plan: data.plan || 'free',
            quotaBytes: data.quotaBytes || 0,
            usedBytes: data.usedBytes || 0,
            interval: data.interval || null,
            currentPeriodEnd: data.currentPeriodEnd || null,
            cancelAtPeriodEnd: !!data.cancelAtPeriodEnd,
            subStatus: data.subStatus || null,
            billingManaged: !!data.billingManaged,
            isAdmin: !!data.isAdmin,
            publicBase: data.publicBase || ''
        };
        SyncConfigManager.save(cfg);
        return cfg.hub;
    }

    /**
     * 使用量を再取得し設定に反映 (使用量バー更新用)。未接続なら null。
     * @returns {Promise<object|null>} 更新後の hub 設定
     */
    static async refreshUsage() {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!hub.key || !hub.apiBase) return null;
        const res = await fetch(`${hub.apiBase}/usage`, {
            headers: { 'Authorization': `Bearer ${hub.key}` }
        });
        if (res.status === 401) throw new HubAuthError('ハブの認証が失効しました。再接続してください');
        if (!res.ok) throw new Error(`使用量の取得に失敗しました (${res.status})`);
        const data = await res.json();
        const cfg = SyncConfigManager.load();
        cfg.hub = {
            ...(cfg.hub || {}),
            plan: data.plan || 'free',
            quotaBytes: data.quotaBytes || 0,
            usedBytes: data.usedBytes || 0,
            interval: data.interval || null,
            currentPeriodEnd: data.currentPeriodEnd || null,
            cancelAtPeriodEnd: !!data.cancelAtPeriodEnd,
            subStatus: data.subStatus || null,
            billingManaged: !!data.billingManaged,
            isAdmin: !!data.isAdmin,
            siteId: data.siteId || (cfg.hub || {}).siteId || '',
            publicBase: data.publicBase || (cfg.hub || {}).publicBase || ''
        };
        SyncConfigManager.save(cfg);
        return cfg.hub;
    }

    static disconnect() {
        const cfg = SyncConfigManager.load();
        if (window.google && window.google.accounts && window.google.accounts.id) {
            try { window.google.accounts.id.disableAutoSelect(); } catch (_) {}
        }
        cfg.hub = {
            apiBase: '', key: '', uid: '', siteId: '', handle: '', email: null,
            plan: 'free', quotaBytes: 0, usedBytes: 0,
            interval: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, subStatus: null, billingManaged: false, isAdmin: false,
            publicBase: ''
        };
        SyncConfigManager.save(cfg);
    }
}

window.HubAuth = HubAuth;
