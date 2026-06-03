// highlights-builtin
//
// 本詳細ペインに Kindle ハイライトを表示する。
// 旧版は ui:book-modal-opened + #book-modal.modal-body を直接いじっていたが、
// 現行は registerDetailSection で本詳細ペインに差し込む。
// データ取得は api.readPluginFile (storage adapter 経由なので GitHub 同期でも動く)。
//
// データ配置:
//   plugins/highlights-builtin/data/
//     index.json                  { "B0XXXXX": "ファイル名.txt", ... }
//     HighlightsASCII/<file>.txt   Obsidian Kindle Plugin 形式のハイライト

export function activate(api, manifest) {
    const cache = new Map();
    let indexPromise = null;

    function loadIndex() {
        if (!indexPromise) {
            indexPromise = api.readPluginFile('index.json')
                .then(text => { try { return text ? JSON.parse(text) : {}; } catch { return {}; } })
                .catch(() => ({}));
        }
        return indexPromise;
    }

    async function loadHighlights(asin) {
        if (cache.has(asin)) return cache.get(asin);
        const index = await loadIndex();
        const fileName = index[asin];
        if (!fileName) { cache.set(asin, []); return []; }
        const text = await api.readPluginFile(`HighlightsASCII/${fileName}`).catch(() => null);
        const list = text ? parseHighlights(text) : [];
        cache.set(asin, list);
        return list;
    }

    function parseHighlights(md) {
        const out = [];
        const m = md.match(/## Highlights\s*\n([\s\S]*)/);
        if (!m) return out;
        for (const raw of m[1].split(/\n---\n/)) {
            const s = raw.trim();
            if (!s.includes('— location:')) continue;
            const loc = s.match(/(.+?)\s*—\s*location:\s*\[(\d+)\]/s);
            if (!loc) continue;
            const text = loc[1].trim();
            if (text.length <= 10) continue;
            out.push({ text, location: `位置: ${loc[2]}` });
        }
        return out;
    }

    api.registerDetailSection({
        id: 'highlights',
        render(host, book) {
            if (!book || !book.asin) { host.innerHTML = ''; return; }
            host.innerHTML = `<h3 class="pds-title">ハイライト</h3><p class="pds-loading">読み込み中…</p>`;
            loadHighlights(book.asin).then(list => {
                if (!list.length) {
                    host.innerHTML = `<h3 class="pds-title">ハイライト</h3>
                        <p class="pds-empty">この本のハイライトはありません</p>`;
                    return;
                }
                const shown = list.slice(0, 3), rest = list.slice(3);
                host.innerHTML = `
                    <h3 class="pds-title">ハイライト (${list.length})</h3>
                    <div class="hl-list">${shown.map(item).join('')}</div>
                    ${rest.length ? `<div class="hl-list hl-rest" hidden>${rest.map(item).join('')}</div>
                        <button type="button" class="hl-toggle">他 ${rest.length} 件を表示</button>` : ''}
                `;
                const toggle = host.querySelector('.hl-toggle');
                if (toggle) toggle.addEventListener('click', () => {
                    const r = host.querySelector('.hl-rest');
                    const open = !r.hidden; r.hidden = open;
                    toggle.textContent = open ? `他 ${rest.length} 件を表示` : '一部だけ表示';
                });
            }).catch(e => {
                host.innerHTML = `<h3 class="pds-title">ハイライト</h3>
                    <p class="pds-empty">読み込みに失敗しました: ${escapeHtml(e.message || String(e))}</p>`;
            });
        }
    });

    function item(h) {
        return `<div class="hl-item"><div class="hl-text">${escapeHtml(h.text)}</div>
            <div class="hl-loc">${escapeHtml(h.location)}</div></div>`;
    }

    api.injectCSS('highlights', `
        .plugin-detail-section .pds-title { font-size: 0.85rem; margin: 0 0 0.4rem; }
        .plugin-detail-section .pds-loading, .plugin-detail-section .pds-empty {
            color: var(--muted, #888); font-size: 0.78rem; margin: 0;
        }
        .plugin-detail-section .hl-item {
            border-left: 3px solid var(--accent, #5b6cff); padding: 0.25rem 0 0.25rem 0.6rem; margin-bottom: 0.5rem;
        }
        .plugin-detail-section .hl-text { font-size: 0.82rem; line-height: 1.5; }
        .plugin-detail-section .hl-loc { font-size: 0.68rem; color: var(--muted, #888); margin-top: 2px; }
        .plugin-detail-section .hl-toggle {
            font-size: 0.72rem; background: none; border: none; color: var(--accent, #5b6cff);
            cursor: pointer; padding: 0;
        }
    `);

    return { deactivate() { cache.clear(); } };
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
