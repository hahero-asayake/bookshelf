'use strict';

// Lucide アイコン (inline 化版)
// https://lucide.dev/icons/ から path のみ抽出
// 追加時は同サイトの SVG → <svg> タグ内の inner だけここに入れる
//
// 分類タグ (data-category 検索用):
//   ui     : ヘッダー/UI コントロール
//   books  : 本/本棚/読書ジャンル
//   topic  : ジャンルメタファ (ビジネス/技術/料理/旅 など)
//   action : 操作 (追加/編集/削除/同期 など)
//   ext    : 外部連携/汎用

const LUCIDE_ICONS = {
    // ===== UI コントロール (ヘッダー) =====
    'arrow-left':
        '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'arrow-right':
        '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    'chevron-left':
        '<path d="m15 18-6-6 6-6"/>',
    'chevron-right':
        '<path d="m9 18 6-6-6-6"/>',
    'chevron-down':
        '<path d="m6 9 6 6 6-6"/>',
    'chevron-up':
        '<path d="m18 15-6-6-6 6"/>',
    'image':
        '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    'list':
        '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
    'search':
        '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
    'sliders-horizontal':
        '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
    'settings':
        '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
    'x':
        '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    'check':
        '<path d="M20 6 9 17l-5-5"/>',
    'plus':
        '<path d="M5 12h14"/><path d="M12 5v14"/>',
    'minus':
        '<path d="M5 12h14"/>',
    'pen-line':
        '<path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    'pencil':
        '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    'trash-2':
        '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',

    // ===== 本/本棚 =====
    'library':
        '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
    'book':
        '<path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16"/><path d="M2 19h14a2 2 0 0 1 0 4H6a2 2 0 0 1-2-2"/><path d="M7 17h12"/>',
    'book-open':
        '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    'book-marked':
        '<path d="M10 2v8l3-3 3 3V2"/><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
    'book-heart':
        '<path d="M16 8.2A2.22 2.22 0 0 0 13.8 6c-.8 0-1.4.3-1.8.9-.4-.6-1-.9-1.8-.9A2.22 2.22 0 0 0 8 8.2c0 .6.3 1.2.7 1.6A226.652 226.652 0 0 0 12 13a404 404 0 0 0 3.3-3.1 2.413 2.413 0 0 0 .7-1.7"/><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
    'bookmark':
        '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
    'notebook':
        '<path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M16 2v20"/>',
    'notebook-pen':
        '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
    'file-text':
        '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    'highlighter':
        '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    'glasses':
        '<circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M14 15a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M2.5 13 5 7c.7-1.3 1.4-2 3-2"/><path d="m21.5 13-2.5-6c-.7-1.3-1.5-2-3-2"/>',

    // ===== ジャンルメタファ =====
    'star':
        '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    'heart':
        '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    'flame':
        '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    'sparkles':
        '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
    'briefcase':
        '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
    'code':
        '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    'cpu':
        '<rect width="16" height="16" x="4" y="4" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
    'terminal':
        '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
    'database':
        '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    'flask-conical':
        '<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/>',
    'palette':
        '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
    'music':
        '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    'film':
        '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
    'camera':
        '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    'gamepad-2':
        '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
    'mountain':
        '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
    'map':
        '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" x2="9" y1="3" y2="18"/><line x1="15" x2="15" y1="6" y2="21"/>',
    'plane':
        '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    'compass':
        '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    'chef-hat':
        '<path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z"/><path d="M6 17h12"/>',
    'leaf':
        '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96a1 1 0 0 1 1.8.66c0 1.6-.7 3.3-1.4 4.6-.4.7-1.4 1.4-2.1 1.8-.5.4-1 .6-1.5.7-.4.1-.8.2-1.1.2H6.5"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>',
    'baby':
        '<path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"/><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1"/>',
    'dog':
        '<path d="M11.25 16.25h1.5L12 17z"/><path d="M16 14v.5"/><path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.702 11.702 0 0 0-.493-3.309"/><path d="M8 14v.5"/><path d="M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5-1.931.722-3.576-.297-3.656-1-.113-.994 1.177-6.53 4-7 1.923-.321 3.651.677 3.651 2M17.5 8.5c.384 1.05 1.083 2.028 2.344 2.5 1.931.722 3.576-.297 3.656-1 .113-.994-1.177-6.53-4-7-1.923-.321-3.651.677-3.651 2"/>',
    'cat':
        '<path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75Z"/>',
    'trophy':
        '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    'target':
        '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    'lightbulb':
        '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    'newspaper':
        '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
    'puzzle':
        '<path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z"/>',
    'tag':
        '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    'folder':
        '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    'archive':
        '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    'box':
        '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    'graduation-cap':
        '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    'zap':
        '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    'rocket':
        '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',

    // ===== その他汎用 =====
    'home':
        '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    'panel-left':
        '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    'panel-right':
        '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    'cloud':
        '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    'cloud-cog':
        '<circle cx="12" cy="17" r="3"/><path d="M4.2 15.1A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24"/><path d="m15.7 18.4-.9-.3"/><path d="m9.2 15.9-.9-.3"/><path d="m10.6 20.7.3-.9"/><path d="m13.1 14.2.3-.9"/><path d="m13.6 20.7-.4-1"/><path d="m10.8 14.3-.4-1"/><path d="m8.3 18.6 1-.4"/><path d="m14.7 15.8 1-.4"/>',
    'refresh-cw':
        '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
    'download':
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    'upload':
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    'ban':
        '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    'eye':
        '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    'eye-off':
        '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    'save':
        '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
    'plug':
        '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    'puzzle-piece':
        '<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>',

    // ===== Phase A 追加: 設定/モーダル/プラグインカード等で使う =====
    'arrow-up':
        '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    'arrow-down':
        '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    'github':
        '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
    'folder-cog':
        '<circle cx="18" cy="18" r="3"/><path d="M10 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v2.5"/><path d="m21.7 19.4-.9-.3"/><path d="m15.2 16.9-.9-.3"/><path d="m16.6 21.7.3-.9"/><path d="m19.1 15.2.3-.9"/><path d="m19.6 21.7-.4-1"/><path d="m16.8 15.3-.4-1"/><path d="m14.3 19.6 1-.4"/><path d="m20.7 16.8 1-.4"/>',
    'folder-open':
        '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    'folder-tree':
        '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>',
    'package':
        '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    'clock':
        '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'globe':
        '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    'circle':
        '<circle cx="12" cy="12" r="10"/>',
    'circle-check':
        '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    'check-circle':
        '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    'play':
        '<polygon points="6 3 20 12 6 21 6 3"/>',
    'pause':
        '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    'corner-down-right':
        '<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
    'list-checks':
        '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    'list-ordered':
        '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
    'upload-cloud':
        '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/>',
    'lock':
        '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'pin':
        '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    'grip-vertical':
        '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
    'alert-triangle':
        '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
    'layout-dashboard':
        '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    'info':
        '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    'clipboard':
        '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    'external-link':
        '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    'loader':
        '<line x1="12" x2="12" y1="2" y2="6"/><line x1="12" x2="12" y1="18" y2="22"/><line x1="4.93" x2="7.76" y1="4.93" y2="7.76"/><line x1="16.24" x2="19.07" y1="16.24" y2="19.07"/><line x1="2" x2="6" y1="12" y2="12"/><line x1="18" x2="22" y1="12" y2="12"/><line x1="4.93" x2="7.76" y1="19.07" y2="16.24"/><line x1="16.24" x2="19.07" y1="7.76" y2="4.93"/>',
    'map-pin':
        '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    'settings-2':
        '<path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>'
};

