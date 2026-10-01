// @vitest-environment node
// username ブロックリスト (なりすまし・コンプライアンス違反語の部分一致ブロック)
// ADR-114・2026-10-01 ハヘロ決裁「案B・公式マーク無し」・イシュー#269 step2
// イシュー#271 (2026-10-01) で有志の公開リストを EXACT_WORDS(完全一致)/SUBSTRING_WORDS(部分一致) として
// cf-worker/username-blocklist-data.js に取り込んだ。該当テストは下部参照。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { containsBlockedWord, normalizeForBlocklist, IMPERSONATION_WORDS, COMPLIANCE_WORDS } from '../../cf-worker/username-blocklist.js';
import { EXACT_WORDS, SUBSTRING_WORDS } from '../../cf-worker/username-blocklist-data.js';
import { isValidUsername } from '../../cf-worker/reserved-usernames.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('containsBlockedWord: ① なりすまし語 (運営・権限を騙る語)', () => {
    it('決裁で名指しされた語そのものを含む username は弾く', () => {
        for (const w of IMPERSONATION_WORDS) {
            expect(containsBlockedWord(w), w).toBe(true);
            expect(containsBlockedWord(`the-${w}`), `the-${w}`).toBe(true);
            expect(containsBlockedWord(`${w}-x`), `${w}-x`).toBe(true);
        }
    });
    it('leet 風の見た目類似 (数字置換) も正規化して弾く', () => {
        expect(containsBlockedWord('adm1n')).toBe(true);
        expect(containsBlockedWord('r00t')).toBe(true);
        expect(containsBlockedWord('0fficial')).toBe(true);
        expect(containsBlockedWord('sy5tem')).toBe(true);
    });
    it('ハイフン区切りで分割しても (除去後に) 弾く', () => {
        expect(containsBlockedWord('a-d-m-i-n')).toBe(true);
    });
});

describe('containsBlockedWord: ② コンプライアンス違反語', () => {
    it('決裁で名指しされた語そのものを含む username は弾く', () => {
        for (const w of COMPLIANCE_WORDS) {
            expect(containsBlockedWord(w), w).toBe(true);
        }
    });
    it('ヒトラー・ナチス (ハヘロ原文の具体例) を弾く', () => {
        expect(containsBlockedWord('hitler')).toBe(true);
        expect(containsBlockedWord('hitler-fan')).toBe(true);
        expect(containsBlockedWord('nazi-stuff')).toBe(true);
    });
});

describe('containsBlockedWord: 既存2ユーザーは新ルールで弾かれない (②指示③)', () => {
    it('hahero は false (ero を含むが ero 自体はブロックリストに無い)', () => {
        expect(containsBlockedWord('hahero')).toBe(false);
        expect(isValidUsername('hahero')).toBe(true);
    });
    it('kurokotest は false', () => {
        expect(containsBlockedWord('kurokotest')).toBe(false);
        expect(isValidUsername('kurokotest')).toBe(true);
    });
});

describe('containsBlockedWord: 意図的に除外した短い語根の false positive 回避 (コメント記載分の裏取り)', () => {
    // 'ero' を入れていたら弾かれていたはずの一般語
    it('hero / zero は弾かれない (ero を含むが未採用)', () => {
        expect(containsBlockedWord('hero')).toBe(false);
        expect(containsBlockedWord('zero-shelf')).toBe(false);
    });
    // 'rape' を入れていたら弾かれていたはずの一般語
    it('grape / drape / scraper は弾かれない (rape を含むが未採用)', () => {
        expect(containsBlockedWord('grape-lover')).toBe(false);
        expect(containsBlockedWord('drape')).toBe(false);
        expect(containsBlockedWord('scraper')).toBe(false);
    });
    // 'kill' を入れていたら弾かれていたはずの一般語
    it('skill / skilled は弾かれない (kill を含むが未採用)', () => {
        expect(containsBlockedWord('skillful-reader')).toBe(false);
        expect(containsBlockedWord('skilled')).toBe(false);
    });
    // 'meth' を入れていたら弾かれていたはずの一般語
    it('method / methodical は弾かれない (meth を含むが未採用)', () => {
        expect(containsBlockedWord('methodical')).toBe(false);
        expect(containsBlockedWord('my-method')).toBe(false);
    });
    // 'heroin' を入れていたら弾かれていたはずの本棚文脈の語
    it('heroine (読書アプリの文脈語) は弾かれない (heroin を含むが未採用)', () => {
        expect(containsBlockedWord('bookheroine')).toBe(false);
        expect(containsBlockedWord('heroine-fan')).toBe(false);
    });
    // 採用した 'root'/'system' は決裁で名指しされた既知のトレードオフとして衝突を許容する
    it('(既知のトレードオフ) root/system を含む一般語も弾かれる仕様', () => {
        expect(containsBlockedWord('uproot')).toBe(true);
        expect(containsBlockedWord('ecosystem')).toBe(true);
    });
});

describe('normalizeForBlocklist', () => {
    it('NFKC・小文字化・ハイフン除去・数字の見た目類似を標準字へ寄せる', () => {
        expect(normalizeForBlocklist('Adm1n-User')).toBe('adminuser');
        expect(normalizeForBlocklist('r00t')).toBe('root');
    });
});

