"""原創火焰圖案：圓形底部＋兩條曲線收成尖端（給圖文選單與頭貼共用）。"""
import math


def _bez(p0, c, p1, n=24):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]) for t in (i / n for i in range(n + 1))]


def flame_pts(cx, cy, s):
    """s = 火焰高度，(cx, cy) = 中心。回傳多邊形頂點。"""
    r = 0.30 * s
    ox, oy = cx, cy + 0.5 * s - r
    tip = (cx + 0.06 * s, cy - 0.5 * s)  # 尖端略偏右，像在飄
    arc = [(ox + r * math.cos(math.radians(a)), oy + r * math.sin(math.radians(a))) for a in range(-20, 201, 5)]  # 右上 → 底 → 左上
    left, right = arc[-1], arc[0]
    return arc + _bez(left, (cx - 0.42 * s, cy - 0.05 * s), tip)[1:] + _bez(tip, (cx + 0.36 * s, cy - 0.12 * s), right)[1:-1]


def draw_flame(d, cx, cy, s, outer, mid, core=None):
    d.polygon(flame_pts(cx, cy, s), fill=outer)
    d.polygon(flame_pts(cx, cy + 0.17 * s, s * 0.62), fill=mid)
    if core:
        d.polygon(flame_pts(cx, cy + 0.30 * s, s * 0.32), fill=core)
