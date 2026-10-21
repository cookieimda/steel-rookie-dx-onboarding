#!/usr/bin/env python3
"""
POSCO 디지털 트윈 — 제선(Ironmaking) 공정 저폴리 디오라마 생성기
- 단위: 1 = 1m, Z-up (Blender 기준). 실제 설비 비율을 단순화한 디오라마 스케일.
- 출력 1: ironmaking_scene.obj + .mtl  (Blender용, 오브젝트/그룹 이름 유지)
- 출력 2: ironmaking_scene.glb          (웹용, Y-up, 재질별 병합, 노멀 포함)
- 의존성: numpy 만 (trimesh/bpy 불필요)
"""
import math, json, struct, os
import numpy as np

OUT = os.path.dirname(os.path.abspath(__file__))

# ─────────────────────────── 재질 표 (문서 2장 공통 비주얼 스타일) ───────────────────────────
MATERIALS = {
    # name:        (baseColor RGB 0-1,        emissive RGB,          roughness, metalness)
    "Base_Mint":   ((0.894, 0.949, 0.902), (0, 0, 0),              0.9, 0.0),   # #E4F2E6
    "Base_Rim":    ((0.369, 0.443, 0.525), (0, 0, 0),              0.9, 0.0),   # 회청색 테두리
    "Steel_Matte": ((0.55,  0.57,  0.59 ), (0, 0, 0),              0.6, 0.3),   # 무광 회색 철강
    "Steel_Dark":  ((0.33,  0.35,  0.37 ), (0, 0, 0),              0.6, 0.3),   # 프레임·빔
    "Refractory":  ((0.62,  0.55,  0.45 ), (0, 0, 0),              0.85,0.0),   # 내화물 톤 (열풍로)
    "Rail":        ((0.22,  0.22,  0.23 ), (0, 0, 0),              0.5, 0.5),
    "Ore":         ((0.56,  0.29,  0.17 ), (0, 0, 0),              1.0, 0.0),   # 철광석 더미
    "Coal":        ((0.16,  0.16,  0.16 ), (0, 0, 0),              1.0, 0.0),   # 석탄/코크스 더미
    "Molten_Iron": ((1.0,   0.42,  0.0  ), (1.0, 0.42, 0.0),       0.3, 0.0),   # #FF6A00 발광
    "Molten_Hot":  ((1.0,   0.70,  0.28 ), (1.0, 0.70, 0.28),      0.3, 0.0),   # #FFB347 (더 뜨거운 출선구)
}

# ─────────────────────────── 프리미티브 ───────────────────────────
class Mesh:
    """면마다 별도 정점 그룹(하드엣지) + 원통 옆면은 공유 정점(스무스)"""
    def __init__(self):
        self.v = []   # (x,y,z)
        self.f = []   # (i,j,k) 0-based tri

    def add(self, verts, faces):
        base = len(self.v)
        self.v.extend(verts)
        self.f.extend([(a+base, b+base, c+base) for a, b, c in faces])
        return self

def box(sx, sy, sz, cx=0, cy=0, cz=0):
    """중심 (cx,cy,cz) — cz는 바닥 기준이 아니라 중심"""
    hx, hy, hz = sx/2, sy/2, sz/2
    m = Mesh()
    # 6면 각각 4정점 (하드엣지)
    faces_def = [
        ((-1,0,0), [(-hx,-hy,-hz),(-hx,-hy,hz),(-hx,hy,hz),(-hx,hy,-hz)]),
        (( 1,0,0), [( hx,-hy,-hz),( hx,hy,-hz),( hx,hy,hz),( hx,-hy,hz)]),
        ((0,-1,0), [(-hx,-hy,-hz),( hx,-hy,-hz),( hx,-hy,hz),(-hx,-hy,hz)]),
        ((0, 1,0), [(-hx, hy,-hz),(-hx,hy,hz),( hx,hy,hz),( hx, hy,-hz)]),
        ((0,0,-1), [(-hx,-hy,-hz),(-hx,hy,-hz),( hx,hy,-hz),( hx,-hy,-hz)]),
        ((0,0, 1), [(-hx,-hy, hz),( hx,-hy,hz),( hx,hy,hz),(-hx, hy, hz)]),
    ]
    for _, quad in faces_def:
        vs = [(x+cx, y+cy, z+cz) for x, y, z in quad]
        m.add(vs, [(0,1,2),(0,2,3)])
    return m

