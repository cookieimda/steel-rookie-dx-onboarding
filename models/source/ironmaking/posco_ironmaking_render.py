# -*- coding: utf-8 -*-
"""
POSCO 디지털 트윈 — 제선(Ironmaking) 렌더 영상용 Blender 셋업 스크립트
실행: Blender 4.x → Scripting 탭 → 이 파일 열기 → Run Script  (또는)
      blender -b -P posco_ironmaking_render.py -- --render

하는 일
 1. ironmaking_scene.obj 임포트 (같은 폴더), Z-up/1m 단위 그대로
 2. 오브젝트를 OBJ의 그룹(g) 이름 기준 컬렉션으로 정리 (00_Site ~ 07_FINEX)
    → 최상위 컬렉션 "IRONMAKING" 하나만 켜면 제선 설비가 전부 보인다
 3. 재질을 문서 2장 스타일로 교체 (무광 철강 / 발광 쇳물 / 민트 부지)
 4. 월드 = 밝은 회색 원형 그라데이션, 스튜디오 조명 + 접촉 그림자
 5. 카메라 CAM_Ironmaking_Orbit: 40° 내려다보는 느린 오빗 (10초, 240프레임)
    + 토피도카 출선 후 +x 방향 이동 애니메이션 (V3 샷 연출)
 6. 출력 EEVEE, 1920x1080, 24fps, H.264 MP4 → renders/ironmaking_V3.mp4
"""
import bpy, os, sys, math
from mathutils import Vector

HERE = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.path.dirname(os.path.abspath(__file__))
OBJ_PATH = os.path.join(HERE, "ironmaking_scene.obj")
OUT_DIR = os.path.join(HERE, "renders")
FPS, FRAMES = 24, 240          # 10초
DO_RENDER = "--render" in sys.argv

