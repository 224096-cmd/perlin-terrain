# ステップ 3: パーリンノイズ（1 次元）
import math
import random

seed = slider("シード値", 0, 99, 7)
length = slider("表示する長さ", 2, 20, 8)

random.seed(seed)

# 格子点ごとに「高さ」ではなく「傾き」を決めておく（256 個）
slopes = []
for i in range(256):
    slopes.append(random.uniform(-1, 1))


def lerp(a, b, t):
    return a + (b - a) * t


def fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def perlin1(x):
    """1 次元パーリンノイズ。横位置 x の高さを返す（だいたい -1 〜 1）"""
    i = math.floor(x)        # 左どなりの格子点の番号
    t = x - i                # そこからどれだけ進んだか (0〜1)
    # それぞれの格子点から、決めた傾きでまっすぐ線を伸ばしたときの高さ
    left = slopes[i % 256] * t
    right = slopes[(i + 1) % 256] * (t - 1)
    # 2 本の線を S 字カーブでなめらかに混ぜる
    return lerp(left, right, fade(t)) * 2    # ×2 は高さを -1〜1 くらいにそろえるため


STEPS = 30
xs = []
ys = []
for k in range(length * STEPS + 1):
    x = k / STEPS
    xs.append(x)
    ys.append(perlin1(x))

plot(ys, "パーリンノイズ", xs)
plot([0] * (length + 1), "格子点（高さはいつも 0）", dots=True)
