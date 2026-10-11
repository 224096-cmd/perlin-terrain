// 画面全体のまとめ役。ステップの切り替え、コードの実行、結果の表示、記録をつなぐ。
import { APP_VERSION } from './version.js';
import { LESSONS } from './lessons.js';
import { PyRunner } from './runner.js';
import { Logger } from './log.js';
import { PlotView } from './views/plot.js';
import { MapGallery } from './views/heatmap.js';
import { buildTrail } from './trail.js';
import { initBench } from './bench.js';
import { downloadBlob, downloadText, el, fmtMs, round, stamp } from './util.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* 保存できない環境では何もしない */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* 同上 */ } },
};

$('version').textContent = 'v' + APP_VERSION;

const logger = new Logger();
const runner = new PyRunner();
const plotView = new PlotView($('plot'));
const mapGallery = new MapGallery($('maps'));

let terrainModule = null;       // 3D 表示のプログラムは、最初に必要になったときに読み込む
const loadTerrain = () => (terrainModule ??= import('./views/terrain3d.js'));
let terrainView = null;
let terrainFailed = false;
let terrainMode = 'smooth';

const done = new Set(JSON.parse(store.get('perlinTerrain.done', '[]')));
const starters = new Map();     // お手本コード（ファイル名 -> 中身）
let lessonIndex = 0;
let params = {};                // スライダーの現在値（名前 -> 値）
let sliderSpecs = [];
let pendingTrigger = null;      // 実行中に次の実行を頼まれたら、ここに覚えておく
let benchBusy = false;
let errorLine = null;

// ---------- エディタ ----------
const editor = (() => {
  const host = $('editor');
  if (window.CodeMirror) {
    const cm = window.CodeMirror(host, {
      mode: 'python', theme: 'terrain', lineNumbers: true,
      indentUnit: 4, tabSize: 4, indentWithTabs: false,
      matchBrackets: true, autoCloseBrackets: true,
      extraKeys: {
        Tab: (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ', 'end')),
        'Shift-Tab': (c) => c.indentSelection('subtract'),
        'Ctrl-Enter': () => requestRun('shortcut'),
        'Cmd-Enter': () => requestRun('shortcut'),
      },
    });
    cm.getInputField().setAttribute('aria-label', 'Python のコード');
    return {
      get: () => cm.getValue(),
      set: (text) => { cm.setValue(text); cm.clearHistory(); },
      onChange: (fn) => cm.on('change', fn),
      markError(line) {
        if (errorLine !== null) cm.removeLineClass(errorLine, 'background', 'error-line');
        errorLine = null;
        if (line && line >= 1 && line <= cm.lineCount()) {
          errorLine = line - 1;
          cm.addLineClass(errorLine, 'background', 'error-line');
        }
      },
      refresh: () => cm.refresh(),
    };
  }
  // エディタ部品が読み込めなかったときは、ふつうの入力欄を使う
  const ta = el('textarea', { class: 'plain-editor', spellcheck: 'false', 'aria-label': 'Python のコード' });
  host.appendChild(ta);
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); requestRun('shortcut'); }
  });
  return {
    get: () => ta.value,
    set: (text) => { ta.value = text; },
    onChange: (fn) => ta.addEventListener('input', fn),
    markError() {},
    refresh() {},
  };
})();

let saveTimer = 0;
editor.onChange(() => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCode, 400);
});

function saveCode() {
  const lesson = LESSONS[lessonIndex];
  const starter = starters.get(lesson.file);
  if (starter === undefined) return;
  const code = editor.get();
  if (code === starter) store.remove('perlinTerrain.code.' + lesson.id);
  else store.set('perlinTerrain.code.' + lesson.id, code);
}

async function getStarter(file) {
  if (!starters.has(file)) {
    const res = await fetch('./lessons/' + file);
    if (!res.ok) throw new Error(`お手本コード ${file} を読み込めませんでした`);
    starters.set(file, (await res.text()).replace(/\r\n/g, '\n'));
  }
  return starters.get(file);
}

// ---------- ステップの表示 ----------
const trail = buildTrail($('trail'), LESSONS, (i) => openLesson(i, true));

