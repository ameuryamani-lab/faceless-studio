# Faceless Studio: the 3D room of the vitrine (target: an isometric
# cutaway diorama with photo-like light in a warm loft, Blender + Three.js). Builds the studio room (7 team clusters x 3 oak desks in production order, windows with late-afternoon light, a
# warm LED strip, plants, Lester's platform, the giant back screen), renders a Cycles beauty shot, bakes the light into one
# atlas and exports a GLB + a layout file for the Three.js page (robots are not baked; they stand at the spots in the layout).
# Run hidden:  blender -b --factory-startup --python workshop/blender/room.py -- <out_dir> [--no-bake] [--samples N]
# Writes <out_dir>/salle-iso.png, room.glb (lit atlas as base colour: show it with MeshBasicMaterial), room-layout.json.
import json
import math
import sys

import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else "."
BAKE = "--no-bake" not in ARGS
SAMPLES = int(ARGS[ARGS.index("--samples") + 1]) if "--samples" in ARGS else 160
ATLAS = 4096

# Room: walls on x=0 (windows) and y=D (giant screen); open toward +x and -y. Blender Z up, metres.
W, D, H = 15.0, 10.5, 3.4
TEAMS = [  # production order along the U-shaped aisle: back row left to right, then front row right to left
    ("research", "Recherche", (2.6, 7.6), "back"),
    ("strategy", "Stratégie", (5.9, 7.6), "back"),
    ("writing", "Écriture", (9.2, 7.6), "back"),
    ("character", "Personnage", (12.5, 7.6), "back"),
    ("visual", "Image", (12.5, 2.6), "front"),
    ("sound_edit", "Son et montage", (9.2, 2.6), "front"),
    ("distribution", "Diffusion", (5.9, 2.6), "front"),
]
LESTER = (2.6, 4.6)


def hexrgb(h, a=1.0):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return (*[c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb], a)


MATS = {}


