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
  const SEED = 7, HEIGHT = 12, SCALE = 3, PERSISTENCE = 0.5, DIRECTIONS = 6;
  const rand = mulberry32(SEED);
  const slopes = [];
  for (let i = 0; i < 256; i++) slopes.push(rand() * 2 - 1);

  const mod = (n) => ((n % 256) + 256) % 256;
  const lerp = (a, b, t) => a + (b - a) * t;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const perlin1 = (x) => {
    const i = Math.floor(x);
    const t = x - i;
    const left = slopes[mod(i)] * t;
    const right = slopes[mod(i + 1)] * (t - 1);
    return lerp(left, right, fade(t)) * 2;
  };
  const fbm1 = (x) => {
    let total = 0, freq = 1, amp = 1;
    for (let o = 0; o < octaves; o++) {
      total += amp * perlin1(x * freq + o * 17.3);
      freq *= 2;
      amp *= PERSISTENCE;
    }
    return total;
  };
  const ground = (x, z) => {
    let total = 0;
    for (let k = 0; k < DIRECTIONS; k++) {
      const angle = (Math.PI * k) / DIRECTIONS;
      const p = x * Math.cos(angle) + z * Math.sin(angle);
      total += fbm1(p + k * 31.7);
    }
    return total / Math.sqrt(DIRECTIONS);
  };
  const heights = [];
  for (let j = 0; j < size; j++) {
    const row = [];
    for (let i = 0; i < size; i++) {
      row.push(Math.round(HEIGHT * ground((i / size) * SCALE, (j / size) * SCALE)));
    }
    heights.push(row);
  }
  return heights;
}
