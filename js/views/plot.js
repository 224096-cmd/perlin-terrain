// グラフ（plot() の表示先）。Canvas に自前で描く。
//   見た目: 線（line）／ブロックを積んだ地面の断面（blocks）
//   並べ方: 1 つの枠に重ねる（overlay）／線ごとに枠を分けて縦に並べる（rows）
// 「rows + blocks」にすると、作り方の違う地面を同じ目盛りで見比べられる。
import { el, fmt } from '../util.js';
import { GRASS_SIDE, TEX_SEED, pixelCanvas } from './blocktex.js';

const SERIES_COUNT = 8;

function cssVar(node, name) {
  return getComputedStyle(node).getPropertyValue(name).trim();
}

// きりのよい目盛りを作る
function niceTicks(lo, hi, target) {
  const span = hi - lo || 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 2.5, 5, 10].find((u) => u * pow >= raw) * pow;
  const ticks = [];
  for (let v = Math.ceil(lo / unit - 1e-9) * unit; v <= hi + unit * 1e-9; v += unit) {
    ticks.push(Math.abs(v) < unit * 1e-9 ? 0 : v);
  }
  return ticks;
}

function tickLabel(v) {
  return String(Math.round(v * 1e6) / 1e6);
}

export class PlotView {
  constructor(host) {
    this.host = host;
    this.series = [];
    this.ghost = null;          // ひとつ前の結果（うすい線で重ねる）
    this.ghostVisible = true;
    this.style = 'line';        // line: 線グラフ / blocks: ブロックを積んだ断面
    this.layout = 'overlay';    // overlay: 重ねる / rows: 線ごとに並べる
    this.tex = null;            // ブロックの質感（最初に使うときに作る）
    this.hover = null;
    this.caption = el('p', { class: 'plot-caption' });
    this.legend = el('ul', { class: 'plot-legend' });
    this.canvas = el('canvas', { class: 'plot-canvas', role: 'img' });
    this.tip = el('div', { class: 'plot-tip', hidden: true });
    this.frame = el('div', { class: 'plot-frame' }, [this.canvas, this.tip]);
    host.append(this.caption, this.legend, this.frame);

    this.canvas.addEventListener('pointermove', (ev) => this._onMove(ev));
    this.canvas.addEventListener('pointerdown', (ev) => this._onMove(ev));
    this.canvas.addEventListener('pointerleave', () => { this.hover = null; this.tip.hidden = true; this.draw(); });
    new ResizeObserver(() => this.draw()).observe(this.frame);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.draw());
  }

  // series: [{ label, ys: Float32Array, xs: Float32Array|null, dots: boolean, width }]
  // keepGhost が true なら、いま残している「ひとつ前の結果」をそのまま使う（スライダーを動かしている間など）
  update(series, { keepGhost = false } = {}) {
    if (!keepGhost && this.series.length) this.ghost = this.series.filter((s) => !s.dots);
    this.series = series.slice(0, SERIES_COUNT).map((s, k) => ({ ...s, slot: k + 1 }));
    this.hover = null;
    this.tip.hidden = true;
    this._refresh();
  }

  clearGhost() {
    this.ghost = null;
    this.series = [];
  }

  setGhostVisible(on) {
    this.ghostVisible = on;
    if (this.series.length) this._refresh();
  }

  // 見た目を切り替える（line / blocks）
  setStyle(style) {
    this.style = style === 'blocks' ? 'blocks' : 'line';
    this._restyle();
  }

  // 並べ方を切り替える（overlay / rows）
  setLayout(layout) {
    this.layout = layout === 'rows' ? 'rows' : 'overlay';
    this._restyle();
  }

  _restyle() {
    this.hover = null;
    this.tip.hidden = true;
    if (this.series.length) this._refresh();
  }

  _lines() {
    return this.series.filter((s) => !s.dots);
  }

  _ghostSeries() {
    return this.ghostVisible && this.ghost && this.ghost.length ? this.ghost : [];
  }

  // 枠（パネル）の組み立て。重ねるときは 1 枠、並べるときは線 1 本につき 1 枠。
  // main は、ブロック表示のときにブロックで表す線。
  _panels() {
    const lines = this._lines();
    const blocks = this.style === 'blocks';
    const ghost = this._ghostSeries();
    if (this.layout === 'rows' && lines.length > 1) {
      const panels = lines.map((line, k) => ({ title: line.label || `線 ${line.slot}`, series: [line], main: blocks ? line : null, ghost: ghost[k] ? [ghost[k]] : [] }));
      // 点（dots）は、コードの中でその直前に描かれた線の枠に入れる
      let current = panels[0];
      for (const s of this.series) {
        if (!s.dots) current = panels[lines.indexOf(s)];
        else current.series.push(s);
      }
      return panels;
    }
    return [{ title: '', series: this.series, main: blocks && lines.length ? lines[lines.length - 1] : null, ghost }];
  }

  // 横位置 x での値を、前後の点から直線でつないで求める
  _valueAt(s, x) {
    const n = s.ys.length;
    if (n === 0) return NaN;
    if (!s.xs) {
      if (n === 1) return s.ys[0];
      const p = Math.min(n - 1, Math.max(0, x));
      const i = Math.min(n - 2, Math.floor(p));
      return s.ys[i] + (s.ys[i + 1] - s.ys[i]) * (p - i);
    }
    let lo = 0, hi = n - 1;
    if (x <= s.xs[0]) return s.ys[0];
    if (x >= s.xs[hi]) return s.ys[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s.xs[mid] <= x) lo = mid; else hi = mid;
    }
    const span = s.xs[hi] - s.xs[lo];
    return span > 0 ? s.ys[lo] + (s.ys[hi] - s.ys[lo]) * ((x - s.xs[lo]) / span) : s.ys[lo];
  }

  _refresh() {
    this._computeRanges();
    const panels = this._panels();
    const rows = panels.length > 1;
    const blocks = this.style === 'blocks' && panels.some((p) => p.main);
    const ghost = this._ghostSeries().length > 0;
    const named = this.series.filter((s) => s.label);
    this.caption.hidden = rows || ghost || blocks || !(this.series.length === 1 && named.length === 1);
    this.caption.textContent = this.caption.hidden ? '' : named[0].label;

    const items = [];
    if (blocks) {
      const what = rows ? 'それぞれの線' : (panels[0].main.label || `線 ${panels[0].main.slot}`);
      items.push(el('li', {}, [el('span', { class: 'swatch blocks' }), `ブロック（草・土・石）: ${what} の高さまで積む`]));
    }
    if (ghost) items.push(el('li', {}, [el('span', { class: 'swatch ghost' }), 'ひとつ前の結果']));
    // 並べたときは、線の名前は枠ごとの見出しに出すので、ここには点だけを載せる
    for (const s of this.series) {
      if (rows && !s.dots) continue;
      items.push(el('li', {}, [
        el('span', { class: 'swatch' + (s.dots ? ' dot' : ''), style: `--c: var(--series-${s.slot}); --w: ${Math.max(2, Math.round((s.width || 2) * 1.5))}px` }),
        s.label || `線 ${s.slot}`,
      ]));
    }
    this.legend.hidden = items.length === 0 || (items.length === 1 && !blocks && !ghost && !rows && this.series.length === 1);
    this.legend.replaceChildren(...items);
    this.canvas.setAttribute('aria-label',
      (blocks ? 'ブロックで表した地面の断面: ' : '折れ線グラフ: ') + this.series.map((s) => s.label || '名前なし').join('、'));
    this.draw();
  }

  _computeRanges() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    this.badValues = 0;
    const current = new Set(this.series);
    for (const s of [...this.series, ...this._ghostSeries()]) {
      const n = s.ys.length;
      for (let i = 0; i < n; i++) {
        const y = s.ys[i];
        const x = s.xs ? s.xs[i] : i;
        if (!Number.isFinite(y) || !Number.isFinite(x)) { if (current.has(s)) this.badValues += 1; continue; }
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (!Number.isFinite(x0)) { x0 = 0; x1 = 1; y0 = -1; y1 = 1; }
    if (x1 === x0) x1 = x0 + 1;
    // ブロック表示で点の数が少ないとき（80 個まで）は、点 1 個をブロックの柱 1 本にぴったり対応させる。
    // そのために、横の範囲を左右に半マスずつ広げる。
    this.exactColumns = 0;
    const lines = this._lines();
    if (this.style === 'blocks' && lines.length) {
      const n = lines[0].ys.length;
      const same = lines.every((l) => !l.xs && l.ys.length === n);
      if (same && n >= 2 && n <= 80 && x0 >= 0 && x1 <= n - 1) {
        this.exactColumns = n;
        x0 = -0.5;
        x1 = n - 0.5;
      }
    }
    // 縦軸は -1〜1 を基本にし、はみ出すときだけ広げる（振幅の違いが見た目で分かるように）
    let lo = Math.min(-1, y0);
    let hi = Math.max(1, y1);
    if (lo < -1 || hi > 1) {
      const pad = (hi - lo) * 0.05;
      if (lo < -1) lo -= pad;
      if (hi > 1) hi += pad;
    }
    this.range = { x0, x1, y0: lo, y1: hi };
  }

  // 全体の大きさと、枠ごとの位置を決める
  _layout(panels) {
    const w = Math.max(200, this.frame.clientWidth);
    const narrow = w < 420;
    const left = 46, right = 14, bottomAxis = 30;
    let pw = w - left - right;
    const rows = panels.length > 1;
    const titleH = rows ? 20 : 0;
    const gap = rows ? 10 : 0;
    let ph = rows ? (narrow ? 90 : 112) : (narrow ? 178 : 238);

    // ブロック表示では、ブロックが正方形で並ぶように、枠の大きさをブロックの大きさの整数倍にする
    let grid = null;
    if (this.style === 'blocks' && panels.some((p) => p.main)) {
      const target = rows ? 64 : 40;       // 横に並べるブロックの数の目安
      const size = this.exactColumns ? Math.max(3, Math.floor(pw / this.exactColumns)) : Math.max(6, Math.floor(pw / target));
      const cols = this.exactColumns || Math.floor(pw / size);
      const count = Math.max(4, Math.floor(ph / size));
      pw = cols * size;
      ph = count * size;
      grid = { size, cols, rows: count };
    }
    let y = 12;
    const boxes = panels.map(() => {
      const top = y + titleH;
      y = top + ph + gap;
      return { titleY: top - titleH, top, bottom: top + ph };
    });
    const h = y - gap + bottomAxis;
    return { w, h, left, right: left + pw, pw, ph, boxes, grid, rows };
  }

  draw() {
    const c = this.canvas;
    const g = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    if (!this.series.length) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      return;
    }
    const panels = this._panels();
    const L = this._layout(panels);
    if (c.width !== Math.round(L.w * dpr) || c.height !== Math.round(L.h * dpr)) {
      c.width = Math.round(L.w * dpr);
      c.height = Math.round(L.h * dpr);
    }
    c.style.height = L.h + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, L.w, L.h);

    const R = this.range;
    const sx = (x) => L.left + ((x - R.x0) / (R.x1 - R.x0)) * L.pw;
    const syIn = (box) => (y) => box.top + (1 - (y - R.y0) / (R.y1 - R.y0)) * L.ph;
    this._scale = { sx, L, panels, heights: [] };

    const ink = cssVar(this.host, '--ink');
    const ink2 = cssVar(this.host, '--ink-2');
    const gridColor = cssVar(this.host, '--grid');
    const surface = cssVar(this.host, '--surface');
    const font = getComputedStyle(this.host).fontFamily;

    const stroke = (s, sy) => {
      g.beginPath();
      let pen = false;
      for (let i = 0; i < s.ys.length; i++) {
        const y = s.ys[i];
        const x = s.xs ? s.xs[i] : i;
        if (!Number.isFinite(y) || !Number.isFinite(x)) { pen = false; continue; }
        if (pen) g.lineTo(sx(x), sy(y));
        else { g.moveTo(sx(x), sy(y)); pen = true; }
      }
      g.stroke();
    };

    panels.forEach((panel, k) => {
      const box = L.boxes[k];
      const sy = syIn(box);

      // 枠の見出し（並べたとき）
      if (L.rows) {
        g.font = `bold 13px ${font}`;
        g.textBaseline = 'middle';
        g.textAlign = 'left';
        g.fillStyle = cssVar(this.host, `--series-${panel.series[0].slot}`);
        g.fillRect(L.left, box.titleY + 7, 14, 4);
        g.fillStyle = ink;
        g.fillText(panel.title, L.left + 20, box.titleY + 9);
      }

      // 目盛りと補助線
      g.font = `12px ${font}`;
      g.lineWidth = 1;
      g.textBaseline = 'middle';
      g.textAlign = 'right';
      for (const v of niceTicks(R.y0, R.y1, L.rows ? 3 : 5)) {
        const y = Math.round(sy(v)) + 0.5;
        g.strokeStyle = v === 0 ? ink2 : gridColor;
        g.globalAlpha = v === 0 ? 0.6 : 1;
        g.beginPath();
        g.moveTo(L.left, y);
        g.lineTo(L.right, y);
        g.stroke();
        g.globalAlpha = 1;
        g.fillStyle = ink2;
        g.fillText(tickLabel(v), L.left - 8, y);
      }

      // ブロック表示: 線の高さまで、草・土・石のブロックを積む
      const heights = L.grid && panel.main ? new Int16Array(L.grid.cols) : null;
      if (heights) {
        this.tex ??= {
          grass: pixelCanvas(GRASS_SIDE.seed, GRASS_SIDE.base, GRASS_SIDE.cap),
          grassTop: pixelCanvas(TEX_SEED.grass, 'grass'),
          dirt: pixelCanvas(TEX_SEED.dirt, 'dirt'),
          stone: pixelCanvas(TEX_SEED.stone, 'stone'),
        };
        const { size, cols, rows } = L.grid;
        // ブロックが小さいときは、草のふちがつぶれて見えなくなるので、いちばん上を全面草のブロックにして土の層も薄くする
        const small = size < 12;
        const grass = small ? this.tex.grassTop : this.tex.grass;
        const dirtDepth = small ? 2 : 3;
        g.imageSmoothingEnabled = false;
        for (let col = 0; col < cols; col++) {
          const x = R.x0 + ((col + 0.5) / cols) * (R.x1 - R.x0);
          const v = this._valueAt(panel.main, x);
          if (!Number.isFinite(v)) continue;
          // 高さを「ブロック何個分か」の整数に丸める（いちばん下の 1 個は必ず置く）
          const count = Math.min(rows, Math.max(1, Math.round(((v - R.y0) / (R.y1 - R.y0)) * rows)));
          heights[col] = count;
          for (let j = 0; j < count; j++) {
            const depth = count - 1 - j;                    // 上から何個目か（0 がいちばん上）
            const tex = depth === 0 ? grass : depth <= dirtDepth ? this.tex.dirt : this.tex.stone;
            g.drawImage(tex, L.left + col * size, box.bottom - (j + 1) * size, size, size);
          }
        }
        g.imageSmoothingEnabled = true;
      }
      this._scale.heights.push(heights);

      // ひとつ前の結果（うすい線）
      g.strokeStyle = ink2;
      g.globalAlpha = heights ? 0.7 : 0.4;
      g.lineWidth = 1.5;
      g.lineJoin = 'round';
      for (const s of panel.ghost) stroke(s, sy);
      g.globalAlpha = 1;

      // 線と点
      for (const s of panel.series) {
        const color = cssVar(this.host, `--series-${s.slot}`);
        if (s.dots) {
          for (let i = 0; i < s.ys.length; i++) {
            const y = s.ys[i];
            const x = s.xs ? s.xs[i] : i;
            if (!Number.isFinite(y) || !Number.isFinite(x)) continue;
            g.beginPath();
            g.arc(sx(x), sy(y), 6, 0, Math.PI * 2);
            g.fillStyle = surface;
            g.fill();
            g.beginPath();
            g.arc(sx(x), sy(y), 4, 0, Math.PI * 2);
            g.fillStyle = color;
            g.fill();
          }
          continue;
        }
        g.lineJoin = 'round';
        g.lineCap = 'round';
        if (heights && s !== panel.main) {
          // ブロックの上でも線が見えるように、白いふちを付ける
          g.strokeStyle = surface;
          g.lineWidth = 3.5;
          stroke(s, sy);
        }
        g.strokeStyle = color;
        // ブロック表示では、ブロックが主役になるよう線を細くする（ブロックにした線は、草の段が隠れないよう特に細く）
        g.lineWidth = heights ? (s === panel.main ? 1.2 : 1.5) : (s.width || 2);
        stroke(s, sy);
        if (s.ys.length === 1 && Number.isFinite(s.ys[0])) {
          g.beginPath();
          g.arc(sx(s.xs ? s.xs[0] : 0), sy(s.ys[0]), 3, 0, Math.PI * 2);
          g.fillStyle = color;
          g.fill();
        }
      }

      // マウス・指の位置の縦線と、いちばん近い点の印
      if (this.hover) {
        const x = Math.round(sx(this.hover.x)) + 0.5;
        g.strokeStyle = ink;
        g.globalAlpha = 0.45;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, box.top);
        g.lineTo(x, box.bottom);
        g.stroke();
        g.globalAlpha = 1;
        for (const p of this.hover.points) {
          if (!panel.series.includes(p.series)) continue;
          g.beginPath();
          g.arc(sx(p.x), sy(p.y), 6, 0, Math.PI * 2);
          g.fillStyle = surface;
          g.fill();
          g.beginPath();
          g.arc(sx(p.x), sy(p.y), 4, 0, Math.PI * 2);
          g.fillStyle = cssVar(this.host, `--series-${p.slot}`);
          g.fill();
        }
      }
    });

    // 横の目盛り（いちばん下にだけ出す）
    g.font = `12px ${font}`;
    g.textBaseline = 'top';
    g.textAlign = 'center';
    g.fillStyle = ink2;
    const last = L.boxes[L.boxes.length - 1];
    for (const v of niceTicks(R.x0, R.x1, Math.max(3, Math.floor(L.pw / 80)))) {
      g.fillText(tickLabel(v), sx(v), last.bottom + 8);
    }
  }

  _nearest(s, x) {
    const n = s.ys.length;
    if (!s.xs) return Math.min(n - 1, Math.max(0, Math.round(x)));
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(s.xs[i] - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  _onMove(ev) {
    if (!this.series.length || !this._scale) return;
    const rect = this.canvas.getBoundingClientRect();
    const { L, panels } = this._scale;
    const R = this.range;
    const px = Math.min(L.right, Math.max(L.left, ev.clientX - rect.left));
    const x = R.x0 + ((px - L.left) / L.pw) * (R.x1 - R.x0);

    // 線の系列を優先して、横位置がいちばん近い点を読む
    const lines = this._lines();
    const anchor = (lines.length ? lines : this.series)[0];
    const ai = this._nearest(anchor, x);
    const ax = anchor.xs ? anchor.xs[ai] : ai;
    const tolerance = ((R.x1 - R.x0) / L.pw) * 12;
    const points = [];
    for (const s of this.series) {
      const i = this._nearest(s, ax);
      const sxv = s.xs ? s.xs[i] : i;
      if (!Number.isFinite(s.ys[i])) continue;
      if (s.dots && Math.abs(sxv - ax) > tolerance) continue;
      points.push({ series: s, slot: s.slot, label: s.label || `線 ${s.slot}`, x: sxv, y: s.ys[i], dots: s.dots });
    }
    this.hover = { x: ax, points };
    this.draw();

    // ブロック表示のときは、その位置に積まれているブロックの個数も出す
    const heights = this._scale.heights;
    const column = L.grid ? Math.min(L.grid.cols - 1, Math.max(0, Math.floor(((ax - R.x0) / (R.x1 - R.x0)) * L.grid.cols))) : -1;
    const blockCount = (s) => {
      const k = panels.findIndex((p) => p.main === s);
      return k >= 0 && heights[k] ? heights[k][column] : null;
    };
    this.tip.replaceChildren(
      el('div', { class: 'tip-x', text: `横の位置 ${fmt(ax)}` }),
      ...points.map((p) => {
        const count = blockCount(p.series);
        return el('div', { class: 'tip-row' }, [
          el('span', { class: 'swatch' + (p.dots ? ' dot' : ''), style: `--c: var(--series-${p.slot})` }),
          el('span', { class: 'tip-label', text: p.label }),
          el('b', { text: fmt(p.y) + (count === null ? '' : `（ブロック ${count} 個）`) }),
        ]);
      }),
    );
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth;
    const cx = this._scale.sx(ax);
    const left = cx + 14 + tw > L.w ? cx - 14 - tw : cx + 14;
    this.tip.style.left = Math.max(4, left) + 'px';
    this.tip.style.top = L.boxes[0].top + 4 + 'px';
  }

  toBlob(callback) {
    // 保存用に、背景を塗った画像を作る
    const src = this.canvas;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const g = out.getContext('2d');
    g.fillStyle = cssVar(this.host, '--surface');
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(src, 0, 0);
    out.toBlob(callback, 'image/png');
  }
}
