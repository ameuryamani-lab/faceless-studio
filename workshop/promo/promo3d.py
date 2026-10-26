"""Faceless Studio promo, 3D cinematic version (brief: "3D cinematic animation, kinetic 3D type, 3D elements, fluid
camera moves, flow the camera"). Builds the six scenes of the promo in one Blender world along a path and flies ONE camera through
them (Bezier-smoothed dolly / orbit / push-in), Eevee, motion blur, depth of field, 1080x1920, 30 fps, 42 s.

Run: blender.exe -b -P workshop/promo/promo3d.py -- <out_dir> <videos> <runs> <tokens> [--preview f1,f2,...]
Frames: <out_dir>/#####.jpg (workshop/promo/render.mjs --mux then adds the narration and the beat).
Images: office/public/promo/ (room-01..12.jpg, room-bg.jpg, cover-01..08.jpg, still-01..18.jpg) holds pictures of YOUR studio and
YOUR videos; nothing is shipped there, and a missing picture becomes a plain grey panel. Titles: STUDIO_PROMO_TITLES (separated by |).
"""
import math
import os
import random
import sys

import bpy

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else os.path.abspath("media/promo/frames-3d")
NUM_VIDEOS, NUM_RUNS, NUM_TOKENS = (int(ARGS[1]), int(ARGS[2]), ARGS[3]) if len(ARGS) >= 4 else (9, 81, "1.7M")
PREVIEW = [int(x) for x in ARGS[ARGS.index("--preview") + 1].split(",")] if "--preview" in ARGS else None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
IMG = os.path.join(ROOT, "office", "public", "promo")
FPS, SECONDS = 30, 42
F = lambda t: int(round(t * FPS)) + 1  # seconds -> frame

random.seed(7)
scene = bpy.context.scene
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)

# ---------- render settings ----------
for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1080, 1920, 100
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, F(SECONDS) - 1
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.45
try:
    scene.eevee.taa_render_samples = 24
except AttributeError:
    pass
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 92
scene.render.filepath = os.path.join(OUT, "#####")
try:
    scene.view_settings.view_transform = "Standard"  # vivid colours (AgX washed the pinks and greens out)
except TypeError:
    pass

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.012, 0.006, 0.03, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

font = None
for path in (r"C:\Windows\Fonts\seguibl.ttf", r"C:\Windows\Fonts\ariblk.ttf", r"C:\Windows\Fonts\arialbd.ttf"):
    if os.path.exists(path):
        font = bpy.data.fonts.load(path)
        break


# ---------- helpers ----------
# With the Standard view transform an emission above ~1 clips to white: every strength is scaled and capped so colours stay.
EMIT = lambda v: min(1.0, v * 0.3)

def mat_emit(name, rgb, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (*rgb, 1)
    em.inputs[1].default_value = EMIT(strength)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def mat_solid(name, rgb, rough=0.35):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*rgb, 1)
    p.inputs["Roughness"].default_value = rough
    return m


def mat_image(path, strength=1.0):
    m = bpy.data.materials.new(os.path.basename(path))
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[1].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    if not os.path.exists(path):  # no picture of your own yet: a plain grey 9:16 panel
        em.inputs[0].default_value = (0.35, 0.35, 0.38, 1.0)
        return m, type("Blank", (), {"size": (1080, 1920)})()
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path)
    nt.links.new(tex.outputs[0], em.inputs[0])
    return m, tex.image


def panel(path, loc, height, rot_z=0.0, strength=1.0):
    m, img = mat_image(path, strength)
    w = height * img.size[0] / max(1, img.size[1])
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=(math.radians(90), 0, rot_z))
    ob = bpy.context.object
    ob.scale = (w, height, 1)
    ob.data.materials.append(m)
    return ob


def text3d(body, loc, size, mat, extrude=0.12, rot=(90, 0, 0)):
    cu = bpy.data.curves.new("t", "FONT")
    cu.body = body
    if font:
        cu.font = font
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = 0.012
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    ob = bpy.data.objects.new("t", cu)
    scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = tuple(math.radians(a) for a in rot)
    cu.materials.append(mat)
    return ob


def box(loc, scale, mat, bevel=0.06):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.object
    ob.scale = scale
    mod = ob.modifiers.new("b", "BEVEL")
    mod.width, mod.segments = bevel, 3
    ob.data.materials.append(mat)
    return ob


def pop(ob, t, base=1.0):
    """Kinetic type: scale 0 -> overshoot -> base around second t."""
    for f, s in ((1, 0.001), (F(t) - 1, 0.001), (F(t) + 6, base * 1.18), (F(t) + 11, base)):
        ob.scale = (s, s, s)
        ob.keyframe_insert("scale", frame=f)


