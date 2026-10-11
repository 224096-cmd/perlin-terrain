// ブロックの質感（16×16 のドット絵）。画像ファイルは使わず、その場で描く。
// 3D の地形（terrain3d.js）と、グラフのブロック表示（plot.js）の両方で使う。

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 種類ごとのドットの色（先頭がいちばん多く使われる色）
export const PIXELS = {
  grass: ['#5fa84a', '#6db857', '#4f9440', '#58a046', '#76c060'],
  dirt: ['#8a6240', '#7a5536', '#96704c', '#6f4c30', '#a07a55'],
  stone: ['#8c8f92', '#7d8083', '#9a9da0', '#74777a', '#a4a7aa'],
  sand: ['#dccb8c', '#e6d79c', '#d2bf7e', '#cdb974', '#e9dca6'],
  snow: ['#f2f5f7', '#ffffff', '#e6ecf0', '#dfe7ec', '#f8fbfc'],
  water: ['#2f72b5', '#3a80c4', '#2a68a8', '#3577bb', '#4a90d0'],
  forest: ['#2f6f3c', '#27603a', '#3a7f46', '#1f5530', '#46904f'],
  ice: ['#bfe2ee', '#d4eef6', '#a9d6e6', '#e6f6fb', '#b4dcea'],
  lava: ['#e0521c', '#f08a24', '#c93a14', '#ffb347', '#d8451a'],
  plain: ['#e8e8e8', '#f4f4f4', '#dcdcdc', '#d2d2d2', '#eeeeee'],
};

// 種類ごとの乱数の種（3D とグラフで同じ模様になるようにそろえる）
export const TEX_SEED = Object.fromEntries(Object.keys(PIXELS).map((name, k) => [name, 11 + k]));
export const GRASS_SIDE = { seed: 101, base: 'dirt', cap: 'grass' };   // 草ブロックの側面（土の上に草がかぶさる）
export const SNOW_SIDE = { seed: 102, base: 'stone', cap: 'snow' };    // 雪ブロックの側面

// 16×16 のドット絵を描いた canvas を返す。cap を指定すると、上のふちにその種類がかぶさる。
export function pixelCanvas(seed, base, cap = null) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const g = canvas.getContext('2d');
  const rand = seeded(seed);
  const pick = (list) => (rand() < 0.45 ? list[0] : list[1 + Math.floor(rand() * (list.length - 1))]);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      g.fillStyle = pick(PIXELS[base]);
      g.fillRect(x, y, 1, 1);
    }
  }
  if (cap) {
    // 列ごとに長さを変えて、ふちをぎざぎざにする
    for (let x = 0; x < 16; x++) {
      const depth = 3 + Math.floor(rand() * 3);
      for (let y = 0; y < depth; y++) {
        g.fillStyle = pick(PIXELS[cap]);
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  return canvas;
}
