# ステップ 9: ブロックの世界（海・砂・草・岩・雪）
import math
import random

seed = slider("シード値", 0, 99, 7)
size = slider("地形の大きさ", 16, 64, 48, 16)
height = slider("山の高さ", 2, 40, 18)
scale = slider("地形の細かさ", 1, 8, 3)
sea = slider("海面の高さ", 0, 20, 8)

OCTAVES = 4
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


def block_color(h):
    """高さ h（ブロック何個分か）から、いちばん上のブロックの種類を決める"""
    if h <= sea + 1:
        return "sand"       # 海面の近くは砂
    elif h <= sea + 7:
        return "grass"      # その上は草
    elif h <= sea + 11:
        return "stone"      # 高い所は岩
    else:
        return "snow"       # もっと高い所は雪


heights = []
colors = []
for j in range(size):
    height_row = []
    color_row = []
    for i in range(size):
        x = i / size * scale
        y = j / size * scale
        h = round(10 + height * fbm(x, y))  # round: 四捨五入して整数（ブロックの個数）にする
        height_row.append(h)
        color_row.append(block_color(h))
    heights.append(height_row)
    colors.append(color_row)

terrain(heights, sea=sea, colors=colors)
