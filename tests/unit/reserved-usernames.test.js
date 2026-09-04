// @vitest-environment node
// username バリデーション・予約語判定 (S6・ADR-076・設計書 09 §10.3-v2)
import { describe, it, expect } from 'vitest';
import { isValidUsername, isReservedTopLevel, RESERVED_USERNAMES, EXCLUDED_PATHS } from '../../cf-worker/reserved-usernames.js';

describe('isValidUsername', () => {
    it('制約を満たす通常の username は true', () => {
        expect(isValidUsername('taro-books')).toBe(true);
        expect(isValidUsername('abc')).toBe(true); // 3文字ちょうど
    });
    it('3文字未満・31文字以上は false', () => {
        expect(isValidUsername('ab')).toBe(false);
        expect(isValidUsername('a'.repeat(31))).toBe(false);
    });
    it('先頭/末尾ハイフンは false', () => {
        expect(isValidUsername('-taro')).toBe(false);
        expect(isValidUsername('taro-')).toBe(false);
    });
    it('大文字・記号・日本語は false (正規表現で弾かれる)', () => {
        expect(isValidUsername('Taro')).toBe(false);
        expect(isValidUsername('taro_books')).toBe(false);
        expect(isValidUsername('たろう')).toBe(false);
    });
    it('①予約語 (RESERVED_USERNAMES) は false', () => {
        for (const w of RESERVED_USERNAMES) expect(isValidUsername(w)).toBe(false);
    });
});

describe('isReservedTopLevel', () => {
    it('①②いずれの語も予約済み扱い', () => {
        for (const w of [...RESERVED_USERNAMES, ...EXCLUDED_PATHS]) expect(isReservedTopLevel(w)).toBe(true);
    });
    it('通常の username は予約済みでない', () => {
        expect(isReservedTopLevel('taro-books')).toBe(false);
    });
    it('② EXCLUDED_PATHS はそもそも username 制約 {3,30} を満たさない語のみ (2文字 or ドット付き)', () => {
        for (const w of EXCLUDED_PATHS) {
            const okLength = /^[a-z0-9-]{3,30}$/.test(w);
            expect(okLength, `${w} は3文字以上の英数字ではないはず`).toBe(false);
        }
    });
});
