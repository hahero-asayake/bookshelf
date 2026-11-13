// 設定画面 (js/screens/settings.js)
// イシュー#537 (U8a): bookshelf.js の VirtualBookshelf が持っていた設定モーダル専用メソッド97個
// (骨格10 + ヘッダーカスタマイズ19 + プラグイン一覧/マーケット16 + 同期・GitHub・Hub・アカウントの
// 画面側52 = 97。範囲の確定は docs/char/u8a-step1-scope.md §1) を、ここへ移した
// (移動のみ・本文は1行も書き換えていない)。
//
// イシュー#544 (U8a補完): U8aの棚卸しが見落としていたプラグイン管理5件
// (_renderPluginsList/_refreshPluginCardStatus/installPluginFromInput/togglePlugin/
// uninstallPluginById。範囲の確定は docs/char/u8a2-step1-scope.md) を追加で移した
// (移動のみ・本文は1行も書き換えていない)。同じ7件のうちshowPluginsModal/closePluginsModalは
// 呼び出し元0件・対応モーダルDOMも無いデッドコードのため、bookshelf.jsから削除した(移していない)。
//
// 取り付け方 (Plan A・U7(article-editor.js)と同じ形・docs/char/u7-step1-scope.md §7参照):
// 下の class 本体に書いたメソッドは、匿名クラスの prototype から記述子を取り出し、
// VirtualBookshelf.prototype へそのまま上書き定義する。class構文のまま(オブジェクトリテラルの
// カンマ区切りに変換しない)なので、各メソッドの見出し・本体は元のbookshelf.jsと一字一句同じ。
// 呼ばれる時の this は今までと同じ VirtualBookshelf インスタンスを指す
// (window.bookshelf._openSettingsModal(...) などは無変更で動く・テストの直接呼び出しも同様)。
//
// 依存一覧(足場・docs/char/u8a-step1-scope.md §3を参照):
//  - VirtualBookshelf 側に残した、設定画面専用ではないメソッド・static:
//    openIconPicker (汎用アイコンピッカー・本棚フォーム等からも呼ばれる共有部品。
//    tests/e2e/standard-ops.spec.js:588 が bookshelf.openIconPicker を直接呼ぶ)
//    _placeAnchoredMenu・_openMdEditor/_mde*群 (記事エディタ・長文メモ共有。設定画面からは
//    呼ばれていない・実測済み＝今回は js/ui/ へ出さない。docs/char/u8a-step1-scope.md §7)
//    static HEADER_ICON_OVERRIDES_KEY・static SETTINGS_CATEGORIES
//    (VirtualBookshelf クラス自身の static プロパティのため Plan A では移せない。U7の
//    ART_LOCAL_DRAFT_PREFIX等と同じ扱い＝bookshelf.js側に残し、このファイルは
//    VirtualBookshelf.HEADER_ICON_OVERRIDES_KEY / VirtualBookshelf.SETTINGS_CATEGORIES として
//    グローバル経由でそのまま参照する。index.htmlの読み込み順はbookshelf.js→settings.jsなので解決される)
//  - 同期の実行コア(画面ではない・bookshelf.js側に残る・今回は移さない):
//    initSync/initCloudSync/initGitHubSync/initObsidianSync/loadFromObsidianFile/
//    syncToObsidianFolder/flushSync/_runPendingSync/_scheduleSync/saveUserData/
//    updateSyncStatus 等(docs/char/u8a-step1-scope.md §2参照)。設定画面側のボタンハンドラ
//    (_connectToGitHub・_saveGitHubRepo・_useHub・_disconnectHub 等)は、接続設定を保存して
//    location.reload() するだけで、実データの読み込みは起動シーケンス側のこれらのコアが行う
//  - VirtualBookshelf のコンストラクタに設定系メソッドの初期代入は含まれていない(他は未確認。
//    U7では確認済みだったが、このイシューでは踏査していない＝次段の課題)
//  - VirtualBookshelf 側の状態・入れ物(thisのまま読む): this.userData / this.pluginLoader /
//    this._isSyncReady / this.storage / this.bookManager / this.bookshelfManager /
//    this._surface() / SyncConfigManager(static import) / confirmDialog / toast
//  - プラグインとの橋: window.bookshelfAPI 経由ではなく、plugin-api.js が直接
//    window.bookshelf._getPluginIconOverride(pluginId) / window.bookshelf._applyHeaderLayout() を
//    呼ぶ(js/plugin-api.js:461-462/491-492)。ファイルを分けても呼び方は変わらないため影響なし
//  - 他画面からこの一覧の名前を直接読み書きする箇所(bookshelf.js側・js/ui/側に残る・無変更で動く):
//    js/ui/surface.js:130/145 が h._bindSettingsPopstate() を直接呼ぶ(コメント27行目に明記)。
//    一覧は docs/char/u8a-step1-scope.md §4 参照

class _SettingsMethods {
    // 保存先セレクトで選んだ方式のパネルだけを出す
    _showSyncPanel(method) {
        const localPanel = document.getElementById('sync-config-local');
        const githubPanel = document.getElementById('sync-config-github');
        const hubPanel = document.getElementById('sync-config-hub');
        if (localPanel) localPanel.hidden = (method !== 'local');
        if (githubPanel) githubPanel.hidden = (method !== 'github');
        if (hubPanel) hubPanel.hidden = (method !== 'hub');
        // ハブパネルを開いた時は状態を再描画 (未ログインなら節内 GIS ボタンを遅延描画)
        if (method === 'hub') this._renderHubAuthState();
    }

    // 保存先セレクトの表示を、保存してある設定に合わせる。起動時と、ローカルのフォルダを
    // 保存先の設定に記録した時 (_recordLocalSyncChoice) に呼ぶ (イシュー#592)。
    _applySyncMethodView() {
        const selector = document.getElementById('sync-method-select');
        if (!selector) return;
        const localUnsupported = !('showDirectoryPicker' in window);
        const config = this.syncConfig || SyncConfigManager.load();
        let viewMethod = config.method || 'local';
        // まだ保存先を決めていない人には、いちばん簡単なハブを最初に見せる (ADR-056 ハブ推し。
        // GitHub は上級者向け)。実 method (この端末だけのキャッシュ動作) は据え置き。
        // local 非対応環境 (モバイル等) で local 表示になる場合も同様にハブへ寄せる。
        if (!SyncConfigManager.isConfigured()) viewMethod = 'hub';
        else if (localUnsupported && viewMethod === 'local') viewMethod = 'hub';
        selector.value = viewMethod;
        this._showSyncPanel(viewMethod);
    }

