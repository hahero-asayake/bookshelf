// BookshelfStorage の frontmatter ヘルパテスト (T04 / ADR-024)
import { describe, it, expect } from 'vitest';

await import('../../js/storage.js');
const S = window.BookshelfStorage;

const FM_TEXT = `---
asin: TEST123
title: "テスト"
created: 2026-01-01T00:00:00Z
updated: 2026-01-01T00:00:00Z
customKey: keepme
---

# 本文

---

水平線の下も本文
`;

describe('splitFrontmatter', () => {
    it('先頭の frontmatter を分離し、結合で元に戻る', () => {
        const { frontmatter, body } = S.splitFrontmatter(FM_TEXT);
        expect(frontmatter).not.toBeNull();
        expect(body.includes('# 本文')).toBe(true);
        expect(frontmatter + body).toBe(FM_TEXT);
    });
    it('本文中の --- (水平線) を誤検出しない', () => {
        const { body } = S.splitFrontmatter(FM_TEXT);
        expect(body).toContain('\n---\n\n水平線の下も本文');
    });
    it('先頭が --- でなければ frontmatter: null', () => {
        const noFm = '# 見出し\n\n---\n\n本文';
        const r = S.splitFrontmatter(noFm);
        expect(r.frontmatter).toBeNull();
        expect(r.body).toBe(noFm);
    });
});

describe('joinFrontmatter', () => {
    it('updated 行だけが更新され、他の行と本文は不変', () => {
        const { frontmatter, body } = S.splitFrontmatter(FM_TEXT);
        const joined = S.joinFrontmatter(frontmatter, body);
        const after = S.splitFrontmatter(joined);
        const beforeLines = frontmatter.split('\n');
        const afterLines = after.frontmatter.split('\n');
        expect(afterLines.length).toBe(beforeLines.length);
        const diffs = beforeLines.filter((l, i) => l !== afterLines[i]);
        expect(diffs.length).toBe(1);
        expect(diffs[0].startsWith('updated:')).toBe(true);
        expect(after.body).toBe(body);
        expect(joined).toContain('customKey: keepme');
    });
    it('updated 行が無ければ閉じ --- の直前に追加する', () => {
        const src = '---\nasin: X\n---\nbody';
        const { frontmatter, body } = S.splitFrontmatter(src);
        const joined = S.joinFrontmatter(frontmatter, body);
        expect(joined).toMatch(/\nupdated: 20\d\d-/);
        expect(joined.endsWith('body')).toBe(true);
    });
    it('frontmatter が null なら何も追加しない', () => {
        expect(S.joinFrontmatter(null, '# メモ')).toBe('# メモ');
    });
});
