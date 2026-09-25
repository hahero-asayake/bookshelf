// PublishOgpImage: 公開記事の OGP 画像 (og.png) をブラウザ内 Canvas で生成する (S5・ADR-098・09 §11.9)。
//
// 方針:
//  - 自前生成のみ。Amazon の表紙画像は使わない (加工・合成不可, §11.10)。グラデーション・影・画像なし。
//  - 2 色構成 = 背景 bg (単色) + アクセント acc。文字は txt/sub。色は記事本体と同じ ARTICLE_COLOR_TOKENS。
//  - 要素はタイトル・タグ・発行者名・サイト名のみ。記事エディタのテンプレ 3 型 (#211) には依存しない。
//    #211 の結論が出たら layout() だけ差し替える (paint() は描画指示を塗るだけで型を知らない)。
//  - layout(article, theme, opts) → 描画指示 (純データ。Canvas 不要・unit で検証可)
//    paint(ctx2d, plan)          → 描画指示を Canvas へ塗る
//    render(article, theme, opts) → PNG を作って { ok, base64, hash, bytes } か { ok:false, reason } を返す。
//    Canvas が無い環境・日本語グリフが描けない端末・容量超過では ok:false (呼び出し側は画像なしで公開を続ける)。
class PublishOgpImage {
    static get WIDTH() { return 1200; }
    static get HEIGHT() { return 630; }
    static get MAX_BYTES() { return 200 * 1024; }   // og.png は保存容量 (quota) に計上されるため 1 枚の上限を持つ
    static get MAX_TITLE_LINES() { return 3; }
    static get MAX_TAGS() { return 5; }
    static get LAYOUT_VERSION() { return 1; }        // layout を変えたら上げる (入力ハッシュが変わり再生成される)
    // 端末ごとに入っている日本語フォントが違う。存在するものが先に当たり、無ければ sans-serif (ブラウザの字形フォールバック)。
    static get FONT_STACK() {
        return '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo","Noto Sans CJK JP","Noto Sans JP",sans-serif';
    }

    // ---- 描画指示 (純関数) ----
    static layout(article, theme, opts = {}) {
        const W = PublishOgpImage.WIDTH, H = PublishOgpImage.HEIGHT;
        const stack = PublishOgpImage.FONT_STACK;
        const colors = PublishOgpImage._colors(theme, opts.tokens);
        const measure = typeof opts.measure === 'function' ? opts.measure : PublishOgpImage._estimateWidth;
        const publisher = String(opts.publisher || 'マイ本棚');
        const siteName = String(opts.siteName || 'AsayakeBookshelf');
        const title = PublishOgpImage._oneLine(article && article.title) || '（無題）';
        const rawTags = ((article && article.tags) || []).map(t => PublishOgpImage._oneLine(t)).filter(Boolean);

        const padL = 96, padR = 80, textW = W - padL - padR;
        const titleFont = `bold 60px ${stack}`;
        const titleLines = PublishOgpImage._wrap(title, titleFont, textW, PublishOgpImage.MAX_TITLE_LINES, measure);

        const items = [];
        items.push({ kind: 'rect', x: 0, y: 0, w: W, h: H, fill: colors.bg });
        items.push({ kind: 'rect', x: 0, y: 0, w: 24, h: H, fill: colors.acc });
        // タイトルブロックは「上端〜タグ行の手前」(y=72..360) の縦中央に置く (3 行は y=96 から・1 行は下寄りになり上が空きすぎない)
        const titleTop = 72 + Math.round((288 - titleLines.lines.length * 80) / 2);
        titleLines.lines.forEach((line, i) => {
            items.push({ kind: 'text', text: line, x: padL, y: titleTop + i * 80, font: titleFont, fill: colors.txt });
        });

        // タグ (最大 5 個。1 行に収まらないものは落とす)
        const tagFont = `24px ${stack}`;
        const tags = [];
        let x = padL;
        for (const raw of rawTags.slice(0, PublishOgpImage.MAX_TAGS)) {
            const label = Array.from(raw).length > 12 ? Array.from(raw).slice(0, 12).join('') + '…' : raw;
            const w = Math.ceil(measure(label, tagFont)) + 40;
            if (x + w > padL + textW) break;
            items.push({ kind: 'pill', x, y: 380, w, h: 46, r: 23, stroke: colors.acc, lineWidth: 2 });
            // タグ内の文字はピルの縦中央 (フォントの em 箱の中央＝グリフの形に依存しない) に置く
            items.push({ kind: 'text', text: label, x: x + 20, y: 380 + 23, font: tagFont, fill: colors.txt, baseline: 'middle' });
            tags.push(label);
            x += w + 14;
        }

        // フッター: 区切り線 (acc) + 発行者名 / サイト名 (sub)
        items.push({ kind: 'rect', x: padL, y: 500, w: textW, h: 2, fill: colors.acc });
        // 大きさの違う 2 つの文字は同じ基線 (alphabetic) に揃える。左は左端 96・右は右端 1120 (=W-padR) に揃う
        items.push({ kind: 'text', text: `${publisher} の本棚`, x: padL, y: 572, font: `bold 30px ${stack}`, fill: colors.sub, baseline: 'alphabetic' });
        items.push({ kind: 'text', text: siteName, x: padL + textW, y: 572, font: `26px ${stack}`, fill: colors.sub, align: 'right', baseline: 'alphabetic' });

        // 入力キー = 見た目を決める入力だけ (measure の結果は含めない＝端末が変わっても同じキー)
        const inputKey = JSON.stringify([PublishOgpImage.LAYOUT_VERSION, title, rawTags.slice(0, PublishOgpImage.MAX_TAGS), publisher, siteName, colors.bg, colors.txt, colors.sub, colors.acc]);
        return { version: PublishOgpImage.LAYOUT_VERSION, width: W, height: H, colors, items, title: titleLines, tags, inputKey };
    }

