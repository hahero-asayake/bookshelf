// per-shelf-memo (本棚別メモ)
//
// 設計: ADR-041「疎結合加算モデル」の参照実装 (dogfood)。
// コアのメモは ALL 1段のみ (2026-06-20 / ADR-007)。本プラグインは「本棚ごとの追加メモ」を
//   - データ: プラグイン専用領域  plugins/per-shelf-memo/data/<shelf-slug>.json (= { asin: memo })
//   - IF:     loadShelf()/saveShelf() が自領域だけを読み書きする
//   - UI:     registerDetailSection で本詳細に枠を足し、render 内で
//             「コアの ALL メモ (api.getNote)」と「本棚別メモ (自IF)」を両方呼んで合成表示する
// として "加算" する。コアのデータ・挙動は一切変更しない (置き換えではなく併存)。
//
// 前提の差し込み口: detailSection の ctx.bookshelf (本詳細を開いた文脈の本棚, ADR-043)。

export function activate(api, manifest) {
    const cache = new Map();   // shelfSlug -> { asin: memo }  (書込成功した断面のみ保持)
    const corrupt = new Set(); // JSON 破損で読めなかった slug。{} 上書きでの全消去を防ぐため保存を止める
    const timers = new Map();  // `${slug}::${asin}` -> timeout id

    // 読み取り: 未接続(read失敗)はキャッシュせず {} を返す。JSON 破損は corrupt 印を付けて保護する
    async function loadShelf(slug) {
        if (cache.has(slug)) return cache.get(slug);
        let text = null;
        try { text = await api.readPluginFile(`${slug}.json`); }
        catch (e) { console.warn('[per-shelf-memo] read failed:', slug, e); return {}; }
        if (!text) return {}; // 未保存/未接続。キャッシュせず後で再読込できるようにする
        let data = {};
        try { data = JSON.parse(text) || {}; }
        catch (e) { console.error('[per-shelf-memo] corrupt JSON, 保存を抑止:', slug, e); corrupt.add(slug); return {}; }
        cache.set(slug, data);
        return data;
    }
    // 書込が成功したときだけキャッシュを更新する (ディスクと乖離させない)。成否を返す
    async function saveShelf(slug, data) {
        try {
            await api.writePluginFile(`${slug}.json`, JSON.stringify(data, null, 2));
            cache.set(slug, data);
            return true;
        } catch (e) { console.error('[per-shelf-memo] save failed:', slug, e); return false; }
    }

    api.registerDetailSection({
        id: 'per-shelf-memo',
        async render(host, book, ctx) {
            if (!book) { host.innerHTML = ''; return; }
            // 連続して別の本を開いた場合に、古い非同期 render が新しい表示を上書きしないためのトークン
            const token = (host.__psmToken = (host.__psmToken || 0) + 1);
            const asin = book.asin;
            const shelf = ctx && ctx.bookshelf;

            // コアの ALL メモ (既存 IF)。置き換えず、参考として併記するだけ。
            const note = api.getNote(asin);
            const allMemo = (note && note.memo) || '';

            // 本棚文脈が無い (ホーム/検索/すべて) ときは本棚別メモは持てない
            if (!shelf || shelf.isSpecial) {
                host.innerHTML = `<h3 class="pds-title">本棚別メモ</h3>
                    <p class="pds-empty">本棚を開いた状態でこの本を開くと、その本棚専用のメモを書けます。</p>`;
                return;
            }

            const data = await loadShelf(shelf.id);
            if (host.__psmToken !== token) return; // 別の本へ切り替わっていたら破棄

            // JSON 破損ファイルは編集 UI を出さない (空保存で全消去しないため)
            if (corrupt.has(shelf.id)) {
                host.innerHTML = `<h3 class="pds-title">本棚別メモ</h3>
                    <p class="pds-empty">この本棚のメモデータが壊れているため、安全のため編集を停止しています。</p>`;
                return;
            }

            const shelfMemo = data[asin] || '';
            host.innerHTML = `
                <h3 class="pds-title">「${escapeHtml(shelf.name || shelf.id)}」のメモ</h3>
                <textarea class="psm-textarea" rows="3" placeholder="この本棚だけのメモ…">${escapeHtml(shelfMemo)}</textarea>
                <div class="psm-status" aria-live="polite"></div>
                ${allMemo ? `<p class="psm-all"><span class="psm-all-label">共通メモ</span>${escapeHtml(allMemo)}</p>` : ''}
            `;

            const ta = host.querySelector('.psm-textarea');
            const status = host.querySelector('.psm-status');
            ta.addEventListener('input', () => {
                status.textContent = '入力中…';
                const key = `${shelf.id}::${asin}`;
                if (timers.has(key)) clearTimeout(timers.get(key));
                timers.set(key, setTimeout(async () => {
                    timers.delete(key);
                    const next = { ...(await loadShelf(shelf.id)) }; // 失敗時にキャッシュを汚さないよう複製で組む
                    const raw = ta.value;                            // trim は空判定にのみ使い、保存値は原文を保持
                    if (raw.trim()) next[asin] = raw; else delete next[asin];
                    const ok = await saveShelf(shelf.id, next);
                    status.textContent = ok ? '保存しました' : '保存に失敗 (同期先が未接続)';
                    if (ok) setTimeout(() => { if (status.textContent === '保存しました') status.textContent = ''; }, 1500);
                }, 400));
            });
        }
    });

    api.injectCSS('per-shelf-memo', `
        .plugin-detail-section .pds-title { font-size: 0.85rem; margin: 0 0 0.3rem; }
        .plugin-detail-section .pds-empty { color: var(--muted, #888); font-size: 0.78rem; margin: 0.3rem 0 0; }
        .plugin-detail-section .psm-textarea {
            width: 100%; resize: vertical; font: inherit; padding: 6px 8px;
            border: 1px solid var(--line, #d8dbe2); border-radius: 6px;
            background: var(--surface, #fff); color: inherit;
        }
        .plugin-detail-section .psm-status { font-size: 0.7rem; color: var(--muted, #888); min-height: 14px; margin-top: 2px; }
        .plugin-detail-section .psm-all {
            font-size: 0.78rem; color: var(--muted, #888); margin: 0.4rem 0 0;
            border-top: 1px dashed var(--line, #d8dbe2); padding-top: 0.3rem;
        }
        .plugin-detail-section .psm-all-label { display: inline-block; margin-right: 6px; font-size: 0.68rem; opacity: 0.8; }
    `);

    return {
        deactivate() {
            for (const t of timers.values()) clearTimeout(t);
            timers.clear();
        }
    };
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
