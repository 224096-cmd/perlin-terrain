// 計測の比較用: py/bench.py と同じアルゴリズムを JavaScript で書いたもの。
// 「同じ計算を Python（Pyodide）で行うと、JavaScript の何倍の時間がかかるか」を調べるために使う。
// 乱数の作り方が Python と違うので地形の形は一致しないが、計算の量は同じ。

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateJS(size, octaves) {
  const SEED = 7, HEIGHT = 16, SCALE = 3, PERSISTENCE = 0.5;
  const rand = mulberry32(SEED);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const arrows = [];
  for (let i = 0; i < 256; i++) {
    const angle = rand() * 2 * Math.PI;
    arrows.push([Math.cos(angle), Math.sin(angle)]);
  }
  const mod = (n) => ((n % 256) + 256) % 256;
  const lerp = (a, b, t) => a + (b - a) * t;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const corner = (ix, iy, x, y) => {
    const a = arrows[perm[mod(perm[mod(ix)] + iy)]];
    return a[0] * (x - ix) + a[1] * (y - iy);
  };
  const perlin2 = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const u = fade(x - ix), v = fade(y - iy);
    const top = lerp(corner(ix, iy, x, y), corner(ix + 1, iy, x, y), u);
    const bottom = lerp(corner(ix, iy + 1, x, y), corner(ix + 1, iy + 1, x, y), u);
    return lerp(top, bottom, v);
  };
  const fbm = (x, y) => {
    let total = 0, freq = 1, amp = 1;
    for (let o = 0; o < octaves; o++) {
      total += amp * perlin2(x * freq + o * 17.3, y * freq + o * 17.3);
      freq *= 2;
      amp *= PERSISTENCE;
    }
    return total;
  };
  const heights = [];
  for (let j = 0; j < size; j++) {
    const row = [];
    for (let i = 0; i < size; i++) {
      row.push(HEIGHT * fbm((i / size) * SCALE, (j / size) * SCALE));
    }
    heights.push(row);
  }
  return heights;
}