async function openLesson(index, byUser = false) {
  clearTimeout(saveTimer);
  if (starters.has(LESSONS[lessonIndex].file)) saveCode();
  lessonIndex = Math.min(LESSONS.length - 1, Math.max(0, index));
  const lesson = LESSONS[lessonIndex];
  store.set('perlinTerrain.lesson', lesson.id);
  if (byUser) history.replaceState(null, '', '#step' + (lessonIndex + 1));

  $('lessonStep').textContent = `ステップ ${lessonIndex + 1} / ${LESSONS.length}`;
  $('lessonTitle').textContent = lesson.title;
  $('lessonIntro').replaceChildren(...lesson.intro.map((html) => el('p', { html })));
  $('lessonTasks').replaceChildren(...lesson.tasks.map((html) => el('li', { html })));
  $('lessonTerms').replaceChildren(...lesson.terms.flatMap(([term, text]) => [el('dt', { html: term }), el('dd', { html: text })]));
  $('lessonTermsBox').hidden = lesson.terms.length === 0;
  $('prevBtn').disabled = lessonIndex === 0;
  $('nextBtn').disabled = lessonIndex === LESSONS.length - 1;
  trail.update(lessonIndex, done);
  document.title = `${lessonIndex + 1}. ${lesson.title} ― Perlin Terrain`;

  params = {};
  sliderSpecs = [];
  $('sliders').replaceChildren();
  $('sliders').hidden = true;
  showOutputs([], true);
  showError(null);
  showConsole([]);
  $('runStats').hidden = true;
  if (lesson.view3d) setTerrainMode(lesson.view3d, false);

  let starter;
  try {
    starter = await getStarter(lesson.file);
  } catch (err) {
    if (LESSONS[lessonIndex] !== lesson) return;
    editor.set('');
    showError({ type: '読み込みエラー', message: err.message, hint: '通信の状態を確認して、ページを読み込み直してください。', trace: [] });
    return;
  }
  if (LESSONS[lessonIndex] !== lesson) return;    // 読み込み中に別のステップへ移った
  editor.set(store.get('perlinTerrain.code.' + lesson.id, starter));
  editor.refresh();
  logger.add('lesson_open', lesson.id);
  if (byUser) window.scrollTo(0, 0);
  requestRun('open');
}

// ---------- 実行 ----------
function setRunUi() {
  const state = runner.state;
  const status = $('pyStatus');
  status.dataset.state = state;
  status.textContent = {
    loading: 'Python を準備しています…',
    ready: 'Python の準備ができました',
    running: '実行中…',
    failed: 'Python を起動できませんでした',
  }[state];
  $('runBtn').disabled = state === 'failed' || benchBusy;
  $('runBtn').textContent = state === 'loading' ? '準備中…' : '実行する';
  $('stopBtn').hidden = state !== 'running' || benchBusy;
}
runner.addEventListener('status', setRunUi);
setRunUi();
runner.whenReady().catch((err) => {
  showError({
    type: '起動エラー', message: err.message, trace: [],
    hint: 'この教材は WebAssembly に対応した新しいブラウザ（Chrome、Edge、Firefox、Safari の最新版）で動きます。通信の状態を確認して、ページを読み込み直してください。',
  });
  $('outEmpty').hidden = true;
});

function requestRun(trigger) {
  if (benchBusy) return;
  if (runner.busy) {
    // スライダーを続けて動かしたときなどは、いちばん新しい依頼だけを残す
    if (pendingTrigger !== 'button' && pendingTrigger !== 'shortcut') pendingTrigger = trigger;
    return;
  }
  runNow(trigger);
}

