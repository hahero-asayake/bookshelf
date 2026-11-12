// 記事の通報 (js/screens/report.js)
// イシュー#547 (U8f): bookshelf.js の VirtualBookshelf が持っていた記事通報(ADR-099・全件手動審査)
// 専用メソッド11個を、ここへ移した(移動のみ・本文は1行も書き換えていない)。U8a(#537)の時点では
// 「公開の一覧ではない別の機能」として bookshelf.js に残されていたが、どの画面ファイルにも属して
// いなかったため、U8f で独立の画面ファイルとして切り出した(②指示・docs/char/u8f-step1-scope.md §2)。
//
// 取り付け方 (Plan A・docs/char/u7-step1-scope.md §7と同じ形):
// 下の class 本体に書いたメソッドは、匿名クラスの prototype から記述子を取り出し、
// VirtualBookshelf.prototype へそのまま上書き定義する。class構文のまま(オブジェクトリテラルの
// カンマ区切りに変換しない)なので、各メソッドの見出し・本体は元のbookshelf.jsと一字一句同じ。
// 呼ばれる時の this は今までと同じ VirtualBookshelf インスタンスを指す
// (window.bookshelf.openReportModal(...) などは無変更で動く・テストの直接呼び出しも同様)。
//
// 依存の前提(実測・docs/char/u8f-step1-scope.md §2):
//  - VirtualBookshelf 側に残る共通基盤をそのまま this. 経由で呼ぶ: this._overlays() / this._surface() /
//    this._formBackGuard / this._formSnapTake / this._confirmOpenSettings
//  - グローバル(script読み込み順で既に存在): document / location / history / sessionStorage / fetch /
//    SyncConfigManager / toast
//  - setupEventListeners()(bookshelf.js側に残る)が closeReportModal/_submitReport/_loadReportReview/
//    _reportReviewAct を this.xxx で配線する・_navReopen(bookshelf.js側)が openReportModal(st.url) を
//    'report-modal' の開き直し先として呼ぶ・settings.js が _handleReportParam/_loadReportReview を呼ぶ
//    ・いずれも呼び方は無変更(Plan Aのため定義場所に依存しない)。
//
// 移さなかったもの: renderBookshelfOverview(ホームの概観・到達不能no-op)は通報とは無関係な機能の
// ため混在させず、bookshelf.js に残した(plugin-api.js:343 からの動的呼び出し=プラグイン契約である
// ことも理由・②指示・docs/char/u8f-step1-scope.md §3)。

