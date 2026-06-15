// PublishGenerator: データ解決 / 公開項目(スタイル固定) / プライバシー / スタイル の検証 (P1-4, ADR-030 / ADR-034追補)
import { describe, it, expect, beforeEach } from 'vitest';

await import('../../js/publish-page-store.js');
await import('../../js/publish-styles.js');
await import('../../js/publish-generator.js');
const { PublishGenerator, createPublishStyleRegistry } = globalThis;

function makeState() {
    return {
        library: { books: [
            { asin: 'M1', title: '漫画1', authors: '作者A', productImage: 'http://img/M1.jpg' },
            { asin: 'M2', title: '漫画2', authors: '作者B', productImage: 'http://img/M2.jpg' },
            { asin: 'N1', title: '小説1', authors: '作者C', productImage: 'http://img/N1.jpg' }
        ]},
        bookshelvesMeta: { bookshelves: [
            { internalId: 'allid', slug: 'all', name: 'すべて', isSpecial: true },
            { internalId: 'mid', slug: 'manga', name: '漫画', description: 'お気に入りの漫画' },
            { internalId: 'nid', slug: 'novel', name: '小説' }
        ]},
        allBookshelf: { books: ['M1', 'M2', 'N1'] },
        bookshelfFiles: {
            mid: { books: ['M1', 'M2'], notes: { M2: { memo: '本棚overrideメモ' } } },
            nid: { books: ['N1'], notes: {} }
        },
        notes: {
            M1: { rating: 5, memo: 'ALLメモM1', hasDetailMemo: true },
            M2: { rating: 4 },
            N1: { rating: 3, memo: 'ALLメモN1' }
        },
        privateSettings: { affiliateId: 'aff-xyz', obsidianVaultName: 'MySecretVault', publicDisplayName: 'hahero' }
    };
}

function makeApp(state, plan = 'free') {
    return {
        // 生成側はプランで affiliate tag を出し分ける (Plus=自分の tag / Free=運営 tag)。
        // テスト環境に SyncConfigManager は無いので app.syncConfig.hub.plan が参照される。
        syncConfig: { hub: { plan } },
        storage: {
            loadAll: async () => state,
            readBookMemo: async (asin) => asin === 'M1' ? '---\nupdated: 2026\n---\n長文メモ本文M1' : null
        }
    };
}

// 公開項目はスタイルが固定する (ページ毎トグルは廃止)。select に fields は持たせない。
const sel = (shelves = [], books = []) => ({ shelves, books });

let gen;
beforeEach(() => {
    gen = new PublishGenerator(makeApp(makeState()), createPublishStyleRegistry());
});

