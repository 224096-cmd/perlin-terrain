"""教材の表示用関数（slider / plot / heatmap / terrain）と、学習者のコードを実行する仕組み。

Web Worker の中で、Python の起動直後に 1 回だけ読み込まれる。
学習者のコードからは slider() / plot() / heatmap() / terrain() の 4 つが使える。
"""
import array
import json
import linecache
import re
import traceback

USER_FILE = "main.py"

MAX_CELLS = 256 * 256   # 地図・地形の最大マス数
MAX_POINTS = 20000      # グラフ 1 本の最大点数
MAX_PLOTS = 8           # 1 回の実行で描けるグラフの本数
MAX_MAPS = 8            # 1 回の実行で描ける地図の枚数

COLOR_NAMES = ("water", "sand", "grass", "forest", "dirt", "stone", "snow", "ice", "lava")
_HEX_COLOR = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

_emit = None            # 画面側（JavaScript）へデータを渡す関数。Worker が設定する
_params = {}            # 画面のスライダーの現在値（名前 -> 値）
_sliders = {}           # 今回の実行で宣言されたスライダー（名前 -> 設定）
_counts = {"plot": 0, "heatmap": 0}


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def slider(name, low, high, default=None, step=1):
    """画面にスライダーを作り、その現在の値を返す。

    例: seed = slider("シード値", 0, 99, 7)
    """
    if not isinstance(name, str) or not name:
        raise TypeError('slider() の 1 番目には名前を文字列で書いてください。例: slider("シード値", 0, 99, 7)')
    if default is None:
        default = low
    for label, v in (("最小値", low), ("最大値", high), ("最初の値", default), ("刻み幅", step)):
        if not _is_number(v):
            raise TypeError(f'slider("{name}") の{label}は数値にしてください。')
    if high <= low:
        raise ValueError(f'slider("{name}") は 最小値 < 最大値 になるようにしてください。')
    if step <= 0:
        raise ValueError(f'slider("{name}") の刻み幅は 0 より大きくしてください。')
    if name in _sliders:
        return _sliders[name]["value"]

    # 画面のスライダーで動かした値は、ふつうはコードの数字そのものに書き戻される。
    # 書き戻せなかったとき（最初の値が式のときなど）だけ、ここで上書きする。
    # コードの「最初の値」が書き換えられていたら、コードのほうを優先する。
    value = default
    override = _params.get(name)
    if isinstance(override, dict) and override.get("default") == default and _is_number(override.get("value")):
        value = override["value"]
    value = min(max(value, low), high)
    value = low + round((value - low) / step) * step
    value = min(max(value, low), high)
    if all(isinstance(v, int) for v in (low, high, default, step)):
        value = int(round(value))
    else:
        value = round(float(value), 6)

    _sliders[name] = {"name": name, "min": low, "max": high, "step": step,
                      "default": default, "value": value}
    return value


def _to_floats(values, who):
    try:
        buf = array.array("f", values)
    except TypeError:
        raise TypeError(f"{who}には数値のリストを渡してください。例: [0.1, 0.5, -0.2]") from None
    except OverflowError:
        raise ValueError(f"{who}に大きすぎる数が入っています。") from None
    return buf


def plot(ys, label="", xs=None, dots=False, width=2):
    """折れ線グラフを 1 本描く。何回も呼ぶと重ねて表示される。

    ys: 高さのリスト / label: 線の名前 / xs: 横位置のリスト（省略すると 0, 1, 2, ...）
    dots=True にすると線ではなく点で描く。width は線の太さ（ふつうは 2）。
    """
    if _counts["plot"] >= MAX_PLOTS:
        raise RuntimeError(f"plot() は 1 回の実行で {MAX_PLOTS} 本までです。")
    if not _is_number(width) or not 0.5 <= width <= 10:
        raise ValueError("plot() の width（線の太さ）は 0.5 〜 10 の数値にしてください。")
    ybuf = _to_floats(ys, "plot() の 1 番目")
    n = len(ybuf)
    if n == 0:
        raise ValueError("plot() に渡したリストが空です。")
    if n > MAX_POINTS:
        raise ValueError(f"plot() の点が多すぎます（{n} 個）。{MAX_POINTS} 個以下にしてください。")
    xbuf = None
    if xs is not None:
        xbuf = _to_floats(xs, "plot() の xs ")
        if len(xbuf) != n:
            raise ValueError(f"plot() の xs の個数（{len(xbuf)}）が高さの個数（{n}）と違います。")
    _counts["plot"] += 1
    meta = {"label": str(label), "n": n, "dots": bool(dots), "width": width}
    _emit("plot", json.dumps(meta, ensure_ascii=False), ybuf, xbuf)


