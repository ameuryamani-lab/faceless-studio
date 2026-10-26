"""Faceless Studio promo, step 3b (brief: show the agents working, the orders passing from agent to agent, almost
no text; "3D cinematic, kinetic 3D type, fluid camera moves, flow the camera"). The REAL film of the vitrine (edit.mjs) plays
on a giant screen in a 3D world; one camera flies through the title, drifts and tilts over the film while 3D badges name each
agent as its order card lands, then pulls away to the three states (grey -> yellow -> green), the three platform portals and
the real counter. Eevee, 1080x1920, 30 fps.

Run: blender.exe -b -P workshop/promo/promo_comp.py -- <out_dir> <foot_dir> <timeline.json> <cover.jpg> <videos> [--preview f,f]
"""
import json
import math
import os
import random
import sys

import bpy

ARGS = sys.argv[sys.argv.index("--") + 1:]
OUT, FOOT, TIMELINE, COVER, NUM_VIDEOS = ARGS[0], ARGS[1], ARGS[2], ARGS[3], int(ARGS[4])
PREVIEW = [int(x) for x in ARGS[ARGS.index("--preview") + 1].split(",")] if "--preview" in ARGS else None
RANGE = [int(x) for x in ARGS[ARGS.index("--range") + 1].split(",")] if "--range" in ARGS else None  # re-render a part only
TL = json.load(open(TIMELINE, encoding="utf-8"))
FPS = 30
INTRO = 3.5                       # title before the film
FOOT_S = TL["seconds"]
OUTRO = 11.5
SECONDS = INTRO + FOOT_S + OUTRO
E = INTRO + FOOT_S                # film ends, outro starts
F = lambda t: int(round(t * FPS)) + 1

random.seed(11)
scene = bpy.context.scene
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)

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
scene.render.motion_blur_shutter = 0.35
try:
    scene.eevee.taa_render_samples = 16
except AttributeError:
    pass
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 93
scene.render.filepath = os.path.join(OUT, "#####")
try:
    scene.view_settings.view_transform = "Standard"
except TypeError:
    pass

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.010, 0.005, 0.025, 1)

font = None
for p in (r"C:\Windows\Fonts\seguibl.ttf", r"C:\Windows\Fonts\ariblk.ttf", r"C:\Windows\Fonts\arialbd.ttf"):
    if os.path.exists(p):
        font = bpy.data.fonts.load(p)
        break

EMIT = lambda v: min(1.0, v * 0.3)
WHITE, PINK, VIOLET = (1, 1, 1), (1.0, 0.3, 0.6), (0.62, 0.35, 1.0)
GREEN, YELLOW, GREY = (0.12, 0.85, 0.36), (1.0, 0.8, 0.08), (0.5, 0.52, 0.6)
NETS = [("YOUTUBE", (1.0, 0.0, 0.2)), ("INSTAGRAM", (0.88, 0.19, 0.42)), ("TIKTOK", (0.15, 0.95, 0.93))]


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


def mat_image(img, strength=1.0, name="img"):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[1].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tex.outputs[0], em.inputs[0])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m, tex


def plane(loc, w, h, mat, rot_z=0.0):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=(math.radians(90), 0, rot_z))
    ob = bpy.context.object
    ob.scale = (w, h, 1)
    ob.data.materials.append(mat)
    return ob


def text3d(body, loc, size, mat, extrude=0.1, bevel=0.01):
    cu = bpy.data.curves.new("t", "FONT")
    cu.body = body
    if font:
        cu.font = font
    cu.size, cu.extrude, cu.bevel_depth = size, extrude, bevel
    cu.align_x, cu.align_y = "CENTER", "CENTER"
    ob = bpy.data.objects.new("t", cu)
    scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (math.radians(90), 0, 0)
    cu.materials.append(mat)
    return ob


def box(loc, scale, mat, bevel=0.08):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.object
    ob.scale = scale
    mod = ob.modifiers.new("b", "BEVEL")
    mod.width, mod.segments = bevel, 3
    ob.data.materials.append(mat)
    return ob


def scale_keys(ob, keys):
    for t, s in keys:
        ob.scale = (s, s, s) if isinstance(s, (int, float)) else s
        ob.keyframe_insert("scale", frame=F(t))


