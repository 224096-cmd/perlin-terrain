# ステップ 6: 周波数と振幅
import math
import random

seed = slider("シード値", 0, 99, 7)
freq = slider("周波数（山の細かさ）", 0.5, 16, 4, 0.5)
amp = slider("振幅（山の高さ）", 0.1, 1.0, 0.5, 0.1)

random.seed(seed)
slopes = [random.uniform(-1, 1) for i in range(256)]   # リストを 1 行で作る書き方


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


WIDTH = 300                 # 横方向の点の数
shift = 0                   # ノイズのどの場所から使うか（ずらす量）
ys = []
for k in range(WIDTH):
    x = k / WIDTH           # 横位置を 0 〜 1 に直す
    # 周波数: x に掛ける（進む速さを変える） / 振幅: 結果に掛ける（高さを変える）
    ys.append(amp * perlin1(x * freq + shift))

plot(ys, "地面")
print("いちばん高い所:", round(max(ys), 3), " いちばん低い所:", round(min(ys), 3))
