// BookshelfManager - 本棚の親子継承、逆引きマップ、メモ継承解決
//
// 設計:
// - 本棚→本（順引き）が正本: bookshelf.books 配列
// - 本→本棚（逆引き）は起動時にメモリで構築: Map<ASIN, Set<internalId>>
// - 短文メモ継承: bookshelves/<id>.notes[asin].memo → 親 → all.notes[asin].memo
// - 親に本追加 → 子・孫へは「ダイアログで選んだ本棚にも追加」
// - 親から本削除 → 子・孫から自動カスケード削除（サブセット制約）

class BookshelfManager {
    constructor(app) {
        this.app = app;
        this.reverseIndex = new Map();
    }

    // ===== userData 配下の本棚配列を参照しやすくする =====
    getBookshelves() {
        return (this.app.userData && this.app.userData.bookshelves) || [];
    }

    getById(internalId) {
        if (internalId == null) return undefined;
        const shelves = this.getBookshelves();
        // 第一に internalId、無ければ id (slug) でフォールバック
        // (旧データ/手動作成データで internalId 欠落しているケースに堅牢)
        return shelves.find(b => b.internalId === internalId)
            || shelves.find(b => b.id === internalId);
    }

    getBySlug(slug) {
        return this.getBookshelves().find(b => b.id === slug);
    }

    getAllInternalId() {
        return this.app.userData && this.app.userData._storage && this.app.userData._storage.allInternalId;
    }

    // ===== 親子関係 =====
    // 本棚の安定キー。internalId があればそれ、無ければ id(slug)。
    // 実データは internalId 欠落 (parent も slug 参照) なので両対応にする。
    _keyOf(bs) {
        return bs && (bs.internalId || bs.id);
    }

    getChildren(internalId) {
        return this.getBookshelves().filter(b => b.parent === internalId);
    }

    getDescendants(internalId) {
        const result = [];
        const seen = new Set();
        const stack = [...this.getChildren(internalId)];
        while (stack.length > 0) {
            const node = stack.shift();
            const key = this._keyOf(node);
            if (seen.has(key)) continue;        // 循環ガード
            seen.add(key);
            result.push(node);
            stack.push(...this.getChildren(key)); // internalId 欠落でも key で辿る
        }
        return result;
    }

    getAncestors(internalId) {
        const result = [];
        let current = this.getById(internalId);
        while (current && current.parent) {
            const parent = this.getById(current.parent);
            if (!parent || result.includes(parent)) break;
            result.push(parent);
            current = parent;
        }
        return result;
    }

    // 循環参照チェック: candidateParent が internalId の子孫でないこと
    canSetParent(internalId, candidateParentId) {
        if (internalId === candidateParentId) return false;
        if (!candidateParentId) return true;
        const descendants = this.getDescendants(internalId);
        return !descendants.some(d => this._keyOf(d) === candidateParentId);
    }

    // ===== 逆引きマップ =====
    rebuildReverseIndex() {
        this.reverseIndex = new Map();
        for (const bs of this.getBookshelves()) {
            for (const asin of (bs.books || [])) {
                if (!this.reverseIndex.has(asin)) {
                    this.reverseIndex.set(asin, new Set());
                }
                this.reverseIndex.get(asin).add(bs.internalId);
            }
        }
    }

    addToReverseIndex(internalId, asin) {
        if (!this.reverseIndex.has(asin)) {
            this.reverseIndex.set(asin, new Set());
        }
        this.reverseIndex.get(asin).add(internalId);
    }

    removeFromReverseIndex(internalId, asin) {
        const set = this.reverseIndex.get(asin);
        if (set) {
            set.delete(internalId);
            if (set.size === 0) this.reverseIndex.delete(asin);
        }
    }

    getBookshelvesForBook(asin) {
        const ids = this.reverseIndex.get(asin);
        if (!ids) return [];
        return Array.from(ids).map(id => this.getById(id)).filter(Boolean);
    }

