# perlin-terrain

Pyodide を用いたブラウザ完結型プロシージャル地形生成学習教材（卒業研究）

公開ページ: https://224096-cmd.github.io/perlin-terrain/

現在の版: v1.0.0

## 概要

パーリンノイズ（自然な起伏を作る乱数の一種）による地形生成のしくみを、
ブラウザ上で Python コードを書き換えながら学ぶ Web 教材です。

- インストールや環境構築は不要です。ページを開くだけで Python が動きます。
- Python の実行も 3D の描画も、すべて利用者のブラウザの中で行います（サーバでは計算しません）。
- ホーム画面やデスクトップにアプリとして追加できます。

## 画面

| タブ | 内容 |
|---|---|
| 学ぶ | 10 個のステップ。説明を読み、Python コードを実行・書き換えて、グラフ・地図・3D 地形で結果を確かめる |
| 計測 | 端末の情報、Python の起動時間、地形の生成・表示時間を測り、CSV / JSON / Markdown で保存する |
| 記録 | 学習の履歴（実行回数、エラー、スライダー操作など）を集計し、CSV / JSON / Markdown で保存する |

## 学習ステップ

| ステップ | タイトル | 学ぶこと | 表示 |
|---|---|---|---|
| 1 | 乱数だけで地面を作る | 乱数、シード値 | グラフ |
| 2 | 点と点をなめらかにつなぐ | 格子点、線形補間、fade 関数 | グラフ |
| 3 | パーリンノイズ（1 次元） | 傾き（勾配）による補間 | グラフ |
| 4 | 周波数と振幅 | 山の細かさと高さの調整 | グラフ |
| 5 | オクターブ合成 | 細かさの違うノイズの重ね合わせ、持続度 | グラフ |
| 6 | 2 次元に広げる | 勾配ベクトル、内積、2 次元リスト | 地図・グラフ |
| 7 | 2 次元のオクターブ合成 | 各層と合計の比較 | 地図 |
| 8 | 3D の地形にする | fbm 関数、どこまでも続く地形 | 3D・地図 |
| 9 | ブロックの世界 | 高さの整数化、条件分岐によるブロックの種類分け、海面 | 3D |
| 10 | 自分だけの島を作る | マスク、自由制作 | 3D |

## 教材用の Python 関数

学習者のコードからは、次の 4 つの関数が使えます（定義は `py/prelude.py`）。

| 関数 | はたらき |
|---|---|
| `slider(名前, 最小, 最大, 最初の値, 刻み幅=1)` | 画面にスライダーを作り、現在の値を返す。動かすとコードが再実行される |
| `plot(ys, label="", xs=None, dots=False, width=2)` | 数値のリストを折れ線グラフ（または点）で描く。8 本まで重ねられる |
| `heatmap(grid, label="", lo=None, hi=None)` | 2 次元リストを白黒の地図で描く（白いほど大きい）。8 枚まで |
| `terrain(heights, sea=None, colors=None)` | 2 次元リストを高さとして 3D 地形を描く。`sea` は海面の高さ、`colors` はマスごとの色 |

`colors` に使える名前: `water` `sand` `grass` `forest` `dirt` `stone` `snow` `ice` `lava`、または `"#rrggbb"`。

## しくみ（データの流れ）

```
[画面: js/main.js]                         [Web Worker: js/py-worker.js]
 コード + スライダーの値  ── postMessage ──▶  Pyodide が Python コードを実行
                                             plot() / heatmap() / terrain() が呼ばれる
                                             Python の array.array を Float32Array にコピー
 グラフ / 地図 / 3D を描画 ◀── postMessage ──  ArrayBuffer を転送（コピーなしで受け渡し）
```

- Python は Web Worker（画面とは別のスレッド）で動くので、計算中も画面は固まりません。
- 終わらないコード（無限ループなど）は、20 秒で Worker ごと止めて作り直します。「止める」ボタンでも止められます。
- 3D 表示のプログラム（three.js）は、最初に `terrain()` が呼ばれたときに読み込みます。

## ファイル構成

