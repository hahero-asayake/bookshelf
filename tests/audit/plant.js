// 変異検査 (実画面): 実行時に誤りを入れる (docs/audit/machine-checks.md §9)。ソースは書き換えない。
// 環境変数 AUDIT_PLANT で選ぶ (カンマ区切りで複数可)。対応する検査の件数が増え、npm script が基準値の超過で落ちることを確かめる。
//   aria    ホームで、見えているボタンを1つ選び、名前の元を外す (検査 a11y)
//   button  本の手動追加の閉じるボタンの名前を変える (検査 buttons)。同じ操作キー・同じ名前のボタンがほかの画面にも
//           ある所を選ぶ = 名前の種類が1つ増える (1つしか無い名前を変えると、入れ替わるだけで件数は増えない)
//   clip    本の手動追加で、文字を持つ最初の要素 (見出し) を狭めて切る (検査 layout)
const PLANTS = (process.env.AUDIT_PLANT || '').split(',').filter(Boolean);
const TARGET = {
    aria: { check: 'a11y', screen: 'home' },
    button: { check: 'buttons', screen: 'add-book' },
    clip: { check: 'layout', screen: 'add-book' },
};

/** checks = この訪問で流す検査の名前。screen の画面に当たる誤りを全部入れる */
export async function plantFaults(page, checks, screen) {
    for (const kind of PLANTS) {
        const target = TARGET[kind];
        if (!target || target.screen !== screen || !checks.includes(target.check)) continue;
        const planted = await page.evaluate((k) => {
            const shown = (el) => el.getClientRects().length > 0 && !el.closest('[inert], [aria-hidden="true"]');
            if (k === 'aria') {
                // 見えているボタンを1つ選び、名前の元 (aria-label・title・中の文字) を外す。大きさは残す
                const button = [...document.querySelectorAll('#dashboard button, button')].find((el) => shown(el));
                if (!button) return false;
                const { width, height } = button.getBoundingClientRect();
                button.removeAttribute('aria-label');
                button.removeAttribute('aria-labelledby');
                button.removeAttribute('title');
                for (const node of [...button.childNodes]) if (node.nodeType === 3) node.remove();
                for (const el of button.querySelectorAll('*')) { el.setAttribute('aria-hidden', 'true'); }
                button.style.cssText += `;min-width:${Math.max(width, 24)}px;min-height:${Math.max(height, 24)}px;`;
                button.id = 'audit-planted-aria';
                return true;
            }
            if (k === 'button') {
                const close = document.querySelector('#add-book-modal-close');
                if (!close) return false;
                close.removeAttribute('aria-label');
                close.textContent = '変異検査のとじる';
                return true;
            }
            if (k === 'clip') {
                // 列の末端の画面で入れる (途中の画面で入れると、続きの操作が押せなくなって別の理由で落ちる)
                const el = [...document.querySelectorAll('#add-book-modal .modal-content *')].find((x) => shown(x)
                    && [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length >= 4));
                if (!el) return false;
                el.id = 'audit-planted-clip';
                // flex の中でも幅が広がらないよう、幅の上限と flex も固定する
                el.style.cssText += ';display:block !important;width:24px !important;max-width:24px !important;min-width:0 !important;flex:0 0 24px !important;overflow:hidden !important;white-space:nowrap !important;';
                return true;
            }
            return false;
        }, kind);
        if (!planted) throw new Error(`変異検査 (${kind}): 誤りを入れる要素が ${screen} に見つからない`);
    }
}
