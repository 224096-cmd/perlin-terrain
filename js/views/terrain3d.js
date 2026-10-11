// 3D の地形表示（terrain() の表示先）。Three.js（WebGL）で描く。
// 「なめらか」= 1 枚の面、「ブロック」= 立方体の集まり の 2 通りで表示できる。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const NAMED_COLORS = {
  water: '#2f6fa8', sand: '#d8c383', grass: '#5d9f4a', forest: '#2e6b3c', dirt: '#8b6340',
  stone: '#8b8f92', snow: '#f3f6f8', ice: '#bfe2ee', lava: '#dd4a1e',
};
// 色を指定しないときの、高さによる色分け（低い → 高い）
const HEIGHT_STOPS = [
  [0.0, '#3c7a45'], [0.4, '#6fa650'], [0.62, '#a39160'], [0.8, '#8b8f92'], [0.93, '#f3f6f8'], [1.0, '#f3f6f8'],
];
const MAX_CUBES = 300000;

// 場所から決まる 0〜1 の数（ブロックごとの明るさを少しずつ変えるのに使う）
function hash01(i, j) {
  let n = (i * 374761393 + j * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

// ---------- ブロックの質感（16×16 のドット絵をその場で描く。画像ファイルは使わない） ----------
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIXELS = {
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

function pixelTexture(seed, base, cap = null) {
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
    // 側面の上のふち（草や雪がかぶさっている部分）。列ごとに長さを変えて、ぎざぎざにする
    for (let x = 0; x < 16; x++) {
      const depth = 3 + Math.floor(rand() * 3);
      for (let y = 0; y < depth; y++) {
        g.fillStyle = pick(PIXELS[cap]);
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 種類ごとの材質（立方体の 6 面: 右・左・上・下・前・後ろ）
let blockMaterials = null;
function getBlockMaterials() {
  if (blockMaterials) return blockMaterials;
  const mat = (tex) => new THREE.MeshLambertMaterial({ map: tex });
  const cube = (top, side, bottom) => [side, side, top, bottom, side, side];
  const t = {};
  let seed = 11;
  for (const name of Object.keys(PIXELS)) t[name] = mat(pixelTexture(seed++, name));
  const grassSide = mat(pixelTexture(101, 'dirt', 'grass'));
  const snowSide = mat(pixelTexture(102, 'stone', 'snow'));
  blockMaterials = {
    grass: cube(t.grass, grassSide, t.dirt),
    snow: cube(t.snow, snowSide, t.stone),
    dirt: cube(t.dirt, t.dirt, t.dirt),
    stone: cube(t.stone, t.stone, t.stone),
    sand: cube(t.sand, t.sand, t.sand),
    water: cube(t.water, t.water, t.water),
    forest: cube(t.forest, t.forest, t.forest),
    ice: cube(t.ice, t.ice, t.ice),
    lava: cube(t.lava, t.lava, t.lava),
    plain: cube(t.plain, t.plain, t.plain),
  };
  return blockMaterials;
}

// いちばん上が top のとき、上から depth 個目（0 が最上段）に置くブロックの種類
function layerType(top, depth) {
  if (depth === 0) return top;
  switch (top) {
    case 'grass': case 'forest': case 'dirt': return depth <= 3 ? 'dirt' : 'stone';
    case 'sand': return depth <= 3 ? 'sand' : 'stone';
    case 'water': return depth <= 2 ? 'water' : 'stone';
    case 'ice': return depth <= 1 ? 'ice' : depth <= 3 ? 'water' : 'stone';
    case 'lava': return depth <= 2 ? 'lava' : 'stone';
    case 'plain': return depth <= 3 ? 'plain' : 'stone';
    default: return 'stone';
  }
}

export class TerrainView {
  constructor(host) {
    this.host = host;
    this.mode = 'smooth';
    this.data = null;
    this.notice = '';
    this._raf = 0;
    this._autoRotate = false;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '3D の地形。ドラッグで回転、ホイールやピンチで拡大・縮小');
    host.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 4 / 3, 0.5, 5000);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x66707a, 1.9));
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.position.set(-0.55, 1, 0.75);
    this.scene.add(this.sun);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this._applyTheme();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      this._applyTheme();
      this.requestRender();
    });
    new ResizeObserver(() => this._resize()).observe(host);
    this._resize();
  }

  _applyTheme() {
    const sky = getComputedStyle(this.host).getPropertyValue('--sky').trim() || '#cfe3ee';
    this.scene.background = new THREE.Color(sky);
  }

  _resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (this._autoRotate) this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (this._autoRotate) this.requestRender();
    });
  }

  renderNow() {
    this.renderer.render(this.scene, this.camera);
  }

  setAutoRotate(on) {
    this._autoRotate = on;
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 1.2;
    this.requestRender();
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.data) this._rebuild();
    this.requestRender();
  }

  // d: { w, h, data: Float32Array, sea: number|null, palette: string[], colors: Uint8Array|null }
  setData(d) {
    const dimsChanged = !this.data || this.data.w !== d.w || this.data.h !== d.h;
    this.data = d;
    this._prepare();
    this._rebuild();
    if (dimsChanged) this.resetCamera();
    this.requestRender();
  }

  // 高さの最小・最大と、マスごとの色を求める
  _prepare() {
    const d = this.data;
    const n = d.w * d.h;
    const hs = new Float32Array(n);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = Number.isFinite(d.data[i]) ? d.data[i] : 0;
      hs[i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    this.heights = hs;
    this.min = min;
    this.max = max;
    this.sea = typeof d.sea === 'number' && Number.isFinite(d.sea) ? d.sea : null;

    const rgb = new Float32Array(n * 3);
    const c = new THREE.Color();
    if (d.colors && d.palette && d.palette.length) {
      const pal = d.palette.map((name) => new THREE.Color(NAMED_COLORS[name] || name));
      this.paletteNames = d.palette;
      this.cellNames = d.colors;
      for (let i = 0; i < n; i++) {
        const p = pal[d.colors[i]] || pal[0];
        rgb[i * 3] = p.r; rgb[i * 3 + 1] = p.g; rgb[i * 3 + 2] = p.b;
      }
    } else {
      this.paletteNames = null;
      this.cellNames = null;
      const stops = HEIGHT_STOPS.map(([t, hex]) => [t, new THREE.Color(hex)]);
      const sand = new THREE.Color(NAMED_COLORS.sand);
      const floor = this.sea !== null ? Math.max(min, this.sea) : min;
      const span = Math.max(1e-6, max - floor);
      for (let i = 0; i < n; i++) {
        const v = hs[i];
        if (this.sea !== null && v <= this.sea + 1) {
          c.copy(sand);
        } else {
          const t = Math.min(1, Math.max(0, (v - floor) / span));
          let k = 0;
          while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
          const [t0, c0] = stops[k];
          const [t1, c1] = stops[k + 1];
          c.copy(c0).lerp(c1, t1 > t0 ? (t - t0) / (t1 - t0) : 0);
        }
        rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b;
      }
    }
    this.cellRGB = rgb;
  }

  _clear() {
    // 種類ごとの材質は使い回すので、ここでは捨てない
    const shared = blockMaterials ? new Set(Object.values(blockMaterials).flat()) : new Set();
    const geos = new Set();
    for (const obj of [...this.group.children]) {
      this.group.remove(obj);
      if (obj.geometry) geos.add(obj.geometry);
      for (const mat of [].concat(obj.material || [])) if (!shared.has(mat)) mat.dispose();
    }
    for (const g of geos) g.dispose();
  }

  _rebuild() {
    this._clear();
    this.notice = '';
    const bottom = this.mode === 'blocks' ? this._buildBlocks() : this._buildSmooth();
    this._buildWater(bottom);
  }

  _buildSmooth() {
    const { w, h } = this.data;
    const hs = this.heights;
    const bottom = this.min - Math.max(1, Math.max(w, h) * 0.04);
    // 外周をぐるっと 1 周する点の番号（側面の壁を作るのに使う）
    const rim = [];
    for (let i = 0; i < w; i++) rim.push(i);
    for (let j = 1; j < h; j++) rim.push(j * w + w - 1);
    for (let i = w - 2; i >= 0; i--) rim.push((h - 1) * w + i);
    for (let j = h - 2; j >= 1; j--) rim.push(j * w);
    const wall = w > 1 && h > 1 ? rim.length : 0;

    const top = w * h;
    const pos = new Float32Array((top + wall * 2) * 3);
    const col = new Float32Array((top + wall * 2) * 3);
    col.set(this.cellRGB);
    const px = (k) => (k % w) - (w - 1) / 2;
    const pz = (k) => Math.floor(k / w) - (h - 1) / 2;
    for (let k = 0; k < top; k++) {
      pos[k * 3] = px(k);
      pos[k * 3 + 1] = hs[k];
      pos[k * 3 + 2] = pz(k);
    }
    const earth = new THREE.Color('#7a6650');
    for (let r = 0; r < wall; r++) {
      const k = rim[r];
      const a = (top + r * 2) * 3;          // 壁の上の点
      const b = a + 3;                      // 壁の下の点
      pos[a] = pos[b] = px(k);
      pos[a + 2] = pos[b + 2] = pz(k);
      pos[a + 1] = hs[k];
      pos[b + 1] = bottom;
      col[a] = earth.r; col[a + 1] = earth.g; col[a + 2] = earth.b;
      col[b] = earth.r * 0.7; col[b + 1] = earth.g * 0.7; col[b + 2] = earth.b * 0.7;
    }

    const quads = Math.max(0, (w - 1) * (h - 1));
    const index = new Uint32Array((quads + wall) * 6);
    let q = 0;
    for (let j = 0; j < h - 1; j++) {
      for (let i = 0; i < w - 1; i++) {
        const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
        index[q++] = a; index[q++] = c; index[q++] = b;
        index[q++] = b; index[q++] = c; index[q++] = d;
      }
    }
    for (let r = 0; r < wall; r++) {
      const a = top + r * 2, b = a + 1;
      const c = top + ((r + 1) % wall) * 2, d = c + 1;
      index[q++] = a; index[q++] = c; index[q++] = b;
      index[q++] = b; index[q++] = c; index[q++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(geo, mat));
    this.stats = { mode: 'smooth', triangles: (quads + wall) * 2, cubes: 0 };
    return bottom;
  }

  // マスごとの「いちばん上のブロックの種類」を決める
  _topTypes() {
    const n = this.data.w * this.data.h;
    const types = new Array(n);
    if (this.paletteNames) {
      for (let k = 0; k < n; k++) {
        const name = this.paletteNames[this.cellNames[k]];
        types[k] = NAMED_COLORS[name] ? name : 'plain';    // 色コードで指定されたマスは、色を付けた無地のブロック
      }
      return types;
    }
    // 種類の指定がないときは、高さから決める
    const floor = this.sea !== null ? Math.max(this.min, this.sea) : this.min;
    const span = Math.max(1e-6, this.max - floor);
    for (let k = 0; k < n; k++) {
      const v = this.heights[k];
      const t = (v - floor) / span;
      if (this.sea !== null && v <= this.sea + 1) types[k] = 'sand';
      else if (t < 0.58) types[k] = 'grass';
      else if (t < 0.82) types[k] = 'stone';
      else types[k] = 'snow';
    }
    return types;
  }

  _buildBlocks() {
    const { w, h } = this.data;
    const n = w * h;
    const H = new Int32Array(n);
    let lowest = Infinity;
    for (let i = 0; i < n; i++) {
      H[i] = Math.round(this.heights[i]);
      if (H[i] < lowest) lowest = H[i];
    }
    const base = lowest - 1;        // いちばん低い柱でも 1 個はブロックが見えるようにする
    const tops = this._topTypes();

    // 外から見える範囲（となりより高い部分）だけにブロックを置く
    const from = new Int32Array(n);
    let count = 0;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
        let lo = edge ? base : Math.min(H[k - 1], H[k + 1], H[k - w], H[k + w]);
        lo = Math.min(lo, H[k] - 1);
        from[k] = lo;
        count += H[k] - lo;
      }
    }
    const stacked = count <= MAX_CUBES;
    const materials = getBlockMaterials();
    const rgb = this.cellRGB;

    if (!stacked) {
      // 高低差が大きすぎるときは、1 マスを 1 本の柱（色を付けた無地）で表す
      this.notice = '高低差が大きいので、1 マスを 1 本の柱として表示しています。';
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), materials.plain, n);
      const m = mesh.instanceMatrix.array;
      const col = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const tall = H[k] - base;
        const o = k * 16;
        m[o] = 1; m[o + 5] = tall; m[o + 10] = 1; m[o + 15] = 1;
        m[o + 12] = (k % w) - w / 2 + 0.5;
        m[o + 13] = base + tall / 2;
        m[o + 14] = Math.floor(k / w) - h / 2 + 0.5;
        col[k * 3] = rgb[k * 3]; col[k * 3 + 1] = rgb[k * 3 + 1]; col[k * 3 + 2] = rgb[k * 3 + 2];
      }
      mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.stats = { mode: 'blocks', triangles: n * 12, cubes: n };
      return base;
    }

    // 1 回目: 種類ごとの個数を数える
    const counts = {};
    for (let k = 0; k < n; k++) {
      for (let y = H[k]; y > from[k]; y--) {
        const type = layerType(tops[k], H[k] - y);
        counts[type] = (counts[type] || 0) + 1;
      }
    }
    // 2 回目: 種類ごとにまとめて配置する（同じ形をまとめて描く「インスタンス描画」）
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const batches = {};
    for (const [type, c] of Object.entries(counts)) {
      const mesh = new THREE.InstancedMesh(geo, materials[type], c);
      mesh.frustumCulled = false;
      batches[type] = { mesh, m: mesh.instanceMatrix.array, col: new Float32Array(c * 3), p: 0 };
      this.group.add(mesh);
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const x = i - w / 2 + 0.5;
        const z = j - h / 2 + 0.5;
        for (let y = H[k]; y > from[k]; y--) {
          const depth = H[k] - y;
          const type = layerType(tops[k], depth);
          const b = batches[type];
          // 水面は、ブロックの上の面より少し低くする
          const sy = type === 'water' && depth === 0 ? 0.86 : 1;
          const o = b.p * 16;
          b.m[o] = 1; b.m[o + 5] = sy; b.m[o + 10] = 1; b.m[o + 15] = 1;
          b.m[o + 12] = x; b.m[o + 13] = y - 1 + sy / 2; b.m[o + 14] = z;
          const shade = 0.93 + 0.1 * hash01(i * 31 + y, j * 17 - y);
          if (type === 'plain') {
            b.col[b.p * 3] = rgb[k * 3] * shade; b.col[b.p * 3 + 1] = rgb[k * 3 + 1] * shade; b.col[b.p * 3 + 2] = rgb[k * 3 + 2] * shade;
          } else {
            b.col[b.p * 3] = shade; b.col[b.p * 3 + 1] = shade; b.col[b.p * 3 + 2] = shade;
          }
          b.p += 1;
        }
      }
    }
    for (const b of Object.values(batches)) {
      b.mesh.instanceColor = new THREE.InstancedBufferAttribute(b.col, 3);
      b.mesh.instanceMatrix.needsUpdate = true;
    }
    this.stats = { mode: 'blocks', triangles: count * 12, cubes: count };
    return base;
  }

  _buildWater(bottom) {
    if (this.sea === null) return;
    const { w, h } = this.data;
    const blocks = this.mode === 'blocks';
    const top = blocks ? Math.round(this.sea) - 0.12 : this.sea;
    if (top <= bottom) return;
    const sx = blocks ? w : w - 1;
    const sz = blocks ? h : h - 1;
    const geo = new THREE.BoxGeometry(sx - 0.02, top - bottom, sz - 0.02);
    const mat = new THREE.MeshLambertMaterial({ color: NAMED_COLORS.water, transparent: true, opacity: 0.62, depthWrite: false });
    const water = new THREE.Mesh(geo, mat);
    water.position.set(0, bottom + (top - bottom) / 2, 0);
    water.renderOrder = 1;
    this.group.add(water);
  }

  resetCamera() {
    if (!this.data) return;
    const size = Math.max(this.data.w, this.data.h);
    const mid = Math.min(Math.max((this.min + this.max) / 2, -size), size);
    const tall = Math.min(Math.max(this.max - mid, 0), size);
    this.controls.target.set(0, mid, 0);
    this.camera.position.set(size * 1.05, mid + size * 0.8 + tall * 0.4, size * 1.35);
    this.camera.near = Math.max(0.1, size / 200);
    this.camera.far = size * 40;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = size * 0.15;
    this.controls.maxDistance = size * 8;
    this.controls.update();
    this.requestRender();
  }

  // 計測用: データを指定の見た目で作り直して 1 回描き、かかった時間（ms）を返す
  measure(d, mode) {
    const t = performance.now();
    this.mode = mode;
    this.setData(d);
    this.renderNow();
    this.renderer.getContext().finish();   // GPU の描画が終わるまで待つ
    return performance.now() - t;
  }

  toBlob(callback) {
    this.renderNow();
    this.canvas.toBlob(callback, 'image/png');
  }
}