async function runNow(trigger) {
  const lesson = LESSONS[lessonIndex];
  const code = editor.get();
  const starter = starters.get(lesson.file);
  const res = await runner.run(code, params);

  if (LESSONS[lessonIndex] === lesson) {
    const t0 = performance.now();
    const hadOutputs = res.outputs.length > 0;
    if (!res.error || hadOutputs) await showOutputs(res.outputs, false);
    else if (!$('outEmpty').hidden) $('outEmpty').textContent = 'エラーを直してから、もう一度実行してください。';
    if (res.sliders && (!res.error || res.sliders.length >= sliderSpecs.length)) syncSliders(res.sliders);
    const renderMs = performance.now() - t0;
    showError(res.error);
    showConsole(res.stdout);
    showStats(res, renderMs);

    const ok = !res.error;
    if (ok && (trigger === 'button' || trigger === 'shortcut' || trigger === 'slider') && !done.has(lesson.id)) {
      done.add(lesson.id);
      store.set('perlinTerrain.done', JSON.stringify([...done]));
      trail.update(lessonIndex, done);
    }
    const counts = {};
    for (const o of res.outputs) counts[o.kind] = (counts[o.kind] || 0) + 1;
    logger.add('run', lesson.id, {
      trigger, ok,
      error_type: res.error ? res.error.type : '',
      error_line: res.error?.line ?? '',
      python_ms: round(res.timings.pythonMs, 2),
      transfer_ms: round(res.timings.transferMs, 3),
      render_ms: round(renderMs, 2),
      total_ms: round(res.wallMs + renderMs, 2),
      code_chars: code.length,
      code_edited: starter !== undefined && code !== starter,
      outputs: Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' '),
      detail: res.error ? String(res.error.message).slice(0, 200) : '',
    });
  }

  if (pendingTrigger) {
    const next = pendingTrigger;
    pendingTrigger = null;
    runNow(next);
  }
}

$('runBtn').addEventListener('click', () => requestRun('button'));
$('stopBtn').addEventListener('click', () => {
  pendingTrigger = null;
  runner.stop();
  logger.add('stop', LESSONS[lessonIndex].id);
});
$('resetBtn').addEventListener('click', async () => {
  const lesson = LESSONS[lessonIndex];
  const starter = await getStarter(lesson.file);
  if (editor.get() !== starter && !confirm('書き換えたコードを消して、お手本に戻します。よろしいですか？')) return;
  editor.set(starter);
  store.remove('perlinTerrain.code.' + lesson.id);
  params = {};
  logger.add('code_reset', lesson.id);
  requestRun('reset');
});
$('prevBtn').addEventListener('click', () => openLesson(lessonIndex - 1, true));
$('nextBtn').addEventListener('click', () => openLesson(lessonIndex + 1, true));

// ---------- 結果の表示 ----------
function showError(error) {
  const box = $('errorBox');
  editor.markError(error?.line ?? null);
  if (!error) { box.hidden = true; box.replaceChildren(); return; }
  const plain = ['Timeout', 'Stopped'].includes(error.type);
  const parts = [el('p', { class: 'error-title', text: plain ? error.message : `${error.type}: ${error.message}` })];
  if (error.line) {
    parts.push(el('p', { class: 'error-where' }, [`${error.line} 行目`, error.source ? el('code', { text: error.source }) : null]));
  }
  if (error.trace && error.trace.length > 1) {
    parts.push(el('p', { class: 'error-trace', text: '呼び出しの流れ: ' + error.trace.map((t) => `${t.line} 行目${t.name === '<module>' ? '' : `（${t.name}）`}`).join(' → ') }));
  }
  if (error.hint) parts.push(el('p', { class: 'error-hint', text: error.hint }));
  box.replaceChildren(...parts);
  box.hidden = false;
}

function showConsole(lines) {
  $('consoleBox').hidden = lines.length === 0;
  $('consoleOut').textContent = lines.join('\n');
}

function showStats(res, renderMs) {
  const p = $('runStats');
  if (res.aborted) { p.hidden = true; return; }
  p.textContent = `Python の計算 ${fmtMs(res.timings.pythonMs)}、画面への受け渡し ${fmtMs(res.timings.transferMs)}、表示 ${fmtMs(renderMs)}`;
  p.hidden = false;
}

