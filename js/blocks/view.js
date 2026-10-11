// ブロック編集の画面。Python コードを 1 文ずつのブロックとして表示し、
//   ・つかんで動かす／▲▼ で並び替える   ・数字や色の名前をその場で書き換える
//   ・部品（あらかじめ用意した文）を足す ・複製、削除、元に戻す
// ができる。中身はいつでも Python のコード（文字列）に戻せる。
import { el } from '../util.js';
import { BUILTINS, EDITABLE_NUMBER, KEYWORDS, findSliderDefault, isSig, stringValue } from './pytokens.js';
import { allBlocks, category, cloneBlock, isPass, locate, normalizeBodies, parseBlocks, serializeBlocks, sigTokens } from './model.js';

export const BLOCK_NAMES = [
  ['water', '水'], ['sand', '砂'], ['grass', '草'], ['forest', '森'], ['dirt', '土'],
  ['stone', '岩'], ['snow', '雪'], ['ice', '氷'], ['lava', '溶岩'],
];
const BLOCK_NAME_SET = new Set(BLOCK_NAMES.map(([n]) => n));
const MAX_UNDO = 100;

const squeeze = (text) => text.replace(/\s+/g, '');

export class BlockEditor {
  constructor(host, { onChange }) {
    this.host = host;
    this.onChange = onChange;
    this.root = [];
    this.meta = { fold: new Set(), focus: [] };
    this.foldOverride = new Map();
    this.selectedId = null;
    this.errorLine = null;
    this.undoStack = [];
    this.redoStack = [];
    this.lineMap = [];
    this.inputs = new WeakMap();    // 数値トークン -> 入力欄
    this.drag = null;

    this.scroll = el('div', { class: 'blk-scroll' });
    this.rootList = el('div', { class: 'blk-list blk-root', 'data-depth': '0' });
    this.indicator = el('div', { class: 'blk-drop', hidden: true });
    this.scroll.append(this.rootList, this.indicator);
    host.append(this.scroll);

    this.scroll.addEventListener('click', (ev) => {
      if (ev.target.closest('input, select, button')) return;
      const node = ev.target.closest('.blk');
      this.select(node ? Number(node.dataset.id) : null);
    });
  }

  // ---------- 読み込みと書き出し ----------
  setMeta({ fold = [], focus = [] } = {}) {
    this.meta = { fold: new Set(fold), focus: focus.map(squeeze) };
    this.foldOverride = new Map();
  }

  // コードを読み込む（元に戻す履歴は消す）。ブロックにできないときは { ok: false, line, reason }
  load(code) {
    const res = this._setCode(code);
    if (res.ok) {
      this.undoStack = [];
      this.redoStack = [];
      this.selectedId = null;
      this.scroll.scrollTop = 0;
    }
    return res;
  }

  _setCode(code) {
    const res = parseBlocks(code);
    if (!res.ok) return res;
    this.root = res.root;
    normalizeBodies(this.root);
    this.render();
    return res;
  }

  getCode() {
    const { code, lineMap } = serializeBlocks(this.root);
    this.lineMap = lineMap;
    return code;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  _snapshot() {
    this.undoStack.push(this.getCode());
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.canUndo) return;
    this.redoStack.push(this.getCode());
    this._setCode(this.undoStack.pop());
    this.onChange('undo');
  }

  redo() {
    if (!this.canRedo) return;
    this.undoStack.push(this.getCode());
    this._setCode(this.redoStack.pop());
    this.onChange('redo');
  }

  // 並びを変える操作の共通処理
  _mutate(kind, fn, focusId = null) {
    this._snapshot();
    fn();
    normalizeBodies(this.root);
    this.render();
    if (focusId !== null) {
      const grip = this.scroll.querySelector(`.blk[data-id="${focusId}"] > .blk-row .blk-grip`);
      if (grip) grip.focus({ preventScroll: true });
    }
    this.onChange(kind);
  }