describe('isValidUsername: 一般的な (無害な) username は引き続き true', () => {
    it('よくある本棚文脈の username は弾かれない', () => {
        for (const u of ['taro-books', 'bookworm-123', 'reading-life', 'novel-fan', 'shelf-master']) {
            expect(isValidUsername(u), u).toBe(true);
        }
    });
});

describe('isValidUsername: ブロックリスト該当語を含む username は false', () => {
    it('運営を騙る語を含む username', () => {
        expect(isValidUsername('admin-support')).toBe(false);
        expect(isValidUsername('asayake-official')).toBe(false);
        expect(isValidUsername('bookshelf-root')).toBe(false);
    });
    it('コンプライアンス違反語を含む username', () => {
        expect(isValidUsername('hitler-fan')).toBe(false);
        expect(isValidUsername('xxx-videos')).toBe(false);
    });
});

// --- イシュー#271: 有志の公開リストから取り込んだ語 ---

describe('isValidUsername: ③ 公開リストの運営・システム系予約語 (EXACT_WORDS・完全一致)', () => {
    it('EXACT_WORDS と username 全体が完全一致する場合は false (抜き取りサンプル)', () => {
        // shouldbee/reserved-usernames・marteinn/The-Big-Username-Blocklist 由来 + 誤爆したため
        // 完全一致に格下げした不適切語 (いずれも EXACT_WORDS 全879語からの代表サンプル)
        for (const u of ['webmaster', 'accounts', '404', '500', 'ass', 'cock', 'sex', 'rape', 'debu', 'sina', 'tintin']) {
            expect(EXACT_WORDS.includes(u), `EXACT_WORDS に '${u}' があること`).toBe(true);
            expect(isValidUsername(u), u).toBe(false);
        }
    });
    it('完全一致語を部分的に含むだけの username は弾かれない (完全一致の定義どおり)', () => {
        // 'ass' は EXACT_WORDS 側 (部分一致では誤爆するため)。'agassi' のような一般語は許可する。
        expect(isValidUsername('agassi')).toBe(true);
        expect(isValidUsername('debussy')).toBe(true);
        expect(isValidUsername('sinatra')).toBe(true);
    });
    it('数字のみの完全一致語は leet 変換をせず生の文字列で比較する (イシュー#271 step3 実測)', () => {
        // leet 変換 (4→a,1→i,3→e,4→a,5→s,7→t) を数字のみの語にも適用すると、
        // '415' → 'ais' のように辞書に実在する一般語と衝突してしまう (実測で発見)。
        // そのため数字のみの完全一致語は leet 変換をしない設計にした。
        expect(containsBlockedWord('415')).toBe(true); // 生の文字列として完全一致
        expect(containsBlockedWord('ais')).toBe(false); // 実在の英単語 (地名・航空会社コード等) は弾かれない
        expect(containsBlockedWord('4i5')).toBe(false); // leet 偽装では弾かれない (意図的なトレードオフ)
        expect(containsBlockedWord('404')).toBe(true);
    });
});

describe('isValidUsername: ③ 公開リストの不適切語 (SUBSTRING_WORDS・部分一致、英語+日本語ローマ字)', () => {
    it('SUBSTRING_WORDS に採用した語 (誤爆ゼロ確認済み) を含む username は false (代表サンプル)', () => {
        for (const u of ['chinko', 'manko', 'sekkusu', 'oppai', 'bukkake', 'bareback', 'anilingus']) {
            expect(SUBSTRING_WORDS.includes(u), `SUBSTRING_WORDS に '${u}' があること`).toBe(true);
            expect(isValidUsername(u)).toBe(false);
            expect(isValidUsername(`my-${u}-page`)).toBe(false);
        }
    });
    it('ハヘロ決裁の具体例 (エロ系の日本語ローマ字) を弾く', () => {
        expect(isValidUsername('chinko')).toBe(false);
        expect(isValidUsername('manko')).toBe(false);
        expect(isValidUsername('sekkusu')).toBe(false);
        expect(isValidUsername('oppai')).toBe(false);
    });
});

describe('isValidUsername: 誤爆検証コーパス (イシュー#271 step3・tests/fixtures に固定)', () => {
    const fixturePath = path.join(__dirname, '../fixtures/username-false-positive-corpus.txt');
    const corpus = fs.readFileSync(fixturePath, 'utf8')
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('#'));

    it('フィクスチャが空でないこと (前提条件)', () => {
        expect(corpus.length).toBeGreaterThan(1000);
    });

    it('コーパス全件で containsBlockedWord が false (誤爆ゼロ)', () => {
        const falsePositives = corpus.filter((w) => containsBlockedWord(w));
        expect(falsePositives, `誤爆した語: ${falsePositives.join(', ')}`).toEqual([]);
    });

    it('コーパス全件で isValidUsername が true (username 制約を満たす形に限定して経路を通す)', () => {
        const usernameShaped = corpus.filter((w) => /^[a-z0-9-]{3,30}$/.test(w));
        expect(usernameShaped.length).toBeGreaterThan(1000);
        const rejected = usernameShaped.filter((w) => !isValidUsername(w));
        expect(rejected, `isValidUsername で弾かれた語: ${rejected.join(', ')}`).toEqual([]);
    });

    it('hahero・kurokotest はコーパスに含まれ、isValidUsername で true (必須)', () => {
        expect(corpus.includes('hahero')).toBe(true);
        expect(corpus.includes('kurokotest')).toBe(true);
        expect(isValidUsername('hahero')).toBe(true);
        expect(isValidUsername('kurokotest')).toBe(true);
    });
});