    // ===== 短文メモ解決 (2026-06-01 Phase B-2: 親継承廃止) =====
    // 優先順: 本棚自身の notes[asin].memo (override) → all.notes[asin].memo (default)
    // 親継承チェーンは廃止。ALL = デフォルト、本棚は任意で override 可。
    resolveMemo(asin, bookshelfInternalId) {
        const allMemo = (this.app.userData.notes && this.app.userData.notes[asin] && this.app.userData.notes[asin].memo) || '';
        const allId = this.getAllInternalId();
        if (!bookshelfInternalId || bookshelfInternalId === allId) return allMemo;
        const bs = this.getById(bookshelfInternalId);
        if (bs && !bs.isSpecial) {
            const override = bs.notes && bs.notes[asin] && bs.notes[asin].memo;
            if (override && override.length > 0) return override;
        }
        return allMemo;
    }

    // この本に対する全ての本棚 override (空文字以外) を返す
    // 本詳細ペインで「どこからでも全 override を編集」できるようにするため
    getAllMemoOverrides(asin) {
        const result = [];
        for (const bs of this.getBookshelves()) {
            if (bs.isSpecial) continue;
            const m = bs.notes && bs.notes[asin] && bs.notes[asin].memo;
            if (m && m.length > 0) {
                result.push({ bookshelf: bs, memo: m });
            }
        }
        return result;
    }

    // 本棚 override が存在するか (boolean)
    hasMemoOverride(asin, bookshelfInternalId) {
        if (!bookshelfInternalId) return false;
        const allId = this.getAllInternalId();
        if (bookshelfInternalId === allId) return false;
        const bs = this.getById(bookshelfInternalId);
        if (!bs || bs.isSpecial) return false;
        const m = bs.notes && bs.notes[asin] && bs.notes[asin].memo;
        return !!(m && m.length > 0);
    }

    // 評価は本棚スコープを持たない（all.notes が唯一の正本）
    resolveRating(asin) {
        return (this.app.userData.notes && this.app.userData.notes[asin] && this.app.userData.notes[asin].rating) || 0;
    }

    // ===== 本棚 CRUD =====
    create(meta) {
        if (!this.app.userData.bookshelves) this.app.userData.bookshelves = [];
        const internalId = generateInternalId();
        const slug = meta.slug || meta.id || `bookshelf_${Date.now()}`;
        if (this.getBySlug(slug)) {
            throw new Error(`slug "${slug}" は既に存在します`);
        }
        const parentId = meta.parent || this.getAllInternalId();
        const allId = this.getAllInternalId();

        const newBookshelf = {
            id: slug,
            internalId,
            name: meta.name || slug,
            iconName: meta.iconName || 'library',
            description: meta.description || '',
            parent: parentId,
            color: meta.color,
            isPublic: !!meta.isPublic,
            appliedPlugins: meta.appliedPlugins || [],
            books: [],
            notes: {},
            createdAt: new Date().toISOString()
        };

        // 親が all 以外なら親の books を初期値としてコピー（子はサブセット、最大集合 = 親と同じ）
        if (parentId && parentId !== allId) {
            const parent = this.getById(parentId);
            if (parent && Array.isArray(parent.books)) {
                newBookshelf.books = [...parent.books];
                if (!this.app.userData.bookOrder) this.app.userData.bookOrder = {};
                const parentOrder = this.app.userData.bookOrder[parent.id];
                this.app.userData.bookOrder[slug] = Array.isArray(parentOrder)
                    ? [...parentOrder]
                    : [...newBookshelf.books];
                for (const asin of newBookshelf.books) {
                    this.addToReverseIndex(internalId, asin);
                }
            }
        }

        this.app.userData.bookshelves.push(newBookshelf);
        return newBookshelf;
    }

