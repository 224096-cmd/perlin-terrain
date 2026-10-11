# ステップ 6: 2 次元に広げる（上から見た地図を作る）
import math
import random

seed = slider("シード値", 0, 99, 7)
freq = slider("周波数（模様の細かさ）", 1, 12, 4)
size = slider("地図の大きさ", 16, 96, 48, 16)

random.seed(seed)

# 番号をかき混ぜた表。格子点の場所から「どの矢印を使うか」を決めるのに使う
perm = list(range(256))
random.shuffle(perm)

# 矢印（勾配ベクトル）: 長さ 1 で向きがばらばらの矢印を 256 本
arrows = []
for i in range(256):
    angle = random.uniform(0, 2 * math.pi)
    arrows.append((math.cos(angle), math.sin(angle)))


def lerp(a, b, t):
    return a + (b - a) * t


def fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def corner(ix, iy, x, y):
    """格子点 (ix, iy) の矢印が、点 (x, y) の高さをどれだけ押し上げるか"""
    ax, ay = arrows[perm[(perm[ix % 256] + iy) % 256]]   # この格子点の矢印
    dx = x - ix                                          # 格子点から見た点の位置
    dy = y - iy
    return ax * dx + ay * dy                             # 内積（矢印の向きに進むほど大きい）


def perlin2(x, y):
    """2 次元パーリンノイズ。場所 (x, y) の高さを返す（だいたい -0.7 〜 0.7）"""
    ix = math.floor(x)      # 点を囲む四角形の、左上の格子点
    iy = math.floor(y)
    u = fade(x - ix)        # 四角形の中での位置 (0〜1) を S 字カーブに通す
    v = fade(y - iy)
    # 4 つの角の影響を、まず横方向、次に縦方向に混ぜる
    top = lerp(corner(ix, iy, x, y), corner(ix + 1, iy, x, y), u)
    bottom = lerp(corner(ix, iy + 1, x, y), corner(ix + 1, iy + 1, x, y), u)
    return lerp(top, bottom, v)


grid = []                           # 2 次元リスト（行のリスト）
for j in range(size):               # j: 縦方向（行）
    row = []
    for i in range(size):           # i: 横方向（列）
        x = i / size * freq
        y = j / size * freq
        row.append(perlin2(x, y))
    grid.append(row)

heatmap(grid, "2 次元パーリンノイズ（白いほど高い）")
plot(grid[size // 2], "真ん中の行を横に切った断面")
