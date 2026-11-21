// イシュー#728: 画像比較のコンテナのイメージの版が、package.json・package-lock.json の
// @playwright/test と揃っているかを確かめる。ずれると、手元 (visual-docker.mjs) と CI (visual.yml) で
// 違うブラウザ・違う書体で描き、基準画像と全件が差分になる。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visualImage, visualImageFor, lockedPlaywrightVersion } from '../../scripts/verify/visual-image.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('画像比較のコンテナのイメージ (#728)', () => {
    it('package.json の @playwright/test の版と package-lock.json の版が同じ', () => {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
        const range = pkg.devDependencies?.['@playwright/test'] ?? pkg.dependencies?.['@playwright/test'];
        expect(range.replace(/^[\^~]/, '')).toBe(lockedPlaywrightVersion(root));
    });

    it('visual.yml の container の image が package-lock.json の版のイメージと同じ', () => {
        const yml = readFileSync(join(root, '.github', 'workflows', 'visual.yml'), 'utf-8');
        const images = [...yml.matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map((m) => m[1]);
        expect(images).toEqual([visualImage(root)]);
    });

    it('イメージ名は公式の Playwright イメージの v<版>-resolute', () => {
        expect(visualImageFor('1.2.3')).toBe('mcr.microsoft.com/playwright:v1.2.3-resolute');
    });
});