def boxb(sx, sy, sz, cx=0, cy=0, z0=0):
    """바닥 z0 기준 박스"""
    return box(sx, sy, sz, cx, cy, z0 + sz/2)

def cylinder(r_bottom, r_top, h, cx=0, cy=0, z0=0, seg=24, axis="z", cap=True):
    """옆면 스무스(공유 정점), 캡은 별도 정점. axis: z | x | y"""
    m = Mesh()
    ring_b, ring_t = [], []
    for i in range(seg):
        a = 2*math.pi*i/seg
        ring_b.append((r_bottom*math.cos(a), r_bottom*math.sin(a), 0))
        ring_t.append((r_top*math.cos(a), r_top*math.sin(a), h))
    side_v = ring_b + ring_t
    side_f = []
    for i in range(seg):
        j = (i+1) % seg
        side_f += [(i, j, seg+j), (i, seg+j, seg+i)]
    m.add(side_v, side_f)
    if cap:
        if r_bottom > 1e-6:
            m.add(ring_b + [(0,0,0)], [((i+1)%seg, i, seg) for i in range(seg)])
        if r_top > 1e-6:
            m.add(ring_t + [(0,0,h)], [(i, (i+1)%seg, seg) for i in range(seg)])
    # 축 변환 + 이동
    out = Mesh()
    for x, y, z in m.v:
        if axis == "x":   x, y, z = z, y, -x + 0   # z축 → x축
        elif axis == "y": x, y, z = x, z, -y
        out.v.append((x+cx, y+cy, z+z0))
    out.f = list(m.f)
    return out

def torus(R, r, cx=0, cy=0, cz=0, seg=24, rs=8):
    m = Mesh()
    vs = []
    for i in range(seg):
        a = 2*math.pi*i/seg
        for j in range(rs):
            b = 2*math.pi*j/rs
            vs.append(((R + r*math.cos(b))*math.cos(a)+cx, (R + r*math.cos(b))*math.sin(a)+cy, r*math.sin(b)+cz))
    fs = []
    for i in range(seg):
        for j in range(rs):
            a0, a1 = i*rs + j, i*rs + (j+1)%rs
            b0, b1 = ((i+1)%seg)*rs + j, ((i+1)%seg)*rs + (j+1)%rs
            fs += [(a0, b0, b1), (a0, b1, a1)]
    return m.add(vs, fs)

def merge(*meshes):
    m = Mesh()
    for x in meshes:
        m.add(x.v, x.f)
    return m

def translate(m, dx, dy, dz):
    out = Mesh(); out.v = [(x+dx, y+dy, z+dz) for x, y, z in m.v]; out.f = list(m.f); return out

def rotate_z(m, deg, cx=0, cy=0):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    out = Mesh(); out.f = list(m.f)
    for x, y, z in m.v:
        x0, y0 = x-cx, y-cy
        out.v.append((x0*c - y0*s + cx, x0*s + y0*c + cy, z))
    return out

def rotate_y(m, deg, cx=0, cz=0):
    """Y축 회전(경사 컨베이어용)"""
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    out = Mesh(); out.f = list(m.f)
    for x, y, z in m.v:
        x0, z0 = x-cx, z-cz
        out.v.append((x0*c + z0*s + cx, y, -x0*s + z0*c + cz))
    return out

# ─────────────────────────── 장면 조립 ───────────────────────────
# objects: (object_name, group(=Blender collection), material, Mesh)
OBJS = []
def O(name, group, mat, mesh): OBJS.append((name, group, mat, mesh))