class _ReportMethods {
    // ===== 記事の通報 (ADR-099・全件手動審査) =====
    // 公開記事フッタの「通報」リンクは https://asayake.org/bookshelf/?report=<記事URL>。ルーターはハッシュ専用のため query は衝突しない。
    // 初めてアプリを開く人は SW 初回登録の controllerchange で自動リロードされる (index.html の swRefreshing)。
    // ?report= は URL から除去済みなのでリロードでダイアログが消える → sessionStorage に退避し、閉じるまで起動時に開き直す。
    _handleReportParam() {
        if (this._reportParamHandled) return;
        let params;
        try { params = new URLSearchParams(location.search); } catch (_) { return; }
        let target = params.get('report');
        if (target) {
            this._pendingReportSet(target);
            try {   // 閉じた後のリロードで再表示しない。段階③: 台帳の写し (history.state) は保つ (H4)
                params.delete('report');
                const qs = params.toString();
                history.replaceState(this.nav ? history.state : null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
            } catch (_) {}
        } else {
            target = this._pendingReportGet();
        }
        if (!target) return;
        this._reportParamHandled = true;
        this.openReportModal(target);
    }

    // 通報対象の退避 (sessionStorage・タブ限り)。TTL 内かつダイアログを閉じる前のリロードだけを救う。
    _pendingReportSet(url) {
        try { sessionStorage.setItem('bookshelf.pendingReport', JSON.stringify({ url, at: Date.now() })); } catch (_) {}
    }

    _pendingReportGet() {
        try {
            const v = JSON.parse(sessionStorage.getItem('bookshelf.pendingReport') || 'null');
            return v && typeof v.url === 'string' && Date.now() - v.at < 10 * 60 * 1000 ? v.url : null;
        } catch (_) { return null; }
    }

    _pendingReportClear() {
        try { sessionStorage.removeItem('bookshelf.pendingReport'); } catch (_) {}
    }

    async openReportModal(articleUrl) {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) {
            await this._confirmOpenSettings('通報には Asayake アカウントへのログインが必要です。設定の「アカウント」でログインしてから、もう一度通報のリンクを開いてください。', 'account-section');
            this._pendingReportClear();   // 案内が解決するまでは残す (案内表示中のリロードで再表示するため)
            return;
        }
        const url = String(articleUrl || '').trim();
        if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 500) { this._pendingReportClear(); toast('通報の対象を読み取れませんでした。記事のページから、もう一度リンクを開いてください。', { type: 'error' }); return; }
        const modal = document.getElementById('report-modal');
        if (!modal) { this._pendingReportClear(); return; }
        this._reportTarget = url;
        document.getElementById('report-target-url').textContent = url;
        document.getElementById('report-category').value = '';
        document.getElementById('report-reason').value = '';
        this._setReportError('');
        this._overlays().open(modal, { kind: 'modal', size: 'md', hist: false }); // 重なり管理役 (イシュー#367 step5): md
        this._surface().open('report-modal', { close: (o) => this._formBackGuard('report-modal', o, (oo) => this.closeReportModal(oo)), extra: { url } });
        this._formSnapTake('report-modal');
    }

    closeReportModal({ fromHistory = false } = {}) {
        const modal = document.getElementById('report-modal');
        this._overlays().close('report-modal', { reason: fromHistory ? 'history' : 'button' });
        this._pendingReportClear();
        this._surface().close('report-modal', { fromHistory });
    }

    _setReportError(msg) {
        const el = document.getElementById('report-error');
        if (!el) return;
        el.textContent = msg || '';
        el.hidden = !msg;
    }

    async _submitReport() {
        const hub = (SyncConfigManager.load().hub) || {};
        const category = (document.getElementById('report-category') || {}).value || '';
        const reason = ((document.getElementById('report-reason') || {}).value || '').trim();
        if (!(hub.key && hub.apiBase)) { this._setReportError('ログインが切れています。設定の「アカウント」でログインし直してください。'); return; }
        if (!category) { this._setReportError('通報の種類を選んでください。'); return; }
        const btn = document.getElementById('report-submit');
        if (btn) btn.disabled = true;   // 二度押し防止 (ui-standards §2-6)
        this._setReportError('');
        try {
            const res = await fetch(`${hub.apiBase}/community/report`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${hub.key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ articleUrl: this._reportTarget, category, reason })
            });
            if (res.status === 404) { this._setReportError('対象の記事が見つかりませんでした。すでに一覧から外れているか、ハブで公開された記事ではありません。'); return; }
            if (res.status === 429) { this._setReportError('本日の通報の上限に達しました。明日もう一度お試しください。'); return; }
            if (res.status === 401) { this._setReportError('ログインが切れています。設定の「アカウント」でログインし直してください。'); return; }
            if (res.status === 400) { this._setReportError('この記事は通報できません（自分の記事、または入力の不備です）。'); return; }
            if (!res.ok) { this._setReportError('通報を送れませんでした。時間をおいて、もう一度お試しください。'); return; }
            const data = await res.json().catch(() => ({}));
            this.closeReportModal();
            toast(data.duplicate ? 'この記事はすでに通報済みです。' : '通報を受け付けました。返信はしませんが、内容を確認します。', { type: 'success' });
        } catch (e) {
            console.error('通報の送信に失敗:', e);
            this._setReportError('通報を送れませんでした。通信状況を確認して、もう一度お試しください。');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // 管理者: 通報の審査パネル (設定→管理者・#409)。一覧・一覧から外す・一覧に戻す・却下。
    async _loadReportReview() {
        const hub = (SyncConfigManager.load().hub) || {};
        const list = document.getElementById('report-review-list');
        if (!list || !(hub.key && hub.apiBase)) return;
        this._reportReviewLoadedAt = Date.now();
        try {
            const res = await fetch(`${hub.apiBase}/admin/reports?status=open`, { headers: { 'Authorization': `Bearer ${hub.key}` } });
            if (!res.ok) throw new Error(String(res.status));
            this._renderReportReview(await res.json());
        } catch (e) {
            this._reportReviewLoadedAt = 0;
            list.textContent = '通報の一覧を読み込めませんでした。「一覧を更新」でもう一度お試しください。';
        }
    }

    _renderReportReview(data) {
        const list = document.getElementById('report-review-list');
        if (!list) return;
        const LABEL = { spam: 'スパム', abuse: '誹謗中傷', illegal: '違法', discrimination: '差別', dead: 'リンク切れ', other: 'その他' };
        list.textContent = '';
        const mk = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
        const item = (a, hiddenItem) => {
            const row = mk('div', 'report-item');
            row.dataset.articleId = a.articleId;
            const t = mk('div', 'report-item-title');
            const link = mk('a', '', a.title || a.url);
            link.href = a.url; link.target = '_blank'; link.rel = 'noopener';
            t.appendChild(link);
            row.appendChild(t);
            if (hiddenItem) row.appendChild(mk('div', 'report-item-meta', '一覧から外し中'));
            else {
                const cats = Object.entries(a.categories || {}).map(([k, n]) => `${LABEL[k] || k} ${n}`).join('・');
                row.appendChild(mk('div', 'report-item-meta', `通報 ${a.count} 件（${cats}）`));
                if (a.latestReason) row.appendChild(mk('div', 'report-item-reason', a.latestReason));
            }
            const actions = mk('div', 'report-item-actions');
            const add = (act, label, cls) => {
                const b = mk('button', `btn ${cls} btn-small`, label);
                b.type = 'button'; b.dataset.act = act; b.dataset.articleId = a.articleId;
                if (a.reportIds) b.dataset.reportIds = a.reportIds.join(',');
                actions.appendChild(b);
            };
            if (hiddenItem) add('restore', '一覧に戻す', 'btn-secondary');
            else { add('hide', '一覧から外す', 'btn-danger'); add('dismiss', '却下', 'btn-secondary'); }
            row.appendChild(actions);
            return row;
        };
        const reports = data.reports || [], hidden = data.hidden || [];
        if (!reports.length && !hidden.length) { list.appendChild(mk('p', 'account-admin-hint', '未対応の通報はありません。')); return; }
        for (const a of reports) list.appendChild(item(a, false));
        for (const h of hidden) list.appendChild(item(h, true));
    }

    async _reportReviewAct(btn) {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) return;
        const act = btn.dataset.act, id = btn.dataset.articleId;
        const call = (path) => fetch(`${hub.apiBase}${path}`, { method: 'POST', headers: { 'Authorization': `Bearer ${hub.key}`, 'Content-Type': 'application/json' }, body: '{}' });
        const row = btn.closest('.report-item');
        row.querySelectorAll('button').forEach(b => { b.disabled = true; });   // 二度押し防止
        try {
            if (act === 'dismiss') {
                for (const rid of (btn.dataset.reportIds || '').split(',').filter(Boolean)) {
                    const r = await call(`/admin/reports/${encodeURIComponent(rid)}/dismiss`);
                    if (!r.ok) throw new Error(String(r.status));
                }
            } else {
                const r = await call(`/admin/articles/${encodeURIComponent(id)}/${act === 'hide' ? 'hide' : 'restore'}`);
                if (!r.ok) throw new Error(String(r.status));
            }
            toast(act === 'hide' ? '記事を一覧から外しました。' : (act === 'restore' ? '記事を一覧に戻しました。' : '通報を却下しました。'), { type: 'success' });
            await this._loadReportReview();
        } catch (e) {
            console.error('通報の審査操作に失敗:', e);
            toast('操作できませんでした。時間をおいて、もう一度お試しください。', { type: 'error' });
            row.querySelectorAll('button').forEach(b => { b.disabled = false; });
        }
    }
}

const _reportDescriptors = Object.getOwnPropertyDescriptors(_ReportMethods.prototype);
delete _reportDescriptors.constructor;
Object.defineProperties(VirtualBookshelf.prototype, _reportDescriptors);
