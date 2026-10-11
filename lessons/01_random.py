# ステップ 1: 乱数だけで地面を作る
import random

seed = slider("シード値", 0, 99, 7)       # 乱数の種。同じ数なら毎回同じ結果になる
n = slider("点の数", 10, 200, 60, 10)

random.seed(seed)

heights = []
for i in range(n):
    h = random.uniform(-1, 1)   # -1 〜 1 のでたらめな数
    heights.append(h)

plot(heights, "乱数だけの地面")

print("最初の 5 個:", [round(h, 2) for h in heights[:5]])
