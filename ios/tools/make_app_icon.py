"""TENPO ONE のアプリアイコン：ホームの色（オーダー・会計の青／店舗台帳のテラコッタ）を使い、生成りの地で暗い壁紙でも見える。
左＝青（レジ）・右＝テラコッタ（予約）。真ん中の「1」は生成りの抜き。"""
import sys
from PIL import Image, ImageDraw, ImageFilter

MARK = '/home/claude/tenpo-one/public/logo-mark.png'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/icon.png'
VARIANT = sys.argv[2] if len(sys.argv) > 2 else 'split'
S = 1024

def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))

def vgrad(size, top, bottom):
    w, h = size
    im = Image.new('RGB', (w, h))
    px = im.load()
    for y in range(h):
        c = lerp(top, bottom, y / max(1, h - 1))
        for x in range(w):
            px[x, y] = c
    return im

# 地：生成り（ホームと同じ #fbf9f5）→ 下は少し濃く
bg = vgrad((S, S), (253, 251, 247), (241, 236, 228)).convert('RGBA')

# ロゴの形（アルファ）を 72% の大きさで真ん中に
mark = Image.open(MARK).convert('RGBA')
size = int(S * 0.72)
mark = mark.resize((size, size), Image.LANCZOS)
alpha = mark.split()[3]
ox = (S - size) // 2
oy = (S - size) // 2

# 色：左＝青（オーダー・会計 #2a6fe6→#0a3fa8）・右＝テラコッタ（店舗台帳 #d0694f→#a94e37）
blue = vgrad((size, size), (42, 111, 230), (10, 63, 168))
terra = vgrad((size, size), (208, 105, 79), (169, 78, 55))

if VARIANT == 'split':
    # 「1」の傾きに合わせた斜めの境目（上は右寄り・下は左寄り）。間に生成りの細いすき間
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    import os
    top_x = int(size * float(os.environ.get('TOPX', '0.60')))
    bot_x = int(size * float(os.environ.get('BOTX', '0.40')))
    d.polygon([(top_x, -10), (size + 10, -10), (size + 10, size + 10), (bot_x, size + 10)], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(1.2))
    gap = Image.new('L', (size, size), 0)
    dg = ImageDraw.Draw(gap)
    dg.line([(top_x, -10), (bot_x, size + 10)], fill=255, width=int(size * float(os.environ.get('GAP', '0.035'))))
    fill = Image.composite(terra, blue, m)
    fill_a = Image.composite(Image.new('L', (size, size), 0), alpha, gap)
elif VARIANT == 'blend':
    # 左上→右下のなめらかな変わり目（青→テラコッタ）
    m = Image.new('L', (size, size), 0)
    px = m.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.75 + y * 0.25) / size
            t = min(1, max(0, (t - 0.38) / 0.24))
            px[x, y] = int(t * 255)
    fill = Image.composite(terra, blue, m)
    fill_a = alpha
else:
    fill = terra
    fill_a = alpha

# 影（うっすら）
shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
sh = Image.new('RGBA', (size, size), (0, 0, 0, 0))
sh.putalpha(fill_a.point(lambda v: int(v * 0.22)))
shadow.alpha_composite(sh, (ox, oy + int(S * 0.012)))
shadow = shadow.filter(ImageFilter.GaussianBlur(int(S * 0.012)))
bg.alpha_composite(shadow)

layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
f = fill.convert('RGBA')
f.putalpha(fill_a)
# 上に薄い光
gloss = Image.new('RGBA', (size, size), (0, 0, 0, 0))
gl = vgrad((size, size), (255, 255, 255), (255, 255, 255)).convert('RGBA')
ga = Image.new('L', (size, size), 0)
gp = ga.load()
for y in range(size):
    v = max(0, 0.18 - y / size * 0.36)
    for x in range(size):
        gp[x, y] = int(v * 255)
gl.putalpha(ga)
gl = Image.composite(gl, Image.new('RGBA', (size, size), (0, 0, 0, 0)), fill_a)
f.alpha_composite(gl)
layer.alpha_composite(f, (ox, oy))
bg.alpha_composite(layer)
bg.convert('RGB').save(OUT, 'PNG')
print('saved', OUT, VARIANT)