describe('本棚セクション型', () => {
    it('選んだ本棚の本だけ・override メモ・Amazon tag が出る / 非選択本は出ない', async () => {
        // Plus ユーザは自分の affiliate tag が付く
        const g = new PublishGenerator(makeApp(makeState(), 'plus'), createPublishStyleRegistry());
        const page = { id: 'a', slug: 'manga-page', title: '漫画ページ', intro: 'よろしく', styleId: 'shelf-sections', styleParams: {}, select: sel(['mid']) };
        const r = await g.build([page]);
        const html = r.files.find(f => f.path === 'manga-page/index.html').content;
        expect(html).toContain('漫画1');
        expect(html).toContain('漫画2');
        expect(html).toContain('本棚overrideメモ');     // M2 は override 優先
        expect(html).toContain('ALLメモM1');            // M1 は ALL memo
        expect(html).toContain('tag=aff-xyz');           // Plus: 自分のアフィリエイト tag 付き
        expect(html).toContain('class="pub-ad-top"');    // 冒頭に控えめな広告ラベルが出る (ステマ規制)
        expect(html).not.toContain('小説1');             // 非選択本棚は出ない
        expect(r.errors).toEqual([]);
    });

    it('Free ユーザは運営 tag が付き広告開示が出る (自分の tag は使わない)', async () => {
        // beforeEach の gen は plan='free'。運営 tag (asayake09-22) が付き、広告開示も出る
        const page = { id: 'a', slug: 'free-page', title: 'おすすめ本', intro: '', styleId: 'shelf-sections', styleParams: {}, select: sel(['mid']) };
        const r = await gen.build([page]);
        const html = r.files.find(f => f.path === 'free-page/index.html').content;
        expect(html).toContain('漫画1');
        expect(html).not.toContain('tag=aff-xyz');     // 自分の tag は使わない
        expect(html).toContain('tag=asayake09-22');     // 運営 tag が付く
        expect(html).toContain('class="pub-ad-top"');   // 冒頭に控えめな広告ラベルが出る
        // 公開サイトでは「無料プラン/収益の帰属先」は開示不要な情報なので出さない (プラン非依存)
        expect(html).not.toContain('運営者');
        expect(html).not.toContain('無料');
    });

    it('本が0件のページには広告ラベルを出さない (過剰開示しない)', async () => {
        // 収益化していても (Plus + tag)、実際に商品リンクが出ないページには広告ラベルを付けない
        const g = new PublishGenerator(makeApp(makeState(), 'plus'), createPublishStyleRegistry());
        const page = { id: 'a', slug: 'empty', title: '空ページ', intro: '', styleId: 'shelf-sections', styleParams: {}, select: sel([], []) };
        const r = await g.build([page]);
        const html = r.files.find(f => f.path === 'empty/index.html').content;
        expect(html).not.toContain('amazon.co.jp'); // 商品リンクが無い
        expect(html).not.toContain('class="pub-ad-top"'); // よって冒頭ラベルも出さない
    });

    it('プラグイン製スタイルが helpers を介さずアフィリンクを埋めても広告ラベルが付く (ADR-034追補・開示はスタイル非依存)', async () => {
        // shows.amazon=false を申告しつつ render で b.amazonUrl (タグ入り) を直接埋め込む“行儀の悪い”スタイル
        const reg = createPublishStyleRegistry();
        reg.register({
            id: 'rogue', name: 'rogue', description: '',
            declare: () => ({ requires: { shelves: 'optional', books: 'optional' }, shows: { cover: true, author: false, rating: false, memo: false, detailMemo: false, amazon: false }, fields: [] }),
            render: (ctx) => ({ html: `<div class="pub-wrap">${ctx.books.map(b => `<a href="${ctx.helpers.attr(b.amazonUrl)}">買う</a>`).join('')}</div>`, css: '' })
        });
        const g = new PublishGenerator(makeApp(makeState(), 'plus'), reg);
        const page = { id: 'a', slug: 'rogue', title: 'R', intro: '', styleId: 'rogue', styleParams: {}, select: sel([], ['M1']) };
        const html = (await g.build([page])).files.find(f => f.path === 'rogue/index.html').content;
        expect(html).toContain('tag=aff-xyz');          // アフィリンクが実際に出力されている
        expect(html).toContain('class="pub-ad-top"');    // shows.amazon=false でも開示ラベルが付く (出力検出ベース)
    });

    it('プライバシー: vault 名が出力に混入しない (leak 検出 0)', async () => {
        const page = { id: 'a', slug: 'p', title: 'P', intro: '', styleId: 'shelf-sections', styleParams: {}, select: sel(['mid']) };
        const r = await gen.build([page]);
        const all = r.files.map(f => f.content).join('');
        expect(all).not.toContain('MySecretVault');
        expect(r.leak).toEqual([]);
    });
});

describe('公開項目はスタイルが固定する (ADR-034追補)', () => {
    it('一覧ミニマル型(cover-wall)は表紙のみ・著者/評価/メモは出さない', async () => {
        const page = { id: 'a', slug: 'wall', title: 'ウォール', intro: '', styleId: 'cover-wall', styleParams: {}, select: sel(['mid']) };
        const r = await gen.build([page]);
        const html = r.files.find(f => f.path === 'wall/index.html').content;
        expect(html).toContain('http://img/M1.jpg'); // 表紙は出る
        expect(html).not.toContain('作者A');           // 著者は出さない
        expect(html).not.toContain('本棚overrideメモ'); // 短文メモは出さない
        expect(html).not.toContain('class="stars"');    // 評価(星)は出さない
    });

    it('本棚セクション型(shelf-sections)は短文メモを出すが長文メモは出さない', async () => {
        // M1 は detailMemo を持つが、shelf-sections の shows.detailMemo=false なので読み込まれない
        const page = { id: 'a', slug: 'sec', title: 'セクション', intro: '', styleId: 'shelf-sections', styleParams: {}, select: sel(['mid']) };
        const r = await gen.build([page]);
        const html = r.files.find(f => f.path === 'sec/index.html').content;
        expect(html).toContain('ALLメモM1');           // 短文メモは出る
        expect(html).not.toContain('長文メモ本文M1');   // 長文メモは出さない (スタイル固定)
    });
});

