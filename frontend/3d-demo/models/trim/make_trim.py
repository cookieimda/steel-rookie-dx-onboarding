# 트림시트 만들기: Tripo 텍스처(냉각탑·소화탑)에서 쓸 만한 부분을 잘라 가로로 이어지는 띠로 만든다.
import sys, glob, random
from PIL import Image, ImageFilter, ImageOps, ImageEnhance, ImageChops
src_dir, out = sys.argv[1], sys.argv[2]
C = Image.open(glob.glob(src_dir + '/cooling/*.fbm/*.jpg')[0]).convert('RGB')
Q = Image.open(glob.glob(src_dir + '/quench/*.fbm/*.jpg')[0]).convert('RGB')
P = Image.open(glob.glob(src_dir + '/plant/*.fbm/*_0_0.jpg')[0]).convert('RGB')
R = Image.open(glob.glob(src_dir + '/piperack/*.fbm/*_0_0.jpg')[0]).convert('RGB')
OUT = 512        # 최종 시트 크기. 2배(1024)로 그린 뒤 줄인다
W = OUT * 2

def seamless(img):  # 가로로 이어 붙여도 이음매가 안 보이게(반 바퀴 민 사본과 가장자리 쪽으로 섞기)
    w, h = img.size
    rolled = ImageChops.offset(img, w // 2, 0)
    mask = Image.new('L', (w, h))
    px = [int(255 * min(1, abs(x - w / 2) / (w / 2)) ** 1.5) for x in range(w)]
    mask.putdata([px[x] for y in range(h) for x in range(w)])
    return Image.composite(rolled, img, mask)

def strip(crop, h, rotate=False, sat=1.0, bright=1.0, contrast=1.0):
    if rotate: crop = crop.rotate(90, expand=True)
    w = max(8, round(crop.width * h / crop.height))
    t = crop.resize((w, h), Image.LANCZOS)
    reps = max(1, round(W / w))
    row = Image.new('RGB', (w * reps, h))
    for i in range(reps): row.paste(t if i % 2 == 0 else ImageOps.mirror(t), (i * w, 0))  # 좌우 뒤집어 반복 → 이음매가 맞는다
    row = row.resize((W, h), Image.LANCZOS)
    row = seamless(row)
    row = ImageEnhance.Color(row).enhance(sat); row = ImageEnhance.Brightness(row).enhance(bright); row = ImageEnhance.Contrast(row).enhance(contrast)
    return row

def noise_strip(h, base, spots, seed):
    rnd = random.Random(seed)
    im = Image.new('RGB', (W, h), base)
    from PIL import ImageDraw
    d = ImageDraw.Draw(im, 'RGBA')
    for _ in range(spots):
        x, y, s = rnd.random() * W, rnd.random() * h, 2 + rnd.random() * 10
        c = (rnd.randint(118, 140), rnd.randint(88, 100), 70, rnd.randint(12, 28)) if rnd.random() < 0.1 else ((52, 56, 62, rnd.randint(20, 40)) if rnd.random() < 0.5 else (150, 156, 164, rnd.randint(15, 35)))
        d.ellipse([x - s * 2.5, y - s * 0.4, x + s * 2.5, y + s * 0.4], fill=c)
    return seamless(im.filter(ImageFilter.GaussianBlur(0.6)))

def cut_strip(h):
    rnd = random.Random(5)
    im = Image.new('RGB', (W, h), (118, 118, 120))
    from PIL import ImageDraw
    d = ImageDraw.Draw(im, 'RGBA')
    for x in range(0, W, 2): d.line([(x, 0), (x, h)], fill=(205, 205, 200, rnd.randint(10, 35)))
    for x0 in range(40, W, 256): d.rectangle([x0, h * .3, x0 + 70, h * .7], fill=(235, 235, 228, 210))  # 흰 페인트 표시
    return im


def coil_side(h):  # 코일 옆면: 감긴 강판 바깥 표면(회청색, 둘레 방향 압연 결) — 세로(띠 높이) = 코일 폭
    rnd = random.Random(21)
    im = Image.new('RGB', (W, h), (138, 146, 156))
    from PIL import ImageDraw
    d = ImageDraw.Draw(im, 'RGBA')
    for y in range(h):
        k = rnd.randint(-8, 8); d.line([(0, y), (W, y)], fill=(138 + k, 146 + k, 156 + k, 255))
    for _ in range(600):
        x, y = rnd.random() * W, rnd.random() * h
        d.line([(x, y), (x + 30 + rnd.random() * 160, y)], fill=(190, 198, 208, rnd.randint(20, 50)) if rnd.random() < .7 else (130, 100, 78, rnd.randint(12, 28)))
    return seamless(im)

def coil_face(h):  # 코일 끝면: 극좌표 UV로 붙인다(세로 = 반지름). 가는 가로줄 = 감긴 겹 → 촘촘한 동심원
    rnd = random.Random(33)
    im = Image.new('RGB', (W, h), (132, 140, 150))
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    for y in range(h):
        k = rnd.randint(-14, 14) + (-18 if rnd.random() < 0.12 else 0)
        d.line([(0, y), (W, y)], fill=(140 + k, 148 + k, 158 + k))
    d.line([(0, 0), (W, 0)], fill=(96, 100, 108)); d.line([(0, h - 1), (W, h - 1)], fill=(110, 116, 124))  # 안쪽·바깥 가장자리
    return im

def grating(h):  # 통로 그레이팅: 촘촘한 격자
    im = Image.new('RGB', (W, h), (58, 62, 68))
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    for x in range(0, W, 6): d.line([(x, 0), (x, h)], fill=(118, 124, 132), width=2)
    for y in range(0, h, 16): d.line([(0, y), (W, y)], fill=(100, 106, 114), width=2)
    return im

c = lambda x0, y0, x1, y1: C.crop((x0, y0, x1, y1))
q = lambda x0, y0, x1, y1: Q.crop((x0, y0, x1, y1))
pl = lambda x0, y0, x1, y1: P.crop((x0, y0, x1, y1))
rk = lambda x0, y0, x1, y1: R.crop((x0, y0, x1, y1))

def seams(im, every, alpha=40):  # 세로 패널 이음매(민무늬 벽을 외장 패널처럼)
    from PIL import ImageDraw
    d = ImageDraw.Draw(im, 'RGBA')
    for x in range(0, W, every):
        d.line([(x, 0), (x, im.height)], fill=(60, 64, 70, alpha), width=2); d.line([(x + 2, 0), (x + 2, im.height)], fill=(200, 205, 210, alpha // 2))
    return im
# (이름, 높이, 이미지) — 순서가 곧 위→아래 배치. plant-props.js의 TRIM 표와 같아야 한다
# (이름, 최종 높이px(512 기준), 이미지) — 순서가 곧 위→아래 배치. plant-props.js의 TRIM 표와 같아야 한다
STRIPS = [
  ('cladding', 48, strip(c(250, 168, 310, 316), 96, rotate=True, sat=0.8, bright=1.05)),
  ('louver',   48, strip(c(2, 150, 240, 190), 96, sat=0.9, contrast=1.1)),
  ('concrete', 48, strip(q(166, 300, 242, 440), 96, bright=1.05)),
  ('concrete_dark', 48, strip(q(2, 356, 158, 500), 96)),
  ('steel_panel', 32, strip(c(322, 165, 378, 315), 64, rotate=True, sat=0.7)),
  ('basin',    32, strip(c(4, 340, 100, 420), 64, sat=0.6)),
  ('slab_scale', 32, noise_strip(64, (104, 109, 116), 1000, 7)),
  ('slab_cut', 16, cut_strip(32)),
  ('curb',     16, strip(c(0, 302, 240, 318), 32)),
  ('wall_gray', 32, seams(strip(pl(8, 306, 310, 330).filter(ImageFilter.MedianFilter(5)), 64, sat=0.25, contrast=1.15), 64)),
  ('roof_gray', 16, strip(pl(10, 205, 340, 250), 32)),
  ('pipe',     32, strip(rk(10, 168, 210, 184), 64, sat=0.5, contrast=0.8, bright=1.45)),   # 배관 표면(길이 방향 결)
  ('beam',     16, strip(rk(8, 418, 215, 434), 32, sat=0.6)),                               # H형강·보
  ('coil_side', 32, coil_side(64)),
  ('coil_face', 32, coil_face(64)),
  ('grating',  32, grating(64)),
]
sheet = Image.new('RGB', (W, W)); y = 0
for name, h, im in STRIPS:
    assert im.height == h * 2, name
    sheet.paste(im, (0, y * 2)); print(f"  {name}: [{y}, {y + h}],"); y += h
assert y == OUT, y
sheet.resize((OUT, OUT), Image.LANCZOS).save(out, quality=90)
