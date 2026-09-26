/*
 * RINGFENCE pixel art. Sprites are small string grids with a palette,
 * rendered once to canvas data URLs and drawn on the SVG board as <image>
 * elements (CSS image-rendering: pixelated keeps them crisp).
 * No image files: the page stays one self-contained file.
 */
(function (root) {
  'use strict';
  const PAL = {
    '.': null,
    k: '#0b0f1a', // outline
    w: '#f8fafc',
    g: '#94a3b8',
    d: '#475569',
    s: '#1e293b',
    r: '#ef4444',
    R: '#991b1b',
    o: '#f97316',
    y: '#facc15',
    Y: '#a16207',
    l: '#4ade80',
    L: '#15803d',
    c: '#22d3ee',
    C: '#0e7490',
    b: '#60a5fa',
    B: '#1d4ed8',
    p: '#c084fc',
    P: '#7e22ce',
    m: '#f472b6',
    t: '#2dd4bf',
    T: '#0f766e',
  };

  const SPRITES = {
    // The attacker: a red virus bug.
    virus: [
      '....k....k....',
      '.....k..k.....',
      '...kkkkkkkk...',
      '..krrrrrrrrk..',
      '.krrwwrrwwrrk.',
      'kkrrwkrrwkrrkk',
      '..krrrrrrrrk..',
      'kkrRrrrrrrRrkk',
      '..krRRrrRRrk..',
      '.kkrrrrrrrrkk.',
      'k..kRrrrrRk..k',
      '....kkkkkk....',
    ],
    virus2: [
      '...k......k...',
      '....k....k....',
      '...kkkkkkkk...',
      '..krrrrrrrrk..',
      '.krrwwrrwwrrk.',
      '.krrwkrrwkrrk.',
      'kkrrrrrrrrrrkk',
      '..kRrrrrrrRk..',
      'kkrRRrrrRRrkk.',
      '..krrrrrrrrk..',
      '.k.kRrrrrRk.k.',
      '....kkkkkk....',
    ],
    // Crown jewel.
    gem: [
      '...kkkkkk...',
      '..kcwccwcck.',
      '.kcwcccccCck',
      'kkkkkkkkkkkk',
      'kcCccwcccCCk',
      '.kcCccccCCk.',
      '..kcCccCCk..',
      '...kcCCCk...',
      '....kCCk....',
      '.....kk.....',
    ],
    // IDS/IPS sensor: a radar dish.
    sensor: [
      '....kkkk....',
      '..kkyyyykk..',
      '.kyykkkkyyk.',
      '.kykyyyykyk.',
      'kykykkkkykyk',
      'kykyk..kykyk',
      'kykyk.rkykyk',
      '.kyk.krk.yk.',
      '....kddk....',
      '...kddddk...',
      '..kkkkkkkk..',
    ],
    // Face-down token: a sealed card with a question mark.
    card: [
      'kkkkkkkkkk',
      'kBBBBBBBBk',
      'kBbbbbbbBk',
      'kBbwwwwbBk',
      'kBbbbbwbBk',
      'kBbbwwwbBk',
      'kBbbwbbbBk',
      'kBbbbbbbBk',
      'kBbbwbbbBk',
      'kBBBBBBBBk',
      'kkkkkkkkkk',
    ],
    // Recon'd token seen by the attacker (eye).
    eye: [
      '..kkkkkk..',
      '.kwwwwwwk.',
      'kwwkkkkwwk',
      'kwkcckkkwk',
      'kwkcCCkkwk',
      'kwwkkkkwwk',
      '.kwwwwwwk.',
      '..kkkkkk..',
    ],
    // Hardened service shield.
    shield: [
      'kkkkkkkkkk',
      'klllllllLk',
      'kllwllllLk',
      'kllwwlllLk',
      'klllwwllLk',
      'kllllwwlLk',
      '.kllllllk.',
      '.kLllllLk.',
      '..kLllLk..',
      '...kLLk...',
      '....kk....',
    ],
    lock: [
      '...kkkk...',
      '..kgddgk..',
      '..kg..gk..',
      '..kg..gk..',
      'kkkkkkkkkk',
      'kyyyyyyyYk',
      'kyyykkyyYk',
      'kyyykkyyYk',
      'kyyyyyyyYk',
      'kYYYYYYYYk',
      'kkkkkkkkkk',
    ],
    // Shared services.
    ntp: [
      '...kkkkkk...',
      '..kppppppk..',
      '.kppwwwwppk.',
      'kppwwkwwwppk',
      'kpwwwkwwwwpk',
      'kpwwwkwwwwpk',
      'kpwwwkkkwwpk',
      'kpwwwwwwwwpk',
      'kppwwwwwwppk',
      '.kppwwwwppk.',
      '..kPPPPPPk..',
      '...kkkkkk...',
    ],
    dns: [
      '...kkkkkk...',
      '..kbBbbBbk..',
      '.kbbBbbBbbk.',
      'kBBBBBBBBBBk',
      'kbbBbbbBbbbk',
      'kbbBbbbBbbbk',
      'kBBBBBBBBBBk',
      'kbbBbbbBbbbk',
      '.kbbBbbBbbk.',
      '..kbBbbBbk..',
      '...kkkkkk...',
    ],
    ldap: [
      '..kkkk......',
      '.kyyyyk.....',
      'kyykkyyk....',
      'kyk..kyk....',
      'kyykkyykkkkk',
      '.kyyyyyyyyyk',
      '..kkkkkykyYk',
      '.......k.kk.',
    ],
    // App server rack (drawn faintly behind each app cell).
    rack: [
      'kkkkkkkkkkkk',
      'kddddddddddk',
      'kdsssssslgdk',
      'kddddddddddk',
      'kdssssssygdk',
      'kddddddddddk',
      'kdsssssslgdk',
      'kddddddddddk',
      'kkkkkkkkkkkk',
    ],
    // Ransomware skull for compromised apps.
    skull: [
      '..kkkkkk..',
      '.kwwwwwwk.',
      'kwwwwwwwwk',
      'kwkkwwkkwk',
      'kwkkwwkkwk',
      'kwwwkkwwwk',
      '.kwwwwwwk.',
      '..kwkwkk..',
      '..kkkkkk..',
    ],
    // Crown for titles.
    crown: [
      'y....y....y',
      'yy..yyy..yy',
      'yyy.yyy.yyy',
      'yyyyyyyyyyy',
      'yyryyyyyryy',
      'YYYYYYYYYYY',
    ],
  };

  const cache = {};
  function url(name, scale) {
    scale = scale || 4;
    const key = name + '@' + scale;
    if (cache[key]) return cache[key];
    const rows = SPRITES[name];
    if (!rows || typeof document === 'undefined') return '';
    const w = Math.max(...rows.map((r) => r.length));
    const h = rows.length;
    const cv = document.createElement('canvas');
    cv.width = w * scale;
    cv.height = h * scale;
    const g = cv.getContext('2d');
    if (!g) return '';
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = PAL[row[x]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(x * scale, y * scale, scale, scale);
      }
    });
    try {
      cache[key] = cv.toDataURL('image/png');
    } catch (e) {
      cache[key] = '';
    }
    return cache[key];
  }

  const size = (name) => {
    const rows = SPRITES[name] || [''];
    return { w: Math.max(...rows.map((r) => r.length)), h: rows.length };
  };

  // An <img> tag for HTML (buttons, overlays).
  const img = (name, px, cls) => {
    const sz = size(name);
    const h = px || sz.h * 2;
    const w = Math.round((h * sz.w) / sz.h);
    return '<img class="px ' + (cls || '') + '" src="' + url(name) + '" width="' + w + '" height="' + h + '" alt="" />';
  };

  root.RFPIX = { url, size, img, SPRITES, PAL };
})(typeof self !== 'undefined' ? self : this);
