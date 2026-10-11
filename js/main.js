// 画面全体のまとめ役。ステップの切り替え、コードの編集と実行、結果の表示、記録をつなぐ。
import { APP_VERSION } from './version.js';
import { LESSONS } from './lessons.js';
import { FIGURES } from './figures.js';
import { PyRunner } from './runner.js';
import { Logger } from './log.js';
import { PlotView } from './views/plot.js';
import { MapGallery } from './views/heatmap.js';
import { BlockEditor } from './blocks/view.js';
import { parseBlocks } from './blocks/model.js';
import { findSliderDefault, logicalLines } from './blocks/pytokens.js';
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
  json(key, fallback) { try { return JSON.parse(this.get(key)) ?? fallback; } catch { return fallback; } },
};
const CODE_KEY = 'perlinTerrain.code3.';      // 書き換えたコードの保存先（ステップごと）

$('version').textContent = 'v' + APP_VERSION;

const logger = new Logger();
const runner = new PyRunner();
const plotView = new PlotView($('plot'));
const mapGallery = new MapGallery($('maps'));

let terrainModule = null;       // 3D 表示のプログラムは、最初に必要になったときに読み込む
const loadTerrain = () => (terrainModule ??= import('./views/terrain3d.js'));
let terrainView = null;
let terrainFailed = false;

const done = new Set(store.json('perlinTerrain.done', []));
const taskChecks = store.json('perlinTerrain.tasks', {});
const starters = new Map();     // お手本コード（ファイル名 -> 中身）
let lessonIndex = 0;
let params = {};                // コードに書き戻せなかったスライダーの値（名前 -> { value, default }）
let sliderSpecs = [];
let pendingTrigger = null;      // 実行中に次の実行を頼まれたら、ここに覚えておく
let benchBusy = false;
let lastRun = null;             // 直前の実行（コード・結果の特徴）。「結果が変わったか」を伝えるのに使う
let lastRunAt = 0;
let lastTrigger = '';
let editKinds = new Set();      // 前回の実行以降に行った編集の種類（記録用）

// ---------- コードの編集（ブロック表示とテキスト表示） ----------
let editorMode = store.get('perlinTerrain.editor', 'blocks') === 'text' ? 'text' : 'blocks';
let silentChange = false;       // プログラムからの書き換えで「編集された」と数えないための印

const blockEd = new BlockEditor($('blockEditor'), { onChange: (kind) => onEdited(kind) });

const textEd = (() => {
  const host = $('editor');
  let errorLine = null;
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
    cm.on('change', () => { if (!silentChange) onEdited('text'); });
    return {
      get: () => cm.getValue(),
      set(text) { silentChange = true; cm.setValue(text); cm.clearHistory(); silentChange = false; },
      replace(start, length, text) {
        silentChange = true;
        cm.replaceRange(text, cm.posFromIndex(start), cm.posFromIndex(start + length), '+slider');
        silentChange = false;
      },
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
  ta.addEventListener('input', () => onEdited('text'));
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); requestRun('shortcut'); }
  });
  return {
    get: () => ta.value,
    set: (text) => { ta.value = text; },
    replace(start, length, text) { ta.value = ta.value.slice(0, start) + text + ta.value.slice(start + length); },
    markError() {},
    refresh() {},
  };
})();

function getCode() {
  return editorMode === 'blocks' ? blockEd.getCode() : textEd.get();
}

function showEditorNote(text) {
  $('editorNote').hidden = !text;
  $('editorNote').textContent = text || '';
}

function applyEditorMode() {
  const blocks = editorMode === 'blocks';
  $('modeBlocksEd').setAttribute('aria-pressed', String(blocks));
  $('modeTextEd').setAttribute('aria-pressed', String(!blocks));
  $('blockEditor').hidden = !blocks;
  $('editor').hidden = blocks;
  $('undoBtn').hidden = !blocks;
  $('redoBtn').hidden = !blocks;
  const lesson = LESSONS[lessonIndex];
  $('palette').hidden = !blocks || !(lesson.snippets && lesson.snippets.length);
  if (!blocks) textEd.refresh();
  updateUndoButtons();
}

function updateUndoButtons() {
  $('undoBtn').disabled = !blockEd.canUndo;
  $('redoBtn').disabled = !blockEd.canRedo;
}