# 0. 부지 판 (120 x 80 m), 회청색 테두리
O("IM_Base_Plate", "00_Site", "Base_Mint", boxb(120, 80, 1.0, 0, 0, 0))
rim = merge(
    boxb(124, 2, 1.2, 0, -41, 0), boxb(124, 2, 1.2, 0, 41, 0),
    boxb(2, 80, 1.2, -61, 0, 0),  boxb(2, 80, 1.2, 61, 0, 0))
O("IM_Base_Rim", "00_Site", "Base_Rim", rim)

# 1. 고로 (Blast Furnace) — 중심 (0,0). 노체 단면: 노상 → 보시 → 노복 → 샤프트 → 노구
BF_X, BF_Y = -5, 5
BF_Z = 9.0   # 고로는 기초(foundation) 위에 올라간다 → 주상 데크가 토피도카 궤도보다 높아짐
O("IM_BF_Foundation", "01_BlastFurnace", "Steel_Dark", cylinder(8.0, 8.0, BF_Z-1.0, BF_X, BF_Y, 1.0, 32))
shell = merge(
    cylinder(7.0, 7.0, 5.0, BF_X, BF_Y, BF_Z+0.0, 32),      # 노상(hearth)
    cylinder(7.0, 8.2, 4.0, BF_X, BF_Y, BF_Z+5.0, 32),      # 보시(bosh)
    cylinder(8.2, 8.2, 3.0, BF_X, BF_Y, BF_Z+9.0, 32),      # 노복(belly)
    cylinder(8.2, 5.2, 22.0, BF_X, BF_Y, BF_Z+12.0, 32),    # 샤프트(shaft)
    cylinder(5.2, 5.2, 4.0, BF_X, BF_Y, BF_Z+34.0, 32),     # 노구(throat)
    cylinder(5.2, 2.0, 2.5, BF_X, BF_Y, BF_Z+38.0, 32),     # 노정 콘
)
O("IM_BF_Shell", "01_BlastFurnace", "Steel_Matte", shell)

# 고로 철골 타워: 기둥 4 + 링빔 4단
cols = merge(*[boxb(1.2, 1.2, 56, BF_X+dx, BF_Y+dy, 1.0) for dx, dy in [(-11,-11),(11,-11),(11,11),(-11,11)]])
rings = merge(*[merge(boxb(24, 1.0, 1.0, BF_X, BF_Y-11, z), boxb(24, 1.0, 1.0, BF_X, BF_Y+11, z),
                        boxb(1.0, 24, 1.0, BF_X-11, BF_Y, z), boxb(1.0, 24, 1.0, BF_X+11, BF_Y, z))
                for z in (20, 32, 44, 56)])
O("IM_BF_Tower", "01_BlastFurnace", "Steel_Dark", merge(cols, rings))

# 노정 가스 상승관(uptake) 4개 + 블리더 + 하강관(downcomer, -x 방향)
TOP = BF_Z + 40.5
uptakes = merge(*[cylinder(0.9, 0.9, 9, BF_X+3.5*math.cos(a), BF_Y+3.5*math.sin(a), TOP-1.0, 12)
                  for a in [math.radians(45+90*i) for i in range(4)]])
bleeder = cylinder(1.4, 1.4, 4, BF_X, BF_Y, TOP+7.5, 16)
downcomer = merge(
    cylinder(1.2, 1.2, 14, BF_X-14, BF_Y, TOP+8.0, 12, axis="x"),      # 상부 수평관: x = BF_X-14 → BF_X
    cylinder(1.2, 1.2, TOP+8.0-18.0, BF_X-14, BF_Y, 18.0, 12),         # 수직 하강 (x = BF_X-14)
)
O("IM_BF_Uptakes", "01_BlastFurnace", "Steel_Matte", merge(uptakes, bleeder))
O("IM_BF_Downcomer", "01_BlastFurnace", "Steel_Matte", downcomer)

# 제진기(dust catcher): 하강관 끝 — 원통 + 하부 콘
dust = merge(cylinder(3.0, 3.0, 10, BF_X-14, BF_Y, 8.0, 20), cylinder(0.8, 3.0, 5, BF_X-14, BF_Y, 3.0, 20))
O("IM_BF_DustCatcher", "01_BlastFurnace", "Steel_Matte", dust)

