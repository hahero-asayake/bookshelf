// @vitest-environment node
// 文言の抽出 (scripts/extract-ui-strings.mjs・イシュー#585) を、見本のリポジトリ
// (tests/fixtures/audit/extract) に対して子プロセスで実行し、出力を確かめる。
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(ROOT, 'tests/fixtures/audit/extract');

let all;
let md;
let legalMd;
beforeAll(() => {
    const out = mkdtempSync(join(tmpdir(), 'ui-strings-'));
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/extract-ui-strings.mjs'), `--root=${FIXTURE}`, `--out=${out}`], { encoding: 'utf-8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    all = JSON.parse(readFileSync(join(out, 'ui-strings.json'), 'utf-8'));
    md = readFileSync(join(out, 'ui-strings.md'), 'utf-8');
    legalMd = readFileSync(join(out, 'ui-strings-legal.md'), 'utf-8');
});
const find = (text) => all.find((x) => x.text === text);
const has = (text) => all.some((x) => x.text.includes(text));

describe('extract-ui-strings (文言の抽出)', () => {
    it('index.html の head は ogp、body の文字と属性は app で拾う', () => {
        expect(find('見本の本棚')).toMatchObject({ kind: 'ogp', via: 'title', src: 'index.html:4' });
        expect(find('見本の説明文です')).toMatchObject({ kind: 'ogp', via: 'meta:description' });
        expect(find('見本のOGタイトル')).toMatchObject({ kind: 'ogp', via: 'meta:og:title' });
        expect(find('見本の見出し')).toMatchObject({ kind: 'app', via: 'text', src: 'index.html:9' });
        expect(find('閉じる見本')).toMatchObject({ kind: 'app', via: 'attr:aria-label' });
        expect(find('テンプレートの中の文')).toMatchObject({ kind: 'app' });
        expect(has('スクリプトの中は拾わない')).toBe(false);
    });

    it('JS は toast・確認ダイアログの値・エラー文を、場所と拾い方つきで拾う', () => {
        expect(find('保存しました')).toMatchObject({ kind: 'app', via: 'toast', src: 'js/a.js:4' });
        expect(find('削除の確認')).toMatchObject({ via: 'title' });
        expect(find('「〈値〉」を削除しますか？')).toMatchObject({ via: 'message' });
        expect(find('削除する')).toMatchObject({ via: 'okLabel' });
        expect(find('やめる')).toMatchObject({ via: 'cancelLabel' });
        expect(find('読み込みに失敗しました')).toMatchObject({ kind: 'error', via: 'error', src: 'js/a.js:9' });
        expect(find('画面フォルダの文')).toMatchObject({ kind: 'app', src: 'js/screens/b.js:2' });
    });

    it('HTML を組み立てる文字列は、属性とタグの間の文字に分けて拾う', () => {
        expect(find('ヒントの見本')).toMatchObject({ kind: 'app', via: 'attr:title', src: 'js/a.js:8' });
        expect(find('中の文字')).toMatchObject({ kind: 'app', via: 'html' });
    });

    it('コメント・開発者向けのログ・検索用の語・同梱ライブラリは拾わない', () => {
        for (const text of ['コメントの日本語は拾わない', 'ブロックコメントも拾わない', '開発者向けのログ', '正規表現の中の引用符', '検索用の語', 'CSS のコメントは拾わない', '中のコメントは拾わない', '同梱ライブラリは拾わない', '対象外のファイルの文']) {
            expect(has(text), text).toBe(false);
        }
        expect(find('本を探す')).toMatchObject({ via: 'title' });
    });

    it('文字列の中のプログラムは、その中の文字列だけを拾う', () => {
        expect(find('中のプログラムの文')).toMatchObject({ kind: 'app', src: 'js/a.js:13' });
    });

    it('公開ページ・エラー文・manifest・legal を kind で分ける', () => {
        expect(find('公開ページの見出し')).toMatchObject({ kind: 'public', via: 'html', src: 'cf-worker/top-page.js:2' });
        expect(find('公開トップの見本')).toMatchObject({ kind: 'ogp', via: 'title' });
        expect(find('公開の説明の見本')).toMatchObject({ kind: 'ogp', via: 'meta:og:description' });
        expect(find('ユーザー名が使えません')).toMatchObject({ kind: 'error', via: 'error', src: 'cf-worker/api.js:2' });
        expect(find('見本アプリ')).toMatchObject({ kind: 'ogp', via: 'manifest:name', src: 'manifest.webmanifest:2' });
        expect(find('見本の説明')).toMatchObject({ kind: 'ogp', via: 'manifest:description' });
        expect(has('Mihon')).toBe(false);
        expect(find('利用規約の見本')).toMatchObject({ kind: 'legal', via: 'title' });
        expect(find('規約の本文です')).toMatchObject({ kind: 'legal', src: 'legal/terms.html:5' });
    });

    it('textlint 用の md は legal を分け、場所をコメントに持つ', () => {
        expect(md).toContain('- 保存しました<!-- js/a.js:4 -->');
        expect(md).not.toContain('規約の本文です');
        expect(legalMd).toContain('- 規約の本文です<!-- legal/terms.html:5 -->');
    });
});
