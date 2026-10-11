// Python のソースコードを「字句（トークン）」に分ける。ブロック表示とスライダーの書き戻しに使う。
// Python の文法すべてではなく、この教材で扱う範囲（文字列・数値・名前・記号・コメント）に対応する。

const OPS = [
  '**=', '//=', '>>=', '<<=', '...', '->', ':=', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=',
  '**', '//', '>>', '<<',
];
const STRING_START = /^[rRbBfFuU]{0,2}('''|"""|'|")/;
const NUMBER = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?)/;
const NAME = /^[A-Za-z_\u0080-￿][\w\u0080-￿]*/;

export const KEYWORDS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
  'raise', 'return', 'try', 'while', 'with', 'yield', 'True', 'False', 'None',
]);
export const BUILTINS = new Set([
  'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'float', 'int', 'len', 'list', 'max', 'min', 'print', 'range',
  'round', 'set', 'sorted', 'str', 'sum', 'tuple', 'zip', 'slider', 'plot', 'heatmap', 'terrain',
]);

// その場で書き換えられる数値（10 進の整数・小数。符号つきも可）
export const EDITABLE_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

// ソース全体をトークンの列にする。type: ws / nl / cont / comment / string / number / name / op / error
export function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  const push = (type, text) => { tokens.push({ type, text, start: i }); i += text.length; };
  while (i < n) {
    const ch = src[i];
    const rest = src.slice(i, i + 200);
    if (ch === '\n') { push('nl', '\n'); continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === ' ' || ch === '\t') { push('ws', /^[ \t]+/.exec(rest)[0]); continue; }
    if (ch === '#') {
      const end = src.indexOf('\n', i);
      push('comment', src.slice(i, end < 0 ? n : end));
      continue;
    }
    if (ch === '\\' && src[i + 1] === '\n') { push('cont', '\\\n'); continue; }
    const sm = STRING_START.exec(rest);
    if (sm) {
      const quote = sm[1];
      let j = i + sm[0].length;
      let closed = false;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (quote.length === 1 && src[j] === '\n') break;
        if (src.startsWith(quote, j)) { j += quote.length; closed = true; break; }
        j += 1;
      }
      push(closed ? 'string' : 'error', src.slice(i, Math.min(j, n)));
      continue;
    }
    const nm = NUMBER.exec(rest);
    if (nm && nm[0] !== '') { push('number', nm[0]); continue; }
    const im = NAME.exec(src.slice(i, i + 400));
    if (im) { push('name', im[0]); continue; }
    const op = OPS.find((o) => src.startsWith(o, i));
    push('op', op || ch);
  }
  return tokens;
}

export const isSig = (t) => t.type !== 'ws' && t.type !== 'nl' && t.type !== 'comment' && t.type !== 'cont';

// 「-1」のような符号つきの数を 1 つのトークンにまとめる（引き算の「-」はまとめない）
export function mergeSigns(tokens) {
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const next = tokens[k + 1];
    if (t.type === 'op' && (t.text === '-' || t.text === '+') && next && next.type === 'number') {
      let p = out.length - 1;
      while (p >= 0 && !isSig(out[p])) p--;
      const prev = p >= 0 ? out[p] : null;
      const unary = !prev
        || (prev.type === 'op' && ![')', ']', '}'].includes(prev.text))
        || (prev.type === 'name' && KEYWORDS.has(prev.text) && !['True', 'False', 'None'].includes(prev.text));
      if (unary) {
        out.push({ type: 'number', text: t.text + next.text, start: t.start });
        k += 1;
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

// ソースを「論理行」（かっこの中の改行をまとめた 1 文）に分ける
export function logicalLines(src) {
  const tokens = tokenize(src.replace(/\r\n?/g, '\n'));
  const lines = [];
  let cur = [];
  let depth = 0;
  let lineNo = 1;
  let startLine = 1;
  const flush = () => {
    let indent = 0;
    let body = cur;
    if (body.length && body[0].type === 'ws') {
      indent = body[0].text.replace(/\t/g, '    ').length;
      body = body.slice(1);
    }
    while (body.length && body[body.length - 1].type === 'ws') body = body.slice(0, -1);
    const sig = body.filter(isSig);
    lines.push({
      indent,
      startLine,
      tokens: mergeSigns(body),
      blank: body.length === 0,
      commentOnly: sig.length === 0 && body.length > 0,
      hasError: body.some((t) => t.type === 'error'),
    });
    cur = [];
  };
  for (const t of tokens) {
    if (t.type === 'nl' && depth === 0) {
      flush();
      lineNo += 1;
      startLine = lineNo;
      continue;
    }
    if (t.type === 'op') {
      if ('([{'.includes(t.text)) depth += 1;
      else if (')]}'.includes(t.text)) depth = Math.max(0, depth - 1);
    }
    cur.push(t);
    for (const c of t.text) if (c === '\n') lineNo += 1;
  }
  if (cur.length) flush();
  return { lines, unclosed: depth > 0 };
}

// 文字列トークンの中身（接頭辞と引用符を除いたもの）
export function stringValue(text) {
  const m = /^[rRbBfFuU]{0,2}('''|"""|'|")/.exec(text);
  if (!m) return null;
  const q = m[1];
  return text.endsWith(q) ? text.slice(m[0].length, text.length - q.length) : null;
}

// トークン列の中から slider("名前", 最小, 最大, 最初の値, ...) を探し、「最初の値」の数値トークンを返す。
// 最初の値が数値そのもの（式ではない）のときだけ見つかる。
export function findSliderDefault(tokens, name) {
  const sig = tokens.filter(isSig);
  for (let k = 0; k + 2 < sig.length; k++) {
    if (!(sig[k].type === 'name' && sig[k].text === 'slider' && sig[k + 1].text === '(')) continue;
    if (!(sig[k + 2].type === 'string' && stringValue(sig[k + 2].text) === name)) continue;
    let depth = 0;
    let arg = 0;
    let argTokens = [];
    for (let p = k + 2; p < sig.length; p++) {
      const t = sig[p];
      if (t.type === 'op' && '([{'.includes(t.text)) depth += 1;
      if (t.type === 'op' && ')]}'.includes(t.text)) {
        if (depth === 0) break;
        depth -= 1;
      }
      if (t.type === 'op' && t.text === ',' && depth === 0) {
        if (arg === 3) break;
        arg += 1;
        argTokens = [];
        continue;
      }
      if (arg === 3) argTokens.push(t);
    }
    if (arg === 3 && argTokens.length === 1 && argTokens[0].type === 'number' && EDITABLE_NUMBER.test(argTokens[0].text)) {
      return argTokens[0];
    }
    return null;
  }
  return null;
}