    _setupSyncMethodUI() {
        const selector = document.getElementById('sync-method-select');
        const localPanel = document.getElementById('sync-config-local');
        const githubPanel = document.getElementById('sync-config-github');
        if (!selector || !localPanel || !githubPanel) return;

        // ローカル保存は PC (Chrome/Edge) 限定。showDirectoryPicker 非対応環境 (モバイル /
        // Firefox / Safari) では行き止まりを避けるため local オプションを選べなくする。
        // Android ネイティブ (Capacitor/APK) は廃止 → モバイルの保存先は GitHub / ハブの 2 択。
        const localUnsupported = !('showDirectoryPicker' in window);
        if (localUnsupported) {
            const localOpt = selector.querySelector('option[value="local"]');
            if (localOpt) localOpt.disabled = true;
        }

        const showPanel = (method) => this._showSyncPanel(method);
        this._applySyncMethodView();

        this._renderGitHubAuthState();
        this._renderHubAuthState();
        this._setupHubUI();

        selector.addEventListener('change', async () => {
            const newMethod = selector.value;
            showPanel(newMethod);
            const current = (this.syncConfig && this.syncConfig.method) || 'local';
            if (newMethod === 'local' && current !== 'local') {
                // イシュー#518: confirmDialog は Promise のため、確認待ち中にセレクタを
                // 再操作できないよう disabled にする (棚卸しの「守り方」どおり)。
                selector.disabled = true;
                const ok = await window.confirmDialog({ message: '保存先を「この端末のフォルダ」に切り替えますか？\nGitHub の接続情報はそのまま残ります。\nOK を押すとページを再読み込みします。' });
                selector.disabled = false;
                if (ok) {
                    SyncConfigManager.setMethod('local');
                    location.reload();
                } else {
                    selector.value = current;
                    showPanel(current);
                }
            }
        });

        const connectBtn = document.getElementById('github-connect-btn');
        if (connectBtn) connectBtn.addEventListener('click', () => this._connectToGitHub());

        const cancelBtn = document.getElementById('github-cancel-auth-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this._cancelGitHubAuth());

        const copyBtn = document.getElementById('github-copy-code-btn');
        if (copyBtn) copyBtn.addEventListener('click', () => this._copyDeviceCode());

        const disconnectBtn = document.getElementById('github-disconnect-btn');
        if (disconnectBtn) disconnectBtn.addEventListener('click', () => this._disconnectGitHub());

        const saveRepoBtn = document.getElementById('github-save-repo-btn');
        if (saveRepoBtn) saveRepoBtn.addEventListener('click', () => this._saveGitHubRepo());

        const reloadReposBtn = document.getElementById('github-reload-repos-btn');
        if (reloadReposBtn) reloadReposBtn.addEventListener('click', () => this._loadGitHubRepos());

        const reloadAfterInstallBtn = document.getElementById('github-reload-after-install-btn');
        if (reloadAfterInstallBtn) reloadAfterInstallBtn.addEventListener('click', () => this._loadGitHubRepos());

        const publishRepoSel = document.getElementById('publish-repo-select');
        if (publishRepoSel) publishRepoSel.addEventListener('change', () => this._onPublishRepoSelected());

        const publishTargetSel = document.getElementById('publish-target-select');
        if (publishTargetSel) {
            publishTargetSel.value = (SyncConfigManager.load().publish || {}).target || 'hub';   // 既定=ハブ (かんたん公開・2026-07-28)
            publishTargetSel.addEventListener('change', () => this._onPublishTargetSelected());
            this._reflectPublishTargetPanels(publishTargetSel.value);
        }

        // basePath ブラウザ
        const browseBtn = document.getElementById('github-basepath-browse-btn');
        if (browseBtn) browseBtn.addEventListener('click', () => this._openBasepathBrowser());

        const upBtn = document.getElementById('basepath-up-btn');
        if (upBtn) upBtn.addEventListener('click', () => {
            const cur = this._basepathCurrentPath || '';
            const parts = cur.split('/').filter(Boolean);
            parts.pop();
            this._loadBasepathBrowser(parts.join('/'));
        });

        const applyBtn = document.getElementById('basepath-apply-btn');
        if (applyBtn) applyBtn.addEventListener('click', () => {
            const input = document.getElementById('github-base-path');
            if (input) input.value = this._basepathCurrentPath || '';
            const browser = document.getElementById('github-basepath-browser');
            if (browser) {
                browser.open = false;
                browser.hidden = true;
            }
        });

        // GitHub App インストールリンク
        const installLink = document.getElementById('github-install-link');
        if (installLink) {
            const appUrl = GitHubDeviceAuth.getAppPublicUrl();
            if (appUrl) installLink.href = appUrl;
            else installLink.removeAttribute('href');

            // install link クリック後にこのタブへ戻ってきたら自動で再取得
            // (反映ラグ対策: GitHub 側の install 反映に少しラグがあるので focus から少し待って実行)
            installLink.addEventListener('click', () => {
                this._pendingInstallReloadAt = Date.now();
                const status = document.getElementById('github-status');
                if (status) status.textContent = 'インストール完了後、このタブに戻ると自動で再取得します';
            });
        }

        // window focus 検知: 直近 10 分以内に install link を押していたら自動再取得
        if (!this._githubFocusBound) {
            this._githubFocusBound = true;
            window.addEventListener('focus', () => {
                const pendingAt = this._pendingInstallReloadAt || 0;
                if (!pendingAt) return;
                if (Date.now() - pendingAt > 10 * 60 * 1000) {
                    this._pendingInstallReloadAt = 0;
                    return;
                }
                const settingsModal = document.getElementById('settings-modal');
                if (!settingsModal || !settingsModal.classList.contains('show')) return;
                this._pendingInstallReloadAt = 0;
                const status = document.getElementById('github-status');
                if (status) status.textContent = '戻りました、3秒後に再取得します...';
                setTimeout(() => {
                    if (status) status.textContent = '再取得中...';
                    this._loadGitHubRepos();
                }, 3000);
            });
        }
    }

    _openBasepathBrowser() {
        const browser = document.getElementById('github-basepath-browser');
        if (!browser) return;
        browser.hidden = false;
        browser.open = true;
        const startPath = (document.getElementById('github-base-path')?.value || '').trim();
        this._loadBasepathBrowser(startPath);
    }

    async _loadBasepathBrowser(path) {
        this._basepathCurrentPath = path || '';
        const curEl = document.getElementById('basepath-current');
        const listEl = document.getElementById('basepath-browser-list');
        if (curEl) curEl.textContent = '/' + (this._basepathCurrentPath || '');
        if (!listEl) return;
        listEl.innerHTML = '<li>(取得中...)</li>';

        const config = SyncConfigManager.load();
        const token = config.github && config.github.token;
        const fullSel = document.getElementById('github-repo-select');
        const fullName = fullSel ? fullSel.value : '';
        if (!fullName || !token) {
            listEl.innerHTML = '<li>(まず repo を選択してください)</li>';
            return;
        }
        const [owner, repo] = fullName.split('/');
        const branchSel = document.getElementById('github-branch-select');
        const branch = (branchSel && branchSel.value) || 'main';
        const segments = (this._basepathCurrentPath || '').split('/').filter(Boolean);
        const encodedPath = segments.map(encodeURIComponent).join('/');
        const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
        try {
            const res = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });
            if (res.status === 404) {
                listEl.innerHTML = '<li>(空)</li>';
                return;
            }
            if (!res.ok) throw new Error(await this._ghErrorDetail(res));
            const items = await res.json();
            if (!Array.isArray(items)) {
                listEl.innerHTML = '<li>(これはディレクトリではなくファイルです)</li>';
                return;
            }
            items.sort((a, b) => {
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === 'dir' ? -1 : 1;
            });
            listEl.innerHTML = '';
            if (items.length === 0) {
                listEl.innerHTML = '<li>(空)</li>';
                return;
            }
            for (const item of items) {
                const li = document.createElement('li');
                if (item.type === 'dir') {
                    li.classList.add('basepath-dir');
                    const a = document.createElement('a');
                    a.href = '#';
                    a.textContent = `${item.name}`;
                    a.addEventListener('click', (e) => {
                        e.preventDefault();
                        this._loadBasepathBrowser(item.path);
                    });
                    li.appendChild(a);
                } else {
                    li.classList.add('basepath-file');
                    const span = document.createElement('span');
                    span.textContent = `📄 ${item.name}`;
                    li.appendChild(span);
                }
                listEl.appendChild(li);
            }
        } catch (e) {
            listEl.innerHTML = `<li>(取得失敗: ${BookshelfEscape.escapeHtml(e.message)})</li>`;
        }
    }

    _renderGitHubAuthState() {
        const disc = document.getElementById('github-auth-disconnected');
        const pend = document.getElementById('github-auth-pending');
        const conn = document.getElementById('github-auth-connected');
        if (!disc || !pend || !conn) return;

        const config = SyncConfigManager.load();
        const token = config.github && config.github.token;
        const login = config.github && config.github.login;

        if (token) {
            disc.hidden = true;
            pend.hidden = true;
            conn.hidden = false;
            const loginEl = document.getElementById('github-connected-login');
            if (loginEl) loginEl.textContent = login || '(ユーザ取得中)';
            const g = config.github || {};
            const basePathEl = document.getElementById('github-base-path');
            if (basePathEl) basePathEl.value = g.basePath || '';
            // repo / branch select はリストを GitHub から取得して詰める
            this._loadGitHubRepos();
        } else {
            disc.hidden = false;
            pend.hidden = true;
            conn.hidden = true;
        }
    }

    async _loadGitHubRepos() {
        const sel = document.getElementById('github-repo-select');
        const branchSel = document.getElementById('github-branch-select');
        const installPrompt = document.getElementById('github-install-prompt');
        if (!sel) return;
        await this._ensureFreshGitHubToken();
        const token = (SyncConfigManager.load().github || {}).token;
        if (!token) return;
        sel.innerHTML = '<option value="">(取得中...)</option>';
        if (branchSel) branchSel.innerHTML = '<option value="">(repo 選択後に取得)</option>';
        try {
            const { installations, repos } = await this._fetchAccessibleRepos(token);
            if (installations.length === 0) {
                sel.innerHTML = '<option value="">(GitHub App 未インストール)</option>';
                if (installPrompt) installPrompt.hidden = false;
                if (this.syncMethod === 'github') {   // GitHub が現在の同期先のときだけ上部バーに反映
                    this._syncError = true;
                    this._syncErrorMsg = 'GitHub App が未インストールです。アプリをインストールしてください。';
                    this._updateStatusBar();
                }
                return;
            }
            if (installPrompt) installPrompt.hidden = true;
            repos.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
            const current = SyncConfigManager.load().github || {};
            const currentFull = current.owner && current.repo ? `${current.owner}/${current.repo}` : '';
            sel.innerHTML = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = repos.length === 0
                ? '— インストール済みだが、選択可能な repo がありません —'
                : '— リポジトリを選択 —';
            sel.appendChild(placeholder);
            for (const r of repos) {
                const opt = document.createElement('option');
                opt.value = r.full_name;
                opt.textContent = `${r.full_name}${r.private ? ' ' : ''}`;
                opt.dataset.defaultBranch = r.default_branch;
                if (r.full_name === currentFull) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.onchange = () => this._onGitHubRepoSelected();
            this._populatePublishRepoSelect(repos);
            if (currentFull && repos.some(r => r.full_name === currentFull)) {
                await this._loadGitHubBranches(currentFull, current.branch);
            }
            if (this.syncMethod === 'github') {       // 取得成功 → 同期エラー解消 (GitHub が同期先のとき)
                this._syncError = false;
                this._syncErrorMsg = '';
                this._updateStatusBar();
            }
        } catch (e) {
            const msg = e.message || String(e);
            sel.innerHTML = `<option value="">(取得失敗: ${msg})</option>`;
            // 権限系エラーは GitHub の反映ラグの可能性が高い
            if (/not accessible|forbidden|permission/i.test(msg) && installPrompt) {
                installPrompt.hidden = false;
            }
            // 取得失敗 (401 Bad credentials 等) は同期エラーとして上部バーに出す (GitHub が同期先のとき)
            if (this.syncMethod === 'github') {
                this._syncError = true;
                this._syncErrorMsg = /401|bad credential|invalid|token|unauthor/i.test(msg)
                    ? 'GitHub のトークンが無効です。再接続してください。'
                    : 'GitHub の保存先を取得できません。';
                this._updateStatusBar();
            }
        }
    }

    async _onGitHubRepoSelected() {
        const sel = document.getElementById('github-repo-select');
        if (!sel || !sel.value) return;
        await this._loadGitHubBranches(sel.value);
    }

    // 公開先リポジトリのセレクタを、同期 repo 一覧と同じ accessible repos で埋める (T09)
    _populatePublishRepoSelect(repos) {
        const sel = document.getElementById('publish-repo-select');
        if (!sel) return;
        const cur = SyncConfigManager.load().publish || {};
        const curFull = cur.owner && cur.repo ? `${cur.owner}/${cur.repo}` : '';
        sel.innerHTML = '';
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = '— 公開先リポジトリを選択 —';
        sel.appendChild(ph);
        for (const r of repos) {
            const opt = document.createElement('option');
            opt.value = r.full_name;
            opt.textContent = `${r.full_name}${r.private ? ' （非公開・公開不可）' : ''}`;
            opt.dataset.defaultBranch = r.default_branch || 'main';
            opt.dataset.private = r.private ? '1' : '';
            if (r.full_name === curFull) opt.selected = true;
            sel.appendChild(opt);
        }
        // 設定済みだが一覧に無い (App のアクセス対象に未追加) 場合も選択を保持しつつ警告
        if (curFull && !repos.some(r => r.full_name === curFull)) {
            const opt = document.createElement('option');
            opt.value = curFull;
            opt.textContent = `${curFull}（アプリのアクセス対象に未追加？）`;
            opt.selected = true;
            sel.appendChild(opt);
        }
        this._reflectPublishRepoStatus();
    }

    _onPublishRepoSelected() {
        const sel = document.getElementById('publish-repo-select');
        if (!sel) return;
        const full = sel.value;
        const cfg = SyncConfigManager.load();
        if (!full) {
            cfg.publish = { ...(cfg.publish || {}), owner: '', repo: '' };
            SyncConfigManager.save(cfg);
            this._reflectPublishRepoStatus();
            return;
        }
        const [owner, repo] = full.split('/');
        const opt = sel.selectedOptions[0];
        const branch = (opt && opt.dataset.defaultBranch) || 'main';
        cfg.publish = { ...(cfg.publish || {}), owner, repo, branch };
        SyncConfigManager.save(cfg);
        this._reflectPublishRepoStatus();
    }

    // 公開先 (github / hub) の選択を保存し、対応する設定ブロックを出し分ける
    _onPublishTargetSelected() {
        const sel = document.getElementById('publish-target-select');
        if (!sel) return;
        const target = sel.value === 'hub' ? 'hub' : 'github';
        const cfg = SyncConfigManager.load();
        const last = (cfg.publish || {}).lastPublishedTarget;
        cfg.publish = { ...(cfg.publish || {}), target };
        SyncConfigManager.save(cfg);
        this._reflectPublishTargetPanels(target);
        this._reflectAffiliateField(); // 公開先で自分タグ入力の出し分けが変わる (github=プラン不問)
        // 旧公開先にサイトが残っている場合は警告 (自動削除はしない=手動クリーンアップ誘導)
        if (last && last !== target) {
            const name = (t) => t === 'hub' ? '共有（ハブ）' : '自分の GitHub リポジトリ';
            this._publishSwitchWarn = `以前の公開先「${name(last)}」にサイトが残っています。完全に消すには、公開先を「${name(last)}」に戻し、全ページを「公開を取り消す」で取り消してから再公開（空にする）してください。`;
            toast(this._publishSwitchWarn, { type: 'warn' });
        } else {
            this._publishSwitchWarn = '';
        }
        this._reflectPublishSwitchWarn();
    }

    // 公開先切替の残存警告を該当パネルに常設表示 (toast は消えるため)
    _reflectPublishSwitchWarn() {
        const el = document.getElementById('publish-switch-warn');
        if (!el) return;
        el.textContent = this._publishSwitchWarn || '';
        el.hidden = !this._publishSwitchWarn;
    }

    _reflectPublishTargetPanels(target) {
        const ghBlock = document.getElementById('publish-config-github');
        const hubBlock = document.getElementById('publish-config-hub');
        if (ghBlock) ghBlock.hidden = (target !== 'github');
        if (hubBlock) hubBlock.hidden = (target !== 'hub');
        // 自前公開 (GitHub) は索引に載らない (ADR-099)。選んでいる間はその旨を明示し、設定を見失わないよう折りたたみを開く
        const indexNote = document.getElementById('publish-index-note');
        if (indexNote) indexNote.hidden = (target !== 'github');
        const targetDetails = document.getElementById('publish-target-details');
        if (targetDetails && target === 'github') targetDetails.open = true;
        if (target === 'hub') this._reflectPublishHubStatus();
        this._reflectPublishSwitchWarn();
    }

    _reflectPublishHubStatus() {
        const status = document.getElementById('publish-hub-status');
        if (!status) return;
        const hub = (SyncConfigManager.load().hub) || {};
        if (hub.key && hub.apiBase) {
            const base = hub.bookshelfBase || hub.publicBase;
            status.textContent = base ? `公開 URL: ${base}` : 'Asayake ハブに接続済み';
        } else {
            status.textContent = '先に設定の「同期」で Asayake ハブにログインしてください。';
        }
    }

    _reflectPublishRepoStatus() {
        const sel = document.getElementById('publish-repo-select');
        const status = document.getElementById('publish-repo-status');
        if (!sel || !status) return;
        const opt = sel.selectedOptions[0];
        if (!sel.value) { status.textContent = ''; return; }
        if (opt && opt.dataset.private === '1') {
            status.textContent = '非公開リポジトリは公開モードで読めません。public を選んでください';
        } else {
            status.textContent = `公開先: ${sel.value}`;
        }
    }

    async _loadGitHubBranches(fullName, preferBranch) {
        const branchSel = document.getElementById('github-branch-select');
        if (!branchSel) return;
        const token = (SyncConfigManager.load().github || {}).token;
        if (!token) return;
        branchSel.innerHTML = '<option value="">(取得中...)</option>';
        try {
            const [owner, repo] = fullName.split('/');
            const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });
            if (!res.ok) throw new Error(await this._ghErrorDetail(res));
            const branches = await res.json();
            const repoSel = document.getElementById('github-repo-select');
            const opt = repoSel ? repoSel.selectedOptions[0] : null;
            const defaultBranch = opt ? (opt.dataset.defaultBranch || null) : null;
            branches.sort((a, b) => {
                if (a.name === defaultBranch) return -1;
                if (b.name === defaultBranch) return 1;
                return a.name.localeCompare(b.name);
            });
            branchSel.innerHTML = '';
            for (const b of branches) {
                const o = document.createElement('option');
                o.value = b.name;
                o.textContent = b.name === defaultBranch ? `${b.name} (default)` : b.name;
                if (b.name === preferBranch) o.selected = true;
                branchSel.appendChild(o);
            }
            if (!preferBranch && defaultBranch) branchSel.value = defaultBranch;
        } catch (e) {
            branchSel.innerHTML = `<option value="">(取得失敗: ${e.message})</option>`;
        }
    }

    // GitHub App 経由でアクセス可能なリポジトリのみ取得 (installation 経由)
    async _fetchAccessibleRepos(token) {
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
        const instRes = await fetch('https://api.github.com/user/installations?per_page=100', { headers });
        if (!instRes.ok) {
            throw new Error(`/user/installations: ${await this._ghErrorDetail(instRes)}`);
        }
        const instData = await instRes.json();
        const installations = instData.installations || [];
        const repos = [];
        for (const inst of installations) {
            let page = 1;
            while (page < 10) {
                const url = `https://api.github.com/user/installations/${inst.id}/repositories?per_page=100&page=${page}`;
                const res = await fetch(url, { headers });
                if (!res.ok) {
                    throw new Error(`/user/installations/${inst.id}/repositories: ${await this._ghErrorDetail(res)}`);
                }
                const data = await res.json();
                const batch = data.repositories || [];
                repos.push(...batch);
                if (batch.length < 100) break;
                page++;
            }
        }
        return { installations, repos };
    }

    async _ghErrorDetail(res) {
        let detail = `${res.status} ${res.statusText}`;
        try {
            const data = await res.json();
            if (data && data.message) detail += `: ${data.message}`;
        } catch (_) {}
        return detail;
    }

    async _connectToGitHub() {
        const disc = document.getElementById('github-auth-disconnected');
        const pend = document.getElementById('github-auth-pending');
        const codeEl = document.getElementById('github-user-code');
        const linkEl = document.getElementById('github-verification-link');
        const statusEl = document.getElementById('github-auth-pending-status');

        if (!GitHubDeviceAuth.isClientIdConfigured()) {
            toast('GitHub OAuth Client ID が未設定です。\nbookshelf 管理者に問い合わせるか、fork 時は自分の OAuth App を作成して js/github-auth.js の GITHUB_OAUTH_CLIENT_ID を置き換えてください。');
            return;
        }

        try {
            const device = await GitHubDeviceAuth.requestDeviceCode();
            this._currentDeviceAuth = { cancelled: false, device };

            if (disc) disc.hidden = true;
            if (pend) pend.hidden = false;
            if (codeEl) codeEl.textContent = device.user_code;
            if (linkEl) linkEl.href = device.verification_uri;
            if (statusEl) statusEl.textContent = 'GitHub で承認されるのを待っています...';

            const startedAt = Date.now();
            const token = await GitHubDeviceAuth.pollAccessToken(device, {
                shouldCancel: () => this._currentDeviceAuth && this._currentDeviceAuth.cancelled,
                onTick: (state) => {
                    if (!statusEl) return;
                    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
                    const base = state === 'slow'
                        ? 'GitHub が混雑中、間隔を伸ばします'
                        : 'GitHub で承認されるのを待っています';
                    statusEl.textContent = `${base}（${elapsedSec}秒経過）`;
                }
            });

            let user = null;
            try {
                user = await GitHubDeviceAuth.fetchUser(token.access_token);
            } catch (_) {
                // ユーザ取得失敗は致命的ではないので続行
            }

            const now = Date.now();
            const merged = SyncConfigManager.load();
            merged.method = 'github';
            merged.github = {
                ...(merged.github || {}),
                token: token.access_token,
                // 「Expire user authorization tokens」有効時のみ返る (8h 失効 + 自動 refresh 用)
                refreshToken: token.refresh_token || '',
                tokenExpiresAt: token.expires_in ? now + token.expires_in * 1000 : null,
                refreshTokenExpiresAt: token.refresh_token_expires_in ? now + token.refresh_token_expires_in * 1000 : null,
                login: user ? user.login : null
            };
            SyncConfigManager.save(merged);
            this._currentDeviceAuth = null;
            this._renderGitHubAuthState();
            toast(`GitHub に接続しました${user ? ` (${user.login})` : ''}。\n下のリストからリポジトリを選んで「この設定で使う」を押してください。`);
        } catch (e) {
            this._currentDeviceAuth = null;
            if (e.message === 'AUTH_CANCELLED') {
                this._renderGitHubAuthState();
                return;
            }
            if (e.message === 'AUTH_DENIED') {
                toast('GitHub での承認が拒否されました。');
            } else if (e.message === 'AUTH_EXPIRED') {
                toast('コードの有効期限が切れました。もう一度「接続」を押してください。');
            } else {
                toast(`GitHub 接続エラー:\n${e.message}`);
            }
            this._renderGitHubAuthState();
        }
    }

    _cancelGitHubAuth() {
        if (this._currentDeviceAuth) {
            this._currentDeviceAuth.cancelled = true;
        }
        this._renderGitHubAuthState();
    }

    async _copyDeviceCode() {
        const codeEl = document.getElementById('github-user-code');
        if (!codeEl) return;
        const text = codeEl.textContent.trim();
        try {
            await navigator.clipboard.writeText(text);
            const copyBtn = document.getElementById('github-copy-code-btn');
            if (copyBtn) {
                const orig = copyBtn.textContent;
                copyBtn.textContent = 'コピー済';
                setTimeout(() => { copyBtn.textContent = orig; }, 1500);
            }
        } catch (e) {
            console.warn('clipboard write failed:', e);
        }
    }

    async _disconnectGitHub() {
        const ok = await window.confirmDialog({ message: 'GitHub との接続を切断しますか？\n接続情報を削除し、保存先を「この端末のフォルダ」に戻します。', danger: true });
        if (!ok) return;
        const merged = SyncConfigManager.load();
        merged.method = 'local';
        if (merged.github) {
            merged.github = {
                ...merged.github,
                token: '',
                refreshToken: '',
                tokenExpiresAt: null,
                refreshTokenExpiresAt: null,
                login: null
            };
        }
        SyncConfigManager.save(merged);
        location.reload();
    }

    // ===== Asayake ハブ接続 UI (ADR-032/033) =====

    _renderHubAuthState() {
        const disc = document.getElementById('hub-auth-disconnected');
        const conn = document.getElementById('hub-auth-connected');
        if (!disc || !conn) return;
        const cfg = SyncConfigManager.load();
        const hub = cfg.hub || {};
        const connected = !!(hub.key && hub.apiBase);
        disc.hidden = connected;
        conn.hidden = !connected;
        if (connected) {
            const emailEl = document.getElementById('hub-connected-email');
            if (emailEl) emailEl.textContent = hub.email || '(接続済み)';
            this._renderHubUsageBar(hub);
            // 「ログイン済み」と「保存先として使用中」は別物。未適用なら 1 クリック確定を促す。
            const active = cfg.method === 'hub';
            const stateEl = document.getElementById('hub-active-state');
            if (stateEl) {
                stateEl.hidden = false;
                stateEl.classList.toggle('is-active', active);
                stateEl.innerHTML = active
                    ? '<span class="h-icon" data-icon="check-circle" data-icon-size="14"></span>この保存先を使用中です。'
                    : '<span class="h-icon" data-icon="alert-triangle" data-icon-size="14"></span>ログイン済みですが、まだ本のデータの保存先になっていません。下の<strong>「この設定で使う」</strong>を押すと切り替わります。';
                if (typeof window.applyIcons === 'function') window.applyIcons(stateEl);
            }
            const useBtn = document.getElementById('hub-use-btn');
            if (useBtn) {
                useBtn.disabled = active;
                useBtn.innerHTML = active
                    ? '<span class="h-icon" data-icon="check" data-icon-size="14"></span>使用中'
                    : '<span class="h-icon" data-icon="check" data-icon-size="14"></span>この設定で使う';
                if (typeof window.applyIcons === 'function') window.applyIcons(useBtn);
            }
        } else {
            this._renderHubDisconnected();
        }
    }

    // 未ログイン時のハブ節: 規約同意済みなら節内で直接 Google ログイン (旧来は死に配線だった
    // hub-gsi-button を有効化)、未同意ならアカウント節へ誘導する (規約同意 UI はそちらに集約)。
    _renderHubDisconnected() {
        const consented = !!(this.userData && this.userData.settings && this.userData.settings.ackTermsPrivacy);
        const host = document.getElementById('hub-gsi-button');
        const gotoBtn = document.getElementById('hub-goto-account');
        const msg = document.getElementById('hub-disc-msg');
        // [hidden] はグローバルに !important で構造保証済み (ui-standards §2-2・イシュー#231)。
        // style.display による個別回避はもう不要 → hidden の true/false だけで制御する。
        if (consented) {
            if (gotoBtn) gotoBtn.hidden = true;
            if (msg) msg.textContent = 'Google でログインすると、この端末でハブの保存データを使えます。';
            if (host) {
                host.hidden = false;
                // 外部 GIS スクリプトの実体化はハブパネルが実際に見えている時だけ。
                // ブート時 (_setupSyncMethodUI→_renderHubAuthState) の先読みを避ける (遅延読込方針)。
                // 未設定時はハブパネルが hidden=false のままブートするため (ADR-056 ハブ推し表示)、
                // 「設定モーダルが開いているか」も併せて確認する。
                const hubPanel = document.getElementById('sync-config-hub');
                const settingsOpen = document.getElementById('settings-modal')?.classList.contains('show');
                if (hubPanel && !hubPanel.hidden && settingsOpen) this._ensureHubSignInButton();
            }
        } else {
            if (host) host.hidden = true;
            if (gotoBtn) gotoBtn.hidden = false;
            if (msg) msg.textContent = 'ハブを使うには、まず「アカウント」で Google ログイン（規約への同意）が必要です。';
        }
    }

    // 使用量バー・プランバッジを設定キャッシュ (hub) の値で描画
    _renderHubUsageBar(hub) {
        hub = hub || (SyncConfigManager.load().hub) || {};
        const used = Number(hub.usedBytes) || 0;
        const quota = Number(hub.quotaBytes) || 0;
        const badge = document.getElementById('hub-plan-badge');
        if (badge) {
            const plus = hub.plan === 'plus';
            badge.textContent = plus ? 'Plus' : '無料';
            badge.classList.toggle('is-plus', plus);
        }
        const usedEl = document.getElementById('hub-usage-used');
        const quotaEl = document.getElementById('hub-usage-quota');
        if (usedEl) usedEl.textContent = this._formatBytes(used);
        if (quotaEl) quotaEl.textContent = quota ? this._formatBytes(quota) : '—';
        const fill = document.getElementById('hub-usage-fill');
        if (fill) {
            const ratio = quota > 0 ? Math.min(1, used / quota) : 0;
            fill.style.width = `${(ratio * 100).toFixed(1)}%`;
            fill.classList.toggle('is-warn', ratio >= 0.8 && ratio < 0.98);
            fill.classList.toggle('is-full', ratio >= 0.98);
        }
        // プランが変わればアフィタグ欄の表示可否も追従させる
        this._reflectAffiliateField();
    }

    // アフィタグ入力欄(Plus限定)の表示可否と値を最新化。プラン変化・設定再オープンに追従
    _reflectAffiliateField() {
        const affInput = document.getElementById('setting-affiliate-id');
        const affWrap = document.getElementById('publish-affiliate');
        if (!affInput || !affWrap) return;
        const cfg = SyncConfigManager.load();
        const plan = (cfg.hub || {}).plan || 'free';
        const target = (cfg.publish || {}).target === 'github' ? 'github' : 'hub';   // 既定=ハブに追随
        // 自前 GitHub Pages はユーザの自己責任サイト → プラン不問で自分のタグ可 (運営タグは入れない)。
        // ハブは運営ホスト → 自分のタグは Plus 特典 (無料は運営タグ)。
        affWrap.hidden = !((target === 'github') || (plan === 'plus'));
        // ヒントは表示状態に合わせて出し分け (全状態で事実と一致させる: ハブ無料=運営タグ固定は欄ごと非表示)
        const hint = document.getElementById('affiliate-hint');
        if (hint) {
            hint.textContent = (target === 'github')
                ? 'Amazon アソシエイトに参加している方向けの設定です。設定すると、GitHub 公開ページの商品リンクがあなたの収益になります。空欄なら広告を付けません。'
                : 'Amazon アソシエイトに参加している方向けの設定です。Plus プランでは、ハブ公開ページの商品リンクにこのタグが使われます。空欄なら広告を付けません。';
        }
        // 入力中はユーザの編集を尊重して上書きしない
        if (document.activeElement !== affInput) {
            affInput.value = (this.userData && this.userData.settings && this.userData.settings.affiliateId) || '';
        }
    }

    // 公開名義フィールドの値と placeholder を最新化 (placeholder はアカウント名由来)
    _reflectPublicNameField() {
        const el = document.getElementById('setting-public-name');
        if (!el) return;
        const s = (this.userData && this.userData.settings) || {};
        if (document.activeElement !== el) el.value = s.publicDisplayName || '';
        let derived = '';
        try {
            const email = (SyncConfigManager.load().hub || {}).email || '';
            derived = email ? email.split('@')[0] : '';
        } catch (_) {}
        el.placeholder = derived ? `例: ${derived}（未入力ならこの名前を使用）` : '例: あなたの名前 / ハンドル';
    }

    _formatBytes(n) {
        n = Number(n) || 0;
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
        return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    _setupHubUI() {
        if (this._hubUIBound) return;
        this._hubUIBound = true;
        const disconnectBtn = document.getElementById('hub-disconnect-btn');
        if (disconnectBtn) disconnectBtn.addEventListener('click', () => this._disconnectHub());
        const useBtn = document.getElementById('hub-use-btn');
        if (useBtn) useBtn.addEventListener('click', () => this._useHub());
        const refreshBtn = document.getElementById('hub-usage-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this._refreshHubUsage({ notify: true }));
    }

    // Google ログインボタンの描画は「ハブパネルを実際に開いた時」だけ (GIS スクリプトの遅延読込)。
    // ブート時に外部スクリプトを読みに行かない (オフライン/起動コストを避ける)。
    _ensureHubSignInButton() {
        if (this._hubSignInRendered) return;
        const hub = (SyncConfigManager.load().hub) || {};
        if (hub.key && hub.apiBase) return; // 接続済みはボタン不要
        const btnHost = document.getElementById('hub-gsi-button');
        if (!btnHost || typeof HubAuth === 'undefined') return;
        // 規約同意済みのときだけ描画 (未同意は _renderHubDisconnected が host を hidden にする)。
        if (!(this.userData && this.userData.settings && this.userData.settings.ackTermsPrivacy)) return;
        this._hubSignInRendered = true;
        HubAuth.renderSignInButton(btnHost, {
            onConnected: (session) => {
                this._renderHubAuthState();
                this._renderAccountSection();
                // ハブ節からのログイン = ハブを使う意図。未適用ラベルで「この設定で使う」を強調済み。
                toast(`Asayake ハブにログインしました${session && session.email ? ` (${session.email})` : ''}。「この設定で使う」で保存先に設定できます。`, { type: 'success' });
            },
            onError: (e) => toast(`ハブへの接続に失敗しました: ${e.message}`, { type: 'error' })
        });
    }

    // ===== アカウント (ログイン/状態) — 同期方式と独立した第一級のログイン面 (A) =====
    // 設定の「アカウント」セクションとサイドバーのチップに状態を反映する。
    // 「同期=ハブ」を選ばなくてもここからログインできる (= 旧来「同期からしか入れない」の解消)。

    _setupAccountUI() {
        if (this._accountUIBound) return;
        this._accountUIBound = true;
        const logout = document.getElementById('account-logout-btn');
        if (logout) logout.addEventListener('click', () => this._logoutAccount());
        const del = document.getElementById('account-delete-btn');
        if (del) del.addEventListener('click', () => this._deleteAccount());
        const refresh = document.getElementById('account-usage-refresh');
        if (refresh) refresh.addEventListener('click', () => this._refreshHubUsage({ notify: true }));
        // 公開URLのユーザー名 (S6・ADR-076)
        const usernameSave = document.getElementById('account-username-save');
        if (usernameSave) usernameSave.addEventListener('click', () => this._saveAccountUsername());
        const usernameInput = document.getElementById('account-username-input');
        if (usernameInput) usernameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._saveAccountUsername(); });
        // 課金 (Stripe, ADR-035): アップグレード / 支払い管理 (解約)
        const upM = document.getElementById('account-upgrade-monthly');
        if (upM) upM.addEventListener('click', () => this._startCheckout('monthly'));
        const upY = document.getElementById('account-upgrade-yearly');
        if (upY) upY.addEventListener('click', () => this._startCheckout('yearly'));
        const manage = document.getElementById('account-manage-billing');
        if (manage) manage.addEventListener('click', () => this._openBillingPortal());
        // 管理者: プラン手動切替 (ADR-038)。表示は isAdmin のときだけ (設定→管理者カテゴリ・_reflectAdminSection・#409)
        const admPlus = document.getElementById('account-admin-plus');
        if (admPlus) admPlus.addEventListener('click', () => this._adminSetPlan('plus'));
        const admFree = document.getElementById('account-admin-free');
        if (admFree) admFree.addEventListener('click', () => this._adminSetPlan('free'));
        const admReset = document.getElementById('account-admin-reset');
        if (admReset) admReset.addEventListener('click', async () => {
            const email = (document.getElementById('account-admin-email') || {}).value || '';
            if (!email.trim()) { toast('対象のメールを入力してください。', { type: 'warn' }); return; }
            if (await window.confirmDialog({ message: `${email.trim()} の Stripe 課金リンク（customer/subscription）を外して無料に戻します。\n（test→live 切替で詰まった時の復旧用。Stripe 側の課金は止めません）\nよろしいですか？` })) this._adminSetPlan('free', true);
        });
        // 決済からの戻り (?billing=success|cancel) を処理 (1 回だけ)
        this._handleBillingReturn();
        // 公開記事フッタの「通報」リンク (?report=<記事URL>) から来たら通報ダイアログを開く (ADR-099)
        this._handleReportParam();
        // 同期節の「アカウントでログイン」誘導 → アカウントカテゴリへ切替 (設定は既に開いている)
        const openAccount = () => this._activateSettingsCategory('account-section', { push: true });
        const goto = document.getElementById('hub-goto-account');
        if (goto) goto.addEventListener('click', openAccount);
        const chip = document.getElementById('sidebar-account');
        if (chip) chip.addEventListener('click', () => this._openSettingsModal('account-section'));
        // 能動同意: 規約/プライバシーへの同意チェックが入って初めて Google ログインボタンを描画する。
        const consent = document.getElementById('account-consent-check');
        if (consent) consent.addEventListener('change', async () => {
            if (consent.checked) {
                try {
                    if (!this.userData.settings) this.userData.settings = {};
                    this.userData.settings.ackTermsPrivacy = { at: new Date().toISOString(), v: 'v1.0' };
                    await this.saveUserData();
                } catch (_) {}
            }
            this._ensureAccountSignInButton();
            // 同意でハブ節の出し分け (誘導↔節内ログイン) も即追従。パネルが開いていれば GIS 実体化。
            this._renderHubAuthState();
        });
    }

    // Google ログインボタンを描画 (GIS 遅延読込)。アカウントセクション用。
    // 能動同意: 規約/プライバシーの同意チェックが入るまでボタンを出さない (GIS ボタンはクリックで即認証に進むため)。
    _ensureAccountSignInButton() {
        if (typeof HubAuth === 'undefined') return;
        if (HubAuth.isConnected && HubAuth.isConnected()) return; // 接続済みは不要
        const host = document.getElementById('account-gsi-button');
        if (!host) return;
        const check = document.getElementById('account-consent-check');
        const hint = document.getElementById('account-consent-hint');
        const consented = !!(check && check.checked);
        host.hidden = !consented;
        if (hint) hint.hidden = consented;
        if (!consented) return;          // 未同意: ボタンは描画しない
        if (this._accountSignInRendered) return;
        this._accountSignInRendered = true;
        HubAuth.renderSignInButton(host, {
            onConnected: (session) => {
                this._renderAccountSection();
                this._renderHubAuthState();
                toast(`Asayake アカウントにログインしました${session && session.email ? ` (${session.email})` : ''}。`, { type: 'success' });
            },
            onError: (e) => toast(`ログインに失敗しました: ${e.message}`, { type: 'error' })
        });
    }

    // アカウントセクション本体 + サイドバーチップを現在の接続状態で描画
    _renderAccountSection() {
        const hub = (SyncConfigManager.load().hub) || {};
        const connected = !!(hub.key && hub.apiBase);
        const disc = document.getElementById('account-disconnected');
        const conn = document.getElementById('account-connected');
        if (disc && conn) {
            disc.hidden = connected;
            conn.hidden = !connected;
            if (connected) {
                const emailEl = document.getElementById('account-email');
                if (emailEl) emailEl.textContent = hub.email || '(ログイン済み)';
                this._renderAccountUsageBar(hub);
                this._renderAccountUsername(hub);
            } else {
                this._ensureAccountSignInButton();
            }
        }
        this._reflectAdminSection(connected ? hub : null);
        this._reflectAccountChip(hub, connected);
    }

    _renderAccountUsageBar(hub) {
        hub = hub || (SyncConfigManager.load().hub) || {};
        const used = Number(hub.usedBytes) || 0;
        const quota = Number(hub.quotaBytes) || 0;
        const badge = document.getElementById('account-plan-badge');
        if (badge) {
            const plus = hub.plan === 'plus';
            badge.textContent = plus ? 'Plus' : '無料';
            badge.classList.toggle('is-plus', plus);
        }
        const usedEl = document.getElementById('account-usage-used');
        const quotaEl = document.getElementById('account-usage-quota');
        if (usedEl) usedEl.textContent = this._formatBytes(used);
        if (quotaEl) quotaEl.textContent = quota ? this._formatBytes(quota) : '—';
        const fill = document.getElementById('account-usage-fill');
        if (fill) {
            const ratio = quota > 0 ? Math.min(1, used / quota) : 0;
            fill.style.width = `${(ratio * 100).toFixed(1)}%`;
            fill.classList.toggle('is-warn', ratio >= 0.8 && ratio < 0.98);
            fill.classList.toggle('is-full', ratio >= 0.98);
        }
        // 課金導線 (ADR-035): Free=アップグレード提示 / Plus=課金状態 + 管理。接続済みのみ
        const plus = hub.plan === 'plus';
        const billing = document.getElementById('account-billing');
        const upgrade = document.getElementById('account-upgrade');
        const manage = document.getElementById('account-manage-billing');
        if (billing) billing.hidden = false;
        if (upgrade) upgrade.hidden = plus;
        // 「プラン変更・支払い・解約」(Stripe Billing Portal) は実際に Stripe サブスクがある時だけ。
        // 管理者付与の Plus (comp) や未払いは Stripe 顧客が無く Portal を開けないので出さない (ADR-039)。
        if (manage) manage.hidden = !(plus && hub.billingManaged);
        // comp (管理者付与 Plus, billingManaged=false) 向けの案内 (イシュー#231)。
        // billingManaged だけでは comp と stale (Stripe リンク残骸) を区別できないため、
        // hub.planSource (イシュー#248・ADR-038/039) で振り分ける。旧 hub は planSource が
        // 無く null で返るため、その間は従来どおり comp 側を表示する (フロント先行でもデグレしない)。
        const compNotice = document.getElementById('account-comp-notice');
        if (compNotice) compNotice.hidden = !(plus && !hub.billingManaged && hub.planSource !== 'stale');
        // stale (Stripe のリンクが掃除された残骸で plan だけ plus が残った状態) 向けの案内 (イシュー#248)。
        // billingManaged=false のうち、comp (planSource:'comp') でない方をここで拾う。
        const staleNotice = document.getElementById('account-stale-notice');
        if (staleNotice) staleNotice.hidden = !(plus && !hub.billingManaged && hub.planSource === 'stale');
        // 支払い遅延警告 (任意項目・イシュー#231)。hub.subStatus は Stripe のサブスク status を
        // そのまま転写したもの (applyStripeEvent) なので 'past_due' 判定に使える。
        const pastDueNotice = document.getElementById('account-past-due-notice');
        if (pastDueNotice) pastDueNotice.hidden = !(plus && hub.billingManaged && hub.subStatus === 'past_due');
        this._renderPlanDetail(hub, plus);
    }

    // 設定の「管理者」カテゴリ (admin-section) の出し分け (ADR-038/#409)。左の項目一覧 (settings-master) の
    // ボタンと details 自体の hidden をここ1か所で同期する。_renderAccountSection から常に (connected でなくても)
    // 呼ばれるので、ログアウト・非管理者に戻った再描画で確実に hidden へ戻る。
    _reflectAdminSection(hub) {
        const isAdmin = !!(hub && hub.isAdmin);
        const adminSection = document.getElementById('admin-section');
        if (adminSection) adminSection.hidden = !isAdmin;
        const navBtn = document.querySelector('#settings-master .settings-cat[data-cat="admin-section"]');
        if (navBtn) navBtn.hidden = !isAdmin;
        if (isAdmin && !this._reportReviewLoadedAt) this._loadReportReview();
    }

    // 公開URLのユーザー名 (S6・ADR-076): 現在値表示。未設定は目立たせる (公開ボタンでブロックされるため)。
    _renderAccountUsername(hub) {
        hub = hub || (SyncConfigManager.load().hub) || {};
        const cur = document.getElementById('account-username-current');
        const input = document.getElementById('account-username-input');
        if (cur) {
            if (hub.username) {
                cur.textContent = `現在: ${hub.username}（${hub.bookshelfBase || ''}）`;
                cur.classList.remove('is-unset');
            } else {
                cur.textContent = '未設定（本棚を公開する前に設定してください）';
                cur.classList.add('is-unset');
            }
        }
        if (input) input.placeholder = hub.username ? `変更後の名前 (現在: ${hub.username})` : '例: taro-books';
    }

    // username 設定/変更フォームの送信 (POST <hub>/username へ接続, S6・ADR-076)。
    // バリデーション (形式・予約語・重複) は Worker 側の実装済みチェックに任せ、ここでは
    // 入力とエラー表示だけを担当する (アプリ側で二重バリデーションはしない、brief確定事項)。
    async _saveAccountUsername() {
        const input = document.getElementById('account-username-input');
        const errEl = document.getElementById('account-username-error');
        const btn = document.getElementById('account-username-save');
        if (!input) return;
        const val = input.value.trim();
        if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
        if (!val) {
            if (errEl) { errEl.textContent = 'ユーザー名を入力してください。'; errEl.hidden = false; }
            return;
        }
        if (typeof HubAuth === 'undefined') return;
        if (btn) btn.disabled = true;
        try {
            const { username } = await HubAuth.setUsername(val);
            toast(`ユーザー名を「${username}」に設定しました。`, { type: 'success' });
            input.value = '';
            this._renderAccountUsername();
        } catch (e) {
            if (errEl) { errEl.textContent = e.message; errEl.hidden = false; }
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // Plus の課金状態 (周期・次回更新日・解約予約) を表示する (ADR-035 追補)。
    // データは Worker が Stripe webhook から KV に保存し /usage で返す。古い Worker・未取得なら何も出さない。
    _renderPlanDetail(hub, plus) {
        const wrap = document.getElementById('account-plan-detail');
        const periodEl = document.getElementById('account-plan-period');
        const cancelEl = document.getElementById('account-plan-cancel');
        if (!wrap || !periodEl || !cancelEl) return;
        const end = Number(hub.currentPeriodEnd) || 0;   // unix 秒
        if (!plus || !end) { wrap.hidden = true; return; }
        const cycle = hub.interval === 'year' ? '年額' : hub.interval === 'month' ? '月額' : 'Plus';
        const dateStr = this._formatDate(end * 1000);
        if (hub.cancelAtPeriodEnd) {
            // 解約予約済み: 期間末まで Plus、その後 Free
            periodEl.textContent = `${cycle}（解約予約済み）`;
            cancelEl.textContent = `${dateStr} まで利用可能 ・ その後 無料プランに戻ります`;
            cancelEl.hidden = false;
            wrap.classList.add('is-canceling');
        } else {
            periodEl.textContent = `${cycle} ・ 次回更新 ${dateStr}`;
            cancelEl.textContent = '';
            cancelEl.hidden = true;
            wrap.classList.remove('is-canceling');
        }
        wrap.hidden = false;
    }

    // unix ミリ秒 → YYYY/MM/DD (ローカル)
    _formatDate(ms) {
        const d = new Date(ms);
        if (isNaN(d.getTime())) return '';
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
    }

    _reflectAccountChip(hub, connected) {
        hub = hub || (SyncConfigManager.load().hub) || {};
        if (connected === undefined) connected = !!(hub.key && hub.apiBase);
        const label = document.getElementById('sidebar-account-label');
        const plan = document.getElementById('sidebar-account-plan');
        if (label) label.textContent = connected ? (hub.email || 'ログイン中') : 'ログイン';
        if (plan) {
            const plus = hub.plan === 'plus';
            plan.hidden = !connected;
            plan.textContent = plus ? 'Plus' : '無料';
            plan.classList.toggle('is-plus', plus);
        }
        const chip = document.getElementById('sidebar-account');
        if (chip) chip.classList.toggle('is-connected', connected);
    }


    _initUsageAlert() {
        const close = document.getElementById('usage-alert-close');
        if (close) close.addEventListener('click', () => {
            this._usageAlertDismissed = this._usageAlertLevelRank(this._usageAlertLevel);
            const banner = document.getElementById('usage-alert-banner');
            if (banner) banner.hidden = true;
        });
        const upgrade = document.getElementById('usage-alert-upgrade');
        if (upgrade) upgrade.addEventListener('click', () => this._openSettingsModal('account-section'));
        const exp = document.getElementById('usage-alert-export');
        if (exp) exp.addEventListener('click', () => this.exportUnifiedData());
        this._renderUsageAlert();   // 起動時はキャッシュ (bookshelf_sync の hub) から描画
    }

    _usageAlertLevelRank(level) { return { warn: 1, strong: 2, over: 3 }[level] || 0; }

    _renderUsageAlert(hub) {
        const banner = document.getElementById('usage-alert-banner');
        if (!banner) return;
        hub = hub || (SyncConfigManager.load().hub) || {};
        const connected = !!(hub.key && hub.apiBase);
        const used = Number(hub.usedBytes) || 0;
        const quota = Number(hub.quotaBytes) || 0;
        const plus = hub.plan === 'plus';
        const level = connected ? VirtualBookshelf.usageAlertLevel(used, quota, hub.plan) : null;
        this._usageAlertLevel = level;
        // 閉じた後は、より深刻な段階に上がった時だけ再表示する
        if (!level || this._usageAlertLevelRank(level) <= (this._usageAlertDismissed || 0)) { banner.hidden = true; return; }
        const msg = document.getElementById('usage-alert-msg');
        const upgrade = document.getElementById('usage-alert-upgrade');
        const exp = document.getElementById('usage-alert-export');
        const pct = quota > 0 ? Math.round((used / quota) * 100) : 0;
        if (level === 'over') {
            if (msg) msg.textContent = `ハブの容量を超過しています（${this._formatBytes(used)} / 上限 ${this._formatBytes(quota)}）。新しい保存はできません。データを削減するか、全データを書き出して退避するか、再アップグレードしてください。`;
        } else if (level === 'strong') {
            if (msg) msg.textContent = `ハブ容量の残りがわずかです（${pct}% 使用）。このままでは保存に失敗します。空きを作るか Plus へのアップグレードを検討してください。`;
        } else {
            if (msg) msg.textContent = `ハブ容量の 80% を使用中です（${this._formatBytes(used)} / ${this._formatBytes(quota)}・残り ${this._formatBytes(Math.max(0, quota - used))}）。`;
        }
        if (upgrade) upgrade.hidden = plus;
        if (exp) exp.hidden = (level !== 'over');
        banner.classList.toggle('is-critical', level === 'over' || level === 'strong');
        banner.hidden = false;
    }

    async _logoutAccount() {
        if (!(await window.confirmDialog({ message: 'ログアウトしますか？\nこの端末からハブの接続情報を消します（ハブ上のデータは残ります）。\nOK を押すとページを再読み込みします。', danger: true }))) return;
        this._disconnectHub();   // 切断 + 同期=hub なら local に戻す + reload
    }

    // アカウント削除 (E): ハブ上の保存データと公開サイトを消す。Worker の DELETE /account が前提。
    async _deleteAccount() {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) { toast('ログインしていません。', { type: 'warn' }); return; }
        const btn = document.getElementById('account-delete-btn');
        // イシュー#518: confirmDialog は Promise のため、確認待ち中の連打で2回 DELETE が飛ばないよう
        // confirm の前に disabled にする (ネイティブ confirm はブロッキングのため問題化していなかった)。
        if (btn) btn.disabled = true;
        if (!(await window.confirmDialog({ message: 'アカウントを削除しますか？\n\nハブ上の保存データと、ハブで公開したサイトがすべて削除されます。この操作は取り消せません。\n（GitHub やこの端末に保存したデータは消えません）\n\nOK を押すと削除して再読み込みします。', danger: true }))) {
            if (btn) btn.disabled = false;
            return;
        }
        try {
            const res = await fetch(`${hub.apiBase}/account`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${hub.key}` }
            });
            if (!res.ok) {
                let d = ''; try { d = (await res.text()).slice(0, 200); } catch (_) {}
                throw new Error(`${res.status}${d ? ': ' + d : ''}`);
            }
            toast('アカウントを削除しました。', { type: 'success' });
            this._disconnectHub(); // ローカル接続情報も消去して再読み込み
        } catch (e) {
            if (btn) btn.disabled = false;
            toast(`アカウント削除に失敗しました: ${e.message}`, { type: 'error' });
        }
    }

    // 使用量を再取得し、バーを更新 (失敗は黙殺 or notify 時のみ通知)
    async _refreshHubUsage({ notify = false } = {}) {
        if (typeof HubAuth === 'undefined') return;
        try {
            const hub = await HubAuth.refreshUsage();
            if (hub) {
                this._renderHubUsageBar(hub);
                this._renderAccountUsageBar(hub);
                this._reflectAccountChip(hub, true);
                this._renderUsageAlert(hub);
                if (notify) toast('使用量を更新しました。', { type: 'success' });
            }
        } catch (e) {
            console.warn('ハブ使用量の取得に失敗:', e);
            if (notify) toast(`使用量を取得できませんでした: ${e.message}`, { type: 'warn' });
        }
    }

    // ===== 課金 (Stripe Checkout / Billing Portal, ADR-035) =====
    // 決済の実体は Stripe ホスト画面。アプリは Worker でセッションを作り、その URL へ遷移するだけ。

    // Plus にアップグレード: Worker に Checkout セッションを作らせ、Stripe へ遷移
    async _startCheckout(plan) {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) { toast('先にログインしてください。', { type: 'warn' }); return; }
        const btns = ['account-upgrade-monthly', 'account-upgrade-yearly'].map(id => document.getElementById(id));
        btns.forEach(b => { if (b) b.disabled = true; });
        try {
            const res = await fetch(`${hub.apiBase}/billing/checkout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${hub.key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan, returnUrl: location.href.split('?')[0].split('#')[0] })
            });
            if (res.status === 503) { toast('Plus の決済は現在準備中です。もう少しお待ちください。', { type: 'warn' }); return; }
            if (!res.ok) { let d = ''; try { d = (await res.text()).slice(0, 200); } catch (_) {} throw new Error(`${res.status}${d ? ': ' + d : ''}`); }
            const data = await res.json();
            if (data.url) { location.href = data.url; return; }   // Stripe Checkout へ遷移
            throw new Error('セッション URL が取得できませんでした');
        } catch (e) {
            toast(`アップグレードを開始できませんでした: ${e.message}`, { type: 'error' });
        } finally {
            btns.forEach(b => { if (b) b.disabled = false; });
        }
    }

    // 支払い方法・解約の管理: Stripe Billing Portal へ遷移
    async _openBillingPortal() {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) { toast('先にログインしてください。', { type: 'warn' }); return; }
        const btn = document.getElementById('account-manage-billing');
        if (btn) btn.disabled = true;
        try {
            const res = await fetch(`${hub.apiBase}/billing/portal`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${hub.key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ returnUrl: location.href.split('?')[0].split('#')[0] })
            });
            if (res.status === 503) { toast('支払い管理は現在準備中です。', { type: 'warn' }); return; }
            if (!res.ok) { let d = ''; try { d = (await res.text()).slice(0, 200); } catch (_) {} throw new Error(`${res.status}${d ? ': ' + d : ''}`); }
            const data = await res.json();
            if (data.url) { location.href = data.url; return; }
            throw new Error('管理ページの URL が取得できませんでした');
        } catch (e) {
            toast(`支払い管理を開けませんでした: ${e.message}`, { type: 'error' });
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // 決済直後のプラン反映を指数バックオフで確認 (WP-B4)。全滅時は案内を出して黙って諦めない
    async _pollPlusActivation() {
        const delays = [2000, 4000, 8000, 16000, 30000];
        for (const ms of delays) {
            await new Promise(r => setTimeout(r, ms));
            try {
                if (typeof HubAuth === 'undefined') break;
                const hub = await HubAuth.refreshUsage();
                if (hub) {
                    this._renderHubUsageBar(hub);
                    this._renderAccountUsageBar(hub);
                    this._reflectAccountChip(hub, true);
                    this._renderUsageAlert(hub);
                    if (hub.plan === 'plus') { toast('Plus が有効になりました。', { type: 'success' }); return; }
                }
            } catch (_) { /* 一時失敗は次の試行へ */ }
        }
        toast('Plus の反映を確認できませんでした。数分後にページを再読み込みしてください。それでも反映されない場合は asayake.hahero@gmail.com へご連絡ください。', { type: 'warn' });
    }

    // 決済からの戻り (?billing=success|cancel)。プラン反映は Webhook 経由なので使用量を再取得
    _handleBillingReturn() {
        if (this._billingReturnHandled) return;
        let params;
        try { params = new URLSearchParams(location.search); } catch (_) { return; }
        const billing = params.get('billing');
        if (!billing) return;
        this._billingReturnHandled = true;
        // クエリを URL から除去 (リロードで再通知しない)。段階③: 台帳の写し (history.state) は保つ (H4)
        try {
            params.delete('billing');
            const qs = params.toString();
            history.replaceState(this.nav ? history.state : null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
        } catch (_) {}
        if (billing === 'success') {
            toast('お支払いが完了しました。Plus を反映しています…', { type: 'success' });
            // Webhook 反映の遅れを指数バックオフで最大 ~60 秒待つ (WP-B4)
            this._pollPlusActivation();
        } else if (billing === 'cancel') {
            toast('アップグレードはキャンセルされました。', { type: 'info' });
        }
    }

    _disconnectHub() {
        const wasMethod = SyncConfigManager.load().method;
        HubAuth.disconnect();
        if (wasMethod === 'hub') {
            const after = SyncConfigManager.load();
            after.method = 'local';
            SyncConfigManager.save(after);
        }
        location.reload();
    }

    _useHub() {
        const hub = (SyncConfigManager.load().hub) || {};
        if (!(hub.key && hub.apiBase)) {
            toast('先に Asayake ハブにログインしてください。', { type: 'warn' });
            return;
        }
        SyncConfigManager.setMethod('hub');
        location.reload();
    }

    _collectGitHubRepoForm() {
        const sel = document.getElementById('github-repo-select');
        const fullName = sel ? sel.value : '';
        let owner = '', repo = '';
        if (fullName && fullName.includes('/')) {
            const parts = fullName.split('/');
            owner = parts[0];
            repo = parts.slice(1).join('/');
        }
        const branchSel = document.getElementById('github-branch-select');
        const branch = (branchSel && branchSel.value) || 'main';
        const val = (id) => (document.getElementById(id)?.value || '').trim();
        return {
            owner,
            repo,
            branch,
            basePath: val('github-base-path')
        };
    }

    async _saveGitHubRepo() {
        const status = document.getElementById('github-status');
        const repo = this._collectGitHubRepoForm();
        const config = SyncConfigManager.load();
        const token = config.github && config.github.token;
        if (!token) {
            if (status) status.textContent = '先に「GitHub に接続」を押してください';
            return;
        }
        if (!repo.owner || !repo.repo) {
            if (status) status.textContent = 'owner / repo は必須';
            return;
        }
        if (status) status.textContent = '接続確認中...';
        try {
            const adapter = new GitHubAdapter({ ...repo, token });
            await adapter.testConnection();
        } catch (e) {
            if (status) status.textContent = `接続失敗: ${e.message}`;
            return;
        }
        const merged = SyncConfigManager.load();
        merged.method = 'github';
        merged.github = {
            ...(merged.github || {}),
            owner: repo.owner,
            repo: repo.repo,
            branch: repo.branch,
            basePath: repo.basePath
        };
        SyncConfigManager.save(merged);
        if (status) status.textContent = '保存しました。ページをリロードします...';
        setTimeout(() => location.reload(), 800);
    }

    _loadHeaderIconOverrides() {
        try {
            const raw = localStorage.getItem(VirtualBookshelf.HEADER_ICON_OVERRIDES_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; }
    }

    _saveHeaderIconOverrides(map) {
        try {
            localStorage.setItem(VirtualBookshelf.HEADER_ICON_OVERRIDES_KEY, JSON.stringify(map));
        } catch (e) { console.warn('header icon overrides 保存失敗', e); }
    }

    /**
     * ヘッダーアイテムに紐づく override を取得 ('' なら未設定)
     * @param {string} key  'back-to-main', 'view-toggle:covers', 'plugin:foo' など
     */
    getHeaderIconOverride(key) {
        if (!key) return '';
        const map = this._loadHeaderIconOverrides();
        return map[key] || '';
    }

    /**
     * ヘッダーアイテムの override を設定。null/'' でクリア。即時にヘッダー再描画。
     */
    setHeaderIconOverride(key, name) {
        const map = this._loadHeaderIconOverrides();
        if (name === null || name === '') {
            delete map[key];
        } else {
            map[key] = name;
        }
        this._saveHeaderIconOverrides(map);
        // ヘッダー全体を再構築 → state-切替も _updateView*Button から override を読むので反映される
        if (typeof this._applyHeaderLayout === 'function') this._applyHeaderLayout();
        // プラグインカードのプレビューも更新 (plugin:<id> の場合)
        if (key.startsWith('plugin:') && typeof this._renderPluginListSection === 'function') {
            this._renderPluginListSection().catch(e => console.warn('plugin list re-render failed', e));
        }
    }

    // ===== 後方互換: plugin-api.js が _getPluginIconOverride を呼ぶので残す =====
    _getPluginIconOverride(pluginId) {
        return this.getHeaderIconOverride(`plugin:${pluginId}`);
    }

    _isSettingsMobile() {
        return window.viewport.isNarrow(); // 境目はjs/ui/viewport.js(900px)に一本化(イシュー#505)
    }

    // 一覧 (master) を 1 度だけ構築。スマホでは縦リスト、PC では左レールとして使う。
    _buildSettingsMaster() {
        const host = document.getElementById('settings-master');
        if (!host || host._built) return;
        host._built = true;
        host.innerHTML = '';
        for (const cat of VirtualBookshelf.SETTINGS_CATEGORIES) {
            if (!document.getElementById(cat.id)) continue; // 節が無ければスキップ
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'settings-cat';
            btn.dataset.cat = cat.id;
            btn.innerHTML =
                `<span class="settings-cat-ic"><span class="h-icon" data-icon="${cat.icon}" data-icon-size="17"></span></span>` +
                `<span class="settings-cat-tx"><span class="settings-cat-tt"></span><span class="settings-cat-ds"></span></span>` +
                `<span class="settings-cat-chev"><span class="h-icon" data-icon="chevron-right" data-icon-size="16"></span></span>`;
            btn.querySelector('.settings-cat-tt').textContent = cat.label;
            btn.querySelector('.settings-cat-ds').textContent = cat.desc;
            btn.addEventListener('click', () => this._activateSettingsCategory(cat.id, { push: true }));
            host.appendChild(btn);
        }
        if (typeof window.applyIcons === 'function') window.applyIcons(host);
    }

    async _openSettingsModal(targetId, { switchFrom } = {}) {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;
        this._buildSettingsMaster();
        // 設定は「別の仕事」= 公開まわりの面を閉じてから開く (§6-4「移る前に閉じる」・イシュー#367)。入口ごとの
        // 個別の閉じ方 (旧: ここで公開パネルだけ・_confirmOpenSettings で公開モーダルだけ) をこの 1 か所に寄せた
        this._closeOverlaysForTransition();
        // イシュー#435: 「アプリのページ」として開く(#430の統一方針の横展開)。技術基盤(overlays.open/NavState)は
        // そのまま、見た目だけ全画面+サイドバー残存+×なしにする(css/bookshelf.css「設定を全画面ページとして開く」節)。
        modal.classList.add('settings-fullpage');
        // イシュー#513 S6: switchFrom(呼び手が既に閉じた公開系の面のid配列)が渡された時は、段は
        // Surface.switchToの1回のreplaceに任せる(下のswitchTo呼び出し)。hist:falseにしてここでは
        // 重ねてpushしない(二重に段を積まないため)。
        const hasSwitchFrom = Array.isArray(switchFrom) && switchFrom.length > 0;
        // 重なり管理役: 大 (lg・左に項目一覧・右に中身)。hist:true = 履歴の段 (settings-modal) は管理役の hooks 経由で
        // _modalHistPush/Pop (NavState) に積む。戻る/×/ESC で閉じた後片付け (一覧へ戻す) は onClose。
        // イシュー#468では route/returnRoute付与で back-nav-matrix X08 が新規に落ち撤回したが、イシュー#494 step2で
        // 原因を実測特定(settings-cat段のclose(go・遅延)とsettings-modal段のclose+route復元(closeFace3・replace・
        // 即時)が同じEsc操作内で2回 individually apply され実行タイミングが噛み合わない→段が余る)。
        // _modalHistPop側(id==='settings-modal'の分岐)でsettings-cat残存時は1回のnav.closeSettingsにまとめて
        // 解消済み(#442のclosePublish3と同じ形)。onCloseは「settings-catのpop」を呼ばない(DOM後片付けのみ)。
        this._overlays().open(modal, {
            kind: 'modal', size: 'lg', hist: !hasSwitchFrom,
            route: { view: 'settings' }, returnRoute: this._surface().parent('settings-modal') || { view: 'main' }, // イシュー#494・親はSurfaceのdefineで決める(イシュー#511 X1)
            onClose: () => {
                this._showSettingsMaster();
            },
        });
        if (hasSwitchFrom) {
            // イシュー#513 S6: close直後にopenする2回apply構成(go予約→push)は、goがmicrotaskで未消化の
            // まま次のpushがreplaceへ変換され、残ったgoが書き換え済みの段を後から巻き戻す競合を起こす
            // (実測・#513 step3)。段だけSurface.switchToの1回のreplaceで差し替える。
            this._surface().switchTo(switchFrom, 'settings-modal', {
                close: (o) => this._overlays().close('settings-modal', { reason: 'history', fromHistory: !!(o && o.fromHistory) }),
                route: { view: 'settings' },
            });
        }
        // 開くたびに最新化 (プラン変化・別端末更新に追従)。軽い再描画のみ。重い market/プラグイン一覧は
        // プラグインカテゴリを開いた時だけ描画する (毎回全再描画をやめる, ADR-047 P2)。
        this._reflectAffiliateField();
        this._reflectPublicNameField();
        this._setupAccountUI();
        this._renderAccountSection();
        this._renderPluginCategoryLegend();
        const urlInput = document.getElementById('plugin-repo-url');
        if (urlInput) urlInput.value = '';
        // 初期表示: targetId があればその節へ / 無ければ スマホ=一覧・PC=先頭(アカウント)
        if (targetId) {
            this._scrollSettingsTo(targetId);
        } else if (this._isSettingsMobile()) {
            this._showSettingsMaster();
        } else {
            this._activateSettingsCategory('account-section', { push: false });
        }
    }

    // 開いたカテゴリだけ重い描画 (毎回のプラグイン一覧の再描画を回避)。
    // マーケット描画は C-251 で撤去 (_renderMarketSection は温存・呼ばないだけ)
    _renderSettingsCategory(id) {
        if (id === 'plugins-section') {
            this._renderPluginListSection().catch(e => console.warn('plugin list render failed', e));
        } else if (id === 'account-section') {
            this._setupAccountUI();
            this._renderAccountSection();
        } else if (id === 'sync-section') {
            // ハブパネルが表示中ならここで GIS ボタンを実体化する (ブート時は先読みしないため、
            // セレクト変更なしで同期節を開いた場合の受け皿がここになる)
            this._renderHubAuthState();
        }
    }

    // カテゴリを有効化 (pane 表示 + レール active + ヘッダー差し替え + 遅延描画)。
    // スマホでは一覧→詳細で履歴を 1 段積む (戻る/スワイプで一覧へ)。
    _activateSettingsCategory(id, { push = true } = {}) {
        const content = document.querySelector('.settings-modal-content');
        const detail = document.getElementById('settings-detail');
        const target = document.getElementById(id);
        if (!content || !detail || !target || !detail.contains(target)) return;
        const mobile = this._isSettingsMobile();
        // スマホは一覧→詳細で1段積む (戻る=一覧へ)。詳細から別の詳細へは積み増さない
        if (mobile && push) this._surface().open('settings-cat', { close: () => this._showSettingsMaster() });
        detail.querySelectorAll('.settings-section.pane-active').forEach(el => el.classList.remove('pane-active'));
        target.open = true;
        target.classList.add('pane-active');
        const master = document.getElementById('settings-master');
        if (master) master.querySelectorAll('.settings-cat').forEach(b => b.classList.toggle('cat-active', b.dataset.cat === id));
        const cat = VirtualBookshelf.SETTINGS_CATEGORIES.find(c => c.id === id);
        const titleEl = document.getElementById('settings-md-title');
        const backBtn = document.getElementById('settings-back');
        content.dataset.settingsView = 'detail';
        // スマホはヘッダーに「‹戻る + カテゴリ名」。PC はヘッダー「設定」固定でカテゴリはレールが示す。
        if (titleEl) {
            const icon = (mobile && cat) ? cat.icon : 'settings';
            const label = (mobile && cat) ? cat.label : '設定';
            titleEl.innerHTML = `<span class="h-icon" data-icon="${icon}" data-icon-size="20"></span>`;
            titleEl.appendChild(document.createTextNode(label));
            if (typeof window.applyIcons === 'function') window.applyIcons(titleEl);
        }
        if (backBtn) backBtn.hidden = !mobile;
        this._renderSettingsCategory(id);
        detail.scrollTop = 0;
    }

    // 一覧 (master) ビューへ戻す。
    _showSettingsMaster() {
        const content = document.querySelector('.settings-modal-content');
        if (!content) return;
        content.dataset.settingsView = 'master';
        const detail = document.getElementById('settings-detail');
        if (detail) detail.querySelectorAll('.settings-section.pane-active').forEach(el => el.classList.remove('pane-active'));
        const master = document.getElementById('settings-master');
        if (master) master.querySelectorAll('.settings-cat.cat-active').forEach(b => b.classList.remove('cat-active'));
        const titleEl = document.getElementById('settings-md-title');
        if (titleEl) {
            titleEl.innerHTML = '<span class="h-icon" data-icon="settings" data-icon-size="20"></span>';
            titleEl.appendChild(document.createTextNode('設定'));
            if (typeof window.applyIcons === 'function') window.applyIcons(titleEl);
        }
        const backBtn = document.getElementById('settings-back');
        if (backBtn) backBtn.hidden = true;
    }

    // 戻るボタン (スマホ) を 1 度だけ配線。popstate は NavState (nav.start()) が唯一の聞き手 (イシュー#407)。
    _bindSettingsPopstate() {
        if (this._settingsPopstateBound) return;
        this._settingsPopstateBound = true;
        const backBtn = document.getElementById('settings-back');
        if (backBtn) backBtn.addEventListener('click', () => { this._surface().close('settings-cat'); this._showSettingsMaster(); });
    }

    // 設定モーダル内の特定要素/節へジャンプ (該当カテゴリを開いて要素へフォーカス)。
    // 引数 targetId は要素 id (details 自身でも、節内の要素でも可)。
    _scrollSettingsTo(targetId) {
        const el = targetId && document.getElementById(targetId);
        if (!el) return;
        const det = (el.tagName === 'DETAILS') ? el : el.closest('details.settings-section');
        if (det && det.id) this._activateSettingsCategory(det.id, { push: true });
        if (el !== det) {
            // 折りたたみ (details) の中の項目へ案内するときは、祖先を開いてから見せる (例: 公開先の変更)
            for (let d = el.parentElement && el.parentElement.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            try { if (typeof el.focus === 'function') el.focus({ preventScroll: true }); } catch (_) {}
        }
    }


    _defaultHeaderLayout() {
        // 既定は空。有効プラグインの UI ボタンは _currentHeaderLayout で自動追加される (ADR-047 P1)。
        return { items: [] };
    }

    _newPlacementId() {
        return 'p_' + Math.random().toString(36).slice(2, 10);
    }

    _loadHeaderLayout() {
        try {
            const raw = localStorage.getItem(VirtualBookshelf.HEADER_LAYOUT_STORAGE_KEY);
            if (!raw) return null;
            const p = JSON.parse(raw);
            if (!p || !Array.isArray(p.items)) return null;
            return {
                items: p.items
                    .filter(it => it && typeof it.key === 'string')
                    .map(it => ({ id: it.id || this._newPlacementId(), key: it.key }))
            };
        } catch (_) { return null; }
    }

    _saveHeaderLayout(layout) {
        try {
            localStorage.setItem(VirtualBookshelf.HEADER_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
        } catch (_) {}
    }

    /**
     * 利用可能なヘッダー項目一覧 (静的 + プラグイン)
     */
    _enumerateHeaderItems() {
        const meta = VirtualBookshelf.HEADER_ITEMS_META;
        const list = Object.keys(meta).map(key => ({
            key,
            label: meta[key].label,
            emoji: meta[key].emoji || '',
            required: !!meta[key].required,
            duplicatable: !!meta[key].duplicatable,
            needsBookshelf: !!meta[key].needsBookshelf,
            isPlugin: false
        }));
        if (this.pluginAPI && Array.isArray(this.pluginAPI._uiButtons)) {
            for (const btn of this.pluginAPI._uiButtons) {
                list.push({
                    key: `plugin:${btn.id}`,
                    label: btn.label,
                    emoji: btn.emoji || '🧩',
                    required: false,
                    duplicatable: false,
                    needsBookshelf: false,
                    isPlugin: true,
                    buttonId: btn.id
                });
            }
        }
        return list;
    }

    _getItemMeta(key) {
        if (key.startsWith('plugin:')) {
            return { duplicatable: false, required: false };
        }
        const m = VirtualBookshelf.HEADER_ITEMS_META[key];
        return m ? { duplicatable: !!m.duplicatable, required: !!m.required } : null;
    }

    /**
     * 現在のレイアウト (検証 + open-settings 自動補完)
     */
    // ===== プラグインボタンの表示/非表示 (有効のままアイコンだけ隠す) =====
    // settings.hiddenPluginButtons = [pluginId, ...]。プラグインは読み込んだまま (機能は有効)、
    // サイドバーの UI ボタンだけ描画しない。
    _isPluginButtonHidden(pluginId) {
        const arr = this.userData?.settings?.hiddenPluginButtons;
        return Array.isArray(arr) && arr.includes(pluginId);
    }

    async _setPluginButtonHidden(pluginId, hidden) {
        if (!this.userData.settings) this.userData.settings = {};
        const set = new Set(this.userData.settings.hiddenPluginButtons || []);
        if (hidden) set.add(pluginId); else set.delete(pluginId);
        this.userData.settings.hiddenPluginButtons = [...set];
        await this.saveUserData();
        this._applyHeaderLayout();
    }

    _currentHeaderLayout() {
        let layout = this._loadHeaderLayout();
        if (!layout) layout = this._defaultHeaderLayout();

        // 未知 key を除去
        const knownKeys = new Set(this._enumerateHeaderItems().map(i => i.key));
        layout.items = layout.items.filter(it => knownKeys.has(it.key));

        // 非 duplicatable の重複を除去 (古い stored 互換)
        const seenNonDup = new Set();
        layout.items = layout.items.filter(it => {
            const m = this._getItemMeta(it.key);
            if (m && !m.duplicatable) {
                if (seenNonDup.has(it.key)) return false;
                seenNonDup.add(it.key);
            }
            return true;
        });

        for (const it of layout.items) if (!it.id) it.id = this._newPlacementId();

        // 有効プラグインの UI ボタンを自動追加 (ヘッダーカスタマイザ廃止後は明示配置しないため)。
        // 既に配置済みのものは位置を保持、新規は末尾へ追加。
        if (this.pluginAPI && Array.isArray(this.pluginAPI._uiButtons)) {
            const placed = new Set(layout.items.map(it => it.key));
            for (const btn of this.pluginAPI._uiButtons) {
                const key = `plugin:${btn.id}`;
                if (placed.has(key)) continue;
                if (this._isPluginButtonHidden(btn.pluginId)) continue; // 非表示設定のプラグインは自動追加しない
                layout.items.push({ id: this._newPlacementId(), key });
            }
        }

        // required アイテム (open-settings) の存在保証
        for (const [key, meta] of Object.entries(VirtualBookshelf.HEADER_ITEMS_META)) {
            if (meta.required && !layout.items.some(it => it.key === key)) {
                layout.items.push({ id: this._newPlacementId(), key });
            }
        }
        // (旧仕様) 「設定」を常に末尾に強制していたが、D&D で動かしても戻ってしまい
        // 「設定だけ並び替えできない」状態になっていたため撤廃。設定も自由に並び替え可能。
        return layout;
    }

    /**
     * 起動時に静的アイテムの DOM テンプレートを記録 (元 DOM は除去)。
     * 全静的アイテムをテンプレ化することで、_applyHeaderLayout は常にクリーンビルドできる。
     */
    _initHeaderTemplates() {
        if (this._headerTemplates) return;
        this._headerTemplates = new Map();
        const staticKeys = Object.keys(VirtualBookshelf.HEADER_ITEMS_META);
        for (const key of staticKeys) {
            const el = document.querySelector(`[data-header-item="${key}"]:not(.plugin-button-item)`);
            if (!el) continue;
            this._headerTemplates.set(key, el);
            el.remove();
        }
    }

    /**
     * placement の DOM 要素を取得 (全アイテム non-duplicatable のためテンプレート実体を返す)。
     * 静的アイテム / プラグイン共通で、override があれば適用する。
     */
    _buildPlacementElement(item) {
        const { key, id: placementId } = item;
        if (key.startsWith('plugin:')) {
            const btnId = key.slice('plugin:'.length);
            const entry = this.pluginAPI?._uiButtons?.find(b => b.id === btnId);
            if (!entry) return null;
            if (this._isPluginButtonHidden(entry.pluginId)) return null; // 「アイコンを表示」OFF → 描画しない
            const span = document.createElement('span');
            span.className = 'header-item plugin-button-item';
            span.dataset.headerItem = key;
            span.dataset.placementId = placementId;
            const btn = document.createElement('button');
            btn.className = 'btn-icon-square plugin-ui-button';
            if (entry.active) btn.classList.add('is-on'); // ON/OFF 型ボタンの現在状態 (再描画後も復元)
            // pluginAPI 側に icon 適用を委譲 (override 優先, manifest.icon, emoji の順)
            if (typeof this.pluginAPI?._applyIconToButton === 'function') {
                this.pluginAPI._applyIconToButton(btn, entry);
            } else {
                btn.textContent = entry.emoji || '🧩';
            }
            btn.title = entry.title || entry.label;
            btn.addEventListener('click', () => {
                try { entry.onClick(); }
                catch (e) { console.error(`[plugin button "${entry.id}"]`, e); }
            });
            span.appendChild(btn);
            return span;
        }
        const meta = VirtualBookshelf.HEADER_ITEMS_META[key];
        if (!meta) return null;
        const tpl = this._headerTemplates?.get(key);
        if (!tpl) return null;
        tpl.dataset.placementId = placementId;
        // 静的アイテムにも override を適用
        {
            const override = this.getHeaderIconOverride(key);
            const btn = tpl.querySelector('button');
            if (btn) {
                if (override) {
                    btn.innerHTML = window.renderIcon(override, { size: 20 });
                    btn.dataset.iconValue = override;
                    // 後で applyIcons が data-icon を再 inject しないように属性を一旦消す
                    btn.removeAttribute('data-icon');
                } else {
                    // override 解除時: 元の data-icon を復元する必要がある (テンプレ DOM は同一実体なので)
                    if (btn.dataset.iconValue) {
                        delete btn.dataset.iconValue;
                    }
                    // 静的なデフォルトアイコンを HEADER_ITEMS_META から取り戻す
                    const defaultIcon = VirtualBookshelf.HEADER_ITEMS_META[key]?.defaultIcon;
                    if (defaultIcon) {
                        btn.setAttribute('data-icon', defaultIcon);
                        btn.innerHTML = '';
                    }
                }
            }
        }
        return tpl;
    }

    /**
     * ヘッダーレイアウトを DOM に適用 (linear flow)
     */
    _applyHeaderLayout() {
        if (!this._headerTemplates) this._initHeaderTemplates();
        const layout = this._currentHeaderLayout();
        // 正規化済みレイアウト (plugin ボタン自動追加・ID 補完済み) を永続化。
        // これで DOM の data-placement-id が安定し、サイドバー D&D 並び替えが一致する。
        this._saveHeaderLayout(layout);
        const header = document.getElementById('header-controls');
        if (!header) return;

        // ヘッダーから既存要素を全 detach (static は _headerTemplates に保持されているので OK)
        Array.from(header.querySelectorAll('[data-header-item]')).forEach(el => el.remove());

        // 順に追加
        for (const item of layout.items) {
            const el = this._buildPlacementElement(item);
            if (el) header.appendChild(el);
        }

        // clone された data-icon 要素に SVG を inject
        if (typeof window.applyIcons === 'function') window.applyIcons(header);

        // サイドバーユーティリティ上で直接 D&D 並び替え (ヘッダーカスタマイザ画面は廃止)
        this._bindSidebarUtilityDnD(header);
    }

    /**
     * サイドバー下部ユーティリティのボタンを D&D で並び替え (Pointer Events化=イシュー#337)。
     * 各 .header-item は data-placement-id を持つ。order は headerLayoutV8 に保存。
     */
    _bindSidebarUtilityDnD(host) {
        this._bindPointerReorder(host, {
            itemSelector: '.header-item',
            dragClass: 'hdr-item-dragging',
            zoneMode: 'index',
            indicatorClass: 'hdr-utility-drop-indicator',
            computeInsertIndex: (container, clientX, clientY) => {
                const items = Array.from(container.querySelectorAll('.header-item'));
                for (let i = 0; i < items.length; i++) {
                    const r = items[i].getBoundingClientRect();
                    if (clientY < r.top) return i;                       // この行より上
                    if (clientY <= r.bottom && clientX < r.left + r.width / 2) return i; // 同じ行で左寄り
                }
                return items.length;
            },
            getKey: (el) => el.dataset.placementId || null,
            onDrop: (pid, idx) => { if (pid) this._reorderHeaderPlacement(pid, idx); },
        });
    }

    /**
     * プラグイン一覧セクションを描画 (#plugin-list-section)
     * 各プラグイン: 名前/version/desc + [有効] チェックボックス + 削除
     */

    _loadPluginOrder() {
        try {
            const raw = localStorage.getItem(VirtualBookshelf.PLUGIN_ORDER_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (_) { return []; }
    }

    _savePluginOrder(order) {
        try { localStorage.setItem(VirtualBookshelf.PLUGIN_ORDER_STORAGE_KEY, JSON.stringify(order)); } catch (_) {}
    }

    _applyPluginOrder(plugins) {
        const order = this._loadPluginOrder();
        const orderIdx = new Map(order.map((id, i) => [id, i]));
        return plugins.slice().sort((a, b) => {
            const ai = orderIdx.has(a.id) ? orderIdx.get(a.id) : Infinity;
            const bi = orderIdx.has(b.id) ? orderIdx.get(b.id) : Infinity;
            if (ai !== bi) return ai - bi;
            return (a.id || '').localeCompare(b.id || '');
        });
    }

    async _renderPluginListSection() {
        const host = document.getElementById('plugin-list-section');
        if (!host) return;

        let installedPlugins = [];
        if (this.pluginLoader && this._isSyncReady()) {
            try {
                installedPlugins = await this.pluginLoader.listInstalledPlugins({ refresh: true });
            } catch (e) {
                console.warn('[plugin-list] listInstalledPlugins failed:', e);
            }
        }
        const disabledSet = new Set(this.userData?.settings?.disabledPlugins || []);
        const loadedSet = new Set(this.pluginLoader?.loaded?.keys?.() || []);

        if (!this._isSyncReady()) {
            host.innerHTML = '<p style="color:var(--muted);">先に「同期」で保存先（Asayake ハブ・この端末のフォルダ・GitHub のどれか）を設定してください。</p>';
            return;
        }
        if (installedPlugins.length === 0) {
            host.innerHTML = '<p style="color:var(--muted);">インストール済みのプラグインはありません。上の「GitHub からインストール」で追加できます。</p>';
            return;
        }

        // 保存された順序を適用
        installedPlugins = this._applyPluginOrder(installedPlugins);

        host.innerHTML = installedPlugins.map(({ id, manifest }) => {
            const m = manifest || {};
            const enabled = !disabledSet.has(id);
            const loaded = loadedSet.has(id);
            const icoBtn = (n, s = 14) => `<span class="h-icon">${window.renderIcon(n, { size: s })}</span>`;
            // 有効/無効はトグルスイッチで切替 (data-toggle-plugin を change で拾う)
            const toggle = `<label class="toggle-switch" title="${enabled ? 'クリックで無効化' : 'クリックで有効化'}">
                <input type="checkbox" class="plugin-toggle-input" data-toggle-plugin="${id}" ${enabled ? 'checked' : ''}>
                <span class="toggle-switch-track"><span class="toggle-switch-thumb"></span></span>
            </label>`;
            const settingsBtn = `<button type="button" class="btn btn-small plugin-card-settings" data-settings-plugin="${id}" title="このプラグインの設定（アイコン変更等）">${icoBtn('settings')}設定</button>`;
            // 標準機能5個 (ADR-059) は削除操作を出さない。トグルでの無効化のみ許す
            const isStandard = BookshelfPluginLoader.STANDARD_PLUGIN_IDS.includes(id);
            const uninstallBtn = isStandard
                ? ''
                : `<button type="button" class="btn btn-small btn-icon-only btn-danger plugin-card-uninstall" data-uninstall-plugin="${id}" title="アンインストール">${icoBtn('trash-2')}</button>`;
            // 状態ラベル: 読み込み失敗 / 無効のみ表示。有効はトグル ON で自明なので出さない (情報量を減らす)
            let stateLabel = '';
            if (enabled && !loaded)  stateLabel = `<span class="plugin-state warn">${icoBtn('alert-triangle', 12)}読み込み失敗</span>`;
            else if (!enabled)       stateLabel = `<span class="plugin-state muted">${icoBtn('circle', 12)}無効</span>`;
            // 拡張点カテゴリ (無効でも表示: manifest 宣言 → 実行時推定 → キャッシュ)
            const cats = this._getPluginCategories(id, m, loaded);
            const catBadges = this._renderPluginCategoryBadges(cats);
            const nameForSearch = (m.name || id || '').slice(0, VirtualBookshelf.PLUGIN_SEARCH_NAME_LIMIT);
            const descForSearch = (m.description || '').slice(0, VirtualBookshelf.PLUGIN_SEARCH_DESC_LIMIT);
            const searchText = `${nameForSearch}${descForSearch}`.toLowerCase();
            // 検索文字列の HTML 属性用エスケープ
            const searchAttr = BookshelfEscape.escapeHtml(searchText);
            // アイコン (override 優先 → manifest.icon → 既定 puzzle)。常に chip 表示にして一覧を走査しやすく
            const currentIcon = this._getPluginIconOverride(id) || m.icon || '';
            const iconChip = `<span class="pcard-icon${enabled ? '' : ' is-off'}" data-icon-value="${(currentIcon || '').replace(/"/g, '&quot;')}"${currentIcon ? ` title="現在のアイコン: ${currentIcon}"` : ''}>${window.renderIcon(currentIcon || 'puzzle', { size: 18 })}</span>`;
            const publishableBadge = m.publishable
                ? `<span class="plugin-publishable-badge" title="公開エクスポート対象">${window.renderIcon('globe', { size: 12 })}</span>`
                : '';
            const standardBadge = isStandard
                ? `<span class="plugin-standard-badge" title="標準機能: トグルで無効化できます">${window.renderIcon('lock', { size: 12 })}</span>`
                : '';
            // 縦型カード: 1行目=アイコン+名前+メタ+トグル / 分類バッジ / 説明(2行省略) / 設定・削除
            // イシュー#453・②決裁2026-11-02: ui-standards §7 原則7(1行1内容)。名前行にバッジが
            // 同居していた旧実装から、バッジをバージョン/状態と同じメタ行へ移した(直し方は
            // tmp/453/453-step1-notes.md §(c))。
            return `
                <div class="plugin-card-v2 ${enabled ? '' : 'is-disabled'}" data-plugin-id="${id}" data-search-text="${searchAttr}">
                    <div class="pcard-head">
                        ${iconChip}
                        <div class="pcard-headtext">
                            <div class="pcard-name"><strong>${m.name || id}</strong></div>
                            <div class="pcard-meta"><span class="pcard-version">v${m.version || '?'}</span>${stateLabel}${publishableBadge}${standardBadge}</div>
                        </div>
                        <div class="pcard-toggle">${toggle}</div>
                    </div>
                    ${catBadges}
                    ${m.description ? `<div class="plugin-card-desc">${m.description}</div>` : ''}
                    <div class="plugin-card-actions">${settingsBtn}${uninstallBtn}</div>
                </div>
            `;
        }).join('');

        this._bindPluginListEvents();
        this._applyPluginSearchFilter();
    }

    // ===== マーケット (公式カタログ。ADR-040 Phase1) =====
    // ⚠️ C-251 (2026-07-27) でマーケット UI は撤去 (アプリ内カタログ非表示・#plugin-market-section も index.html から削除済み)。
    //    以下の描画コードと hub 側カタログ API・seed 12 個は「将来の再追加」に備えて温存 — 呼び出し側が無いだけ。
    // ハブの公開レジストリ GET /plugins を読み、カード一覧 + ワンタップ導入 (SHA ピン) を出す。
    // 認証不要 (公開) なのでハブ未接続でも閲覧可。導入は同期先の接続が必要。
    async _renderMarketSection() {
        const host = document.getElementById('plugin-market-section');
        if (!host) return;
        const apiBase = (SyncConfigManager.load().hub?.apiBase) || 'https://hub.asayake.org';
        const icoBtn = (n, s = 14) => `<span class="h-icon">${window.renderIcon(n, { size: s })}</span>`;
        host.innerHTML = '<p style="color:var(--muted);">マーケットを読み込み中…</p>';
        let plugins = [];
        try {
            const res = await fetch(`${apiBase}/plugins`, { method: 'GET' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            plugins = Array.isArray(data.plugins) ? data.plugins : [];
        } catch (e) {
            host.innerHTML = `<p style="color:var(--muted);">マーケットを読み込めませんでした（${BookshelfEscape.escapeHtml(e.message)}）。 <button type="button" class="btn btn-small" id="market-retry">再試行</button></p>`;
            host.querySelector('#market-retry')?.addEventListener('click', () => this._renderMarketSection());
            return;
        }
        if (plugins.length === 0) {
            host.innerHTML = '<p style="color:var(--muted);">公開中のプラグインはまだありません。</p>';
            return;
        }
        let installedIds = new Set();
        if (this.pluginLoader && this._isSyncReady()) {
            try { installedIds = new Set((await this.pluginLoader.listInstalledPlugins()).map(p => p.id)); } catch (_) {}
        }
        const esc = BookshelfEscape.escapeHtml;
        host.innerHTML = plugins.map(p => {
            const installed = installedIds.has(p.id);
            const catBadges = this._renderPluginCategoryBadges(Array.isArray(p.categories) ? p.categories : []);
            const action = installed
                ? `<span class="plugin-state muted">${icoBtn('check', 12)}導入済み</span>`
                : `<button type="button" class="btn btn-small btn-primary market-install-btn" data-market-id="${esc(p.id)}">${icoBtn('download')}導入</button>`;
            return `
                <div class="plugin-card-v2" data-market-card="${esc(p.id)}">
                    <div class="pcard-head">
                        <span class="pcard-icon">${window.renderIcon(p.icon || 'puzzle', { size: 18 })}</span>
                        <div class="pcard-headtext">
                            <div class="pcard-name"><strong>${esc(p.name || p.id)}</strong></div>
                            ${p.author ? `<div class="pcard-meta"><span class="pcard-version">${esc(p.author)}</span></div>` : ''}
                        </div>
                    </div>
                    ${catBadges}
                    ${p.description ? `<div class="plugin-card-desc">${esc(p.description)}</div>` : ''}
                    <div class="plugin-card-actions">${action}</div>
                </div>`;
        }).join('');
        host.querySelectorAll('.market-install-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.marketId;
                const entry = plugins.find(p => p.id === id);
                if (!entry) return;
                if (!this._isSyncReady()) { toast('先に「同期」で保存先を接続してください'); return; }
                btn.disabled = true;
                btn.innerHTML = `${icoBtn('loader')}導入中…`;
                try {
                    // SHA ピンで取得 (検証コード = 取得コード)。skipConfirm: マーケットの「導入」が確認の代わり
                    const m = await this.pluginLoader.installFromGitHub(entry.repoUrl, { sha: entry.sha, path: entry.path, skipConfirm: true });
                    if (m) {
                        toast(`「${entry.name || id}」を導入しました`);
                        await this._renderPluginListSection();
                        await this._renderMarketSection();
                    } else {
                        btn.disabled = false;
                        btn.innerHTML = `${icoBtn('download')}導入`;
                    }
                } catch (e) {
                    toast(`導入に失敗: ${e.message}`);
                    btn.disabled = false;
                    btn.innerHTML = `${icoBtn('download')}導入`;
                }
            });
        });
    }

    /** 拡張点カテゴリ → 表示メタ (バッジ + 説明)。一般ユーザ向けに「何をする種類か」を説明。 */
    _pluginCategoryMeta() {
        return {
            command:  { label: 'コマンド',     icon: 'terminal',          desc: 'コマンドパレット（⌘K / Ctrl+K）から呼び出せる操作を追加します。' },
            widget:   { label: 'ウィジェット', icon: 'layout-dashboard',  desc: 'ホーム画面に置けるカード（パネル）を追加します。' },
            detail:   { label: '本の詳細',     icon: 'panel-right',       desc: '本を開いたときの詳細パネルに情報や項目を追加します。' },
            view:     { label: '表示',         icon: 'layout-grid',       desc: '本棚の見せ方（一覧の表示方法）を追加・変更します。' },
            theme:    { label: '見た目',       icon: 'palette',           desc: 'アプリ全体の配色やデザイン（テーマ）を変えます。' },
            button:   { label: 'ボタン',       icon: 'mouse-pointer-click', desc: 'サイドバーにワンタッチで使えるボタンを追加します。' },
            filter:   { label: '絞り込み',     icon: 'filter',            desc: '本の並び替え・絞り込みの条件を追加します。' },
            export:   { label: '書き出し',     icon: 'download',          desc: '蔵書データを別の形式で書き出します。' },
            settings: { label: '設定',         icon: 'sliders-horizontal', desc: 'このプラグイン専用の設定項目を持ちます。' }
        };
    }

    /** 分類マークの凡例 (設定 → プラグインの「?」) を描画 */
    _renderPluginCategoryLegend() {
        const host = document.getElementById('plugin-cat-legend');
        if (!host) return;
        const meta = this._pluginCategoryMeta();
        host.innerHTML = `
            <p class="plugin-cat-legend-intro">プラグインは下のような「分類」マークでどんな機能を足すか示します。1 つのプラグインが複数の分類を持つこともあります。</p>
            <ul class="plugin-cat-legend-list">
            ${Object.values(meta).map(m => `
                <li>
                    <span class="plugin-cat-badge">${window.renderIcon(m.icon, { size: 11 })}${BookshelfEscape.escapeHtml(m.label)}</span>
                    <span class="plugin-cat-legend-desc">${BookshelfEscape.escapeHtml(m.desc)}</span>
                </li>`).join('')}
            </ul>`;
    }

    _renderPluginCategoryBadges(cats) {
        if (!Array.isArray(cats) || !cats.length) return '';
        const meta = this._pluginCategoryMeta();
        const badges = cats.map(c => {
            const m = meta[c] || { label: c, icon: 'puzzle', desc: '' };
            const tip = m.desc ? `${m.label}: ${m.desc}` : m.label;
            return `<span class="plugin-cat-badge" title="${BookshelfEscape.escapeHtml(tip)}">${window.renderIcon(m.icon, { size: 11 })}${BookshelfEscape.escapeHtml(m.label)}</span>`;
        }).join('');
        return `<div class="plugin-card-cats">${badges}</div>`;
    }


    _loadPluginContribCache() {
        try { return JSON.parse(localStorage.getItem(VirtualBookshelf.PLUGIN_CONTRIB_CACHE_KEY)) || {}; }
        catch (_) { return {}; }
    }
    _setPluginContribCache(id, cats) {
        try {
            const cache = this._loadPluginContribCache();
            cache[id] = cats;
            localStorage.setItem(VirtualBookshelf.PLUGIN_CONTRIB_CACHE_KEY, JSON.stringify(cache));
        } catch (_) {}
    }

    /**
     * プラグインの分類 (categories) を解決。無効状態でも極力表示できるよう多段で求める。
     *  1) manifest.categories (宣言) — 無効でも常に出せる
     *  2) ロード中なら実行時の登録内容から推定 (+キャッシュに保存)
     *  3) 過去にロードしたときのキャッシュ — 今は無効でも出せる
     */
    _getPluginCategories(id, manifest, loaded) {
        if (Array.isArray(manifest?.categories) && manifest.categories.length) {
            this._setPluginContribCache(id, manifest.categories);
            return manifest.categories;
        }
        if (loaded) {
            const c = this.pluginAPI.getPluginContributions(id) || [];
            if (c.length) { this._setPluginContribCache(id, c); return c; }
        }
        const cached = this._loadPluginContribCache()[id];
        return Array.isArray(cached) ? cached : [];
    }

    /** プラグインの manifest を取得 (loaded でも disabled でも) */
    _getPluginManifest(id) {
        const loaded = this.pluginLoader?.getManifest?.(id);
        if (loaded) return loaded;
        const rec = (this.pluginLoader?._installed || []).find(p => p.id === id);
        return (rec && rec.manifest) || {};
    }

    /** プラグインごとの設定モーダルを開く (アイコン変更・有効切替・プラグイン固有設定を集約) */
    _openPluginSettings(id) {
        const manifest = this._getPluginManifest(id);
        const loaded = !!this.pluginLoader?.loaded?.has(id);
        const enabled = !new Set(this.userData?.settings?.disabledPlugins || []).has(id);
        const ico = (n, s = 14) => `<span class="h-icon">${window.renderIcon(n, { size: s })}</span>`;
        const overrideKey = `plugin:${id}`;

        let modal = document.getElementById('plugin-settings-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'plugin-settings-modal';
            modal.className = 'plugin-settings-modal';
            modal.innerHTML = `
                <div class="psm-backdrop"></div>
                <div class="psm-panel" role="dialog" aria-modal="true">
                    <div class="psm-head">
                        <span class="psm-head-icon"></span>
                        <div class="psm-head-text">
                            <h3 class="psm-title"></h3>
                            <div class="psm-head-sub"></div>
                        </div>
                        <button type="button" class="psm-close" title="閉じる"></button>
                    </div>
                    <div class="psm-body"></div>
                </div>`;
            document.body.appendChild(modal);
            const close = ({ fromHistory = false } = {}) => {
                this._overlays().close('plugin-settings-modal', { reason: 'button' });
                this._surface().close('plugin-settings-modal', { fromHistory });
            };
            modal.querySelector('.psm-backdrop').addEventListener('click', () => close());
            modal.querySelector('.psm-close').addEventListener('click', () => close());
            this._pluginSettingsModalClose = close;
            // ESC: .modal でない独自実装のため共通ハンドラの対象外 → 自前で閉じる。
            // 上にアイコンピッカー等の .modal が開いているときはそちら優先 (最前面だけ閉じる)
            window.Surface.onEsc(document, (e) => {
                if (e.defaultPrevented) return;
                if (!modal.classList.contains('show')) return;
                // プラグイン設定の上に開き得る .modal はアイコンピッカーだけ (設定モーダルは常に下)。
                // 「.modal が1つでも開いていれば譲る」だと設定の上では誰も閉じなかった (イシュー#284 X11)
                if (document.querySelector('#icon-picker-modal.show')) return;
                close();
                e.preventDefault();
            });
        }
        modal.querySelector('.psm-close').innerHTML = window.renderIcon('x', { size: 18 });

        const cats = this._getPluginCategories(id, manifest, loaded);
        // このプラグインがサイドバーに UI ボタンを持つか (持つ場合のみ「アイコンを表示」トグルを出す)
        const hasButton = !!this.pluginAPI?._uiButtons?.some(b => b.pluginId === id);
        const iconShown = !this._isPluginButtonHidden(id);

        const currentIcon = this.getHeaderIconOverride(overrideKey) || manifest.icon || '';

        // ヘッダー: アイコン + 名前 + (version, カテゴリバッジ)
        const headIcon = modal.querySelector('.psm-head-icon');
        headIcon.className = `psm-head-icon ${enabled ? '' : 'is-off'}`;
        headIcon.innerHTML = currentIcon
            ? window.renderIcon(currentIcon, { size: 22 })
            : window.renderIcon('puzzle', { size: 22 });
        modal.querySelector('.psm-title').textContent = manifest.name || id;
        modal.querySelector('.psm-head-sub').innerHTML =
            `<span class="psm-version">v${BookshelfEscape.escapeHtml(manifest.version || '?')}</span>${this._renderPluginCategoryBadges(cats)}`;

        const stateClass = enabled ? (loaded ? 'ok' : 'warn') : 'muted';
        const stateText  = enabled ? (loaded ? '有効' : '読み込み失敗') : '無効';

        const body = modal.querySelector('.psm-body');
        body.innerHTML = `
            ${manifest.description ? `<p class="psm-desc">${BookshelfEscape.escapeHtml(manifest.description)}</p>` : ''}

            <div class="psm-enable-card ${enabled ? 'is-on' : 'is-off'}">
                <div class="psm-enable-text">
                    <div class="psm-enable-title">プラグインを有効にする</div>
                    <div class="psm-enable-state ${stateClass}">${ico(enabled ? (loaded ? 'circle-check' : 'alert-triangle') : 'circle', 12)}${stateText}</div>
                </div>
                <label class="toggle-switch toggle-switch-lg" title="${enabled ? 'クリックで無効化' : 'クリックで有効化'}">
                    <input type="checkbox" class="psm-toggle-input" ${enabled ? 'checked' : ''}>
                    <span class="toggle-switch-track"><span class="toggle-switch-thumb"></span></span>
                </label>
            </div>

            <div class="psm-section">
                <div class="psm-section-title">外観</div>
                <div class="psm-field">
                    <div class="psm-field-main">
                        <span class="psm-field-label">アイコン</span>
                        <span class="psm-field-hint">ヘッダーボタン・一覧で使われます</span>
                    </div>
                    <span class="psm-icon-preview ${currentIcon ? '' : 'psm-icon-none'}" ${currentIcon ? `data-icon-value="${currentIcon.replace(/"/g, '&quot;')}"` : ''}>${window.renderIcon(currentIcon || 'puzzle', { size: 20 })}</span>
                    <button type="button" class="btn btn-small psm-icon-change">${ico('palette')}変更</button>
                    <button type="button" class="btn btn-small btn-secondary psm-icon-reset">既定</button>
                </div>
                ${hasButton ? `
                <div class="psm-field">
                    <div class="psm-field-main">
                        <span class="psm-field-label">サイドバーにアイコンを表示</span>
                        <span class="psm-field-hint">OFF にしてもプラグインの機能は有効のままです</span>
                    </div>
                    <label class="toggle-switch" title="${iconShown ? 'クリックで非表示' : 'クリックで表示'}">
                        <input type="checkbox" class="psm-show-icon-input" ${iconShown ? 'checked' : ''}>
                        <span class="toggle-switch-track"><span class="toggle-switch-thumb"></span></span>
                    </label>
                </div>` : ''}
            </div>

            <div class="psm-section">
                <div class="psm-section-title">プラグイン設定</div>
                <div id="psm-plugin-custom"></div>
            </div>`;

        // アイコン変更
        body.querySelector('.psm-icon-change').addEventListener('click', async () => {
            const picked = await this.openIconPicker({
                title: `プラグイン「${manifest.name || id}」のアイコン`,
                current: this.getHeaderIconOverride(overrideKey) || manifest.icon || ''
            });
            if (picked === null) return;
            this.setHeaderIconOverride(overrideKey, picked || null);
            this._openPluginSettings(id);            // モーダル再描画
            this._renderPluginListSection();         // 一覧のプレビューも更新
            this._applyHeaderLayout();
        });
        body.querySelector('.psm-icon-reset').addEventListener('click', () => {
            this.setHeaderIconOverride(overrideKey, null);
            this._openPluginSettings(id);
            this._renderPluginListSection();
            this._applyHeaderLayout();
        });

        // 「サイドバーにアイコンを表示」トグル (有効のままアイコンだけ隠す)
        const showIconInput = body.querySelector('.psm-show-icon-input');
        if (showIconInput) {
            showIconInput.addEventListener('change', async (e) => {
                await this._setPluginButtonHidden(id, !e.target.checked);
                this._openPluginSettings(id);    // 状態を反映して再描画
            });
        }

        // 有効/無効トグル (スイッチ)
        body.querySelector('.psm-toggle-input').addEventListener('change', async (e) => {
            const next = e.target.checked;
            try {
                await this.togglePlugin(id, next);
                await this._renderPluginListSection();
                this._applyHeaderLayout();
                this._openPluginSettings(id);        // 状態を反映して再描画
            } catch (err) {
                toast((next ? '有効化' : '無効化') + '失敗: ' + err.message);
                this._openPluginSettings(id);
            }
        });

        // プラグイン固有設定 (有効 + registerSettings 済みのみ)
        const host = body.querySelector('#psm-plugin-custom');
        const renderer = loaded ? this.pluginAPI.getPluginSettingsRenderer(id) : null;
        if (renderer) {
            try { renderer(host, this.pluginAPI.forPlugin(id)); }
            catch (e) { host.innerHTML = `<p class="psm-muted">設定の描画に失敗: ${BookshelfEscape.escapeHtml(e.message || String(e))}</p>`; }
        } else {
            host.innerHTML = `<p class="psm-muted">このプラグイン固有の設定はありません${enabled ? '' : '（有効化すると表示される場合があります）'}。</p>`;
        }

        if (typeof window.applyIcons === 'function') window.applyIcons(body);
        this._overlays().open(modal, { kind: 'modal', size: 'md', hist: false }); // 重なり管理役 (イシュー#367 step5): md
        this._surface().open('plugin-settings-modal', { close: (o) => this._pluginSettingsModalClose(o), extra: { pluginId: id } });
    }

    _applyPluginSearchFilter() {
        const input = document.getElementById('plugin-search');
        if (!input) return;
        const q = (input.value || '').toLowerCase().trim();
        const host = document.getElementById('plugin-list-section');
        if (!host) return;
        host.querySelectorAll('.plugin-card-v2').forEach(card => {
            if (!q) { card.style.display = ''; return; }
            // 検索範囲はカード textContent ではなく data-search-text (= タイトル+説明、各々文字数制限) のみ
            const text = card.dataset.searchText || '';
            card.style.display = text.includes(q) ? '' : 'none';
        });
    }

    /**
     * sourceId のプラグインを index 位置に挿入して順序を保存、再描画
     */
    async _reorderPluginByIndex(sourceId, index) {
        const host = document.getElementById('plugin-list-section');
        if (!host) return;
        const cards = Array.from(host.querySelectorAll('.plugin-card-v2'));
        const ids = cards.map(c => c.dataset.pluginId);
        const fromIdx = ids.indexOf(sourceId);
        if (fromIdx < 0) return;
        ids.splice(fromIdx, 1);
        const insertAt = Math.max(0, Math.min(index > fromIdx ? index - 1 : index, ids.length));
        ids.splice(insertAt, 0, sourceId);
        this._savePluginOrder(ids);
        await this._renderPluginListSection();
    }

    _bindPluginListEvents() {
        const host = document.getElementById('plugin-list-section');
        if (!host) return;
        if (this._pluginListAbort) {
            try { this._pluginListAbort.abort(); } catch (_) {}
        }
        this._pluginListAbort = new AbortController();
        const signal = this._pluginListAbort.signal;

        // 検索バー (host の外側)
        const searchInput = document.getElementById('plugin-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => this._applyPluginSearchFilter(), { signal });
        }

        // ===== D&D による並び替え (Pointer Events化=イシュー#337、行間ハイライトは踏襲) =====
        this._bindPointerReorder(host, {
            itemSelector: '.plugin-card-v2',
            // 操作系 (トグル/ボタン/入力) の上ではドラッグ開始しない (誤操作防止)
            excludeSelector: '.plugin-card-actions, .pcard-toggle, label, button, input, select',
            dragClass: 'is-dragging',
            zoneMode: 'index',
            indicatorClass: 'plugin-drop-indicator',
            computeInsertIndex: (container, clientX, clientY) => this._computeInsertIndexByY(container, '.plugin-card-v2', clientY),
            getKey: (el) => el.dataset.pluginId,
            onDrop: (id, idx) => this._reorderPluginByIndex(id, idx),
        });

        // 有効/無効トグル (checkbox の change)
        host.addEventListener('change', (e) => {
            const toggle = e.target.closest('[data-toggle-plugin]');
            if (!toggle) return;
            const id = toggle.dataset.togglePlugin;
            const next = toggle.checked;
            (async () => {
                try {
                    await this.togglePlugin(id, next);
                    this._applyHeaderLayout();
                    await this._renderPluginListSection();
                } catch (err) {
                    toast((next ? '有効化' : '無効化') + '失敗: ' + err.message);
                    await this._renderPluginListSection();
                }
            })();
        }, { signal });

        host.addEventListener('click', async (e) => {
            const uninstall = e.target.closest('[data-uninstall-plugin]');
            if (uninstall) {
                e.stopPropagation();
                const id = uninstall.dataset.uninstallPlugin;
                // イシュー#518: 確認待ち中の連打で二重アンインストールにならないよう disabled にする。
                uninstall.disabled = true;
                const ok = await window.confirmDialog({ message: `プラグイン "${id}" を削除しますか？同期フォルダから plugins/${id}/ も削除されます。`, danger: true });
                if (!ok) { uninstall.disabled = false; return; }
                (async () => {
                    try {
                        await this.uninstallPluginById(id);
                        this._applyHeaderLayout();
                        await this._renderPluginListSection();
                    } catch (err) {
                        toast('アンインストール失敗: ' + err.message);
                    }
                })();
                return;
            }
            const settingsBtn = e.target.closest('[data-settings-plugin]');
            if (settingsBtn) {
                e.stopPropagation();
                this._openPluginSettings(settingsBtn.dataset.settingsPlugin);
                return;
            }
        }, { signal });
    }

    /** サイドバーユーティリティの D&D 並び替えで呼ばれる。placement を index へ移動して保存・再適用。 */
    _reorderHeaderPlacement(placementId, index) {
        const layout = this._currentHeaderLayout();
        const fromIdx = layout.items.findIndex(it => it.id === placementId);
        if (fromIdx < 0) return;
        const [item] = layout.items.splice(fromIdx, 1);
        const insertAt = Math.max(0, Math.min(index > fromIdx ? index - 1 : index, layout.items.length));
        layout.items.splice(insertAt, 0, item);
        this._saveHeaderLayout(layout);
        this._applyHeaderLayout();
    }

    _closeSettingsModal(opts = {}) {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;
        // 重なり管理役経由 (イシュー#367): .show を外し → onClose (一覧表示へ戻すDOM後片付け) → hooks.onClose
        // (settings-modal の段。settings-cat が残っていれば nav.closeSettings で一括除去・イシュー#494)
        const fromHistory = !!opts.fromHistory;
        if (this._overlays().close('settings-modal', { reason: fromHistory ? 'history' : 'button', fromHistory })) return;
        // 管理役に載っていない (読み込み前等) 時の従来の閉じ方
        modal.classList.remove('show');
        this._surface().close('settings-cat');
        this._surface().close('settings-modal', { fromHistory });
        this._showSettingsMaster(); // 次回開いた時のために一覧へ戻す
    }

    // 公開などで設定が未完のとき、警告だけで終わらせず confirmDialog から設定の該当箇所へ誘導する。
    async _confirmOpenSettings(message, targetId) {
        const ok = await confirmDialog({ title: '設定が必要です', message, okLabel: '設定を開く', cancelLabel: '閉じる' });
        if (!ok) return;
        // 確認を経て設定へ行く = 公開の仕事をやめる入口なので、開いている公開系の面を閉じてから開く。
        // イシュー#513 S6: 「close直後にopen」の2回apply構成(go予約→push)は、全幅化でPCでも段を積む
        // ようになった結果、goがmicrotaskで未消化のまま次のpushがreplaceへ変換され、残ったgoが
        // 書き換え済みの段を後から巻き戻す競合を起こす(実測・#513 step3・username-publish-gate等)。
        // 重なり(見た目)だけここで閉じ、段はSurface.switchTo(_openSettingsModalのswitchFrom)で1回に。
        // 記事編集中の設定リンクは閉じずに上に積む (_closeOverlaysForTransition・イシュー#367)
        const PUBLISH_FACE_IDS = ['art-edit-mode', 'art-viewing', 'art-publish-modal', 'publish-settings-modal', 'publish-pages-modal'];
        // イシュー#513 S6 step5(②承認時の実測で発見・修正): 見た目(overlays)で実際に開いている
        // ものを閉じる判定は、段(nav.hasFace)とは別に取る。フラグ旧ではPCで段を積まないため、
        // 見た目は開いていてもhasFaceはfalseになり、見た目を閉じ忘れる退行があった
        // (実測・overlay-front.spec.js:163「確認ダイアログ経由は公開モーダルを閉じる」)。
        const ov = this._overlays();
        const openOverlayIds = PUBLISH_FACE_IDS.filter((id) => ov.has(id));
        for (const id of openOverlayIds) ov.close(id, { reason: 'program' });
        // 段の操作(Surface.switchTo)は、実際にfacesにある面だけを対象にする(フラグ新で段を積む面のみ・
        // フラグ旧ならここは空配列になり_openSettingsModalは通常のhist:trueパスを使う=無改修で安全)
        const openFaceIds = this.nav ? PUBLISH_FACE_IDS.filter((id) => this.nav.hasFace(id)) : [];
        if (openOverlayIds.length) this._artMode = 'view';
        await this._openSettingsModal(targetId, { switchFrom: openFaceIds });
    }

    // ===== プラグイン管理 UI (U8a補完・イシュー#544。U8a(#537)の棚卸し漏れ。
    // showPluginsModal/closePluginsModalは呼び出し元0件・対応モーダルDOMも無い
    // デッドコードだったため削除。詳細はdocs/char/u8a2-step1-scope.md) =====

    async _renderPluginsList() {
        const container = document.getElementById('plugins-list');
        if (!container || !this.pluginLoader) {
            container.innerHTML = '<p style="color:var(--muted)">プラグインローダ未初期化</p>';
            return;
        }
        container.innerHTML = '<p style="color:var(--muted);">読み込み中...</p>';

        if (!this._isSyncReady()) {
            container.innerHTML = '<p style="color:var(--muted);">同期先 (ローカルフォルダ or GitHub) を先に接続してください。</p>';
            return;
        }

        let installed;
        try {
            installed = await this.pluginLoader.listInstalledPlugins({ refresh: true });
        } catch (e) {
            container.innerHTML = `<p style="color:var(--danger);">読み込み失敗: ${e.message}</p>`;
            return;
        }

        if (installed.length === 0) {
            container.innerHTML = '<p style="color:var(--muted);">インストール済みのプラグインはありません。</p>';
            return;
        }

        const disabledSet = new Set(this.userData?.settings?.disabledPlugins || []);
        const loadedSet = new Set(this.pluginLoader.loaded.keys());

        container.innerHTML = installed.map(({ id, manifest }) => {
            const enabled = !disabledSet.has(id);
            return `
                <div class="plugin-card" data-plugin-card="${id}" style="border:1px solid #ddd; border-radius:6px; padding:0.8rem; margin-bottom:0.6rem; display:flex; justify-content:space-between; align-items:center; gap:0.8rem; flex-wrap:wrap;">
                    <div style="flex:1 1 200px; min-width:0;">
                        <div style="font-weight:600;">${manifest.name || id} <span style="color:var(--muted); font-weight:normal; font-size:0.85rem;">v${manifest.version || '?'} ${manifest.publishable ? '' : ''}</span></div>
                        <div style="font-size:0.85rem; color:var(--muted);">${manifest.description || ''}</div>
                        <div class="plugin-status"></div>
                    </div>
                    <div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">
                        <label style="display:flex; gap:0.3rem; align-items:center; font-size:0.85rem;">
                            <input type="checkbox" data-toggle-plugin="${id}" ${enabled ? 'checked' : ''}> 有効
                        </label>
                        <button class="btn btn-secondary btn-small" data-uninstall-plugin="${id}">削除</button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('[data-toggle-plugin]').forEach(cb => {
            cb.addEventListener('change', (e) => this.togglePlugin(e.target.dataset.togglePlugin, e.target.checked));
        });
        container.querySelectorAll('[data-uninstall-plugin]').forEach(btn => {
            btn.addEventListener('click', (e) => this.uninstallPluginById(e.target.dataset.uninstallPlugin));
        });

        // 各カードの status 部分のみ部分更新
        installed.forEach(({ id }) => this._refreshPluginCardStatus(id));
    }

    /**
     * トグル時に DOM 全体を再描画せず、該当カードの status 部分だけ更新
     * （checkbox 含む再生成を避けて UI チラつき/フォーカス喪失を防ぐ）
     */
    _refreshPluginCardStatus(id) {
        const container = document.getElementById('plugins-list');
        if (!container) return;
        const statusEl = container.querySelector(`[data-plugin-card="${CSS.escape(id)}"] .plugin-status`);
        if (!statusEl) return;
        const loaded = this.pluginLoader && this.pluginLoader.loaded.has(id);
        const failure = this.pluginLoader && this.pluginLoader.failedToLoad.get(id);
        let html = '';
        if (failure) html += `<div style="font-size:0.8rem; color:var(--danger);">${failure}</div>`;
        if (loaded) html += '<div style="font-size:0.8rem; color:var(--success, #3aa657);">✓ 読み込み済み（リロード不要で有効）</div>';
        statusEl.innerHTML = html;
    }

    async installPluginFromInput() {
        const input = document.getElementById('plugin-repo-url');
        const url = (input.value || '').trim();
        if (!url) {
            toast('プラグインがある GitHub の場所（URL）を入力してください');
            return;
        }
        if (!this._isSyncReady()) {
            toast('先に「同期」で保存先（Asayake ハブ・この端末のフォルダ・GitHub のどれか）を設定してください');
            return;
        }
        try {
            const manifest = await this.pluginLoader.installFromGitHub(url);
            if (manifest) {
                toast(`${manifest.name || manifest.id} v${manifest.version || '?'} をインストールしました`);
                // 新規プラグインをサイドバー(ボタン)と一覧に反映
                this._applyHeaderLayout();
                await this._renderPluginListSection();
                input.value = '';
            }
        } catch (e) {
            toast(`インストール失敗: ${e.message}`);
        }
    }

    async togglePlugin(id, enabled) {
        if (!this.userData.settings) this.userData.settings = {};
        if (!Array.isArray(this.userData.settings.disabledPlugins)) this.userData.settings.disabledPlugins = [];
        const list = this.userData.settings.disabledPlugins;
        // オプトアウト: enabled=true なら disabled から除去、false なら追加
        if (enabled) {
            this.userData.settings.disabledPlugins = list.filter(x => x !== id);
        } else if (!list.includes(id)) {
            list.push(id);
        }
        await this.saveUserData();
        // 即時反映: 有効化→_loadPlugin, 無効化→unloadPlugin（リロード不要）
        if (enabled && !this.pluginLoader.loaded.has(id)) {
            const installed = await this.pluginLoader.listInstalledPlugins({ refresh: true });
            const target = installed.find(p => p.id === id);
            if (target) await this.pluginLoader._loadPlugin(target);
        } else if (!enabled && this.pluginLoader.loaded.has(id)) {
            await this.pluginLoader.unloadPlugin(id);
        }
        // モーダル全体は再描画せず、該当カードの status 部分だけ更新
        this._refreshPluginCardStatus(id);
    }

    async uninstallPluginById(id) {
        if (!(await window.confirmDialog({ message: `プラグイン "${id}" を削除しますか？\n同期フォルダの plugins/${id}/ も削除されます。`, danger: true }))) return;
        try {
            await this.pluginLoader.uninstall(id);
            await this._renderPluginsList();
        } catch (e) {
            toast(`削除失敗: ${e.message}`);
        }
    }

}

const _settingsDescriptors = Object.getOwnPropertyDescriptors(_SettingsMethods.prototype);
delete _settingsDescriptors.constructor;
Object.defineProperties(VirtualBookshelf.prototype, _settingsDescriptors);
