// author-grouping
//
// ui:book-modal-opened に応じて、本詳細モーダルに「この著者の他の本」セクションを追加する。
// 著者が複数いる場合、共通著者を1人でも持つ本を表示。

const SECTION_CLASS = 'plugin-author-grouping-section';

export function activate(api, manifest) {
    api.on('ui:book-modal-opened', onModalOpened);

    function onModalOpened({ asin }) {
        if (!asin) return;
        const modalBody = document.querySelector('#book-modal .modal-body');
        if (!modalBody) return;
        const book = api.getBook(asin);
        if (!book) return;

        const myAuthors = toAuthorSet(book.authors);
        if (myAuthors.size === 0) return;

        const related = api.getBooks().filter(b => {
            if (!b.asin || b.asin === asin) return false;
            const oth = toAuthorSet(b.authors);
            for (const a of myAuthors) if (oth.has(a)) return true;
            return false;
        });

        // 既存セクションがあれば置き換え
        let section = modalBody.querySelector(`.${SECTION_CLASS}`);
        if (!section) {
            section = document.createElement('div');
            section.className = SECTION_CLASS;
            section.style.marginTop = '1.5rem';
            modalBody.appendChild(section);
        }

        if (related.length === 0) {
            section.innerHTML = `
                <h3>👤 この著者の他の蔵書</h3>
                <p style="color:#888;font-size:0.9rem;">同じ著者の他の本は蔵書にありません</p>
            `;
            return;
        }

        section.innerHTML = `
            <h3>👤 この著者の他の蔵書 (${related.length})</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:0.6rem;margin-top:0.5rem;">
                ${related.slice(0, 12).map(b => `
                    <a href="#book/${encodeURIComponent(b.asin)}"
                       style="display:flex;flex-direction:column;align-items:center;gap:4px;text-decoration:none;color:inherit;font-size:0.8rem;text-align:center;"
                       title="${escapeAttr(b.title || '')}">
                        ${b.productImage
                            ? `<img src="${escapeAttr(b.productImage)}" alt="" style="width:80px;height:auto;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.2);">`
                            : '<div style="width:80px;height:120px;background:#eee;display:flex;align-items:center;justify-content:center;border-radius:3px;">📖</div>'}
                        <span style="overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${escapeHtml(truncate(b.title || '', 30))}</span>
                    </a>
                `).join('')}
            </div>
            ${related.length > 12 ? `<p style="color:#888;font-size:0.8rem;margin-top:0.5rem;">…他 ${related.length - 12} 冊</p>` : ''}
        `;
    }

    function toAuthorSet(authors) {
        const set = new Set();
        if (!authors) return set;
        const list = Array.isArray(authors) ? authors : String(authors).split(/[,、；;]/);
        for (const a of list) {
            const t = (a || '').trim();
            if (t) set.add(t);
        }
        return set;
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s ?? '';
        return d.innerHTML;
    }
    function escapeAttr(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }
    function truncate(s, n) {
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    return {
        deactivate() {
            document.querySelectorAll(`.${SECTION_CLASS}`).forEach(el => el.remove());
        }
    };
}