async function showOutputs(outputs, opening) {
  const plots = outputs.filter((o) => o.kind === 'plot');
  const maps = outputs.filter((o) => o.kind === 'heatmap');
  const terrain = outputs.filter((o) => o.kind === 'terrain').pop() || null;

  // コードの中で呼ばれた順に並べる
  const order = [...new Set(outputs.map((o) => o.kind))];
  const blocks = { plot: $('plotBlock'), heatmap: $('mapBlock'), terrain: $('terrainBlock') };
  for (const kind of order) $('runStats').before(blocks[kind]);

  $('plotBlock').hidden = plots.length === 0;
  $('mapBlock').hidden = maps.length === 0;
  $('terrainBlock').hidden = !terrain;
  const empty = $('outEmpty');
  empty.hidden = outputs.length > 0;
  if (!outputs.length) {
    empty.textContent = opening
      ? (runner.state === 'ready' || runner.state === 'running' ? '実行しています…' : 'Python の準備ができると、ここに結果が表示されます。')
      : 'このコードは、グラフや地形を表示していません。plot()、heatmap()、terrain() のどれかを呼ぶと、ここに表示されます。';
  }

  if (plots.length) {
    plotView.update(plots);
    const note = $('plotNote');
    note.hidden = !plotView.badValues;
    note.textContent = plotView.badValues ? `数値でない値（nan や inf）が ${plotView.badValues} 個あったので、そこは描いていません。` : '';
  }
  if (maps.length) mapGallery.update(maps);
  if (terrain) await showTerrain(terrain);
}

async function showTerrain(data) {
  const note = $('terrainNote');
  if (terrainFailed) return;
  if (!terrainView) {
    try {
      const { TerrainView } = await loadTerrain();
      terrainView = new TerrainView($('terrain'));
      terrainView.mode = terrainMode;
    } catch (err) {
      terrainFailed = true;
      $('terrain').hidden = true;
      note.hidden = false;
      note.textContent = 'この端末では 3D 表示（WebGL）が使えないため、地形を立体で表示できません。heatmap() を使うと、上から見た地図で確かめられます。';
      return;
    }
  }
  terrainView.setData(data);
  note.hidden = !terrainView.notice;
  note.textContent = terrainView.notice;
}

function setTerrainMode(mode, byUser) {
  terrainMode = mode;
  $('modeSmooth').setAttribute('aria-pressed', String(mode === 'smooth'));
  $('modeBlocks').setAttribute('aria-pressed', String(mode === 'blocks'));
  if (terrainView) {
    terrainView.setMode(mode);
    $('terrainNote').hidden = !terrainView.notice;
    $('terrainNote').textContent = terrainView.notice;
  }
  if (byUser) logger.add('view_mode', LESSONS[lessonIndex].id, { detail: mode });
}
$('modeSmooth').addEventListener('click', () => setTerrainMode('smooth', true));
$('modeBlocks').addEventListener('click', () => setTerrainMode('blocks', true));
$('autoRotate').addEventListener('change', (ev) => terrainView?.setAutoRotate(ev.target.checked));
$('resetView').addEventListener('click', () => terrainView?.resetCamera());

const saveName = (kind) => `perlin-terrain-step${lessonIndex + 1}-${kind}-${stamp()}.png`;
$('plotSave').addEventListener('click', () => plotView.toBlob((b) => b && downloadBlob(b, saveName('graph'))));
$('mapSave').addEventListener('click', () => mapGallery.toBlob((b) => b && downloadBlob(b, saveName('map'))));
$('terrainSave').addEventListener('click', () => terrainView?.toBlob((b) => b && downloadBlob(b, saveName('3d'))));

// ---------- スライダー ----------
function sameSpecs(a, b) {
  return a.length === b.length && a.every((s, i) =>
    s.name === b[i].name && s.min === b[i].min && s.max === b[i].max && s.step === b[i].step);
}

function sliderText(v) {
  return String(Math.round(v * 1e6) / 1e6);
}

