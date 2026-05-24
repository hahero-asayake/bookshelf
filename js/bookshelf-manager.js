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
        return this.getBookshelves().find(b => b.internalId === internalId);
    }

    getBySlug(slug) {
        return this.getBookshelves().find(b => b.id === slug);
    }

    getAllInternalId() {
        return this.app.userData && this.app.userData._storage && this.app.userData._storage.allInternalId;
    }

    // ===== 親子関係 =====
    getChildren(internalId) {
        return this.getBookshelves().filter(b => b.parent === internalId);
    }

    getDescendants(internalId) {
        const result = [];
        const stack = [...this.getChildren(internalId)];
        while (stack.length > 0) {
            const node = stack.shift();
            result.push(node);
            stack.push(...this.getChildren(node.internalId));
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
        return !descendants.some(d => d.internalId === candidateParentId);
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

    // ===== 短文メモ継承 =====
    // 優先順: 本棚自身の notes[asin].memo → 親 → all.notes[asin].memo
    resolveMemo(asin, bookshelfInternalId) {
        // all コンテキスト
        const allId = this.getAllInternalId();
        if (!bookshelfInternalId || bookshelfInternalId === allId) {
            return (this.app.userData.notes && this.app.userData.notes[asin] && this.app.userData.notes[asin].memo) || '';
        }
        // 本棚自身 → 祖先 → all
        let current = this.getById(bookshelfInternalId);
        while (current) {
            if (current.notes && current.notes[asin] && current.notes[asin].memo) {
                return current.notes[asin].memo;
            }
            current = current.parent ? this.getById(current.parent) : null;
        }
        return (this.app.userData.notes && this.app.userData.notes[asin] && this.app.userData.notes[asin].memo) || '';
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
            emoji: meta.emoji || '📚',
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
        if (typeof meta.emoji === 'string') bs.emoji = meta.emoji;
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

    // ===== 短文メモ・評価の編集 =====
    // setMemo(asin, memo, { scope, propagateToDescendants })
    //   scope: 'all' | internalId
    //   propagateToDescendants: true なら子孫本棚の notes[asin].memo も上書き
    //   （子→親の伝播はしない。継承は読み取り時の resolveMemo で実現）
    setMemo(asin, memo, { scope = 'all', propagateToDescendants = false } = {}) {
        const allId = this.getAllInternalId();
        if (!this.app.userData.notes) this.app.userData.notes = {};

        if (scope === 'all' || scope === allId || !scope) {
            if (!this.app.userData.notes[asin]) this.app.userData.notes[asin] = {};
            this.app.userData.notes[asin].memo = memo;
            if (propagateToDescendants) {
                for (const bs of this.getBookshelves()) {
                    if (!bs.notes) bs.notes = {};
                    if (!bs.notes[asin]) bs.notes[asin] = {};
                    bs.notes[asin].memo = memo;
                }
            }
            return;
        }

        const bs = this.getById(scope);
        if (!bs) return;
        if (!bs.notes) bs.notes = {};
        if (!bs.notes[asin]) bs.notes[asin] = {};
        bs.notes[asin].memo = memo;

        if (propagateToDescendants) {
            for (const d of this.getDescendants(scope)) {
                if (!d.notes) d.notes = {};
                if (!d.notes[asin]) d.notes[asin] = {};
                d.notes[asin].memo = memo;
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