    update(internalId, meta) {
        const bs = this.getById(internalId);
        if (!bs) throw new Error('本棚が見つかりません');
        if (typeof meta.name === 'string') bs.name = meta.name;
        if (typeof meta.iconName === 'string') bs.iconName = meta.iconName;
        if (typeof meta.description === 'string') bs.description = meta.description;
        if (typeof meta.isPublic === 'boolean') bs.isPublic = meta.isPublic;
        if (typeof meta.color === 'string') bs.color = meta.color;
        if (Array.isArray(meta.appliedPlugins)) bs.appliedPlugins = meta.appliedPlugins;
        if (typeof meta.parent === 'string') {
            if (bs.isSpecial) {
                // all 等の特殊本棚は親を持てない
            } else {
                if (!this.canSetParent(internalId, meta.parent)) {
                    throw new Error('循環参照になるため親に設定できません');
                }
                bs.parent = meta.parent;
            }
        }
        bs.lastUpdated = new Date().toISOString();
        return bs;
    }

    // ===== 親変更 (reparent) — サブセット制約を維持 =====
    // 部分木 (bs + 子孫) が持つ本を、新しい親とその祖先へ補充して「子 ⊆ 親」を保つ。
    // 既存の一括追加 (_bulkAddToShelf) の「祖先へ自動追加」と同じ思想。

    // 部分木が持つ本の和集合 (子孫 ⊆ bs なので実質 bs.books だが堅牢に union)
    _subtreeBookSet(internalId) {
        const set = new Set();
        const targets = [this.getById(internalId), ...this.getDescendants(internalId)];
        for (const bs of targets) {
            for (const asin of (bs?.books || [])) set.add(asin);
        }
        return set;
    }

    // 新しい親チェーン (新親 + その祖先) の非特殊本棚
    _parentChainShelves(parentInternalId) {
        const parent = this.getById(parentInternalId);
        if (!parent) return [];
        return [parent, ...this.getAncestors(parentInternalId)].filter(p => p && !p.isSpecial);
    }

    // reparent 適用前のプレビュー (mutate しない)。確認ダイアログ用。
    // { valid, reason, addedToNewParent, targetShelves:[{name, addCount}] }
    previewReparent(internalId, newParentId) {
        const bs = this.getById(internalId);
        if (!bs) return { valid: false, reason: '本棚が見つかりません' };
        if (bs.isSpecial) return { valid: false, reason: '特殊本棚は移動できません' };
        const targetParent = newParentId || this.getAllInternalId();
        if (!this.canSetParent(internalId, targetParent)) {
            return { valid: false, reason: '循環参照になるため移動できません' };
        }
        const subtree = this._subtreeBookSet(internalId);
        const chain = this._parentChainShelves(targetParent);
        const targetShelves = [];
        let addedToNewParent = 0;
        for (const shelf of chain) {
            const have = new Set(shelf.books || []);
            let addCount = 0;
            for (const asin of subtree) if (!have.has(asin)) addCount++;
            if (addCount > 0) targetShelves.push({ name: shelf.name, addCount });
            if (this._keyOf(shelf) === targetParent) addedToNewParent = addCount;
        }
        return { valid: true, addedToNewParent, targetShelves };
    }

    // reparent 適用。親を差し替え、部分木の本を新親チェーンへ補充。
    reparent(internalId, newParentId) {
        const bs = this.getById(internalId);
        if (!bs) throw new Error('本棚が見つかりません');
        if (bs.isSpecial) throw new Error('特殊本棚は移動できません');
        const targetParent = newParentId || this.getAllInternalId();
        if (!this.canSetParent(internalId, targetParent)) {
            throw new Error('循環参照になるため移動できません');
        }
        bs.parent = targetParent;
        bs.lastUpdated = new Date().toISOString();

        const subtree = this._subtreeBookSet(internalId);
        const chain = this._parentChainShelves(targetParent);
        for (const shelf of chain) {
            for (const asin of subtree) {
                if (!(shelf.books || []).includes(asin)) {
                    this.addBookToBookshelf(this._keyOf(shelf), asin);
                }
            }
        }
        return bs;
    }