| 場所 | 役割 |
|---|---|
| `index.html` | 画面の骨組み |
| `css/style.css` | 見た目 |
| `js/main.js` | 画面全体のまとめ役（ステップ切り替え、実行、表示、記録） |
| `js/runner.js` | Python 実行の窓口（Worker の起動・停止・時間切れ） |
| `js/py-worker.js` | Pyodide を動かす Web Worker |
| `js/lessons.js` | 各ステップの説明文 |
| `js/views/plot.js` `heatmap.js` `terrain3d.js` | グラフ・地図・3D の表示 |
| `js/trail.js` | ステップ一覧（山の断面図） |
| `js/log.js` | 学習記録と書き出し |
| `js/bench.js` `js/noise-ref.js` | 性能計測と、比較用の JavaScript 実装 |
| `js/version.js` | 版番号（ここ 1 か所だけを書き換える） |
| `py/prelude.py` | 教材用の Python 関数と、コード実行・エラー整形 |
| `py/bench.py` | 計測用の Python コード |
| `lessons/*.py` | 各ステップのお手本コード |
| `vendor/` | 同梱ライブラリ（Pyodide、three.js、CodeMirror） |
| `manifest.webmanifest` `sw.js` `icons/` | アプリとして追加するための設定 |
| `.github/workflows/pages.yml` | push すると GitHub Pages に自動で公開する設定 |

## 書き出されるデータ

### 学習記録（記録タブ）の CSV の列

| 列 | 意味 |
|---|---|
| `timestamp` | 日時（UTC、ISO 8601 形式） |
| `session` | ページを開くたびに変わる ID（個人を特定する情報ではない） |
| `step` / `lesson` | ステップ番号と ID |
| `event` | `session_start` / `lesson_open` / `run` / `slider` / `code_reset` / `view_mode` / `stop` |
| `trigger` | 実行のきっかけ。`open`（ステップを開いた）/ `button` / `shortcut` / `slider` / `reset` |
| `ok` | 実行がエラーなく終わったか |
| `error_type` / `error_line` | エラーの種類（`NameError`、`Timeout`、`Stopped` など）と行番号 |
| `python_ms` | Python の計算時間 |
| `transfer_ms` | Python から画面側へのデータ受け渡し時間 |
| `render_ms` | グラフ・地図・3D の表示にかかった時間 |
| `total_ms` | 実行を頼んでから表示が終わるまでの時間 |
| `code_chars` / `code_edited` | コードの文字数と、お手本から書き換えられているか |
| `outputs` | 表示したものの数（例: `plot:2 heatmap:1`） |
| `slider_name` / `slider_value` | 動かしたスライダーの名前と値 |
| `detail` | エラーメッセージなどの補足 |

記録は利用者のブラウザの中（localStorage）だけに保存され、外部には送信されません。最大 8,000 件で、古いものから消えます。

### 性能計測（計測タブ）の CSV の列

| 列 | 意味 |
|---|---|
| `size` / `cells` | 地形の一辺のマス数と、全体のマス数 |
| `octaves` | オクターブ数（4 で固定） |
| `trial` | 何回目の計測か |
| `python_ms` | `py/bench.py` を Pyodide で実行した時間（受け渡しを除く） |
| `transfer_ms` | Python の配列を Float32Array にコピーする時間 |
| `roundtrip_ms` | 画面側が実行を頼んでから結果を受け取るまでの時間 |
| `js_ms` | 同じアルゴリズムを JavaScript で実行した時間（1 回あたり） |
| `smooth_ms` / `blocks_ms` | 3D の形を作り、1 回描き終えるまでの時間（なめらか / ブロック） |

JSON には、これに加えて端末情報と Python の起動時間が入ります。

## 更新のしかた

1. 更新版の zip を `C:\sotsuken\perlin-terrain` に展開する
2. `git add -A` → `git commit` → `git push`
3. 1〜2 分後に公開ページを開き、左上の版番号が変わったことを確認する

## 利用しているライブラリ

Pyodide（MPL-2.0）、three.js（MIT）、CodeMirror 5（MIT）。詳しくは `THIRD_PARTY_NOTICES.md`。
