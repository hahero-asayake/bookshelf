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

    const TYPE_ICON = {
        info: 'info',
        success: 'check-circle-2',
        warn: 'alert-triangle',
        error: 'alert-octagon'
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

    window.toast = function toast(message, { type } = {}) {
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
        if (resolved === 'error') {
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'toast-close';
            close.title = '閉じる';
            close.innerHTML = renderIconSafe('x', 14) || '×';
            close.addEventListener('click', remove);
            item.appendChild(close);
            setTimeout(remove, 6000);
        } else {
            setTimeout(remove, 4000);
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

            const done = (result) => {
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                resolve(result);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.stopPropagation(); done(false); }
                if (e.key === 'Enter') { e.stopPropagation(); done(true); }
            };
            okBtn.addEventListener('click', () => done(true));
            cancelBtn.addEventListener('click', () => done(false));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
            document.addEventListener('keydown', onKey, true);

            document.body.appendChild(overlay);
            okBtn.focus();
        });
    };
})();
