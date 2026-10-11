# ステップ 7: 2 次元のオクターブ合成
import math
import random

seed = slider("シード値", 0, 99, 7)
octaves = slider("オクターブ数（重ねる枚数）", 1, 6, 4)
persistence = slider("持続度（振幅の残り方）", 0.1, 0.9, 0.5, 0.1)
base_freq = slider("最初の周波数", 1, 6, 2)
size = slider("地図の大きさ", 16, 64, 32, 16)

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


def make_layer(freq, amp, shift):
    """周波数 freq・振幅 amp のノイズで、地図 1 枚分の 2 次元リストを作る"""
    layer = []
    for j in range(size):
        row = []
        for i in range(size):
            x = i / size * freq + shift     # shift: 層ごとに違う場所を使うためのずらし
            y = j / size * freq + shift
            row.append(amp * perlin2(x, y))
        layer.append(row)
    return layer


total = [[0.0] * size for j in range(size)]     # 0 で埋めた 2 次元リスト

freq = base_freq
amp = 1.0
for o in range(octaves):
    layer = make_layer(freq, amp, o * 17.3)
    heatmap(layer, f"{o + 1} 層目（周波数 {freq}、振幅 {amp:.2f}）", lo=-0.7, hi=0.7)

    for j in range(size):
        for i in range(size):
            total[j][i] += layer[j][i]

    freq *= 2
    amp *= persistence

heatmap(total, "合計")