// 本棚編集の IconPicker で「おすすめ」として並べる順
const BOOKSHELF_PICKER_DEFAULTS = [
    'library', 'book', 'book-open', 'book-marked', 'book-heart', 'bookmark', 'notebook', 'notebook-pen',
    'star', 'heart', 'sparkles', 'flame', 'trophy', 'target',
    'briefcase', 'code', 'cpu', 'terminal', 'database', 'flask-conical', 'graduation-cap', 'lightbulb',
    'palette', 'music', 'film', 'camera', 'gamepad-2',
    'mountain', 'map', 'plane', 'compass', 'chef-hat', 'leaf', 'baby', 'dog', 'cat',
    'newspaper', 'highlighter', 'glasses', 'file-text',
    'tag', 'folder', 'archive', 'box', 'home', 'zap', 'rocket'
];

// ====== Lucide CDN 拡張 (inline 化していない 1500+ アイコンも使えるように) ======
//
// 設計:
//   - 第一優先: LUCIDE_ICONS (inline、高速)
//   - 第二優先: CDN_ICONS_CACHE (Map<name, inner-svg>) — lucide-static CDN から fetch したものをメモリ + localStorage にキャッシュ
//   - icon(name) は同期 API、CDN 未キャッシュなら空を返す → resolveIcon(name) で事前に await ロード
//   - data-icon 属性はマウント時に同期 inline → 非同期で CDN 解決して後から差し替え