// コードを両方のエディタに入れる。ブロックにできないコードのときはテキスト表示にする。
function loadCode(text) {
  textEd.set(text);
  showEditorNote('');
  const wanted = store.get('perlinTerrain.editor', 'blocks') === 'text' ? 'text' : 'blocks';
  const res = blockEd.load(text);
  if (wanted === 'blocks' && !res.ok) {
    editorMode = 'text';
    showEditorNote(`保存されていたコードは、そのままではブロック表示にできません（${res.line} 行目: ${res.reason}）。テキスト表示で開いています。`);
  } else {
    editorMode = wanted;
  }
  applyEditorMode();
}

function switchEditor(mode) {
  if (mode === editorMode) return;
  if (mode === 'text') {
    textEd.set(blockEd.getCode());
  } else {
    const res = blockEd.load(textEd.get());
    if (!res.ok) {
      showEditorNote(`いまのコードは、ブロック表示にできません（${res.line} 行目: ${res.reason}）。テキストで直すか、「お手本に戻す」を押してください。`);
      return;
    }
  }
  showEditorNote('');
  editorMode = mode;
  store.set('perlinTerrain.editor', mode);
  applyEditorMode();
  logger.add('editor_mode', LESSONS[lessonIndex].id, { detail: mode, editor: mode });
}
$('modeBlocksEd').addEventListener('click', () => switchEditor('blocks'));
$('modeTextEd').addEventListener('click', () => switchEditor('text'));
$('undoBtn').addEventListener('click', () => blockEd.undo());
$('redoBtn').addEventListener('click', () => blockEd.redo());

$('autoRun').checked = store.get('perlinTerrain.autoRun', '1') !== '0';
$('autoRun').addEventListener('change', (ev) => store.set('perlinTerrain.autoRun', ev.target.checked ? '1' : '0'));

let saveTimer = 0;
let autoTimer = 0;

// コードが書き換えられたとき（ブロックの操作、数字の変更、テキストの入力）
function onEdited(kind) {
  // 並び替え・追加・削除などは 1 回ずつ記録する。数字の書き換えは、続けて打った分を 1 回にまとめる
  if (kind !== 'text' && !(editKinds.has(kind) && (kind === 'number' || kind === 'name'))) {
    logger.add('block_edit', LESSONS[lessonIndex].id, { detail: kind, editor: editorMode });
  }
  editKinds.add(kind);
  updateUndoButtons();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCode, 400);
  if (!$('autoRun').checked) {
    setRunNote('pending', 'コードを書き換えました。「実行する」を押すと結果に反映されます。');
    return;
  }
  clearTimeout(autoTimer);
  // 文字を打っている途中で何度も実行しないよう、テキストは少し待ってから実行する
  const delay = kind === 'text' ? 900 : kind === 'number' ? 250 : 60;
  autoTimer = setTimeout(() => {
    if (kind === 'text' && !parseBlocks(textEd.get()).ok) return;   // 書きかけ（かっこが開いたまま等）なら待つ
    requestRun('edit');
  }, delay);
}

function saveCode() {
  const lesson = LESSONS[lessonIndex];
  const starter = starters.get(lesson.file);
  if (starter === undefined) return;
  const code = getCode();
  if (code === starter) store.remove(CODE_KEY + lesson.id);
  else store.set(CODE_KEY + lesson.id, code);
}

async function getStarter(file) {
  if (!starters.has(file)) {
    const res = await fetch('./lessons/' + file);
    if (!res.ok) throw new Error(`お手本コード ${file} を読み込めませんでした`);
    starters.set(file, (await res.text()).replace(/\r\n/g, '\n'));
  }
  return starters.get(file);
}

// ---------- 使い方の案内 ----------
$('guide').hidden = store.get('perlinTerrain.guide') === 'closed';
$('guideClose').addEventListener('click', () => {
  $('guide').hidden = true;
  store.set('perlinTerrain.guide', 'closed');
});

// ---------- ステップの表示 ----------
const trail = buildTrail($('trail'), LESSONS, (i) => openLesson(i, true));

// やってみよう: 課題を 1 つずつ表示する（番号で切り替え）。コードと結果のすぐ上に置く。
let taskIndex = 0;