    // ===== 同階層の並び替え =====
    // userData.bookshelves 配列の順序が表示順 (byParent が配列順を保持)。
    // internalId を beforeInternalId の直前へ移動 (beforeInternalId が null なら末尾)。
    reorderSibling(internalId, beforeInternalId = null) {
        const arr = this.getBookshelves();
        const fromIdx = arr.findIndex(b => this._keyOf(b) === internalId);
        if (fromIdx < 0) return false;
        const moving = arr.splice(fromIdx, 1)[0];
        let toIdx;
        if (beforeInternalId == null) {
            toIdx = arr.length;
        } else {
            toIdx = arr.findIndex(b => this._keyOf(b) === beforeInternalId);
            if (toIdx < 0) toIdx = arr.length;
        }
        arr.splice(toIdx, 0, moving);
        return true;
    }

    // slug リネーム: ファイル名変更（旧ファイル削除 + 新ファイル書込）。internalId は不変。
    async rename(internalId, newSlug) {
        const bs = this.getById(internalId);
        if (!bs) throw new Error('本棚が見つかりません');
        if (bs.isSpecial) throw new Error('特殊本棚（all 等）は slug を変更できません');
        if (bs.id === newSlug) return bs;
        if (this.getBySlug(newSlug)) {
            throw new Error(`slug "${newSlug}" は既に存在します`);
        }
        const oldSlug = bs.id;
        bs.id = newSlug;

        // 子の parent 参照が slug の場合は付け替え (internalId 参照は不変なので影響なし)
        for (const child of this.getBookshelves()) {
            if (child.parent === oldSlug) child.parent = newSlug;
        }

        // 表示順序の bookOrder キーも置き換え
        if (this.app.userData.bookOrder && this.app.userData.bookOrder[oldSlug]) {
            this.app.userData.bookOrder[newSlug] = this.app.userData.bookOrder[oldSlug];
            delete this.app.userData.bookOrder[oldSlug];
        }

        // 同期フォルダの旧ファイル削除（書き込みは syncToObsidianFolder 側で）
        if (this.app.obsidianDirHandle && this.app.storage) {
            this.app.storage.setDirHandle(this.app.obsidianDirHandle);
            try {
                await this.app.storage.deleteBookshelfFile(oldSlug);
            } catch (e) {
                console.error('旧 slug ファイル削除エラー:', e);
            }
        }
        return bs;
    }

    // 削除: 子孫もカスケード削除（サブセット制約のため）
    async remove(internalId, { confirmCallback } = {}) {
        const bs = this.getById(internalId);
        if (!bs) return false;
        if (bs.isSpecial) throw new Error('特殊本棚（all 等）は削除できません');
        const descendants = this.getDescendants(internalId);
        const allTargets = [bs, ...descendants];

        if (confirmCallback) {
            const ok = await confirmCallback(allTargets);
            if (!ok) return false;
        }

        const slugsToDelete = allTargets.map(b => b.id);
        const idsToDelete = new Set(allTargets.map(b => b.internalId));
        this.app.userData.bookshelves = this.getBookshelves().filter(b => !idsToDelete.has(b.internalId));

        // bookOrder からも削除
        for (const slug of slugsToDelete) {
            if (this.app.userData.bookOrder && this.app.userData.bookOrder[slug]) {
                delete this.app.userData.bookOrder[slug];
            }
        }

        // 逆引きから削除
        for (const bookshelf of allTargets) {
            for (const asin of (bookshelf.books || [])) {
                this.removeFromReverseIndex(bookshelf.internalId, asin);
            }
        }

        // 同期フォルダの slug.json も削除
        if (this.app.obsidianDirHandle && this.app.storage) {
            this.app.storage.setDirHandle(this.app.obsidianDirHandle);
            for (const slug of slugsToDelete) {
                try {
                    await this.app.storage.deleteBookshelfFile(slug);
                } catch (e) {
                    console.error(`本棚ファイル削除エラー (${slug}):`, e);
                }
            }
        }
        return allTargets;
    }

