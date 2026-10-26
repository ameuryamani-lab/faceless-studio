# Faceless Studio: the 3D room of the vitrine, v2. Target: a photo-like isometric cutaway diorama; notes on v1: no trees inside, the sofa out of the way in its own corner, a tidy deliberate layout, the back wall a SCREEN
# WALL (main screen + 4 of our videos + 4 trends). Blender + Three.js.
# Same file schema as v1 (room.py) so the page keeps working: one baked "room" mesh, live quads (screen_main, wall_ours_1..4,
# wall_trend_1..4, monitor_<team>_<1..3>), room-layout.json with the same keys plus screens.wall_ours / screens.wall_trends.
# Robots stand at the west end of each desk facing east-ish; the monitor sits at the desk's far corner angled toward them, so
# the iso camera sees both their faces (3/4) and the screens. No chairs at robot spots. Two bakes on the same UVs: day (GLB
# base colour) and evening (room-night.jpg: dusk sky, desk lamps and LED cove on).
# Run hidden:  blender -b --factory-startup --python workshop/blender/room_v2.py -- <out_dir> [--no-bake] [--samples N] [--night-preview]
# The robot models come from office/public/models; the wall covers (cover-ours-1.jpg ...) from STUDIO_ROOM_COVERS, else
# media/salle3d-covers (a missing cover gets a plain colour).
import json
import os
import math
import sys

import bmesh
import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else "."
BAKE = "--no-bake" not in ARGS
SAMPLES = int(ARGS[ARGS.index("--samples") + 1]) if "--samples" in ARGS else 160
ATLAS = 4096

W, D, H = 15.0, 10.5, 3.4  # walls on x=0 (windows) and y=D (screen wall); open toward +x and -y. Blender Z up, metres.
BACK_Y, FRONT_Y = 6.6, 2.4  # pod rows; the U aisle runs between them (y ~ 4.5)
TEAMS = [  # production order along the U: back row left to right, then front row right to left; pods aligned in columns
    ("research", "Recherche", (2.7, BACK_Y), "back"),
    ("strategy", "Stratégie", (5.9, BACK_Y), "back"),
    ("writing", "Écriture", (9.1, BACK_Y), "back"),
    ("character", "Personnage", (12.3, BACK_Y), "back"),
    ("visual", "Image", (12.3, FRONT_Y), "front"),
    ("sound_edit", "Son et montage", (9.1, FRONT_Y), "front"),
    ("distribution", "Diffusion", (5.9, FRONT_Y), "front"),
]
LESTER = (W / 2, 9.6)  # central, in front of the screen wall (v7: no robot head overlaps his platform in the iso view)
SEAT = 0.39  # stool seat top (m): the robot's hover base rests on it (v8: 6 cm lower, hidden behind the desk backs)
DESK_TOP = 0.7525  # desk top surface (desk centre 0.72 + half of 0.065): props sit on it
# Each department has its colour: the robots' body colour per team (Lester keeps his violet and gold).
TEAM_COLORS = {"research": "#19b8c9", "strategy": "#3b82f6", "writing": "#eab308", "character": "#ec4899",
               "visual": "#f97316", "sound_edit": "#ef4444", "distribution": "#7bc74d"}  # v10: cyan-teal vs leaf green  # the live page uses the same


RUG_BASE = {"sound_edit": "#b3201a", "visual": "#f08800", "research": "#00a496", "distribution": "#52a828", "character": "#d0106e", "strategy": "#1f66d8", "writing": "#d8c400"}  # v15: tuned by preview (hue 45, a > 0)  # v14: tuned by preview (yellow hue 49 vs orange 26)
if "--rugs" in ARGS:  # preview tuning: --rugs writing=#dcb800,visual=#ec8600
    RUG_BASE.update(dict(kv.split("=") for kv in ARGS[ARGS.index("--rugs") + 1].split(",")))  # v10: a deep red base (the lit rug read coral next to orange and the lounge rug)


def pastel(h, f=0.62):
    """The colour mixed with warm white: a soft rug tone."""
    h = h.lstrip("#")
    return "#" + "".join(f"{int(int(h[i:i + 2], 16) * (1 - f) + 245 * f):02x}" for i in (0, 2, 4))


def darker(h, f=0.55):
    h = h.lstrip("#")
    return "#" + "".join(f"{int(int(h[i:i + 2], 16) * f):02x}" for i in (0, 2, 4))
ROBOT_H, LESTER_H = 0.9, 1.05  # robot height to the top of the head, as the page shows them
SPOTS = []  # robot seats, for the beauty render with the robots in place
STUDIO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(STUDIO, "office", "public", "models")
WASH = []  # the LED cove wash lights (brighter at night)
FRONT_FILL = []  # v8: a warm low fill over the front half, day only
BACK_FILL = []  # v9: a soft day fill over the back half (it baked ~185)
DAY_FR = []  # v12: a warm day fill over the front-right floor (it read cool grey)
NIGHT_FR = []  # v10: a warm low night fill over the front-right floor (it stayed cold grey-mauve)
NIGHT_LOUNGE = []  # v14: warm night light over the lounge / window half
NIGHT_MEDIA = []  # v13: night-only warm strip parallel to the media wall
NIGHT_WALL = []  # v8: a cool grazing light on the media wall, night only (its lower half went black)
NIGHT_LIGHTS = []  # warm area lights over the pod rows, night bake only
LAMP_SPOTS = []  # a warm spot under each mushroom lamp, night only (pools of light at the desks)
COVERS = os.environ.get("STUDIO_ROOM_COVERS") or os.path.join(STUDIO, "media", "salle3d-covers")
EMITTERS = {}  # material name -> (day strength, night strength)


def hexrgb(h, a=1.0):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return (*[c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb], a)


MATS = {}


