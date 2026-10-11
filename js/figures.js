// 説明用の図（SVG）。教材と同じ式で計算した値から描くので、図と実行結果の形が一致する。
// 色は CSS の変数（.fg-〜 のクラス）で決めるので、明るい画面・暗い画面の両方に対応する。

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const f1 = (v) => v.toFixed(1);

function path(points) {
  return points.map(([x, y], k) => (k ? 'L' : 'M') + f1(x) + ' ' + f1(y)).join(' ');
}

function svg(w, h, body, label) {
  return `<svg class="fig" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${body}</svg>`;
}

const text = (x, y, s, cls = 'fg-text', anchor = 'start') =>
  `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${s}</text>`;

// ---- ステップ 2: 線形補間と fade ----
function interpolate() {
  // 左: a と b を t の割合で混ぜる
  const ax = 40, bx = 240, ay = 130, by = 50, t = 0.3;
  const px = lerp(ax, bx, t), py = lerp(ay, by, t);
  let s = '';
  s += `<line x1="${ax}" y1="150" x2="${bx}" y2="150" class="fg-axis"/>`;
  s += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="fg-line-a"/>`;
  s += `<line x1="${px}" y1="${py}" x2="${px}" y2="150" class="fg-dash"/>`;
  s += `<circle cx="${ax}" cy="${ay}" r="6" class="fg-dot-b"/><circle cx="${bx}" cy="${by}" r="6" class="fg-dot-b"/>`;
  s += `<circle cx="${px}" cy="${py}" r="5" class="fg-dot-a"/>`;
  s += text(ax, ay + 24, 'a', 'fg-text', 'middle') + text(bx, by - 12, 'b', 'fg-text', 'middle');
  s += text(ax, 168, 't = 0', 'fg-small', 'middle') + text(bx, 168, 't = 1', 'fg-small', 'middle') + text(px, 168, 't = 0.3', 'fg-small', 'middle');
  s += text(px + 10, py + 16, 'a + (b − a) × 0.3', 'fg-small');
  s += text(140, 22, 'lerp(a, b, t): 直線の上を t だけ進む', 'fg-title', 'middle');

  // 右: fade(t) の S 字カーブ
  const ox = 330, oy = 150, sz = 110;
  const curve = [];
  for (let k = 0; k <= 40; k++) curve.push([ox + (k / 40) * sz, oy - fade(k / 40) * sz]);
  s += `<rect x="${ox}" y="${oy - sz}" width="${sz}" height="${sz}" class="fg-frame"/>`;
  s += `<line x1="${ox}" y1="${oy}" x2="${ox + sz}" y2="${oy - sz}" class="fg-dash"/>`;
  s += `<path d="${path(curve)}" class="fg-line-a"/>`;
  s += text(ox, oy + 18, '0', 'fg-small', 'middle') + text(ox + sz, oy + 18, '1', 'fg-small', 'middle') + text(ox + sz / 2, oy + 18, 't', 'fg-small', 'middle');
  s += text(ox - 8, oy + 4, '0', 'fg-small', 'end') + text(ox - 8, oy - sz + 4, '1', 'fg-small', 'end');
  s += text(ox + sz + 8, oy - sz + 30, '点線: t のまま', 'fg-small') + text(ox + sz + 8, oy - sz + 48, '実線: fade(t)', 'fg-small');
  s += text(ox + sz / 2 + 30, 22, 'fade(t): 出だしと終わりがゆるやか', 'fg-title', 'middle');
  return svg(560, 180, s, '線形補間 lerp と、S 字カーブ fade の図');
}

// ---- ステップ 3: 格子点の傾きから作る ----
function slopes() {
  const g = [0.9, -0.7, 0.5, -0.9, 0.6];
  const x0 = 40, cell = 120, base = 118, amp = 105;
  const perlin = (x) => {
    const i = Math.min(g.length - 2, Math.floor(x));
    const t = x - i;
    return lerp(g[i] * t, g[i + 1] * (t - 1), fade(t));
  };
  let s = `<line x1="${x0 - 15}" y1="${base}" x2="${x0 + cell * 4 + 15}" y2="${base}" class="fg-axis"/>`;
  // 格子点ごとの傾き（短い線）
  g.forEach((slope, i) => {
    const x = x0 + i * cell;
    const dx = 34;
    s += `<line x1="${x - dx}" y1="${f1(base + slope * dx / cell * amp)}" x2="${x + dx}" y2="${f1(base - slope * dx / cell * amp)}" class="fg-line-b"/>`;
  });
  // 1 区間だけ、左右から伸ばした線（点線）を見せる
  const k = 1;
  const xa = x0 + k * cell, xb = xa + cell;
  s += `<line x1="${xa}" y1="${base}" x2="${xb}" y2="${f1(base - g[k] * amp)}" class="fg-dash"/>`;
  s += `<line x1="${xb}" y1="${base}" x2="${xa}" y2="${f1(base + g[k + 1] * amp)}" class="fg-dash"/>`;
  const curve = [];
  for (let p = 0; p <= 160; p++) {
    const x = (p / 160) * 4;
    curve.push([x0 + x * cell, base - perlin(x) * amp]);
  }
  s += `<path d="${path(curve)}" class="fg-line-a"/>`;
  g.forEach((_, i) => { s += `<circle cx="${x0 + i * cell}" cy="${base}" r="5" class="fg-dot-b"/>`; });
  s += text(x0, 18, '点線: 左右の格子点から、傾きのまま伸ばした線', 'fg-small');
  s += text(x0, 36, '青の線: その 2 本を fade で混ぜた結果', 'fg-small');
  s += text(x0, 222, 'オレンジの点: 格子点（高さはいつも 0）　オレンジの線: 乱数で決めた傾き', 'fg-small');
  return svg(560, 232, s, '格子点の傾きからパーリンノイズを作る図');
}

// ---- ステップ 5: 層を重ねる ----
function octaves() {
  const g = [0.8, -0.6, 0.9, -0.4, 0.7, -0.9, 0.3, 0.6, -0.8, 0.5, -0.3, 0.9, -0.7, 0.4, -0.5, 0.8, -0.6, 0.2, 0.7, -0.9, 0.5, -0.2, 0.6, -0.8, 0.3, 0.9, -0.4, 0.1, -0.7, 0.6, 0.4, -0.5, 0.8];
  const perlin = (x) => {
    const i = Math.floor(x) % (g.length - 1);
    const t = x - Math.floor(x);
    return lerp(g[i] * t, g[i + 1] * (t - 1), fade(t)) * 2;
  };
  const rows = [
    { label: '1 層目', sub: '周波数 2・振幅 1', f: (x) => perlin(x * 2), cls: 'fg-line-a' },
    { label: '＋ 2 層目', sub: '周波数 4・振幅 0.5', f: (x) => 0.5 * perlin(x * 4 + 7.3), cls: 'fg-line-b' },
    { label: '＋ 3 層目', sub: '周波数 8・振幅 0.25', f: (x) => 0.25 * perlin(x * 8 + 14.6), cls: 'fg-line-c' },
  ];
  rows.push({ label: '＝ 合計', sub: '大きな形 ＋ 細かいでこぼこ', f: (x) => rows[0].f(x) + rows[1].f(x) + rows[2].f(x), cls: 'fg-line-ink' });
  const x0 = 170, w = 370, rowH = 48, amp = 22;
  let s = '';
  rows.forEach((r, k) => {
    const cy = 30 + k * rowH + (k === 3 ? 8 : 0);
    const pts = [];
    for (let p = 0; p <= 180; p++) pts.push([x0 + (p / 180) * w, cy - r.f(p / 180) * amp]);
    s += `<line x1="${x0}" y1="${cy}" x2="${x0 + w}" y2="${cy}" class="fg-axis"/>`;
    s += `<path d="${path(pts)}" class="${r.cls}"/>`;
    s += text(12, cy - 2, r.label, 'fg-text') + text(12, cy + 15, r.sub, 'fg-small');
  });
  s += `<line x1="12" y1="${30 + 3 * rowH - 18}" x2="${x0 + w}" y2="${30 + 3 * rowH - 18}" class="fg-axis"/>`;
  return svg(560, 215, s, '細かさの違うノイズを 3 枚重ねて合計する図');
}

// ---- ステップ 6: 4 つの角の矢印 ----
function corners() {
  const x0 = 60, y0 = 30, cell = 130;
  const arrows = [[0.8, 0.6], [-0.5, 0.86], [0.95, -0.3], [-0.7, -0.7]];
  const P = [0.62, 0.38];
  const px = x0 + P[0] * cell, py = y0 + P[1] * cell;
  let s = '<defs><marker id="figArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="fg-fill-b"/></marker></defs>';
  // まわりの方眼
  for (let k = 0; k <= 1; k++) {
    s += `<line x1="${x0 + k * cell}" y1="${y0 - 20}" x2="${x0 + k * cell}" y2="${y0 + cell + 20}" class="fg-axis"/>`;
  }
  for (let k = 0; k <= 1; k++) {
    s += `<line x1="${x0 - 40}" y1="${y0 + k * cell}" x2="${x0 + cell + 40}" y2="${y0 + k * cell}" class="fg-axis"/>`;
  }
  s += `<rect x="${x0}" y="${y0}" width="${cell}" height="${cell}" class="fg-frame"/>`;
  [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([cx, cy], k) => {
    const gx = x0 + cx * cell, gy = y0 + cy * cell;
    s += `<line x1="${gx}" y1="${gy}" x2="${px}" y2="${py}" class="fg-dash"/>`;
    s += `<line x1="${gx}" y1="${gy}" x2="${f1(gx + arrows[k][0] * 38)}" y2="${f1(gy + arrows[k][1] * 38)}" class="fg-line-b" marker-end="url(#figArrow)"/>`;
    s += `<circle cx="${gx}" cy="${gy}" r="5" class="fg-dot-b"/>`;
  });
  s += `<circle cx="${px}" cy="${py}" r="6" class="fg-dot-a"/>`;
  s += text(px + 13, py + 5, '点 (x, y)', 'fg-text');
  const tx = x0 + cell + 70;
  s += text(tx, 46, 'オレンジの矢印: 格子点ごとに', 'fg-small') + text(tx, 64, '乱数で決めた向き', 'fg-small');
  s += text(tx, 92, '点線: 格子点から点への向き', 'fg-small');
  s += text(tx, 120, '矢印と点線の向きが近い角ほど、', 'fg-small') + text(tx, 138, 'その点を高く押し上げる（内積）。', 'fg-small');
  s += text(tx, 166, '4 つの角の分を fade で混ぜる。', 'fg-small');
  return svg(560, 190, s, '点を囲む 4 つの格子点の矢印から高さを決める図');
}

// ---- ステップ 9: 高さからブロックを決める ----
function columns() {
  const hs = [3, 4, 6, 7, 9, 10, 12, 15, 18, 20, 21, 19, 16, 12, 9, 7, 5, 3, 2, 4];
  const sea = 8;
  const size = 7, x0 = 24, ground = 204;
  const typeOf = (h) => (h < sea ? 'water' : h <= sea + 1 ? 'sand' : h <= sea + 7 ? 'grass' : h <= sea + 11 ? 'stone' : 'snow');
  let s = '';
  hs.forEach((h, i) => {
    const type = typeOf(h);
    const top = type === 'water' ? sea : h;
    for (let y = 1; y <= top; y++) {
      let cls;
      if (type === 'water') cls = y > h ? 'bk-water' : 'bk-stone';
      else if (y === top) cls = 'bk-' + type;
      else if (top - y <= 2 && (type === 'grass' || type === 'sand')) cls = type === 'grass' ? 'bk-dirt' : 'bk-sand';
      else cls = 'bk-stone';
      s += `<rect x="${x0 + i * size}" y="${ground - y * size}" width="${size}" height="${size}" class="${cls}"/>`;
    }
  });
  const seaY = ground - sea * size;
  const right = x0 + hs.length * size;
  s += `<line x1="${x0 - 8}" y1="${seaY}" x2="${right + 8}" y2="${seaY}" class="fg-dash"/>`;
  const tx = right + 26;
  const rows = [
    ['bk-snow', 'それより上 → 雪'],
    ['bk-stone', 'sea + 11 以下 → 岩'],
    ['bk-grass', 'sea + 7 以下 → 草'],
    ['bk-sand', 'sea + 1 以下 → 砂'],
    ['bk-water', 'sea より低い → 水（海面まで満たす）'],
  ];
  rows.forEach(([cls, label], k) => {
    const y = 62 + k * 24;
    s += `<rect x="${tx}" y="${y - 12}" width="14" height="14" class="${cls}"/>` + text(tx + 22, y, label, 'fg-small');
  });
  s += text(tx, 62 + 5 * 24 + 4, '点線: 海面の高さ sea', 'fg-small');
  s += text(x0, 22, '高さ h を上から順に調べて、いちばん上のブロックを決める', 'fg-title');
  return svg(560, 214, s, '高さによってブロックの種類を決め、海面より低い所を水で満たす図');
}

// ---- ステップ 10: ノイズ × マスク = 島 ----
function mask() {
  const n = 16, cell = 8;
  // 図用の簡単なノイズ（教材本体と同じ考え方の 2 次元パーリンノイズ）
  const ang = (ix, iy) => {
    let v = (ix * 374761393 + iy * 668265263) | 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return (((v ^ (v >>> 16)) >>> 0) / 4294967295) * Math.PI * 2;
  };
  const corner = (ix, iy, x, y) => Math.cos(ang(ix, iy)) * (x - ix) + Math.sin(ang(ix, iy)) * (y - iy);
  const perlin2 = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const u = fade(x - ix), v = fade(y - iy);
    return lerp(lerp(corner(ix, iy, x, y), corner(ix + 1, iy, x, y), u), lerp(corner(ix, iy + 1, x, y), corner(ix + 1, iy + 1, x, y), u), v);
  };
  const noise = (i, j) => Math.min(1, Math.max(0, 0.5 + 0.9 * (perlin2(i / n * 3 + 5.2, j / n * 3 + 1.7) + 0.5 * perlin2(i / n * 6 + 9.1, j / n * 6 + 4.4))));
  const maskAt = (i, j) => {
    const dx = (i - n / 2 + 0.5) / (n / 2), dy = (j - n / 2 + 0.5) / (n / 2);
    return Math.max(0, 1 - (dx * dx + dy * dy));
  };
  const grid = (x0, y0, fn) => {
    let g = '';
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = Math.round(fn(i, j) * 255);
        g += `<rect x="${x0 + i * cell}" y="${y0 + j * cell}" width="${cell + 0.3}" height="${cell + 0.3}" fill="rgb(${c},${c},${c})"/>`;
      }
    }
    return g + `<rect x="${x0}" y="${y0}" width="${n * cell}" height="${n * cell}" class="fg-frame"/>`;
  };
  const y0 = 34, w = n * cell;
  const xs = [20, 20 + w + 56, 20 + (w + 56) * 2];
  let s = grid(xs[0], y0, noise) + grid(xs[1], y0, maskAt) + grid(xs[2], y0, (i, j) => noise(i, j) * maskAt(i, j));
  s += text(xs[0] + w + 28, y0 + w / 2 + 8, '×', 'fg-big', 'middle') + text(xs[1] + w + 28, y0 + w / 2 + 8, '＝', 'fg-big', 'middle');
  s += text(xs[0] + w / 2, 22, 'ノイズ', 'fg-text', 'middle') + text(xs[1] + w / 2, 22, 'マスク（中心が 1、端が 0）', 'fg-text', 'middle') + text(xs[2] + w / 2, 22, '島の高さ', 'fg-text', 'middle');
  return svg(560, 176, s, 'ノイズに島の形のマスクを掛けると、端が低い島の高さになる図');
}

export const FIGURES = { interpolate, slopes, octaves, corners, columns, mask };
