// Python コード ⇔ ブロックの木 の変換。
// ブロック = 1 つの文。if / for / def などは「見出し行 + 中身（ブロックの並び）」を持つ。
// if ... elif ... else のように続く部分は、1 つのブロックの中の「節（clause）」として持つ。
import { isSig, logicalLines } from './pytokens.js';

const CONTINUATION = new Set(['elif', 'else', 'except', 'finally']);
let nextId = 1;

function makeClause(tokens, hasBody, baseIndent) {
  return { tokens, body: hasBody ? [] : null, comments: [], baseIndent };
}

function makeBlock(clause, blankBefore, comments) {
  return { id: nextId++, blankBefore, comments, clauses: [clause], folded: false };
}

export function sigTokens(tokens) {
  return tokens.filter(isSig);
}

export function isPass(block) {
  if (block.clauses.length !== 1 || block.clauses[0].body) return false;
  const sig = sigTokens(block.clauses[0].tokens);
  return sig.length === 1 && sig[0].text === 'pass';
}

export function headerText(block) {
  return sigTokens(block.clauses[0].tokens).map((t) => t.text).join(' ');
}

// ブロックの種類（色分けに使う）
export function category(block) {
  const sig = sigTokens(block.clauses[0].tokens);
  if (!sig.length) return 'comment';
  const first = sig[0].text;
  if (sig[0].type === 'string' && sig.length === 1) return 'comment';   // 関数の説明文（docstring）
  if (first === 'def' || first === 'class') return 'def';
  if (first === 'for' || first === 'while') return 'loop';
  if (first === 'if' || first === 'try' || first === 'with') return 'cond';
  if (first === 'import' || first === 'from') return 'import';
  if (['return', 'pass', 'break', 'continue', 'raise'].includes(first)) return 'flow';
  let depth = 0;
  for (const t of sig) {
    if (t.type !== 'op') continue;
    if ('([{'.includes(t.text)) depth += 1;
    else if (')]}'.includes(t.text)) depth -= 1;
    else if (depth === 0 && /^(=|\+=|-=|\*=|\/=|\/\/=|%=|\*\*=)$/.test(t.text)) return 'assign';
  }
  if (sig[0].type === 'name' && ['plot', 'heatmap', 'terrain', 'print'].includes(first)) return 'show';
  return 'call';
}

// コードをブロックの木にする。できないときは { ok: false, line, reason } を返す。
export function parseBlocks(src) {
  const { lines, unclosed } = logicalLines(src);
  if (unclosed) return { ok: false, line: lines.length ? lines[lines.length - 1].startLine : 1, reason: 'かっこが閉じられていません' };
  const root = [];
  const stack = [{ indent: 0, list: root, expectBody: false, headerIndent: -1 }];
  let blanks = 0;
  let pending = [];   // 直前に並んでいるコメント行

  const flushComments = () => {
    if (!pending.length) return;
    const list = stack[stack.length - 1].list;
    pending.forEach((c, k) => {
      list.push(makeBlock(makeClause([c.token], false, c.indent), k === 0 ? c.blanks : 0, []));
    });
    pending = [];
  };

  for (const ll of lines) {
    if (ll.blank) {
      flushComments();
      blanks += 1;
      continue;
    }
    if (ll.hasError) return { ok: false, line: ll.startLine, reason: '文字列の引用符が閉じられていません' };
    if (ll.commentOnly) {
      pending.push({ token: ll.tokens.find((t) => t.type === 'comment'), indent: ll.indent, blanks });
      blanks = 0;
      continue;
    }
    let top = stack[stack.length - 1];
    if (top.expectBody) {
      if (ll.indent <= top.headerIndent) return { ok: false, line: ll.startLine, reason: '「:」で終わる行の次は、字下げした行が必要です' };
      top.indent = ll.indent;
      top.expectBody = false;
    } else {
      while (stack.length > 1 && ll.indent < top.indent) {
        if (pending.length && pending[0].indent >= top.indent) flushComments();
        stack.pop();
        top = stack[stack.length - 1];
      }
      if (ll.indent !== top.indent) return { ok: false, line: ll.startLine, reason: '字下げ（行の先頭の空白）がそろっていません' };
    }
    const sig = sigTokens(ll.tokens);
    const first = sig[0].text;
    const isHeader = sig[sig.length - 1].text === ':' && sig[sig.length - 1].type === 'op';
    const comments = pending.map((c) => c.token.text);
    const blankBefore = pending.length ? pending[0].blanks : blanks;
    pending = [];
    blanks = 0;

    if (CONTINUATION.has(first) && sig[0].type === 'name') {
      const prev = top.list[top.list.length - 1];
      if (!prev || !prev.clauses[0].body || !isHeader) {
        return { ok: false, line: ll.startLine, reason: `「${first}」の位置か書き方が、ブロック表示に対応していません` };
      }
      const clause = makeClause(ll.tokens, true, ll.indent);
      clause.comments = comments;
      prev.clauses.push(clause);
      stack.push({ indent: 0, list: clause.body, expectBody: true, headerIndent: ll.indent });
      continue;
    }
    const clause = makeClause(ll.tokens, isHeader, ll.indent);
    top.list.push(makeBlock(clause, blankBefore, comments));
    if (isHeader) stack.push({ indent: 0, list: clause.body, expectBody: true, headerIndent: ll.indent });
  }
  if (stack[stack.length - 1].expectBody) {
    return { ok: false, line: lines.length ? lines[lines.length - 1].startLine : 1, reason: '「:」で終わる行の次に、中身がありません' };
  }
  flushComments();
  return { ok: true, root };
}

