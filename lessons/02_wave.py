# ステップ 2: 同じ形をくり返す（サイン波）
import math

n = slider("点の数", 20, 80, 80, 10)
waves = slider("山の数", 1, 12, 4)
height = slider("山の高さ", 0.1, 1.0, 0.6, 0.1)

heights = []
for i in range(n):
    x = i / n                                           # 横の位置を 0 〜 1 に直す
    h = height * math.sin(x * waves * 2 * math.pi)      # サイン波: 決まった形の山と谷
    heights.append(h)

plot(heights, "くり返しの地面")

print("最初の 5 個:", [round(h, 2) for h in heights[:5]])
