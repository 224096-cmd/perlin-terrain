// 学習の記録。操作の履歴をこの端末のブラウザ内（localStorage）だけに保存し、
// CSV / JSON / Markdown で書き出せるようにする。外部には送信しない。
import { APP_NAME, APP_VERSION } from './version.js';
import { LESSONS } from './lessons.js';
import { deviceInfo, mdTable, round, toCSV } from './util.js';

const KEY = 'perlinTerrain.log.v1';
const MAX_EVENTS = 8000;
const IDLE_GAP_MS = 5 * 60 * 1000;   // これより長い空白は「席を外していた」とみなす

export const LOG_COLUMNS = [
  'timestamp', 'session', 'step', 'lesson', 'event', 'trigger', 'ok',
  'error_type', 'error_line', 'python_ms', 'transfer_ms', 'render_ms', 'total_ms',
  'code_chars', 'code_edited', 'outputs', 'slider_name', 'slider_value', 'detail',
];

function stepOf(lessonId) {
  const i = LESSONS.findIndex((l) => l.id === lessonId);
  return i >= 0 ? i + 1 : '';
}

export class Logger {
  constructor() {
    this.session = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.events = [];
    this.enabled = true;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.events = JSON.parse(raw).events || [];
    } catch {
      this.events = [];
    }
    this._dirty = false;
    setInterval(() => this.flush(), 2000);
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
    this.add('session_start', '', { detail: `v${APP_VERSION}` });
  }

  add(event, lessonId = '', data = {}) {
    this.events.push({
      timestamp: new Date().toISOString(),
      session: this.session,
      step: stepOf(lessonId),
      lesson: lessonId,
      event,
      ...data,
    });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this._dirty = true;
  }

  flush() {
    if (!this._dirty) return;
    this._dirty = false;
    try {
      localStorage.setItem(KEY, JSON.stringify({ events: this.events }));
    } catch {
      // 保存できない環境（プライベートブラウズなど）では、ページを開いている間だけ記録する
    }
  }

  clear() {
    this.events = [];
    this._dirty = true;
    this.flush();
    this.add('session_start', '', { detail: `v${APP_VERSION}（記録を消去）` });
  }

  // ステップごとの集計
  summary() {
    const rows = LESSONS.map((l, i) => ({
      step: i + 1, id: l.id, title: l.title,
      opens: 0, runs: 0, userRuns: 0, errors: 0, editedRuns: 0, sliderMoves: 0, resets: 0,
      activeMs: 0, pythonMs: [],
    }));
    const byId = new Map(rows.map((r) => [r.id, r]));
    let prev = null;
    for (const e of this.events) {
      const r = byId.get(e.lesson);
      if (prev && r && prev.session === e.session && prev.lesson === e.lesson) {
        const gap = Date.parse(e.timestamp) - Date.parse(prev.timestamp);
        if (gap > 0 && gap < IDLE_GAP_MS) r.activeMs += gap;
      }
      prev = e;
      if (!r) continue;
      if (e.event === 'lesson_open') r.opens += 1;
      else if (e.event === 'slider') r.sliderMoves += 1;
      else if (e.event === 'code_reset') r.resets += 1;
      else if (e.event === 'run') {
        r.runs += 1;
        if (e.trigger === 'button' || e.trigger === 'shortcut') r.userRuns += 1;
        if (!e.ok) r.errors += 1;
        if (e.code_edited) r.editedRuns += 1;
        if (e.ok && Number.isFinite(e.python_ms)) r.pythonMs.push(e.python_ms);
      }
    }
    for (const r of rows) {
      r.activeMin = round(r.activeMs / 60000, 1);
      r.meanPythonMs = r.pythonMs.length ? round(r.pythonMs.reduce((s, v) => s + v, 0) / r.pythonMs.length, 1) : null;
    }
    return rows;
  }

  sessionCount() {
    return new Set(this.events.map((e) => e.session)).size;
  }

  toCSV() {
    return toCSV(LOG_COLUMNS, this.events);
  }

  toJSON() {
    return JSON.stringify({
      app: APP_NAME,
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      device: deviceInfo(),
      columns: LOG_COLUMNS,
      summary: this.summary().map(({ pythonMs, activeMs, ...rest }) => rest),
      events: this.events,
    }, null, 2);
  }

  toMarkdown() {
    const d = deviceInfo();
    const s = this.summary();
    const first = this.events[0]?.timestamp || '';
    const last = this.events[this.events.length - 1]?.timestamp || '';
    return [
      '# 学習記録のまとめ',
      '',
      `- アプリ: ${APP_NAME} v${APP_VERSION}`,
      `- 書き出し日時: ${new Date().toISOString()}`,
      `- 記録の期間: ${first} 〜 ${last}`,
      `- セッション数（ページを開いた回数）: ${this.sessionCount()}`,
      `- 記録件数: ${this.events.length}`,
      `- 端末: ${d.userAgent}`,
      `- 画面: ${d.screen}（倍率 ${d.pixelRatio}）、CPU コア数: ${d.cpuCores ?? '不明'}、GPU: ${d.gpu ?? '不明'}`,
      '',
      '## ステップごとの集計',
      '',
      mdTable(
        ['ステップ', 'タイトル', '開いた回数', '実行回数', 'うち手動実行', 'エラー回数', 'コード変更後の実行', 'スライダー操作', 'お手本に戻した回数', '作業時間（分）', 'Python 平均時間（ms）'],
        s.map((r) => [r.step, r.title, r.opens, r.runs, r.userRuns, r.errors, r.editedRuns, r.sliderMoves, r.resets, r.activeMin, r.meanPythonMs ?? '-']),
      ),
      '',
      '## 項目の意味',
      '',
      '- 実行回数: ステップを開いたときの自動実行、スライダー操作による再実行を含む。',
      '- うち手動実行: 「実行」ボタンまたは Ctrl+Enter による実行。',
      '- エラー回数: エラーで終わった実行の数（「止める」ボタンでの中断、時間切れを含む）。',
      '- コード変更後の実行: お手本と異なるコードでの実行。',
      '- 作業時間: 同じステップ内で連続する記録の間隔を合計したもの（5 分以上の空白は除く）。',
      '',
    ].join('\n');
  }
}