def pop(ob, t_in, t_out=None, base=None):
    """Kinetic type: 0 -> overshoot -> its size, and back to 0 at t_out."""
    b = tuple(ob.scale) if base is None else (base, base, base)
    tiny = (0.001, 0.001, 0.001)
    over = tuple(v * 1.16 for v in b)
    keys = [(0, tiny), (max(0, t_in - 0.03), tiny), (t_in + 0.2, over), (t_in + 0.37, b)]
    if t_out:
        keys += [(t_out - 0.18, b), (t_out, tiny)]
    scale_keys(ob, keys)


def emit_key(mat, pairs):
    inp = mat.node_tree.nodes.get("Emission").inputs[1]
    for t, v in pairs:
        inp.default_value = EMIT(v)
        inp.keyframe_insert("default_value", frame=F(t))


def color_key(mat, pairs):
    inp = mat.node_tree.nodes.get("Emission").inputs[0]
    for t, rgb in pairs:
        inp.default_value = (*rgb, 1)
        inp.keyframe_insert("default_value", frame=F(t))


m_white, m_pink, m_violet = mat_emit("white", WHITE, 2.4), mat_emit("pink", PINK, 3.6), mat_emit("violet", VIOLET, 3.6)

# ---------- particles (depth) ----------
m_dot = mat_emit("dot", (0.75, 0.5, 1.0), 5.0)
for _ in range(220):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=random.uniform(0.02, 0.07), subdivisions=1,
                                          location=(random.uniform(-14, 46), random.uniform(-40, 14), random.uniform(-10, 14)))
    bpy.context.object.data.materials.append(m_dot)

# ---------- the film screen (y = 0), 9 x 16 ----------
W, H = 9.0, 16.0
first = sorted(f for f in os.listdir(FOOT) if f.endswith(".jpg"))[0]
seq = bpy.data.images.load(os.path.join(FOOT, first))
seq.source = "SEQUENCE"
m_foot, tex = mat_image(seq, 1.0, "film")
tex.image_user.frame_duration = TL["frames"]
tex.image_user.frame_start = F(INTRO)
tex.image_user.frame_offset = 0
tex.image_user.use_auto_refresh = True
screen = plane((0, 0, 0), W, H, m_foot)
# The film appears when it starts (before its first frame the texture would show Blender's pink "missing" colour).
emit_key(m_foot, [(0, 0.0), (INTRO - 0.05, 0.0), (INTRO + 0.25, 3.34)])  # 3.34 * 0.3 = 1.0: the film at full brightness
m_rim = mat_emit("rim", VIOLET, 3.0)
for (x, z, sx, sz) in ((0, H / 2 + 0.08, W + 0.3, 0.12), (0, -H / 2 - 0.08, W + 0.3, 0.12), (W / 2 + 0.08, 0, 0.12, H + 0.3), (-W / 2 - 0.08, 0, 0.12, H + 0.3)):
    box((x, 0.05, z), (sx, 0.12, sz), m_rim, bevel=0.03)

# ---------- intro title (in front of the screen, the camera flies through it) ----------
t1 = text3d("THIS\nCHANNEL", (0, -24, 2.6), 0.9, m_white, extrude=0.12)
t2 = text3d("RUNS\nITSELF", (0, -24, -0.3), 1.08, m_pink, extrude=0.16)
pop(t1, 0.15)
pop(t2, 0.75)

# ---------- camera ----------
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
R = math.radians


def hud(ob, x, y, dist=6.0, tilt=4.0):
    """Kinetic type that rides with the camera: centred, always in frame, slightly tilted in 3D (camera space: x right,
    y up, the camera looks down -z)."""
    ob.parent = cam
    ob.location = (x, y, -dist)
    ob.rotation_euler = (R(tilt), 0, 0)
    return ob


