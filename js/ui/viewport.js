// Viewport：画面の「スマホ(狭い)/PC(広い)」判定を1か所にする部品 (イシュー#505・U2)
//
// 背景：この判定は昔からJSは768px・JSの一部とCSSの一部は900pxに割れていて、769〜900pxで
// 「戻る・記事はスマホ、設定・ホーム・⌘KはPC」のまだらが起きていた(820pxで中央ペインが
// 圧縮されるバグの原因=docs/char/u2-breakpoint-decision.md §5)。
//
// 境目は 900px の1組だけ（NARROW_MAX=900・CSS側は @media (max-width: 900px) /
// (min-width: 901px) を使う）。これ以外の幅の数値をJS/CSSに直書きしない。
// JS側は必ずこの部品 (window.viewport.isNarrow()/isWide()/onChange()) を経由する
// (window.matchMedia を直接 '...px' 付きで呼ばない)。
// 検査: scripts/check-breakpoint-literal.mjs (npm run lint:breakpoint) が
// この NARROW_MAX の値を正とし、CSS/JS に他の幅の直書きが無いことを確かめる。
//
// 決定の経緯・根拠: docs/char/u2-breakpoint-decision.md（②決裁 2026-11-03）。
(function () {
    'use strict';

    const NARROW_MAX = 900; // 唯一の数値定義。変える時はCSS側の @media (max-width/min-width) も揃えて直す。
    const QUERY = `(max-width: ${NARROW_MAX}px)`;

    let mql = null;
    try { mql = window.matchMedia(QUERY); } catch (_) { mql = null; }

    const listeners = new Set();

    function isNarrow() {
        try { return mql ? mql.matches : window.matchMedia(QUERY).matches; } catch (_) { return false; }
    }

    function isWide() {
        return !isNarrow();
    }

    // 幅がこの境目を跨いだら cb(isNarrowNow) を呼ぶ。戻り値は購読解除。
    function onChange(cb) {
        if (typeof cb !== 'function') return () => {};
        listeners.add(cb);
        return () => listeners.delete(cb);
    }

    if (mql) {
        const handler = (e) => {
            listeners.forEach((cb) => { try { cb(e.matches); } catch (_) { /* 1つのcbの失敗で他を止めない */ } });
        };
        // 旧Safari(addListener)との互換。両方揃っていれば addEventListener を使う。
        if (typeof mql.addEventListener === 'function') mql.addEventListener('change', handler);
        else if (typeof mql.addListener === 'function') mql.addListener(handler);
    }

    window.viewport = { NARROW_MAX, isNarrow, isWide, onChange };
})();
