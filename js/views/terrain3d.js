// 3D の地形表示（terrain() の表示先）。Three.js（WebGL）で、立方体のブロックを積んだ地形を描く。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GRASS_SIDE, PIXELS, SNOW_SIDE, TEX_SEED, pixelCanvas } from './blocktex.js';

const NAMED_COLORS = {
  water: '#2f6fa8', sand: '#d8c383', grass: '#5d9f4a', forest: '#2e6b3c', dirt: '#8b6340',
  stone: '#8b8f92', snow: '#f3f6f8', ice: '#bfe2ee', lava: '#dd4a1e',
};
// 色を指定しないときの、高さによる色分け（低い → 高い）
const HEIGHT_STOPS = [
  [0.0, '#3c7a45'], [0.4, '#6fa650'], [0.62, '#a39160'], [0.8, '#8b8f92'], [0.93, '#f3f6f8'], [1.0, '#f3f6f8'],
];
const MAX_CUBES = 300000;
const MAX_PARTS = 4;          // 横に並べて表示できる地形の数

// 地形の上に出す名前の札（文字を描いた画像を、いつもカメラのほうを向く板に貼る）
function labelSprite(text) {
  const font = 'bold 44px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif';
  const canvas = document.createElement('canvas');
  let g = canvas.getContext('2d');
  g.font = font;
  const padX = 26;
  canvas.width = Math.ceil(g.measureText(text).width) + padX * 2;
  canvas.height = 76;
  g = canvas.getContext('2d');
  g.fillStyle = 'rgba(22, 32, 39, 0.82)';
  g.beginPath();
  g.roundRect(0, 0, canvas.width, canvas.height, 12);
  g.fill();
  g.font = font;
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.renderOrder = 3;
  sprite.userData.aspect = canvas.width / canvas.height;
  return sprite;
}

