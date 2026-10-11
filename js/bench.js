// 性能計測タブ。地形の大きさを変えながら、
//   Python での生成時間 / データの受け渡し時間 / JavaScript での生成時間 / 3D（ブロック）表示の時間
// をくり返し測り、CSV / JSON / Markdown で書き出す。
import { APP_NAME, APP_VERSION } from './version.js';
import { generateJS } from './noise-ref.js';
import { deviceInfo, downloadText, el, fmtMs, mdTable, mean, round, sd, stamp, toCSV } from './util.js';

const SIZES = [16, 32, 64, 128];
const OCTAVES = 4;
const TRIAL_COLUMNS = ['size', 'cells', 'octaves', 'trial', 'python_ms', 'transfer_ms', 'roundtrip_ms', 'js_ms', 'blocks_ms'];

const $ = (id) => document.getElementById(id);

function kv(rows) {
  return el('table', { class: 'kv' }, el('tbody', {}, rows.map(([k, v]) =>
    el('tr', {}, [el('th', { scope: 'row', text: k }), el('td', { text: v ?? '-' })]))));
}

function bytes(n) {
  if (!Number.isFinite(n)) return '-';
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
}

export function initBench({ runner, loadTerrain, onBusy }) {
  let result = null;
  let running = false;
  let view = null;
  let benchCode = null;

  const d = deviceInfo();
  $('benchDevice').replaceChildren(kv([
    ['ブラウザ（User-Agent）', d.userAgent],
    ['OS', d.platform],
    ['CPU コア数', d.cpuCores],
    ['メモリ（目安）', d.memoryGB ? d.memoryGB + ' GB 以上' : '取得できません'],
    ['画面', `${d.screen}（倍率 ${d.pixelRatio}）`],
    ['WebAssembly（Python の実行に必要）', d.webAssembly ? '対応' : '非対応'],
    ['WebGL（3D 表示に必要）', d.webglVersion ? `対応（WebGL ${d.webglVersion}）` : '非対応'],
    ['GPU', d.gpu],
  ]));

  function showStartup() {
    const info = runner.firstInfo;
    if (!info) return;
    const t = info.timings;
    const net = info.resources.reduce((s, r) => s + (r.transferBytes || 0), 0);
    const body = info.resources.reduce((s, r) => s + (r.decodedBytes || 0), 0);
    $('benchStartup').replaceChildren(kv([
      ['Python', `${info.pythonVersion}（Pyodide ${info.pyodideVersion}）`],
      ['ページを開いてから Python が使えるまで', fmtMs(info.pageReadyMs)],
      ['うち Pyodide 本体の読み込みと初期化', fmtMs(t.loadMs)],
      ['うち教材用関数（prelude.py）の読み込み', fmtMs(t.preludeMs)],
      ['Python 関連ファイルの合計サイズ', bytes(body)],
      ['今回ネットワークから受信した量', net > 0 ? bytes(net) : '0（ブラウザに保存済みのものを使用）'],
    ]));
  }
  runner.whenReady().then(showStartup, () => {
    $('benchStartup').replaceChildren(el('p', { class: 'note', text: 'Python を起動できなかったため、計測できません。' }));
  });

  function summarize(trials) {
    return SIZES.map((size) => {
      const t = trials.filter((x) => x.size === size);
      if (!t.length) return null;
      const col = (k) => t.map((x) => x[k]).filter((v) => Number.isFinite(v));
      const py = col('python_ms'), js = col('js_ms');
      return {
        size, cells: size * size, trials: t.length,
        python_mean_ms: round(mean(py), 2), python_sd_ms: round(sd(py), 2),
        python_min_ms: round(Math.min(...py), 2), python_max_ms: round(Math.max(...py), 2),
        transfer_mean_ms: round(mean(col('transfer_ms')), 3),
        roundtrip_mean_ms: round(mean(col('roundtrip_ms')), 2),
        js_mean_ms: round(mean(js), 3),
        python_per_js: js.length && mean(js) > 0 ? round(mean(py) / mean(js), 1) : null,
        blocks_mean_ms: round(mean(col('blocks_ms')), 2),
      };
    }).filter(Boolean);
  }

  function showResult() {
    const s = result.summary;
    const head = ['大きさ', 'マス数', 'Python 生成（平均 ± 標準偏差）', '最小〜最大', '受け渡し', 'JavaScript 生成', 'Python ÷ JS', '3D 表示'];
    $('benchTable').replaceChildren(el('table', { class: 'data' }, [
      el('thead', {}, el('tr', {}, head.map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, s.map((r) => el('tr', {}, [
        el('th', { scope: 'row', text: `${r.size}×${r.size}` }),
        el('td', { text: r.cells.toLocaleString() }),
        el('td', { text: `${fmtMs(r.python_mean_ms)} ± ${r.python_sd_ms}` }),
        el('td', { text: `${r.python_min_ms}〜${r.python_max_ms} ms` }),
        el('td', { text: fmtMs(r.transfer_mean_ms) }),
        el('td', { text: fmtMs(r.js_mean_ms) }),
        el('td', { text: r.python_per_js ? r.python_per_js + ' 倍' : '-' }),
        el('td', { text: fmtMs(r.blocks_mean_ms) }),
      ]))),
    ]));
    $('benchExports').hidden = false;
  }

  function toMarkdown() {
    const r = result;
    const dv = r.device, st = r.startup;
    return [
      '# 性能計測の結果',
      '',
      `- アプリ: ${APP_NAME} v${APP_VERSION}`,
      `- 計測日時: ${r.startedAt}`,
      `- Python: ${st?.pythonVersion}（Pyodide ${st?.pyodideVersion}）`,
      `- 端末: ${dv.userAgent}`,
      `- OS: ${dv.platform ?? '不明'}、CPU コア数: ${dv.cpuCores ?? '不明'}、メモリ: ${dv.memoryGB ? dv.memoryGB + ' GB 以上' : '不明'}`,
      `- 画面: ${dv.screen}（倍率 ${dv.pixelRatio}）、GPU: ${dv.gpu ?? '不明'}`,
      '',
      '## 起動時間',
      '',
      mdTable(['項目', '値'], [
        ['ページを開いてから Python が使えるまで', fmtMs(st?.pageReadyMs)],
        ['Pyodide 本体の読み込みと初期化', fmtMs(st?.timings.loadMs)],
        ['教材用関数の読み込み', fmtMs(st?.timings.preludeMs)],
        ['ネットワークから受信した量', bytes(st?.resources.reduce((s, x) => s + (x.transferBytes || 0), 0))],
      ]),
      '',
      `## 地形生成と表示の時間（オクターブ数 ${r.config.octaves}、各 ${r.config.repeats} 回）`,
      '',
      mdTable(
        ['大きさ', 'マス数', 'Python 平均 (ms)', '標準偏差', '最小', '最大', '受け渡し (ms)', '往復 (ms)', 'JS 平均 (ms)', 'Python÷JS', '3D 表示 (ms)'],
        r.summary.map((x) => [`${x.size}×${x.size}`, x.cells, x.python_mean_ms, x.python_sd_ms, x.python_min_ms, x.python_max_ms,
          x.transfer_mean_ms, x.roundtrip_mean_ms, x.js_mean_ms, x.python_per_js ?? '-', x.blocks_mean_ms]),
      ),
      '',
      '## 項目の意味',
      '',
      '- Python: py/bench.py（1 次元パーリンノイズを 6 つの向きに重ねて地形の高さを作る。ステップ 8 と同じ）を Pyodide で実行した時間。データの受け渡し時間は含まない。',
      '- 受け渡し: Python の配列を JavaScript の Float32Array にコピーする時間。',
      '- 往復: 画面側が実行を依頼してから結果を受け取るまでの時間（Python + 受け渡し + スレッド間通信）。',
      '- JS: 同じアルゴリズムを JavaScript で実行した時間（js/noise-ref.js）。25 ms 以上になるまでくり返し、1 回あたりの時間を求めている。',
      '- 3D 表示: ブロックを並べ、1 回描画し終わるまでの時間。',
      '',
    ].join('\n');
  }

  async function run() {
    if (running) return;
    running = true;
    onBusy(true);
    const repeats = Number($('benchRepeats').value);
    const status = $('benchStatus');
    const button = $('benchRun');
    button.disabled = true;
    $('benchExports').hidden = true;
    const trials = [];
    try {
      status.textContent = 'Python の準備を待っています…';
      await runner.whenReady();
      showStartup();
      if (!benchCode) benchCode = await (await fetch('./py/bench.py')).text();
      if (!view && d.webglVersion) {
        try {
          const { TerrainView } = await loadTerrain();
          $('benchPreview').hidden = false;
          view = new TerrainView($('benchPreview'));
        } catch {
          view = null;
        }
      }
      // スライダーの値は { value, default } の形で渡す（default は py/bench.py の slider() に書いてある最初の値）
      const paramsFor = (size) => ({ size: { value: size, default: 64 }, octaves: { value: OCTAVES, default: 4 } });
      // 1 回目は準備運動（結果には入れない）
      await runner.run(benchCode, paramsFor(16), { timeoutMs: 120000 });
      for (let k = 0; k < 20; k++) generateJS(32, OCTAVES);

      const startedAt = new Date().toISOString();
      for (const size of SIZES) {
        for (let trial = 1; trial <= repeats; trial++) {
          status.textContent = `計測中… ${size}×${size}（${trial} / ${repeats} 回目）`;
          const res = await runner.run(benchCode, paramsFor(size), { timeoutMs: 120000 });
          if (res.error) throw new Error(`${res.error.type}: ${res.error.message}`);
          const out = res.outputs.find((o) => o.kind === 'terrain');
          // 頼んだ大きさの地形が本当に作られたかを確かめる（違っていたら、計測結果として使わない）
          if (!out || out.w !== size || out.h !== size) throw new Error(`地形の大きさが ${size}×${size} になっていません（${out ? `${out.w}×${out.h}` : '出力なし'}）。`);
          // JavaScript は速すぎて 1 回では正確に測れないので、25 ms 以上になるまでくり返して 1 回あたりを求める
          let jsRuns = 0;
          const t0 = performance.now();
          do { generateJS(size, OCTAVES); jsRuns += 1; } while (performance.now() - t0 < 25);
          const jsMs = (performance.now() - t0) / jsRuns;
          const blocksMs = view ? view.measure(out) : null;
          trials.push({
            size, cells: size * size, octaves: OCTAVES, trial,
            python_ms: round(res.timings.pythonMs, 3), transfer_ms: round(res.timings.transferMs, 3),
            roundtrip_ms: round(res.wallMs, 3), js_ms: round(jsMs, 3),
            blocks_ms: round(blocksMs, 3),
          });
          await new Promise((r) => setTimeout(r, 30));   // 画面を更新する間を空ける
        }
      }
      result = {
        app: APP_NAME, version: APP_VERSION, startedAt,
        device: deviceInfo(), startup: runner.firstInfo,
        config: { sizes: SIZES, octaves: OCTAVES, repeats },
        summary: summarize(trials), trials,
      };
      showResult();
      status.textContent = '計測が終わりました。下のボタンで結果を保存できます。';
    } catch (err) {
      status.textContent = '計測を完了できませんでした: ' + (err.message || err);
    } finally {
      running = false;
      button.disabled = false;
      onBusy(false);
    }
  }

  $('benchRun').addEventListener('click', run);
  $('benchCsv').addEventListener('click', () =>
    downloadText(toCSV(TRIAL_COLUMNS, result.trials), `perlin-terrain-bench-${stamp()}.csv`, 'text/csv'));
  $('benchJson').addEventListener('click', () =>
    downloadText(JSON.stringify(result, null, 2), `perlin-terrain-bench-${stamp()}.json`, 'application/json'));
  $('benchMd').addEventListener('click', () =>
    downloadText(toMarkdown(), `perlin-terrain-bench-${stamp()}.md`, 'text/markdown'));
}
