// 小さな共通関数（ファイル保存・CSV・数値の整形・端末情報）

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function downloadText(text, filename, mime) {
  // CSV は Excel で文字化けしないよう、先頭に BOM（文字コードの目印）を付ける
  const bom = mime === 'text/csv' ? '﻿' : '';
  downloadBlob(new Blob([bom + text], { type: mime + ';charset=utf-8' }), filename);
}

export function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(columns, rows) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function mdTable(headers, rows) {
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|');
  return [
    '| ' + headers.map(esc).join(' | ') + ' |',
    '|' + headers.map(() => '---').join('|') + '|',
    ...rows.map((r) => '| ' + r.map(esc).join(' | ') + ' |'),
  ].join('\n');
}

export function round(v, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

// グラフや凡例に出す数値（長くなりすぎないようにする）
export function fmt(v) {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 100000 || a < 0.001)) return v.toExponential(2);
  if (Number.isInteger(v)) return String(v);
  if (a >= 100) return v.toFixed(1);
  if (a >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

export function fmtMs(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  if (v >= 1000) return (v / 1000).toFixed(2) + ' 秒';
  if (v >= 100) return Math.round(v) + ' ms';
  if (v >= 10) return v.toFixed(1) + ' ms';
  return v.toFixed(2) + ' ms';
}

export function mean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
}

export function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.append(c);
  }
  return node;
}

function webglInfo() {
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    const gl = gl2 || canvas.getContext('webgl');
    if (!gl) return { version: 0, renderer: null };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return { version: gl2 ? 2 : 1, renderer: String(renderer) };
  } catch {
    return { version: 0, renderer: null };
  }
}

let cachedDevice = null;

// 計測結果や記録に添える端末情報（個人を特定する情報は含めない）
export function deviceInfo() {
  if (cachedDevice) return cachedDevice;
  const gl = webglInfo();
  cachedDevice = {
    userAgent: navigator.userAgent,
    platform: navigator.userAgentData?.platform || navigator.platform || null,
    cpuCores: navigator.hardwareConcurrency || null,
    memoryGB: navigator.deviceMemory || null,
    screen: `${screen.width}x${screen.height}`,
    pixelRatio: window.devicePixelRatio,
    language: navigator.language,
    webAssembly: typeof WebAssembly === 'object',
    webWorker: typeof Worker === 'function',
    webglVersion: gl.version,
    gpu: gl.renderer,
    installedApp: window.matchMedia('(display-mode: standalone)').matches,
  };
  return cachedDevice;
}