describe('本単体じっくり型 + detailMemo', () => {
    it('長文メモを frontmatter 除去して出す', async () => {
        const page = { id: 'b', slug: 'feature', title: '特集', intro: '', styleId: 'book-feature', styleParams: {}, select: sel([], ['M1']) };
        const r = await gen.build([page]);
        const html = r.files.find(f => f.path === 'feature/index.html').content;
        expect(html).toContain('長文メモ本文M1');
        expect(html).not.toContain('updated: 2026'); // frontmatter は除去
        expect(html).toContain('漫画1');
    });
});

describe('トップ index と HTML 妥当性', () => {
    it('index.html に各ページへのリンクが出る / doctype 付き', async () => {
        const pages = [
            { id: 'a', slug: 'manga-page', title: '漫画ページ', intro: '', styleId: 'shelf-sections', styleParams: {}, select: sel(['mid']) },
            { id: 'b', slug: 'feature', title: '特集', intro: '', styleId: 'book-feature', styleParams: {}, select: sel([], ['M1']) }
        ];
        const r = await gen.build(pages);
        const idx = r.files.find(f => f.path === 'index.html').content;
        expect(idx.startsWith('<!doctype html>')).toBe(true);
        expect(idx).toContain('href="./manga-page/"');
        expect(idx).toContain('href="./feature/"');
        expect(r.pages.map(p => p.slug).sort()).toEqual(['feature', 'manga-page']);
    });

    it('不明スタイルは errors に積みファイルは作らない', async () => {
        const page = { id: 'x', slug: 'x', title: 'X', intro: '', styleId: 'no-such', styleParams: {}, select: sel(['mid']) };
        const r = await gen.build([page]);
        expect(r.errors.length).toBe(1);
        expect(r.files.find(f => f.path === 'x/index.html')).toBeUndefined();
    });
});

describe('公開サイトの体裁 (footer / OGP / 常時アフィ表明)', () => {
    const mkPage = (extra = {}) => ({
        id: 'a', slug: 'p', title: 'P', intro: 'しょうかい', styleId: 'shelf-sections', styleParams: {},
        select: sel(['mid']),
        updatedAt: new Date(2026, 5, 1, 12, 0, 0).getTime(), ...extra
    });

    it('フッターに発行者・著作権・Powered by・最終更新が出る', async () => {
        const html = (await gen.build([mkPage()])).files.find(f => f.path === 'p/index.html').content;
        expect(html).toContain('class="pub-footer"');
        expect(html).toContain('© 2026 hahero');
        expect(html).toContain('Powered by');
        expect(html).toContain('最終更新 2026-06-01');
    });

    it('サイトが収益化していれば常時アフィ表明を全ページに出す (プラン非依存)', async () => {
        const g = new PublishGenerator(makeApp(makeState(), 'plus'), createPublishStyleRegistry());
        const html = (await g.build([mkPage()])).files.find(f => f.path === 'p/index.html').content;
        expect(html).toContain('Amazon アソシエイト・プログラムに参加'); // フッターに中立な参加表明
        // 本文冒頭にも控えめな広告ラベルを出す (クリック前に認識できるよう, ステマ規制)
        expect(html).toContain('class="pub-ad-top"');
        // 収益の帰属先 (運営/発行者) や無料プランは閲覧者に開示不要 → 出さない
        expect(html).not.toContain('運営者');
        expect(html).not.toContain('無料');
    });

    it('Plus でアフィ tag 未設定なら広告なし・常時表明も出さない', async () => {
        // 収益化しない唯一の経路 = Plus かつ自分のタグ空 (Free は運営タグで常に収益化)
        const state = makeState();
        state.privateSettings.affiliateId = '';
        const g = new PublishGenerator(makeApp(state, 'plus'), createPublishStyleRegistry());
        const html = (await g.build([mkPage()])).files.find(f => f.path === 'p/index.html').content;
        expect(html).not.toContain('アソシエイト・プログラムに参加');
        expect(html).not.toContain('class="pub-ad-top"');
    });

    it('OGP: og:image に代表表紙・favicon・twitter:card が出る', async () => {
        const html = (await gen.build([mkPage()])).files.find(f => f.path === 'p/index.html').content;
        expect(html).toContain('property="og:image" content="http://img/M1.jpg"');
        expect(html).toContain('rel="icon"');
        expect(html).toContain('name="twitter:card"');
    });

    it('siteBaseUrl を渡すと canonical / og:url が付く', async () => {
        const r = await gen.build([mkPage()], { siteBaseUrl: 'https://hub.asayake.org/public/abc/' });
        const html = r.files.find(f => f.path === 'p/index.html').content;
        expect(html).toContain('rel="canonical" href="https://hub.asayake.org/public/abc/p/"');
        expect(html).toContain('property="og:url" content="https://hub.asayake.org/public/abc/p/"');
    });

    it('page.noindex で robots が noindex になる', async () => {
        const html = (await gen.build([mkPage({ noindex: true })])).files.find(f => f.path === 'p/index.html').content;
        expect(html).toContain('content="noindex,nofollow"');
    });
});

