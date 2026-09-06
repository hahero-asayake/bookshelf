// ART_PREVIEW_STAGE_LABEL: 記事プレビューの「生成中…」に段階名を出す純粋関数の検証 (イシュー#153で新設・
// イシュー#156で解像度を上げた=起動ハンドラ到達(build-entered)/fetch3分割(fetch-start/headers/body-done)/
// ブロック単位(block-start/block-done)/DOM反映(dom)を追加)。
// VirtualBookshelf 自体は DOM 依存が強くこの経路の import では安全にインスタンス化できないため、
// 検証したいロジックは純粋関数として window に切り出してある (extractAppVersionFromHtml と同じ型)。
import { describe, it, expect } from 'vitest';

await import('../../js/bookshelf.js');
const { ART_PREVIEW_STAGE_LABEL } = globalThis;

describe('ART_PREVIEW_STAGE_LABEL', () => {
    it('progress が無ければ空文字 (容疑者①=_artRunPreviewBuild未到達の初期値は build-entered 前提だが、念のため防御)', () => {
        expect(ART_PREVIEW_STAGE_LABEL(null)).toBe('');
        expect(ART_PREVIEW_STAGE_LABEL(undefined)).toBe('');
    });

    it('build-entered (2:_artRunPreviewBuild冒頭到達の計測点) は「生成準備中」', () => {
        expect(ART_PREVIEW_STAGE_LABEL({ stage: 'build-entered' })).toBe('生成準備中・');
    });

    it('reading (phase無し・#153時点の大枠通知) は冊数を出す', () => {
        expect(ART_PREVIEW_STAGE_LABEL({ stage: 'reading', done: 1, total: 3 })).toBe('長文メモ 1/3 読込中・');
    });

    it('reading total:0 (対象0件) は冊数を出さない', () => {
        expect(ART_PREVIEW_STAGE_LABEL({ stage: 'reading', done: 0, total: 0 })).toBe('長文メモ読込中・');
    });

    it('reading phase:fetch-start はアダプタ種別つきで「問合せ中」を出す (容疑者②の起点)', () => {
        const text = ART_PREVIEW_STAGE_LABEL({ stage: 'reading', done: 0, total: 1, phase: 'fetch-start', asin: 'X1', adapterKind: 'GitHub（fetch経由）' });
        expect(text).toBe('長文メモ 0/1 読込中（GitHub（fetch経由）へ問合せ中）・');
    });

    it('reading phase:headers は「応答ヘッダ受信・本文待ち」を出す (容疑者②のResponse直返し+finally clearTimeout型の罠が万一再発した場合、ここで止まって見える)', () => {
        const text = ART_PREVIEW_STAGE_LABEL({ stage: 'reading', done: 0, total: 1, phase: 'headers', asin: 'X1', adapterKind: 'GitHub（fetch経由）', elapsedMs: 120 });
        expect(text).toBe('長文メモ 0/1 読込中（応答ヘッダ受信・本文待ち）・');
    });

    it('reading phase:body-done は「本文受信完了」を出す', () => {
        const text = ART_PREVIEW_STAGE_LABEL({ stage: 'reading', done: 0, total: 1, phase: 'body-done', asin: 'X1', adapterKind: 'GitHub（fetch経由）', elapsedMs: 300 });
        expect(text).toBe('長文メモ 0/1 読込中（本文受信完了）・');
    });

    it('rendering (phase無し・#153時点の大枠通知) は「Markdown変換中」のみ', () => {
        expect(ART_PREVIEW_STAGE_LABEL({ stage: 'rendering', done: 0, total: 0 })).toBe('Markdown変換中・');
    });

    it('rendering phase:block-start/block-done はブロック番号+種別を1始まりで出す', () => {
        const start = ART_PREVIEW_STAGE_LABEL({ stage: 'rendering', done: 0, total: 0, phase: 'block-start', blockIndex: 0, blockType: 'book' });
        const done = ART_PREVIEW_STAGE_LABEL({ stage: 'rendering', done: 0, total: 0, phase: 'block-done', blockIndex: 2, blockType: 'shelf' });
        expect(start).toBe('Markdown変換中（ブロック1: book）・');
        expect(done).toBe('Markdown変換中（ブロック3: shelf）・');
    });

    it('assembling は「ページ組立中」', () => {
        expect(ART_PREVIEW_STAGE_LABEL({ stage: 'assembling', done: 0, total: 0 })).toBe('ページ組立中・');
    });

    it('dom (6:DOM反映完了の計測点) は「画面反映中」', () => {
        expect(ART_PREVIEW_STAGE_LABEL({ stage: 'dom' })).toBe('画面反映中・');
    });

    it('未知の stage は空文字 (後方互換・古い呼び出し元が未知の値を渡しても例外にならない)', () => {
        expect(ART_PREVIEW_STAGE_LABEL({ stage: 'mystery' })).toBe('');
    });
});
