# ステップ 6: 3D の地形にする
import math
import random

seed = slider("シード値", 0, 99, 7)
size = slider("地形の大きさ", 16, 64, 48, 16)
height = slider("山の高さ", 2, 40, 12)
scale = slider("地形の細かさ", 1, 8, 3)
octaves = slider("オクターブ数", 1, 5, 4)
directions = slider("重ねる向きの数", 1, 8, 6)
move = slider("東へ移動", 0, 200, 0, 2)

PERSISTENCE = 0.5

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
    for o in range(octaves):
        total += amp * perlin1(x * freq + o * 17.3)
        freq *= 2
        amp *= PERSISTENCE
    return total


def ground(x, z):
    """場所 (x, z) の地面の高さ。1 次元のノイズを、向きを変えながら directions 本重ねる"""
    total = 0.0
    for k in range(directions):
        angle = math.pi * k / directions                  # k 本目の向き（0 度から 180 度までを等分）
        p = x * math.cos(angle) + z * math.sin(angle)     # その向きに沿って測った位置
        total += fbm1(p + k * 31.7)                       # 向きごとに、ノイズの違う場所を使う
    return total / math.sqrt(directions)                  # 本数が増えても、高低差が同じくらいになるようにする


heights = []                                # 行ごとの高さを入れていくリスト
for j in range(size):                       # j: 奥行き方向に何マス目か
    row = []
    for i in range(size):                   # i: 横方向に何マス目か
        x = (i + move) / size * scale       # 横の位置（move を足すと、地形の別の場所が見える）
        z = j / size * scale                # 奥行きの位置
        h = round(height * ground(x, z))    # round: 四捨五入して整数（ブロックの個数）にする
        row.append(h)
    heights.append(row)

terrain(heights)
