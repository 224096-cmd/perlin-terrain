// Python 実行の窓口（画面側）。Worker を起動し、実行の依頼・停止・時間切れを管理する。
// 無限ループなどで止まらないコードは Worker ごと止めて、新しい Worker を起動し直す。

export class PyRunner extends EventTarget {
  constructor() {
    super();
    this.state = 'loading';     // loading | ready | running | failed
    this.info = null;           // 起動時の情報（バージョン、起動時間など）
    this.startCount = 0;
    this.firstInfo = null;      // ページを開いて最初の起動の情報（計測用）
    this._current = null;
    this._busy = false;
    this._nextId = 1;
    this._boot();
  }

  _setState(state, message = '') {
    this.state = state;
    this.message = message;
    this.dispatchEvent(new CustomEvent('status', { detail: { state, message } }));
  }

  _boot() {
    this.startCount += 1;
    this._setState('loading');
    const startedAt = performance.now();
    this._readyPromise = new Promise((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });
    this._readyPromise.catch(() => {});
    let worker;
    try {
      worker = new Worker(new URL('./py-worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      this._fail(String(err.message || err));
      return;
    }
    this.worker = worker;
    worker.onmessage = (ev) => {
      if (worker !== this.worker) return;
      const msg = ev.data;
      if (msg.type === 'ready') {
        this.info = {
          ...msg.info,
          bootMs: performance.now() - startedAt,
          startNumber: this.startCount,
          // ページを開き始めてから Python が使えるようになるまでの時間（最初の起動のときだけ意味がある）
          pageReadyMs: performance.now(),
        };
        if (!this.firstInfo) this.firstInfo = this.info;
        this._setState('ready');
        this._readyResolve(this.info);
      } else if (msg.type === 'result') {
        const cur = this._current;
        if (!cur || cur.id !== msg.id) return;
        this._finish({ ...msg, wallMs: performance.now() - cur.startedAt });
        if (msg.fatal) this._restart();
      } else if (msg.type === 'fatal') {
        this._fail(msg.message);
      }
    };
    worker.onerror = (ev) => {
      if (worker !== this.worker) return;
      if (this.state === 'loading') this._fail(ev.message || 'Worker を起動できませんでした');
    };
  }

  _fail(message) {
    this._setState('failed', message);
    this._readyReject(new Error(message));
    if (this._current) {
      this._finish(this._abortResult('StartError', 'Python を起動できませんでした: ' + message, ''));
    }
  }

  _restart() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this._boot();
  }

  whenReady() {
    return this._readyPromise;
  }

  get busy() {
    return this._busy;
  }

  _abortResult(type, message, hint) {
    return {
      type: 'result',
      error: { type, message, line: null, source: '', hint, trace: [] },
      sliders: null,
      outputs: [],
      stdout: [],
      timings: { pythonMs: 0, transferMs: 0 },
      wallMs: this._current ? performance.now() - this._current.startedAt : 0,
      aborted: true,
    };
  }

  _finish(result) {
    const cur = this._current;
    if (!cur) return;
    clearTimeout(cur.timer);
    this._current = null;
    this._busy = false;
    if (this.state === 'running') this._setState('ready');
    cur.resolve(result);
  }

  // code を実行して結果を返す。エラーも「結果」として返す（例外は投げない）。
  async run(code, params = {}, { timeoutMs = 20000 } = {}) {
    if (this._busy) throw new Error('前の実行がまだ終わっていません');
    this._busy = true;
    try {
      await this.whenReady();
    } catch (err) {
      this._busy = false;
      return this._abortResult('StartError', 'Python を起動できませんでした: ' + err.message,
        'ページを読み込み直してみてください。');
    }
    return new Promise((resolve) => {
      const id = this._nextId++;
      const startedAt = performance.now();
      const timer = setTimeout(() => {
        if (!this._current || this._current.id !== id) return;
        const sec = Math.round(timeoutMs / 1000);
        const result = this._abortResult('Timeout', `${sec} 秒たっても終わらなかったので、実行を止めました。`,
          'くり返し（for / while）が終わらなくなっていないか、地形が大きすぎないかを確認しましょう。');
        this._finish(result);
        this._restart();
      }, timeoutMs);
      this._current = { id, resolve, timer, startedAt };
      this._setState('running');
      this.worker.postMessage({ type: 'run', id, code, params });
    });
  }

  // 実行中のコードを止める（Worker を作り直す）
  stop() {
    if (!this._current) return;
    const result = this._abortResult('Stopped', '実行を止めました。', '');
    this._finish(result);
    this._restart();
  }
}