# 열풍 환상관(bustle pipe) + 풍구(tuyere) 12개 + 풍구 발광
bustle = torus(10.2, 0.9, BF_X, BF_Y, BF_Z+8.0, 32, 8)
O("IM_BF_BustlePipe", "01_BlastFurnace", "Steel_Matte", bustle)
tuy = Mesh()
for i in range(12):
    a = 2*math.pi*i/12
    # 원통을 z축에서 x축으로 눕힌 뒤 방사 방향으로 회전
    seg_ = translate(cylinder(0.35, 0.35, 3.4, 0, 0, 0, 8, axis="x"), 7.2, 0, 0)   # x 7.2 → 10.6 (bustle 까지)
    tuy = merge(tuy, translate(rotate_z(seg_, math.degrees(a)), BF_X, BF_Y, BF_Z+7.0))
O("IM_BF_Tuyeres", "01_BlastFurnace", "Steel_Dark", tuy)
tglow = Mesh()
for i in range(12):
    a = 2*math.pi*i/12
    tglow = merge(tglow, box(0.7, 0.7, 0.7, BF_X+7.55*math.cos(a), BF_Y+7.55*math.sin(a), BF_Z+7.0))
O("IM_BF_TuyereGlow", "01_BlastFurnace", "Molten_Hot", tglow)

# 주상(cast house) 데크: 고로 +x 쪽(출선구 방향), 기둥으로 받침. 데크 상면 z = BF_Z+1.5
DECK_Z = BF_Z + 0.5
O("IM_CastHouse_Deck", "02_CastHouse", "Steel_Dark", boxb(22, 20, 1.0, BF_X+16, BF_Y, DECK_Z))
O("IM_CastHouse_Columns", "02_CastHouse", "Steel_Dark",
  merge(*[boxb(0.8, 0.8, DECK_Z-1.0, BF_X+16+dx, BF_Y+dy, 1.0) for dx in (-9, 0, 9) for dy in (-8.5, 8.5)]))
# 출선구 + 출선 트로프(runner): 고로 벽 → 데크 끝(+x)까지
RZ = DECK_Z + 1.0
runner = merge(boxb(24, 2.6, 1.2, BF_X+19, BF_Y, RZ),
               boxb(24, 0.4, 0.6, BF_X+19, BF_Y-1.1, RZ+1.2), boxb(24, 0.4, 0.6, BF_X+19, BF_Y+1.1, RZ+1.2))
O("IM_CastHouse_Runner", "02_CastHouse", "Refractory", runner)
# 트로프 안 쇳물(발광) + 출선구 밝은 부분 + 낙하 스트림
O("IM_Molten_Runner", "03_MoltenIron", "Molten_Iron", boxb(23.5, 1.6, 0.35, BF_X+19, BF_Y, RZ+0.65))
O("IM_Molten_TapHole", "03_MoltenIron", "Molten_Hot", box(1.2, 1.4, 1.2, BF_X+7.4, BF_Y, RZ+1.1))
TC_X = BF_X + 31
MOUTH_Z = 4.6 + 3.2                                   # 토피도카 주입구 상단
stream = cylinder(0.32, 0.22, RZ+0.65-MOUTH_Z+0.3, TC_X, BF_Y, MOUTH_Z-0.3, 10)   # 트로프 끝 → 주입구로 낙하
O("IM_Molten_Stream", "03_MoltenIron", "Molten_Iron", stream)

