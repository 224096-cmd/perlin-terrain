# ステップ 8: 3D の地形にする
import math
import random

seed = slider("シード値", 0, 99, 7)
size = slider("地形の大きさ", 16, 96, 48, 16)
height = slider("山の高さ", 2, 40, 10)
scale = slider("地形の細かさ", 1, 8, 3)
octaves = slider("オクターブ数", 1, 6, 4)
persistence = slider("持続度", 0.1, 0.9, 0.5, 0.1)
move = slider("東へ移動", 0, 200, 0, 2)

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
    """オクターブ合成したノイズ。場所 (x, y) の高さを返す（だいたい -1 〜 1）"""
    total = 0.0
    freq = 1.0
    amp = 1.0
    for o in range(octaves):
        total += amp * perlin2(x * freq + o * 17.3, y * freq + o * 17.3)
        freq *= 2
        amp *= persistence
    return total


heights = []
for j in range(size):
    row = []
    for i in range(size):
        x = (i + move) / size * scale   # move を足すと、地形の別の場所が見える
        y = j / size * scale
        row.append(height * fbm(x, y))  # 高さの単位は「ブロック何個分」
    heights.append(row)

terrain(heights)
heatmap(heights, "上から見た地図")
