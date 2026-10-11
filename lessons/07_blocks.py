# ステップ 7: ブロックの世界（低い所は水、高い所は雪）
import math
import random

seed = slider("シード値", 0, 99, 7)
size = slider("地形の大きさ", 16, 64, 48, 16)
height = slider("山の高さ", 2, 40, 16)
scale = slider("地形の細かさ", 1, 8, 3)
sea = slider("海面の高さ", 0, 20, 8)

OCTAVES = 4
PERSISTENCE = 0.5
DIRECTIONS = 6

random.seed(seed)
slopes = [random.uniform(-1, 1) for i in range(256)]


def lerp(a, b, t):
    return a + (b - a) * t


def fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def perlin1(x):
    """1 次元パーリンノイズ（ステップ 3 と同じ）。位置 x の高さを返す"""
    i = math.floor(x)
    t = x - i
    left = slopes[i % 256] * t
    right = slopes[(i + 1) % 256] * (t - 1)
    return lerp(left, right, fade(t)) * 2


def fbm1(x):
    """オクターブ合成したノイズ（ステップ 5 と同じ）。位置 x の高さを返す"""
    total = 0.0
    freq = 1.0
    amp = 1.0
    for o in range(OCTAVES):
        total += amp * perlin1(x * freq + o * 17.3)
        freq *= 2
        amp *= PERSISTENCE
    return total


def ground(x, z):
    """場所 (x, z) の地面の高さ。1 次元のノイズを、向きを変えながら DIRECTIONS 本重ねる"""
    total = 0.0
    for k in range(DIRECTIONS):
        angle = math.pi * k / DIRECTIONS                  # k 本目の向き（0 度から 180 度までを等分）
        p = x * math.cos(angle) + z * math.sin(angle)     # その向きに沿って測った位置
        total += fbm1(p + k * 31.7)                       # 向きごとに、ノイズの違う場所を使う
    return total / math.sqrt(DIRECTIONS)                  # 本数が増えても、高低差が同じくらいになるようにする


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
        z = j / size * scale
        h = round(10 + height * ground(x, z))
        block = top_block(h)
        if block == "water":
            h = sea                         # 水は、海面の高さまで満たす
        height_row.append(h)
        block_row.append(block)
    heights.append(height_row)
    blocks.append(block_row)

terrain(heights, blocks=blocks)