def mat(name, color, rough=0.6, metal=0.0, emit=None, strength=0.0, transmission=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hexrgb(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if transmission:
        b.inputs["Transmission Weight"].default_value = transmission
    if emit:
        b.inputs["Emission Color"].default_value = hexrgb(emit)
        b.inputs["Emission Strength"].default_value = strength
    MATS[name] = m
    return m


def grain(m, scale=40.0, stretch=(1.0, 8.0, 1.0), amount=0.18, dark="#000000"):
    """A subtle procedural grain on a material (wood fibres, concrete mottling); it ends up in the baked atlas."""
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    base = tuple(b.inputs["Base Color"].default_value)
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = stretch
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 6.0
    ramp = nt.nodes.new("ShaderNodeMix")
    ramp.data_type = "RGBA"
    ramp.inputs["Factor"].default_value = amount
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = amount
    mul.inputs[6].default_value = base
    nt.links.new(noise.outputs["Color"], mul.inputs[7])
    nt.links.new(mul.outputs[2], b.inputs["Base Color"])
    nt.nodes.remove(ramp)
    return m


def active(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def box(name, size, loc, m, bevel=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    active(o)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    if bevel:
        mod = o.modifiers.new("b", "BEVEL")
        mod.width, mod.segments, mod.limit_method = bevel, 2, "NONE"
        bpy.ops.object.modifier_apply(modifier="b")
    o.data.materials.append(m)
    return o


def cyl(name, r, depth, loc, m, verts=16, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, location=loc, vertices=verts)
    o = bpy.context.object
    o.name = name
    active(o)
    bpy.ops.object.shade_smooth()
    o.data.materials.append(m)
    return o


def quad(name, size, loc, rot, m):
    """A UV'd plane for live content (Three.js draws the screens on it)."""
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.data.name = name
    o.scale = (size[0], size[1], 1)
    active(o)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(m)
    return o


def leaf_plant(name, loc, scale=1.0, kind="monstera"):
    """A pot and a cluster of leaves (cheap but readable from the iso camera)."""
    cyl(f"{name}_pot", 0.22 * scale, 0.42 * scale, (loc[0], loc[1], 0.21 * scale), mat("pot", "#f3efe9", 0.5), r2=0.17 * scale)
    cyl(f"{name}_soil", 0.2 * scale, 0.02, (loc[0], loc[1], 0.42 * scale), mat("soil", "#3b2a20", 0.9))
    leaf_m = mat("leaf", "#2f6b3a", 0.55) if kind == "monstera" else mat("leaf_fern", "#3f7d3a", 0.6)
    n = 9 if kind == "monstera" else 14
    for i in range(n):
        a = i / n * math.tau + (0.4 if kind == "fern" else 0)
        tilt = math.radians(22 + (i % 3) * 14)
        length = (0.55 if kind == "monstera" else 0.5) * scale * (0.8 + 0.25 * ((i * 7) % 3))
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=1, location=(0, 0, 0))
        leaf = bpy.context.object
        leaf.name = f"{name}_leaf{i}"
        leaf.scale = (length * 0.5, (0.2 if kind == "monstera" else 0.09) * scale, 0.015)
        active(leaf)
        bpy.ops.object.transform_apply(scale=True)
        for v in leaf.data.vertices:
            v.co.x += length * 0.5
            v.co.z -= 0.18 * (v.co.x / length) ** 2
        leaf.rotation_euler = (0, -math.radians(90) + tilt, a)
        leaf.location = (loc[0], loc[1], 0.45 * scale)
        bpy.ops.object.transform_apply(rotation=True, location=False)
        bpy.ops.object.shade_smooth()
        leaf.data.materials.append(leaf_m)


def tree(name, loc):
    box(f"{name}_planter", (0.7, 0.7, 0.55), (loc[0], loc[1], 0.275), mat("oak", "#c89a62", 0.55), bevel=0.03)
    cyl(f"{name}_trunk", 0.05, 1.4, (loc[0], loc[1], 1.15), mat("bark", "#6b4a33", 0.8), verts=8)
    for i, (dx, dy, dz, r) in enumerate(((0, 0, 2.05, 0.55), (0.25, 0.1, 1.8, 0.4), (-0.2, -0.15, 1.85, 0.42), (0.05, -0.25, 2.25, 0.35))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=(loc[0] + dx, loc[1] + dy, dz))
        f = bpy.context.object
        f.name = f"{name}_foliage{i}"
        active(f)
        bpy.ops.object.shade_smooth()
        f.data.materials.append(mat("foliage", "#3d7a3f", 0.7))


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    white = mat("white_wall", "#f4f1ec", 0.75)
    oak = grain(mat("oak", "#c89a62", 0.55), scale=30.0, stretch=(1.0, 12.0, 1.0), amount=0.22)
    oak_dark = mat("oak_dark", "#a87a46", 0.6)
    screen_off = mat("screen_live", "#0e0916", 0.25)
    white_dev = mat("monitor_white", "#f2f2f4", 0.35)
    # Floor slab with thick white edges, the concrete floor on top.
    box("slab", (W + 0.3, D + 0.3, 0.45), (W / 2 - 0.15, D / 2 + 0.15, -0.225), mat("slab", "#fbfaf7", 0.6))
    box("floor", (W, D, 0.02), (W / 2, D / 2, 0.0), grain(mat("concrete", "#e2ddd5", 0.7), scale=3.0, stretch=(1.0, 1.0, 1.0), amount=0.12))
    # Walls: left (x=0) with three big windows, back (y=D) holding the giant screen.
    left = box("wall_left", (0.25, D + 0.25, H), (-0.125, D / 2 + 0.125, H / 2), white)
    box("wall_back", (W, 0.25, H), (W / 2, D + 0.125, H / 2), white)
    for i, yc in enumerate((2.0, 5.2, 8.4)):
        cut = box(f"cut{i}", (1.0, 2.2, 2.0), (-0.125, yc, 1.75), white)
        mod = left.modifiers.new(f"win{i}", "BOOLEAN")
        mod.object, mod.operation = cut, "DIFFERENCE"
        active(left)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cut)
        for nm, size, loc in (
            ("top", (0.3, 2.3, 0.08), (-0.125, yc, 2.79)), ("bottom", (0.42, 2.3, 0.08), (0.0, yc, 0.71)),
            ("l", (0.3, 0.08, 2.0), (-0.125, yc - 1.12, 1.75)), ("r", (0.3, 0.08, 2.0), (-0.125, yc + 1.12, 1.75)),
            ("mid", (0.1, 0.06, 2.0), (-0.125, yc, 1.75)),
        ):
            box(f"frame{i}_{nm}", size, loc, oak)
        # No glass pane: Cycles glass would block the sun (no caustics); the open frames read as windows from the iso view.
    # Warm LED strip along the top of both walls.
    led = mat("led", "#ffd9a8", 0.4, emit="#ffd2a0", strength=12.0)
    box("led_left", (0.04, D, 0.04), (0.04, D / 2, H - 0.08), led)
    box("led_back", (W, 0.04, 0.04), (W / 2, D - 0.04, H - 0.08), led)
    # The giant back screen: a dark frame and the live quad "screen_main"; an oak bench under it.
    box("screen_frame", (6.4, 0.12, 2.5), (W / 2 + 0.5, D - 0.07, 1.95), mat("frame_dark", "#1a1626", 0.35))
    quad("screen_main", (6.1, 2.25), (W / 2 + 0.5, D - 0.14, 1.95), (math.radians(90), 0, 0), screen_off)
    box("bench", (6.0, 0.5, 0.42), (W / 2 + 0.5, D - 0.45, 0.21), oak, bevel=0.02)
    layout = {"units": "metres; three.js coordinates (y up): x, y, z = blender x, z, -y", "teams": [], "aisle": [], "screens": {"main": "screen_main", "monitors": {}}}
    chair_mats = [mat("chair_red", "#c8323a", 0.5), mat("chair_grey", "#8d8f98", 0.55)]
    for t_i, (tid, label, (cx, cy), row) in enumerate(TEAMS):
        face = 1 if row == "back" else -1  # monitor side: +y for the back row, -y for the front row
        spots = []
        # Each team is a pod on its own sisal rug, with clear floor between pods (not a classroom row).
        box(f"rug_{tid}", (2.75, 2.1, 0.012), (cx, cy - face * 0.25, 0.012), mat("sisal", "#c9ad83", 0.95), bevel=0.004)
        for k in range(3):
            x = cx + (k - 1) * 0.86
            box(f"desk_{tid}_{k + 1}", (0.8, 0.7, 0.05), (x, cy, 0.74), oak, bevel=0.01)
            for j, lx in enumerate((-0.36, 0.36)):
                box(f"leg_{tid}_{k}_{j}", (0.04, 0.6, 0.72), (x + lx, cy, 0.36), oak_dark)
            mon_y = cy + face * 0.2
            box(f"monitor_body_{tid}_{k + 1}", (0.6, 0.04, 0.38), (x, mon_y, 1.08), white_dev, bevel=0.01)
            box(f"monitor_stand_{tid}_{k + 1}", (0.06, 0.06, 0.28), (x, mon_y + face * 0.03, 0.88), white_dev)
            name = f"monitor_{tid}_{k + 1}"
            quad(name, (0.54, 0.32), (x, mon_y - face * 0.025, 1.08), (math.radians(90), 0, 0 if face > 0 else math.pi), screen_off)
            layout["screens"]["monitors"].setdefault(tid, []).append(name)
            box(f"keyboard_{tid}_{k + 1}", (0.4, 0.14, 0.015), (x, cy - face * 0.08, 0.775), white_dev)
            # A red or grey chair pushed to the side; the robot stands in front of the desk.
            chair_x, chair_y = x + 0.3, cy - face * 0.7
            cm = chair_mats[(t_i + k) % 2]
            box(f"seat_{tid}_{k}", (0.42, 0.42, 0.06), (chair_x, chair_y, 0.46), cm, bevel=0.02)
            box(f"chairback_{tid}_{k}", (0.42, 0.05, 0.38), (chair_x, chair_y - face * 0.2, 0.7), cm, bevel=0.02)
            cyl(f"chairleg_{tid}_{k}", 0.025, 0.43, (chair_x, chair_y, 0.215), mat("steel", "#9a9aa2", 0.3, 0.9), verts=8)
            spot = (x - 0.05, cy - face * 0.62)
            spots.append({"x": round(spot[0], 3), "y": 0.0, "z": round(-spot[1], 3), "facing_yaw": 0.0 if face > 0 else round(math.pi, 4)})
        layout["teams"].append({"id": tid, "label": label, "row": row, "center": {"x": cx, "y": 0.0, "z": -cy}, "spots": spots})
    # Lester's round platform at the start of the aisle, with a glowing amber edge.
    cyl("lester_platform", 0.75, 0.12, (LESTER[0], LESTER[1], 0.06), mat("platform", "#efe9df", 0.4), verts=40)
    cyl("lester_ring", 0.78, 0.03, (LESTER[0], LESTER[1], 0.125), mat("amber_led", "#ffb547", 0.3, emit="#ffb547", strength=6.0), verts=40)
    layout["lester"] = {"x": LESTER[0], "y": 0.12, "z": -LESTER[1], "facing_yaw": round(math.radians(-45), 4)}
    # Aisle waypoints in production order (U): in front of each cluster, with the turn at the right end.
    pts = [(LESTER[0] + 0.9, 5.1)]
    pts += [(cx, 5.95) for _, _, (cx, _), row in TEAMS if row == "back"]
    pts += [(W - 1.0, 5.1)]
    pts += [(cx, 4.25) for _, _, (cx, _), row in TEAMS if row == "front"]
    layout["aisle"] = [{"x": round(x, 3), "y": 0.0, "z": round(-y, 3)} for x, y in pts]
    # Plants and trees: corners, by the screen, by Lester.
    for i, (x, y, s, kind) in enumerate(((0.8, 0.8, 1.3, "monstera"), (0.8, D - 0.8, 1.4, "monstera"), (W - 0.8, D - 0.8, 1.2, "fern"),
                                         (4.1, D - 0.45, 0.8, "fern"), (11.0, D - 0.45, 0.8, "monstera"), (W - 0.7, 3.2, 1.1, "fern"),
                                         (LESTER[0] - 1.1, LESTER[1] - 1.0, 1.0, "fern"))):
        leaf_plant(f"plant{i}", (x, y), s, kind)
    tree("tree_a", (4.25, 5.1))
    tree("tree_b", (W - 2.6, 5.1))
    # A small lounge corner (front right): a grey sofa and a coffee table.
    box("sofa_base", (2.0, 0.85, 0.42), (W - 1.6, 0.9, 0.21), mat("fabric_grey", "#7d808a", 0.9), bevel=0.06)
    box("sofa_back", (2.0, 0.22, 0.45), (W - 1.6, 0.48, 0.62), mat("fabric_grey", "#7d808a", 0.9), bevel=0.06)
    cyl("coffee_table", 0.38, 0.4, (W - 1.6, 1.85, 0.2), oak, verts=28)
    return layout


def lights_camera():
    scene = bpy.context.scene
    # The camera sees a clean off-white backdrop (like his reference); the room is lit by a dimmer, slightly warm ambient.
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    bg.inputs[0].default_value = hexrgb("#e9e4dc")
    bg.inputs[1].default_value = 0.5
    seen = nt.nodes.new("ShaderNodeBackground")
    seen.inputs[0].default_value = hexrgb("#f3f0eb")
    seen.inputs[1].default_value = 2.4
    path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(path.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(bg.outputs[0], mix.inputs[1])
    nt.links.new(seen.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], nt.nodes["World Output"].inputs["Surface"])
    scene.world = world
    # Late-afternoon sun through the left windows, warm and low: light travels toward +x and down.
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 4.5
    sun.angle = math.radians(2.5)
    sun.color = hexrgb("#ffbf80")[:3]
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = Vector((1.0, 0.45, -0.62)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(so)
    # A soft cool sky fill from the open sides.
    fill = bpy.data.lights.new("fill", "AREA")
    fill.energy, fill.size, fill.color = 900, 12, hexrgb("#dfe8ff")[:3]
    fo = bpy.data.objects.new("fill", fill)
    fo.location = (W + 6, -6, 9)
    fo.rotation_euler = (Vector((W / 2, D / 2, 0)) - fo.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(fo)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 21.5
    cam = bpy.data.objects.new("cam", cam_data)
    target = Vector((W / 2 + 0.3, D / 2 + 0.2, 0.6))
    cam.location = target + Vector((14, -14, 13.5))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam, target


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


def bake_and_export(layout, cam, target):
    scene = bpy.context.scene
    is_live = lambda o: o.name == "screen_main" or (o.name.startswith("monitor_") and not o.name.startswith(("monitor_body", "monitor_stand")))
    live = [o for o in scene.objects if o.type == "MESH" and is_live(o)]
    for g in [o for o in scene.objects if o.name.startswith("glass")]:
        bpy.data.objects.remove(g)  # glass has no colour of its own in the bake; the openings read on their own
    static = [o for o in scene.objects if o.type == "MESH" and o not in live]
    bpy.ops.object.select_all(action="DESELECT")
    for o in static:
        o.select_set(True)
    bpy.context.view_layer.objects.active = static[0]
    bpy.ops.object.join()
    room = bpy.context.object
    room.name = room.data.name = "room"
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, area_weight=1.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("room_light", ATLAS, ATLAS, alpha=False)
    for m in room.data.materials:
        node = m.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = img
        m.node_tree.nodes.active = node
    scene.render.bake.use_pass_direct = True
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = True
    scene.render.bake.margin = 6
    active(room)
    bpy.ops.object.bake(type="DIFFUSE")
    img.filepath_raw = f"{OUT}/room-light.png"
    img.file_format = "PNG"
    img.save()
    # One material: the baked atlas as base colour (the page shows it with MeshBasicMaterial, so the light stays as baked).
    baked = bpy.data.materials.new("room_baked")
    baked.use_nodes = True
    bsdf = baked.node_tree.nodes["Principled BSDF"]
    tex = baked.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    baked.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    room.data.materials.clear()
    room.data.materials.append(baked)
    bpy.ops.object.select_all(action="DESELECT")
    room.select_set(True)
    for o in live:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=f"{OUT}/room.glb", export_format="GLB", use_selection=True, export_draco_mesh_compression_enable=False,
                              export_apply=True, export_yup=True, export_image_format="JPEG", export_jpeg_quality=90)
    layout["camera"] = {"type": "orthographic", "ortho_scale": cam.data.ortho_scale,
                        "position": {"x": round(cam.location.x, 3), "y": round(cam.location.z, 3), "z": round(-cam.location.y, 3)},
                        "target": {"x": round(target.x, 3), "y": round(target.z, 3), "z": round(-target.y, 3)}}
    layout["material_note"] = "room mesh: baked light in its base colour map -> THREE.MeshBasicMaterial({ map }) with map.colorSpace = SRGBColorSpace; screen_main and monitor_* are live quads (UV 0-1) to draw on; LED strips and Lester's ring glow in the bake only (add bloom if wanted)."
    layout["room_size"] = {"width_x": W, "depth_z": D, "wall_height": H}
    with open(f"{OUT}/room-layout.json", "w", encoding="utf-8") as f:
        json.dump(layout, f, ensure_ascii=False, indent=1)
    tris = sum(len(p.vertices) - 2 for o in [room, *live] for p in o.data.polygons)
    print(f"room: {tris} triangles, {len(live)} live quads")


layout = build()
cam, target = lights_camera()
scene = bpy.context.scene
cycles_gpu(scene, SAMPLES)
scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
scene.render.filepath = f"{OUT}/salle-iso.png"
bpy.ops.render.render(write_still=True)
print("beauty render saved")
if BAKE:
    bake_and_export(layout, cam, target)
