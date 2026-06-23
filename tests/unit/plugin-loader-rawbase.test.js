// BookshelfPluginLoader._toRawGitHubBase: GitHub repo URL → raw ベース URL の解決
// マーケット導入の SHA ピン (opts.sha) + サブパス上書き (opts.path) を検証 (ADR-040 Phase1)
import { describe, it, expect } from 'vitest';

await import('../../js/plugin-loader.js');
const BookshelfPluginLoader = window.BookshelfPluginLoader;
const ld = new BookshelfPluginLoader({}); // _toRawGitHubBase は this.app 不使用

const RAW = 'https://raw.githubusercontent.com';

describe('_toRawGitHubBase (基本)', () => {
    it('repo ルート → main ブランチ', () => {
        expect(ld._toRawGitHubBase('https://github.com/o/r')).toBe(`${RAW}/o/r/main/`);
    });
    it('.git サフィックスを除去', () => {
        expect(ld._toRawGitHubBase('https://github.com/o/r.git')).toBe(`${RAW}/o/r/main/`);
    });
    it('tree/branch/sub を解釈', () => {
        expect(ld._toRawGitHubBase('https://github.com/o/r/tree/dev/a/b')).toBe(`${RAW}/o/r/dev/a/b/`);
    });
    it('github.com 以外は null', () => {
        expect(ld._toRawGitHubBase('https://gitlab.com/o/r')).toBeNull();
        expect(ld._toRawGitHubBase('not a url')).toBeNull();
    });
    it('owner/repo 未満は null', () => {
        expect(ld._toRawGitHubBase('https://github.com/onlyowner')).toBeNull();
    });
});

describe('_toRawGitHubBase (SHA ピン / path 上書き = マーケット導入)', () => {
    it('opts.sha で ref を SHA に固定', () => {
        expect(ld._toRawGitHubBase('https://github.com/o/r', { sha: 'abc123' })).toBe(`${RAW}/o/r/abc123/`);
    });
    it('opts.path で subPath を上書き (先頭/末尾スラッシュを正規化)', () => {
        expect(ld._toRawGitHubBase('https://github.com/o/r', { sha: 'abc', path: '/plugins-sample/series-grouping/' }))
            .toBe(`${RAW}/o/r/abc/plugins-sample/series-grouping/`);
    });
    it('マーケットエントリ想定 (repoUrl + sha + path)', () => {
        expect(ld._toRawGitHubBase('https://github.com/hahero-asayake/bookshelf', { sha: 'deadbeef', path: 'plugins-sample/dark-theme' }))
            .toBe(`${RAW}/hahero-asayake/bookshelf/deadbeef/plugins-sample/dark-theme/`);
    });
    it('sha は URL 中の branch より優先 (tree/branch を上書き)', () => {
        expect(ld._toRawGitHubBase('https://github.com/o/r/tree/main/x', { sha: 'pin' })).toBe(`${RAW}/o/r/pin/x/`);
    });
});
