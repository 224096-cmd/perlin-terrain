// 上から見た白黒の地図（heatmap() の表示先）。値が大きいほど白い。
import { el, fmt } from '../util.js';

function drawGray(canvas, map) {
  const { w, h, data, lo, hi } = map;
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  const img = g.createImageData(w, h);
  const span = hi - lo;
  for (let i = 0; i < w * h; i++) {
    const v = data[i];
    let t = span > 0 ? (v - lo) / span : 0.5;
    if (!Number.isFinite(t)) t = 0;
    const c = Math.round(Math.min(1, Math.max(0, t)) * 255);
    img.data[i * 4] = c;
    img.data[i * 4 + 1] = c;
    img.data[i * 4 + 2] = c;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

export class MapGallery {
  constructor(host) {
    this.host = host;
    this.maps = [];
  }

  // maps: [{ label, w, h, data: Float32Array, lo, hi }]（lo / hi は null なら自動）
  update(maps) {
    this.maps = maps.map((m) => {
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < m.data.length; i++) {
        const v = m.data[i];
        if (!Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (!Number.isFinite(min)) { min = 0; max = 1; }
      return { ...m, lo: m.lo ?? min, hi: m.hi ?? max, min, max };
    });
    this.host.classList.toggle('many', this.maps.length > 1);
    this.host.replaceChildren(...this.maps.map((m) => this._figure(m)));
  }

  _figure(m) {
    const canvas = el('canvas', { class: 'map-canvas', role: 'img', 'aria-label': `地図: ${m.label || '名前なし'}（${m.w}×${m.h} マス）` });
    canvas.style.aspectRatio = `${m.w} / ${m.h}`;
    drawGray(canvas, m);
    const idle = `${m.w}×${m.h} マス`;
    const readout = el('p', { class: 'map-readout', text: idle });
    const read = (ev) => {
      const r = canvas.getBoundingClientRect();
      const i = Math.min(m.w - 1, Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * m.w)));
      const j = Math.min(m.h - 1, Math.max(0, Math.floor(((ev.clientY - r.top) / r.height) * m.h)));
      readout.textContent = `列 ${i}・行 ${j} の値 ${fmt(m.data[j * m.w + i])}`;
    };
    canvas.addEventListener('pointermove', read);
    canvas.addEventListener('pointerdown', read);
    canvas.addEventListener('pointerleave', () => { readout.textContent = idle; });

    const scale = el('div', { class: 'map-scale' }, [
      el('span', { text: fmt(m.lo) }),
      el('span', { class: 'map-ramp', 'aria-hidden': 'true' }),
      el('span', { text: fmt(m.hi) }),
    ]);
    return el('figure', { class: 'map-figure' }, [
      m.label ? el('figcaption', { text: m.label }) : null,
      canvas,
      scale,
      readout,
    ]);
  }

  // 保存用に、全部の地図を 1 枚の画像に並べる
  toBlob(callback) {
    if (!this.maps.length) return;
    const cell = 384, gap = 16, cols = Math.min(this.maps.length, 3);
    const rows = Math.ceil(this.maps.length / cols);
    const out = document.createElement('canvas');
    out.width = cols * cell + (cols + 1) * gap;
    out.height = rows * (cell + 28) + (rows + 1) * gap;
    const g = out.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, out.width, out.height);
    g.imageSmoothingEnabled = false;
    g.font = '14px sans-serif';
    g.fillStyle = '#17262c';
    g.textBaseline = 'top';
    const tmp = document.createElement('canvas');
    this.maps.forEach((m, k) => {
      const x = gap + (k % cols) * (cell + gap);
      const y = gap + Math.floor(k / cols) * (cell + 28 + gap);
      drawGray(tmp, m);
      const s = Math.min(cell / m.w, cell / m.h);
      g.drawImage(tmp, x, y + 24, m.w * s, m.h * s);
      g.fillText(`${m.label || ''}  [${fmt(m.lo)} 〜 ${fmt(m.hi)}]`, x, y);
    });
    out.toBlob(callback, 'image/png');
  }
}
