# 性能計測用のコード（ステップ 8 と同じアルゴリズム）。
# 計測タブから、size と octaves を変えながら繰り返し実行される。
import math
import random

size = slider("size", 8, 256, 64)
octaves = slider("octaves", 1, 8, 4)

SEED = 7
HEIGHT = 16
SCALE = 3
PERSISTENCE = 0.5

random.seed(SEED)
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
    for o in range(octaves):
        total += amp * perlin2(x * freq + o * 17.3, y * freq + o * 17.3)
        freq *= 2
        amp *= PERSISTENCE
    return total


heights = []
for j in range(size):
    row = []
    for i in range(size):
        x = i / size * SCALE
        y = j / size * SCALE
        row.append(HEIGHT * fbm(x, y))
    heights.append(row)

terrain(heights)