// Python のコードが slider() で宣言した内容に合わせて、画面のスライダーを作り直す
function syncSliders(specs) {
  const host = $('sliders');
  const next = {};
  for (const s of specs) next[s.name] = s.value;

  if (sameSpecs(specs, sliderSpecs)) {
    // 形が同じなら部品は作り直さない（動かしている最中のスライダーを壊さないため）。
    // 実行中にさらに動かされていることがあるので、値は画面のスライダーを正とする。
    specs.forEach((s, i) => {
      const input = host.children[i].querySelector('input');
      params[s.name] = Number(input.value);
    });
    return;
  }
  params = next;
  sliderSpecs = specs.map((s) => ({ ...s }));
  host.hidden = specs.length === 0;
  host.replaceChildren(...specs.map((s, i) => {
    const id = 'slider' + i;
    const out = el('output', { for: id, text: sliderText(s.value) });
    const input = el('input', { type: 'range', id, min: s.min, max: s.max, step: s.step, value: s.value });
    let timer = 0;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      params[s.name] = v;
      out.textContent = sliderText(v);
      clearTimeout(timer);
      timer = setTimeout(() => requestRun('slider'), 40);
    });
    input.addEventListener('change', () => {
      logger.add('slider', LESSONS[lessonIndex].id, { slider_name: s.name, slider_value: Number(input.value) });
    });
    return el('div', { class: 'slider-row' }, [el('label', { for: id, text: s.name }), input, out]);
  }));
}

// ---------- タブ ----------
function showTab(name) {
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-pressed', String(b.dataset.tab === name));
  for (const id of ['learn', 'bench', 'log']) $('tab-' + id).hidden = id !== name;
  if (name === 'log') renderLog();
  if (name === 'learn') editor.refresh();
  window.scrollTo(0, 0);
}
for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => showTab(b.dataset.tab));

// ---------- 記録タブ ----------
function renderLog() {
  const s = logger.summary();
  $('logCount').textContent = `いま保存されている記録は ${logger.events.length.toLocaleString()} 件（${logger.sessionCount()} 回分の利用）です。`;
  const head = ['ステップ', '開いた回数', '実行', 'うち手動', 'エラー', 'コード変更後の実行', 'スライダー操作', '作業時間', 'Python 平均'];
  $('logTable').replaceChildren(el('table', { class: 'data' }, [
    el('thead', {}, el('tr', {}, head.map((h) => el('th', { scope: 'col', text: h })))),
    el('tbody', {}, s.map((r) => el('tr', {}, [
      el('th', { scope: 'row', text: `${r.step}. ${r.title}` }),
      el('td', { text: r.opens }), el('td', { text: r.runs }), el('td', { text: r.userRuns }),
      el('td', { text: r.errors }), el('td', { text: r.editedRuns }), el('td', { text: r.sliderMoves }),
      el('td', { text: r.activeMin + ' 分' }), el('td', { text: r.meanPythonMs === null ? '-' : fmtMs(r.meanPythonMs) }),
    ]))),
  ]));
}
$('logCsv').addEventListener('click', () => downloadText(logger.toCSV(), `perlin-terrain-log-${stamp()}.csv`, 'text/csv'));
$('logJson').addEventListener('click', () => downloadText(logger.toJSON(), `perlin-terrain-log-${stamp()}.json`, 'application/json'));
$('logMd').addEventListener('click', () => downloadText(logger.toMarkdown(), `perlin-terrain-log-${stamp()}.md`, 'text/markdown'));
$('logClear').addEventListener('click', () => {
  if (!confirm('この端末に保存されている学習の記録をすべて消します。よろしいですか？')) return;
  logger.clear();
  renderLog();
});

// ---------- 計測タブ ----------
initBench({
  runner,
  loadTerrain,
  onBusy(busy) {
    benchBusy = busy;
    setRunUi();
  },
});

// ---------- 起動 ----------
function initialLesson() {
  const m = /^#step(\d+)$/.exec(location.hash);
  if (m) return Number(m[1]) - 1;
  const saved = LESSONS.findIndex((l) => l.id === store.get('perlinTerrain.lesson'));
  return saved >= 0 ? saved : 0;
}
window.addEventListener('hashchange', () => {
  const m = /^#step(\d+)$/.exec(location.hash);
  if (m && Number(m[1]) - 1 !== lessonIndex) { showTab('learn'); openLesson(Number(m[1]) - 1); }
});
openLesson(initialLesson());

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js?v=' + APP_VERSION, { updateViaCache: 'none' }).catch(() => {});
}