def mat(name, color, rough=0.6, metal=0.0, emit=None, day=0.0, night=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hexrgb(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if not metal:  # v7: low gloss, the unlit page cannot show view-dependent shine (beauty = page)
        b.inputs["Specular IOR Level"].default_value = 0.15
    if emit:
        b.inputs["Emission Color"].default_value = hexrgb(emit)
        b.inputs["Emission Strength"].default_value = day
        EMITTERS[name] = (day, night)
    MATS[name] = m
    return m


def texture(m, kind, scale=1.0, amount=0.25, stretch=(1, 1, 1), color2=None, mortar="#aab5a6", bump=0.0):
    """Procedural detail baked into the atlas: wood planks, woven rugs, grain, mottled plaster."""
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    base = tuple(b.inputs["Base Color"].default_value)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = stretch
    nt.links.new(coord.outputs["Object"], mp.inputs["Vector"])
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale * 6
    noise.inputs["Detail"].default_value = 8.0
    nt.links.new(mp.outputs["Vector"], noise.inputs["Vector"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = amount
    mix.inputs[6].default_value = base
    if kind == "planks":
        brick = nt.nodes.new("ShaderNodeTexBrick")
        brick.inputs["Scale"].default_value = scale
        brick.inputs["Mortar Size"].default_value = 0.006
        brick.inputs["Brick Width"].default_value = 1.6
        brick.inputs["Row Height"].default_value = 0.18
        brick.inputs["Color1"].default_value = base
        brick.inputs["Color2"].default_value = hexrgb(color2 or "#c79f72")
        brick.inputs["Mortar"].default_value = hexrgb("#9a7650")
        nt.links.new(mp.outputs["Vector"], brick.inputs["Vector"])
        nt.links.new(brick.outputs["Color"], mix.inputs[6])
    elif kind == "tiles":  # 60 x 60 cm sage-stone tiles, 12 mm grout (wide enough to survive the bake), world-space position
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        nt.links.new(geo.outputs["Position"], mp.inputs["Vector"])
        brick = nt.nodes.new("ShaderNodeTexBrick")
        brick.inputs["Scale"].default_value = scale
        brick.inputs["Mortar Size"].default_value = 0.013
        brick.inputs["Brick Width"].default_value = 0.6
        brick.inputs["Row Height"].default_value = 0.6
        brick.offset = 0.0
        brick.inputs["Color1"].default_value = base
        brick.inputs["Color2"].default_value = hexrgb(color2 or "#e3dfd8")
        brick.inputs["Mortar"].default_value = hexrgb(mortar)  # visible grout; grid origin x=0, y=0, period 0.6 m
        nt.links.new(mp.outputs["Vector"], brick.inputs["Vector"])
        nt.links.new(brick.outputs["Color"], mix.inputs[6])
    elif kind == "woven":
        chk = nt.nodes.new("ShaderNodeTexChecker")
        chk.inputs["Scale"].default_value = scale * 14
        chk.inputs["Color1"].default_value = base
        chk.inputs["Color2"].default_value = hexrgb(color2 or "#b39570")
        nt.links.new(mp.outputs["Vector"], chk.inputs["Vector"])
        nt.links.new(chk.outputs["Color"], mix.inputs[6])
    nt.links.new(noise.outputs["Fac"], mix.inputs[7])  # v8: grey value noise (the colour noise drifted the hue)
    nt.links.new(mix.outputs[2], b.inputs["Base Color"])
    if bump:  # a touchable surface (baked: no runtime cost)
        bp = nt.nodes.new("ShaderNodeBump")
        bp.inputs["Strength"].default_value = bump
        fine = nt.nodes.new("ShaderNodeTexNoise")
        fine.inputs["Scale"].default_value = scale * 40
        nt.links.new(mp.outputs["Vector"], fine.inputs["Vector"])
        nt.links.new(fine.outputs["Fac"], bp.inputs["Height"])
        nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
    return m


def active(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def finish(o, name, m, bevel=0.0, segs=2, smooth=False):
    o.name = name
    o.data.name = name
    active(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        mod = o.modifiers.new("b", "BEVEL")
        mod.width, mod.segments, mod.limit_method = bevel, segs, "ANGLE"
        bpy.ops.object.modifier_apply(modifier="b")
    if smooth or bevel:
        bpy.ops.object.shade_smooth()
        try:
            bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
        except Exception:
            pass
    o.data.materials.append(m)
    return o


def box(name, size, loc, m, bevel=0.012, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = size
    return finish(o, name, m, min(bevel, min(size) * 0.45))


def cyl(name, r, depth, loc, m, verts=20, r2=None, rot=(0, 0, 0), bevel=0.0):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, vertices=verts, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, location=loc, vertices=verts, rotation=rot)
    return finish(bpy.context.object, name, m, bevel, smooth=True)


def quad(name, size, loc, rot, m):
    """A UV'd plane for live content (the page draws on it)."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = o.data.name = name
    o.scale = (size[0], size[1], 1)
    active(o)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    o.data.materials.append(m)
    return o


def leaf_mesh(name, length, width, m, splits=0, curl=0.25):
    """An organic leaf: an oval, optionally with monstera splits (thin wedges cut from the edge), bent along its length."""
    bm = bmesh.new()
    segs, rings = 14, 4  # v7: lighter leaves (page weight)
    rows = []
    for i in range(segs + 1):
        t = i / segs
        half = math.sin(math.pi * t) ** 0.8 * width / 2
        row = []
        for j in range(rings + 1):
            u = j / rings * 2 - 1
            v = bm.verts.new((t * length, u * half, 0))
            row.append(v)
        rows.append(row)
    cut_rows = {int(segs * (0.3 + 0.18 * k)) for k in range(splits)}
    for i in range(segs):
        for j in range(rings):
            edge = j in (0, rings - 1)  # v8: the split stops ~50 % of the way to the midrib (was the whole row: zebra paddles)
            if i in cut_rows and edge:
                continue  # a split from the edge toward the midrib
            bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
    for v in bm.verts:
        x = v.co.x / length
        v.co.z = -curl * x * x * length + 0.05 * abs(v.co.y) / max(width, 1e-3) * width
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    active(o)
    mod = o.modifiers.new("s", "SOLIDIFY")
    mod.thickness = 0.005
    bpy.ops.object.modifier_apply(modifier="s")
    bpy.ops.object.shade_smooth()
    o.data.materials.append(m)
    return o


def place(o, loc, yaw, pitch):
    o.rotation_euler = (0, -pitch, yaw)
    o.location = loc
    active(o)
    bpy.ops.object.transform_apply(location=True, rotation=True)
    return o


POT_COLORS = {"terracotta": "#c26e4a", "sage": "#8fa68b", "charcoal": "#3a3a42", "ceramic": "#f1ede6"}


def pot(name, loc, r, h, kind, z0=0.0, plinth=False, soil_up=0.0):
    """An OPEN pot (wide at the top, 18 mm wall, soil a few cm under the rim), optionally on a solid oak plinth (v5: the old
    pots were closed upside-down buckets)."""
    if plinth:
        box(f"{name}_plinth", (2.3 * r, 2.3 * r, 0.18), (loc[0], loc[1], z0 + 0.09), MATS["oak"], bevel=0.02)
        z0 += 0.18
    bpy.ops.mesh.primitive_cone_add(radius1=r * 0.78, radius2=r, depth=h, location=(loc[0], loc[1], z0 + h / 2), vertices=32)
    o = bpy.context.object
    bm = bmesh.new()
    bm.from_mesh(o.data)
    top = max(bm.faces, key=lambda f: f.calc_center_median().z)
    bmesh.ops.delete(bm, geom=[top], context="FACES")
    bm.to_mesh(o.data)
    bm.free()
    finish(o, f"{name}_pot", mat(f"pot_{kind}", POT_COLORS.get(kind, "#c26e4a"), 0.6 if kind != "ceramic" else 0.35), smooth=True)
    sol = o.modifiers.new("s", "SOLIDIFY")
    sol.thickness = 0.018
    sol.offset = -1
    active(o)
    bpy.ops.object.modifier_apply(modifier="s")
    bpy.ops.object.mode_set(mode="EDIT")  # v10: a fresh unwrap after the solidify, no shared texels between the walls
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    soil_z = z0 + h - min(0.05, max(0.02, h * 0.12)) + soil_up
    cyl(f"{name}_soil", r * (0.78 + 0.22 * (soil_z - z0) / h) - 0.02, 0.012, (loc[0], loc[1], soil_z), mat("soil", "#3b2a20", 0.95), verts=24)
    return soil_z


def plant_stand(name, loc, r, h=0.3):
    """A ref-iso style oak plant stand: a thick top on 4 short thick legs. Returns the top height (the pot's z0)."""
    oak = MATS["oak"]
    box(f"{name}_top", (2.2 * r, 2.2 * r, 0.04), (loc[0], loc[1], h - 0.02), oak, bevel=0.012)
    for j, (sx, sy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
        box(f"{name}_leg{j}", (0.10, 0.10, h - 0.04), (loc[0] + sx * 0.8 * r, loc[1] + sy * 0.8 * r, (h - 0.04) / 2), oak, bevel=0.008)
    return h


def rod(name, a, b, r, m, verts=8):
    """A cylinder from a to b (monstera stems)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, location=(a + b) / 2, vertices=verts)
    o = bpy.context.object
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = d.to_track_quat("Z", "Y")
    return finish(o, name, m, smooth=True)


def fig_leaf(name, length, width):
    """v10: a fiddle-leaf fig leaf: solid, wider toward the tip, lighter midrib, gently cupped and drooping. No cuts."""
    bm = bmesh.new()
    segs, rings = 16, 6
    rows = []
    for i in range(segs + 1):
        t = i / segs
        half = (math.sin(math.pi * t) ** 0.55) * (0.62 + 0.38 * t) * width / 2
        rows.append([bm.verts.new((t * length, (j / rings * 2 - 1) * half, 0)) for j in range(rings + 1)])
    for i in range(segs):
        for j in range(rings):
            f = bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
            if j in (rings // 2 - 1, rings // 2) and abs((j + 0.5) / rings * 2 - 1) < 0.2:
                f.material_index = 1
    for v in bm.verts:
        x = v.co.x / length
        v.co.z = -0.18 * x * x * length + 0.12 * abs(v.co.y)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    active(o)
    mod = o.modifiers.new("s", "SOLIDIFY")
    mod.thickness = 0.006
    bpy.ops.object.modifier_apply(modifier="s")
    bpy.ops.object.shade_smooth()
    o.data.materials.append(mat("leaf_fig", "#3a8048", 0.35))
    o.data.materials.append(mat("leaf_midrib", "#4f9a5c", 0.5))
    return o


def fiddle_fig(name, loc, s=1.0, kind="terracotta", plinth=False):
    """v10 (broken-looking plants stand out at once): a fiddle-leaf fig, big solid oval leaves on one trunk."""
    top = pot(name, loc, 0.22 * s, 0.4 * s, kind, plinth=plinth)
    rod(f"{name}_trunk", (loc[0], loc[1], top - 0.01), (loc[0] + 0.02, loc[1] - 0.01, top + 1.0 * s), 0.018 * s, mat("fig_trunk", "#7a6650", 0.7))
    for i in range(15):
        h = top + (0.32 + 0.68 * i / 14) * s
        yaw = i * 2.39996 + 0.4
        node = Vector((loc[0] + 0.02 * i / 14, loc[1] - 0.01 * i / 14, h))
        tip = node + Vector((math.cos(yaw) * 0.07 * s, math.sin(yaw) * 0.07 * s, 0.02 * s))
        rod(f"{name}_petiole{i}", tuple(node), tuple(tip), 0.006 * s, mat("stem", "#4f8a45", 0.6))
        size = (0.85 + 0.15 * math.sin(i * 1.7)) * (1.0 - 0.25 * i / 14)
        place(fig_leaf(f"{name}_leaf{i}", 0.34 * s * size, 0.24 * s * size), tuple(tip), yaw, math.radians(28 + 14 * (i % 3)))


def leafy_clump(name, loc, s=1.0, kind="terracotta", plinth=False):
    """v11: a peace-lily-like clump: 28 broad solid oval leaves on short arching stems from the pot rim, rounded silhouette."""
    top = pot(name, loc, 0.22 * s, 0.4 * s, kind, plinth=plinth, soil_up=0.05)
    # v13: no stem rods (their caps showed in the empty centre); every leaf grows from the soil. Elevations are from the
    # horizontal: inner crown 60-80 deg, main ring 50 -> 12 deg, outer leaves -15 deg hanging over the rim.
    leaves = [(i * 2.39996 + 0.5, 0.03, 60 + 20 * (i % 3) / 2, 0.8) for i in range(6)]
    leaves += [(i * 2.39996, 0.06 + 0.06 * ((i * 0.618) % 1.0), 50 - 38 * ((i * 0.618) % 1.0), 1.0) for i in range(28)]
    cam_yaw = math.radians(-45)  # the page camera looks from +x / -y
    outer = [i / 7 * math.tau + 0.3 for i in range(7)]
    outer = [y for y in outer if abs((y - cam_yaw + math.pi) % math.tau - math.pi) > math.radians(35)]  # none flat on the visible pot face
    leaves += [(y, (0.22 * s + 0.03) / s, -15, 0.85) for y in outer]  # bases on the rim, arching over it
    leaves += [(math.radians(135) + math.radians(-50 + 20 * i), 0.09, 40, 0.9) for i in range(6)]  # back crown hides the soil band
    for i, (yaw, rad, elev, size) in enumerate(leaves):
        base = Vector((loc[0] + math.cos(yaw) * rad * s, loc[1] + math.sin(yaw) * rad * s, top + 0.01 + 0.002 * (i % 7)))
        size *= 0.85 + 0.15 * math.sin(i * 1.3)
        place(fig_leaf(f"{name}_leaf{i}", 0.34 * s * size, 0.2 * s * size), tuple(base), yaw, math.radians(elev))


def monstera_leaf(name, length, width, seed, holes=True):
    """v9: a monstera leaf on a fine grid: 3-4 tapered wedge splits per side, random depth 25-55 % toward the midrib at
    irregular spacing, 1-2 small oval holes near the midrib, a lighter midrib strip, a slight cup and droop."""
    import random
    rnd = random.Random(seed)
    segs, rings = 36, 12
    wedges = []
    for side in (-1, 1):
        n = rnd.choice((3, 4))
        ts = sorted(0.22 + 0.62 * (k + rnd.uniform(0.15, 0.85)) / n for k in range(n))
        wedges += [(side, t, rnd.uniform(0.25, 0.55), rnd.uniform(0.05, 0.08)) for t in ts]
    hole_list = [(rnd.choice((-1, 1)), rnd.uniform(0.35, 0.7), rnd.uniform(0.18, 0.3)) for _ in range(rnd.choice((1, 2)))] if holes else []
    bm = bmesh.new()
    rows = []
    for i in range(segs + 1):
        t = i / segs
        half = math.sin(math.pi * t) ** 0.8 * width / 2
        rows.append([bm.verts.new((t * length, (j / rings * 2 - 1) * half, 0)) for j in range(rings + 1)])
    rib = []
    for i in range(segs):
        for j in range(rings):
            t, u = (i + 0.5) / segs, (j + 0.5) / rings * 2 - 1
            au, side = abs(u), (1 if u > 0 else -1)
            cut = any(sd == side and au > 1 - d and abs(t - tk) < a * (au - (1 - d)) / d for sd, tk, d, a in wedges)
            cut = cut or any(sd == side and ((t - th) / 0.035) ** 2 + ((au - uh) / 0.08) ** 2 < 1 for sd, th, uh in hole_list)
            if cut:
                continue
            f = bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
            if au < 0.1:
                rib.append(f)
    for f in rib:
        f.material_index = 1
    for v in bm.verts:
        x = v.co.x / length
        v.co.z = -0.22 * x * x * length + 0.06 * abs(v.co.y)  # droop along the length, cup across
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    active(o)
    mod = o.modifiers.new("s", "SOLIDIFY")
    mod.thickness = 0.005
    bpy.ops.object.modifier_apply(modifier="s")
    bpy.ops.object.shade_smooth()
    o.data.materials.append(mat("leaf_monstera", "#3a8048", 0.5))
    o.data.materials.append(mat("leaf_midrib", "#4f9a5c", 0.5))
    return o


def monstera(name, loc, s=1.0, kind="terracotta", plinth=False):
    top = pot(name, loc, 0.22 * s, 0.4 * s, kind, plinth=plinth)
    sm = mat("stem", "#4f8a45", 0.6)
    for i in range(8):
        stem = (0.42 + 0.12 * (i % 3)) * s * 0.8  # v9: stems 20 % shorter
        yaw = i / 8 * math.tau + 0.3 + 0.2 * math.sin(i * 2.3)
        pitch = math.radians(20 + (i % 3) * 12)
        tip = Vector((loc[0] + math.cos(yaw) * stem * 0.5, loc[1] + math.sin(yaw) * stem * 0.5, top + stem * 0.8))
        rod(f"{name}_stem{i}", (loc[0], loc[1], top - 0.01), tip, 0.009 * s, sm)  # a real stem up to each leaf
        place(monstera_leaf(f"{name}_leaf{i}", 0.44 * s, 0.4 * s, seed=f"{name}{i}"), tuple(tip), yaw, pitch)
    for i in range(4):  # v9: shorter leaves low around the pot rim, so the plant is full, not wiry
        yaw = i / 4 * math.tau + 0.7
        base = Vector((loc[0] + math.cos(yaw) * 0.12 * s, loc[1] + math.sin(yaw) * 0.12 * s, top + 0.04 * s))
        place(monstera_leaf(f"{name}_low{i}", 0.3 * s, 0.27 * s, seed=f"{name}low{i}", holes=False), tuple(base), yaw, math.radians(8))


def fern(name, loc, s=1.0, kind="terracotta", z0=0.0, plinth=False):
    top = pot(name, loc, 0.2 * s, 0.32 * s, kind, z0, plinth=plinth)
    lm = mat("leaf_fern", "#4c8a3e", 0.55)
    for i in range(16):
        yaw = i / 16 * math.tau
        leaf = leaf_mesh(f"{name}_frond{i}", (0.42 + 0.1 * (i % 3)) * s, 0.1 * s, lm, curl=0.55)
        place(leaf, (loc[0], loc[1], top + 0.02), yaw, math.radians(38 + (i % 4) * 9))  # arching up, the curl bends the tips


def snake_plant(name, loc, s=1.0, kind="terracotta", z0=0.0, plinth=False):
    top = pot(name, loc, 0.16 * s, 0.3 * s, kind, z0, plinth=plinth)
    lm = mat("leaf_snake", "#3d6b39", 0.45)
    for i in range(9):
        yaw = i / 9 * math.tau
        blade = leaf_mesh(f"{name}_blade{i}", (0.5 + 0.12 * (i % 3)) * s, 0.08 * s, lm, curl=-0.03)
        place(blade, (loc[0] + math.cos(yaw) * 0.05 * s, loc[1] + math.sin(yaw) * 0.05 * s, top), yaw, math.radians(80 - (i % 3) * 5))  # upright


def succulent(name, loc, z0, kind="sage"):
    """A small desk or sill plant that reads from the iso camera: a sage or charcoal pot with an upright rosette."""
    top = pot(name, loc, 0.06, 0.08, kind, z0)
    lm = mat("leaf_succulent", "#5f9a5a", 0.5)
    for i in range(6):
        yaw = i / 6 * math.tau
        place(leaf_mesh(f"{name}_l{i}", 0.11, 0.045, lm, curl=-0.1), (loc[0], loc[1], top), yaw, math.radians(55))


def corridor_band(m):
    """v8: a soft terracotta inlay along the courier corridor (blender y 3.6..5.4, on the tile grid lines, x from 1.2), so the
    route reads without a walker. It tints the tiles (grout stays), baked."""
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    src = b.inputs["Base Color"].links[0].from_socket
    geo, sep = nt.nodes.new("ShaderNodeNewGeometry"), nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    f = None
    for axis, op, v in (("Y", "GREATER_THAN", 3.6), ("Y", "LESS_THAN", 5.4), ("X", "GREATER_THAN", 1.2)):
        c = nt.nodes.new("ShaderNodeMath")
        c.operation = op
        c.inputs[1].default_value = v
        nt.links.new(sep.outputs[axis], c.inputs[0])
        if f is None:
            f = c
        else:
            mul = nt.nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            nt.links.new(f.outputs[0], mul.inputs[0])
            nt.links.new(c.outputs[0], mul.inputs[1])
            f = mul
    tint = nt.nodes.new("ShaderNodeMix")
    tint.data_type, tint.blend_type = "RGBA", "MULTIPLY"
    tint.inputs[7].default_value = (1.0, 0.76, 0.62, 1.0)  # a soft terracotta tint (v8 first try was too strong)
    nt.links.new(f.outputs[0], tint.inputs["Factor"])
    nt.links.new(src, tint.inputs[6])
    nt.links.new(tint.outputs[2], b.inputs["Base Color"])


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    white = texture(mat("plaster", "#f2f0ec", 0.85), "plaster", scale=2.0, amount=0.05)
    oak = texture(mat("oak", "#cba67e", 0.5), "grain", scale=5.0, amount=0.08, stretch=(1, 10, 1))  # ~4 % value grain, scale 30
    # v5 (audit 23/10: "tout est marron et blanc"): sage-stone floor tiles so the oak desks stand out, warm limewash on the
    # window wall, a dark ink media wall at the back (the screens no longer read as black holes).
    floor = texture(mat("tile_floor", "#fff3e0", 0.45), "tiles", scale=1.0, amount=0.04, color2="#f7e9d5", mortar="#dccdb7")  # v15: brighter cream  # v14: lighter cream  # v13: light cream  # v12: warmer, ~4 % per tile  # v8: warm porcelain
    # v6: wall caps, wall ends and the slab's outer faces keep one constant light tone day and night (no charcoal edges).
    cap = mat("cap_light", "#ecebe8", 0.6, emit="#ecebe8", day=3.6, night=3.6)  # bakes to >= 235 (v7: 1.6 gave 197)
    limewash = texture(mat("limewash", "#f2ece3", 0.85), "plaster", scale=2.0, amount=0.06)
    ink = texture(mat("ink_wall", "#232c52", 0.8), "plaster", scale=1.5, amount=0.08)  # deep navy, not black (v9: was #353a5c, read mauve)
    screen_off = mat("screen_live", "#0e0916", 0.25)
    bezel = mat("bezel", "#16131c", 0.35)
    dev = mat("device_graphite", "#3a3a42", 0.4)
    keys = mat("keyboard", "#d9d9de", 0.45)
    steel = mat("steel_black", "#3a3a42", 0.4)
    box("slab", (W + 0.4, D + 0.4, 0.55), (W / 2 - 0.2, D / 2 + 0.2, -0.275), mat("slab", "#fbfaf8", 0.55), bevel=0.0)  # v10: no bevel hairline
    box("floor", (W, D, 0.02), (W / 2, D / 2, -0.009), floor, bevel=0.0)  # top 1 mm above the slab: no dark joint
    # Thick walls with a clean white cut edge on top (his reference), on the white slab.
    left = box("wall_left", (0.35, D + 0.35, H), (-0.175, D / 2 + 0.175, H / 2), limewash, bevel=0.012)
    box("wall_back", (W, 0.35, H), (W / 2, D + 0.175, H / 2), white, bevel=0.012)
    # The media wall: a 1 cm ink panel on the inner face of the back wall, leaving the top 4 cm and the cut edge white.
    box("ink_panel", (W - 0.01, 0.01, H - 0.04), (W / 2 + 0.005, D - 0.005, (H - 0.04) / 2), ink, bevel=0.0)
    box("skirting_back", (W - 0.01, 0.02, 0.08), (W / 2 + 0.005, D - 0.02, 0.04), ink, bevel=0.003)
    # Sky outside the windows (emissive, casts no shadow so the sun comes in), below the wall top, hidden from the camera.
    sky = mat("sky", "#000000", 1.0, emit="#d6e8fb", day=1.25, night=0.7)  # v9: emission only (the room fill greyed its diffuse)
    snt = sky.node_tree
    geo, sep, mrange, ramp = (snt.nodes.new(t) for t in ("ShaderNodeNewGeometry", "ShaderNodeSeparateXYZ", "ShaderNodeMapRange", "ShaderNodeValToRGB"))
    # v7: distant soft greenery blended into the horizon, then a saturated sky (no hard band, no buildings, no mullions).
    ramp.color_ramp.elements[0].color = hexrgb("#e9d6b6")  # warm horizon, bottom ~15 % of the pane only
    ramp.color_ramp.elements[1].position = 0.8
    ramp.color_ramp.elements[1].color = hexrgb("#4a92e0")  # top
    for pos, col in ((0.12, "#f8dcb8"), (0.24, "#b4d6f4"), (0.45, "#74b3ee")):
        ramp.color_ramp.elements.new(pos).color = hexrgb(col)
    mrange.name = "sky_map"
    mrange.inputs["From Min"].default_value, mrange.inputs["From Max"].default_value = 0.0, 1.6  # set per mood (set_mood)
    snt.links.new(geo.outputs["Position"], sep.inputs[0])
    snt.links.new(sep.outputs["Z"], mrange.inputs["Value"])
    snt.links.new(mrange.outputs["Result"], ramp.inputs["Fac"])
    # v10: 2-3 very soft cloud blobs in the upper middle of each pane (day only: the "cloud_amt" factor is 0 at night).
    cn = snt.nodes.new("ShaderNodeTexNoise")
    cn.inputs["Scale"].default_value, cn.inputs["Detail"].default_value, cn.inputs["Roughness"].default_value = 0.9, 1.0, 0.3
    cmap = snt.nodes.new("ShaderNodeMapping")
    cmap.inputs["Scale"].default_value = (1.0, 0.5, 1.0)  # v12: blobs twice as wide as tall (pane 2 was a vertical smear)
    snt.links.new(geo.outputs["Position"], cmap.inputs["Vector"])
    snt.links.new(cmap.outputs["Vector"], cn.inputs["Vector"])
    blob = snt.nodes.new("ShaderNodeMapRange")
    blob.inputs["From Min"].default_value, blob.inputs["From Max"].default_value = 0.50, 0.70
    snt.links.new(cn.outputs["Fac"], blob.inputs["Value"])
    lo_m, hi_m = snt.nodes.new("ShaderNodeMapRange"), snt.nodes.new("ShaderNodeMapRange")
    lo_m.inputs["From Min"].default_value, lo_m.inputs["From Max"].default_value = 1.4, 1.9
    hi_m.inputs["From Min"].default_value, hi_m.inputs["From Max"].default_value = 2.5, 2.15
    snt.links.new(sep.outputs["Z"], lo_m.inputs["Value"])
    snt.links.new(sep.outputs["Z"], hi_m.inputs["Value"])
    m1, m2, amt = (snt.nodes.new("ShaderNodeMath") for _ in range(3))
    for m in (m1, m2, amt):
        m.operation = "MULTIPLY"
    amt.name = "cloud_amt"
    amt.inputs[1].default_value = 0.25
    snt.links.new(blob.outputs["Result"], m1.inputs[0])
    snt.links.new(lo_m.outputs["Result"], m1.inputs[1])
    snt.links.new(m1.outputs[0], m2.inputs[0])
    snt.links.new(hi_m.outputs["Result"], m2.inputs[1])
    snt.links.new(m2.outputs[0], amt.inputs[0])
    cmix = snt.nodes.new("ShaderNodeMix")
    cmix.data_type = "RGBA"
    cmix.inputs[7].default_value = (1.0, 1.0, 1.0, 1.0)
    snt.links.new(amt.outputs[0], cmix.inputs["Factor"])
    snt.links.new(ramp.outputs["Color"], cmix.inputs[6])
    snt.links.new(cmix.outputs[2], snt.nodes["Principled BSDF"].inputs["Emission Color"])
    sky_o = box("sky", (0.02, 9.8, 2.7), (-0.38, 5.6, 1.45), sky, bevel=0.0)  # v9: closer (was x -0.6)  # y 0.7..10.5, z 0.1..2.8
    sky_o.visible_shadow = False
    sky_o.visible_diffuse = False  # v12: its blue light on the floor washed the sun patches out
    sky_o.visible_glossy = False  # v13: sill moire
    # A soft low band of distant sage greenery at the bottom of the view (no buildings, no mullions).

    # The window showed tiles: no city boxes and no mullion; a soft sky only,
    # thick solid oak frames and deep sills, like the solid, touchable objects of the reference.
    for i, yc in enumerate((2.0, 5.2, 8.4)):
        cut = box(f"cut{i}", (1.0, 2.2, 2.0), (-0.125, yc, 1.75), white, bevel=0.0)
        mod = left.modifiers.new(f"win{i}", "BOOLEAN")
        mod.object, mod.operation = cut, "DIFFERENCE"
        active(left)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cut)
        for nm, size, loc in (("top", (0.32, 2.4, 0.14), (-0.125, yc, 2.8)), ("bottom", (0.5, 2.5, 0.1), (0.04, yc, 0.7)),
                              ("l", (0.32, 0.14, 2.1), (-0.125, yc - 1.15, 1.75)), ("r", (0.32, 0.14, 2.1), (-0.125, yc + 1.15, 1.75))):
            box(f"frame{i}_{nm}", size, loc, mat("oak_plain", "#cba67e", 0.88) if nm == "bottom" else oak, bevel=0.025)  # v12: sill without grain (moire)
        succulent(f"sill{i}", (0.1, yc + 0.7), 0.75, "sage" if i % 2 == 0 else "charcoal")
    # Warm LED cove along both wall tops, no stub at the left wall end and no overlap in the corner.
    led = mat("led", "#ffd9ad", 0.4, emit="#ffc78a", day=5.0, night=12.0)
    box("cove_left", (0.12, D - 0.12, 0.145), (0.06, (D - 0.12) / 2, H - 0.0725), cap, bevel=0.0)  # v9: up to the wall top, no crease
    box("led_left", (0.04, D - 0.25, 0.04), (0.15, (D - 0.25) / 2 + 0.05, H - 0.17), led, bevel=0.0)  # visible from the camera
    # Constant light caps on the wall tops, the wall ends and the slab edge (v6).
    box("cap_left", (0.36, D + 0.36, 0.006), (-0.175, D / 2 + 0.175, H + 0.003), cap, bevel=0.0)
    box("cap_back", (W + 0.01, 0.36, 0.006), (W / 2, D + 0.175, H + 0.003), cap, bevel=0.0)
    box("end_left", (0.36, 0.006, H), (-0.175, -0.003, H / 2), cap, bevel=0.0)
    box("end_back", (0.006, 0.36, H), (W + 0.003, D + 0.175, H / 2), cap, bevel=0.0)
    box("slab_edge_front", (W + 0.428, 0.006, 0.55), ((W + 0.018 - 0.41) / 2, -0.053, -0.275), mat("cap_front", "#ecebe8", 0.6, emit="#ecebe8", day=5.4, night=5.4), bevel=0.0)  # v11: ~240, flush
    box("slab_edge_right", (0.006, D + 0.478, 0.55), (W + 0.003, (D + 0.342) / 2, -0.275), mat("cap_side", "#ecebe8", 0.6, emit="#ecebe8", day=3.0, night=3.0), bevel=0.0)  # v11: ~224, flush at the corner
    box("cove_back", (W, 0.12, 0.05), (W / 2, D - 0.07, H - 0.12), ink, bevel=0.0)
    box("led_back", (W - 0.25, 0.03, 0.025), (W / 2 + 0.125, D - 0.14, H - 0.15), mat("led_cool", "#e6e8ff", 0.4, emit="#d8dcff", day=5.0, night=16.0), bevel=0.0)  # v8: cool, the ink wall reads navy
    # A real clock on the media wall (light face, dark rim, two hands).
    cx0, cz0 = 0.6, 2.75
    cyl("clock_face", 0.2, 0.03, (cx0, D - 0.03, cz0), mat("clock_face", "#f4f0ea", 0.4), verts=48, rot=(math.radians(90), 0, 0), bevel=0.006)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.2, minor_radius=0.018, location=(cx0, D - 0.04, cz0), rotation=(math.radians(90), 0, 0), major_segments=48, minor_segments=8)
    finish(bpy.context.object, "clock_rim", mat("clock_rim", "#1e1d22", 0.35), smooth=True)
    for i, (l, a) in enumerate(((0.14, 60), (0.1, 300))):
        box(f"clock_hand{i}", (0.012, 0.006, l), (cx0 + math.sin(math.radians(a)) * l / 2, D - 0.05, cz0 + math.cos(math.radians(a)) * l / 2),
            mat("clock_rim", "#1e1d22", 0.35), bevel=0.0, rot=(0, math.radians(a), 0))
    # Floating oak shelves on the window-wall piers (books, a plant, a vase), framed posters above them: the owner's own covers (cover-ours-*.jpg in STUDIO_ROOM_COVERS), blank when absent; none is shipped.
    book_cols = ["#2f4a6d", "#c8a24a", "#9b3b34", "#e9e3d8", "#4f6b4a", "#d07a52"]
    for pi, (py, cover) in enumerate(((3.62, "cover-ours-1.jpg"), (6.82, "cover-ours-2.jpg"))):
        box(f"poster_frame_{pi + 1}", (0.04, 0.5, 0.82), (0.02, py, 2.32), oak, bevel=0.008)
        art = bpy.data.materials.new(f"poster_{pi}")
        art.use_nodes = True
        tex = art.node_tree.nodes.new("ShaderNodeTexImage")
        path = os.path.join(COVERS, cover)
        if os.path.exists(path):
            tex.image = bpy.data.images.load(path)
            art.node_tree.links.new(tex.outputs["Color"], art.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
        art.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.6
        quad(f"poster_{pi + 1}", (0.42, 0.74), (0.045, py, 2.32), (math.radians(90), 0, math.radians(90)), art)
    for si, sy in enumerate((3.62, 6.82)):
        for zi, sz in enumerate((1.05, 1.55)):
            box(f"shelf_{si}_{zi}", (0.24, 0.66, 0.035), (0.12, sy, sz), oak, bevel=0.008)
            y = sy - 0.27
            for b in range(5 if zi == 0 else 3):
                h = 0.17 + 0.04 * ((b + si) % 3)
                box(f"book_{si}_{zi}_{b}", (0.16, 0.04, h), (0.12, y, sz + 0.0175 + h / 2), mat(f"book_{(b + si + zi) % 6}", book_cols[(b + si + zi) % 6], 0.7), bevel=0.004)
                y += 0.05
            if zi == 1:
                succulent(f"shelf_plant_{si}", (0.12, sy + 0.18), sz + 0.018, "charcoal")
            else:
                cyl(f"vase_{si}", 0.05, 0.16, (0.12, sy + 0.2, sz + 0.098), mat("vase_blue", "#5b7fa6", 0.3), verts=20)
    # SCREEN WALL: main screen in the middle, 4 phone screens of our videos on its left, 4 trend screens on its right.
    layout = {"units": "metres; three.js coordinates (y up): x, y, z = blender x, z, -y", "teams": [], "aisle": [],
              "screens": {"main": "screen_main", "wall_ours": [], "wall_trends": [], "monitors": {}},
              "robot_model_note": "robot.gltf / lester.gltf face +Z in three.js at yaw 0; facing_yaw is the rotation around Y to apply (radians)."}
    wy = D - 0.02
    box("screen_frame", (4.9, 0.08, 2.55), (W / 2, wy - 0.04, 1.85), bezel, bevel=0.02)
    quad("screen_main", (4.7, 2.35), (W / 2, wy - 0.085, 1.85), (math.radians(90), 0, 0), screen_off)
    pw, ph, gap = 0.74, 1.32, 0.86
    for group, xs in (("wall_ours", [1.4 + i * gap for i in range(4)]), ("wall_trends", [W - 1.4 - (3 - i) * gap for i in range(4)])):
        for i, x in enumerate(xs):
            name = f"{'wall_ours' if group == 'wall_ours' else 'wall_trend'}_{i + 1}"
            box(f"{name}_bezel", (pw + 0.06, 0.06, ph + 0.06), (x, wy - 0.03, 1.85), bezel, bevel=0.03)
            quad(name, (pw, ph), (x, wy - 0.065, 1.85), (math.radians(90), 0, 0), screen_off)
            layout["screens"][group].append(name)
    mug_colors = ["mug_red", "mug_white", "mug_sage"]
    mat("mug_red", "#c8323a", 0.4), mat("mug_white", "#f3f1ee", 0.35), mat("mug_sage", "#9bb39a", 0.45)
    lamp_m = mat("lamp_bulb", "#fff5df", 0.3, emit="#ffd9a8", day=0.0, night=80.0)  # v12: near-neutral  # v10: less amber
    for t_i, (tid, label, (cx, cy), row) in enumerate(TEAMS):
        spots = []
        # v6: a stronger pastel body with a 6 cm border in the full team colour, so the 7 pods are told apart at a glance.
        rug_col = pastel(RUG_BASE.get(tid, TEAM_COLORS[tid]), 0.0)  # v9: one formula for all seven (red based on #e8453c: red, not salmon)
        rug = texture(mat(f"rug_{tid}", rug_col, 1.0), "plaster", scale=8.0, amount=0.06, bump=0.05)
        rug.node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.0  # v16: matte rugs
        box(f"rugborder_{tid}", (2.12, 3.22, 0.02), (cx + 0.05, cy, 0.01), mat(f"rugedge_{tid}", pastel(RUG_BASE.get(tid, TEAM_COLORS[tid]), 0.35), 0.9), bevel=0.0)  # v13: lighter tint, flush
        box(f"rug_{tid}", (2.0, 3.1, 0.0205), (cx + 0.05, cy, 0.01025), rug, bevel=0.0)
        # Solid oak pod: one thick top per desk and wide panel legs at the pod ends and the joints (thin legs looked
        # fragile: the reference feels like an object you can touch).
        for j in range(4):
            box(f"panel_{tid}_{j}", (0.66, 0.06, 0.69), (cx + 0.3, cy + (j - 1.5) * 0.88, 0.345), oak, bevel=0.02)
        for k in range(3):
            y = cy + (k - 1) * 0.88  # 3 desks joined: one tidy pod
            # A normal, readable workstation. The robot
            # sits at the west side of its desk facing east, the monitor stands at the far (east) edge facing it, the keyboard
            # in front of it. The iso camera (south-east) sees the robots' faces at 3/4; the content is on the screen wall.
            dx, dy = cx + 0.3, y
            box(f"desk_{tid}_{k + 1}", (0.74, 0.88, 0.065), (dx, dy, 0.72), oak, bevel=0.025)
            mx, my = dx + 0.24, dy
            r = math.radians(-90)  # a plane rotated (90, 0, r) has normal (sin r, -cos r) = (-1, 0): it faces the robot
            n = Vector((math.sin(r), -math.cos(r), 0))
            box(f"monitor_body_{tid}_{k + 1}", (0.62, 0.06, 0.4), (mx, my, 1.08), dev, bevel=0.022, rot=(0, 0, r))
            box(f"monitor_stand_{tid}_{k + 1}", (0.08, 0.06, 0.26), (mx + 0.04, my, 0.88), dev, bevel=0.015)
            box(f"monitor_foot_{tid}_{k + 1}", (0.2, 0.24, 0.025), (mx + 0.02, my, DESK_TOP + 0.0125), dev, bevel=0.01)  # on the top, no overhang
            name = f"monitor_{tid}_{k + 1}"
            quad(name, (0.55, 0.33), (mx + n.x * 0.032, my + n.y * 0.032, 1.08), (math.radians(90), 0, r), screen_off)
            layout["screens"]["monitors"].setdefault(tid, []).append(name)
            box(f"keyboard_{tid}_{k + 1}", (0.14, 0.4, 0.014), (dx - 0.18, dy, DESK_TOP + 0.007), keys, bevel=0.004)
            cyl(f"mug_{tid}_{k}", 0.04, 0.09, (dx - 0.12, dy + 0.33, DESK_TOP + 0.045), MATS[mug_colors[(t_i + k) % 3]], verts=18)
            box(f"notebook_{tid}_{k}", (0.15, 0.2, 0.018), (dx - 0.1, dy - 0.3, DESK_TOP + 0.009), mat("notebook", "#2f4a6d", 0.7), bevel=0.003, rot=(0, 0, 0.25))
            if k == 1:
                # A solid mushroom lamp in the team colour, glowing underneath at night.
                lam = mat(f"lamp_{tid}", TEAM_COLORS[tid], 0.45)
                cyl(f"lampstem_{tid}", 0.02, 0.24, (dx + 0.2, dy - 0.32, DESK_TOP + 0.12), lam, verts=16)
                cyl(f"lampfoot_{tid}", 0.055, 0.015, (dx + 0.2, dy - 0.32, DESK_TOP + 0.0075), lam, verts=24, bevel=0.004)
                bpy.ops.mesh.primitive_uv_sphere_add(radius=0.085, location=(dx + 0.2, dy - 0.32, DESK_TOP + 0.24), segments=24, ring_count=12)
                dome = bpy.context.object
                bm = bmesh.new()
                bm.from_mesh(dome.data)
                bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context="VERTS")
                bm.to_mesh(dome.data)
                bm.free()
                finish(dome, f"lampdome_{tid}", lam, smooth=True)
                cyl(f"lampbulb_{tid}", 0.075, 0.006, (dx + 0.2, dy - 0.32, DESK_TOP + 0.237), lamp_m, verts=24)
                # Night: a warm spot under the lamp, so each pod sits in its own pool of light.
                sp = bpy.data.lights.new(f"lampspot_{tid}", "SPOT")
                sp.energy, sp.color, sp.spot_size, sp.spot_blend, sp.shadow_soft_size = 0.0, hexrgb("#ffc58a")[:3], math.radians(140), 0.9, 0.15
                so_ = bpy.data.objects.new(f"lampspot_{tid}", sp)
                so_.location = (dx + 0.2, dy - 0.32, DESK_TOP + 0.22)
                bpy.context.scene.collection.objects.link(so_)
                LAMP_SPOTS.append(so_)
            if k == 2:
                succulent(f"desk_plant_{tid}", (dx + 0.22, dy + 0.3), DESK_TOP, "sage")
            # A stool for the robot (no legs: its hover base rests on the seat) and a "stand" point on the open west side,
            # on the same x as the aisle waypoint of this pod, so the walk to the aisle crosses no desk.
            spot = (dx - 0.62, dy)
            cyl(f"stool_{tid}_{k}", 0.14, 0.07, (spot[0], spot[1], SEAT - 0.035), mat(f"seat_{tid}", rug_col, 0.6), verts=36, bevel=0.03)  # v9: smaller, in the rug tone
            bpy.ops.mesh.primitive_torus_add(major_radius=0.137, minor_radius=0.006, location=(spot[0], spot[1], SEAT - 0.012), major_segments=36, minor_segments=6)
            finish(bpy.context.object, f"stoolrim_{tid}_{k}", mat(f"seatrim_{tid}", darker(rug_col, 0.85), 0.6), smooth=True)
            cyl(f"stoolleg_{tid}_{k}", 0.06, SEAT - 0.09, (spot[0], spot[1], (SEAT - 0.07) / 2 + 0.02), dev, verts=28, bevel=0.01)
            cyl(f"stoolfoot_{tid}_{k}", 0.12, 0.04, (spot[0], spot[1], 0.02), oak, verts=36, bevel=0.015)
            stand = (cx - 0.77, dy)
            spots.append({"x": round(spot[0], 3), "y": SEAT, "z": round(-spot[1], 3), "facing_yaw": round(math.pi / 2, 4),
                          "stand": {"x": round(stand[0], 3), "y": 0.0, "z": round(-stand[1], 3)}})
            SPOTS.append((spot, tid))
        layout["teams"].append({"id": tid, "label": label, "row": row, "color": TEAM_COLORS[tid], "center": {"x": cx, "y": 0.0, "z": -cy}, "spots": spots})
    # Lester's round platform, central, in front of the screen wall, facing the room.
    # Violet base, light top (still at 0.12), a gold ring on the edge and a violet LED band (v5: the old emissive lid baked flat).
    cyl("lester_base", 0.68, 0.06, (LESTER[0], LESTER[1], 0.03), mat("podium_violet", "#3b2d6e", 0.5), verts=64, bevel=0.012)
    cyl("lester_top", 0.61, 0.06, (LESTER[0], LESTER[1], 0.09), mat("podium_top", "#f4f0ea", 0.4), verts=64, bevel=0.01)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.615, minor_radius=0.014, location=(LESTER[0], LESTER[1], 0.12), major_segments=64, minor_segments=8)
    finish(bpy.context.object, "lester_gold", mat("podium_gold", "#d4a843", 0.3), smooth=True)
    cyl("lester_led", 0.685, 0.012, (LESTER[0], LESTER[1], 0.035), mat("podium_led", "#8b5cf6", 0.4, emit="#8b5cf6", day=1.2, night=4.0), verts=64)
    layout["lester"] = {"x": LESTER[0], "y": 0.12, "z": -LESTER[1], "facing_yaw": 0.0}
    # The U aisle (clear floor): from Lester down to the back row, along it, across the right end, back along the front row.
    aisle_y = (BACK_Y + FRONT_Y) / 2
    pts = [(LESTER[0], LESTER[1] - 1.0), (LESTER[0], aisle_y + 0.5)]
    pts += [(cx - 0.77, aisle_y + 0.5) for _, _, (cx, _), row in TEAMS if row == "back"]
    pts += [(W - 0.9, aisle_y)]
    pts += [(cx - 0.77, aisle_y - 0.5) for _, _, (cx, _), row in TEAMS if row == "front"]
    layout["aisle"] = [{"x": round(x, 3), "y": 0.0, "z": round(-y, 3)} for x, y in pts]
    # Lounge and coffee corner, front left (by the windows), on its own rug, away from the aisle and the pods.
    # Lounge: ink velvet sofa, mustard and cream cushions, a round jute rug; coffee counter with a graphite machine.
    cyl("rugborder_lounge", 1.25, 0.012, (1.85, 1.95, 0.006), mat("rug_gold_edge", "#d9b45a", 0.95), verts=64, bevel=0.004)
    terra = texture(mat("rug_lavender", "#9470d8", 0.95), "plaster", scale=10.0, amount=0.06, bump=0.05)  # v11: Lester lavender (read as an extra orange zone)
    cyl("rug_lounge", 1.12, 0.014, (1.85, 1.95, 0.009), terra, verts=64, bevel=0.004)  # v8: terracotta, lighter ring
    velvet = mat("velvet_ink", "#3b4a86", 0.85)
    box("sofa_base", (0.85, 1.9, 0.42), (0.81, 1.85, 0.21), velvet, bevel=0.08)
    box("sofa_back", (0.22, 1.9, 0.45), (0.44, 1.85, 0.62), velvet, bevel=0.08)
    box("cushion_a", (0.6, 0.8, 0.12), (0.86, 1.4, 0.48), mat("fabric_mustard", "#d9a441", 0.95), bevel=0.05)
    box("cushion_b", (0.6, 0.8, 0.12), (0.86, 2.3, 0.48), mat("fabric_mustard", "#d9a441", 0.95), bevel=0.05)  # v11: both seats mustard
    # Two back cushions leaning on the backrest and a small violet throw pillow.
    for i, y in enumerate((1.4, 2.3)):
        box(f"backcushion_{i}", (0.14, 0.72, 0.4), (0.62, y, 0.72), mat("boucle", "#efe8dc", 0.98), bevel=0.06, rot=(0, math.radians(-14), 0))
    box("throw_pillow", (0.12, 0.34, 0.3), (0.74, 1.85, 0.66), mat("pillow_violet", "#8b5cf6", 0.9), bevel=0.06, rot=(0, math.radians(-16), 0.2))
    cyl("coffee_table", 0.32, 0.36, (1.85, 1.95, 0.18), oak, verts=64, bevel=0.012)
    cyl("coffee_table_top", 0.34, 0.025, (1.85, 1.95, 0.3725), mat("table_white", "#f4f2ee", 0.35), verts=64, bevel=0.008)  # v8: white top
    cyl("table_mug", 0.04, 0.09, (1.8, 2.0, 0.425), MATS["mug_red"], verts=16)
    # The coffee counter stands at the lounge's east side, along y (it no longer blocks the sofa from the camera).
    box("counter", (0.6, 1.6, 0.92), (3.8, 1.6, 0.46), mat("counter_white", "#f4f3f0", 0.4), bevel=0.015)
    box("counter_top", (0.64, 1.64, 0.04), (3.8, 1.6, 0.94), oak, bevel=0.006)
    box("counter_front", (0.012, 1.6, 0.86), (4.106, 1.6, 0.46), mat("counter_sage", "#8fb39a", 0.55), bevel=0.004)  # v8: sage panel
    # The machine faces the camera (east): lighter body, light panel, spout, drip tray and a white cup on the visible faces.
    box("counter_end", (0.6, 0.012, 0.86), (3.8, 0.794, 0.46), MATS["counter_sage"], bevel=0.003)  # the end facing the camera
    # v9: a clear espresso silhouette: terracotta body (front face x 3.89), chrome top, small display, dark recessed alcove,
    # protruding chrome group head with a black portafilter handle toward the camera, a chrome drip plate 4 cm out and a
    # white cup fully outside under the spout, a small dark bean hopper on top.
    chrome = mat("chrome_light", "#d8dadf", 0.25)
    black = mat("spout_dark", "#1e1e22", 0.4)
    box("coffee_machine", (0.3, 0.32, 0.38), (3.74, 1.05, 1.15), mat("machine_terracotta", "#d0643c", 0.45), bevel=0.04)
    box("machine_top", (0.28, 0.3, 0.02), (3.74, 1.05, 1.35), chrome, bevel=0.006)
    box("coffee_display", (0.006, 0.09, 0.045), (3.892, 1.05, 1.27), mat("display_dark", "#22303a", 0.3, emit="#7fd1ff", day=0.4, night=1.2), bevel=0.0)
    box("coffee_alcove", (0.01, 0.2, 0.17), (3.888, 1.05, 1.06), mat("alcove_dark", "#2a2a30", 0.6), bevel=0.0)
    cyl("coffee_group", 0.036, 0.035, (3.935, 1.05, 1.115), chrome, verts=24)
    cyl("coffee_basket", 0.034, 0.022, (3.935, 1.05, 1.088), black, verts=24)
    box("coffee_handle", (0.12, 0.022, 0.022), (4.03, 1.02, 1.088), black, bevel=0.006, rot=(0, 0, math.radians(-15)))
    box("drip_tray", (0.13, 0.18, 0.012), (3.865, 1.05, 0.966), chrome, bevel=0.003)  # front edge at x 3.93: 4 cm out
    cyl("machine_cup", 0.028, 0.055, (3.935, 1.05, 1.0), MATS["mug_white"], verts=20)  # x 3.907..3.963: outside the body
    cyl("coffee_hopper", 0.03, 0.09, (3.7, 1.05, 1.405), black, r2=0.055, verts=24)
    for i, y in enumerate((1.55, 1.75)):
        cyl(f"cup{i}", 0.04, 0.08, (3.8, y, 1.0), MATS["mug_white"], verts=16)
    fern("counter_fern", (3.8, 2.2), 0.5, "sage", z0=0.96)
    mustard = mat("stool_mustard", "#d9a441", 0.5)
    for i, y in enumerate((1.3, 1.95)):
        x = 4.45  # on the counter's east side, where the camera sees them
        cyl(f"stool_seat{i}", 0.17, 0.05, (x, y, 0.72), mustard, verts=28, bevel=0.012)
        cyl(f"stool_leg{i}", 0.06, 0.7, (x, y, 0.35), dev, verts=16)
        cyl(f"stool_foot{i}", 0.17, 0.02, (x, y, 0.01), dev, verts=28, bevel=0.006)
        bpy.ops.mesh.primitive_torus_add(major_radius=0.12, minor_radius=0.01, location=(x, y, 0.3), major_segments=32, minor_segments=6)
        finish(bpy.context.object, f"stool_ring{i}", dev, smooth=True)
    # An oak window bench under window 3 with cushions.
    box("window_bench", (0.5, 2.0, 0.42), (0.27, 8.4, 0.21), oak, bevel=0.025)
    box("bench_cushion", (0.44, 1.9, 0.08), (0.27, 8.4, 0.48), mat("bench_mustard", "#7e6400", 1.0), bevel=0.015)  # v13: raised 2 cm, deeper mustard
    # Plants: tall ones along the media wall (y > 9.4) and the window wall (x < 1.2); low ones (< 0.8 m) near the camera edges;
    # the corridor (y 3.7..5.3), the lane x 7.5 and the stand lines x = cx - 0.77 stay free.
    leafy_clump("plant_a", (1.0, 9.55), 1.15, "terracotta", plinth=True)  # v11: a full clump from the pot rim, no trunk (no "tree in a pot")
    fern("plant_c", (W - 0.6, 9.75), 1.0, "terracotta", plinth=True)
    # No pot touches the floor: oak stands or plinths; no plant in the open foreground.
    snake_plant("plant_d", (W / 2 - 2.9, 9.95), 1.0, "terracotta", z0=plant_stand("stand_d", (W / 2 - 2.9, 9.95), 0.2))
    snake_plant("plant_e", (W / 2 + 2.9, 9.95), 1.0, "terracotta", z0=plant_stand("stand_e", (W / 2 + 2.9, 9.95), 0.2))
    fern("plant_f", (0.55, 6.27), 0.8, "sage", z0=plant_stand("stand_f", (0.55, 6.27), 0.22))
    return layout


def lights_camera():
    scene = bpy.context.scene
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    bg.inputs[0].default_value = hexrgb("#f6efe4")  # v12: warm world light (the bluish one made the floor read cool grey)
    bg.inputs[1].default_value = 0.75
    seen = nt.nodes.new("ShaderNodeBackground")
    seen.inputs[0].default_value = hexrgb("#f2f1ee")
    seen.inputs[1].default_value = 2.6
    path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(path.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(bg.outputs[0], mix.inputs[1])
    nt.links.new(seen.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], nt.nodes["World Output"].inputs["Surface"])
    scene.world = world
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy, sun.angle = 16.0, math.radians(3)
    sun.color = (1.0, 0.45, 0.18)  # v12: golden patches below the clip (20 went white)  # v11: warm patches that do not clip
    # v6: a ceiling that only catches shadow (not seen by the camera, not baked, not exported): the sun enters through the
    # windows only, so the open floor is no longer smeared by blobby desk shadows.
    bpy.ops.mesh.primitive_plane_add(size=1, location=(W / 2, D / 2, H + 0.01))
    ceil = bpy.context.object
    ceil.name = "shadow_ceiling"
    ceil.scale = (W + 0.4, D + 0.4, 1)
    ceil.visible_camera = False
    ceil.visible_diffuse = False
    ceil.visible_glossy = False
    for i in range(6):  # warm night lights over the pod rows (off by day)
        nl = bpy.data.lights.new(f"night_{i}", "AREA")
        nl.size, nl.energy, nl.color = 1.2, 0.0, hexrgb("#fff6ee")[:3]  # v12: neutral (they saturated the rugs)
        no = bpy.data.objects.new(f"night_{i}", nl)
        no.location = (2.9 + (i % 3) * 4.0 + (1.6 if i % 3 == 2 else 0), BACK_Y if i < 3 else FRONT_Y, H - 0.25)
        scene.collection.objects.link(no)
        NIGHT_LIGHTS.append(no)
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = Vector((0.55, -0.25, -0.8)).to_track_quat("-Z", "Y").to_euler()  # v8: patches land x 0.5..1.9, west of the teal pod  # ~30 deg elevation, through the 3 windows toward the teal and green pods
    scene.collection.objects.link(so)
    # The LED cove's warm wash on both walls: two long thin area lights just under the cove, pointing down at the wall.
    for name, loc, size, rot in (("wash_left", (0.25, (D - 0.25) / 2, H - 0.2), (0.12, D - 0.4), (0, 0, 0)),
                                 ("wash_back", (W / 2, D - 0.25, H - 0.2), (W - 0.4, 0.12), (0, 0, 0))):
        lw = bpy.data.lights.new(name, "AREA")
        lw.shape = "RECTANGLE"
        lw.size, lw.size_y = size
        lw.energy, lw.color = 120, hexrgb("#ffc78a")[:3]
        lo = bpy.data.objects.new(name, lw)
        lo.location = loc
        lo.rotation_euler = rot
        scene.collection.objects.link(lo)
        WASH.append(lo)
    ff = bpy.data.lights.new("fill_front", "AREA")
    ff.shape, ff.size, ff.size_y, ff.color, ff.energy = "RECTANGLE", W - 2.5, 4.0, hexrgb("#ffeedd")[:3], 450  # day value from the start (set_mood(False) runs only after a night preview)
    ffo = bpy.data.objects.new("fill_front", ff)
    ffo.location = ((W + 2.5) / 2, 1.5, H - 0.3)  # v10: x 2.5..15, y -0.5..3.5 (off the window zone, wider toward the front-right)
    nf = bpy.data.lights.new("night_front_right", "AREA")
    nf.shape, nf.size, nf.size_y, nf.color, nf.energy = "RECTANGLE", 7.5, 6.1, hexrgb("#ffeedd")[:3], 0.0
    nfo = bpy.data.objects.new("night_front_right", nf)
    nfo.location = (12.25, 2.95, H - 0.3)  # v12: x 8.75..15.25, y -0.15..7.35 (no grey-mauve wedge on the right)
    scene.collection.objects.link(nfo)
    NIGHT_FR.append(nfo)
    scene.collection.objects.link(ffo)
    FRONT_FILL.append(ffo)
    fr = bpy.data.lights.new("fill_front_right", "AREA")
    fr.shape, fr.size, fr.size_y, fr.color, fr.energy = "RECTANGLE", 6.0, 4.5, hexrgb("#ffd9b0")[:3], 500
    fro = bpy.data.objects.new("fill_front_right", fr)
    fro.location = (12.0, 2.2, H - 0.3)
    scene.collection.objects.link(fro)
    DAY_FR.append(fro)
    fb = bpy.data.lights.new("fill_back", "AREA")
    fb.shape, fb.size, fb.size_y, fb.color, fb.energy = "RECTANGLE", W - 2.5, 3.6, hexrgb("#fff6ea")[:3], 450
    fbo = bpy.data.objects.new("fill_back", fb)
    fbo.location = ((W + 2.5) / 2, 7.4, H - 0.3)  # v10: off the window zone (the sun patches read there)
    scene.collection.objects.link(fbo)
    BACK_FILL.append(fbo)
    nw = bpy.data.lights.new("wash_ink_night", "AREA")
    nw.shape, nw.size, nw.size_y, nw.color, nw.energy = "RECTANGLE", W - 1.0, 0.6, hexrgb("#f4ece6")[:3], 0.0  # v11: warmer, no lilac spill
    nwo = bpy.data.objects.new("wash_ink_night", nw)
    nwo.location, nwo.rotation_euler = (W / 2, D - 1.6, 1.2), (math.radians(90), 0, 0)  # faces +y: the media wall
    scene.collection.objects.link(nwo)
    NIGHT_WALL.append(nwo)
    nm = bpy.data.lights.new("night_media", "AREA")
    nm.shape, nm.size, nm.size_y, nm.color, nm.energy = "RECTANGLE", 12.0, 1.5, hexrgb("#ffe6cc")[:3], 0.0
    nmo = bpy.data.objects.new("night_media", nm)
    nmo.location = (W / 2 + 1.0, D - 1.2, H - 0.3)  # v13: the cold grey band in front of the media wall
    scene.collection.objects.link(nmo)
    NIGHT_MEDIA.append(nmo)
    nl2 = bpy.data.lights.new("night_lounge", "AREA")
    nl2.shape, nl2.size, nl2.size_y, nl2.color, nl2.energy = "RECTANGLE", 4.0, 9.0, hexrgb("#ffd2a0")[:3], 0.0
    nlo = bpy.data.objects.new("night_lounge", nl2)
    nlo.location = (2.5, 5.0, H - 0.3)
    scene.collection.objects.link(nlo)
    NIGHT_LOUNGE.append(nlo)
    fill = bpy.data.lights.new("fill", "AREA")
    fill.energy, fill.size, fill.color = 1600, 14, hexrgb("#f6f1e8")[:3]  # slightly warmer
    fo = bpy.data.objects.new("fill", fill)
    fo.location = (W + 6, -6, 9)
    fo.rotation_euler = (Vector((W / 2, D / 2, 0)) - fo.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(fo)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 19.8  # the whole room with >= 4 % margin all round
    cam = bpy.data.objects.new("cam", cam_data)
    target = Vector((7.19, 5.56, 1.36))
    cam.location = target + Vector((14, -14, 13.0))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam, target, so, fo, bg


NIGHT_DESAT = {"rug_research": 1.0, "rugedge_research": 1.0, "rug_writing": 0.95, "rug_visual": 0.95, "rugedge_writing": 0.95, "rugedge_visual": 0.95, "rug_": 0.88, "rugedge_": 0.88, "oak": 0.75}  # v12: night-only saturation factor (crayon rugs, caramel desks)
DAY_BASE = {}
# v17: per-mood base colours (day, night); None keeps the regular base (and the night desaturation). A saturation factor
# could not help the yellow: its base is already at saturation 1.0.
MOOD_BASE = {"rug_writing": ("#b0a400", None), "bench_mustard": ("#806a00", "#a88200")}


def night_tone(night):
    """Night bake only: rugs and oak at lower saturation (the day colours are restored for the day bake)."""
    import colorsys
    for name, m in MATS.items():
        f = next((v for k, v in NIGHT_DESAT.items() if name.startswith(k) and name != "rug_lavender"), None)
        if (f is None and name not in MOOD_BASE) or not m.use_nodes:
            continue
        mix = next((n for n in m.node_tree.nodes if n.type == "MIX" and n.blend_type == "MULTIPLY"), None)
        sock = mix.inputs[6] if mix else m.node_tree.nodes["Principled BSDF"].inputs["Base Color"]
        DAY_BASE.setdefault(name, tuple(sock.default_value))
        r, g, b, a = DAY_BASE[name]
        override = MOOD_BASE.get(name, (None, None))[1 if night else 0]
        if override:
            r, g, b = hexrgb(override)[:3]
        elif night and f is not None:
            h, sat_, v = colorsys.rgb_to_hsv(r, g, b)
            r, g, b = colorsys.hsv_to_rgb(h, sat_ * f, v)
        sock.default_value = (r, g, b, a)


def set_mood(night, sun, fill, bg):
    night_tone(night)
    sun.hide_render = night
    fill.data.energy = 180 if night else 950
    fill.data.color = hexrgb("#c8cadc" if night else "#f6f1e8")[:3]  # v8: cool blue night (everything drifted orange-brown)
    for lo in FRONT_FILL:
        lo.data.energy = 150 if night else 450  # v9: the front rows stay >= 145 at night
    for lo in DAY_FR:
        lo.data.energy = 0.0 if night else 500
    for lo in BACK_FILL:
        lo.data.energy = 0.0 if night else 450
    for lo in NIGHT_WALL:
        lo.data.energy = 260 if night else 0.0
    for lo in NIGHT_LIGHTS:
        lo.data.energy = 24 if night else 0.0  # desk fronts ~#b08a68
    for lo in LAMP_SPOTS:
        lo.data.energy = 40 if night else 0.0  # v10: yellow and orange rugs no longer go crayon
    for lo in NIGHT_FR:
        lo.data.energy = 120 if night else 0.0
    for lo in NIGHT_MEDIA:
        lo.data.energy = 60 if night else 0.0
    for lo in NIGHT_LOUNGE:
        lo.data.energy = 225 if night else 0.0
    bg.inputs[1].default_value = 0.12 if night else 0.5
    for name, (day, nite) in EMITTERS.items():
        MATS[name].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = nite if night else day
    ramp = next(n for n in MATS["sky"].node_tree.nodes if n.type == "VALTORGB")
    # v11: the ramp is rebuilt for each mood (moving stops made Blender re-sort them under our references).
    stops = (((0.0, "#5a4a6a"), (0.2, "#e8906a"), (0.3, "#e89a78"), (0.6, "#a47596"), (0.92, "#2c3474")) if night else
             ((0.0, "#f3dcbc"), (0.2, "#bcd8f5"), (0.3, "#8dbdf0"), (0.54, "#6aa6ea"), (0.86, "#3f86dc")))
    cr = ramp.color_ramp
    while len(cr.elements) > 1:
        cr.elements.remove(cr.elements[-1])
    cr.elements[0].position, cr.elements[0].color = stops[0][0], hexrgb(stops[0][1])
    for pos, col in stops[1:]:
        cr.elements.new(pos).color = hexrgb(col)
    snt = MATS["sky"].node_tree
    snt.nodes["sky_map"].inputs["From Max"].default_value = 2.6 if night else 2.2  # night: one navy-to-rose gradient over the pane
    snt.nodes["cloud_amt"].inputs[1].default_value = 0.0 if night else 0.5
    for lo in WASH:
        back = lo.name == "wash_back"
        lo.data.energy = (130 if back else 60) if night else (45 if back else 120)  # v9: day back wash cool and soft (no hot band)
        lo.data.color = hexrgb(("#d8dcff" if night else "#eef0ff") if back else "#ffc78a")[:3]


def cycles_gpu(scene, samples):
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == kind
                scene.cycles.device = "GPU"
                print(f"cycles device: {kind}")
                break
        except TypeError:
            continue
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Base Contrast"
    except TypeError:
        pass


SHELL = ("floor", "slab", "wall_left", "wall_back", "ink_panel", "skirting_back", "cap_", "end_", "slab_edge", "rug_", "rugborder_", "cove_")
LIVE = ("screen_main", "wall_ours_", "wall_trend_", "monitor_", "poster_", "led_left", "led_back")
ATLAS_SAMPLES = 512


def is_live(o):
    n = o.name
    if n.endswith("_bezel") or n.startswith(("monitor_body", "monitor_stand", "monitor_foot", "poster_frame")):
        return False
    return n.startswith(LIVE)


def uv_area(me, keep=None):
    """Share of the 0-1 UV square covered by the bake islands (all faces, or those whose index is in keep)."""
    uvl = me.uv_layers["bake"].data
    tot = 0.0
    for poly in me.polygons:
        if keep is not None and poly.index not in keep:
            continue
        pts = [uvl[i].uv for i in poly.loop_indices]
        tot += abs(sum(pts[i].x * pts[i - 1].y - pts[i - 1].x * pts[i].y for i in range(len(pts)))) / 2
    return tot


def prepare(objs, name, margin=0.003, shape="CONCAVE", angle=60, own_uv=False):
    """Joins one group into its own mesh, drops the faces the camera never sees, unwraps it into a "bake" UV map with small
    props x4 and the podium x3, packs it (rotate, concave, margin 0.003). Returns the joined object."""
    for o in objs:
        small = 1 if max(o.dimensions) < 0.35 else 0
        a = o.data.attributes.new("small", "INT", "FACE")
        f = o.data.attributes.new("isfloor", "INT", "FACE")
        for i in range(len(o.data.polygons)):
            a.data[i].value = small
            f.data[i].value = 1 if o.name == "floor" else 0
    if own_uv:  # objects without an unwrap get one of their own (primitives keep theirs: a box is one island)
        for o in objs:
            if not o.data.uv_layers:
                o.data.uv_layers.new(name="UVMap")
                bpy.ops.object.select_all(action="DESELECT")
                active(o)
                bpy.ops.object.mode_set(mode="EDIT")
                bpy.ops.mesh.select_all(action="SELECT")
                bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0)
                bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = ob.data.name = name
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    flo = bm.faces.layers.int.get("isfloor")
    hidden = [f for f in bm.faces if f.normal.z < -0.9
              or (f.normal.x < -0.9 and f.calc_center_median().x < -0.3)
              or (f.normal.y > 0.9 and f.calc_center_median().y > D + 0.3)
              or (f.normal.z > 0.9 and abs(f.calc_center_median().z) < 0.0005 and not f[flo])]  # slab top under the floor
    bmesh.ops.delete(bm, geom=hidden, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    for m in ob.data.materials:  # textures that need the original UVs keep them (UV Map node), the bake gets its own
        if m and m.use_nodes and ob.data.uv_layers:
            for n in list(m.node_tree.nodes):
                if n.type == "TEX_IMAGE" and not n.inputs["Vector"].links:
                    uvn = m.node_tree.nodes.new("ShaderNodeUVMap")
                    uvn.uv_map = ob.data.uv_layers[0].name
                    m.node_tree.links.new(uvn.outputs["UV"], n.inputs["Vector"])
    ob.data.uv_layers.active = ob.data.uv_layers.new(name="bake")  # a copy of the first map
    active(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    if own_uv:
        bpy.ops.uv.select_all(action="SELECT")
        bpy.ops.uv.average_islands_scale()  # the same texel density everywhere
    else:
        bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=1.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    podium = {i for i, m in enumerate(ob.data.materials) if m and m.name.startswith("podium_")}
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uvl = bm.loops.layers.uv["bake"]
    sm = bm.faces.layers.int.get("small")
    for f in bm.faces:
        k = 4.0 if f[sm] else (3.0 if f.material_index in podium else 1.0)
        if k != 1.0:
            for l in f.loops:
                l[uvl].uv *= k
    bm.to_mesh(ob.data)
    bm.free()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    try:
        bpy.ops.uv.pack_islands(margin=margin, rotate=True, shape_method=shape)
    except TypeError:
        bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    for m in ob.data.materials:  # metals bake black (no reflections in a diffuse bake): Metallic 0 before baking
        bsdf = m.node_tree.nodes.get("Principled BSDF") if m and m.use_nodes else None
        if bsdf:
            bsdf.inputs["Metallic"].default_value = 0.0
    return ob


def bake_image(ob, name):
    img = bpy.data.images.new(name, ATLAS, ATLAS, alpha=False, float_buffer=True)  # 8-bit clipped radiance > 1 (caps stuck at 197)
    for m in ob.data.materials:
        node = m.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = img
        m.node_tree.nodes.active = node
    sc = bpy.context.scene
    sc.cycles.samples = ATLAS_SAMPLES
    sc.cycles.use_denoising = True
    b = sc.render.bake
    b.use_pass_direct = b.use_pass_indirect = True
    b.use_pass_diffuse = b.use_pass_emit = True
    b.use_pass_glossy = b.use_pass_transmission = False
    b.margin = 32
    b.margin_type = "EXTEND"  # no dark seams on pots, plinths and edges
    bpy.ops.object.select_all(action="DESELECT")
    active(ob)
    bpy.ops.object.bake(type="COMBINED")
    return img


def save_view(img, path, exposure=0.0):
    """Saves a bake through the same AgX Base Contrast view as the beauty render (JPEG 90): the unlit page matches it.
    v15: the night maps are saved 0.2 EV lower (exposure)."""
    sc = bpy.context.scene
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Base Contrast"
    sc.view_settings.exposure = exposure
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 90
    img.save_render(path, scene=sc)
    sc.view_settings.exposure = 0.0
    return path


def srgb_lab(c):
    lin = [((v / 255 + 0.055) / 1.055) ** 2.4 if v / 255 > 0.04045 else v / 255 / 12.92 for v in c[:3]]
    x = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047
    y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    return (116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z)))


def sample(path, cam, pts):
    """8-bit values of a rendered image at 3D points (blender coordinates), averaged over 5x5 px."""
    from bpy_extras.object_utils import world_to_camera_view
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    px = im.pixels[:]
    out = {}
    for name, p in pts.items():
        co = world_to_camera_view(bpy.context.scene, cam, Vector(p))
        cx, cy = int(co.x * w), int(co.y * h)
        acc = [0.0, 0.0, 0.0]
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                i = (min(h - 1, max(0, cy + dy)) * w + min(w - 1, max(0, cx + dx))) * 4
                for k in range(3):
                    acc[k] += px[i + k]
        out[name] = tuple(round(255 * v / 25) for v in acc)
    return out


def bake_and_export(layout, cam, target, sun, fill, bg):
    scene = bpy.context.scene
    meshes = [o for o in scene.objects if o.type == "MESH" and o.name != "shadow_ceiling"]
    live = [o for o in meshes if is_live(o)]
    shell_objs = [o for o in meshes if o not in live and o.name.startswith(SHELL)]
    prop_objs = [o for o in meshes if o not in live and o not in shell_objs]
    shell = prepare(shell_objs, "room_shell")
    props = prepare(prop_objs, "room_props", margin=0.0005, own_uv=True)  # ~2k islands: own unwraps, 2 px gutters (64 %)
    qa = [f"{ob.name} atlas usage {uv_area(ob.data) * 100:.0f} %" for ob in (shell, props)]
    me = shell.data
    flo = me.attributes["isfloor"].data
    floor_faces = {p.index for p in me.polygons if flo[p.index].value}
    real = sum(me.polygons[i].area for i in floor_faces)
    qa.append(f"floor {math.sqrt(uv_area(me, floor_faces) * ATLAS * ATLAS / max(real, 1e-6)):.0f} px/m")
    print("QA bake: " + " | ".join(qa), flush=True)
    days = {ob.name: bake_image(ob, f"{ob.name}_day") for ob in (shell, props)}
    set_mood(True, sun, fill, bg)
    nights = {ob.name: bake_image(ob, f"{ob.name}_night") for ob in (shell, props)}
    files = {}
    for ob in (shell, props):
        tag = ob.name.split("_")[1]
        files[ob.name] = (save_view(days[ob.name], f"{OUT}/room-day-{tag}.jpg"), save_view(nights[ob.name], f"{OUT}/room-night-{tag}.jpg", exposure=-0.2))
        baked = bpy.data.materials.new(f"room_baked_{tag}")
        baked.use_nodes = True
        bsdf = baked.node_tree.nodes["Principled BSDF"]
        tex = baked.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(files[ob.name][0])
        baked.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 1.0
        ob.data.materials.clear()
        ob.data.materials.append(baked)
        for uv in [u for u in ob.data.uv_layers if u.name != "bake"]:  # only the bake UV goes to the GLB (TEXCOORD_0)
            ob.data.uv_layers.remove(uv)
    for o in live:  # live quads export plain: the page draws covers, screens and LEDs itself
        if o.name.startswith("poster_"):
            o.data.materials[0] = MATS["screen_live"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in (shell, props, *live):
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=f"{OUT}/room.glb", export_format="GLB", use_selection=True, export_draco_mesh_compression_enable=False,
                              export_apply=True, export_yup=True, export_image_format="JPEG", export_jpeg_quality=90)
    layout["camera"] = {"type": "orthographic", "ortho_scale": cam.data.ortho_scale,
                        "position": {"x": round(cam.location.x, 3), "y": round(cam.location.z, 3), "z": round(-cam.location.y, 3)},
                        "target": {"x": round(target.x, 3), "y": round(target.z, 3), "z": round(-target.y, 3)}}
    layout["screens"]["posters"] = [{"node": "poster_1", "cover": "cover-ours-1.jpg"}, {"node": "poster_2", "cover": "cover-ours-2.jpg"}]
    layout["screens"]["leds"] = [{"node": "led_left", "color": "#ffc78a"}, {"node": "led_back", "color": "#d8dcff"}]
    layout["material_note"] = ("two baked meshes: room_shell (floor, walls, slab, caps, rugs) and room_props (everything else), each with its "
                               "day bake as base colour (materials room_baked_shell / room_baked_props) -> THREE.MeshBasicMaterial({ map }), "
                               "map.colorSpace = SRGBColorSpace. Night maps on the same UVs: models/room-night-shell.jpg and "
                               "room-night-props.jpg (flipY = false like the glTF maps). Live quads (UV 0-1): screen_main, wall_ours_*, "
                               "wall_trend_*, monitor_*, poster_1/2 (screens.posters); LED strips led_left / led_back (screens.leds) are "
                               "drawn by the page. Floor tile grid: origin blender x=0, y=0 (three x=0, z=0), period 0.6 m.")
    layout["room_size"] = {"width_x": W, "depth_z": D, "wall_height": H}
    layout["version"] = 17
    layout["color_note"] = ("teams[].color: tint the robot's body and ear_l/ear_r with it, shoulder_l/r and arm_l/r with it darkened 45%; "
                            "head, visor, eyes, hands and belt unchanged; Lester keeps his violet and gold.")
    layout["seat_note"] = ("teams[].spots[]: x, z on the floor plan, y = stool seat top (the robot's hover base rests on it), facing_yaw; "
                           "stand = the floor point beside the stool on the open west side, on the same x as this pod's aisle waypoint.")
    with open(f"{OUT}/room-layout.json", "w", encoding="utf-8") as fh:
        json.dump(layout, fh, ensure_ascii=False, indent=1)
    tris = sum(len(p.vertices) - 2 for o in (shell, props, *live) for p in o.data.polygons)
    print(f"room: {tris} triangles, {len(live)} live quads", flush=True)
    # QA: the baked room exactly as the page shows it (unlit: colour = bake), day and night, from the same camera.
    for o in [o for o in scene.objects if o.type == "LIGHT"]:
        o.hide_render = True
    engines = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    for k, tag in enumerate(("day", "night")):
        for ob in (shell, props):
            m = bpy.data.materials.new(f"page_{tag}_{ob.name}")
            m.use_nodes = True
            nt = m.node_tree
            em = nt.nodes.new("ShaderNodeEmission")
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = bpy.data.images.load(files[ob.name][k])
            nt.links.new(t.outputs["Color"], em.inputs["Color"])
            nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
            ob.data.materials.clear()
            ob.data.materials.append(m)
        scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
        scene.render.image_settings.file_format = "PNG"
        scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
        scene.render.filepath = f"{OUT}/page-{tag}.png"
        bpy.ops.render.render(write_still=True)
    pts = {"floor_open": (7.5, 4.5, 0.002), "ink_wall": (1.4, D - 0.012, 3.0), "rug_research": (2.75, 6.0, 0.021),
           "limewash": (0.002, 9.9, 3.0), "sofa_top": (0.81, 1.85, 0.42), "cap_left": (-0.175, 4.0, H + 0.006),
           "pane_1": (-0.17, 2.0, 2.45), "pane_2": (-0.17, 5.2, 2.45), "pane_3": (-0.17, 8.4, 2.45),
           "cove_left": (0.06, 3.0, H - 0.146), "ink_a": (1.0, D - 0.012, 0.6), "ink_b": (4.5, D - 0.012, 0.4),
           "ink_c": (10.4, D - 0.012, 0.4), "ink_d": (14.6, D - 0.012, 2.0), "desk_research": (3.3, 6.1, DESK_TOP + 0.001),
           "rug_strategy": (6.0, 5.2, 0.021), "front_a": (4.6, 0.5, 0.002), "front_b": (7.6, 0.5, 0.002),
           "front_c": (14.2, 1.0, 0.002), "cap_back": (6.0, D + 0.175, H + 0.006),
           "pane_mid_1": (-0.17, 2.0, 1.75), "pane_mid_2": (-0.17, 5.2, 1.75), "pane_mid_3": (-0.17, 8.4, 1.75),
           "cove_hi": (0.121, 3.0, H - 0.03), "cove_mid": (0.121, 3.0, H - 0.08), "cove_top": (0.06, 3.0, H + 0.0005),
           "media_band": (2.5, D - 0.012, 3.12), "media_body": (2.5, D - 0.012, 2.9),
           "sun_patch": (1.2, 4.65, 0.002), "sun_ref": (2.6, 4.5, 0.002),
           "back_a": (4.4, 9.0, 0.002), "back_b": (10.4, 9.0, 0.002), "back_c": (13.8, 8.6, 0.002),
           **{f"rug_{tid}": (cx + 0.45, cy - 1.42, 0.021) for tid, _, (cx, cy), _ in TEAMS},
           "pot_a": (1.18, 9.37, 0.41), "pot_c": (W - 0.46, 9.61, 0.34), "pot_d": (W / 2 - 2.79, 9.84, 0.35),
           "pot_e": (W / 2 + 3.01, 9.84, 0.35), "pot_f_sage": (0.66, 6.16, 0.35), "rug_lounge": (2.3, 1.3, 0.016),
           # v10: pane samples ON the sky plane, inside the opening as the camera sees it (the old ones hit the oak frame and sill)
           **{f"sky_{tag}_{i + 1}": (-0.37, yc + 0.2, z) for i, yc in enumerate((2.0, 5.2, 8.4)) for tag, z in (("top", 2.3), ("mid", 1.5), ("bot", 0.85))}, "slab_corner_a": (W + 0.004, -0.054, -0.1), "slab_corner_b": (W + 0.004, -0.054, -0.3),
           "slab_corner_c": (W + 0.004, -0.054, -0.5), "fr_a": (11.0, 0.4, 0.002), "fr_b": (13.8, 0.5, 0.002), "fr_c": (14.5, 2.5, 0.002),
           "desk_front": (3.0, 6.6 - 1.351, 0.35), "sofa_velvet": (1.236, 1.85, 0.2),
           "slab_front": (W / 2, -0.057, -0.27), "slab_right": (W + 0.007, D / 2, -0.27), "slab_corner": (W + 0.003, -0.056, -0.27)}
    from bpy_extras.object_utils import world_to_camera_view
    print("QA cove_left pixel x:", round(world_to_camera_view(scene, cam, Vector(pts["cove_left"])).x * 1600), flush=True)
    beauty = sample(f"{OUT}/salle-iso-v17-ref.png", cam, pts)  # same state as the page: no robots, screens plain
    pday = sample(f"{OUT}/page-day.png", cam, pts)
    pnight = sample(f"{OUT}/page-night.png", cam, pts)
    import colorsys
    for k in pts:
        de = math.dist(srgb_lab(beauty[k]), srgb_lab(pday[k]))
        sat = colorsys.rgb_to_hsv(*[v / 255 for v in pday[k]])[1]
        print(f"QA {k}: beauty {beauty[k]} page-day {pday[k]} sat {sat:.2f} dE {de:.1f} | page-night {pnight[k]}", flush=True)
    for a, b in (("rug_sound_edit", "rug_visual"), ("rug_sound_edit", "rug_lounge"), ("rug_research", "rug_distribution"),
                 ("rug_research", "rug_strategy"), ("rug_lounge", "rug_visual")):
        print(f"QA dE {a} vs {b}: day {math.dist(srgb_lab(pday[a]), srgb_lab(pday[b])):.1f} night {math.dist(srgb_lab(pnight[a]), srgb_lab(pnight[b])):.1f}", flush=True)
    floor_keys = [k for k in pts if k.startswith(("front_", "back_", "fr_", "floor_", "sun_"))]
    labs = {k: srgb_lab(pnight[k]) for k in floor_keys}
    print("QA night floor min L " + f"{min(v[0] for v in labs.values()):.0f}" + " min b* " + f"{min(v[2] for v in labs.values()):.1f}", flush=True)
    print(f"QA night pot_c L {srgb_lab(pnight['pot_c'])[0]:.0f}", flush=True)
    for tag, img in (("day", f"{OUT}/page-day.png"), ("night", f"{OUT}/page-night.png")):
        grid = {f"g{i}_{j}": (-0.37, 5.2 - 0.3 + 0.1 * i, 1.6 + 0.07 * j) for i in range(9) for j in range(11)}
        g = sample(img, cam, grid)
        lum = {k: 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] for k, v in g.items()}
        rows = {j: sum(lum[f"g{i}_{j}"] for i in range(9)) / 9 for j in range(11)}
        resid = [lum[f"g{i}_{j}"] - rows[j] for i in range(9) for j in range(11)]
        print(f"QA cloud detrended std {tag}: {(sum(r * r for r in resid) / len(resid)) ** 0.5:.1f}", flush=True)
    for tid, _, (cx, cy), _ in TEAMS:
        grid = {f"r{i}_{j}": (cx + 0.72 + 0.04 * i, cy - 1.45 + 0.29 * j, 0.021) for i in range(7) for j in range(11)}
        grid.update({f"s{i}_{j}": (cx - 0.85 + 0.17 * i, cy - 1.45 + 0.04 * j, 0.021) for i in range(10) for j in range(2)})
        for tag, img in (("day", f"{OUT}/page-day.png"), ("night", f"{OUT}/page-night.png")):
            vals = list(sample(img, cam, grid).values())
            sats = sorted(colorsys.rgb_to_hsv(*[c / 255 for c in v])[1] for v in vals)
            med = tuple(sorted(v[k] for v in vals)[len(vals) // 2] for k in range(3))
            hue = colorsys.rgb_to_hsv(*[c / 255 for c in med])[0] * 360
            print(f"QA rug {tid} {tag} median {med} hue {hue:.0f} sat p50 {sats[len(sats) // 2]:.2f} p90 {sats[int(len(sats) * 0.9)]:.2f}", flush=True)
    for k in ("rug_writing", "rug_visual", "rug_sound_edit"):
        print(f"QA night sat {k}: {colorsys.rgb_to_hsv(*[v / 255 for v in pnight[k]])[1]:.2f}", flush=True)
    sd = colorsys.rgb_to_hsv(*[v / 255 for v in pday["rug_research"]])[1]
    sn = colorsys.rgb_to_hsv(*[v / 255 for v in pnight["rug_research"]])[1]
    print(f"QA night rug saturation ratio: {sn / max(sd, 1e-6):.2f}", flush=True)


def screens_on():
    """Beauty render only: the screens show content (the owner's covers on the left wall when present, plain colour otherwise; soft placeholders elsewhere); the GLB keeps
    them as plain live quads for the page. Returns a function that restores the plain material."""
    plain = MATS["screen_live"]
    changed = []

    def emissive(name, color=None, image=None, strength=1.4):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        out = nt.nodes["Material Output"]
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Strength"].default_value = strength
        if image:
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(image)
            nt.links.new(tex.outputs["Color"], em.inputs["Color"])
        else:
            em.inputs["Color"].default_value = hexrgb(color)
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        return m

    trend_cols = ["#7a5cff", "#ff8a3d", "#2bb3a3", "#e0569a"]
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        n = o.name
        m = None
        if n.startswith("wall_ours_") and not n.endswith("_bezel"):
            i = int(n.rsplit("_", 1)[1])
            path = os.path.join(COVERS, f"cover-ours-{i}.jpg")
            m = emissive(f"tmp_{n}", image=path) if os.path.exists(path) else emissive(f"tmp_{n}", "#6d45e8")
        elif n.startswith("wall_trend_") and not n.endswith("_bezel"):
            m = emissive(f"tmp_{n}", trend_cols[(int(n.rsplit("_", 1)[1]) - 1) % 4], strength=1.1)
        elif n == "screen_main":
            m = emissive("tmp_main", "#3a2a7a", strength=1.6)
        elif n.startswith("monitor_") and not n.startswith(("monitor_body", "monitor_stand", "monitor_foot")):
            m = emissive(f"tmp_{n}", "#8fb4ff", strength=1.2)
        if m:
            o.data.materials[0] = m
            changed.append(o)

    def restore():
        for o in changed:
            o.data.materials[0] = plain
    return restore


def place_robots():
    """The 21 robots on their stools and Lester on his platform, for the beauty render only (they are not baked)."""
    added = []
    for (x, y), tid in SPOTS:
        new = place_model("robot.glb", (x, y, SEAT), ROBOT_H, math.radians(90))  # face -Y turned to +X (east)
        tint = mat(f"robot_body_{tid}", TEAM_COLORS[tid], 0.38)
        limb = mat(f"robot_arm_{tid}", darker(TEAM_COLORS[tid]), 0.45)
        for o in new:
            base = o.name.split(".")[0]
            if o.type == "MESH" and base in ("body", "ear_l", "ear_r", "shoulder_l", "shoulder_r", "arm_l", "arm_r"):
                o.data.materials.clear()
                o.data.materials.append(tint if base in ("body", "ear_l", "ear_r") else limb)
        added += new
    added += place_model("lester.glb", (LESTER[0], LESTER[1], 0.12), LESTER_H, 0.0)  # faces -Y: the room
    return added


def place_model(fname, loc, height, yaw):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, fname))
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    for r in roots:
        r.scale = (height, height, height)
        r.rotation_mode = "XYZ"
        r.rotation_euler = (0, 0, yaw)
        r.location = (loc[0], loc[1], loc[2] - 0.035 * height)  # the base bottom sits at z 0.035 in the model
    return new


if "--plant-test" in ARGS:
    # A close-up of every plant, to check them before the room render (pots without leaves or leaves on the floor must not happen).
    bpy.ops.wm.read_factory_settings(use_empty=True)
    box("ground", (6, 3, 0.02), (1.5, 0, -0.01), mat("ground", "#e8e2d8", 0.8), bevel=0.0)
    monstera("t_monstera", (0.0, 0.0), 1.3, "terracotta")
    fern("t_fern", (1.1, 0.0), 1.1, "ceramic")
    snake_plant("t_snake", (2.1, 0.0), 1.1, "terracotta")
    succulent("t_succulent", (2.9, 0.0), 0.0)
    scene = bpy.context.scene
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = hexrgb("#f2f1ee")
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(40), 0, math.radians(30))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.location = (1.5, -4.2, 1.6)
    cam.rotation_euler = (Vector((1.5, 0, 0.55)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    cycles_gpu(scene, 48)
    scene.render.resolution_x, scene.render.resolution_y = 1400, 700
    scene.render.filepath = f"{OUT}/plants-test.png"
    bpy.ops.render.render(write_still=True)
    sys.exit(0)

layout = build()
if "--uv-test" in ARGS:
    # Atlas packing check without any bake: usage of each group for a margin and a pack shape.
    margin, shape = float(ARGS[ARGS.index("--uv-test") + 1]), ARGS[ARGS.index("--uv-test") + 2]
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH" and o.name != "shadow_ceiling"]
    group = [o for o in meshes if not is_live(o) and not o.name.startswith(SHELL)]
    print(f"props objects {len(group)}, small {sum(1 for o in group if max(o.dimensions) < 0.35)}", flush=True)
    ob = prepare(group, "room_props", margin, shape, float(ARGS[ARGS.index("--uv-test") + 3]), "own" in ARGS)
    print(f"UVTEST margin {margin} {shape}: props usage {uv_area(ob.data) * 100:.0f} %, faces {len(ob.data.polygons)}", flush=True)
    sys.exit(0)
cam, target, sun, fill, bg = lights_camera()
set_mood(False, sun, fill, bg)
if "--preview" in ARGS:
    # v14: quick lit preview from the page camera to tune the rug colours by measurement before a full bake.
    import colorsys
    scene = bpy.context.scene
    cycles_gpu(scene, 48)
    scene.render.resolution_x, scene.render.resolution_y = 800, 600
    scene.render.filepath = f"{OUT}/preview.png"
    bpy.ops.render.render(write_still=True)
    meds = {}
    for tid, _, (cx, cy), _ in TEAMS:
        grid = {f"r{i}_{j}": (cx + 0.72 + 0.04 * i, cy - 1.45 + 0.29 * j, 0.021) for i in range(7) for j in range(11)}
        vals = list(sample(f"{OUT}/preview.png", cam, grid).values())
        med = tuple(sorted(v[k] for v in vals)[len(vals) // 2] for k in range(3))
        h, sat_, _v = colorsys.rgb_to_hsv(*[c / 255 for c in med])
        meds[tid] = med
        print(f"PREVIEW {tid} {RUG_BASE.get(tid)} median {med} hue {h * 360:.0f} sat {sat_:.2f}", flush=True)
    desk = sample(f"{OUT}/preview.png", cam, {"d": (3.3, 6.1, DESK_TOP + 0.001)})["d"]
    print(f"PREVIEW dE yellow-orange {math.dist(srgb_lab(meds['writing']), srgb_lab(meds['visual'])):.1f} yellow-desk {math.dist(srgb_lab(meds['writing']), srgb_lab(desk)):.1f} desk {desk}", flush=True)
    sys.exit(0)
scene = bpy.context.scene
cycles_gpu(scene, SAMPLES)
scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
robots = place_robots()
restore_screens = screens_on()
scene.render.filepath = f"{OUT}/salle-iso-v17.png"
bpy.ops.render.render(write_still=True)
print("beauty render saved")
if "--closeups" in ARGS:
    # The self-check before any send: close views of a team pod, the lounge and the window wall.
    cam = scene.camera
    keep = (cam.location.copy(), cam.rotation_euler.copy(), cam.data.type, cam.data.ortho_scale)
    cam.data.type = "PERSP"
    cam.data.lens = 35
    for name, eye, look in (("pod", (8.0, 3.0, 2.6), (5.9, 6.6, 0.8)), ("lounge", (4.6, -1.2, 2.4), (1.6, 1.6, 0.6)),
                            ("windows", (5.0, 4.8, 2.0), (0.0, 5.2, 1.6)), ("screens", (W / 2, 4.0, 2.2), (W / 2, D, 1.8))):
        cam.location = eye
        cam.rotation_euler = (Vector(look) - Vector(eye)).to_track_quat("-Z", "Y").to_euler()
        scene.render.resolution_x, scene.render.resolution_y = 1000, 700
        scene.render.filepath = f"{OUT}/closeup-{name}.png"
        bpy.ops.render.render(write_still=True)
    cam.location, cam.rotation_euler, cam.data.type, cam.data.ortho_scale = keep
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
restore_screens()
for o in robots:
    bpy.data.objects.remove(o, do_unlink=True)
for m in [m for m in bpy.data.meshes if m.users == 0]:
    bpy.data.meshes.remove(m)
if "--night-preview" in ARGS:
    set_mood(True, sun, fill, bg)
    scene.render.filepath = f"{OUT}/salle-iso-night.png"
    bpy.ops.render.render(write_still=True)
    set_mood(False, sun, fill, bg)
if BAKE:
    # Reference for the page-vs-beauty colour check: the room exactly as baked (no robots, plain screens), lit, AgX.
    scene.render.filepath = f"{OUT}/salle-iso-v17-ref.png"
    bpy.ops.render.render(write_still=True)
    bake_and_export(layout, cam, target, sun, fill, bg)