def emit_key(mat, frames_values):
    inp = mat.node_tree.nodes.get("Emission").inputs[1]
    for f, v in frames_values:
        inp.default_value = EMIT(v)
        inp.keyframe_insert("default_value", frame=f)


def color_key(mat, frames_rgb):
    inp = mat.node_tree.nodes.get("Emission").inputs[0]
    for f, rgb in frames_rgb:
        inp.default_value = (*rgb, 1)
        inp.keyframe_insert("default_value", frame=f)


def light(loc, energy, color=(1, 0.9, 1), size=6):
    bpy.ops.object.light_add(type="AREA", location=loc, rotation=(math.radians(75), 0, 0))
    li = bpy.context.object
    li.data.energy, li.data.color, li.data.size = energy, color, size


WHITE, PINK, VIOLET = (1, 1, 1), (1.0, 0.25, 0.55), (0.62, 0.35, 1.0)
GREEN, YELLOW, GREY = (0.1, 0.85, 0.35), (1.0, 0.8, 0.08), (0.45, 0.47, 0.55)
m_white, m_pink, m_violet = mat_emit("white", WHITE, 2.2), mat_emit("pink", PINK, 4.0), mat_emit("violet", VIOLET, 4.0)

# ---------- floor and particles ----------
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 60, -4.2))
floor = bpy.context.object
floor.scale = (60, 160, 1)
floor.data.materials.append(mat_solid("floor", (0.02, 0.01, 0.04), rough=0.12))
m_dot = mat_emit("dot", (0.75, 0.5, 1.0), 6.0)
for _ in range(260):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=random.uniform(0.02, 0.06), subdivisions=1,
                                          location=(random.uniform(-12, 12), random.uniform(-8, 125), random.uniform(-3.8, 9)))
    bpy.context.object.data.materials.append(m_dot)

# ---------- S1: hook (y = 0) ----------
panel(os.path.join(IMG, "room-bg.jpg"), (0, 9, 1), 9, strength=0.35)  # blurred: no readable text behind the title
t1 = text3d("THIS\nCHANNEL", (0, 0, 1.55), 0.85, m_white)
t2 = text3d("RUNS\nITSELF", (0, 0, -0.75), 1.0, m_pink, extrude=0.18)
pop(t1, 0.15)
pop(t2, 0.8)
light((0, -4, 4), 900)

# ---------- S2: agents (y = 20) ----------
for i, x in enumerate((-6, 0, 6)):
    panel(os.path.join(IMG, f"room-{(i * 3 + 2):02d}.jpg"), (x, 27, 1.5), 4.2, rot_z=math.radians(-x * 3), strength=0.6)
num = text3d("0", (0, 20, 3.1), 1.9, m_violet, extrude=0.2)
lab = text3d("AI AGENTS", (0, 20, 1.75), 0.75, m_white)
pop(num, 3.3)
pop(lab, 3.6)
AGENTS = ["TREND SCOUT", "TOPIC EDITOR", "COPYWRITER", "HOOK AUDITOR", "FACT CHECKER", "STORYBOARD", "IMAGE ARTIST", "VOICE", "EDITOR", "QC INSPECTOR"]
for i, name in enumerate(AGENTS):
    x, y = -4.4 + (i % 5) * 2.2, 20.6 + (i // 5) * 2.2
    desk_top = mat_emit(f"desk{i}", GREY, 0.4)
    box((x, y, -1.2), (1.6, 1.0, 0.5), mat_solid(f"deskb{i}", (0.08, 0.05, 0.14)))
    box((x, y, -0.92), (1.5, 0.9, 0.06), desk_top, bevel=0.02)
    at = 4.6 + i * 0.55
    emit_key(desk_top, [(1, 0.4), (F(at), 0.4), (F(at) + 6, 7.0), (F(at) + 14, 3.5)])
    color_key(desk_top, [(F(at), GREY), (F(at) + 4, GREEN)])
    chip = text3d(name, (x, y - 0.3, -0.2), 0.24, m_white, extrude=0.03)
    pop(chip, at)
light((0, 14, 5), 1600)

# ---------- S3: one video, three states (y = 40) ----------
card = panel(os.path.join(IMG, "still-05.jpg"), (0, 40, 0.4), 4.0)
m_frame = mat_emit("frame", GREY, 3.0)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 40.05, 0.4), rotation=(math.radians(90), 0, 0))
frame = bpy.context.object
frame.scale = (card.scale[0] + 0.35, 4.35, 1)
frame.data.materials.append(m_frame)
color_key(m_frame, [(F(11), GREY), (F(14.1), GREY), (F(14.3), YELLOW), (F(16.5), YELLOW), (F(16.7), GREEN)])
emit_key(m_frame, [(F(16.6), 3.0), (F(16.8), 12.0), (F(17.4), 4.0)])
for ob in (card, frame):
    ob.rotation_euler[2] = math.radians(-18)
    ob.keyframe_insert("rotation_euler", frame=F(11))
    ob.rotation_euler[2] = math.radians(14)
    ob.keyframe_insert("rotation_euler", frame=F(19.4))