# ---------- 22 AI agents, then one badge per hand-off (in the lower third, on the camera) ----------
n22 = hud(text3d("22", (0, 0, 0), 0.62, m_violet, extrude=0.08), 0, -1.05)
l22 = hud(text3d("AI AGENTS", (0, 0, 0), 0.24, m_white, extrude=0.04), 0, -1.62)
pop(n22, INTRO + 0.15, INTRO + 2.4)
pop(l22, INTRO + 0.35, INTRO + 2.4)
m_dark = mat_emit("dark", (0.07, 0.04, 0.13), 3.0)  # the vitrine's dark panels: white text stays readable
badges = TL["badges"]
for i, b in enumerate(badges):
    t_in = INTRO + b["at"]
    t_out = min(INTRO + badges[i + 1]["at"] - 0.05, t_in + 2.2) if i + 1 < len(badges) else t_in + 2.2
    if t_in < INTRO + 2.5:  # leave the "22 AI AGENTS" moment alone
        continue
    txt = hud(text3d(b["text"], (0, 0, 0), 0.2, m_white, extrude=0.008, bevel=0.0), 0, -1.515, dist=5.95)
    w = 0.135 * len(b["text"]) + 0.5
    plate = hud(box((0, 0, 0), (w, 0.42, 0.04), m_dark, bevel=0.1), 0, -1.53, dist=6.02)
    edge = hud(box((0, 0, 0), (w + 0.06, 0.48, 0.03), m_violet, bevel=0.12), 0, -1.53, dist=6.05)  # a violet outline
    pop(txt, t_in, t_out)
    pop(plate, t_in - 0.04, t_out)
    pop(edge, t_in - 0.04, t_out)

# ---------- outro (x = 34): the cover goes grey -> yellow -> green, flies through 3 portals, then the real counter ----------
OX = 34.0
cover_img = bpy.data.images.load(COVER)
m_cover, _ = mat_image(cover_img, 1.0, "cover")
m_state = mat_emit("state", GREY, 3.0)
phone = plane((OX, 0, 1.0), 3.15, 5.6, m_cover)
frame = box((OX, 0.1, 1.0), (3.45, 0.08, 5.9), m_state, bevel=0.14)
color_key(m_state, [(E + 0.3, GREY), (E + 1.4, GREY), (E + 1.6, YELLOW), (E + 2.6, YELLOW), (E + 2.8, GREEN)])
for i, (rgb, t_on) in enumerate(((GREY, E + 0.4), (YELLOW, E + 1.6), (GREEN, E + 2.8))):
    m = mat_emit(f"s{i}", rgb, 0.6)
    dot = box((OX - 1.4 + i * 1.4, -0.4, -2.75), (0.9, 0.25, 0.25), m, bevel=0.1)
    emit_key(m, [(E, 0.6), (t_on - 0.05, 0.6), (t_on + 0.15, 4.5)])
    pop(dot, E + 0.3 + i * 0.12)
RINGS_Y = (4.0, 9.0, 14.0)
FLY_FROM, FLY_TO, FLY_Y = E + 3.4, E + 5.2, 22.0
for ob in (phone, frame):
    y0 = ob.location.y
    for t, y in ((FLY_FROM, y0), (FLY_TO, y0 + FLY_Y)):
        ob.location.y = y
        ob.keyframe_insert("location", frame=F(t))
    scale_keys(ob, [(FLY_TO - 0.5, tuple(ob.scale)), (FLY_TO, (0.001, 0.001, 0.001))])
for i, ((name, rgb), y) in enumerate(zip(NETS, RINGS_Y)):
    m = mat_emit(f"net{i}", rgb, 0.8)
    bpy.ops.mesh.primitive_torus_add(location=(OX, y, 1.0), rotation=(R(90), 0, 0), major_radius=3.9, minor_radius=0.2)
    ring = bpy.context.object
    ring.data.materials.append(m)
    t_pass = FLY_FROM + (FLY_TO - FLY_FROM) * (y / FLY_Y)
    emit_key(m, [(E, 0.8), (t_pass - 0.1, 0.8), (t_pass + 0.1, 5.5)])
    pop(ring, E + 2.9 + i * 0.1)
    lab = text3d(name, (OX, y - 0.2, -2.45), 0.42, mat_emit(f"lab{i}", rgb, 3.0), extrude=0.06)
    pop(lab, t_pass - 0.25, FLY_TO + 0.4 + i * 0.1)
