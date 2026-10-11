# ステップ 3: 点と点をなめらかにつなぐ（補間）
import random

seed = slider("シード値", 0, 99, 7)
points = slider("格子点の数", 3, 20, 8)
smooth = slider("つなぎ方（0: 直線 / 1: S字）", 0, 1, 1)

random.seed(seed)

# 格子点（こうしてん）: 等間隔に置いた目印の点。ここだけ乱数で高さを決める
values = []
for i in range(points):
    values.append(random.uniform(-1, 1))


def lerp(a, b, t):
    """a と b を t (0〜1) の割合で混ぜる（線形補間）"""
    return a + (b - a) * t


def fade(t):
    """0〜1 の数を、出だしと終わりがゆるやかな S 字カーブに変える"""
    return t * t * t * (t * (t * 6 - 15) + 10)


def value_noise(x):
    """横位置 x の高さを、両どなりの格子点から計算する"""
    i = int(x)          # 左どなりの格子点の番号
    t = x - i           # そこからどれだけ進んだか (0〜1)
    if smooth == 1:
        t = fade(t)
    left = values[i]
    right = values[(i + 1) % points]   # % は割ったあまり。最後の次は最初に戻る
    return lerp(left, right, t)


# 格子点の間を細かく区切って、高さを計算する
STEPS = 30                      # 格子点 1 区間を何分割するか
xs = []
ys = []
for k in range((points - 1) * STEPS + 1):
    x = k / STEPS
    xs.append(x)
    ys.append(value_noise(x))

plot(ys, "補間した地面", xs)
plot(values, "格子点（乱数で決めた高さ）", dots=True)
