// 折れ線グラフ（plot() の表示先）。Canvas に自前で描く。
import { el, fmt } from '../util.js';

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

  // series: [{ label, ys: Float32Array, xs: Float32Array|null, dots: boolean }]
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

  _ghostSeries() {
    return this.ghostVisible && this.ghost && this.ghost.length ? this.ghost : [];
  }

  _refresh() {
    this._computeRanges();
    const ghost = this._ghostSeries().length > 0;
    const named = this.series.filter((s) => s.label);
    this.caption.hidden = ghost || !(this.series.length === 1 && named.length === 1);
    this.caption.textContent = this.caption.hidden ? '' : named[0].label;
    this.legend.hidden = this.series.length < 2 && !ghost;
    const ghostItem = ghost ? [el('li', {}, [el('span', { class: 'swatch ghost' }), 'ひとつ前の結果'])] : [];
    this.legend.replaceChildren(...ghostItem, ...this.series.map((s) => el('li', {}, [
      el('span', { class: 'swatch' + (s.dots ? ' dot' : ''), style: `--c: var(--series-${s.slot}); --w: ${Math.max(2, Math.round((s.width || 2) * 1.5))}px` }),
      s.label || `線 ${s.slot}`,
    ])));
    this.canvas.setAttribute('aria-label',
      '折れ線グラフ: ' + this.series.map((s) => s.label || '名前なし').join('、'));
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

  _layout() {
    const w = Math.max(200, this.frame.clientWidth);
    const h = w < 420 ? 220 : 280;
    return { w, h, left: 46, right: 14, top: 12, bottom: 30 };
  }

  draw() {
    const L = this._layout();
    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    if (c.width !== Math.round(L.w * dpr) || c.height !== Math.round(L.h * dpr)) {
      c.width = Math.round(L.w * dpr);
      c.height = Math.round(L.h * dpr);
    }
    c.style.height = L.h + 'px';
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, L.w, L.h);
    if (!this.series.length) return;

    const R = this.range;
    const pw = L.w - L.left - L.right;
    const ph = L.h - L.top - L.bottom;
    const sx = (x) => L.left + ((x - R.x0) / (R.x1 - R.x0)) * pw;
    const sy = (y) => L.top + (1 - (y - R.y0) / (R.y1 - R.y0)) * ph;
    this._scale = { sx, sy, L, pw, ph };

    const ink = cssVar(this.host, '--ink');
    const ink2 = cssVar(this.host, '--ink-2');
    const grid = cssVar(this.host, '--grid');
    const surface = cssVar(this.host, '--surface');
    const font = getComputedStyle(this.host).fontFamily;

    // 目盛りと補助線
    g.font = `12px ${font}`;
    g.lineWidth = 1;
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    for (const v of niceTicks(R.y0, R.y1, 5)) {
      const y = Math.round(sy(v)) + 0.5;
      g.strokeStyle = v === 0 ? ink2 : grid;
      g.globalAlpha = v === 0 ? 0.6 : 1;
      g.beginPath();
      g.moveTo(L.left, y);
      g.lineTo(L.w - L.right, y);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = ink2;
      g.fillText(tickLabel(v), L.left - 8, y);
    }
    g.textBaseline = 'top';
    g.textAlign = 'center';
    const xTicks = niceTicks(R.x0, R.x1, Math.max(3, Math.floor(pw / 80)));
    for (const v of xTicks) {
      const x = sx(v);
      g.fillStyle = ink2;
      g.fillText(tickLabel(v), x, L.h - L.bottom + 8);
    }

    // ひとつ前の結果（うすい線）
    g.strokeStyle = ink2;
    g.globalAlpha = 0.4;
    g.lineWidth = 1.5;
    g.lineJoin = 'round';
    for (const s of this._ghostSeries()) {
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
    }
    g.globalAlpha = 1;

    // 線と点
    for (const s of this.series) {
      const color = cssVar(this.host, `--series-${s.slot}`);
      const n = s.ys.length;
      if (s.dots) {
        for (let i = 0; i < n; i++) {
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
      g.strokeStyle = color;
      g.lineWidth = s.width || 2;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      let pen = false;
      for (let i = 0; i < n; i++) {
        const y = s.ys[i];
        const x = s.xs ? s.xs[i] : i;
        if (!Number.isFinite(y) || !Number.isFinite(x)) { pen = false; continue; }
        if (pen) g.lineTo(sx(x), sy(y));
        else { g.moveTo(sx(x), sy(y)); pen = true; }
      }
      g.stroke();
      if (n === 1 && Number.isFinite(s.ys[0])) {
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
      g.moveTo(x, L.top);
      g.lineTo(x, L.h - L.bottom);
      g.stroke();
      g.globalAlpha = 1;
      for (const p of this.hover.points) {
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
    const { L, pw } = this._scale;
    const R = this.range;
    const px = Math.min(L.w - L.right, Math.max(L.left, ev.clientX - rect.left));
    const x = R.x0 + ((px - L.left) / pw) * (R.x1 - R.x0);

    // 線の系列を優先して、横位置がいちばん近い点を読む
    const lines = this.series.filter((s) => !s.dots);
    const base = lines.length ? lines : this.series;
    const anchor = base[0];
    const ai = this._nearest(anchor, x);
    const ax = anchor.xs ? anchor.xs[ai] : ai;
    const tolerance = (R.x1 - R.x0) / pw * 12;
    const points = [];
    for (const s of this.series) {
      const i = this._nearest(s, ax);
      const sxv = s.xs ? s.xs[i] : i;
      if (!Number.isFinite(s.ys[i])) continue;
      if (s.dots && Math.abs(sxv - ax) > tolerance) continue;
      points.push({ slot: s.slot, label: s.label || `線 ${s.slot}`, x: sxv, y: s.ys[i], dots: s.dots });
    }
    this.hover = { x: ax, points };
    this.draw();

    this.tip.replaceChildren(
      el('div', { class: 'tip-x', text: `横の位置 ${fmt(ax)}` }),
      ...points.map((p) => el('div', { class: 'tip-row' }, [
        el('span', { class: 'swatch' + (p.dots ? ' dot' : ''), style: `--c: var(--series-${p.slot})` }),
        el('span', { class: 'tip-label', text: p.label }),
        el('b', { text: fmt(p.y) }),
      ])),
    );
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth;
    const cx = this._scale.sx(ax);
    const left = cx + 14 + tw > L.w ? cx - 14 - tw : cx + 14;
    this.tip.style.left = Math.max(4, left) + 'px';
    this.tip.style.top = L.top + 4 + 'px';
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
