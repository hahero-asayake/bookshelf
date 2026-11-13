// 検出器がページの中で使う共通の関数 (docs/audit/machine-checks.md §5-1・§5-5・§5-6)。

// ページの中で実行される = 外の変数を参照しない
export function auditHelpers() {
    const norm = (s) => String(s).replace(/B[0-9A-Z]{9}/g, '*').replace(/\d+/g, '*');
    // 要素の識別子: 一番近い「id を持つ祖先」から対象までを、タグ名と最初のクラス名でつなぐ。
    // 数字の並びと ASIN は * に置き換え、何番目の子かは入れない (一覧の同じ形の行は1つの識別子になる)
    const ident = (el) => {
        const parts = [];
        for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
            if (n.id) { parts.unshift('#' + norm(n.id)); break; }
            const cls = (n.getAttribute('class') || '').trim().split(/\s+/)[0];
            parts.unshift(n.tagName.toLowerCase() + (cls ? '.' + norm(cls) : ''));
            if (n === document.body) break;
        }
        return parts.join(' > ');
    };
    // 見えている要素: 背後の面 (inert) と、content-visibility で描画を省かれた要素は見えていない扱い
    const visible = (el) => {
        if (!el.isConnected || el.closest('[inert]')) return false;
        if (typeof el.checkVisibility === 'function'
            && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const text = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return { norm, ident, visible, text };
}
const INSTALL = `window.__auditH = (${auditHelpers.toString()})()`;

/** ページと、同じオリジンの iframe の全部で fn を実行し、結果 (配列) をつなげて返す */
export async function evaluateInFrames(page, fn, arg) {
    const out = [];
    for (const frame of page.frames()) {
        const isMain = frame === page.mainFrame();
        try {
            await frame.evaluate(INSTALL);
            const part = await frame.evaluate(fn, arg);
            if (isMain) { out.push(...part); continue; }
            if (!part.length) continue;
            const owner = await frame.frameElement();
            const id = await owner.getAttribute('id');
            const prefix = `iframe${id ? '#' + id : ''} >> `;
            for (const x of part) out.push({ ...x, ident: prefix + x.ident });
        } catch (e) {
            if (isMain) throw e;   // 別オリジン・破棄済みの iframe は見ない
        }
    }
    return out;
}

/** 同じ種類・同じ識別子は1件にまとめる */
export function uniqueFindings(findings) {
    const seen = new Set();
    return findings.filter((f) => {
        const key = `${f.kind}|${f.ident}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function countByKind(findings) {
    const counts = {};
    for (const f of findings) counts[f.kind] = (counts[f.kind] || 0) + 1;
    return counts;
}
