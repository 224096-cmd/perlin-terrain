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

// ---- ステップ 3: 線形補間と fade ----
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

// ---- ステップ 4: 格子点の傾きから作る ----
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

// ---- ステップ 7: 層を重ねる ----
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

// ---- ステップ 8: 向きに沿って測った位置 ----
function directions() {
  const x0 = 40, y0 = 34, side = 140;
  const angle = (32 * Math.PI) / 180;
  const c = Math.cos(angle), sn = Math.sin(angle);
  const P = [0.74, 0.30];                         // 点 (x, z)（地面の中での位置 0〜1）
  const proj = P[0] * c + P[1] * sn;              // 向きに沿って測った位置 p
  const px = x0 + P[0] * side, py = y0 + P[1] * side;
  const fx = x0 + proj * c * side, fy = y0 + proj * sn * side;
  let s = '<defs><marker id="figArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="fg-fill-b"/></marker>';
  s += `<clipPath id="figGround"><rect x="${x0}" y="${y0}" width="${side}" height="${side}"/></clipPath></defs>`;
  // p が同じになる線（向きに直角な線）。この線の上では、ノイズの高さも同じ
  let stripes = '';
  for (let k = 1; k <= 7; k++) {
    const t = k * 0.2;
    const cx = x0 + t * c * side, cy = y0 + t * sn * side;
    stripes += `<line x1="${f1(cx - sn * 300)}" y1="${f1(cy + c * 300)}" x2="${f1(cx + sn * 300)}" y2="${f1(cy - c * 300)}" class="fg-axis"/>`;
  }
  s += `<g clip-path="url(#figGround)">${stripes}</g>`;
  s += `<rect x="${x0}" y="${y0}" width="${side}" height="${side}" class="fg-frame"/>`;
  s += `<line x1="${x0}" y1="${y0}" x2="${f1(x0 + c * side * 1.12)}" y2="${f1(y0 + sn * side * 1.12)}" class="fg-line-b" marker-end="url(#figArrow)"/>`;
  s += `<line x1="${f1(px)}" y1="${f1(py)}" x2="${f1(fx)}" y2="${f1(fy)}" class="fg-dash"/>`;
  s += `<line x1="${x0}" y1="${y0}" x2="${f1(fx)}" y2="${f1(fy)}" class="fg-line-a"/>`;
  s += `<circle cx="${x0}" cy="${y0}" r="4" class="fg-dot-b"/>`;
  s += `<circle cx="${f1(px)}" cy="${f1(py)}" r="6" class="fg-dot-a"/>`;
  s += text(px + 10, py - 6, '場所 (x, z)', 'fg-text');
  s += text((x0 + fx) / 2 - 4, (y0 + fy) / 2 + 20, 'p', 'fg-text', 'middle');
  s += text(x0 + side / 2, y0 - 12, '横（x）', 'fg-small', 'middle');
  s += `<text x="${x0 - 12}" y="${y0 + side / 2}" class="fg-small" text-anchor="middle" transform="rotate(-90 ${x0 - 12} ${y0 + side / 2})">奥行き（z）</text>`;
  s += text(x0, y0 + side + 20, '地面を真上から見た図', 'fg-small');
  const tx = x0 + side + 78;
  s += text(tx, 50, 'オレンジの矢印: 重ねる向きの 1 本', 'fg-small');
  s += text(tx, 78, '青い線の長さ p: 場所 (x, z) を、', 'fg-small') + text(tx, 96, 'その向きに沿って測った位置', 'fg-small');
  s += text(tx, 124, 'この p で 1 次元のノイズを読む。', 'fg-small');
  s += text(tx, 152, '向きに直角な線（うすい線）の上は', 'fg-small') + text(tx, 170, 'p が同じなので、高さも同じになる。', 'fg-small');
  return svg(560, 200, s, '場所を、ある向きに沿って測った位置 p に直して、1 次元のノイズを読む図');
}

// ---- ステップ 10: 高さからブロックを決める ----
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

// ---- ステップ 11: ノイズ × マスク = 島（島の真ん中を横に切った断面） ----
function maskProfile() {
  const g = [0.7, -0.5, 0.8, -0.3, 0.6, -0.9, 0.4, 0.5, -0.7, 0.6, -0.2, 0.8, -0.6, 0.3, -0.4, 0.7, -0.5, 0.2];
  const perlin = (x) => {
    const i = Math.floor(x) % (g.length - 1);
    const t = x - Math.floor(x);
    return lerp(g[i] * t, g[i + 1] * (t - 1), fade(t)) * 2;
  };
  const noise = (u) => Math.min(1, Math.max(0, 0.55 + 0.5 * (perlin(u * 3 + 0.4) + 0.5 * perlin(u * 6 + 5.3))));
  const maskAt = (u) => Math.max(0, 1 - (2 * u - 1) ** 2);
  const rows = [
    { label: 'ノイズ', sub: '0 〜 1 に直したもの', f: noise, cls: 'fg-line-a' },
    { label: '× マスク', sub: '中心が 1、端が 0', f: maskAt, cls: 'fg-line-b' },
    { label: '＝ 島の高さ', sub: '端が必ず低くなる', f: (u) => noise(u) * maskAt(u), cls: 'fg-line-ink' },
  ];
  const x0 = 170, w = 370, rowH = 62, amp = 40;
  let s = '';
  rows.forEach((r, k) => {
    const base = 52 + k * rowH;
    const pts = [];
    for (let p = 0; p <= 180; p++) pts.push([x0 + (p / 180) * w, base - r.f(p / 180) * amp]);
    s += `<line x1="${x0}" y1="${base}" x2="${x0 + w}" y2="${base}" class="fg-axis"/>`;
    s += `<path d="${path(pts)}" class="${r.cls}"/>`;
    s += text(12, base - 20, r.label, 'fg-text') + text(12, base - 3, r.sub, 'fg-small');
    if (k === 2) {
      const sea = base - 0.16 * amp;
      s += `<line x1="${x0}" y1="${f1(sea)}" x2="${x0 + w}" y2="${f1(sea)}" class="fg-dash"/>`;
      s += text(x0 + w, sea - 5, '海面', 'fg-small', 'end');
    }
  });
  s += text(x0, 208, '島の真ん中を横に切った断面（左端から右端まで）', 'fg-small');
  return svg(560, 218, s, 'ノイズにマスクを掛けると、端が低く中央が高い島の断面になる図');
}

export const FIGURES = { interpolate, slopes, octaves, directions, columns, maskProfile };