  // ---------- 表示 ----------
  _isFolded(block) {
    if (!block.clauses[0].body) return false;
    const key = squeeze(sigTokens(block.clauses[0].tokens).map((t) => t.text).join(' '));
    if (this.foldOverride.has(key)) return this.foldOverride.get(key);
    const sig = sigTokens(block.clauses[0].tokens);
    return sig[0].text === 'def' && sig[1] && this.meta.fold.has(sig[1].text);
  }

  _toggleFold(block) {
    const key = squeeze(sigTokens(block.clauses[0].tokens).map((t) => t.text).join(' '));
    this.foldOverride.set(key, !this._isFolded(block));
    this.render();
  }

  _isFocus(block) {
    if (!this.meta.focus.length) return false;
    const head = squeeze(block.clauses[0].tokens.filter((t) => t.type !== 'comment').map((t) => t.text).join(''));
    return this.meta.focus.some((f) => head.startsWith(f));
  }

  render() {
    const scrollTop = this.scroll.scrollTop;
    const { lineMap } = serializeBlocks(this.root);
    this.lineMap = lineMap;
    const lineOf = new Map(lineMap.map((m) => [`${m.block.id}:${m.clause}`, m.line]));
    this.rootList.replaceChildren(...this.root.map((b) => this._renderBlock(b, 0, lineOf)));
    this.indicator.hidden = true;
    this.scroll.scrollTop = scrollTop;
    this._applyError();
  }

