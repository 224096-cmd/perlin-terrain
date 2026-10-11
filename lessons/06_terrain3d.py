# ステップ 6: 3D の地形にする
import math
import random

seed = slider("シード値", 0, 99, 7)
size = slider("地形の大きさ", 16, 96, 48, 16)
height = slider("山の高さ", 2, 40, 12)
scale = slider("地形の細かさ", 1, 8, 3)
octaves = slider("オクターブ数", 1, 6, 4)
depth = slider("奥行きの変化", 0, 1, 1, 0.1)
move = slider("東へ移動", 0, 200, 0, 2)

PERSISTENCE = 0.5


def make_tables():
    """ノイズに使う表を作る。かき混ぜた番号の表と、向きがばらばらな 256 本の矢印を返す"""
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
    """格子点 (ix, iy) の矢印が、点 (x, y) の高さをどれだけ押し上げるか"""
    ax, ay = arrows[perm[(perm[ix % 256] + iy) % 256]]   # この格子点の矢印
    return ax * (x - ix) + ay * (y - iy)                 # 内積（矢印の向きに進むほど大きい）


def perlin2(x, y):
    """場所を 2 つの数 (x, y) で表すパーリンノイズ。その場所の高さを返す（だいたい -0.7 〜 0.7）"""
    ix = math.floor(x)      # 点を囲む四角形の、左手前の格子点
    iy = math.floor(y)
    u = fade(x - ix)        # 四角形の中での位置 (0〜1) を S 字カーブに通す
    v = fade(y - iy)
    # 4 つの角の影響を、まず横方向、次に奥行き方向に混ぜる
    near = lerp(corner(ix, iy, x, y), corner(ix + 1, iy, x, y), u)
    far = lerp(corner(ix, iy + 1, x, y), corner(ix + 1, iy + 1, x, y), u)
    return lerp(near, far, v)


def fbm(x, y):
    """オクターブ合成（ステップ 5）を、場所 (x, y) について行う"""
    total = 0.0
    freq = 1.0
    amp = 1.0
    for o in range(octaves):
        total += amp * perlin2(x * freq + o * 17.3, y * freq + o * 17.3)
        freq *= 2
        amp *= PERSISTENCE
    return total


heights = []                                # 2 次元リスト（行のリスト）
for j in range(size):                       # j: 奥行き方向
    row = []
    for i in range(size):                   # i: 横方向
        x = (i + move) / size * scale       # move を足すと、地形の別の場所が見える
        y = j / size * scale * depth        # depth が 0 だと、どの行も y が 0 になる
        h = round(height * fbm(x, y))       # round: 四捨五入して整数（ブロックの個数）にする
        row.append(h)
    heights.append(row)

terrain(heights)