function renderTasks(lesson, index = null) {
  const checks = (taskChecks[lesson.id] ||= []);
  if (index === null) {
    // 最初は、まだ「やった」が付いていない最初の課題を出す
    const firstOpen = lesson.tasks.findIndex((_, k) => !checks[k]);
    index = firstOpen >= 0 ? firstOpen : 0;
  }
  taskIndex = index;
  $('taskChips').replaceChildren(...lesson.tasks.map((_, k) => el('button', {
    type: 'button',
    class: 'task-chip' + (checks[k] ? ' done' : ''),
    'aria-pressed': String(k === taskIndex),
    'aria-label': `課題 ${k + 1}${checks[k] ? '（やった）' : ''}`,
    text: String(k + 1),
    onclick: () => renderTasks(lesson, k),
  })));
  const task = lesson.tasks[taskIndex];
  $('taskQ').innerHTML = `<b class="task-no">課題 ${taskIndex + 1}</b>${task.q}`;
  $('taskAText').innerHTML = task.a;
  $('taskA').open = false;
  $('taskDone').checked = !!checks[taskIndex];
}

$('taskDone').addEventListener('change', (ev) => {
  const lesson = LESSONS[lessonIndex];
  const list = (taskChecks[lesson.id] ||= []);
  list[taskIndex] = ev.target.checked;
  store.set('perlinTerrain.tasks', JSON.stringify(taskChecks));
  logger.add('task_check', lesson.id, { detail: `task${taskIndex + 1}=${ev.target.checked ? 1 : 0}` });
  $('taskChips').children[taskIndex]?.classList.toggle('done', ev.target.checked);
});
$('taskA').addEventListener('toggle', (ev) => {
  if (ev.target.open) logger.add('task_answer', LESSONS[lessonIndex].id, { detail: `task${taskIndex + 1}` });
});

function renderPalette(lesson) {
  const items = (lesson.snippets || []).map((sn) => {
    const chip = el('button', { type: 'button', class: 'palette-item', title: sn.code.trim() }, [
      el('span', { class: 'palette-name', text: sn.label }),
      el('code', { text: sn.code.trim().split('\n')[0] + (sn.code.trim().includes('\n') ? ' …' : '') }),
    ]);
    blockEd.attachPaletteItem(chip, sn.code);
    return chip;
  });
  $('paletteItems').replaceChildren(...items);
}

async function openLesson(index, byUser = false) {
  clearTimeout(saveTimer);
  clearTimeout(autoTimer);
  if (starters.has(LESSONS[lessonIndex].file)) saveCode();
  lessonIndex = Math.min(LESSONS.length - 1, Math.max(0, index));
  const lesson = LESSONS[lessonIndex];
  store.set('perlinTerrain.lesson', lesson.id);
  if (byUser) history.replaceState(null, '', '#step' + (lessonIndex + 1));

  $('lessonStep').textContent = `ステップ ${lessonIndex + 1} / ${LESSONS.length}`;
  $('lessonTitle').textContent = lesson.title;
  $('lessonIntro').replaceChildren(...lesson.intro.map((html) => el('p', { html })));
  const fig = $('lessonFigure');
  fig.hidden = !lesson.figure;
  fig.innerHTML = lesson.figure ? FIGURES[lesson.figure]() : '';
  $('lessonTerms').replaceChildren(...lesson.terms.flatMap(([term, text]) => [el('dt', { html: term }), el('dd', { html: text })]));
  renderTasks(lesson);
  renderPalette(lesson);

  const prev = LESSONS[lessonIndex - 1];
  const next = LESSONS[lessonIndex + 1];
  $('prevBtn').disabled = !prev;
  $('nextBtn').disabled = !next;
  $('prevTitle').textContent = prev ? `${lessonIndex}. ${prev.title}` : '';
  $('nextTitle').textContent = next ? `${lessonIndex + 2}. ${next.title}` : 'これが最後のステップです';
  trail.update(lessonIndex, done);
  document.title = `${lessonIndex + 1}. ${lesson.title} ― Perlin Terrain`;

  params = {};
  sliderSpecs = [];
  lastRun = null;
  editKinds = new Set();
  $('sliders').replaceChildren();
  $('sliders').hidden = true;
  plotView.clearGhost();
  showOutputs([]);
  showError(null);
  showConsole([]);
  $('runStats').hidden = true;
  setRunNote('idle', runner.state === 'loading' ? 'Python の準備ができると、ここに結果が表示されます。' : '実行しています…');
  blockEd.setMeta({ fold: lesson.fold, focus: lesson.focus });

  let starter;
  try {
    starter = await getStarter(lesson.file);
  } catch (err) {
    if (LESSONS[lessonIndex] !== lesson) return;
    loadCode('');
    showError({ type: '読み込みエラー', message: err.message, hint: '通信の状態を確認して、ページを読み込み直してください。', trace: [] });
    return;
  }
  if (LESSONS[lessonIndex] !== lesson) return;    // 読み込み中に別のステップへ移った
  loadCode(store.get(CODE_KEY + lesson.id, starter));
  blockEd.scrollToFocus();
  logger.add('lesson_open', lesson.id, { editor: editorMode });
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
  $('runBtn').textContent = state === 'loading' ? '準備中…' : state === 'running' ? '実行中…' : '実行する';
  $('stopBtn').hidden = state !== 'running' || benchBusy;
}
runner.addEventListener('status', setRunUi);
setRunUi();
runner.whenReady().catch((err) => {
  showError({
    type: '起動エラー', message: err.message, trace: [],
    hint: 'この教材は WebAssembly に対応した新しいブラウザ（Chrome、Edge、Firefox、Safari の最新版）で動きます。通信の状態を確認して、ページを読み込み直してください。',
  });
  setRunNote('error', 'Python を起動できなかったため、実行できません。');
});

