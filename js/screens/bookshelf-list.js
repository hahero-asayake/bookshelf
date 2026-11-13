// 本棚の一覧とツリー (js/screens/bookshelf-list.js)
// イシュー#545 (U8d): bookshelf.js の VirtualBookshelf が持っていたサイドバーの本棚ツリー・
// 本棚の一覧画面・本棚の作成編集フォーム(画面部分)専用メソッド13個(サイドバーツリー4 + 本棚一覧
// 画面8 + フォームのリロード対応1 = 13。範囲の確定は docs/char/u8d-step1-scope.md §1) を、
// ここへ移した(移動のみ・本文は1行も書き換えていない)。
//
// 取り付け方 (Plan A・U7(article-editor.js)/U8a(settings.js)/U8b(book-detail.js)/
// U8c(import.js)と同じ形・docs/char/u7-step1-scope.md §7参照):
// 下の class 本体に書いたメソッドは、匿名クラスの prototype から記述子を取り出し、
// VirtualBookshelf.prototype へそのまま上書き定義する。class構文のまま(オブジェクトリテラルの
// カンマ区切りに変換しない)なので、各メソッドの見出し・本体は元のbookshelf.jsと一字一句同じ。
// 呼ばれる時の this は今までと同じ VirtualBookshelf インスタンスを指す
// (window.bookshelf.showBookshelfManager(...) などは無変更で動く・テストの直接呼び出しも同様。
// plugin-api.jsからの直接参照は0件・§4参照)。
//
// 依存の前提(②指示・#545 step1): setupBookshelfDragAndDrop と _renderSidebarTree は
// this._bindPointerReorder (U4・イシュー#517でjs/ui/reorder.jsへ抽出済み。bookshelf.js側に
// 1行委譲のメソッドが残る)に依存する。Plan Aでは全メソッドが同じVirtualBookshelf.prototypeに
// 乗るため、移動先ファイルが分かれても this._bindPointerReorder(...) の呼び出しは無変更で動く
// (book-detail.js・dashboard.js・settings.jsの既存3箇所も同じ形で動いている)。
//
// 移さなかったもの(実測の結果、依頼の想定と異なり共通部品/データ操作主体と判明したもの含む)は
// docs/char/u8d-step1-scope.md §2 参照(saveBookshelfForm・deleteBookshelf・addBookToBookshelf・
// updateDisplay系・_renderBookshelfCard・_bindBookshelfOverviewEvents・_bookshelvesInTreeOrder・
// switchBookshelf系 等)。

class _BookshelfListMethods {
    _renderSidebarTree() {
        const container = document.getElementById('sidebar-bookshelf-tree');
        if (!container) return;
        const bookshelves = this.bookshelfManager?.getBookshelves?.() || [];
        if (bookshelves.length === 0) {
            container.innerHTML = '<p class="tree-empty">本棚がありません</p>';
            return;
        }
        // 展開状態を localStorage から復元
        const expandedKey = 'bookshelf_treeExpanded_v1';
        let expanded;
        try {
            expanded = new Set(JSON.parse(localStorage.getItem(expandedKey) || '[]'));
        } catch { expanded = new Set(); }
        this._treeExpanded = expanded;

        const byParent = new Map(); // parent internalId -> [bookshelf]
        bookshelves.forEach(bs => {
            const key = bs.parent || null;
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key).push(bs);
        });

