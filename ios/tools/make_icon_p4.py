"""TENPO ONE アイコン（2026-10-25 Ronnie「P4 でいい」）：アプリのホームの 2 つのボタン＝青い「オーダー・会計」（レジの画面 ¥）と
黄色い「店舗台帳」（予約のカレンダー ✓）を重ねた形。地はネイビー→青（広告の写真と同じ）。
使い方：python3 ios/tools/make_icon_p4.py <out.png> [--name]（Noto Sans CJK の Black が要る。BrandMark は名前なし、
1024 の App アイコンは --name＝下に「TENPO ONE」。2026-10-26 Ronnie「App sign ma name pani lekhna paryo」「App ahile kai・Name appsign ko bottom ma」）"""
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
S = 2048
NAVY = (0x17, 0x13, 0x33); NAVY2 = (0x22, 0x35, 0x86); BLUE = (0x2A, 0x6F, 0xE6); BLUE_D = (0x1E, 0x58, 0xC8)
YEL = (0xFF, 0xC6, 0x34); YEL_D = (0xF0, 0xB0, 0x10); WHITE = (255, 255, 255)
FB = '/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc'
def font(sz):
    for i in range(10):
        f = ImageFont.truetype(FB, sz, index=i)
        if 'JP' in ' '.join(f.getname()): return f
def grad(c1, c2, angle):
    y, x = np.mgrid[0:S, 0:S] / (S - 1)
    a = math.radians(angle)
    t = x * math.cos(a) + y * math.sin(a); t = (t - t.min()) / (t.max() - t.min())
    arr = np.zeros((S, S, 3))
    for i in range(3): arr[..., i] = c1[i] + (c2[i] - c1[i]) * t
    return Image.fromarray(arr.astype('uint8'))
