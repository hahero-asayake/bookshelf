// 表示崩れの検出 (docs/audit/machine-checks.md §5-6)。座標で4種類を見る。
//   clip     文字の切れ    (直下に文字を持つ要素で、overflow が hidden・clip の向きに中身があふれている)
//   overflow はみ出し      (子の矩形が親の枠の外に出ている)
//   pageX    横スクロール  (文書の幅が画面の幅を超えている)
//   overlap  重なり        (同じ親の直下の兄弟2つの矩形が交差している)
import { evaluateInFrames, uniqueFindings } from './common.js';

// ページの中で実行される
function detect({ allow, tolerance }) {
    const H = window.__auditH;
    const findings = [];
    const used = new Set();
    // 除外リストに当たるか。extraOk が偽の時は、載っていても除外しない
    const allowed = (kind, el, extraOk) => {
        for (let k = 0; k < allow.length; k++) {
            if (allow[k].kind !== kind) continue;
            let hit = false;
            try { hit = el.matches(allow[k].selector); } catch { hit = false; }
            if (hit && extraOk) { used.add(k); return true; }
        }
        return false;
    };
    const SKIP_TAGS = ['SCRIPT', 'STYLE', 'OPTION', 'OPTGROUP', 'BR', 'WBR', 'TEMPLATE', 'NOSCRIPT'];
    const inFlow = (cs) => cs.position === 'static' || cs.position === 'relative';   // absolute・fixed・sticky は重ねるための指定
    const boxless = (cs) => cs.display === 'inline' || cs.display === 'contents';
    const cuts = (v) => v === 'hidden' || v === 'clip';
    const scrolls = (v) => v === 'auto' || v === 'scroll';
    const els = [...document.body.querySelectorAll('*')]
        .filter((el) => !el.ownerSVGElement && !SKIP_TAGS.includes(el.tagName) && H.visible(el));
    const seen = new Set(els);
    const styles = new Map();
    const styleOf = (el) => { if (!styles.has(el)) styles.set(el, getComputedStyle(el)); return styles.get(el); };
    const px = (n) => Math.round(n);

    const siblings = new Map();
    for (const el of els) {
        const cs = styleOf(el);
        if (boxless(cs)) continue;

        // 文字の切れ (入力欄は中でスクロールできるので対象外)
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
            && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
            const cutX = cuts(cs.overflowX) && el.scrollWidth - el.clientWidth > tolerance;
            const cutY = cuts(cs.overflowY) && el.scrollHeight - el.clientHeight > tolerance;
            if (cutX || cutY) {
                // 除外は、省略表示 (ellipsis・行数の制限) が実際に付いている時だけ効く
                const intended = cs.textOverflow === 'ellipsis' || (!!cs.webkitLineClamp && cs.webkitLineClamp !== 'none');
                if (!allowed('clip', el, intended)) {
                    findings.push({ kind: 'clip', ident: H.ident(el), detail: `${cutX ? 'x' : ''}${cutY ? 'y' : ''} 中身 ${el.scrollWidth}x${el.scrollHeight} / 箱 ${el.clientWidth}x${el.clientHeight}` });
                }
            }
        }
        if (!inFlow(cs)) continue;

        // はみ出し (親がスクロールできる向きは対象外)
        const parent = el.parentElement;
        if (parent && parent !== document.body && seen.has(parent) && !boxless(styleOf(parent))) {
            const ps = styleOf(parent);
            const r = el.getBoundingClientRect();
            const p = parent.getBoundingClientRect();
            const outX = !scrolls(ps.overflowX) && (r.left < p.left - tolerance || r.right > p.right + tolerance);
            const outY = !scrolls(ps.overflowY) && (r.top < p.top - tolerance || r.bottom > p.bottom + tolerance);
            if ((outX || outY) && !allowed('overflow', el, true)) {
                findings.push({ kind: 'overflow', ident: H.ident(el), detail: `${outX ? 'x' : ''}${outY ? 'y' : ''} 子 ${px(r.left)},${px(r.top)} ${px(r.width)}x${px(r.height)} / 親 ${px(p.left)},${px(p.top)} ${px(p.width)}x${px(p.height)}` });
            }
        }
        if (parent) {
            if (!siblings.has(parent)) siblings.set(parent, []);
            siblings.get(parent).push({ el, r: el.getBoundingClientRect() });
        }
    }

    // 横スクロール
    const de = document.documentElement;
    if (de.scrollWidth - de.clientWidth > tolerance) {
        findings.push({ kind: 'pageX', ident: 'document', detail: `文書の幅 ${de.scrollWidth} / 画面の幅 ${de.clientWidth}` });
    }

    // 重なり (上から順に並べ、縦に重なる範囲の兄弟だけを比べる)
    for (const kids of siblings.values()) {
        if (kids.length < 2) continue;
        kids.sort((a, b) => a.r.top - b.r.top);
        for (let i = 0; i < kids.length; i++) {
            for (let j = i + 1; j < kids.length && kids[j].r.top < kids[i].r.bottom - tolerance; j++) {
                const a = kids[i];
                const b = kids[j];
                const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
                const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
                if (w > tolerance && h > tolerance && !allowed('overlap', a.el, true) && !allowed('overlap', b.el, true)) {
                    findings.push({ kind: 'overlap', ident: [H.ident(a.el), H.ident(b.el)].sort().join(' × '), detail: `交差 ${px(w)}x${px(h)}` });
                }
            }
        }
    }
    findings.push({ kind: '__usedAllow', ident: '', detail: [...used].join(',') });
    return findings;
}

/**
 * ページと除外リストを受け取り、表示崩れの一覧を返す。
 * allowlist = [{ kind, selector, screens?, reason }] (tests/audit/layout-allowlist.json)。
 * 戻り値の usedAllow は、今回どれかの要素に当たった除外 (当たらなかった除外を警告に出すため)。
 */
export async function detectLayout(page, { allowlist = [], screen = null, tolerance = 1 } = {}) {
    const allow = allowlist.filter((a) => !a.screens || !screen || a.screens.includes('*') || a.screens.includes(screen));
    const raw = await evaluateInFrames(page, detect, { allow, tolerance });
    const usedIdx = new Set();
    const findings = [];
    for (const f of raw) {
        if (f.kind !== '__usedAllow') { findings.push(f); continue; }
        for (const k of String(f.detail).split(',').filter(Boolean)) usedIdx.add(Number(k));
    }
    return { findings: uniqueFindings(findings), usedAllow: allow.filter((_, k) => usedIdx.has(k)) };
}