    // ---- 描画 (描画指示を塗るだけ) ----
    static paint(ctx, plan) {
        for (const it of plan.items) {
            if (it.kind === 'rect') {
                ctx.fillStyle = it.fill;
                ctx.fillRect(it.x, it.y, it.w, it.h);
            } else if (it.kind === 'pill') {
                ctx.strokeStyle = it.stroke;
                ctx.lineWidth = it.lineWidth;
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') ctx.roundRect(it.x, it.y, it.w, it.h, it.r);
                else ctx.rect(it.x, it.y, it.w, it.h);
                ctx.stroke();
            } else if (it.kind === 'text') {
                ctx.font = it.font;
                ctx.fillStyle = it.fill;
                ctx.textAlign = it.align || 'left';
                ctx.textBaseline = it.baseline || 'top';
                ctx.fillText(it.text, it.x, it.y);
            }
        }
    }

    // 入力ハッシュ (再公開で同じ入力なら再アップロードを省く判定と og:image の ?v= に使う)。暗号用途ではない。
    static hash(plan) { return PublishOgpImage._cyrb53(plan.inputKey).toString(36).padStart(10, '0'); }

    // ---- 生成 ----
    // opts: { publisher, siteName, tokens, createCanvas(w,h) (テスト/検査用の差し替え) }
    // 戻り値: { ok:true, base64, bytes, hash, plan } | { ok:false, reason }
    //   reason: 'no-canvas' | 'glyph' (日本語が描けない端末) | 'blank' | 'too-large' | 'encode'
    static async render(article, theme, opts = {}) {
        const make = opts.createCanvas || PublishOgpImage._createCanvas;
        const canvas = make(PublishOgpImage.WIDTH, PublishOgpImage.HEIGHT);
        if (!canvas) return { ok: false, reason: 'no-canvas' };
        const ctx = canvas.getContext('2d');
        if (!ctx) return { ok: false, reason: 'no-canvas' };

        const measure = (text, font) => { ctx.font = font; return ctx.measureText(text).width; };
        const plan = PublishOgpImage.layout(article, theme, { ...opts, measure });

        // 描くテキストに CJK が含まれる時だけ、この端末で日本語グリフが描けるかを実測する (豆腐の画像を公開しない)
        const drawn = plan.items.filter(i => i.kind === 'text').map(i => i.text).join('');
        if (PublishOgpImage._hasCjk(drawn)) {
            const g = PublishOgpImage.checkGlyphs(make, PublishOgpImage.FONT_STACK);
            if (!g.ok) return { ok: false, reason: 'glyph', detail: g.detail };
        }

        PublishOgpImage.paint(ctx, plan);
        if (PublishOgpImage._isBlank(ctx, plan)) return { ok: false, reason: 'blank' };

        let bytes;
        try {
            const blob = canvas.convertToBlob
                ? await canvas.convertToBlob({ type: 'image/png' })
                : await new Promise((res) => canvas.toBlob(res, 'image/png'));
            bytes = new Uint8Array(await blob.arrayBuffer());
        } catch (_) { return { ok: false, reason: 'encode' }; }
        if (!PublishOgpImage.isPng(bytes)) return { ok: false, reason: 'encode' };
        if (bytes.length > PublishOgpImage.MAX_BYTES) return { ok: false, reason: 'too-large', size: bytes.length };
        return { ok: true, bytes, base64: PublishOgpImage._toBase64(bytes), hash: PublishOgpImage.hash(plan), plan };
    }