// 1 文のトークンを文字列に戻す。途中で改行している文は、続きの行の字下げを新しい深さに合わせる。
function renderTokens(clause, indentText) {
  let out = '';
  const shift = indentText.length - clause.baseIndent;
  const toks = clause.tokens;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type === 'nl' || t.type === 'cont') {
      out += t.text;
      const next = toks[k + 1];
      const width = next && next.type === 'ws' ? next.text.replace(/\t/g, '    ').length : 0;
      out += ' '.repeat(Math.max(0, width + shift));
      if (next && next.type === 'ws') k += 1;
      continue;
    }
    out += t.text;
  }
  return out;
}

// ブロックの木をコードに戻す。lineMap は「何行目がどのブロックのどの節か」（エラー表示に使う）
export function serializeBlocks(root) {
  const out = [];
  const lineMap = [];
  let line = 1;
  const emit = (text) => {
    out.push(text);
    line += text.split('\n').length;
  };
  const walk = (list, depth) => {
    const indent = '    '.repeat(depth);
    for (const b of list) {
      if (out.length) for (let k = 0; k < b.blankBefore; k++) emit('');
      for (const c of b.comments) emit(indent + c);
      b.clauses.forEach((cl, ci) => {
        for (const c of cl.comments) emit(indent + c);
        lineMap.push({ line, block: b, clause: ci });
        emit(indent + renderTokens(cl, indent));
        if (cl.body) {
          if (cl.body.length === 0) emit(indent + '    pass');
          else walk(cl.body, depth + 1);
        }
      });
    }
  };
  walk(root, 0);
  return { code: out.join('\n') + '\n', lineMap };
}

// 木の中からブロックを探し、入っている並び（list）と位置を返す
export function locate(root, id) {
  const search = (list, parent) => {
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      if (b.id === id) return { list, index: k, block: b, parent };
      for (const cl of b.clauses) {
        if (cl.body) {
          const hit = search(cl.body, b);
          if (hit) return hit;
        }
      }
    }
    return null;
  };
  return search(root, null);
}

export function allBlocks(root) {
  const res = [];
  const walk = (list) => {
    for (const b of list) {
      res.push(b);
      for (const cl of b.clauses) if (cl.body) walk(cl.body);
    }
  };
  walk(root);
  return res;
}

// 中身が空になった所に pass を入れ、ほかのブロックがある所の pass は取り除く
export function normalizeBodies(root) {
  const fix = (list, isRoot) => {
    if (list.length > 1) {
      for (let k = list.length - 1; k >= 0; k--) {
        if (isPass(list[k]) && list.length > 1) list.splice(k, 1);
      }
    }
    if (!isRoot && list.length === 0) {
      const parsed = parseBlocks('pass\n');
      list.push(parsed.root[0]);
    }
    for (const b of list) for (const cl of b.clauses) if (cl.body) fix(cl.body, false);
  };
  fix(root, true);
}

// ブロックを複製する（id は新しく付け直す）
export function cloneBlock(block) {
  const copy = {
    id: nextId++,
    blankBefore: block.blankBefore,
    comments: [...block.comments],
    folded: block.folded,
    clauses: block.clauses.map((cl) => ({
      tokens: cl.tokens.map((t) => ({ ...t })),
      comments: [...cl.comments],
      baseIndent: cl.baseIndent,
      body: cl.body ? cl.body.map(cloneBlock) : null,
    })),
  };
  return copy;
}