def _to_grid(grid, who):
    """2 次元リストを「幅・高さ・1 列に並べた数値」に直す。"""
    try:
        h = len(grid)
    except TypeError:
        raise TypeError(f"{who} には 2 次元のリスト（行のリスト）を渡してください。") from None
    if h == 0:
        raise ValueError(f"{who} に渡したリストが空です。")
    buf = array.array("f")
    w = None
    for r, row in enumerate(grid):
        before = len(buf)
        try:
            buf.extend(row)
        except TypeError:
            raise TypeError(f"{who}: {r + 1} 行目が数値のリストになっていません。") from None
        except OverflowError:
            raise ValueError(f"{who}: {r + 1} 行目に大きすぎる数が入っています。") from None
        n = len(buf) - before
        if w is None:
            w = n
            if w == 0:
                raise ValueError(f"{who}: 1 行目が空です。")
            if w * h > MAX_CELLS:
                raise ValueError(f"{who}: マスが多すぎます（{w}×{h}）。256×256 以下にしてください。")
        elif n != w:
            raise ValueError(f"{who}: 行の長さがそろっていません（1 行目は {w} 個、{r + 1} 行目は {n} 個）。")
    return w, h, buf


def heatmap(grid, label="", lo=None, hi=None):
    """2 次元リストを、上から見た白黒の地図として描く（白いほど値が大きい）。

    lo, hi を指定すると、黒と白に対応する値を固定できる（省略すると最小値〜最大値）。
    """
    if _counts["heatmap"] >= MAX_MAPS:
        raise RuntimeError(f"heatmap() は 1 回の実行で {MAX_MAPS} 枚までです。")
    w, h, buf = _to_grid(grid, "heatmap()")
    for name, v in (("lo", lo), ("hi", hi)):
        if v is not None and not _is_number(v):
            raise TypeError(f"heatmap() の {name} は数値にしてください。")
    if lo is not None and hi is not None and hi <= lo:
        raise ValueError("heatmap() は lo < hi になるようにしてください。")
    _counts["heatmap"] += 1
    meta = {"label": str(label), "w": w, "h": h, "lo": lo, "hi": hi}
    _emit("heatmap", json.dumps(meta, ensure_ascii=False), buf, None)


def terrain(heights, blocks=None, sea=None, colors=None):
    """2 次元リストの高さから 3D の地形を描く。高さの単位は「ブロック何個分」。

    blocks: 高さと同じ形の 2 次元リスト。マスごとに、いちばん上のブロックの種類を
            名前（"grass" など）か色コード "#rrggbb" で指定する（colors= と書いても同じ）。
    sea: 海面の高さ（指定すると、その高さまで半透明の水が入る）
    """
    if blocks is not None and colors is not None:
        raise TypeError("terrain() には blocks= と colors= のどちらか片方だけを書いてください。")
    if blocks is not None:
        colors = blocks
    w, h, buf = _to_grid(heights, "terrain()")
    if sea is not None and not _is_number(sea):
        raise TypeError("terrain() の sea は数値にしてください。")
    palette = []
    cbuf = None
    if colors is not None:
        index = {}
        cbuf = array.array("B")
        try:
            rows = len(colors)
        except TypeError:
            raise TypeError("terrain() の blocks には 2 次元のリストを渡してください。") from None
        if rows != h:
            raise ValueError(f"terrain(): blocks の行数（{rows}）が高さの行数（{h}）と違います。")
        for r, row in enumerate(colors):
            if isinstance(row, str) or not hasattr(row, "__len__") or len(row) != w:
                raise ValueError(f"terrain(): blocks の {r + 1} 行目の長さが高さと違います。")
            for name in row:
                k = index.get(name)
                if k is None:
                    if not isinstance(name, str) or not (name in COLOR_NAMES or _HEX_COLOR.match(name)):
                        raise ValueError(
                            f"terrain(): ブロックの種類 {name!r} は使えません。使える名前: "
                            + ", ".join(COLOR_NAMES) + '、または "#rrggbb"')
                    if len(palette) >= 255:
                        raise ValueError("terrain(): 色の種類が多すぎます（255 種類まで）。")
                    k = index[name] = len(palette)
                    palette.append(name)
                cbuf.append(k)
    meta = {"w": w, "h": h, "sea": sea, "palette": palette}
    _emit("terrain", json.dumps(meta, ensure_ascii=False), buf, cbuf)


