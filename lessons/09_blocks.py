# ステップ 9: ブロックの世界（低い所は水、高い所は雪）
import math
import random

seed = slider("シード値", 0, 99, 7)
size = slider("地形の大きさ", 16, 64, 48, 16)
height = slider("山の高さ", 2, 40, 18)
scale = slider("地形の細かさ", 1, 8, 3)
sea = slider("海面の高さ", 0, 20, 8)

OCTAVES = 4
PERSISTENCE = 0.5

def make_tables():
    """ノイズに使う表を作る（ステップ 6 と同じ）。かき混ぜた番号の表と、256 本の矢印を返す"""
    random.seed(seed)
    perm = list(range(256))
    random.shuffle(perm)
    arrows = []
    for i in range(256):
        angle = random.uniform(0, 2 * math.pi)
        arrows.append((math.cos(angle), math.sin(angle)))
    return perm, arrows


perm, arrows = make_tables()


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


def top_block(h):
    """高さ h の場所の、いちばん上のブロックの種類を決める（上から順に調べる）"""
    if h < sea:
        return "water"      # 海面より低い所は水
    if h <= sea + 1:
        return "sand"       # 水ぎわは砂
    if h <= sea + 7:
        return "grass"      # その上は草
    if h <= sea + 11:
        return "stone"      # 高い所は岩
    return "snow"           # どれにも当てはまらない、いちばん高い所は雪


heights = []
blocks = []
for j in range(size):
    height_row = []
    block_row = []
    for i in range(size):
        x = i / size * scale
        y = j / size * scale
        h = round(10 + height * fbm(x, y))  # round: 四捨五入して整数（ブロックの個数）にする
        block = top_block(h)
        if block == "water":
            h = sea                         # 水は、海面の高さまで満たす
        height_row.append(h)
        block_row.append(block)
    heights.append(height_row)
    blocks.append(block_row)

terrain(heights, blocks=blocks)