// 場所から決まる 0〜1 の数（ブロックごとの明るさを少しずつ変えるのに使う）
function hash01(i, j) {
  let n = (i * 374761393 + j * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

// ブロックの質感（ドット絵）を、3D 用のテクスチャにする
function pixelTexture(seed, base, cap = null) {
  const tex = new THREE.CanvasTexture(pixelCanvas(seed, base, cap));
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
  for (const name of Object.keys(PIXELS)) t[name] = mat(pixelTexture(TEX_SEED[name], name));
  const grassSide = mat(pixelTexture(GRASS_SIDE.seed, GRASS_SIDE.base, GRASS_SIDE.cap));
  const snowSide = mat(pixelTexture(SNOW_SIDE.seed, SNOW_SIDE.base, SNOW_SIDE.cap));
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
    this.data = null;
    this.parts = [];          // 表示中の地形（terrain() を呼んだ回数ぶん。横に並べる）
    this.target = null;       // いまブロックを置いている先
    this.extent = null;       // 全体の大きさ（視点を決めるのに使う）
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

  // d: { w, h, data: Float32Array, sea: number|null, palette: string[], colors: Uint8Array|null }
  // 配列で渡すと、その順に左から横に並べて表示する
  setData(d) {
    const all = Array.isArray(d) ? d : [d];
    const parts = all.slice(-MAX_PARTS);
    const key = (list) => list.map((p) => `${p.w}x${p.h}`).join(',');
    const dimsChanged = key(parts) !== key(this.parts);
    this.parts = parts;
    this._rebuild();
    if (all.length > MAX_PARTS) this.notice = `terrain() が ${all.length} 回呼ばれました。最後の ${MAX_PARTS} つを表示しています。 ${this.notice}`.trim();
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
    this.group.traverse((obj) => {
      if (obj.geometry && !obj.isSprite) geos.add(obj.geometry);
      for (const mat of [].concat(obj.material || [])) {
        if (shared.has(mat)) continue;
        if (obj.isSprite) mat.map?.dispose();
        mat.dispose();
      }
    });
    this.group.clear();
    for (const g of geos) g.dispose();
  }

  _rebuild() {
    this._clear();
    this.notice = '';
    // まず全部の地形の高さを調べて、底の高さと全体の大きさをそろえる
    const prepared = this.parts.map((part) => {
      this.data = part;
      this._prepare();
      return { data: part, heights: this.heights, min: this.min, max: this.max, sea: this.sea,
        cellRGB: this.cellRGB, paletteNames: this.paletteNames, cellNames: this.cellNames };
    });
    const depth = Math.max(...prepared.map((p) => p.data.h));
    const gap = prepared.length > 1 ? Math.max(3, Math.round(Math.max(...prepared.map((p) => p.data.w)) * 0.2)) : 0;
    const width = prepared.reduce((sum, p) => sum + p.data.w, 0) + gap * (prepared.length - 1);
    const lowest = Math.min(...prepared.map((p) => Math.round(p.min)));
    const top = Math.max(...prepared.map((p) => Math.max(p.max, p.sea ?? -Infinity)));
    const size = Math.max(width, depth);
    this.extent = { width, depth, min: lowest, max: top, size };
    const labelY = Math.min(top, size * 2);
    const stats = { triangles: 0, cubes: 0 };
    // 名前の札は、いちばん長い名前がその地形の幅に収まる大きさにして、全部同じ大きさでそろえる
    const sprites = prepared.map((p) => (p.data.label ? labelSprite(p.data.label) : null));
    const tall = Math.min(size * 0.05, ...prepared.map((p, k) => (sprites[k] ? (p.data.w * 0.98) / sprites[k].userData.aspect : Infinity)));
    let x = -width / 2;
    for (const [k, p] of prepared.entries()) {
      Object.assign(this, p);
      this.target = new THREE.Group();
      this.target.position.x = x + p.data.w / 2;
      this.group.add(this.target);
      const bottom = this._buildBlocks(lowest - 1);
      this._buildWater(bottom);
      stats.triangles += this.stats.triangles;
      stats.cubes += this.stats.cubes;
      const sprite = sprites[k];
      if (sprite) {
        sprite.scale.set(tall * sprite.userData.aspect, tall, 1);
        sprite.position.set(0, labelY + depth * 0.42 + tall, 0);      // 斜め上から見たとき、地形の奥のふちの上あたりに見える高さ
        this.target.add(sprite);
      }
      x += p.data.w + gap;
    }
    this.stats = stats;
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

  _buildBlocks(base) {
    const { w, h } = this.data;
    const n = w * h;
    const H = new Int32Array(n);
    // base: 底の高さ。いちばん低い柱でも 1 個はブロックが見えるように、最小の高さより 1 つ下にしてある
    for (let i = 0; i < n; i++) H[i] = Math.round(this.heights[i]);
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
      const target = this.target;
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
      target.add(mesh);
      this.stats = { triangles: n * 12, cubes: n };
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
      this.target.add(mesh);
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
    this.stats = { triangles: count * 12, cubes: count };
    return base;
  }

  _buildWater(bottom) {
    if (this.sea === null) return;
    const { w, h } = this.data;
    const top = Math.round(this.sea) - 0.12;      // ブロックの上の面と重ならないよう、少し低くする
    if (top <= bottom) return;
    const geo = new THREE.BoxGeometry(w - 0.02, top - bottom, h - 0.02);
    const mat = new THREE.MeshLambertMaterial({ color: NAMED_COLORS.water, transparent: true, opacity: 0.62, depthWrite: false });
    const water = new THREE.Mesh(geo, mat);
    water.position.set(0, bottom + (top - bottom) / 2, 0);
    water.renderOrder = 1;
    this.target.add(water);
  }

  // 地形全体が画面の中央に収まるように、視点を決め直す
  resetCamera() {
    if (!this.extent) return;
    const { width: w, depth: h, size } = this.extent;
    const several = this.parts.length > 1;
    const lo = Math.max(this.extent.min - 1, -size * 2);
    const hi = Math.min(this.extent.max, size * 2);
    const tall = Math.max(1, hi - lo);
    // 地形を囲む箱がちょうど入る距離を求める（縦・横のうち、せまいほうの画角に合わせる）
    const radius = 0.5 * Math.sqrt(w * w + h * h + tall * tall);
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * (several ? 0.8 : 0.9);
    // 1 つのときは右手前の斜め上から、並べたときはほぼ正面の斜め上から見下ろす
    const dir = (several ? new THREE.Vector3(0, 0.85, 1) : new THREE.Vector3(0.6, 0.62, 0.8)).normalize();
    this.controls.target.set(0, lo + tall * (several ? 0.9 : 0.42), 0);    // 並べたときは、上に出る名前の札も入るように少し上を見る
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.1, size / 200);
    this.camera.far = size * 40;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = size * 0.15;
    this.controls.maxDistance = size * 8;
    this.controls.update();
    this.requestRender();
  }

  // 計測用: ブロックを作り直して 1 回描き、かかった時間（ms）を返す
  measure(d) {
    const t = performance.now();
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