# 3. 토피도카(Torpedo Car) — 레일은 x축 방향, 데크 끝 아래(지면 레벨), 차량 중심 x = BF_X+29
RAIL_Y = BF_Y
rails = merge(boxb(120, 0.3, 0.3, 0, RAIL_Y-0.75, 1.0), boxb(120, 0.3, 0.3, 0, RAIL_Y+0.75, 1.0))
sleepers = merge(*[boxb(0.5, 2.6, 0.2, x, RAIL_Y, 1.0) for x in range(-58, 60, 4)])
O("IM_Rails", "04_TorpedoCar", "Rail", rails)
O("IM_Sleepers", "04_TorpedoCar", "Steel_Dark", sleepers)
TC_X = BF_X + 31
# cylinder(axis="x") 변환: (x,y,z)->(z,y,-x) — 높이 h가 +x 방향 0..h 로 눕는다. translate로 중심 맞춤
body = merge(
    translate(cylinder(2.4, 2.4, 14, 0, 0, 0, 24, axis="x"), -7, 0, 0),
    translate(cylinder(2.4, 1.1, 4.5, 0, 0, 0, 24, axis="x"), 7, 0, 0),         # 앞 콘 (+x)
    rotate_z(translate(cylinder(2.4, 1.1, 4.5, 0, 0, 0, 24, axis="x"), 7, 0, 0), 180),  # 뒤 콘 (-x)
    cylinder(1.6, 1.6, 1.0, 0, 0, 2.2, 16),                                   # 상부 주입구(mouth)
)
body = translate(body, TC_X, RAIL_Y, 4.6)
O("IM_Torpedo_Body", "04_TorpedoCar", "Steel_Matte", body)
O("IM_Torpedo_Mouth", "04_TorpedoCar", "Molten_Iron", cylinder(1.35, 1.35, 0.1, TC_X, RAIL_Y, 4.6+3.2, 16))
# 대차 2개 + 바퀴
bogies = Mesh(); wheels = Mesh()
for bx in (TC_X-8.5, TC_X+8.5):
    bogies = merge(bogies, boxb(4.0, 3.0, 1.3, bx, RAIL_Y, 1.5), boxb(1.4, 1.4, 1.0, bx, RAIL_Y, 2.8))
    for wx in (bx-1.2, bx+1.2):
        for wy in (RAIL_Y-0.9, RAIL_Y+0.9):
            wheels = merge(wheels, translate(cylinder(0.55, 0.55, 0.25, 0, 0, 0, 14, axis="y"), wx, wy+0.125, 1.85))
O("IM_Torpedo_Bogies", "04_TorpedoCar", "Steel_Dark", bogies)
O("IM_Torpedo_Wheels", "04_TorpedoCar", "Rail", wheels)

# 4. 열풍로(Hot Stoves) 3기 — 고로 -y 쪽 일렬, 돔 상부, 열풍 본관으로 연결
stoves = Mesh(); stove_pipes = Mesh()
for i, sx in enumerate((-20, -8, 4)):
    sy = BF_Y - 24
    stoves = merge(stoves, cylinder(4.5, 4.5, 30, sx, sy, 1.0, 24), cylinder(4.5, 0.5, 4.5, sx, sy, 31.0, 24))
    stove_pipes = merge(stove_pipes, cylinder(0.9, 0.9, 11, sx, sy+4.5, 9.0, 12, axis="y"))  # 각 로 → 열풍 본관
hot_main = cylinder(1.2, 1.2, 36, BF_X-24+0, BF_Y-8.5, 9.0, 14, axis="x")    # 열풍 본관 (x축, y = BF_Y-8.5)
hot_main = translate(hot_main, -3, 0, 0)
O("IM_HotStoves", "05_HotStoves", "Refractory", stoves)
O("IM_HotStove_Pipes", "05_HotStoves", "Steel_Matte", merge(stove_pipes, hot_main))
# 굴뚝(stack)
O("IM_HotStove_Stack", "05_HotStoves", "Steel_Matte", cylinder(1.6, 1.1, 48, -30, BF_Y-24, 1.0, 16))