    // ===== 本の追加・削除（継承伝播） =====
    // addBookToBookshelf(internalId, asin, { propagateTo })
    //   propagateTo: 追加で含める子孫 internalId の配列（明示的に選んだ本棚にのみ伝播）
    addBookToBookshelf(internalId, asin, { propagateTo = [] } = {}) {
        const targets = [internalId, ...propagateTo];
        const added = [];
        for (const id of targets) {
            const bs = this.getById(id);
            if (!bs) continue;
            if (!bs.books) bs.books = [];
            if (!bs.books.includes(asin)) {
                bs.books.push(asin);
                this.addToReverseIndex(id, asin);
                added.push(bs);

                // bookOrder にも反映
                if (!this.app.userData.bookOrder) this.app.userData.bookOrder = {};
                if (!Array.isArray(this.app.userData.bookOrder[bs.id])) {
                    this.app.userData.bookOrder[bs.id] = [];
                }
                if (!this.app.userData.bookOrder[bs.id].includes(asin)) {
                    this.app.userData.bookOrder[bs.id].unshift(asin);
                }
            }
        }
        return added;
    }

    // removeBookFromBookshelf(internalId, asin)
    // 親から削除すると子孫からも自動カスケード（子はサブセット制約のため）
    removeBookFromBookshelf(internalId, asin) {
        const root = this.getById(internalId);
        if (!root) return [];
        const removed = [];
        const targets = [root, ...this.getDescendants(internalId)];
        for (const bs of targets) {
            if (!bs.books) continue;
            if (bs.books.includes(asin)) {
                bs.books = bs.books.filter(a => a !== asin);
                this.removeFromReverseIndex(bs.internalId, asin);
                if (this.app.userData.bookOrder && Array.isArray(this.app.userData.bookOrder[bs.id])) {
                    this.app.userData.bookOrder[bs.id] = this.app.userData.bookOrder[bs.id].filter(a => a !== asin);
                }
                removed.push(bs);
            }
        }
        return removed;
    }

    // ===== 短文メモ・評価の編集 (Phase B-2 簡素化: 親継承廃止、override 仕様) =====
    // setMemo(asin, memo, { scope })
    //   scope: internalId
    //     - 未指定 or all → ALL.notes (デフォルト) に保存
    //     - 通常本棚 → bookshelf.notes に override として保存
    //   空文字 ('') を本棚スコープに保存すると override 削除 (ALL にフォールバック)
    setMemo(asin, memo, { scope } = {}) {
        const allId = this.getAllInternalId();
        if (!this.app.userData.notes) this.app.userData.notes = {};

        if (!scope || scope === allId) {
            if (!this.app.userData.notes[asin]) this.app.userData.notes[asin] = {};
            this.app.userData.notes[asin].memo = memo;
            // memo が空かつ他フィールドも空ならエントリ自体削除
            const n = this.app.userData.notes[asin];
            if (!n.memo && !n.rating && !n.hasDetailMemo && !n.hideMemo && !n.hideDetailMemo) {
                delete this.app.userData.notes[asin];
            }
            return;
        }

        const bs = this.getById(scope);
        if (!bs || bs.isSpecial) return;
        if (!bs.notes) bs.notes = {};
        if (!bs.notes[asin]) bs.notes[asin] = {};

        if (memo && memo.length > 0) {
            bs.notes[asin].memo = memo;
        } else {
            // 空文字なら override 削除
            delete bs.notes[asin].memo;
            if (Object.keys(bs.notes[asin]).length === 0) {
                delete bs.notes[asin];
            }
        }
    }

    setRating(asin, rating) {
        if (!this.app.userData.notes) this.app.userData.notes = {};
        if (!this.app.userData.notes[asin]) this.app.userData.notes[asin] = {};
        this.app.userData.notes[asin].rating = rating;
    }
}

window.BookshelfManager = BookshelfManager;
