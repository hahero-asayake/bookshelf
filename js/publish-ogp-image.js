// PublishOgpImage: 公開記事の OGP 画像 (og.png) をブラウザ内 Canvas で生成する (S5・ADR-098・09 §11.9)。
//
// 方針:
//  - 自前生成のみ。Amazon の表紙画像は使わない (加工・合成不可, §11.10)。グラデーション・影・画像なし。
//  - 2 色構成 = 背景 bg (単色) + アクセント acc。文字は txt/sub。色は記事本体と同じ ARTICLE_COLOR_TOKENS。
//  - 要素はタイトル・タグ・発行者名・サイト名のみ。
//  - layout() は記事エディタのテンプレ3型 (ADR-103: book-a-shelf-a/book-c-shelf-c/book-c-shelf-d) の
//    「配置の構造」を rect/pill/text だけで表す (書影は使えないため意匠化、イシュー#340・2026-10-24)。
//    未知の theme.layout は既定の book-a-shelf-a へ倒す。paint() は描画指示を塗るだけで型を知らない (変更なし)。
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
    static get LAYOUT_VERSION() { return 2; }        // layout を変えたら上げる (入力ハッシュが変わり再生成される)。#340: テンプレ3型対応で 1→2。
    static get LAYOUTS() { return ['book-a-shelf-a', 'book-c-shelf-c', 'book-c-shelf-d']; }   // ADR-103。未知値は既定 (先頭) へ倒す。
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
        // 未知の theme.layout は既定 (book-a-shelf-a) へ倒す (ADR-103・#340)。
        const tpl = PublishOgpImage.LAYOUTS.includes(theme && theme.layout) ? theme.layout : PublishOgpImage.LAYOUTS[0];
        const ctx = { W, H, stack, colors, measure, publisher, siteName, title, rawTags };

        const items = [];
        items.push({ kind: 'rect', x: 0, y: 0, w: W, h: H, fill: colors.bg });

        // テンプレごとに分岐を独立させる (一部だけ採用・現状維持に戻す判断が出ても、該当テンプレのメソッドだけ差し替えられるように)。
        const built = tpl === 'book-c-shelf-c' ? PublishOgpImage._layoutBookCShelfC(items, ctx)
            : tpl === 'book-c-shelf-d' ? PublishOgpImage._layoutBookCShelfD(items, ctx)
            : PublishOgpImage._layoutBookAShelfA(items, ctx);

        // 入力キー = 見た目を決める入力だけ (measure の結果は含めない＝端末が変わっても同じキー。テンプレを変えたら再生成されるよう tpl を含める)
        const inputKey = JSON.stringify([PublishOgpImage.LAYOUT_VERSION, tpl, title, rawTags.slice(0, PublishOgpImage.MAX_TAGS), publisher, siteName, colors.bg, colors.txt, colors.sub, colors.acc]);
        return { version: PublishOgpImage.LAYOUT_VERSION, layout: tpl, width: W, height: H, colors, items, title: built.titleLines, tags: built.tags, inputKey };
    }

    // フォントの ascent/descent の近似 (render() の opts は measure(幅)しか渡さないため、実測 (ascent/descent)
    // は使えない。固定比で近似する＝書体により多少ずれるが、上下余白の対称性判定は8px の許容幅で吸収する、2026-10-24②承認)。
    static _approxAscentDescent(font) {
        const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
        const size = m ? Number(m[1]) : 16;
        return { ascent: size * 0.88, descent: size * 0.12 };
    }

    // book-a-shelf-a (「書影を大きく」=本を中央・上下1px線で区切る): 全要素を中央揃えにし、
    // 上下の罫線とフッターの位置を (近似 ascent/descent から) 逆算して対称性・余白を確保する。
    static _layoutBookAShelfA(items, { W, H, stack, colors, measure, publisher, siteName, title, rawTags }) {
        const contentW = 960, padL = (W - contentW) / 2, cx = W / 2;
        const footerText = `${publisher} の本棚 ・ ${siteName}`;
        const footerFont = `bold 26px ${stack}`;
        const ruleH = 2, gap = 16, footerBottomMarginTarget = 44;   // 44px 目標 (>=40px を確保するマージン込み)

        const fm = PublishOgpImage._approxAscentDescent(footerFont);
        const footerBaselineY = Math.round(H - footerBottomMarginTarget - fm.descent);
        const footerTopY = footerBaselineY - fm.ascent;
        const bottomRuleY = Math.round(footerTopY - gap - ruleH);
        const bottomMarginFromEdge = H - (bottomRuleY + ruleH);
        const topRuleY = bottomMarginFromEdge;   // 上罫線の上端からの余白 = 下罫線の下端からの余白 (対称)

        items.push({ kind: 'rect', x: padL, y: topRuleY, w: contentW, h: ruleH, fill: colors.acc });
        items.push({ kind: 'rect', x: padL, y: bottomRuleY, w: contentW, h: ruleH, fill: colors.acc });

        const titleAreaTop = topRuleY + ruleH, titleAreaBottom = bottomRuleY;
        const titleCenterY = (titleAreaTop + titleAreaBottom) / 2;
        const titleFont = `bold 58px ${stack}`;
        const titleLines = PublishOgpImage._wrap(title, titleFont, contentW - 40, PublishOgpImage.MAX_TITLE_LINES, measure);
        const lineGap = 78;
        const lm = PublishOgpImage._approxAscentDescent(titleFont);
        const n = titleLines.lines.length;
        const blockHeight = (n - 1) * lineGap + lm.ascent + lm.descent;
        const firstBaseline = titleCenterY - blockHeight / 2 + lm.ascent;
        titleLines.lines.forEach((line, i) => items.push({ kind: 'text', text: line, x: cx, y: Math.round(firstBaseline + i * lineGap), font: titleFont, fill: colors.txt, align: 'center', baseline: 'alphabetic' }));
        const lastBaseline = firstBaseline + (n - 1) * lineGap;
        const visualCenter = ((firstBaseline - lm.ascent) + (lastBaseline + lm.descent)) / 2;

        const tagFont = `24px ${stack}`;
        const tagDefs = [];
        let totalW = 0;
        for (const raw of rawTags.slice(0, PublishOgpImage.MAX_TAGS)) {
            const label = Array.from(raw).length > 12 ? Array.from(raw).slice(0, 12).join('') + '…' : raw;
            const w = Math.ceil(measure(label, tagFont)) + 40;
            if (totalW + w + (tagDefs.length ? 14 : 0) > contentW) break;
            tagDefs.push({ label, w });
            totalW += w + (tagDefs.length > 1 ? 14 : 0);
        }
        const tagY = Math.min(titleAreaBottom - 70, Math.round(visualCenter + 110));
        let tx = cx - totalW / 2;
        const tags = [];
        for (const { label, w } of tagDefs) {
            items.push({ kind: 'pill', x: tx, y: tagY, w, h: 46, r: 23, stroke: colors.acc, lineWidth: 2 });
            items.push({ kind: 'text', text: label, x: tx + w / 2, y: tagY + 23, font: tagFont, fill: colors.txt, align: 'center', baseline: 'middle' });
            tags.push(label);
            tx += w + 14;
        }

        items.push({ kind: 'text', text: footerText, x: cx, y: footerBaselineY, font: footerFont, fill: colors.sub, align: 'center', baseline: 'alphabetic' });
        return { titleLines, tags };
    }

    // book-c-shelf-c (「文章に書影を添える」=書影88pxが左floatで文章が回り込む): 書影の比率 (縦長 200x300) の
    // 色ブロックを左に置き、上下に余白を持たせて縦中央配置。文章はその右から回り込む。
    static _layoutBookCShelfC(items, { W, H, stack, colors, measure, publisher, siteName, title, rawTags }) {
        const coverW = 200, coverH = 300;
        const coverX = 64, coverY = Math.round((H - coverH) / 2);
        items.push({ kind: 'rect', x: coverX, y: coverY, w: coverW, h: coverH, fill: colors.acc });

        const padL = coverX + coverW + 64, padR = 80, textW = W - padL - padR;
        const titleFont = `bold 56px ${stack}`;
        const titleLines = PublishOgpImage._wrap(title, titleFont, textW, PublishOgpImage.MAX_TITLE_LINES, measure);
        const titleTop = 72 + Math.round((288 - titleLines.lines.length * 74) / 2);
        titleLines.lines.forEach((line, i) => items.push({ kind: 'text', text: line, x: padL, y: titleTop + i * 74, font: titleFont, fill: colors.txt }));

        const tagFont = `24px ${stack}`;
        const tags = [];
        let x = padL;
        for (const raw of rawTags.slice(0, PublishOgpImage.MAX_TAGS)) {
            const label = Array.from(raw).length > 12 ? Array.from(raw).slice(0, 12).join('') + '…' : raw;
            const w = Math.ceil(measure(label, tagFont)) + 40;
            if (x + w > padL + textW) break;
            items.push({ kind: 'pill', x, y: 380, w, h: 46, r: 23, stroke: colors.acc, lineWidth: 2 });
            items.push({ kind: 'text', text: label, x: x + 20, y: 380 + 23, font: tagFont, fill: colors.txt, baseline: 'middle' });
            tags.push(label);
            x += w + 14;
        }

        items.push({ kind: 'rect', x: padL, y: 500, w: textW, h: 2, fill: colors.acc });
        items.push({ kind: 'text', text: `${publisher} の本棚`, x: padL, y: 572, font: `bold 30px ${stack}`, fill: colors.sub, baseline: 'alphabetic' });
        items.push({ kind: 'text', text: siteName, x: padL + textW, y: 572, font: `26px ${stack}`, fill: colors.sub, align: 'right', baseline: 'alphabetic' });
        return { titleLines, tags };
    }

    // book-c-shelf-d (「番号つきで並べる」=CSSの counter(n,decimal-leading-zero) が視覚的特徴): 大きな通し番号
    // 「01」とタイトルを同じ左端・同じベースラインで横に並べる。タグは他テンプレと同じ pill (番号は振らない=本の順位に読めるのを避ける)。
    static _layoutBookCShelfD(items, { W, H, stack, colors, measure, publisher, siteName, title, rawTags }) {
        const padL = 96, padR = 80, textW = W - padL - padR;
        const numFont = `800 54px ${stack}`;
        const titleFont = `bold 54px ${stack}`;
        const numWidth = Math.ceil(measure('01', numFont));
        const gap = 16;
        const titleX = padL + numWidth + gap;
        const titleMaxW = textW - numWidth - gap;
        const titleLines = PublishOgpImage._wrap(title, titleFont, titleMaxW, PublishOgpImage.MAX_TITLE_LINES, measure);
        const titleTop = 72 + Math.round((288 - titleLines.lines.length * 70) / 2);
        const titleAscent = PublishOgpImage._approxAscentDescent(titleFont).ascent;
        const firstBaselineY = titleTop + titleAscent;
        // '01' とタイトル1行目は明示的に同じ baseline y に揃える (top基準の共有だとフォントウェイト差でずれるため)。
        items.push({ kind: 'text', text: '01', x: padL, y: Math.round(firstBaselineY), font: numFont, fill: colors.acc, baseline: 'alphabetic' });
        titleLines.lines.forEach((line, i) => items.push({ kind: 'text', text: line, x: titleX, y: Math.round(firstBaselineY + i * 70), font: titleFont, fill: colors.txt, baseline: 'alphabetic' }));

        const tagFont = `24px ${stack}`;
        const tags = [];
        let tx = padL;
        for (const raw of rawTags.slice(0, PublishOgpImage.MAX_TAGS)) {
            const label = Array.from(raw).length > 12 ? Array.from(raw).slice(0, 12).join('') + '…' : raw;
            const w = Math.ceil(measure(label, tagFont)) + 40;
            if (tx + w > padL + textW) break;
            items.push({ kind: 'pill', x: tx, y: 380, w, h: 46, r: 23, stroke: colors.acc, lineWidth: 2 });
            items.push({ kind: 'text', text: label, x: tx + 20, y: 380 + 23, font: tagFont, fill: colors.txt, baseline: 'middle' });
            tags.push(label);
            tx += w + 14;
        }

        items.push({ kind: 'rect', x: padL, y: 500, w: textW, h: 2, fill: colors.acc });
        items.push({ kind: 'text', text: `${publisher} の本棚`, x: padL, y: 572, font: `bold 28px ${stack}`, fill: colors.sub, baseline: 'alphabetic' });
        items.push({ kind: 'text', text: siteName, x: padL + textW, y: 572, font: `24px ${stack}`, fill: colors.sub, align: 'right', baseline: 'alphabetic' });
        return { titleLines, tags };
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
        // イシュー#257: 旧'white'は廃止。既定色はARTICLE_DEFAULT_COLOR(store.js正本)の1箇所から参照する。
        const defaultKey = (typeof globalThis !== 'undefined' && globalThis.ARTICLE_DEFAULT_COLOR) || 'aqua-white';
        const t = table[theme && theme.color] || table[defaultKey] || { bg: '#ffffff', txt: '#101010', sub: '#666666', acc: '#101010' };
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

    // 行頭に置かない文字 (行頭禁則)。閉じ括弧・句読点・長音・中黒・小さい記号など。ASCII の閉じ記号も含む。
    static get NO_HEAD() { return new Set(Array.from('、。，．）」』】〕〉》｝］・ー！？…‥：；々.,!?;:)]}%')); }
    // 行末に置かない文字 (開き括弧)。次の単位へ寄せる。
    static get NO_TAIL() { return new Set(Array.from('（「『【〔〈《｛［')); }
    // 数字の直後に付く単位 (数字と同じ行に保つ)。小さな一覧で足りる範囲だけ持つ。
    static get COUNTERS() { return new Set(Array.from('冊巻年月日時分秒歳才位個件本人円回章話号点部枚選％')); }

    // タイトルを「行の途中で切らない単位」に分ける (最小限の禁則処理)。
    //  (b) ASCII の連続 (英字・数字・記号) と全角数字の連続は 1 単位 (単語の途中で折り返さない)
    //  (c) 数字 (ASCII・全角・漢数字) の直後の単位 (冊・年・巻・位…) は数字と同じ単位
    //  (a) 行頭禁則の文字は前の単位へ・行末禁則 (開き括弧) は次の単位へ寄せる
    // 空白は単独の単位 (折り返し位置になり、行頭・行末では捨てる)。
    static _units(text) {
        const raw = Array.from(text);
        const isAscii = (c) => c >= '!' && c <= '~';
        const isFwDigit = (c) => c >= '０' && c <= '９';
        const isKanjiNum = (c) => '〇一二三四五六七八九十百千万'.includes(c);
        const NO_HEAD = PublishOgpImage.NO_HEAD, NO_TAIL = PublishOgpImage.NO_TAIL, COUNTERS = PublishOgpImage.COUNTERS;
        const units = [];
        let glueNext = false;   // 直前が開き括弧 → 次の単位を連結する
        let i = 0;
        while (i < raw.length) {
            const c = raw[i];
            let u;
            if (c === ' ' || c === '　') { if (!glueNext) units.push(' '); i++; continue; }   // 開き括弧の直後の空白は捨てる (括弧を行末に残さない)
            if (isAscii(c) || isFwDigit(c)) {
                let j = i + 1;
                while (j < raw.length && (isAscii(raw[j]) || isFwDigit(raw[j]))) j++;
                if (j < raw.length && COUNTERS.has(raw[j]) && /[0-9０-９]/.test(raw[j - 1])) j++;   // 50冊・2026年
                u = raw.slice(i, j).join(''); i = j;
            } else if (isKanjiNum(c)) {
                let j = i + 1;
                while (j < raw.length && isKanjiNum(raw[j])) j++;
                if (j < raw.length && COUNTERS.has(raw[j])) { u = raw.slice(i, j + 1).join(''); i = j + 1; }   // 十冊・二十年
                else { u = c; i++; }
            } else { u = c; i++; }
            const uc = Array.from(u);
            if (NO_HEAD.has(uc[0]) && units.length >= 2 && units[units.length - 1] === ' ') units.pop();   // 「A 、B」の空白は捨てて句読点を前の単位へ付ける
            const last = units.length - 1;
            if (last >= 0 && units[last] !== ' ' && (glueNext || NO_HEAD.has(uc[0]))) units[last] += u;   // 開き括弧の直後 / 行頭禁則の文字は前の単位へ連結
            else units.push(u);
            glueNext = NO_TAIL.has(uc[uc.length - 1]);
        }
        return units;
    }

    // 単位ごとの貪欲な折り返し。単位の途中では折らない (=禁則で前の文字ごと次の行へ送る場合があり、
    // 行頭禁則の文字を前の行へはみ出させる「ぶら下げ」はしない＝どの行も maxW を超えない)。
    // 1 単位が行幅を超える時 (長い URL 等) だけ文字単位に割る。maxLines を超える分は最終行末を「…」で省略し truncated=true。
    static _wrap(text, font, maxW, maxLines, measure) {
        const w = (str) => measure(str, font);
        const units = [];
        for (const u of PublishOgpImage._units(text)) {
            if (u !== ' ' && w(u) > maxW) units.push(...Array.from(u)); else units.push(u);
        }
        const lines = [];
        let cur = [];
        for (const u of units) {
            if (u === ' ') { if (cur.length) cur.push(u); continue; }   // 行頭の空白は捨てる
            if (!cur.length || w(cur.join('') + u) <= maxW) { cur.push(u); continue; }
            if (lines.length === maxLines - 1) {   // 最終行に収まらない残りがある → 単位ごと削って「…」が収まるまで詰める
                const keep = cur.slice();
                while (keep.length && w(keep.join('').trimEnd() + '…') > maxW) keep.pop();
                lines.push(keep.join('').trimEnd() + '…');
                return { lines, truncated: true };
            }
            lines.push(cur.join('').trimEnd());
            cur = [u];
        }
        lines.push(cur.join('').trimEnd());
        return { lines, truncated: false };
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