def glow(im, center, r, color, alpha):
    m = Image.new('L', (S // 8, S // 8), 0); d = ImageDraw.Draw(m)
    cx, cy, rr = center[0] / 8, center[1] / 8, r / 8
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=alpha)
    m = m.filter(ImageFilter.GaussianBlur(rr * 0.5)).resize((S, S), Image.BICUBIC)
    im.paste(Image.new('RGB', (S, S), color), (0, 0), m)
def shadow(im, mask, off, blur, alpha):
    sm = mask.resize((S // 4, S // 4)).filter(ImageFilter.GaussianBlur(blur / 4)).resize((S, S))
    sm = Image.fromarray((np.array(sm) * alpha).astype('uint8'))
    sh = Image.new('L', (S, S), 0); sh.paste(sm, (int(off * 0.3), off))
    im.paste(Image.new('RGB', (S, S), (6, 6, 24)), (0, 0), sh)
def tile_layer(size, color_top, color_bot):
    """縦グラデーションのタイル（size×size）"""
    t = Image.new('RGB', (size, size))
    for y in range(size):
        k = y / (size - 1)
        ImageDraw.Draw(t).line([(0, y), (size, y)], fill=tuple(int(color_top[i] + (color_bot[i] - color_top[i]) * k) for i in range(3)))
    return t
def place_tile(im, cx, cy, half, angle, ctop, cbot, draw_icon):
    size = int(half * 2)
    pad = int(size * 0.25)
    canvas = Image.new('RGBA', (size + pad * 2, size + pad * 2), (0, 0, 0, 0))
    body = tile_layer(size, ctop, cbot).convert('RGBA')
    m = Image.new('L', (size, size), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.24), fill=255)
    body.putalpha(m)
    canvas.paste(body, (pad, pad), body)
    draw_icon(ImageDraw.Draw(canvas), pad + size / 2, pad + size / 2, size)
    canvas = canvas.rotate(angle, resample=Image.BICUBIC, expand=False)
    x, y = int(cx - canvas.width / 2), int(cy - canvas.height / 2)
    full = Image.new('L', (S, S), 0); full.paste(canvas.split()[3], (x, y))
    shadow(im, full, off=int(S * 0.028), blur=S * 0.05, alpha=0.5)
    im.paste(canvas, (x, y), canvas)
def check(d, cx, cy, s, width, fill):
    d.line([(cx - s * 0.50, cy), (cx - s * 0.12, cy + s * 0.38), (cx + s * 0.55, cy - s * 0.36)], fill=fill, width=int(width), joint='curve')
def calendar(d, cx, cy, size):
    # 手前の青いタイルに隠れないように、タイルの右上寄りに
    cx += size * 0.08; cy -= size * 0.07
    s = size * 0.25
    top, bot = cy - s * 0.80, cy + s * 0.95
    d.rounded_rectangle([cx - s, top, cx + s, bot], radius=s * 0.26, fill=WHITE)
    d.rounded_rectangle([cx - s, top, cx + s, top + s * 0.55], radius=s * 0.26, fill=NAVY)
    d.rectangle([cx - s, top + s * 0.30, cx + s, top + s * 0.55], fill=NAVY)
    for k in (-0.48, 0.48):
        d.rounded_rectangle([cx + s * k - s * 0.11, top - s * 0.28, cx + s * k + s * 0.11, top + s * 0.22], radius=s * 0.11, fill=NAVY)
    check(d, cx, cy + s * 0.30, s * 0.78, s * 0.20, BLUE)
def register(d, cx, cy, size):
    s = size * 0.30
    mt, mb = cy - s * 0.78, cy + s * 0.42
    d.rounded_rectangle([cx - s, mt, cx + s, mb], radius=s * 0.18, fill=WHITE)
    d.rounded_rectangle([cx - s * 0.84, mt + s * 0.15, cx + s * 0.84, mb - s * 0.15], radius=s * 0.10, fill=NAVY)
    f = font(int(s * 0.80))
    bb = d.textbbox((0, 0), '¥', font=f); w, h = bb[2] - bb[0], bb[3] - bb[1]
    d.text((cx - w / 2 - bb[0], (mt + mb) / 2 - h / 2 - bb[1]), '¥', font=f, fill=WHITE)
    d.rectangle([cx - s * 0.13, mb - 2, cx + s * 0.13, mb + s * 0.32], fill=WHITE)
    d.rounded_rectangle([cx - s * 0.52, mb + s * 0.28, cx + s * 0.52, mb + s * 0.44], radius=s * 0.08, fill=WHITE)

def name_band(im):
    """下に「TENPO ONE」（白・太字・字の間を少しあける）。角の丸みで切れない幅に"""
    d = ImageDraw.Draw(im)
    text = 'TENPO ONE'
    f = font(int(S * NAME_SIZE))
    track = S * 0.007
    widths = [d.textbbox((0, 0), ch, font=f)[2] - d.textbbox((0, 0), ch, font=f)[0] if ch != " " else S * 0.038 for ch in text]
    total = sum(widths) + track * (len(text) - 1)
    bb = d.textbbox((0, 0), 'TENPO', font=f)
    h = bb[3] - bb[1]
    x = (S - total) / 2
    y = S * NAME_CENTER_Y - h / 2 - bb[1]
    # うすい影（青い地の上で字が沈まないように）
    sh = Image.new('L', (S, S), 0); ds = ImageDraw.Draw(sh)
    xx = x
    for ch, w in zip(text, widths):
        if ch != ' ':
            b = ds.textbbox((0, 0), ch, font=f)
            ds.text((xx - b[0], y + S * 0.006), ch, font=f, fill=110)
        xx += w + track
    sh = sh.filter(ImageFilter.GaussianBlur(S * 0.008))
    im.paste(Image.new('RGB', (S, S), (6, 6, 24)), (0, 0), sh)
    xx = x
    for ch, w in zip(text, widths):
        if ch != ' ':
            b = d.textbbox((0, 0), ch, font=f)
            d.text((xx - b[0], y), ch, font=f, fill=WHITE)
        xx += w + track

# 名前ありのとき：2 つのタイルを少し小さく・上に寄せて、下に名前の場所をあける
NAME_SCALE = 0.82
NAME_SHIFT_Y = -0.07
NAME_SIZE = 0.108
NAME_CENTER_Y = 0.853

def make(with_name=False):
    im = grad(NAVY, BLUE, 115)
    glow(im, (S * 0.30, S * 0.80), S * 0.55, BLUE, 140)
    glow(im, (S * 0.78, S * 0.18), S * 0.30, (0x4A, 0x5A, 0xB8), 90)
    k, dy = (NAME_SCALE, NAME_SHIFT_Y) if with_name else (1.0, 0.0)
    pos = lambda v, shift=0.0: S * (0.5 + (v - 0.5) * k + shift)
    # 奥：黄色の店舗台帳（予約）
    place_tile(im, pos(0.625), pos(0.385, dy), S * 0.215 * k, -10, YEL, YEL_D, calendar)
    # 手前：青のオーダー・会計（レジ）
    place_tile(im, pos(0.385), pos(0.615, dy), S * 0.235 * k, 7, (0x37, 0x7C, 0xF0), BLUE_D, register)
    if with_name:
        name_band(im)
    return im

if __name__ == "__main__":
    im = make(with_name='--name' in sys.argv[2:])
    out = sys.argv[1] if len(sys.argv) > 1 else 'P4-final.png'
    im.resize((1024, 1024), Image.LANCZOS).save(out)
    print(out)