state = text3d("IN PRODUCTION", (0, 39.6, -2.35), 0.62, mat_emit("state", WHITE, 2.5))
STEPS = ["TREND", "WRITE", "CHECK", "IMAGES", "VOICE", "EDIT", "QC", "LIVE"]
for i, s in enumerate(STEPS):
    m_s = mat_emit(f"step{i}", (0.2, 0.18, 0.28), 1.0)
    box((-3.85 + i * 1.1, 40, 3.15), (0.9, 0.5, 0.5), m_s, bevel=0.08)
    at = 11.2 + i * 0.36
    color_key(m_s, [(F(at) - 1, (0.2, 0.18, 0.28)), (F(at), YELLOW), (F(at) + 8, GREEN)])
    emit_key(m_s, [(F(at) - 1, 1.0), (F(at), 6.0), (F(at) + 8, 3.0)])
    text3d(s, (-3.85 + i * 1.1, 39.7, 3.15), 0.16, m_white, extrude=0.02)
for i, (name, rgb) in enumerate((("YouTube", (1.0, 0.0, 0.05)), ("TikTok", (0.1, 0.95, 0.95)), ("Instagram", (0.9, 0.2, 0.45)))):
    x = -2.6 + i * 2.6
    tile = box((x, 39.4, -3.4), (2.3, 0.4, 0.8), mat_emit(f"tile{i}", rgb, 2.5), bevel=0.15)
    label = text3d(name, (x, 39.15, -3.4), 0.34, mat_emit(f"tl{i}", (0.02, 0.01, 0.04), 1.0), extrude=0.03)
    at = 17.0 + i * 0.3
    for ob in (tile, label):
        ob.location[2] = -9
        ob.keyframe_insert("location", frame=F(at) - 1)
        ob.location[2] = -3.4
        ob.keyframe_insert("location", frame=F(at) + 8)
light((0, 34, 4), 1400)

# ---------- S4: corridor of stories (y = 54..75) ----------
TITLES = [t.strip() for t in os.environ.get("STUDIO_PROMO_TITLES", "Your first story|Your second story|Your third story").split("|") if t.strip()]
for i in range(18):
    side = -1 if i % 2 == 0 else 1
    panel(os.path.join(IMG, f"still-{i + 1:02d}.jpg"), (side * 2.7, 54 + i * 1.15, 0.6), 3.4, rot_z=math.radians(side * -62))
corridor_title = text3d(TITLES[0], (0, 62, -2.6), 0.32, mat_emit("ct", WHITE, 3.0), extrude=0.03)
light((0, 60, 5), 1800)
light((0, 70, 5), 1800)

# ---------- S5: numbers (y = 90) ----------
STATS = [("VIDEOS PUBLISHED", NUM_VIDEOS, GREEN), ("AI AGENT RUNS", NUM_RUNS, VIOLET), ("TOKENS", NUM_TOKENS, YELLOW), ("HUMAN EDITS", 0, (1.0, 0.2, 0.2))]
head = text3d("SINCE LAST NIGHT", (0, 90, 4.4), 0.7, m_white)
pop(head, 29.0)
stat_numbers = []
for i, (label, value, rgb) in enumerate(STATS):
    z = 2.6 - i * 1.9
    at = 29.4 + i * 0.6
    slab = box((0, 90.4 + i * 0.25, z), (7.2, 0.3, 1.5), mat_solid(f"slab{i}", (0.09, 0.06, 0.15), rough=0.25), bevel=0.12)
    bar = box((-3.6, 90.2 + i * 0.25, z - 0.68), (0.001, 0.05, 0.08), mat_emit(f"bar{i}", rgb, 4.0), bevel=0.02)
    lab = text3d(label, (-1.9, 90.2 + i * 0.25, z + 0.38), 0.3, mat_emit(f"sl{i}", (0.8, 0.75, 0.9), 2.0), extrude=0.02)
    n = text3d("0", (2.0, 90.15 + i * 0.25, z - 0.1), 0.85, mat_emit(f"sn{i}", rgb, 3.5), extrude=0.06)
    stat_numbers.append((n, value, at))
    for ob, home in ((slab, 0.0), (lab, -1.9)):
        ob.location[0] = -14
        ob.keyframe_insert("location", frame=F(at) - 1)
        ob.location[0] = home
        ob.keyframe_insert("location", frame=F(at) + 9)
    full = 7.2 if value != 0 else 0.15
    for f, sx, lx in ((F(at) + 4, 0.001, -3.6), (F(at) + 40, full, -3.6 + full / 2)):
        bar.scale = (sx, 0.05, 0.08)
        bar.keyframe_insert("scale", frame=f)
        bar.location[0] = lx
        bar.keyframe_insert("location", frame=f)
