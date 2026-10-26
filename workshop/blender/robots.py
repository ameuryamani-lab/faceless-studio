# Faceless Studio: the 3D robots of the vitrine (a 3D look instead of the
# 2D drawing, Blender + Three.js). One worker robot and Lester (the chief), in the AttentionOS look kept since 20/10:
# white/lilac head, dark visor with two glowing eyes and a smile, violet body, dark arms with white hands, an antenna orb.
# Named parts so Three.js can animate them (eyes glow, arms tap, breathing, antenna pulse). Low poly for phones (~3-6k tris).
# Run hidden:  blender -b --factory-startup --python workshop/blender/robots.py -- <out_dir> <preview_dir>
# Writes <out_dir>/robot.glb, <out_dir>/lester.glb and <preview_dir>/robot.png, lester.png (1024x1024 previews).
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = args[0] if args else "."
PREVIEW = args[1] if len(args) > 1 else OUT


def hexrgb(h, a=1.0):
    h = h.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, a)


def material(name, color, rough=0.45, metal=0.0, coat=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hexrgb(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.12
    if emit:
        b.inputs["Emission Color"].default_value = hexrgb(emit)
        b.inputs["Emission Strength"].default_value = strength
    return m


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def finish(obj, name, mat, bevel=0.0, segs=3, smooth=True):
    obj.name = name
    obj.data.name = name
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segs
        mod.limit_method = "NONE"
    if smooth:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_smooth()
    obj.data.materials.append(mat)
    return obj


def box(name, size, loc, mat, bevel=0.0, segs=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, name, mat, bevel, segs)


def sphere(name, r, loc, mat, scale=(1, 1, 1), seg=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=rings)
    o = bpy.context.object
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, name, mat)


def cyl(name, r, depth, loc, mat, rot=(0, 0, 0), verts=14):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    return finish(bpy.context.object, name, mat)


def torus(name, R, r, loc, mat, rot=(0, 0, 0), major=32, minor=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=major, minor_segments=minor)
    return finish(bpy.context.object, name, mat)


def keep_lower_half(obj):
    """Deletes the upper half of a ring: a smile instead of an "O"."""
    import bmesh
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    cz = sum(v.co.z for v in bm.verts) / len(bm.verts)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z > cz - 0.004], context="FACES")
    bm.to_mesh(obj.data)
    bm.free()


