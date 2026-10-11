# 利用しているライブラリとライセンス

この教材は、次のオープンソースソフトウェアを `vendor/` フォルダに同梱して利用しています。
いずれも無料で利用・再配布できるライセンスです。

| ライブラリ | 版 | 用途 | ライセンス | 入手元 |
|---|---|---|---|---|
| Pyodide | 314.0.7 | ブラウザ内で Python を実行する | Mozilla Public License 2.0 | https://github.com/pyodide/pyodide |
| CPython（Pyodide に含まれる） | 3.14.2 | Python 本体と標準ライブラリ | Python Software Foundation License | https://www.python.org/ |
| three.js | 0.186.1 | 3D 表示（WebGL） | MIT License | https://github.com/mrdoob/three.js |
| CodeMirror 5 | 5.65.21 | コードエディタ | MIT License | https://github.com/codemirror/codemirror5 |

- 各ライブラリのファイルは、npm で配布されているものを変更せずにそのまま置いています。
- ライセンスの全文は `vendor/pyodide/LICENSE`、`vendor/three/LICENSE`、`vendor/codemirror/LICENSE` にあります。
- Pyodide のソースコードは上記の入手元（タグ `314.0.7`）から取得できます。

グラフの配色は、色覚の多様性に配慮して検証された 8 色を、決まった順番で使っています。
