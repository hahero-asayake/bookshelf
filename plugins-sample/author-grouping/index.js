// author-grouping
//
// 本詳細ペインに「この著者の他の蔵書」セクションを足す。
// 旧版は ui:book-modal-opened + #book-modal を直接いじっていたが、
// 現行は registerDetailSection で本詳細ペインに正式に差し込む。

export function activate(api, manifest) {
    api.registerDetailSection({
        id: 'author-grouping',
        render(host, book) {
            if (!book) { host.innerHTML = ''; return; }
            const myAuthors = toAuthorSet(book.authors);
            if (myAuthors.size === 0) { host.innerHTML = ''; return; }

            const related = api.getBooks().filter(b => {
                if (!b.asin || b.asin === book.asin) return false;
                const oth = toAuthorSet(b.authors);
                for (const a of myAuthors) if (oth.has(a)) return true;
                return false;
            });

            if (related.length === 0) {
                host.innerHTML = `<h3 class="pds-title">この著者の他の蔵書</h3>
                    <p class="pds-empty">同じ著者の他の本は蔵書にありません</p>`;
                return;
            }

            host.innerHTML = `
                <h3 class="pds-title">この著者の他の蔵書 (${related.length})</h3>
                <div class="ag-grid">
                    ${related.slice(0, 12).map(b => `
                        <button type="button" class="ag-item" data-asin="${escapeAttr(b.asin)}" title="${escapeAttr(b.title || '')}">
                            ${b.productImage
                                ? `<img src="${escapeAttr(b.productImage)}" alt="" loading="lazy">`
                                : '<span class="ag-noimg"></span>'}
                            <span class="ag-title">${escapeHtml(truncate(b.title || '', 30))}</span>
                        </button>
                    `).join('')}
                </div>
                ${related.length > 12 ? `<p class="pds-more">…他 ${related.length - 12} 冊</p>` : ''}
            `;
            host.querySelectorAll('.ag-item').forEach(btn => {
                btn.addEventListener('click', () => api.openBook(btn.dataset.asin));
            });
        }
    });

    // セクションの体裁 (unload で自動除去)
    api.injectCSS('author-grouping', `
        .plugin-detail-section .ag-grid {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
            gap: 0.5rem; margin-top: 0.5rem;
        }
        .plugin-detail-section .ag-item {
            display: flex; flex-direction: column; align-items: center; gap: 4px;
            background: none; border: none; padding: 0; cursor: pointer; color: inherit;
            font-size: 0.72rem; text-align: center;
        }
        .plugin-detail-section .ag-item img,
        .plugin-detail-section .ag-noimg {
            width: 60px; height: 88px; border-radius: 3px; object-fit: cover;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2); background: #eef0f4;
        }
        .plugin-detail-section .ag-title {
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .plugin-detail-section .ag-item:hover .ag-title { text-decoration: underline; }
        .plugin-detail-section .pds-title { font-size: 0.85rem; margin: 0 0 0.3rem; }
        .plugin-detail-section .pds-empty, .plugin-detail-section .pds-more {
            color: var(--muted, #888); font-size: 0.78rem; margin: 0.3rem 0 0;
        }
    `);

    return { /* unregister で detailSection / CSS とも自動解除 */ };
}

function toAuthorSet(authors) {
    const set = new Set();
    if (!authors) return set;
    const list = Array.isArray(authors) ? authors : String(authors).split(/[,、；;]/);
    for (const a of list) { const t = (a || '').trim(); if (t) set.add(t); }
    return set;
}
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function escapeAttr(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