  _renderBlock(block, depth, lineOf) {
    const cat = category(block);
    const folded = this._isFolded(block);
    const node = el('div', {
      class: `blk cat-${cat}` + (folded ? ' folded' : '') + (this._isFocus(block) ? ' focus' : '')
        + (block.id === this.selectedId ? ' selected' : '') + (isPass(block) ? ' is-pass' : ''),
      'data-id': block.id,
    });
    node.style.setProperty('--gap', Math.min(2, block.blankBefore));   // 空行で区切られた所は、少し間を空けて見せる
    for (const c of block.comments) node.append(el('div', { class: 'blk-note', text: c.replace(/^#\s?/, '') }));

    block.clauses.forEach((cl, ci) => {
      for (const c of cl.comments) node.append(el('div', { class: 'blk-note', text: c.replace(/^#\s?/, '') }));
      const row = el('div', { class: 'blk-row', 'data-clause': ci, 'data-line': lineOf.get(`${block.id}:${ci}`) ?? '' });
      if (ci === 0) {
        const grip = el('button', { type: 'button', class: 'blk-grip', 'aria-label': 'このブロックを動かす（つかんで移動、または上下の矢印キー）', title: 'つかんで動かす' });
        grip.addEventListener('pointerdown', (ev) => this._gripDown(ev, { kind: 'block', id: block.id }, node));
        grip.addEventListener('keydown', (ev) => {
          if (ev.key === 'ArrowUp') { ev.preventDefault(); this.move(block.id, -1); }
          if (ev.key === 'ArrowDown') { ev.preventDefault(); this.move(block.id, 1); }
        });
        row.append(grip);
      } else {
        row.append(el('span', { class: 'blk-grip-space' }));
      }
      if (cl.body && ci === 0) {
        row.append(el('button', {
          type: 'button', class: 'blk-fold', 'aria-expanded': String(!folded),
          'aria-label': folded ? '中身を開く' : '中身をたたむ', title: folded ? '中身を開く' : '中身をたたむ',
          onclick: () => this._toggleFold(block),
        }));
      }
      row.append(this._renderCode(cl));
      if (folded && ci === 0) {
        const count = allBlocks(block.clauses.flatMap((c) => c.body || [])).length;
        row.append(el('button', { type: 'button', class: 'blk-more', text: `… 中身 ${count} 個（開く）`, onclick: () => this._toggleFold(block) }));
      }
      if (ci === 0) row.append(this._renderTools(block));
      node.append(row);

      if (cl.body) {
        const list = el('div', { class: 'blk-list blk-body', 'data-depth': depth + 1, 'data-owner': block.id, 'data-clause': ci });
        if (!folded) list.append(...cl.body.map((child) => this._renderBlock(child, depth + 1, lineOf)));
        node.append(list);
      }
    });
    if (block.clauses[0].body) node.append(el('div', { class: 'blk-foot' }));
    return node;
  }

  _renderTools(block) {
    const btn = (label, cls, fn) => el('button', { type: 'button', class: 'blk-tool ' + cls, 'aria-label': label, title: label, onclick: fn });
    return el('span', { class: 'blk-tools' }, [
      btn('上へ動かす', 't-up', () => this.move(block.id, -1)),
      btn('下へ動かす', 't-down', () => this.move(block.id, 1)),
      btn('複製する', 't-copy', () => this.duplicate(block.id)),
      btn('削除する', 't-del', () => this.remove(block.id)),
    ]);
  }

  _renderCode(clause) {
    const code = el('code', { class: 'blk-code' });
    const toks = clause.tokens;
    let prevSig = null;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.type === 'nl' || t.type === 'cont') {
        const next = toks[k + 1];
        const width = next && next.type === 'ws' ? next.text.replace(/\t/g, '    ').length : 0;
        code.append(t.text + ' '.repeat(Math.max(0, width - clause.baseIndent)));
        if (next && next.type === 'ws') k += 1;
        continue;
      }
      if (t.type === 'ws') { code.append(t.text); continue; }
      if (t.type === 'number' && EDITABLE_NUMBER.test(t.text)) {
        code.append(this._numberInput(t));
      } else if (t.type === 'string' && BLOCK_NAME_SET.has(stringValue(t.text))) {
        code.append(this._nameSelect(t));
      } else {
        let cls = '';
        if (t.type === 'comment') cls = 'tk-com';
        else if (t.type === 'string' || t.type === 'error') cls = 'tk-str';
        else if (t.type === 'number') cls = 'tk-num';
        else if (t.type === 'name' && KEYWORDS.has(t.text)) cls = 'tk-kw';
        else if (t.type === 'name' && prevSig && prevSig.text === 'def') cls = 'tk-def';
        else if (t.type === 'name' && BUILTINS.has(t.text)) cls = 'tk-builtin';
        code.append(cls ? el('span', { class: cls, text: t.text }) : t.text);
      }
      if (isSig(t)) prevSig = t;
    }
    return code;
  }

  _numberInput(token) {
    const input = el('input', {
      class: 'blk-num', type: 'text', inputmode: 'decimal', spellcheck: 'false', autocomplete: 'off',
      value: token.text, 'aria-label': '数値（書き換えられます。上下の矢印キーで増減）',
    });
    const fit = () => { input.style.width = `calc(${Math.max(1, input.value.length)}ch + 12px)`; };
    fit();
    let dirty = false;
    const apply = () => {
      fit();
      const v = input.value.trim();
      const ok = EDITABLE_NUMBER.test(v);
      input.classList.toggle('invalid', !ok);
      if (!ok || v === token.text) return;
      if (!dirty) { this._snapshot(); dirty = true; }
      token.text = v;
      this.onChange('number');
    };
    input.addEventListener('input', apply);
    input.addEventListener('focus', () => { dirty = false; input.select(); });
    input.addEventListener('blur', () => {
      if (!EDITABLE_NUMBER.test(input.value.trim())) { input.value = token.text; input.classList.remove('invalid'); fit(); }
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); return; }
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      const v = input.value.trim();
      if (!EDITABLE_NUMBER.test(v) || /[eE]/.test(v)) return;
      ev.preventDefault();
      const decimals = (v.split('.')[1] || '').length;
      const step = 10 ** -decimals * (ev.shiftKey ? 10 : 1);
      const next = Number(v) + (ev.key === 'ArrowUp' ? step : -step);
      input.value = next.toFixed(decimals);
      apply();
    });
    this.inputs.set(token, input);
    return input;
  }

  _nameSelect(token) {
    const quote = token.text[0];
    const current = stringValue(token.text);
    const select = el('select', { class: 'blk-name', 'aria-label': 'ブロックの種類（選び直せます）' },
      BLOCK_NAMES.map(([name, ja]) => el('option', { value: name, text: `"${name}"（${ja}）`, selected: name === current })));
    const wrap = el('span', { class: 'blk-name-wrap', 'data-name': current }, [el('span', { class: 'blk-swatch' }), select]);
    select.addEventListener('change', () => {
      this._snapshot();
      token.text = quote + select.value + quote;
      wrap.dataset.name = select.value;
      this.onChange('name');
    });
    return wrap;
  }

  // このステップで注目するブロックが見える位置まで、表示を送る
  scrollToFocus() {
    const first = this.scroll.querySelector('.blk.focus');
    if (!first) return;
    const r = first.getBoundingClientRect();
    const s = this.scroll.getBoundingClientRect();
    if (s.height === 0) return;
    if (r.bottom > s.bottom - 40) this.scroll.scrollTop += r.top - s.top - 48;
  }

  select(id) {
    this.selectedId = id;
    for (const n of this.scroll.querySelectorAll('.blk.selected')) n.classList.remove('selected');
    if (id !== null) this.scroll.querySelector(`.blk[data-id="${id}"]`)?.classList.add('selected');
  }

  // ---------- エラーの場所を示す ----------
  markError(line) {
    this.errorLine = line;
    this._applyError();
  }

  _applyError() {
    for (const n of this.scroll.querySelectorAll('.blk-row.has-error')) n.classList.remove('has-error');
    if (!this.errorLine) return;
    let hit = null;
    for (const m of this.lineMap) if (m.line <= this.errorLine) hit = m;
    if (!hit) return;
    // たたまれている関数の中なら開く
    let reopened = false;
    let loc = locate(this.root, hit.block.id);
    while (loc && loc.parent) {
      if (this._isFolded(loc.parent)) {
        const key = squeeze(sigTokens(loc.parent.clauses[0].tokens).map((t) => t.text).join(' '));
        this.foldOverride.set(key, false);
        reopened = true;
      }
      loc = locate(this.root, loc.parent.id);
    }
    if (reopened) { this.render(); return; }
    const row = this.scroll.querySelector(`.blk[data-id="${hit.block.id}"] > .blk-row[data-clause="${hit.clause}"]`);
    if (row) {
      row.classList.add('has-error');
      const r = row.getBoundingClientRect();
      const s = this.scroll.getBoundingClientRect();
      if (r.top < s.top || r.bottom > s.bottom) this.scroll.scrollTop += r.top - s.top - s.height / 3;
    }
  }

  // ---------- スライダーからの書き戻し ----------
  setSliderDefault(name, text) {
    for (const b of allBlocks(this.root)) {
      for (const cl of b.clauses) {
        const token = findSliderDefault(cl.tokens, name);
        if (!token) continue;
        token.text = text;
        const input = this.inputs.get(token);
        if (input && document.activeElement !== input) {
          input.value = text;
          input.style.width = `calc(${Math.max(1, text.length)}ch + 12px)`;
        }
        return true;
      }
    }
    return false;
  }

  // ---------- 並び替え・複製・削除・追加 ----------
  move(id, dir) {
    const loc = locate(this.root, id);
    if (!loc) return;
    const { list, index, parent } = loc;
    const target = index + dir;
    if (target >= 0 && target < list.length) {
      this._mutate('move', () => {
        // 入れ替える 2 つのブロックの「前の空行の数」も交換して、見た目の区切りを保つ
        const other = list[target];
        [other.blankBefore, loc.block.blankBefore] = [loc.block.blankBefore, other.blankBefore];
        list.splice(index, 1);
        list.splice(target, 0, loc.block);
      }, id);
    } else if (parent) {
      // 並びの端にいるときは、外側のブロックの前後へ出す
      const outer = locate(this.root, parent.id);
      this._mutate('move', () => {
        list.splice(index, 1);
        outer.list.splice(outer.index + (dir > 0 ? 1 : 0), 0, loc.block);
        if (outer.list !== this.root) loc.block.blankBefore = 0;
      }, id);
    }
  }

  duplicate(id) {
    const loc = locate(this.root, id);
    if (!loc) return;
    const copy = cloneBlock(loc.block);
    this._mutate('duplicate', () => loc.list.splice(loc.index + 1, 0, copy));
    this.select(copy.id);
  }

  remove(id) {
    const loc = locate(this.root, id);
    if (!loc) return;
    this._mutate('delete', () => loc.list.splice(loc.index, 1));
    if (this.selectedId === id) this.selectedId = null;
  }

  // 部品（コードの断片）を、選んでいるブロックの次（なければ最後）に入れる
  insertSnippet(code) {
    const parsed = parseBlocks(code);
    if (!parsed.ok) return;
    const loc = this.selectedId !== null ? locate(this.root, this.selectedId) : null;
    const list = loc ? loc.list : this.root;
    const at = loc ? loc.index + 1 : this.root.length;
    this._mutate('insert', () => list.splice(at, 0, ...parsed.root));
    this._flash(parsed.root.map((b) => b.id));
  }

  _flash(ids) {
    this.select(ids[0]);
    const first = this.scroll.querySelector(`.blk[data-id="${ids[0]}"]`);
    if (first) {
      const r = first.getBoundingClientRect();
      const s = this.scroll.getBoundingClientRect();
      if (r.top < s.top || r.bottom > s.bottom) this.scroll.scrollTop += r.top - s.top - s.height / 3;
    }
    for (const id of ids) {
      const n = this.scroll.querySelector(`.blk[data-id="${id}"]`);
      if (n) { n.classList.add('just-added'); setTimeout(() => n.classList.remove('just-added'), 1200); }
    }
  }

  // ---------- つかんで動かす ----------
  // source: { kind: 'block', id } または { kind: 'new', code }
  _gripDown(ev, source, sourceEl) {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    const start = { x: ev.clientX, y: ev.clientY };
    const handle = ev.currentTarget;
    try { handle.setPointerCapture(ev.pointerId); } catch { /* 対応していない環境では何もしない */ }
    const onMove = (e) => {
      if (!this.drag) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
        this._beginDrag(source, sourceEl, e);
      }
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this._updateDrag();
    };
    const finish = (commit) => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey, true);
      if (this.drag) this._endDrag(commit);
      else if (source.kind === 'new' && commit) this.insertSnippet(source.code);   // 動かさずに離したら「押した」とみなす
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey, true);
  }

  // 部品の一覧（画面の別の場所にある）から、新しいブロックをつかんで入れられるようにする
  attachPaletteItem(node, code) {
    node.addEventListener('pointerdown', (ev) => this._gripDown(ev, { kind: 'new', code }, node));
    node.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.insertSnippet(code); }
    });
  }

  _beginDrag(source, sourceEl, ev) {
    const rect = sourceEl.getBoundingClientRect();
    const ghost = sourceEl.cloneNode(true);
    ghost.classList.add('blk-ghost');
    ghost.style.width = rect.width + 'px';
    ghost.removeAttribute('data-id');
    document.body.append(ghost);
    if (source.kind === 'block') sourceEl.classList.add('dragging');
    document.body.classList.add('dragging-block');
    this.drag = {
      source, sourceEl, ghost,
      dx: ev.clientX - rect.left, dy: ev.clientY - rect.top,
      x: ev.clientX, y: ev.clientY, target: null, raf: 0,
    };
    const tick = () => {
      if (!this.drag) return;
      this._autoScroll();
      this.drag.raf = requestAnimationFrame(tick);
    };
    this.drag.raf = requestAnimationFrame(tick);
  }

  _autoScroll() {
    const d = this.drag;
    const s = this.scroll.getBoundingClientRect();
    let moved = false;
    if (d.y < s.top + 40 && this.scroll.scrollTop > 0) { this.scroll.scrollTop -= 12; moved = true; }
    else if (d.y > s.bottom - 40 && this.scroll.scrollTop < this.scroll.scrollHeight - this.scroll.clientHeight) { this.scroll.scrollTop += 12; moved = true; }
    if (d.y < 36) { window.scrollBy(0, -12); moved = true; }
    else if (d.y > window.innerHeight - 36) { window.scrollBy(0, 12); moved = true; }
    if (moved) this._updateDrag();
  }

  _updateDrag() {
    const d = this.drag;
    // つかんだ位置より少し右下に出して、入れ先の目印（青い線）が隠れないようにする
    d.ghost.style.transform = `translate(${d.x - d.dx + 14}px, ${d.y - d.dy + 14}px)`;
    const s = this.scroll.getBoundingClientRect();
    const inside = d.x > s.left - 40 && d.x < s.right + 40 && d.y > s.top - 40 && d.y < s.bottom + 40;
    if (!inside) {
      d.target = null;
      this.indicator.hidden = true;
      return;
    }
    let best = this.rootList;
    let bestDepth = 0;
    for (const list of this.scroll.querySelectorAll('.blk-body')) {
      if (d.source.kind === 'block' && d.sourceEl.contains(list)) continue;
      if (list.offsetParent === null) continue;
      const r = list.getBoundingClientRect();
      if (d.y < r.top - 2 || d.y > r.bottom + 2) continue;
      const depth = Number(list.dataset.depth);
      if (depth > bestDepth) { best = list; bestDepth = depth; }
    }
    const children = [...best.children].filter((c) => c.classList.contains('blk') && c !== d.sourceEl);
    let index = 0;
    for (const c of children) {
      const r = c.getBoundingClientRect();
      if (d.y > r.top + r.height / 2) index += 1;
    }
    d.target = { list: best, index };
    const listRect = best.getBoundingClientRect();
    let y;
    if (children.length === 0) y = listRect.top + 4;
    else if (index < children.length) y = children[index].getBoundingClientRect().top - 2;
    else y = children[children.length - 1].getBoundingClientRect().bottom + 1;
    this.indicator.style.top = y - s.top + this.scroll.scrollTop + 'px';
    this.indicator.style.left = listRect.left - s.left + this.scroll.scrollLeft + 'px';
    this.indicator.style.width = Math.max(40, Math.min(listRect.width, s.width - (listRect.left - s.left) - 8)) + 'px';
    this.indicator.hidden = false;
  }

  _endDrag(commit) {
    const d = this.drag;
    this.drag = null;
    cancelAnimationFrame(d.raf);
    d.ghost.remove();
    d.sourceEl.classList.remove('dragging');
    document.body.classList.remove('dragging-block');
    this.indicator.hidden = true;
    if (!commit || !d.target) return;

    // 画面上の入れ先（list と位置）を、ブロックの木の中の並びに直す
    const listEl = d.target.list;
    let targetList = this.root;
    if (listEl !== this.rootList) {
      const owner = locate(this.root, Number(listEl.dataset.owner));
      if (!owner) return;
      targetList = owner.block.clauses[Number(listEl.dataset.clause)].body;
    }
    if (d.source.kind === 'block') {
      const loc = locate(this.root, d.source.id);
      if (!loc) return;
      const without = targetList.filter((b) => b !== loc.block);
      const before = without[d.target.index] || null;
      if (loc.list === targetList && (loc.list[loc.index + 1] || null) === before) return;   // 元の場所に戻しただけ
      this._mutate('move', () => {
        loc.list.splice(loc.index, 1);
        const at = before ? targetList.indexOf(before) : targetList.length;
        targetList.splice(at, 0, loc.block);
        // 関数や for の中へ入れたときは、前に空いていた空行を持ち込まない
        if (targetList !== this.root || at === 0) loc.block.blankBefore = 0;
      });
      this.select(d.source.id);
    } else {
      const parsed = parseBlocks(d.source.code);
      if (!parsed.ok) return;
      this._mutate('insert', () => targetList.splice(Math.min(d.target.index, targetList.length), 0, ...parsed.root));
      this._flash(parsed.root.map((b) => b.id));
    }
  }
}
