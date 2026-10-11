# ステップ 7: オクターブ合成（細かさの違うノイズを重ねる）
import math
import random

seed = slider("シード値", 0, 99, 7)
octaves = slider("オクターブ数（重ねる枚数）", 1, 6, 4)
persistence = slider("持続度（振幅の残り方）", 0.1, 0.9, 0.5, 0.1)
base_freq = slider("最初の周波数", 1, 8, 2)

random.seed(seed)
slopes = [random.uniform(-1, 1) for i in range(256)]


def lerp(a, b, t):
    return a + (b - a) * t


def fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def perlin1(x):
    i = math.floor(x)
    t = x - i
    left = slopes[i % 256] * t
    right = slopes[(i + 1) % 256] * (t - 1)
    return lerp(left, right, fade(t)) * 2


WIDTH = 400
total = [0.0] * WIDTH       # 全部の層を足した高さ

freq = base_freq
amp = 1.0
for o in range(octaves):
    layer = []
    for k in range(WIDTH):
        x = k / WIDTH
        # + o * 17.3 は、層ごとにノイズの違う場所を使うためのずらし
        layer.append(amp * perlin1(x * freq + o * 17.3))
    plot(layer, f"{o + 1} 層目（周波数 {freq}、振幅 {amp:.2f}）")

    for k in range(WIDTH):
        total[k] += layer[k]

    freq *= 2               # 次の層は 2 倍細かく
    amp *= persistence      # 次の層は低く

plot(total, "合計（地形の形）", width=4)     # width: 線の太さ