// 実行結果の上に出す 1 行の案内
function setRunNote(kind, text) {
  const note = $('runNote');
  note.dataset.kind = kind;
  note.textContent = text;
}

function flashOutputs() {
  const panel = $('outPanel');
  panel.classList.remove('ran');
  void panel.offsetWidth;          // アニメーションを最初からやり直すための読み出し
  panel.classList.add('ran');
}

// 結果の特徴を 1 つの数にまとめる（前回と同じ結果かどうかを比べるため）
function signature(res) {
  let h = 2166136261;
  const mix = (v) => { h = Math.imul(h ^ v, 16777619) >>> 0; };
  const mixText = (s) => { for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i)); };
  for (const o of res.outputs) {
    mixText(o.kind + (o.label || '') + (o.w || '') + 'x' + (o.h || '') + (o.sea ?? '') + (o.palette || []).join(','));
    for (const key of ['ys', 'xs', 'data', 'colors']) {
      const a = o[key];
      if (!a) continue;
      const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      for (let i = 0; i < bytes.length; i++) mix(bytes[i]);
    }
  }
  mixText(res.stdout.join('\n'));
  mixText(res.error ? res.error.type + res.error.message + res.error.line : '');
  return h;
}

function requestRun(trigger) {
  if (benchBusy) return;
  clearTimeout(autoTimer);
  if (runner.busy) {
    // スライダーを続けて動かしたときなどは、いちばん新しい依頼だけを残す
    if (pendingTrigger !== 'button' && pendingTrigger !== 'shortcut') pendingTrigger = trigger;
    return;
  }
  runNow(trigger);
}