# 5. 원료 저장조(stockhouse) + 경사 장입 컨베이어(inclined charging conveyor)
bins = merge(*[merge(boxb(6, 6, 7, x, BF_Y+30, 6.0), cylinder(0.6, 4.2, 5.0, x, BF_Y+30, 1.0, 4)) for x in (-38, -30, -22)])
O("IM_Stockhouse_Bins", "06_Charging", "Steel_Matte", bins)
piles = merge(cylinder(5.5, 0.4, 4.0, -50, BF_Y+30, 1.0, 20))
O("IM_Stockpile_Ore", "06_Charging", "Ore", piles)
O("IM_Stockpile_Coal", "06_Charging", "Coal", cylinder(5.0, 0.4, 3.6, -50, BF_Y+18, 1.0, 20))
# 컨베이어: 저장조(-22, y+30, z 2) → 노정(BF_X, BF_Y, z 41). 길이/각도 계산
sx0, sy0, sz0 = -22, BF_Y+28, 2.5
ex0, ey0, ez0 = BF_X-2, BF_Y+2, 42.0
L = math.dist((sx0, sy0, sz0), (ex0, ey0, ez0))
conv = boxb(L, 2.4, 0.8, 0, 0, 0)            # x축 방향, 원점 중심
conv = merge(conv, boxb(L, 0.15, 0.9, 0, -1.25, 0.6), boxb(L, 0.15, 0.9, 0, 1.25, 0.6))  # 양쪽 난간
conv = translate(conv, L/2, 0, 0)            # 시작점이 원점
tilt = math.degrees(math.atan2(ez0-sz0, math.hypot(ex0-sx0, ey0-sy0)))
yaw = math.degrees(math.atan2(ey0-sy0, ex0-sx0))
conv = rotate_z(rotate_y(conv, -tilt), yaw)
conv = translate(conv, sx0, sy0, sz0)
# 컨베이어 지지 트러스(간격 12m)
supports = Mesh()
for t in np.linspace(0.15, 0.85, 5):
    px, py, pz = sx0+(ex0-sx0)*t, sy0+(ey0-sy0)*t, sz0+(ez0-sz0)*t
    supports = merge(supports, boxb(1.0, 1.0, pz-1.2, px, py, 1.0))
O("IM_Charging_Conveyor", "06_Charging", "Steel_Dark", conv)
O("IM_Charging_Supports", "06_Charging", "Steel_Dark", supports)

# 6. FINEX — 부지 +x 쪽(x 25~55). 유동환원로 3단(R3→R1) + 용융로(Melter-Gasifier) + 성형탄/HCI 설비
FX, FY = 40, -18
reactors = Mesh(); fpipes = Mesh()
for i, (rx, h) in enumerate(((FX+14, 22), (FX+6, 26), (FX-2, 30))):   # 위로 갈수록 높음 (원료 흐름 R3→R1 하강)
    reactors = merge(reactors,
                     cylinder(3.2, 3.2, h, rx, FY+14, 1.0, 20),          # 몸통
                     cylinder(3.2, 1.0, 3.5, rx, FY+14, 1.0+h, 20))      # 상부 콘
    fpipes = merge(fpipes, translate(cylinder(0.8, 0.8, 8.5, 0, 0, 0, 12, axis="x"), rx-8.5+0.0, FY+14, 1.0+h-2))
melter = merge(cylinder(7.0, 7.0, 16, FX-14, FY+2, 1.0, 28), cylinder(7.0, 3.5, 5, FX-14, FY+2, 17.0, 28),
               cylinder(3.5, 3.5, 6, FX-14, FY+2, 22.0, 28), cylinder(3.5, 0.6, 3.0, FX-14, FY+2, 28.0, 28))
O("IM_FINEX_Reactors", "07_FINEX", "Steel_Matte", reactors)
O("IM_FINEX_Reactor_Pipes", "07_FINEX", "Steel_Matte", fpipes)
O("IM_FINEX_Reactor_Frame", "07_FINEX", "Steel_Dark",
  merge(*([boxb(0.8, 0.8, 24, FX+dx, FY+14+dy, 1.0) for dx, dy in [(-6,-5),(18,-5),(18,5),(-6,5)]] +
        [boxb(24.8, 0.6, 0.6, FX+6, FY+14-5, z) for z in (13, 25)] + [boxb(24.8, 0.6, 0.6, FX+6, FY+14+5, z) for z in (13, 25)])))
