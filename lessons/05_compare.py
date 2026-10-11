# ステップ 5: 3 つの作り方を比べる
import math
import random

seed = slider("シード値", 0, 99, 7)
start = slider("右へ歩く", 0, 400, 0, 4)
waves = slider("山の細かさ", 2, 12, 6)

N = 72                      # 画面に出す点の数（ブロックの柱 72 本）

random.seed(seed)
slopes = [random.uniform(-1, 1) for i in range(256)]        # パーリンノイズ用の傾き
randoms = [random.uniform(-1, 1) for i in range(1024)]      # 乱数の地面用（場所ごとの高さ）


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


def random_ground(i):
    """乱数: 場所 i の高さを、となりと無関係に決める"""
    return randoms[i % 1024]


def wave_ground(i):
    """くり返し: サイン波。同じ形の山と谷が、同じ間隔で続く"""
    return 0.7 * math.sin(i / N * waves * 2 * math.pi)


def perlin_ground(i):
    """パーリンノイズ: となりとはなめらかにつながり、先の形は決まっていない"""
    return 1.5 * perlin1(i / N * waves)     # 1.5 倍は、ほかの 2 つと高さをそろえるため


def roughness(ys):
    """となり同士の高さの差の平均。大きいほど、でこぼこが激しい"""
    total = 0.0
    for k in range(len(ys) - 1):
        total += abs(ys[k + 1] - ys[k])
    return total / (len(ys) - 1)


a = []
b = []
c = []
for k in range(N):
    i = start + k                   # いま見ている場所（左端が start）
    a.append(random_ground(i))
    b.append(wave_ground(i))
    c.append(perlin_ground(i))

plot(a, "乱数")
plot(b, "くり返し（サイン波）")
plot(c, "パーリンノイズ")

print("となり同士の高さの差（平均）")
print("  乱数:          ", round(roughness(a), 3))
print("  くり返し:      ", round(roughness(b), 3))
print("  パーリンノイズ:", round(roughness(c), 3))