async function runNow(trigger) {
  const lesson = LESSONS[lessonIndex];
  const code = getCode();
  const starter = starters.get(lesson.file);
  const edits = [...editKinds].join(' ');
  editKinds = new Set();
  const res = await runner.run(code, params);

  if (LESSONS[lessonIndex] === lesson) {
    const t0 = performance.now();
    const sig = signature(res);
    const sameCode = lastRun && lastRun.code === code && lastRun.params === JSON.stringify(params);
    const sameResult = lastRun && lastRun.sig === sig;
    // スライダーを動かし続けている間や、数字を続けて打っている間は「ひとつ前の結果」を入れ替えない。
    // 操作の種類が変わったとき、または少し間が空いたときに、いま出ている結果を「ひとつ前」として残す。
    const newBurst = trigger !== lastTrigger || performance.now() - lastRunAt > 1500
      || trigger === 'button' || trigger === 'shortcut';
    lastRunAt = performance.now();
    lastTrigger = trigger;

    let displayError = null;
    try {
      if (!res.error || res.outputs.length > 0) await showOutputs(res.outputs, newBurst);
    } catch (err) {
      displayError = err;     // 計算はできたが、画面に描く途中で失敗した
    }
    if (res.sliders && (!res.error || res.sliders.length >= sliderSpecs.length)) syncSliders(res.sliders, trigger);
    const renderMs = performance.now() - t0;
    showError(res.error);
    showConsole(res.stdout);
    showStats(res, renderMs);

    const time = new Date().toLocaleTimeString('ja-JP');
    if (displayError) {
      setRunNote('error', `計算は終わりましたが、結果を画面に表示できませんでした（${displayError.message}）。ページを読み込み直してみてください。`);
    } else if (res.error) {
      setRunNote('error', res.aborted ? res.error.message : `エラーで止まりました（${time}）。コードの下の説明を見て直しましょう。`);
    } else if (!lastRun || trigger === 'open' || trigger === 'reset') {
      setRunNote('ok', `実行しました（${time}）。数字を書き換えたり、ブロックを動かしたりすると、結果が変わります。`);
    } else if (!sameResult) {
      setRunNote('changed', `実行しました（${time}）。結果が変わりました。`);
    } else if (sameCode) {
      setRunNote('same', `実行しました（${time}）。コードが前回と同じなので、結果も同じです。数字を書き換えるか、ブロックを動かしてみましょう。`);
    } else {
      setRunNote('same', `実行しました（${time}）。コードは変わりましたが、結果は前回と同じでした。`);
    }
    if (trigger === 'button' || trigger === 'shortcut' || (!sameResult && trigger !== 'slider' && trigger !== 'open')) flashOutputs();
    if (!res.aborted) lastRun = { code, params: JSON.stringify(params), sig };
    $('runNote').dataset.count = String(Number($('runNote').dataset.count || 0) + 1);   // 何回目の実行か

    const ok = !res.error;
    if (ok && trigger !== 'open' && trigger !== 'reset' && !done.has(lesson.id)) {
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
      detail: res.error ? String(res.error.message).slice(0, 200) : edits,
      editor: editorMode,
      result_changed: lastRun ? !sameResult : '',
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
  if (getCode() !== starter && !confirm('書き換えたコードを消して、お手本に戻します。よろしいですか？')) return;
  store.remove(CODE_KEY + lesson.id);
  blockEd.setMeta({ fold: lesson.fold, focus: lesson.focus });
  loadCode(starter);
  params = {};
  editKinds = new Set();
  logger.add('code_reset', lesson.id);
  requestRun('reset');
});
$('prevBtn').addEventListener('click', () => openLesson(lessonIndex - 1, true));
$('nextBtn').addEventListener('click', () => openLesson(lessonIndex + 1, true));
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && !$('tab-learn').hidden && !ev.target.closest?.('.CodeMirror, .plain-editor')) {
    ev.preventDefault();
    requestRun('shortcut');
  }
});

// ---------- 結果の表示 ----------
function showError(error) {
  const box = $('errorBox');
  textEd.markError(error?.line ?? null);
  blockEd.markError(error?.line ?? null);
  if (!error) { box.hidden = true; box.replaceChildren(); return; }
  const plain = ['Timeout', 'Stopped'].includes(error.type);
  const parts = [];
  if (plain) {
    parts.push(el('p', { class: 'error-title', text: error.message }));
  } else if (error.message_ja) {
    parts.push(el('p', { class: 'error-title', text: error.message_ja }));
    parts.push(el('p', { class: 'error-original', text: `Python の表示: ${error.type}: ${error.message}` }));
  } else {
    parts.push(el('p', { class: 'error-title', text: `${error.type}: ${error.message}` }));
  }
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
  p.textContent = `かかった時間: Python の計算 ${fmtMs(res.timings.pythonMs)}、画面への受け渡し ${fmtMs(res.timings.transferMs)}、表示 ${fmtMs(renderMs)}`;
  p.hidden = false;
}

