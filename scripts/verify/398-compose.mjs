// イシュー#398 step3: 再現(0)+案A/B/Cのモック画像+比較表+推奨を1枚のPNGに合成する(compose-337.mjsの型)。
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SHOT_DIR = 'tmp/verify-shots/398';
const abs = (name) => `file://${join(process.cwd(), SHOT_DIR, name)}`;

const TABLE_ROWS = [
    ['', '現状(HTML5 DnD)', 'A: _bindPointerReorder\n(長押し・#337と同じ)', 'B: ↑↓移動ボタン', 'C: 並べ替え専用シート(大きいつまみ)'],
    ['片手操作', '△（届けば可・タッチでは不可）', '◎ 指1本で押し続けて動かすだけ', '◎ ボタンをタップするだけ', '◎ シート内でつまみを押し続けるだけ'],
    ['誤操作', '△ カード全体が対象＝スクロールと競合', '○ 450ms長押し+6px移動でスクロール優先に分岐(他画面と同じ判定)', '◎ 誤操作ほぼ無し（1回1段の確定操作）', '○ 専用画面なので本体操作と混ざらない'],
    ['他の並べ替えと同じ操作か', '× 本棚ツリー/本棚管理/プラグインと別方式', '◎ 完全に同じ部品・同じ挙動', '△ 他にこの形は無い(新しい操作を1つ増やす)', '△ 他にこの形は無い(新しい画面を1つ増やす)'],
    ['実装量', '(現状)', '小 — dashboard.jsのDnD実装を_bindPointerReorder呼び出しに置換するだけ(data-widget-id/opts.getKey/onDropを合わせる)', '中 — ボタン生成・1段ずつlayout配列を入れ替える処理・連打時の保存頻度対策', '大 — 新規シートUI・開閉導線・一覧側の並べ替えロジックをもう1系統持つ'],
];

function tableHtml() {
    const [header, ...rows] = TABLE_ROWS;
    return `<table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead><tr>${header.map((h, i) => `<th style="border:1px solid #ccc;padding:8px;background:#f4f1f7;text-align:left;white-space:pre-line;${i===0?'width:110px;':''}">${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td style="border:1px solid #ccc;padding:8px;vertical-align:top;white-space:pre-line;${i===0?'font-weight:700;background:#faf9fb;':''}">${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

function shotCell(src, label, w) {
    return `<div style="width:${w}px;">
        <div style="font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:6px;">${label}</div>
        <img src="${src}" style="width:100%;border:1px solid #ddd;border-radius:6px;display:block;">
    </div>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin:0; padding:24px; font-family:-apple-system,"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans CJK JP",sans-serif; background:#fff; width:1500px; color:#1a1a1a; }
    h1 { font-size:19px; margin:0 0 4px; }
    h2 { font-size:15px; margin:28px 0 10px; border-left:4px solid #3d52ff; padding-left:8px; }
    .lead { color:#555; font-size:13px; margin:0 0 4px; }
    .reco { background:#eef6ec; border:1px solid #bfe0b2; border-radius:8px; padding:14px 16px; font-size:13.5px; line-height:1.7; }
</style></head><body>
    <h1>イシュー#398: スマホでのウィジェット並べ替え — 現状の再現と案A/B/Cのモック</h1>
    <p class="lead">390px・タッチ環境(chromium hasTouch)での編集モード。つまみ(.widget-grip)は14×20px、カード全体(170×132px)がドラッグ開始域=スクロール域と同じ。タッチでtouchstart→move→endを送っても HTML5 dragstart は0回しか発火せず、並び順は変化しない(実測)。</p>

    <h2>① 現状の再現</h2>
    <div style="display:flex;gap:20px;">
        ${shotCell(abs('0-current-annotated.png'), '現状: つまみ14×20px(赤)・カード全体170×132px=ドラッグ開始域(青、タッチでは反応しない)', 340)}
    </div>

    <h2>② 案（モック）</h2>
    <div style="display:flex;gap:20px;">
        ${shotCell(abs('A-pointerreorder.png'), 'A: _bindPointerReorder に揃える（長押し・カード全体が対象・#337と同じ部品）', 340)}
        ${shotCell(abs('B-updown.png'), 'B: ↑↓移動ボタン（タップで1段ずつ）', 340)}
        ${shotCell(abs('C-sheet.png'), 'C: 並べ替え専用シート（大きいつまみ・40px）', 340)}
    </div>

    <h2>③ 比較</h2>
    ${tableHtml()}

    <h2>④ 推奨</h2>
    <div class="reco">
        <strong>推奨: A（_bindPointerReorder に揃える）。</strong><br>
        理由: 片手操作・誤操作のしにくさはB/Cと同等以上に実装でき、かつ「同じ操作は同じ見た目・同じ挙動」の方針に唯一合致する（本棚ツリー・本棚管理・プラグイン一覧と全く同じ部品・同じ感触になる）。実装量も最小（既存のHTML5 DnDをこの1箇所だけ _bindPointerReorder 呼び出しに差し替えるだけで、新しい画面やボタン群を増やさない）。<br><br>
        補足: Bはタップ1回で意図通り動くため「誤操作のしにくさ」は最も高いが、ウィジェット数が多い(4つ以上)と↑↓連打が面倒になりやすく、かつ既存の並べ替えのどれとも違う新しい操作を1つ増やすことになる。Cは一覧の見やすさは最も良いが、専用画面を1つ増やす分だけ実装量が最も大きい。<br><br>
        A+Bの併用（長押しドラッグを基本にしつつ、スクリーンリーダー/誤操作が特に心配な人向けに↑↓も残す）も選択肢としてはあるが、まずはAだけで「同じ操作に揃える」を優先し、それでも難しいとハヘロから出た場合にBを足す、の順で良いと考える。
    </div>
</body></html>`;

const htmlPath = join(SHOT_DIR, '.tmp-compose.html');
writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`file://${join(process.cwd(), htmlPath)}`, { waitUntil: 'load' });
await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0), null, { timeout: 10000 });
const bodyBox = await page.evaluate(() => {
    const r = document.body.getBoundingClientRect();
    return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
});
await page.setViewportSize(bodyBox);
await page.waitForTimeout(80);
const outPath = join(SHOT_DIR, '398-compare.png');
await page.screenshot({ path: outPath });
console.log('→', outPath);
await browser.close();