    // 日本語グリフの実描画検査。別々の漢字 4 つを実際に描いたビットマップが (a) 互いに違う (b) 存在しない
    // コードポイント U+10FFFF (= .notdef の豆腐/空白) の描画と違う (c) 全面白でない、を満たせば描けている。
    // measureText の幅比較では判定できない (ブラウザは存在しないフォントでも字形単位で日本語フォントへ
    // フォールバックするため、指定列と存在しないフォントで幅が同じでも描画は正常なことがある)。
    static checkGlyphs(make, stack) {
        const bitmap = (ch) => {
            const c = make(64, 64);
            const x = c && c.getContext && c.getContext('2d');
            if (!x) return null;
            x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 64);
            x.fillStyle = '#000000'; x.font = `48px ${stack}`; x.textBaseline = 'top';
            x.fillText(ch, 8, 4);
            return PublishOgpImage._cyrb53(Array.from(x.getImageData(0, 0, 64, 64).data).join(',')).toString(36);
        };
        const samples = ['日', '本', '語', '棚'];
        const keys = samples.map(bitmap);
        const refKey = bitmap('\u{10FFFF}');
        const blankKey = (() => {
            const c = make(64, 64); const x = c && c.getContext && c.getContext('2d');
            if (!x) return null;
            x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 64);
            return PublishOgpImage._cyrb53(Array.from(x.getImageData(0, 0, 64, 64).data).join(',')).toString(36);
        })();
        if (keys.some(k => k == null) || refKey == null) return { ok: false, detail: 'no-bitmap' };
        const distinct = new Set(keys).size === samples.length;
        const notRef = keys.every(k => k !== refKey);
        const notBlank = keys.every(k => k !== blankKey);
        return { ok: distinct && notRef && notBlank, detail: { distinct, notRef, notBlank } };
    }

    static isPng(bytes) {
        const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        return !!bytes && bytes.length > sig.length && sig.every((b, i) => bytes[i] === b);
    }

    // ---- 内部 ----
    static _colors(theme, tokens) {
        const table = tokens || (typeof globalThis !== 'undefined' && globalThis.ARTICLE_COLOR_TOKENS) || {};
        const t = table[theme && theme.color] || table.white || { bg: '#ffffff', txt: '#101010', sub: '#666666', acc: '#101010' };
        return { bg: t.bg, txt: t.txt, sub: t.sub, acc: t.acc };
    }

    static _oneLine(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

    // Canvas が無い環境 (unit の measure 既定) の概算幅: 全角 = 1em・半角 = 0.56em
    static _estimateWidth(text, font) {
        const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
        const size = m ? Number(m[1]) : 16;
        let w = 0;
        for (const ch of String(text)) w += (ch.codePointAt(0) >= 0x2e80 ? 1 : 0.56) * size;
        return w;
    }

    // 文字単位の折り返し。maxLines を超える分は最終行末を「…」で省略し truncated=true にする。
    static _wrap(text, font, maxW, maxLines, measure) {
        const lines = [];
        let cur = '';
        const chars = Array.from(text);
        let i = 0;
        for (; i < chars.length; i++) {
            const next = cur + chars[i];
            if (cur && measure(next, font) > maxW) {
                if (lines.length === maxLines - 1) break;   // 最終行: 残りは省略処理へ
                lines.push(cur.trimEnd());
                cur = chars[i] === ' ' ? '' : chars[i];
            } else {
                cur = next;
            }
        }
        if (i >= chars.length) { lines.push(cur); return { lines, truncated: false }; }
        // 最終行に収まらない残りがある → 末尾を削って「…」が収まるところまで詰める
        let last = cur;
        while (last && measure(last + '…', font) > maxW) last = Array.from(last).slice(0, -1).join('');
        lines.push(last.trimEnd() + '…');
        return { lines, truncated: true };
    }

    static _hasCjk(s) { return /[　-ヿ㐀-鿿豈-﫿＀-￯]/.test(s); }

    // タイトル領域 (x=96..1120・y=72..360。行数で縦位置が変わるので領域全体) が背景 1 色のまま (何も描けていない) なら true。
    static _isBlank(ctx, plan) {
        if (typeof ctx.getImageData !== 'function') return false;
        const d = ctx.getImageData(96, 72, 1024, 288).data;
        const r0 = d[0], g0 = d[1], b0 = d[2];
        for (let i = 4; i < d.length; i += 4) {
            if (d[i] !== r0 || d[i + 1] !== g0 || d[i + 2] !== b0) return false;
        }
        return true;
    }

    static _createCanvas(w, h) {
        if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) return null;   // unit (jsdom) は Canvas 無し
        if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
        if (typeof document !== 'undefined' && document.createElement) {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            return c;
        }
        return null;
    }

    static _toBase64(bytes) {
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        return btoa(bin);
    }

    // cyrb53 (32bit 二重ハッシュ。変更検知用)
    static _cyrb53(str, seed = 0) {
        let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return 4294967296 * (2097151 & h2) + (h1 >>> 0);
    }
}

if (typeof window !== 'undefined') window.PublishOgpImage = PublishOgpImage;
if (typeof globalThis !== 'undefined') globalThis.PublishOgpImage = PublishOgpImage;
