# perlin-terrain

Pyodide を用いたブラウザ完結型プロシージャル地形生成学習教材（卒業研究）

公開ページ: https://224096-cmd.github.io/perlin-terrain/

## 概要

Perlin Noise（自然な凹凸を作る乱数の一種）による地形生成の仕組みを、
ブラウザ上で Python コードを書き換えながら学ぶ Web 教材です。

- Python の実行: Pyodide（Python をブラウザ内で動かす仕組み）
- 3D 表示: Three.js（ブラウザ用の 3D 描画ライブラリ）
- 公開: GitHub Pages（インストール・環境構築は不要）

## 現在の版

v0.1.0 … 雛形（公開の確認と、端末の対応状況チェックのみ）

## 開発の予定

1. 雛形を GitHub Pages に表示する（この版）
2. Pyodide で Python コードを実行する
3. 1 次元ノイズの学習ステップ
4. 2 次元 Perlin Noise の学習ステップ
5. オクターブ合成（細かさの違うノイズの重ね合わせ）の学習ステップ
6. Three.js による 3D 地形・ブロック表示
7. 計測結果・学習ログの CSV / JSON 書き出し

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | トップページ |
| `.github/workflows/pages.yml` | push すると GitHub Pages に自動で公開する設定 |
| `.gitattributes` | 改行コードの統一 |
| `.gitignore` | リポジトリに入れないファイルの指定 |

## 更新のしかた

1. 更新版の zip を `C:\sotsuken\perlin-terrain` に展開する
2. `git add -A` → `git commit` → `git push`
3. 1〜2 分後に公開ページを開き、画面の版番号が変わったことを確認する