describe('プライバシー誤検知ガード (leak)', () => {
    it('extensionImportOrigins にアプリ公開 origin があっても footer の Powered by リンクで誤検知しない', async () => {
        const state = makeState();
        // 取込元 origin にアプリ自身の公開 origin（footer のリンクと部分一致する）が入っているケース
        state.privateSettings.extensionImportOrigins = ['http://localhost:*', 'https://hahero-asayake.github.io'];
        const g = new PublishGenerator(makeApp(state), createPublishStyleRegistry());
        const page = { id: 'a', slug: 'p', title: 'P', intro: '', styleId: 'shelf-sections', styleParams: {}, select: sel(['mid']) };
        const r = await g.build([page]);
        // footer に https://hahero-asayake.github.io/bookshelf が必ず入る（正当）
        expect(r.files.some(f => f.content.includes('hahero-asayake.github.io'))).toBe(true);
        // それでも leak は 0（取込元 origin は needle にしない）
        expect(r.leak).toEqual([]);
    });

    it('vault サブパスが出力に混入した場合は leak として検出する', async () => {
        const state = makeState();
        state.privateSettings.obsidianVaultName = 'obsidian';
        state.privateSettings.obsidianSubPath = '40_reading_secret';
        // メモにうっかりローカルパスが混入したと仮定
        state.bookshelfFiles.mid.notes.M1 = { memo: 'メモ see obsidian/40_reading_secret' };
        const g = new PublishGenerator(makeApp(state), createPublishStyleRegistry());
        const page = { id: 'a', slug: 'p', title: 'P', intro: '', styleId: 'shelf-sections', styleParams: {}, select: sel(['mid']) };
        const r = await g.build([page]);
        expect(r.leak.length).toBeGreaterThan(0);
    });
});

describe('全標準スタイルの機能検証 (P1-6)', () => {
    it('5スタイルが本棚(slug)+本選択で例外なく生成・個人情報非漏洩・非選択本は出ない', async () => {
        const reg = createPublishStyleRegistry();
        expect(reg.list().length).toBe(5);
        for (const style of reg.list()) {
            const g = new PublishGenerator(makeApp(makeState()), reg);
            const page = {
                id: style.id, slug: 'p-' + style.id, title: style.name, intro: '紹介',
                styleId: style.id, styleParams: { lead: 'リード文', note: '本文ノート' },
                select: sel(['manga'], ['M1'])
            };
            const r = await g.build([page]);
            const file = r.files.find(f => f.path === `p-${style.id}/index.html`);
            expect(file, style.id).toBeTruthy();
            expect(file.content.startsWith('<!doctype html>'), style.id).toBe(true);
            expect(r.errors, style.id).toEqual([]);
            expect(r.leak, style.id).toEqual([]);
            expect(file.content, style.id).not.toContain('小説1'); // 非選択本棚 (novel) は出ない
            expect(file.content, style.id).not.toContain('MySecretVault');
        }
    });

    it('各スタイルの declare().shows が全項目キーを持つ (公開項目はスタイル固定)', () => {
        const reg = createPublishStyleRegistry();
        const keys = ['rating', 'memo', 'detailMemo', 'cover', 'author', 'amazon'];
        for (const style of reg.list()) {
            const shows = style.declare().shows;
            expect(shows, style.id).toBeTruthy();
            for (const k of keys) expect(typeof shows[k], `${style.id}.${k}`).toBe('boolean');
        }
    });
});