        const renderNode = (bs, depth) => {
            const nodeKey = this.bookshelfManager._keyOf(bs);  // internalId||id (実データは slug)
            const children = byParent.get(nodeKey) || [];
            const hasChildren = children.length > 0;
            const isExpanded = expanded.has(nodeKey);
            const bookCount = (bs.books && bs.books.length) || 0;
            const isActive = this.currentBookshelf && (bs.id === this.currentBookshelf || bs.internalId === this.currentBookshelf);

            const node = document.createElement('div');
            node.className = `tree-node lv${Math.min(depth, 4)}${isActive ? ' is-active' : ''}`;
            node.dataset.bookshelfId = bs.id;
            node.dataset.internalId = bs.internalId;
            node.dataset.special = bs.isSpecial ? '1' : '0';
            const toggleIconName = isExpanded ? 'chevron-down' : 'chevron-right';
            // 本棚の「アイコン+名前+冊数」は共通コンポーネントで描画 (ツリー固有の indent/more/toggle だけ付加)
            node.innerHTML = `
                <span class="tree-indent"></span>
                ${window.BookshelfUI.rowCore(bs, { count: bookCount })}
                <button class="tree-more" type="button" title="${bs.isSpecial ? '本棚の操作 (編集)' : '本棚の操作 (編集 / 子追加 / 削除)'}">${window.renderIcon('more-horizontal', { size: 14 })}</button>
                ${hasChildren
                    ? `<button class="tree-toggle" type="button" title="${isExpanded ? '折りたたむ' : '展開'}">${window.renderIcon(toggleIconName, { size: 12 })}</button>`
                    : '<span class="tree-toggle-placeholder"></span>'}
            `;
            // 本棚選択
            node.addEventListener('click', (e) => {
                if (e.target.closest('.tree-toggle') || e.target.closest('.tree-more')) return;
                this.switchBookshelf(bs.id);
            });
            // 本棚操作メニュー (Phase G: ツリーから直接編集)
            const moreBtn = node.querySelector('.tree-more');
            if (moreBtn) {
                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._openTreeNodeMenu(bs, moreBtn);
                });
            }
            // 展開トグル
            const toggleBtn = node.querySelector('.tree-toggle');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (expanded.has(nodeKey)) expanded.delete(nodeKey);
                    else expanded.add(nodeKey);
                    try { localStorage.setItem(expandedKey, JSON.stringify([...expanded])); } catch {}
                    this._renderSidebarTree();
                });
            }
            // ===== D&D: 並び替え (同階層) + 親変更 (Phase H2-2, Pointer Events化=イシュー#337) =====
            // 実際のバインドは container 単位 (_bindPointerReorder、_renderSidebarTree 末尾で1回だけ) で行う。

            container.appendChild(node);
            if (hasChildren && isExpanded) {
                children.forEach(child => renderNode(child, depth + 1));
            }
        };

        container.innerHTML = '';
        // ルート (parent なし)
        const roots = byParent.get(null) || [];
        // all 本棚を先頭に
        roots.sort((a, b) => {
            if (a.isSpecial && !b.isSpecial) return -1;
            if (!a.isSpecial && b.isSpecial) return 1;
            return 0;
        });
        roots.forEach(bs => renderNode(bs, 0));

        this._bindPointerReorder(container, {
            itemSelector: '.tree-node',
            canDrag: (el) => el.dataset.special !== '1',
            dragClass: 'tree-dragging',
            zoneMode: 'segment',
            zoneClassPrefix: 'tree-drop-',
            computeZone: (targetEl, clientY) => {
                if (targetEl.dataset.special === '1') return 'inside';
                const rect = targetEl.getBoundingClientRect();
                const y = clientY - rect.top;
                return y < rect.height * 0.3 ? 'before' : (y > rect.height * 0.7 ? 'after' : 'inside');
            },
            getKey: (el) => el.dataset.internalId,
            onDrop: (draggedId, targetId, zone) => this._onTreeDrop(draggedId, targetId, zone),
        });
    }

    // ツリー D&D のドロップ処理 (Phase H2-2)
    //   zone: 'before' | 'after' (= target の兄弟として並び替え) / 'inside' (= target の子にする)
    //   (T06: 確認モーダルが async のため async。drop ハンドラからの fire-and-forget で問題ない)
    async _onTreeDrop(draggedId, targetId, zone) {
        const bm = this.bookshelfManager;
        if (!bm || draggedId === targetId) return;
        const dragged = bm.getById(draggedId);
        const target = bm.getById(targetId);
        if (!dragged || !target || dragged.isSpecial) return;
        const allId = bm.getAllInternalId();

        let newParent, beforeId = null;
        if (zone === 'inside') {
            newParent = bm._keyOf(target);                 // target の子にする
        } else {
            newParent = target.isSpecial ? allId : (target.parent || allId);
            // 位置計算は必ず _keyOf (internalId||id) で行う。
            // 実データは internalId 欠落 (undefined) のため、.internalId 直参照だと
            // beforeId が常に undefined → reorderSibling が末尾追加になり「並べても末尾に飛ぶ」バグになる。
            if (zone === 'before') {
                beforeId = bm._keyOf(target);
            } else { // after
                const sibs = bm.getBookshelves().filter(b => (b.parent || allId) === newParent && bm._keyOf(b) !== draggedId);
                const idx = sibs.findIndex(b => bm._keyOf(b) === targetId);
                beforeId = (idx >= 0 && idx + 1 < sibs.length) ? bm._keyOf(sibs[idx + 1]) : null;
            }
        }
        if (!newParent) newParent = allId;

        if (!bm.canSetParent(draggedId, newParent)) {
            toast('循環参照になるため移動できません');
            return;
        }

        const sameParent = (dragged.parent || allId) === newParent;
        if (sameParent) {
            if (beforeId === draggedId) return;            // 変化なし
            bm.reorderSibling(draggedId, beforeId);
        } else {
            if (!(await this._applyReparentWithConfirm(draggedId, newParent))) return;
            bm.reorderSibling(draggedId, beforeId);
            // 親に入れたら展開して結果を見せる
            if (zone === 'inside') {
                try {
                    const key = 'bookshelf_treeExpanded_v1';
                    const set = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
                    set.add(newParent);
                    localStorage.setItem(key, JSON.stringify([...set]));
                } catch (_) {}
            }
        }

        this.saveUserData();
        if (typeof this.updateBookshelfSelector === 'function') this.updateBookshelfSelector();
        else this._renderSidebarTree();
        if (typeof this.renderBookshelfOverview === 'function') this.renderBookshelfOverview();
        if (typeof this._updateBookshelfViewTitle === 'function') this._updateBookshelfViewTitle();
        // 本棚管理モーダルが開いていれば同じ並びに更新 (左ペインと共通の挙動)
        const bsModal = document.getElementById('bookshelf-modal');
        if (bsModal && bsModal.classList.contains('show') && typeof this.renderBookshelfList === 'function') {
            this.renderBookshelfList();
        }
    }

    /**
     * ツリーノードの操作メニュー (Phase G): 編集 / 子本棚を追加 / 削除。
     */
    _openTreeNodeMenu(bs, anchorEl) {
        document.getElementById('tree-node-menu')?.remove();
        const ico = (n) => window.renderIcon(n, { size: 14 });
        const menu = document.createElement('div');
        menu.id = 'tree-node-menu';
        menu.className = 'tree-node-menu';
        // 特殊本棚(ALL)は編集のみ (slug/親はフォーム側でロック、削除・子追加は不可)
        menu.innerHTML = bs.isSpecial
            ? `<button type="button" data-act="edit">${ico('pencil')}<span>編集</span></button>`
            : `
            <button type="button" data-act="edit">${ico('pencil')}<span>編集</span></button>
            <button type="button" data-act="add-child">${ico('plus')}<span>子本棚を追加</span></button>
            <button type="button" data-act="delete" class="is-danger">${ico('trash-2')}<span>削除</span></button>
        `;
        document.body.appendChild(menu);
        const r = anchorEl.getBoundingClientRect();
        const menuW = 180;
        menu.style.top = `${r.bottom + 4}px`;
        menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menuW - 8))}px`;

        const cleanup = () => {
            if (!menu.isConnected) return; // 管理役の onClose 経由と二重に呼ばれても 1 回だけ
            menu.remove();
            document.removeEventListener('click', onOutside, true);
            document.removeEventListener('keydown', onKey, true);
            this._overlays().close('tree-node-menu', { reason: 'button' });
        };
        // 重なり管理役 (イシュー#367 step5): メニューは「移る前に閉じる」側 (kind:'menu'・closeOthers・履歴に積まない・旧 z-index 1200 は撤去)
        this._overlays().open(menu, { kind: 'menu', hist: false, showClass: null, size: 'none', onClose: () => cleanup() });
        const onOutside = (e) => { if (window.Surface.isOutside(e, menu)) cleanup(); };
        const onKey = (e) => { if (window.Surface.isEsc(e)) cleanup(); };
        menu.querySelector('[data-act="edit"]')?.addEventListener('click', () => { cleanup(); this.editBookshelf(bs.id); });
        menu.querySelector('[data-act="add-child"]')?.addEventListener('click', () => { cleanup(); this.showBookshelfForm(null, bs.internalId); });
        menu.querySelector('[data-act="delete"]')?.addEventListener('click', () => { cleanup(); this.deleteBookshelf(bs.id); });
        setTimeout(() => {
            document.addEventListener('click', onOutside, true);
            document.addEventListener('keydown', onKey, true);
        }, 0);
    }

    _updateSidebarActive() {
        const isMain = document.body.classList.contains('app-view-main');
        const tree = document.getElementById('sidebar-bookshelf-tree');
        if (tree) tree.querySelectorAll('.tree-node').forEach(node => {
            const id = node.dataset.bookshelfId;
            const internalId = node.dataset.internalId;
            const matches = !isMain && (this.currentBookshelf === id || this.currentBookshelf === internalId);
            node.classList.toggle('is-active', !!matches);
        });
        // 下部フッターの現在地ハイライト (ADR-047 P1)。ホーム=main ビュー / 本棚=本棚ビュー。
        // 検索・設定はモーダルなので持続ハイライトしない。
        const nav = document.getElementById('mobile-bottom-nav');
        if (nav) nav.querySelectorAll('[data-mobile-nav]').forEach(btn => {
            const a = btn.dataset.mobileNav;
            const active = (a === 'home' && isMain) || (a === 'shelves' && !isMain);
            btn.classList.toggle('is-active', active);
        });
    }

    showBookshelfManager() {
        const modal = document.getElementById('bookshelf-modal');
        this._overlays().open(modal, { kind: 'modal', size: 'lg', hist: false }); // 重なり管理役 (イシュー#367 step5): lg
        this.renderBookshelfList();
        this._surface().open('bookshelf-modal', { close: (o) => this.closeBookshelfModal(o) });
    }

    closeBookshelfModal({ fromHistory = false } = {}) {
        const modal = document.getElementById('bookshelf-modal');
        this._overlays().close('bookshelf-modal', { reason: fromHistory ? 'history' : 'button' });
        this._surface().close('bookshelf-modal', { fromHistory });
    }

    renderBookshelfList() {
        const container = document.getElementById('bookshelves-list');
        if (!this.userData.bookshelves) {
            this.userData.bookshelves = [];
        }
        const bm = this.bookshelfManager;

        // 左ペインツリーと同じ階層構造で並べる (parent||null でグループ化、ALL を先頭、深さ優先)。
        // これにより並び替え時も子は親の下にまとまって表示される。
        const byParent = new Map();
        this.userData.bookshelves.forEach(bs => {
            const key = bs.parent || null;
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key).push(bs);
        });
        const rows = [];
        const walk = (bs, depth) => {
            rows.push({ bs, depth });
            (byParent.get(bm._keyOf(bs)) || []).forEach(c => walk(c, depth + 1));
        };
        const roots = (byParent.get(null) || []).slice().sort((a, b) => {
            if (a.isSpecial && !b.isSpecial) return -1;
            if (!a.isSpecial && b.isSpecial) return 1;
            return 0;
        });
        roots.forEach(r => walk(r, 0));

        let html = '';
        rows.forEach(({ bs: bookshelf, depth }) => {
            const bookCount = bookshelf.books ? bookshelf.books.length : 0;
            const isSpecial = bookshelf.isSpecial || false;
            const specialBadge = isSpecial
                ? `<span class="special-badge"><span class="h-icon">${window.renderIcon('lock', { size: 12 })}</span>特殊</span>`
                : '';
            const dragHandle = isSpecial
                ? window.renderIcon('lock', { size: 14 })
                : window.renderIcon('grip-vertical', { size: 14 });
            const bsEffectiveIcon = bookshelf.iconName || 'library';
            const bsIconSvg = window.renderIcon(bsEffectiveIcon, { size: 16 });
            html += `
                <div class="bookshelf-item" data-id="${bookshelf.id}" data-internal-id="${bm._keyOf(bookshelf)}" data-special="${isSpecial ? '1' : '0'}" style="margin-left:${depth * 1.5}rem;">
                    <div class="bookshelf-drag-handle">${dragHandle}</div>
                    <div class="bookshelf-info">
                        <h4><span class="bookshelf-list-icon" data-icon-value="${bsEffectiveIcon.replace(/"/g,'&quot;')}">${bsIconSvg}</span>${bookshelf.name} ${specialBadge}</h4>
                        <p>${bookshelf.description || ''}</p>
                        <span class="book-count">${bookCount}冊</span>
                    </div>
                    <div class="bookshelf-actions">
                        <button class="btn btn-secondary edit-bookshelf" data-id="${bookshelf.id}">編集</button>
                        ${isSpecial ? '' : `<button class="btn btn-danger delete-bookshelf" data-id="${bookshelf.id}">削除</button>`}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        // Remove existing event listeners to prevent duplicates
        const oldContainer = container.cloneNode(true);
        container.parentNode.replaceChild(oldContainer, container);
        
        // Add event listeners for edit/delete/share buttons
        oldContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('edit-bookshelf')) {
                this.editBookshelf(e.target.dataset.id);
            } else if (e.target.classList.contains('delete-bookshelf')) {
                this.deleteBookshelf(e.target.dataset.id);
            }
        });

        // Add drag and drop functionality for bookshelf reordering
        this.setupBookshelfDragAndDrop(oldContainer);
    }

    addBookshelf() {
        this.showBookshelfForm();
    }

    showBookshelfForm(bookshelfToEdit = null, presetParentInternalId = null) {
        const modal = document.getElementById('bookshelf-form-modal');
        const title = document.getElementById('bookshelf-form-title');
        const nameInput = document.getElementById('bookshelf-name');
        const parentSelect = document.getElementById('bookshelf-parent');
        const iconNameInput = document.getElementById('bookshelf-icon-name');
        const iconLabel = document.getElementById('bookshelf-icon-label');
        const iconPreview = document.getElementById('bookshelf-icon-preview');
        const iconTrigger = document.getElementById('bookshelf-icon-trigger');
        const descriptionInput = document.getElementById('bookshelf-description');

        // 親本棚ドロップダウン構築（編集中は自身と子孫を除外）。
        // 実データは internalId 欠落のため _keyOf(=internalId||id) をキーに使う。
        // 先頭に「トップ階層」(=ルート直下, value="") を置く。ALL(特殊)は候補に出さない。
        const bm = this.bookshelfManager;
        const editKey = bookshelfToEdit ? bm._keyOf(bookshelfToEdit) : null;
        const excludedIds = bookshelfToEdit
            ? new Set([editKey, ...bm.getDescendants(editKey).map(b => bm._keyOf(b))])
            : new Set();
        const candidates = bm.getBookshelves().filter(b => !b.isSpecial && !excludedIds.has(bm._keyOf(b)));
        parentSelect.innerHTML = '<option value="">（トップ階層）</option>' + candidates
            .map(b => `<option value="${bm._keyOf(b)}">${BookshelfEscape.escapeHtml(b.name)}</option>`)
            .join('');

        const setIcon = (name) => {
            const effective = name || 'library';
            iconNameInput.value = effective;
            iconLabel.textContent = effective;
            iconPreview.dataset.iconValue = effective;
            iconPreview.innerHTML = window.renderIcon(effective, { size: 18 });
        };

        const titleIcon = `<span class="h-icon" data-icon="library" data-icon-size="20"></span>`;
        if (bookshelfToEdit) {
            title.innerHTML = `${titleIcon}本棚を編集`;
            if (typeof window.applyIcons === 'function') window.applyIcons(title);
            nameInput.value = bookshelfToEdit.name;
            parentSelect.value = bookshelfToEdit.parent || '';
            setIcon(bookshelfToEdit.iconName);
            descriptionInput.value = bookshelfToEdit.description || '';
            // 特殊本棚（all）は親変更不可。slug は自動採番・不変 (UI なし)
            if (bookshelfToEdit.isSpecial) {
                parentSelect.disabled = true;
                parentSelect.title = '特殊本棚は親を持てません';
            } else {
                parentSelect.disabled = false;
                parentSelect.title = '';
            }
        } else {
            title.innerHTML = `${titleIcon}新しい本棚`;
            if (typeof window.applyIcons === 'function') window.applyIcons(title);
            nameInput.value = '';
            // Phase G: ツリーから「子本棚を追加」した場合は親を事前選択
            parentSelect.value = presetParentInternalId || '';
            setIcon('library');
            descriptionInput.value = '';
        }

        // IconPicker トリガ (1 回だけ bind)
        if (iconTrigger && !iconTrigger._bound) {
            iconTrigger._bound = true;
            iconTrigger.addEventListener('click', async () => {
                const picked = await this.openIconPicker({
                    title: '本棚のアイコンを選択',
                    current: iconNameInput.value || 'library'
                });
                if (picked === null) return; // キャンセル
                setIcon(picked || 'library'); // 空文字 (クリア) なら library
            });
        }

        this.currentEditingBookshelf = bookshelfToEdit;

        this._overlays().open(modal, { kind: 'modal', size: 'md', hist: false }); // 重なり管理役 (イシュー#367 step5): md
        this._surface().open('bookshelf-form-modal', { close: (o) => this._formBackGuard('bookshelf-form-modal', o, (oo) => this.closeBookshelfForm(oo)), extra: { bsKey: editKey } });
        this._formSnapTake('bookshelf-form-modal');
        nameInput.focus();
    }

    closeBookshelfForm({ fromHistory = false } = {}) {
        const modal = document.getElementById('bookshelf-form-modal');
        this._overlays().close('bookshelf-form-modal', { reason: fromHistory ? 'history' : 'button' });
        this.currentEditingBookshelf = null;
        this._surface().close('bookshelf-form-modal', { fromHistory });
    }

    editBookshelf(bookshelfId) {
        const bookshelf = this.userData.bookshelves.find(b => b.id === bookshelfId);
        if (!bookshelf) return;
        
        this.showBookshelfForm(bookshelf);
    }

    // 本棚管理モーダルの D&D 並び替え (Pointer Events化=イシュー#337)。
    // .bookshelf-drag-handle 上の pointerdown で開始 (本カードと同じ型)。ゾーン判定は左ペインツリーと共用。
    setupBookshelfDragAndDrop(container) {
        this._bindPointerReorder(container, {
            itemSelector: '.bookshelf-item',
            handleSelector: '.bookshelf-drag-handle',
            canDrag: (el) => el.dataset.special !== '1',
            dragClass: 'dragging',
            zoneMode: 'segment',
            zoneClassPrefix: 'bsm-drop-',
            computeZone: (targetEl, clientY) => {
                if (targetEl.dataset.special === '1') return 'inside';
                const rect = targetEl.getBoundingClientRect();
                const y = clientY - rect.top;
                return y < rect.height * 0.3 ? 'before' : (y > rect.height * 0.7 ? 'after' : 'inside');
            },
            getKey: (el) => el.dataset.internalId,
            // 左ペインと同じ並び替え/親子整合ロジックを共用 (子は親に追従、reparent は確認ダイアログ)
            onDrop: (draggedKey, targetKey, zone) => {
                if (targetKey && targetKey !== draggedKey) this._onTreeDrop(draggedKey, targetKey, zone);
            },
        });
    }

    // イシュー#291: 本棚フォーム(bookshelf-form-modal)を開き直す。state.bsKey から対象本棚を特定。
    _reopenBookshelfForm(state) {
        const key = state && state.bsKey;
        if (!key) { this.showBookshelfForm(); return; }
        const bs = this.bookshelfManager.getBookshelves().find((b) => this.bookshelfManager._keyOf(b) === key);
        this.showBookshelfForm(bs || null);
    }
}

const _bookshelfListDescriptors = Object.getOwnPropertyDescriptors(_BookshelfListMethods.prototype);
delete _bookshelfListDescriptors.constructor;
Object.defineProperties(VirtualBookshelf.prototype, _bookshelfListDescriptors);
