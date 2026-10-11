# ステップ 10: 自由制作（自分だけの島を作る）
import math
import random

seed = slider("シード値", 0, 99, 21)
size = slider("地形の大きさ", 16, 96, 64, 16)
height = slider("山の高さ", 4, 80, 44)
scale = slider("地形の細かさ", 1, 8, 3)
sea = slider("海面の高さ", 0, 20, 5)

OCTAVES = 5
PERSISTENCE = 0.5

random.seed(seed)
perm = list(range(256))
random.shuffle(perm)
arrows = []
for i in range(256):
    angle = random.uniform(0, 2 * math.pi)
    arrows.append((math.cos(angle), math.sin(angle)))


def lerp(a, b, t):
    return a + (b - a) * t


def fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def corner(ix, iy, x, y):
    ax, ay = arrows[perm[(perm[ix % 256] + iy) % 256]]
    return ax * (x - ix) + ay * (y - iy)


def perlin2(x, y):
    ix = math.floor(x)
    iy = math.floor(y)
    u = fade(x - ix)
    v = fade(y - iy)
    top = lerp(corner(ix, iy, x, y), corner(ix + 1, iy, x, y), u)
    bottom = lerp(corner(ix, iy + 1, x, y), corner(ix + 1, iy + 1, x, y), u)
    return lerp(top, bottom, v)


def fbm(x, y):
    total = 0.0
    freq = 1.0
    amp = 1.0
    for o in range(OCTAVES):
        total += amp * perlin2(x * freq + o * 17.3, y * freq + o * 17.3)
        freq *= 2
        amp *= PERSISTENCE
    return total


def island_mask(i, j):
    """島の形を作る。中心で 1、端に近づくほど 0 になる数を返す"""
    dx = (i - size / 2) / (size / 2)    # 中心からの横のずれ (-1〜1)
    dy = (j - size / 2) / (size / 2)    # 中心からの縦のずれ (-1〜1)
    d = math.sqrt(dx * dx + dy * dy)    # 中心からの距離
    return max(0.0, 1 - d * d)


def block_color(h):
    if h <= sea + 1:
        return "sand"
    elif h <= sea + 7:
        return "grass"
    elif h <= sea + 13:
        return "forest"
    elif h <= sea + 20:
        return "stone"
    else:
        return "snow"


heights = []
colors = []
for j in range(size):
    height_row = []
    color_row = []
    for i in range(size):
        x = i / size * scale
        y = j / size * scale
        n = fbm(x, y)                   # ノイズ（だいたい -1 〜 1）
        e = (n + 1) / 2                 # 0 〜 1 に直す
        h = round(height * e * island_mask(i, j))
        height_row.append(h)
        color_row.append(block_color(h))
    heights.append(height_row)
    colors.append(color_row)

terrain(heights, sea=sea, colors=colors)