O("IM_FINEX_MelterGasifier", "07_FINEX", "Steel_Matte", melter)
O("IM_FINEX_HCI_Plant", "07_FINEX", "Steel_Matte", merge(boxb(12, 8, 10, FX+10, FY, 1.0), cylinder(2.2, 2.2, 14, FX+16, FY-2, 1.0, 16)))
O("IM_FINEX_Feed_Pipe", "07_FINEX", "Steel_Matte", translate(cylinder(0.9, 0.9, 12, 0, 0, 0, 12, axis="y"), FX-14, FY+14-12+2, 1.0+22))
O("IM_FINEX_TapHole", "03_MoltenIron", "Molten_Hot", box(1.0, 1.0, 1.0, FX-14-7.1, FY+2, 3.0))

# 안내 표지 없음(문서 금지 사항: 글자·로고 없음)

# ─────────────────────────── 노멀 계산 ───────────────────────────
def compute_normals(v, f):
    v = np.asarray(v, dtype=np.float64); f = np.asarray(f, dtype=np.int64)
    n = np.zeros_like(v)
    p0, p1, p2 = v[f[:,0]], v[f[:,1]], v[f[:,2]]
    fn = np.cross(p1-p0, p2-p0)      # 면적 가중
    for k in range(3):
        np.add.at(n, f[:,k], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True); ln[ln == 0] = 1
    return n/ln

# ─────────────────────────── OBJ + MTL 내보내기 (Blender, Z-up) ───────────────────────────
def write_obj(path):
    mtl_path = path.replace(".obj", ".mtl")
    with open(mtl_path, "w", encoding="utf-8") as m:
        m.write("# POSCO Ironmaking diorama materials\n")
        for name, (kd, ke, rough, metal) in MATERIALS.items():
            m.write(f"newmtl {name}\nKd {kd[0]:.3f} {kd[1]:.3f} {kd[2]:.3f}\nKa 0 0 0\nKs 0.05 0.05 0.05\n")
            if any(ke): m.write(f"Ke {ke[0]:.3f} {ke[1]:.3f} {ke[2]:.3f}\n")
            m.write(f"Ns {int((1-rough)*200)}\nPr {rough}\nPm {metal}\nd 1.0\nillum 2\n\n")
    off = 1
    with open(path, "w", encoding="utf-8") as o:
        o.write("# POSCO Digital Twin — Ironmaking (제선) diorama | unit=1m | Z-up\n")
        o.write(f"mtllib {os.path.basename(mtl_path)}\n")
        for name, group, mat, mesh in OBJS:
            if not mesh.f: continue
            n = compute_normals(mesh.v, mesh.f)
            o.write(f"\no {name}\ng {group}\nusemtl {mat}\ns 1\n")
            for x, y, z in mesh.v: o.write(f"v {x:.4f} {y:.4f} {z:.4f}\n")
            for x, y, z in n:      o.write(f"vn {x:.4f} {y:.4f} {z:.4f}\n")
            for a, b, c in mesh.f:
                o.write(f"f {a+off}//{a+off} {b+off}//{b+off} {c+off}//{c+off}\n")
            off += len(mesh.v)

