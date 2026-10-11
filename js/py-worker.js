// Python（Pyodide）を動かす Web Worker。
// 画面とは別のスレッドで動くので、計算が長引いても画面は固まらない。
// 画面側（runner.js）とは postMessage でやり取りする。

const MAX_STDOUT_LINES = 400;
const MAX_STDOUT_CHARS = 40000;

let runUser = null;         // Python 側の _run 関数
let outputs = [];           // 今回の実行で plot / terrain から届いたデータ
let stdout = [];
let stdoutChars = 0;
let stdoutCut = false;
let emitMs = 0;             // Python → JavaScript のデータ受け渡しにかかった時間
const queue = [];           // 起動前に届いた依頼
let ready = false;

self.onmessage = (ev) => {
  if (!ready) queue.push(ev.data);
  else handle(ev.data);
};

function pushStdout(text) {
  if (stdoutCut) return;
  if (stdout.length >= MAX_STDOUT_LINES || stdoutChars + text.length > MAX_STDOUT_CHARS) {
    stdoutCut = true;
    stdout.push('…（出力が多いので、ここから先は省略しました）');
    return;
  }
  stdout.push(text);
  stdoutChars += text.length;
}

// Python の array.array の中身を、JavaScript の型付き配列にコピーする
function copyBuffer(proxy, type) {
  if (proxy === undefined || proxy === null) return null;
  const view = proxy.getBuffer(type);
  try {
    return view.data.slice();
  } finally {
    view.release();
  }
}

// Python 側の plot() / terrain() から呼ばれる
function emit(kind, metaJson, a, b) {
  const t = performance.now();
  const meta = JSON.parse(metaJson);
  if (kind === 'plot') {
    outputs.push({ kind, label: meta.label, dots: meta.dots, width: meta.width, ys: copyBuffer(a, 'f32'), xs: copyBuffer(b, 'f32') });
  } else if (kind === 'terrain') {
    outputs.push({ kind, w: meta.w, h: meta.h, sea: meta.sea, palette: meta.palette, data: copyBuffer(a, 'f32'), colors: copyBuffer(b, 'u8') });
  }
  emitMs += performance.now() - t;
}

function handle(msg) {
  if (msg.type !== 'run') return;
  outputs = [];
  stdout = [];
  stdoutChars = 0;
  stdoutCut = false;
  emitMs = 0;
  const t0 = performance.now();
  let result;
  try {
    result = JSON.parse(runUser(msg.code, JSON.stringify(msg.params || {})));
  } catch (err) {
    // Python 自体が続けられなくなった場合（メモリ不足など）
    result = {
      sliders: [],
      error: { type: 'InternalError', message: String(err && err.message ? err.message : err), line: null, source: '', hint: 'Python を動かす仕組みの中でエラーが起きました。もう一度実行してみてください。', trace: [] },
      fatal: true,
    };
  }
  const totalMs = performance.now() - t0;
  const transfer = [];
  for (const o of outputs) {
    for (const key of ['ys', 'xs', 'data', 'colors']) {
      if (o[key]) transfer.push(o[key].buffer);
    }
  }
  self.postMessage({
    type: 'result',
    id: msg.id,
    error: result.error,
    fatal: !!result.fatal,
    sliders: result.sliders,
    outputs,
    stdout,
    timings: { pythonMs: totalMs - emitMs, transferMs: emitMs },
  }, transfer);
  outputs = [];
}

async function init() {
  const t0 = performance.now();
  const base = new URL('../vendor/pyodide/', import.meta.url).href;
  const { loadPyodide, version } = await import('../vendor/pyodide/pyodide.mjs');
  const t1 = performance.now();
  const pyodide = await loadPyodide({ indexURL: base, stdout: pushStdout, stderr: pushStdout });
  const t2 = performance.now();

  const src = await (await fetch(new URL('../py/prelude.py', import.meta.url))).text();
  const ns = pyodide.globals.get('dict')();
  pyodide.runPython(src, { globals: ns, filename: 'prelude.py' });
  ns.set('_emit', emit);
  runUser = ns.get('_run');
  const pythonVersion = pyodide.runPython('import sys; sys.version.split()[0]');
  const t3 = performance.now();

  // 通信量の記録（transferSize が 0 のファイルは、ブラウザの保存分から読まれた）
  const resources = performance.getEntriesByType('resource')
    .filter((e) => /pyodide|python_stdlib|prelude/.test(e.name))
    .map((e) => ({
      file: e.name.split('/').pop(),
      transferBytes: e.transferSize,
      bodyBytes: e.encodedBodySize,
      decodedBytes: e.decodedBodySize,
      ms: Math.round(e.duration),
    }));

  ready = true;
  self.postMessage({
    type: 'ready',
    info: {
      pyodideVersion: version,
      pythonVersion,
      timings: { importMs: t1 - t0, loadMs: t2 - t1, preludeMs: t3 - t2, totalMs: t3 - t0 },
      resources,
    },
  });
  while (queue.length) handle(queue.shift());
}

init().catch((err) => {
  self.postMessage({ type: 'fatal', message: String(err && err.message ? err.message : err) });
});
