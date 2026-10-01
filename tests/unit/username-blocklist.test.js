// @vitest-environment node
// username ブロックリスト (なりすまし・コンプライアンス違反語の部分一致ブロック)
// ADR-114・2026-10-01 ハヘロ決裁「案B・公式マーク無し」・イシュー#269 step2
import { describe, it, expect } from 'vitest';
import { containsBlockedWord, normalizeForBlocklist, IMPERSONATION_WORDS, COMPLIANCE_WORDS } from '../../cf-worker/username-blocklist.js';
import { isValidUsername } from '../../cf-worker/reserved-usernames.js';

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