_HINTS = {
    "SyntaxError": "書き方のまちがいです。かっこ ( ) や引用符 \" \" の閉じ忘れ、行末のコロン : の抜けを確認しましょう。",
    "IndentationError": "字下げ（行の先頭の空白）がそろっていません。同じまとまりの行は、空白 4 個ずつでそろえます。",
    "TabError": "字下げにタブと空白が混ざっています。空白 4 個にそろえましょう。",
    "NameError": "まだ作っていない名前を使っています。つづりのまちがいか、定義より前で使っていないかを確認しましょう。",
    "TypeError": "値の種類が合っていません（数値のはずが文字列やリストになっている、引数の数が違う、など）。",
    "ValueError": "関数に渡した値が、受け付けられる範囲から外れています。",
    "IndexError": "リストの長さを超えた番号を使っています。番号は 0 から「長さ - 1」までです。",
    "KeyError": "辞書にないキーを使っています。",
    "ZeroDivisionError": "0 で割り算をしています。割る数が 0 にならないか確認しましょう。",
    "AttributeError": "その値では使えない機能（.の後ろの名前）を呼び出しています。つづりを確認しましょう。",
    "RecursionError": "関数が自分自身を呼び出し続けて止まらなくなっています。",
    "ModuleNotFoundError": "その名前のモジュールは、この教材の Python には入っていません。",
    "MemoryError": "メモリが足りなくなりました。リストや地図の大きさを小さくしてみましょう。",
}


# Python のエラー文（英語）を日本語に言いかえる。(パターン, 訳) の順に試す。
_TRANSLATIONS = [
    (r"^name '(.+?)' is not defined\. Did you mean: '(.+?)'\?",
     r"「\1」という名前は、まだ作られていません。「\2」のまちがいではありませんか。"),
    (r"^name '(.+?)' is not defined", r"「\1」という名前は、まだ作られていません。"),
    (r"^cannot access local variable '(.+)' where it is not associated with a value",
     r"関数の中で、「\1」に値を入れる前に使っています。"),
    (r"^invalid syntax\. Perhaps you forgot a comma\?", "書き方が正しくありません。カンマ , が抜けていませんか。"),
    (r"^invalid syntax\. Maybe you meant '==' or ':=' instead of '='\?",
     "書き方が正しくありません。「等しいか」を調べるときは = ではなく == と書きます。"),
    (r"^invalid syntax", "書き方が正しくありません。"),
    (r"^'(.)' was never closed", r"かっこ \1 が閉じられていません。"),
    (r"^unmatched '(.)'", r"かっこ \1 に対応する開きかっこがありません。"),
    (r"^expected ':'", "行の最後にコロン : が必要です。"),
    (r"^unterminated string literal", "文字列の引用符が閉じられていません。"),
    (r"^unterminated triple-quoted string literal", "三重引用符の文字列が閉じられていません。"),
    (r"^unexpected indent", "字下げ（行の先頭の空白）が余分にあります。"),
    (r"^expected an indented block after '(.+)' statement on line (\d+)",
     r"\2 行目の \1 の中身として、字下げした行が必要です。"),
    (r"^expected an indented block after (.+) on line (\d+)", r"\2 行目の中身として、字下げした行が必要です。"),
    (r"^unindent does not match any outer indentation level", "字下げの幅が、まわりの行とそろっていません。"),
    (r"^'return' outside function", "return は関数（def）の中でしか使えません。"),
    (r"^unsupported operand type\(s\) for (.+): '(.+)' and '(.+)'",
     r"「\1」は、\2 と \3 の組み合わせでは計算できません。"),
    (r"^can only concatenate (\w+) \(not \"(\w+)\"\) to \w+", r"\1 には \2 をつなげられません。"),
    (r"^'(.+)' object is not callable", r"\1 型の値を、関数のように ( ) を付けて呼び出しています。"),
    (r"^'(.+)' object is not subscriptable", r"\1 型の値は、[ ] で中身を取り出せません。"),
    (r"^'(.+)' object is not iterable", r"\1 型の値は、for で順番に取り出せません。"),
    (r"^(\w+) indices must be integers or slices, not (\w+)", r"\1 の番号は整数にしてください（\2 が使われています）。"),
    (r"^(.+)\(\) missing (\d+) required positional arguments?: (.+)", r"関数 \1() に渡す値が \2 個足りません（\3）。"),
    (r"^(.+)\(\) takes (\d+) positional arguments? but (\d+) (?:was|were) given",
     r"関数 \1() に渡す値が多すぎます（\2 個のはずが \3 個）。"),
    (r"^(.+)\(\) got an unexpected keyword argument '([^']+)'\. Did you mean '([^']+)'\?",
     r"関数 \1() に「\2=」という指定はありません。「\3=」のまちがいではありませんか。"),
    (r"^(.+)\(\) got an unexpected keyword argument '([^']+)'", r"関数 \1() に「\2=」という指定はありません。"),
    (r"^list index out of range", "リストの番号が、リストの長さを超えています。"),
    (r"^(?:float )?division by zero|^division by zero", "0 で割ることはできません。"),
    (r"^math domain error", "数学の関数に、計算できない値（負の数の平方根など）が渡されました。"),
    (r"^'(.+)' object has no attribute '(.+)'", r"\1 型の値には「\2」という機能はありません。"),
    (r"^module '(.+)' has no attribute '(.+)'", r"モジュール \1 には「\2」という機能はありません。"),
    (r"^No module named '(.+)'", r"「\1」というモジュールは、この教材の Python にはありません。"),
    (r"^maximum recursion depth exceeded", "関数が自分自身を呼び出し続けて、止まらなくなりました。"),
    (r"^could not convert string to float: (.+)", r"文字列 \1 は数値に直せません。"),
    (r"^invalid literal for int\(\) with base 10: (.+)", r"文字列 \1 は整数に直せません。"),
]


