// ui-feedback - 通知 toast + アプリ内確認モーダル (T06, ADR は 04_画面設計書の文言方針)
//
// 方針:
//   - 通知 (旧 alert) は window.toast(message, { type }) に統一
//   - 破壊的操作の確認は window.confirmDialog({...}) → Promise<boolean>
//   - type 推論を本モジュールに一元化: 旧 alert 文面は先頭絵文字 (✅/❌/⚠️ 等) を
//     type マーカーとして使っていたため、先頭絵文字から type を解決して絵文字は表示から除去する。
//     絵文字が無い文面はキーワードで推論 (呼び出し側の分類ミスを防ぐ)。
//   - DOM は初回呼び出し時に生成 (index.html の変更を最小に)

(function () {
    'use strict';

    // ===== toast =====

    // 既存バグ (イシュー#55・②実機指摘): success/error は LUCIDE_ICONS (js/icons.js) に
    // 未登録の名前 ('check-circle-2'/'alert-octagon') を指しており、CDN解決後の差し替えも
    // renderIconSafe 側が data-icon-value を付けていないため効かず、テキストフォールバック
    // (例: 'check-circle-2'.split('-')[0].slice(0,2) = 'ch') が出続けていた (保存失敗等の
    // 既存 error トーストも含め、js/ 内で type:'error' を使う18箇所すべてが対象)。
    // success は登録済みの同義アイコン 'check-circle' に、error は登録済みの 'alert-triangle'
    // (warn と共用) に差し替えて解消。本来の 'alert-octagon' 用 path 追加は 07_残検討事項.md に起票済み。
    const TYPE_ICON = {
        info: 'info',
        success: 'check-circle',
        warn: 'alert-triangle',
        error: 'alert-triangle'
    };

    // 先頭絵文字 → type (null = 装飾のみ: 除去するが type は推論に回す)
    const EMOJI_TYPE = [
        [/^✅\s*/, 'success'],
        [/^❌\s*/, 'error'],
        [/^(?:⚠️|🚫|⏳|⏱️)\s*/, 'warn'],
        [/^(?:📚|📋|📁|📂|📦|📝|📖|🔖|🔗|💾|🔌|🔄|🎉)\s*/, null]
    ];

    function inferType(msg) {
        if (/失敗|エラー|できません|拒否|見つかりません|切れまし|無効|不正/.test(msg)) return 'error';
        if (/してください|ありません|未設定|ブロックされ/.test(msg)) return 'warn';
        if (/しました|完了/.test(msg)) return 'success';
        return 'info';
    }

    function ensureToastContainer() {
        let el = document.getElementById('toast-container');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast-container';
            document.body.appendChild(el);
        }
        return el;
    }

    function renderIconSafe(name, size) {
        return (typeof window.renderIcon === 'function') ? window.renderIcon(name, { size }) : '';
    }

    // opts.action = { label, onClick } で Undo 等のボタンをトーストに1つ付けられる (押下で onClick→自身を閉じる)。
    // opts.duration (ms) で自動消去までの時間を上書きできる (Undo 付きは既定より長めに呼び出し側で指定する)。
    window.toast = function toast(message, opts = {}) {
        const { type, action, duration } = opts;
        let msg = String(message ?? '');
        let resolved = type || null;
        for (const [re, t] of EMOJI_TYPE) {
            if (re.test(msg)) {
                msg = msg.replace(re, '');
                if (!resolved && t) resolved = t;
                break;
            }
        }
        if (!resolved) resolved = inferType(msg);
        if (!TYPE_ICON[resolved]) resolved = 'info';

        const container = ensureToastContainer();
        const item = document.createElement('div');
        item.className = `toast toast-${resolved}`;
        item.setAttribute('role', resolved === 'error' ? 'alert' : 'status');
        item.innerHTML = `<span class="h-icon toast-icon">${renderIconSafe(TYPE_ICON[resolved], 16)}</span><span class="toast-message"></span>`;
        item.querySelector('.toast-message').textContent = msg;

        const remove = () => {
            if (!item.parentNode) return;
            item.classList.add('toast-out');
            setTimeout(() => item.remove(), 180);
        };
        if (action && action.label && typeof action.onClick === 'function') {
            const actionBtn = document.createElement('button');
            actionBtn.type = 'button';
            actionBtn.className = 'btn btn-small btn-secondary toast-action';
            actionBtn.textContent = action.label;
            actionBtn.addEventListener('click', () => { action.onClick(); remove(); });
            item.appendChild(actionBtn);
        }
        if (resolved === 'error') {
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'toast-close';
            close.title = '閉じる';
            close.innerHTML = renderIconSafe('x', 14) || '×';
            close.addEventListener('click', remove);
            item.appendChild(close);
            setTimeout(remove, duration ?? 6000);
        } else {
            setTimeout(remove, duration ?? 4000);
        }
        container.appendChild(item);
        return item;
    };

    // ===== 確認モーダル =====

    /**
     * アプリ内確認モーダル。
     * @param {object} opts
     * @param {string} [opts.title]
     * @param {string} opts.message   実際に行われる内容のみ表示 (\n 改行可)
     * @param {string} [opts.okLabel='OK']
     * @param {string} [opts.cancelLabel='キャンセル']
     * @param {boolean} [opts.danger=false] OK ボタンを danger 色に
     * @returns {Promise<boolean>} Esc / 背景クリック = false
     */
    window.confirmDialog = function confirmDialog({ title = '', message = '', okLabel = 'OK', cancelLabel = 'キャンセル', danger = false } = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'cfm-overlay';
            const box = document.createElement('div');
            box.className = 'cfm-box';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            box.innerHTML = `
                ${title ? '<div class="cfm-title"></div>' : ''}
                <div class="cfm-message"></div>
                <div class="cfm-actions">
                    <button type="button" class="btn btn-secondary cfm-cancel"></button>
                    <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} cfm-ok"></button>
                </div>`;
            if (title) box.querySelector('.cfm-title').textContent = title;
            box.querySelector('.cfm-message').textContent = message;
            const okBtn = box.querySelector('.cfm-ok');
            const cancelBtn = box.querySelector('.cfm-cancel');
            okBtn.textContent = okLabel;
            cancelBtn.textContent = cancelLabel;
            overlay.appendChild(box);

            // 重なり管理役 (js/overlay-manager.js・イシュー#367): ダイアログ帯 (--ov-z-dialog) に小 (sm) で載せる。
            // 履歴には積まない (D04)。管理役が無い環境 (単体テスト等) では従来どおり CSS の帯だけで出す
            let ov = null;
            const done = (result) => {
                document.removeEventListener('keydown', onKey, true);
                if (ov) ov.close(result ? 'button' : 'cancel');
                overlay.remove();
                resolve(result);
            };
            const onKey = (e) => {
                if (window.Surface.isEsc(e)) { e.stopPropagation(); done(false); }
                if (e.key === 'Enter') { e.stopPropagation(); done(true); }
            };
            okBtn.addEventListener('click', () => done(true));
            cancelBtn.addEventListener('click', () => done(false));
            overlay.addEventListener('click', (e) => { if (window.Surface.isBackdrop(e, overlay)) done(false); });
            document.addEventListener('keydown', onKey, true);

            document.body.appendChild(overlay);
            if (window.overlays) ov = window.overlays.open(overlay, { kind: 'dialog', size: 'sm', hist: false, showClass: null, sizeTarget: box });
            okBtn.focus();
        });
    };

    // ===== グローバル例外 → toast (#339: ローンチ前漏れ精査・エラー監視の最小実装) =====
    //
    // window の bubble 段階 (capture 無し) で登録する。リソース読み込みエラー (img 等) は
    // bubble せず window まで届かないため、既存の書影フォールバック用 document capture リスナ
    // (js/bookshelf.js:1520 付近 _setupCoverFallback) とは自然に棲み分かれる。念のため
    // ErrorEvent かどうか・e.target===window かも確認し、万一の混入を防ぐ。
    const GLOBAL_ERROR_MESSAGE = '予期しないエラーが発生しました。しばらくしてからもう一度お試しください。';
    const GLOBAL_ERROR_SUPPRESS_MS = 5000; // 連打防止: 同一メッセージ (固定文言1種のみ) を短時間は再表示しない
    let lastGlobalErrorToastAt = 0;
    function notifyUnexpectedError() {
        const now = Date.now();
        if (now - lastGlobalErrorToastAt < GLOBAL_ERROR_SUPPRESS_MS) return;
        lastGlobalErrorToastAt = now;
        window.toast(GLOBAL_ERROR_MESSAGE, { type: 'error' });
    }
    // ===== グローバル例外 → 匿名のエラー報告 (イシュー#584・門(e) 見張り) =====
    //
    // 予期しないエラーを運営が知るための最小の報告。送るのは 版・画面名・エラーの先頭行 の3つだけで、
    // 蔵書・メモ・記事の内容、アカウント、端末を見分ける番号は送らない (legal/privacy.html「エラー情報」)。
    // 同じエラーは端末ごとに1日1回 (localStorage)。送信に失敗しても再送せず、画面の動きは変えない。
    // 受け口は cf-worker/client-errors.js (POST /client-error)。集計と通知はサーバ側で行う。
    const ERR_REPORT_URL = 'https://hub.asayake.org/client-error';     // js/hub-auth.js の HUB_API_BASE と同じホスト
    const ERR_REPORT_ORIGINS = ['https://asayake.org', 'https://hahero-asayake.github.io'];   // 本番の配信元だけ
    const ERR_REPORT_OFF = 'bookshelf_errReportOff';                   // '1'=利用者が設定で「エラー情報を送らない」をオン (js/screens/settings.js)
    const ERR_REPORT_FLAG = 'bookshelf.flag.errReport';                // '0'=送らない / '1'=本番以外でも送る (E2E 用)
    const ERR_REPORT_STORE = 'bookshelf_errReport_v1';                 // { day, sent:[指紋…] }
    const ERR_REPORT_MAX_PER_DAY = 20;                                 // 1端末が1日に送る種類の上限 (暴走止め)
    const ERR_REPORT_HIDDEN = '(内容は伏せた)';

    // 送ってよいかの条件はここ1か所にまとめる (保存先や設定で条件を変える時はここだけを直す)。
    // 優先順: ①利用者の「エラー情報を送らない」(端末ごと・同期を待たずに読める localStorage) → 必ず送らない
    //         ②開発用フラグ '0'/'1' → ③本番の配信元だけ送る。
    function errorReportEnabled() {
        let off = null;
        let flag = null;
        try {
            off = localStorage.getItem(ERR_REPORT_OFF);
            flag = localStorage.getItem(ERR_REPORT_FLAG);
        } catch (_) { /* localStorage 不可なら既定へ */ }
        if (off === '1') return false;
        if (flag === '0') return false;
        if (flag === '1') return true;
        return ERR_REPORT_ORIGINS.includes(location.origin);
    }

    // 版 = index.html が読み込むファイルの ?v= のうち一番新しい値 (ファイルごとに値が違うため)。
    function appVersion() {
        let max = 0;
        document.querySelectorAll('script[src*="?v="], link[href*="?v="]').forEach((el) => {
            const m = /[?&]v=(\d{6,12})\b/.exec(el.getAttribute('src') || el.getAttribute('href') || '');
            if (m && Number(m[1]) > max) max = Number(m[1]);
        });
        return max ? String(max) : 'unknown';
    }

    // 画面名 = 最前面の面 (Surface に登録済みの id) 、無ければ URL ハッシュの先頭の語 (route の種類)。
    // どちらも固定の英字名で、本・本棚・記事の ID (ハッシュの2語目以降) は含めない。
    function screenName() {
        const ok = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s);
        try {
            const top = window.overlays && typeof window.overlays.top === 'function' ? window.overlays.top() : null;
            const S = window.Surface;
            if (top && ok(top.id) && S && typeof S.get === 'function' && S.get(top.id)) return top.id;
            if (top && ok(top.kind)) return top.kind;
        } catch (_) { /* 取れなければハッシュへ */ }
        const m = /^#\/([a-z][a-z0-9-]{0,30})/.exec(location.hash || '');
        return m ? m[1] : 'main';
    }

    // エラーの出どころがアプリ同梱の js/ かどうか (プラグイン・拡張機能・外部スクリプトのエラーは送らない)。
    const ERR_REPORT_OWN_PREFIX = (() => { try { return new URL('js/', document.baseURI).href; } catch (_) { return null; } })();
    function fromOwnScript(filename, err) {
        if (!ERR_REPORT_OWN_PREFIX) return false;
        if (filename) return String(filename).startsWith(ERR_REPORT_OWN_PREFIX);
        const m = /((?:https?|blob|file):[^\s)]+?):\d+:\d+/.exec((err && err.stack) || '');
        return !!m && m[1].startsWith(ERR_REPORT_OWN_PREFIX);
    }

    // アプリが投げる Error のうち、書き出しをそのまま送ってよいもの (固定の文言だけを並べる)。
    // アプリの Error は題名・パス・URL・サーバの応答を文中のどこにでも差し込みうるので、ここに無い文面は
    // 種類名だけを送る。足す時は「差し込みより前の固定の書き出し」だけを書くこと。
    const ERR_REPORT_OWN_KEEP = [
        /^GitHub API (?:error|forbidden)/, /^GitHub rate limit exceeded/, /^GitHub \/user failed/, /^Repository not found/,
        /^Device code (?:request failed|error)/, /^Device flow error/, /^Access token request failed/, /^OAuth App 設定エラー/,
        /^Hub API error/, /^hub batch write failed on server/, /^HubStorageAdapter/,
        /^ハブ認証に失敗しました/, /^使用量の取得に失敗しました/, /^ユーザー名の設定に失敗しました/,
        /^通信がタイムアウトしました/, /^公開できる記事がありません/, /^公開記事に個人情報が混入している可能性があります/,
        /^manifest\.json 取得失敗/, /^HTTP(?= \d{3}\b)/
    ];

    // 送る1行を作る。返り値 null = 送らない。
    //  - Error でないもの (文字列やオブジェクトの reject) は型だけ
    //  - SyntaxError は名前だけ (JSON の中身の断片が文面に入るため)
    //  - 組み込みの例外 (TypeError 等・DOMException) は文面がエンジン由来なので残す。引用符の中は
    //    コード上の名前 (英数と _ $ .) の時だけ残し、URL・パス・長い数字は伏せる
    //  - それ以外 (アプリや同梱ライブラリが投げた Error) は ERR_REPORT_OWN_KEEP の書き出しと、
    //    直後の3桁の状態コードだけ
    function errorLine(err) {
        if (err === null || err === undefined) return null;
        const isDom = typeof DOMException !== 'undefined' && err instanceof DOMException;
        if (!(err instanceof Error) && !isDom) return `NonError: ${typeof err}`;
        const name = String(err.name || 'Error').replace(/[^A-Za-z]/g, '').slice(0, 40) || 'Error';
        if (err instanceof SyntaxError) return 'SyntaxError';
        const first = String(err.message || '').split('\n')[0];
        const builtin = isDom || [TypeError, ReferenceError, RangeError, URIError, EvalError].some((C) => err instanceof C);
        let line;
        if (builtin) {
            line = first
                .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, (q) => (/^[A-Za-z_$][\w$.]{0,39}$/.test(q.slice(1, -1)) ? q : `${q[0]}…${q[0]}`))
                .replace(/\b(?:https?|blob|file|data):\S+/g, '<url>')
                .replace(/\S*[/\\]\S*/g, '<path>')
                .replace(/\bB0[0-9A-Z]{8}\b/g, '<id>')
                .replace(/\d{5,}/g, '<n>')
                .trim();
        } else {
            const hit = ERR_REPORT_OWN_KEEP.map((re) => re.exec(first)).find(Boolean);
            if (hit) {
                const code = /^[^A-Za-z0-9]{0,3}([1-5]\d{2})(?!\d)/.exec(first.slice(hit[0].length));
                line = hit[0] + (code ? ` ${code[1]}` : '');
            }
        }
        return `${name}: ${line || ERR_REPORT_HIDDEN}`.slice(0, 120);
    }

    function errorFingerprint(s) {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36);
    }

    // 同じエラー (画面名＋先頭行) を今日すでに送っていれば false。送ってよければ記録して true。
    function markErrorReported(fp) {
        try {
            const d = new Date();
            const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            let st = null;
            try { st = JSON.parse(localStorage.getItem(ERR_REPORT_STORE) || 'null'); } catch (_) { st = null; }
            if (!st || st.day !== day || !Array.isArray(st.sent)) st = { day, sent: [] };
            if (st.sent.includes(fp) || st.sent.length >= ERR_REPORT_MAX_PER_DAY) return false;
            st.sent.push(fp);
            localStorage.setItem(ERR_REPORT_STORE, JSON.stringify(st));
            return true;
        } catch (_) { return false; }   // 記録できない環境では送らない (1日1回を守れないため)
    }

    function reportUnexpectedError(err, filename) {
        try {
            if (!errorReportEnabled()) return;
            if (!fromOwnScript(filename, err)) return;
            const msg = errorLine(err);
            if (!msg) return;
            const screen = screenName();
            if (!markErrorReported(errorFingerprint(`${screen}|${msg}`))) return;
            fetch(ERR_REPORT_URL, {
                method: 'POST',
                // text/plain = preflight の要らない単純リクエスト (受け口は本文を JSON として読む)
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: JSON.stringify({ v: appVersion(), screen, msg }),
                credentials: 'omit',
                keepalive: true,
                referrerPolicy: 'no-referrer'
            }).catch(() => { /* 再送しない */ });
        } catch (_) { /* 報告の失敗でアプリを止めない */ }
    }

    window.addEventListener('error', (e) => {
        if (!(e instanceof ErrorEvent) || e.target !== window) return;
        // ResizeObserver のループ通知 (新文言 "...undelivered notifications."・旧文言
        // "...loop limit exceeded") は Chromium/WebKit 共通の無害なブラウザ標準警告で、
        // レイアウト変化が多い操作 (モーダル開閉・トースト表示等) で偶発的に発生するだけで
        // 実害は無い。本物の例外と区別せず toast にすると公開成功時等に誤って「予期しない
        // エラー」を出してしまう (イシュー#349・tests/e2e/publish-article-editor.spec.js の
        // フレーク原因として実測)。toast は出さず、調査用に1行だけ残す。
        if (/^ResizeObserver loop/.test(e.message)) { console.debug('[ui-feedback] ResizeObserver loop通知を抑制:', e.message); return; }
        notifyUnexpectedError();
        reportUnexpectedError(e.error, e.filename);
    });
    window.addEventListener('unhandledrejection', (e) => {
        notifyUnexpectedError();
        reportUnexpectedError(e && e.reason, null);
    });
})();
