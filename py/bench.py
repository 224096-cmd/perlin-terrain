# 性能計測用のコード（ステップ 6 と同じアルゴリズム）。
# 計測タブから、size と octaves を変えながら繰り返し実行される。
import math
import random

size = slider("size", 8, 256, 64)
octaves = slider("octaves", 1, 8, 4)

SEED = 7
HEIGHT = 12
SCALE = 3
PERSISTENCE = 0.5
DIRECTIONS = 6

random.seed(SEED)
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
    """場所 (x, z) の地面の高さ。1 次元のノイズを、向きを変えながら DIRECTIONS 本重ねる"""
    total = 0.0
    for k in range(DIRECTIONS):
        angle = math.pi * k / DIRECTIONS                  # k 本目の向き（0 度から 180 度までを等分）
        p = x * math.cos(angle) + z * math.sin(angle)     # その向きに沿って測った位置
        total += fbm1(p + k * 31.7)                       # 向きごとに、ノイズの違う場所を使う
    return total / math.sqrt(DIRECTIONS)                  # 本数が増えても、高低差が同じくらいになるようにする


heights = []
for j in range(size):
    row = []
    for i in range(size):
        x = i / size * SCALE
        z = j / size * SCALE
        row.append(round(HEIGHT * ground(x, z)))
    heights.append(row)

terrain(heights)