const CDN_ICONS_CACHE = new Map();
const CDN_PENDING = new Map(); // name -> Promise
const CDN_CACHE_STORAGE_KEY = 'bookshelf_iconCacheV1';
const CDN_BASE = 'https://unpkg.com/lucide-static@latest/icons';
const CDN_BAD_NAMES = new Set(); // 404 が返ったものは再 fetch しない

(function loadCacheFromStorage() {
    try {
        const raw = localStorage.getItem(CDN_CACHE_STORAGE_KEY);
        if (raw) {
            const obj = JSON.parse(raw);
            for (const [k, v] of Object.entries(obj)) {
                if (typeof v === 'string') CDN_ICONS_CACHE.set(k, v);
            }
        }
    } catch (e) { /* ignore */ }
})();

function _persistCache() {
    try {
        const obj = Object.fromEntries(CDN_ICONS_CACHE);
        localStorage.setItem(CDN_CACHE_STORAGE_KEY, JSON.stringify(obj));
    } catch (e) { /* quota 超えなどは無視 */ }
}

function _extractInner(svgText) {
    // <svg ...>(中身)</svg> から中身を抽出
    const m = svgText.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>\s*$/i);
    return m ? m[1].trim() : null;
}

function _isValidLucideName(name) {
    return typeof name === 'string' && /^[a-z0-9-]+$/.test(name) && name.length <= 80;
}

/**
 * アイコンを非同期で解決して inline キャッシュに入れる。
 * inline にあれば即 resolve、CDN にあれば fetch、404 なら null。
 * @returns {Promise<string|null>} inner SVG 文字列 or null
 */
async function resolveIcon(name) {
    if (!_isValidLucideName(name)) return null;
    if (LUCIDE_ICONS[name]) return LUCIDE_ICONS[name];
    if (CDN_ICONS_CACHE.has(name)) return CDN_ICONS_CACHE.get(name);
    if (CDN_BAD_NAMES.has(name)) return null;
    if (CDN_PENDING.has(name)) return CDN_PENDING.get(name);

    const p = (async () => {
        try {
            const res = await fetch(`${CDN_BASE}/${name}.svg`);
            if (!res.ok) {
                CDN_BAD_NAMES.add(name);
                return null;
            }
            const text = await res.text();
            const inner = _extractInner(text);
            if (!inner) {
                CDN_BAD_NAMES.add(name);
                return null;
            }
            CDN_ICONS_CACHE.set(name, inner);
            _persistCache();
            return inner;
        } catch (e) {
            console.warn(`[icons] CDN fetch 失敗 "${name}":`, e);
            return null;
        } finally {
            CDN_PENDING.delete(name);
        }
    })();
    CDN_PENDING.set(name, p);
    return p;
}

// icon(name, { size, class }) → <svg> 文字列 (同期、CDN 未解決なら空)
function icon(name, opts) {
    if (!name) return '';
    let inner = LUCIDE_ICONS[name];
    if (!inner) inner = CDN_ICONS_CACHE.get(name);
    if (!inner) {
        // 未解決: 非同期でロードを開始 (戻り値は空文字)
        resolveIcon(name).then(loaded => {
            if (loaded) {
                // ロード完了後、data-icon 属性で待ってる要素を再描画
                document.querySelectorAll(`[data-icon="${name}"]`).forEach(el => {
                    const size = el.dataset.iconSize ? Number(el.dataset.iconSize) : undefined;
                    const klass = el.dataset.iconClass;
                    el.innerHTML = icon(name, { size, class: klass });
                });
            }
        });
        return '';
    }
    const size = (opts && opts.size) || 20;
    const cls = opts && opts.class ? ` class="${opts.class}"` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${cls}>${inner}</svg>`;
}

// data-icon="name" 属性を持つ全要素に SVG を inject (innerHTML 上書き)
// data-icon-size, data-icon-class でカスタマイズ可
function applyIcons(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-icon]').forEach(el => {
        const name = el.dataset.icon;
        if (!name) return;
        const size = el.dataset.iconSize ? Number(el.dataset.iconSize) : undefined;
        const klass = el.dataset.iconClass;
        el.innerHTML = icon(name, { size, class: klass });
    });
}

// ====== 任意文字対応 (Lucide 名 / 絵文字 / 漢字 / 任意文字列 を統一描画) ======
//
// renderIcon(value, opts) は icon(value, opts) の上位互換:
//   - 値が Lucide 名のパターン (英小文字+数字+ハイフン) かつ inline / CDN で解決できる → SVG
//   - そうでない / 未解決 → SVG 内 <text> でテキスト描画 (フォントサイズ自動計算)
// これにより、ユーザは "star" のような Lucide 名でも "★" "A" "❤️" "数学" のような任意文字でも指定可能。

function _isLucideShape(v) {
    return typeof v === 'string' && /^[a-z][a-z0-9-]*$/.test(v);
}

function _escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * テキストを SVG <text> として描画 (1〜数文字を size 内に収める)
 * 文字数に応じて font-size を自動調整。絵文字 / 漢字 / 任意 ASCII 対応。
 */
function renderTextIcon(text, opts) {
    opts = opts || {};
    const size = opts.size || 20;
    const cls = opts.class ? ` class="${opts.class}"` : '';
    // codePoint 単位で文字数を数える (絵文字 1 文字を 1 とみなす)
    const codePoints = Array.from(String(text));
    const len = codePoints.length;
    let fontSize;
    if (len <= 1) fontSize = size * 0.95;
    else if (len === 2) fontSize = size * 0.5;
    else if (len === 3) fontSize = size * 0.36;
    else if (len === 4) fontSize = size * 0.28;
    else fontSize = size * 0.22;
    // 絵文字には emoji フォントが当たるよう font-family を指定
    const family = `"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif`;
    const escaped = _escapeXml(text);
    // y を 50% + 0.05em ぶん下げて視覚的に中央へ (text-rendering 微調整)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"${cls}><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-family='${family}' fill="currentColor">${escaped}</text></svg>`;
}