CY = 30.0  # the counter, beyond the portals
count = text3d("0", (OX, CY, 1.9), 2.6, m_violet, extrude=0.26)
cl = text3d("VIDEOS\nSINCE LAST NIGHT", (OX, CY, -0.5), 0.46, m_white, extrude=0.05)
zero = text3d("0 HUMAN EDITS", (OX, CY, -2.3), 0.56, m_pink, extrude=0.1)
pop(count, E + 5.3, E + 9.0)
pop(cl, E + 5.5, E + 9.0)
pop(zero, E + 6.6, E + 9.0)
fol = text3d("FOLLOW\nTO WATCH\nIT GROW", (OX, CY, 0.6), 0.95, m_white, extrude=0.16)
pop(fol, E + 9.15)


def on_frame(sc, *_):
    t = (sc.frame_current - 1) / FPS
    k = max(0.0, min(1.0, (t - (E + 5.3)) / 1.4))
    count.data.body = str(int(round(NUM_VIDEOS * (1 - (1 - k) ** 3))))


bpy.app.handlers.frame_change_pre.clear()
bpy.app.handlers.frame_change_pre.append(on_frame)

# ---------- camera path ----------
D_FILM = 17.0
Z_FILM = 2.0
# (seconds, location, rotation in degrees: x = 90 looks along +y; then roll, yaw)
KEYS = [
    (0.0, (0, -46, 1.2), (90, 0, 0)),
    (2.3, (0, -37, 1.1), (90, 0, 0)),
    (INTRO, (0, -D_FILM - 2, Z_FILM), (90, 0, 0)),
]
side = 1
for s in TL["sections"][1:]:  # over the film: slow drift and tilt, changing side on each section
    KEYS.append((INTRO + s["start"], (0.9 * side, -D_FILM + 0.6 * side, Z_FILM + 0.25 * side), (90 + 1.5 * side, 1.2 * side, -2.6 * side)))
    side = -side
KEYS += [
    (E - 0.4, (-0.6, -D_FILM - 1.2, Z_FILM), (90, -0.8, 1.8)),
    (E + 0.9, (OX * 0.6, -15, 1.6), (91, 0, -10)),
    (E + 1.6, (OX, -12.5, 0.9), (90, 0, 0)),
    (E + 3.2, (OX + 0.3, -11.5, 0.9), (90, 0.6, -1)),
    (E + 5.4, (OX, 14.0, 1.0), (90, 0, 0)),
    (E + 6.2, (OX, 17.6, 0.6), (90, 0, 0)),
    (E + 9.0, (OX + 0.3, 18.2, 0.6), (90, 0.6, -1)),
    (SECONDS, (OX, 18.8, 0.6), (90, 0, 0)),
]
KEYS.sort(key=lambda k: k[0])
for t, loc, rot in KEYS:
    cam.location = loc
    cam.rotation_euler = (R(rot[0]), R(rot[1]), R(rot[2]))
    cam.keyframe_insert("location", frame=F(t))
    cam.keyframe_insert("rotation_euler", frame=F(t))
try:
    fcurves = list(cam.animation_data.action.fcurves)
except AttributeError:  # Blender 5 layered actions
    fcurves = [fc for layer in cam.animation_data.action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
for fc in fcurves:
    for kp in fc.keyframe_points:
        kp.interpolation = "BEZIER"
        kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
    if fc.data_path == "location":
        mod = fc.modifiers.new("NOISE")  # a hand-held breath, very small
        mod.scale, mod.strength, mod.phase = 60, 0.18, fc.array_index * 7.0

bpy.ops.object.light_add(type="AREA", location=(0, -10, 8), rotation=(R(70), 0, 0))
bpy.context.object.data.energy = 600

os.makedirs(OUT, exist_ok=True)
if PREVIEW:
    for f in PREVIEW:
        scene.frame_set(f)
        scene.render.filepath = os.path.join(OUT, f"preview-{f:05d}")
        bpy.ops.render.render(write_still=True)
else:
    if RANGE:
        scene.frame_start, scene.frame_end = RANGE
    bpy.ops.render.render(animation=True)
print(f"promo_comp: {scene.frame_end} frames, {SECONDS:.1f}s, outro at {E:.1f}s")
