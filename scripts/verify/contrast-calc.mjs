// 実行: node scripts/verify/contrast-calc.mjs
// 色コントラスト比(WCAG相対輝度)の計算ツール。ui-standards §2-10の色トークン検証に使う。
// URL/実データを扱わない純粋計算のみ＝BOOKSHELF_VERIFY_DATA_DIR等の対象外。
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relLum([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [f(r), f(g), f(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function ratio(hex1, hex2) {
  const L1 = relLum(hexToRgb(hex1));
  const L2 = relLum(hexToRgb(hex2));
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

const light = { bg: '#f4f5f7', panel: '#ffffff', side: '#fbfbfd', fg: '#1c1f24', fg2: '#4b5460', muted: '#6b7280', line: '#e4e7eb', line2: '#eef0f3' };
const dark  = { bg: '#15171c', panel: '#1d2026', side: '#191c22', fg: '#e6e8ec', fg2: '#b3b9c4', muted: '#8b93a1', line: '#2c313a', line2: '#242831' };

const sites = [
  { name: '.strip-label',              bgKeyLight: 'side',  bgKeyDark: 'side'  },
  { name: '.detail-placeholder',       bgKeyLight: 'panel', bgKeyDark: 'panel' },
  { name: '.icon-picker-direct-hint',  bgKeyLight: 'panel', bgKeyDark: 'panel' },
  { name: '.icon-picker-cell-name(通常)', bgKeyLight: 'panel', bgKeyDark: 'panel' },
  { name: '.icon-picker-cell-name(hover)', bgKeyLight: 'line2', bgKeyDark: 'line2' },
  { name: '.widget-grip',              bgKeyLight: 'panel', bgKeyDark: 'panel' },
  { name: '.bookshelf-empty .bse-icon',bgKeyLight: 'bg',    bgKeyDark: 'bg'    },
];

console.log('=== --muted 案での実測 ===');
for (const s of sites) {
  const rl = ratio(light.muted, light[s.bgKeyLight]);
  const rd = ratio(dark.muted, dark[s.bgKeyDark]);
  console.log(`${s.name.padEnd(28)} light(muted ${light.muted} on ${light[s.bgKeyLight]})=${rl.toFixed(2)}  dark(muted ${dark.muted} on ${dark[s.bgKeyDark]})=${rd.toFixed(2)}`);
}

console.log('\n=== 参考: --fg2 案 ===');
for (const s of sites) {
  const rl = ratio(light.fg2, light[s.bgKeyLight]);
  const rd = ratio(dark.fg2, dark[s.bgKeyDark]);
  console.log(`${s.name.padEnd(28)} light(fg2 ${light.fg2} on ${light[s.bgKeyLight]})=${rl.toFixed(2)}  dark(fg2 ${dark.fg2} on ${dark[s.bgKeyDark]})=${rd.toFixed(2)}`);
}

console.log('\n=== .icon-picker-cell-name の is-selected 面 (参考・非対象状態) ===');
const lightAccentBg = '#eef0ff';
const darkAccentBg = '#232842';
console.log('fg2 on selected(light)=' + ratio(light.fg2, lightAccentBg).toFixed(2));
console.log('fg2 on selected(dark)='  + ratio(dark.fg2, darkAccentBg).toFixed(2));
console.log('muted on selected(light)=' + ratio(light.muted, lightAccentBg).toFixed(2));
console.log('muted on selected(dark)='  + ratio(dark.muted, darkAccentBg).toFixed(2));