light((0, 84, 5), 1600)

# ---------- S6: outro (y = 110) ----------
ring = bpy.data.objects.new("ring", None)
scene.collection.objects.link(ring)
ring.location = (0, 117, 0.5)
for i in range(8):
    a = i * math.tau / 8
    p = panel(os.path.join(IMG, f"cover-{i + 1:02d}.jpg"), (0, 0, 0), 3.2, strength=0.9)
    p.parent = ring
    p.location = (math.sin(a) * 6.5, -math.cos(a) * 6.5, 0)
    p.rotation_euler = (math.radians(90), 0, a)
ring.rotation_euler = (0, 0, 0)
ring.keyframe_insert("rotation_euler", frame=F(37))
ring.rotation_euler = (0, 0, math.radians(70))
ring.keyframe_insert("rotation_euler", frame=F(42))
f1 = text3d("FOLLOW", (0, 110, 1.6), 1.0, m_white, extrude=0.18)
f2 = text3d("TO WATCH\nIT GROW", (0, 110, -0.2), 0.7, m_pink, extrude=0.12)
f3 = text3d("a new story every hour", (0, 110, -1.55), 0.3, mat_emit("f3", (0.8, 0.75, 0.9), 2.0), extrude=0.02)
pop(f1, 37.2)
pop(f2, 37.6)
pop(f3, 38.3)
light((0, 104, 5), 1600)

# ---------- camera: one continuous flight ----------
target = bpy.data.objects.new("target", None)
scene.collection.objects.link(target)
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 32
cam_data.dof.use_dof = True
cam_data.dof.focus_object = target
cam_data.dof.aperture_fstop = 2.2
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
con = cam.constraints.new("TRACK_TO")
con.target, con.track_axis, con.up_axis = target, "TRACK_NEGATIVE_Z", "UP_Y"
PATH = [  # seconds, camera, target
    (0.0, (0.8, -5.2, 0.9), (0, 0, 0.5)), (3.0, (0, -11.5, 0.6), (0, 0, 0.5)),
    (4.3, (3.5, 9.5, 2.8), (0, 20, 1.2)), (10.6, (-3.8, 10.5, 1.6), (0, 21, 0.6)),
    (11.8, (0, 29.5, 0.9), (0, 40, 0.3)), (19.1, (2.2, 31.5, 1.3), (0, 40, 0.0)),
    (20.0, (0, 49, 0.5), (0, 60, 0.4)), (28.6, (0, 73, 0.3), (0, 84, 0.3)),
    (29.6, (0, 79.5, 0.8), (0, 90, 0.4)), (36.7, (-1.8, 81, 0.9), (0, 90, 0.0)),
    (37.9, (0, 99.5, 0.6), (0, 110, 0.5)), (42.0, (0, 102.5, 0.5), (0, 110, 0.4)),
]
for t, c, g in PATH:
    cam.location, target.location = c, g
    cam.keyframe_insert("location", frame=F(t))
    target.keyframe_insert("location", frame=F(t))


# ---------- live numbers and titles (text bodies change per frame) ----------
def ease(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def on_frame(sc, *_):
    t = (sc.frame_current - 1) / FPS
    num.data.body = str(round(22 * ease((t - 3.3) / 1.4)))
    state.data.body = "IN PRODUCTION" if t < 14.2 else ("READY" if t < 16.6 else "LIVE")
    corridor_title.data.body = TITLES[min(len(TITLES) - 1, max(0, int((t - 19.8) / 1.45)))]
    corridor_title.location[1] = 52 + max(0.0, t - 19.8) * 2.75
    corridor_title.hide_render = not (19.5 <= t < 29.0)
    for ob, value, at in stat_numbers:
        ob.hide_render = t < at
    for ob, value, at in stat_numbers:
        p = ease((t - at - 0.2) / 1.4)
        if isinstance(value, (int, float)):
            ob.data.body = str(round(value * p))
        else:
            n = float(str(value).rstrip("MK"))
            ob.data.body = f"{n * p:.1f}{str(value)[-1]}"


bpy.app.handlers.frame_change_pre.append(on_frame)

os.makedirs(OUT, exist_ok=True)
if PREVIEW:
    for f in PREVIEW:
        scene.frame_set(f)
        scene.render.filepath = os.path.join(OUT, f"preview-{f:05d}")
        bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
