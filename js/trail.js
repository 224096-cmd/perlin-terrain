// ステップの道のり。山を登っていく断面図として、ステップを順に並べる。
// 稜線は、教材で学ぶ「fade による補間」で点と点をつないで描いている。
import { el } from './util.js';

// 道のりの高さ（0〜1）。最後のステップが山頂になるよう、ステップ数に合わせて引き伸ばして使う
const PROFILE = [0.10, 0.20, 0.16, 0.32, 0.46, 0.40, 0.58, 0.70, 0.80, 0.93];
function heightsFor(n) {
  if (n <= 1) return [PROFILE[PROFILE.length - 1]];
  return Array.from({ length: n }, (_, i) => {
    const p = (i / (n - 1)) * (PROFILE.length - 1);
    const k = Math.min(PROFILE.length - 2, Math.floor(p));
    return PROFILE[k] + (PROFILE[k + 1] - PROFILE[k]) * (p - k);
  });
}
const VIEW_W = 1000, VIEW_H = 100, GROUND = 96, PEAK = 14;

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const yOf = (hgt) => GROUND - hgt * (GROUND - PEAK);

export function buildTrail(host, lessons, onSelect) {
  const n = lessons.length;
  const HEIGHTS = heightsFor(n);
  const xs = lessons.map((_, i) => ((i + 0.5) / n) * VIEW_W);
  const pts = [[0, 0.05], ...xs.map((x, i) => [x, HEIGHTS[i]]), [VIEW_W, 0.78]];
  let d = '';
  for (let k = 0; k < pts.length - 1; k++) {
    const [x0, h0] = pts[k], [x1, h1] = pts[k + 1];
    for (let s = 0; s <= 16; s++) {
      const t = s / 16;
      const x = x0 + (x1 - x0) * t;
      const y = yOf(h0 + (h1 - h0) * fade(t));
      d += (d ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
  }
  const area = `${d} L${VIEW_W} ${VIEW_H} L0 ${VIEW_H} Z`;
  const contours = [30, 46, 62, 78].map((y) => `<line x1="0" x2="${VIEW_W}" y1="${y}" y2="${y}"/>`).join('');
  const svg = `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="trailTint" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" class="tint-peak"/><stop offset="0.35" class="tint-high"/>
          <stop offset="0.7" class="tint-mid"/><stop offset="1" class="tint-low"/>
        </linearGradient>
        <clipPath id="trailClip"><path d="${area}"/></clipPath>
      </defs>
      <path class="trail-area" d="${area}" fill="url(#trailTint)"/>
      <g class="trail-contours" clip-path="url(#trailClip)">${contours}</g>
      <path class="trail-ridge" d="${d}" vector-effect="non-scaling-stroke"/>
    </svg>`;
  host.innerHTML = svg;

  const buttons = lessons.map((lesson, i) => {
    const b = el('button', {
      type: 'button', class: 'trail-step',
      title: `ステップ ${i + 1}: ${lesson.title}`,
      'aria-label': `ステップ ${i + 1}: ${lesson.title}`,
      text: String(i + 1),
      onclick: () => onSelect(i),
    });
    b.style.left = (xs[i] / VIEW_W) * 100 + '%';
    b.style.top = (yOf(HEIGHTS[i]) / VIEW_H) * 100 + '%';
    host.appendChild(b);
    return b;
  });

  return {
    update(current, doneIds) {
      buttons.forEach((b, i) => {
        b.classList.toggle('current', i === current);
        b.classList.toggle('done', doneIds.has(lessons[i].id));
        if (i === current) b.setAttribute('aria-current', 'step');
        else b.removeAttribute('aria-current');
      });
    },
  };
}