def _translate(message):
    """英語のエラー文を日本語にする。対応する訳がなければ空文字を返す。"""
    for pattern, ja in _TRANSLATIONS:
        m = re.search(pattern, message)
        if m:
            return m.expand(ja)
    return ""


def _describe(exc):
    """例外を、画面に出しやすい辞書に直す。"""
    etype = type(exc).__name__
    message = str(exc)
    line = None
    source = ""
    trace = []
    if isinstance(exc, SyntaxError) and exc.filename == USER_FILE:
        line = exc.lineno
        source = (exc.text or "").rstrip("\n")
        message = exc.msg or message
    else:
        frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == USER_FILE]
        for f in frames:
            trace.append({"line": f.lineno, "name": f.name, "source": f.line or ""})
        if frames:
            line = frames[-1].lineno
            source = frames[-1].line or ""
    hint = _HINTS.get(etype, "")
    if not hint:
        for base in type(exc).__mro__:
            if base.__name__ in _HINTS:
                hint = _HINTS[base.__name__]
                break
    # 教材の関数（slider など）が出すエラーは、もともと日本語なので訳さない
    ja = "" if re.search(r"[ぁ-んァ-ヶ一-龠]", message) else _translate(message)
    return {"type": etype, "message": message, "message_ja": ja, "line": line,
            "source": source.strip(), "hint": hint, "trace": trace[-6:]}


def _run(code, params_json):
    """学習者のコードを実行し、結果（スライダーの一覧とエラー）を JSON 文字列で返す。"""
    global _params
    _params = json.loads(params_json)
    _sliders.clear()
    _counts["plot"] = 0
    _counts["heatmap"] = 0
    # エラー表示で「何行目のどのコードか」を出せるように、ソースを登録しておく
    linecache.cache[USER_FILE] = (len(code), None, code.splitlines(True), USER_FILE)
    scope = {"__name__": "__main__", "slider": slider, "plot": plot,
             "heatmap": heatmap, "terrain": terrain}
    error = None
    try:
        exec(compile(code, USER_FILE, "exec"), scope)
    except BaseException as exc:  # SystemExit なども含めて、すべて画面に表示する
        error = _describe(exc)
    return json.dumps({"sliders": list(_sliders.values()), "error": error}, ensure_ascii=False)
