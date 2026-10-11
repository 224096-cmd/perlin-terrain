# ステップ 9: 3D でも 3 つの作り方を比べる
import math
import random

seed = slider("シード値", 0, 99, 7)
size = slider("地形の大きさ", 16, 40, 32, 4)
height = slider("山の高さ", 2, 12, 5)
waves = slider("山の細かさ", 1, 6, 3)
move = slider("東へ移動", 0, 200, 0, 2)

OCTAVES = 3
DIRECTIONS = 6

random.seed(seed)
slopes = [random.uniform(-1, 1) for i in range(256)]                                 # パーリンノイズ用の傾き
randoms = [[random.uniform(-1, 1) for i in range(256)] for j in range(64)]           # 乱数の地形用（マスごとに 1 個）


def lerp(a, b, t):
    return a + (b - a) * t


def fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def perlin1(x):
    """1 次元パーリンノイズ（ステップ 4 と同じ）"""
    i = math.floor(x)
    t = x - i
    left = slopes[i % 256] * t
    right = slopes[(i + 1) % 256] * (t - 1)
    return lerp(left, right, fade(t)) * 2


def fbm1(x):
    """オクターブ合成したノイズ（ステップ 7 と同じ）"""
    total = 0.0
    freq = 1.0
    amp = 1.0
    for o in range(OCTAVES):
        total += amp * perlin1(x * freq + o * 17.3)
        freq *= 2
        amp *= 0.5
    return total


def ground(x, z):
    """1 次元のノイズを、向きを変えながら重ねる（ステップ 8 と同じ）"""
    total = 0.0
    for k in range(DIRECTIONS):
        angle = math.pi * k / DIRECTIONS
        p = x * math.cos(angle) + z * math.sin(angle)
        total += fbm1(p + k * 31.7)
    return total / math.sqrt(DIRECTIONS)


def random_ground(i, j):
    """乱数: マス (i, j) の高さを、となりと無関係に決める"""
    return randoms[j % 64][i % 256]


def wave_ground(i, j):
    """くり返し: サイン波。同じ形の山が、同じ間隔で並ぶ"""
    x = i / size * waves * 2 * math.pi
    z = j / size * waves * 2 * math.pi
    return (math.sin(x) + math.sin(z)) / 2


def perlin_ground(i, j):
    """パーリンノイズ: なめらかで、同じ形がくり返さない"""
    return 1.5 * ground(i / size * waves, j / size * waves)     # 1.5 倍して、高低差をほかの 2 つとそろえる


def make(height_at):
    """マスごとの高さを決める関数 height_at を受け取って、size × size の地形を作る"""
    rows = []
    for j in range(size):                       # j: 奥行き方向に何マス目か
        row = []
        for i in range(size):                   # i: 横方向に何マス目か
            h = round(height * height_at(i + move, j))
            row.append(h)
        rows.append(row)
    return rows


# terrain() を 3 回呼ぶと、3 つの地形が横に並ぶ（label は地形の上に出る名前）
terrain(make(random_ground), label="乱数")
terrain(make(wave_ground), label="くり返し")
terrain(make(perlin_ground), label="パーリンノイズ")