/**
 * 汎用アイコン描画: Lucide 名 / 任意文字 を統一的に SVG として返す。
 *   - Lucide 名で inline / cache 解決可 → Lucide SVG
 *   - Lucide 名で未解決 → async fetch を発火しつつ、暫定でテキスト描画 (後から差し替え)
 *   - Lucide 名でないパターン → テキスト描画
 */
function renderIcon(value, opts) {
    if (value === null || value === undefined) return '';
    const v = String(value).trim();
    if (!v) return '';
    const isLucide = _isLucideShape(v);
    if (isLucide) {
        // inline / cache にあれば即時 SVG
        if (LUCIDE_ICONS[v] || CDN_ICONS_CACHE.has(v)) {
            return icon(v, opts);
        }
        // 未解決: async fetch を発火しつつ、テキストでフォールバック
        if (!CDN_BAD_NAMES.has(v)) {
            resolveIcon(v).then(loaded => {
                if (!loaded) return;
                // [data-icon-value="<v>"] 要素の innerHTML を後追いで差し替え
                document.querySelectorAll(`[data-icon-value="${CSS.escape(v)}"]`).forEach(el => {
                    const size = el.dataset.iconSize ? Number(el.dataset.iconSize) : (opts && opts.size);
                    el.innerHTML = icon(v, { size, class: opts && opts.class });
                });
            });
        }
        // 未解決時は控えめなテキスト表示で繋ぐ (CDN 取得後に上で差し替わる)
        return renderTextIcon(v.split('-')[0].slice(0, 2), opts);
    }
    // 任意文字 (絵文字 / 漢字 / 英大文字 / 記号など)
    return renderTextIcon(v, opts);
}

// ====== IconPicker 履歴 (localStorage) ======
const ICON_RECENT_KEY = 'bookshelf_iconPickerRecent_v1';
const ICON_RECENT_MAX = 12;

function getIconRecents() {
    try {
        const raw = localStorage.getItem(ICON_RECENT_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter(s => typeof s === 'string' && s.length > 0 && s.length <= 40) : [];
    } catch { return []; }
}

function pushIconRecent(value) {
    if (!value || typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    let list = getIconRecents().filter(x => x !== trimmed);
    list.unshift(trimmed);
    if (list.length > ICON_RECENT_MAX) list = list.slice(0, ICON_RECENT_MAX);
    try { localStorage.setItem(ICON_RECENT_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

window.icon = icon;
window.renderIcon = renderIcon;
window.renderTextIcon = renderTextIcon;
window.resolveIcon = resolveIcon;
window.applyIcons = applyIcons;
window.getIconRecents = getIconRecents;
window.pushIconRecent = pushIconRecent;
window.LUCIDE_ICONS = LUCIDE_ICONS;
window.BOOKSHELF_PICKER_DEFAULTS = BOOKSHELF_PICKER_DEFAULTS;