# ── 1. 씬 초기화 & OBJ 임포트 ────────────────────────────────────────────
bpy.ops.wm.read_homefile(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"; scene.unit_settings.scale_length = 1.0

bpy.ops.wm.obj_import(filepath=OBJ_PATH, forward_axis="Y", up_axis="Z", use_split_objects=True, use_split_groups=False)
imported = [o for o in bpy.context.selected_objects if o.type == "MESH"]
assert imported, "OBJ 임포트 실패: 경로 확인 " + OBJ_PATH

# ── 2. 컬렉션 그룹화 (오브젝트 이름 접두어 → 컬렉션) ───────────────────────
GROUP_OF = {
    "IM_Base": "00_Site",
    "IM_BF_": "01_BlastFurnace",
    "IM_CastHouse": "02_CastHouse",
    "IM_Molten": "03_MoltenIron", "IM_FINEX_TapHole": "03_MoltenIron",
    "IM_Torpedo": "04_TorpedoCar", "IM_Rails": "04_TorpedoCar", "IM_Sleepers": "04_TorpedoCar",
    "IM_HotStove": "05_HotStoves",
    "IM_Stock": "06_Charging", "IM_Charging": "06_Charging",
    "IM_FINEX": "07_FINEX",
}
root = bpy.data.collections.new("IRONMAKING")
scene.collection.children.link(root)
subs = {}
def sub(name):
    if name not in subs:
        c = bpy.data.collections.new(name); root.children.link(c); subs[name] = c
    return subs[name]
for o in imported:
    grp = next((g for k, g in GROUP_OF.items() if o.name.startswith(k)), "99_Misc")
    for c in list(o.users_collection): c.objects.unlink(o)
    sub(grp).objects.link(o)
    for p in o.data.polygons: p.use_smooth = True
    # 원통 옆면은 부드럽게, 박스 모서리는 각지게 (자동 스무스 30°)
    mod = o.modifiers.new("AutoSmooth", "EDGE_SPLIT"); mod.split_angle = math.radians(30)

# 토피도카 파트를 Empty 하나에 부모 → 이동 애니 한 번에
tc = bpy.data.objects.new("TorpedoCar_Root", None); sub("04_TorpedoCar").objects.link(tc)
tc.location = (26.0, 5.0, 0.0)          # build 스크립트의 TC_X(BF_X+31), RAIL_Y 와 동일
for o in imported:
    if o.name.startswith("IM_Torpedo"):
        o.parent = tc; o.matrix_parent_inverse = tc.matrix_world.inverted()

# ── 3. 재질 교체 (문서 2장 값) ────────────────────────────────────────────
def hexc(h): h = h.lstrip("#"); return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4)) + (1.0,)
def make_mat(name, color, rough=0.6, metal=0.3, emit=None, strength=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True; bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = emit
        bsdf.inputs["Emission Strength"].default_value = strength
    return m
MATS = {
    "Base_Mint":   make_mat("Base_Mint",   hexc("#E4F2E6"), 0.9, 0.0),
    "Base_Rim":    make_mat("Base_Rim",    hexc("#5E7186"), 0.9, 0.0),
    "Steel_Matte": make_mat("Steel_Matte", hexc("#8C9196"), 0.6, 0.3),
    "Steel_Dark":  make_mat("Steel_Dark",  hexc("#54595E"), 0.6, 0.3),
    "Refractory":  make_mat("Refractory",  hexc("#9E8C73"), 0.85, 0.0),
    "Rail":        make_mat("Rail",        hexc("#38383B"), 0.5, 0.5),
    "Ore":         make_mat("Ore",         hexc("#8E4B2B"), 1.0, 0.0),
    "Coal":        make_mat("Coal",        hexc("#292929"), 1.0, 0.0),
    "Molten_Iron": make_mat("Molten_Iron", hexc("#FF6A00"), 0.3, 0.0, hexc("#FF6A00"), 8.0),   # 1,500℃ 쇳물
    "Molten_Hot":  make_mat("Molten_Hot",  hexc("#FFB347"), 0.3, 0.0, hexc("#FFB347"), 14.0),  # 출선구·풍구
}
for o in imported:
    for slot in o.material_slots:
        base = slot.material.name.split(".")[0] if slot.material else ""
        if base in MATS: slot.material = MATS[base]

# ── 4. 월드(원형 그라데이션) + 조명 + 접촉 그림자 ────────────────────────
world = bpy.data.worlds.new("Studio_Grey"); scene.world = world; world.use_nodes = True
nt = world.node_tree; nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputWorld"); bg = nt.nodes.new("ShaderNodeBackground")
ramp = nt.nodes.new("ShaderNodeValToRGB"); grad = nt.nodes.new("ShaderNodeTexGradient"); grad.gradient_type = "SPHERICAL"
mapn = nt.nodes.new("ShaderNodeMapping"); mapn.inputs["Scale"].default_value = (0.9, 0.9, 0.9)
tex = nt.nodes.new("ShaderNodeTexCoord")
ramp.color_ramp.elements[0].color = hexc("#9A9A9A"); ramp.color_ramp.elements[1].color = hexc("#E6E6E6")
nt.links.new(tex.outputs["Window"], mapn.inputs["Vector"])   # 카메라 기준 원형 → 어느 각도에서도 가운데가 밝다
nt.links.new(mapn.outputs["Vector"], grad.inputs["Vector"])
nt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 1.0
nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

def add_light(name, kind, loc, energy, size=None, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
    if size and kind == "AREA": ld.size = size
    lo = bpy.data.objects.new(name, ld); scene.collection.objects.link(lo); lo.location = loc
    lo.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return lo
add_light("Key_Area",  "AREA", (-70, -90, 120), 900000, size=60)
add_light("Fill_Area", "AREA", (110, -40, 70),  250000, size=80, color=(0.95, 0.97, 1.0))
add_light("Rim_Sun",   "SUN",  (40, 120, 90),   1.5)
# 접촉 그림자: 부지 판이 그림자 받이. EEVEE에서는 Key_Area 그림자 + AO로 대체
try: scene.eevee.use_gtao = True; scene.eevee.gtao_distance = 3.0     # EEVEE Legacy AO (Next는 기본 내장)
except Exception: pass

# ── 5. 카메라 오빗 + 토피도카 이동 애니 ─────────────────────────────────
cam_data = bpy.data.cameras.new("CAM_Ironmaking_Orbit"); cam_data.lens = 45
cam = bpy.data.objects.new("CAM_Ironmaking_Orbit", cam_data); scene.collection.objects.link(cam); scene.camera = cam
pivot = bpy.data.objects.new("CAM_Pivot", None); scene.collection.objects.link(pivot)
pivot.location = (5.0, 0.0, 12.0)                     # 고로~토피도카 사이를 화면 중심으로
cam.parent = pivot
R, EL = 150.0, math.radians(40)                       # 반경 150m, 40° 내려다보기 (문서: 35~45°)
cam.location = (0, -R*math.cos(EL), R*math.sin(EL))
cam.rotation_euler = (math.pi/2 - EL, 0, 0)
scene.frame_start, scene.frame_end = 1, FRAMES; scene.render.fps = FPS
pivot.rotation_euler = (0, 0, math.radians(-40)); pivot.keyframe_insert("rotation_euler", frame=1)
pivot.rotation_euler = (0, 0, math.radians(-10)); pivot.keyframe_insert("rotation_euler", frame=FRAMES)   # 10초에 30° 오빗
# 토피도카: 6초까지 정지(출선), 이후 +x로 40m 이동
tc.keyframe_insert("location", frame=1); tc.keyframe_insert("location", frame=int(FPS*6))
tc.location.x += 40.0; tc.keyframe_insert("location", frame=FRAMES)
for ob in (pivot, tc):
    for fc in ob.animation_data.action.fcurves:
        for kp in fc.keyframe_points: kp.interpolation = "BEZIER"; kp.easing = "EASE_IN_OUT"
# 낙하 스트림은 토피도카가 떠나면 사라지게 (가시성 키)
stream = bpy.data.objects.get("IM_Molten_Stream")
if stream:
    stream.hide_render = False; stream.keyframe_insert("hide_render", frame=1)
    stream.hide_render = True; stream.keyframe_insert("hide_render", frame=int(FPS*6)+1)

# ── 6. 렌더 설정 (EEVEE, 1080p, MP4) ────────────────────────────────────
r = scene.render
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
r.resolution_x, r.resolution_y, r.resolution_percentage = 1920, 1080, 100
r.image_settings.file_format = "FFMPEG"; r.ffmpeg.format = "MPEG4"; r.ffmpeg.codec = "H264"
r.ffmpeg.constant_rate_factor = "MEDIUM"; r.ffmpeg.gopsize = 24
os.makedirs(OUT_DIR, exist_ok=True); r.filepath = os.path.join(OUT_DIR, "ironmaking_V3.mp4")
scene.view_settings.view_transform = "Filmic" if "Filmic" in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items] else "AgX"
try: scene.eevee.use_bloom = True; scene.eevee.bloom_intensity = 0.06     # EEVEE Legacy 전용
except Exception: pass                                                       # EEVEE Next는 컴포지터 Glare 로 대체

# 정지 이미지(앱 공정 카드용) 카메라 프레임 1 렌더 경로
still_path = os.path.join(OUT_DIR, "ironmaking_card_still.png")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "ironmaking_scene.blend"))
print("[OK] 컬렉션:", [c.name for c in root.children], "| 저장:", os.path.join(HERE, "ironmaking_scene.blend"))
if DO_RENDER:
    scene.frame_set(1); r.image_settings.file_format = "PNG"; r.filepath = still_path; bpy.ops.render.render(write_still=True)
    r.image_settings.file_format = "FFMPEG"; r.filepath = os.path.join(OUT_DIR, "ironmaking_V3.mp4"); bpy.ops.render.render(animation=True)
    print("[OK] 렌더 완료 →", OUT_DIR)