def limb(name, a, b, r, mat, verts=12):
    """A cylinder from point a to point b (an arm from the shoulder to the hand)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    o = cyl(name, r, d.length, (a + b) / 2, mat, verts=verts)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = d.to_track_quat("Z", "Y")
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(rotation=True)
    return o


def build(chief=False):
    """The robot, 1.0 tall (Three.js scales Lester up). The face looks toward -Y."""
    accent = "#ffb547" if chief else "#b566ff"
    M = {
        "head": material("head", "#efe8ff", rough=0.32, coat=0.6),
        "visor": material("visor", "#120a20", rough=0.18, coat=1.0),
        "eye": material("eye", "#f4eeff", rough=0.3, emit="#ffe2b0" if chief else "#d9c4ff", strength=6.0),
        "body": material("body", "#6d45e8", rough=0.38, coat=0.8),
        "body_dark": material("body_dark", "#4a27b5", rough=0.45, coat=0.5),
        "arm": material("arm", "#3a2a68", rough=0.5),
        "hand": material("hand", "#efe8ff", rough=0.35, coat=0.4),
        "glow": material("glow", accent, rough=0.3, emit=accent, strength=8.0),
        "gold": material("gold", "#ffb547", rough=0.25, metal=0.85, emit="#ffb547", strength=1.5),
    }
    parts = []
    # Body: a soft rounded torso, a little narrower at the bottom, with a chest light.
    body = box("body", (0.46, 0.36, 0.40), (0, 0, 0.30), M["body"], bevel=0.13, segs=4)
    parts.append(body)
    parts.append(box("belt", (0.40, 0.30, 0.06), (0, 0, 0.12), M["body_dark"], bevel=0.03, segs=2))
    parts.append(sphere("chest_light", 0.045, (0, -0.185, 0.36), M["glow"], scale=(1, 0.5, 1), seg=14, rings=8))
    # Neck and head: a big friendly rounded head with the dark visor across the face.
    parts.append(cyl("neck", 0.07, 0.08, (0, 0, 0.53), M["arm"], verts=12))
    parts.append(box("head", (0.58, 0.46, 0.40), (0, 0, 0.76), M["head"], bevel=0.15, segs=6))
    parts.append(box("visor", (0.48, 0.06, 0.24), (0, -0.215, 0.765), M["visor"], bevel=0.05, segs=3))
    # Eyes: two glowing pills; the smile: a small glowing arc under them.
    for side, x in (("l", -0.105), ("r", 0.105)):
        parts.append(sphere(f"eye_{side}", 0.05, (x, -0.252, 0.79), M["eye"], scale=(0.8, 0.4, 1.25), seg=12, rings=8))
    smile = torus("smile", 0.045, 0.011, (0, -0.25, 0.755), M["eye"], rot=(math.radians(90), 0, 0), major=24, minor=5)
    keep_lower_half(smile)
    parts.append(smile)
    # Ears: two little side pods.
    for side, x in (("l", -0.305), ("r", 0.305)):
        parts.append(cyl(f"ear_{side}", 0.06, 0.05, (x, 0, 0.77), M["body"], rot=(0, math.radians(90), 0), verts=14))
    # Antenna with a glowing orb; Lester also gets a gold crown ring with glowing gems.
    parts.append(cyl("antenna", 0.012, 0.13, (0, 0, 1.02), M["arm"], verts=8))
    parts.append(sphere("antenna_orb", 0.04, (0, 0, 1.10), M["glow"], seg=14, rings=8))
    if chief:
        parts.append(torus("crown", 0.2, 0.018, (0, 0, 1.06), M["gold"], major=36, minor=6))
        for i in range(5):
            a = i / 5 * math.tau
            parts.append(sphere(f"crown_gem_{i}", 0.022, (0.2 * math.cos(a), 0.2 * math.sin(a), 1.085), M["glow"], seg=8, rings=6))
    # Arms and hands, slightly forward as if over a keyboard.
    for side in ("l", "r"):
        k = -1 if side == "l" else 1
        shoulder = (0.215 * k, -0.01, 0.42)
        hand = (0.27 * k, -0.17, 0.22)
        parts.append(sphere(f"shoulder_{side}", 0.055, shoulder, M["arm"], seg=12, rings=8))
        parts.append(limb(f"arm_{side}", shoulder, hand, 0.042, M["arm"]))
        parts.append(sphere(f"hand_{side}", 0.058, hand, M["hand"], seg=14, rings=10))
    # A soft hover base under the body.
    parts.append(cyl("base", 0.17, 0.05, (0, 0, 0.06), M["body_dark"], verts=20))
    for p in parts:
        for m in list(p.modifiers):
            bpy.context.view_layer.objects.active = p
            bpy.ops.object.modifier_apply(modifier=m.name)
    root = bpy.data.objects.new("lester" if chief else "robot", None)
    bpy.context.collection.objects.link(root)
    for p in parts:
        p.parent = root
    return root, parts


def tris(parts):
    return sum(len(poly.vertices) - 2 for p in parts for poly in p.data.polygons)


def glow(scene):
    """A soft bloom on the emissive parts (eyes, smile, chest, orb) for the preview only; Three.js adds its own."""
    try:
        if hasattr(scene, "compositing_node_group"):
            tree = bpy.data.node_groups.new("glow", "CompositorNodeTree")
            scene.compositing_node_group = tree
            out = tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
            src = tree.nodes.new("CompositorNodeRLayers")
            g = tree.nodes.new("CompositorNodeGlare")
            dst = tree.nodes.new("NodeGroupOutput")
        else:
            scene.use_nodes = True
            tree = scene.node_tree
            src = tree.nodes.get("Render Layers") or tree.nodes.new("CompositorNodeRLayers")
            g = tree.nodes.new("CompositorNodeGlare")
            dst = tree.nodes.get("Composite") or tree.nodes.new("CompositorNodeComposite")
        for key, val in (("glare_type", "BLOOM"), ("quality", "HIGH"), ("threshold", 0.9), ("size", 7)):
            if hasattr(g, key):
                setattr(g, key, val)
        for name, val in (("Type", "Bloom"), ("Threshold", 0.9), ("Strength", 0.9), ("Size", 0.6)):
            if name in g.inputs:
                try:
                    g.inputs[name].default_value = val
                except Exception:
                    pass
        tree.links.new(src.outputs["Image"], g.inputs["Image"])
        tree.links.new(g.outputs[0], dst.inputs[0])
    except Exception as e:  # the preview still renders without bloom
        print(f"glow skipped: {e}")


def render(path):
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = scene.render.resolution_y = 1024
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = hexrgb("#2a1748")
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.6
    scene.world = world
    glow(scene)
    for name, loc, energy, color in (("key", (-1.6, -2.2, 2.4), 260, "#ffffff"), ("rim", (1.8, 1.6, 1.8), 220, "#b566ff"), ("fill", (2.0, -1.8, 0.6), 90, "#7dd3fc")):
        light = bpy.data.lights.new(name, "AREA")
        light.energy = energy
        light.size = 1.5
        light.color = hexrgb(color)[:3]
        o = bpy.data.objects.new(name, light)
        o.location = loc
        o.rotation_euler = (Vector((0, 0, 0.5)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(o)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 70
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (1.15, -2.35, 1.35)
    cam.rotation_euler = (Vector((0, 0, 0.55)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Punchy"
    except TypeError:
        pass
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


for chief in (False, True):
    clear()
    root, parts = build(chief)
    name = "lester" if chief else "robot"
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for p in parts:
        p.select_set(True)
    bpy.ops.export_scene.gltf(filepath=f"{OUT}/{name}.glb", export_format="GLB", use_selection=True, export_draco_mesh_compression_enable=False, export_apply=True, export_yup=True)
    print(f"{name}: {tris(parts)} triangles, parts: {', '.join(p.name for p in parts)}")
    render(f"{PREVIEW}/{name}.png")