async function showOutputs(outputs, newBurst = true) {
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

  if (plots.length) {
    plotView.update(plots, { keepGhost: !newBurst });
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

$('autoRotate').addEventListener('change', (ev) => terrainView?.setAutoRotate(ev.target.checked));
$('resetView').addEventListener('click', () => terrainView?.resetCamera());
$('ghostToggle').addEventListener('change', (ev) => plotView.setGhostVisible(ev.target.checked));

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

// スライダーの値を、コードの slider("名前", 最小, 最大, 値) の「値」に書き戻す。
// 書き戻せたら true（値が数値そのものではなく式のときなどは false）
function writeSliderToCode(name, text) {
  if (editorMode === 'blocks') return blockEd.setSliderDefault(name, text);
  const src = textEd.get();
  for (const line of logicalLines(src).lines) {
    const token = findSliderDefault(line.tokens, name);
    if (token) {
      textEd.replace(token.start, token.text.length, text);
      return true;
    }
  }
  return false;
}

// Python のコードが slider() で宣言した内容に合わせて、画面のスライダーをそろえる
function syncSliders(specs, trigger) {
  const host = $('sliders');
  if (sameSpecs(specs, sliderSpecs)) {
    // 形が同じなら部品は作り直さない（動かしている最中のスライダーを壊さないため）。
    // スライダー操作による実行のときは、画面の値のほうが新しいことがあるので触らない。
    if (trigger !== 'slider') {
      specs.forEach((s, i) => {
        const row = host.children[i];
        const input = row.querySelector('input');
        input.value = s.value;
        row.querySelector('output').textContent = sliderText(s.value);
      });
    }
    sliderSpecs = specs.map((s) => ({ ...s }));
    return;
  }
  sliderSpecs = specs.map((s) => ({ ...s }));
  for (const name of Object.keys(params)) if (!specs.some((s) => s.name === name)) delete params[name];
  host.hidden = specs.length === 0;
  host.replaceChildren(...specs.map((s, i) => {
    const id = 'slider' + i;
    const out = el('output', { for: id, text: sliderText(s.value) });
    const input = el('input', { type: 'range', id, min: s.min, max: s.max, step: s.step, value: s.value });
    let timer = 0;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      const text = sliderText(v);
      out.textContent = text;
      if (writeSliderToCode(s.name, text)) {
        delete params[s.name];
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveCode, 400);
      } else {
        const spec = sliderSpecs.find((x) => x.name === s.name) || s;
        params[s.name] = { value: v, default: spec.default };
      }
      clearTimeout(timer);
      timer = setTimeout(() => requestRun('slider'), 40);
    });
    input.addEventListener('change', () => {
      logger.add('slider', LESSONS[lessonIndex].id, { slider_name: s.name, slider_value: Number(input.value), editor: editorMode });
    });
    return el('div', { class: 'slider-row' }, [el('label', { for: id, text: s.name }), input, out]);
  }));
}

// ---------- タブ ----------
function showTab(name) {
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-pressed', String(b.dataset.tab === name));
  for (const id of ['learn', 'bench', 'log']) $('tab-' + id).hidden = id !== name;
  if (name === 'log') renderLog();
  if (name === 'learn') textEd.refresh();
  window.scrollTo(0, 0);
}
for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => showTab(b.dataset.tab));

// ---------- 記録タブ ----------
function renderLog() {
  const s = logger.summary();
  $('logCount').textContent = `いま保存されている記録は ${logger.events.length.toLocaleString()} 件（${logger.sessionCount()} 回分の利用）です。`;
  const head = ['ステップ', '開いた回数', '実行', 'うち手動', 'うち編集で自動', 'エラー', 'ブロック操作', 'スライダー操作', 'やった課題', '作業時間', 'Python 平均'];
  $('logTable').replaceChildren(el('table', { class: 'data' }, [
    el('thead', {}, el('tr', {}, head.map((h) => el('th', { scope: 'col', text: h })))),
    el('tbody', {}, s.map((r) => el('tr', {}, [
      el('th', { scope: 'row', text: `${r.step}. ${r.title}` }),
      el('td', { text: r.opens }), el('td', { text: r.runs }), el('td', { text: r.userRuns }), el('td', { text: r.editRuns }),
      el('td', { text: r.errors }), el('td', { text: r.blockEdits }), el('td', { text: r.sliderMoves }),
      el('td', { text: `${r.tasksDone} / ${r.tasksTotal}` }),
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