# ─────────────────────────── GLB 내보내기 (웹, Y-up, 재질별 병합) ───────────────────────────
def write_glb(path):
    """
    병합 규칙: 애니메이션/클릭 대상이 아닌 것은 재질별로 1 메시.
    토피도카(4개 파트)는 하나의 노드 'TorpedoCar'로 묶어 이동 애니 가능하게 별도 유지.
    쇳물 발광 파트는 'MoltenIron' 노드로 별도(재질 emissive 강도 조절용).
    """
    groups = {}  # key -> {mat: Mesh}
    def key_of(name, group):
        if group == "04_TorpedoCar" and name.startswith("IM_Torpedo"): return "TorpedoCar"
        if name == "IM_Molten_Stream": return "MoltenStream"   # 웹에서 출선 종료 후 숨길 수 있게 별도 노드
        if group == "03_MoltenIron": return "MoltenIron"
        return "Static"
    for name, group, mat, mesh in OBJS:
        if not mesh.f: continue
        k = key_of(name, group)
        groups.setdefault(k, {}).setdefault(mat, Mesh()).add(mesh.v, mesh.f)

    bin_parts = []; buffer_views = []; accessors = []; meshes = []; nodes = []; mats = []
    mat_index = {}
    for i, (mname, (kd, ke, rough, metal)) in enumerate(MATERIALS.items()):
        mat_index[mname] = i
        md = {"name": mname, "pbrMetallicRoughness": {"baseColorFactor": [*kd, 1.0], "roughnessFactor": rough, "metallicFactor": metal}}
        if any(ke): md["emissiveFactor"] = list(ke)
        mats.append(md)
    total = 0
    def add_view(data, target):
        nonlocal total
        pad = (-len(data)) % 4
        bin_parts.append(data + b"\x00"*pad)
        buffer_views.append({"buffer": 0, "byteOffset": total, "byteLength": len(data), "target": target})
        total += len(data) + pad
        return len(buffer_views)-1
    tri_count = 0
    for gname, by_mat in groups.items():
        prims = []
        for mname, mesh in by_mat.items():
            v = np.asarray(mesh.v, dtype=np.float32)
            v = np.stack([v[:,0], v[:,2], -v[:,1]], axis=1).astype(np.float32)   # Z-up → Y-up
            n = compute_normals(mesh.v, mesh.f).astype(np.float32)
            n = np.stack([n[:,0], n[:,2], -n[:,1]], axis=1).astype(np.float32)
            f = np.asarray(mesh.f)
            idx_dtype = np.uint16 if len(v) < 65535 else np.uint32
            idx = f.astype(idx_dtype).ravel()
            tri_count += len(f)
            bv_v = add_view(v.tobytes(), 34962); bv_n = add_view(n.tobytes(), 34962); bv_i = add_view(idx.tobytes(), 34963)
            accessors.append({"bufferView": bv_v, "componentType": 5126, "count": len(v), "type": "VEC3",
                              "min": v.min(0).tolist(), "max": v.max(0).tolist()}); a_v = len(accessors)-1
            accessors.append({"bufferView": bv_n, "componentType": 5126, "count": len(n), "type": "VEC3"}); a_n = len(accessors)-1
            accessors.append({"bufferView": bv_i, "componentType": 5123 if idx_dtype == np.uint16 else 5125, "count": len(idx), "type": "SCALAR"}); a_i = len(accessors)-1
            prims.append({"attributes": {"POSITION": a_v, "NORMAL": a_n}, "indices": a_i, "material": mat_index[mname]})
        meshes.append({"name": gname, "primitives": prims})
        nodes.append({"name": gname, "mesh": len(meshes)-1})
    gltf = {"asset": {"version": "2.0", "generator": "posco-ironmaking-builder"},
            "scene": 0, "scenes": [{"name": "Ironmaking", "nodes": list(range(len(nodes)))}],
            "nodes": nodes, "meshes": meshes, "materials": mats, "accessors": accessors,
            "bufferViews": buffer_views, "buffers": [{"byteLength": total}]}
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    bin_blob = b"".join(bin_parts)
    with open(path, "wb") as g:
        g.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_blob)))
        g.write(struct.pack("<II", len(js), 0x4E4F534A)); g.write(js)
        g.write(struct.pack("<II", len(bin_blob), 0x004E4942)); g.write(bin_blob)
    return tri_count, len(nodes), sum(len(m["primitives"]) for m in meshes)

if __name__ == "__main__":
    obj_path = os.path.join(OUT, "ironmaking_scene.obj")
    glb_path = os.path.join(OUT, "ironmaking_scene.glb")
    write_obj(obj_path)
    tris, nnodes, draws = write_glb(glb_path)
    nv = sum(len(m.v) for *_, m in OBJS); nf = sum(len(m.f) for *_, m in OBJS)
    print(f"OBJ objects: {len(OBJS)}  verts: {nv}  tris: {nf}")
    print(f"GLB nodes: {nnodes}  draw calls: {draws}  tris: {tris}  size: {os.path.getsize(glb_path)/1024:.1f} KB")
    print(f"OBJ size: {os.path.getsize(obj_path)/1024:.1f} KB")
