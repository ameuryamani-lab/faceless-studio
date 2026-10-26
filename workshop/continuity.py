"""Faceless Studio: deterministic continuity check of a mascot hero against its reference (CPU only, numpy + PIL + scipy).

Run with the ComfyUI embedded python in isolated mode, a JSON request on stdin, JSON on stdout:
    python -I -X utf8 workshop/continuity.py < request.json
Request keys:
    input: absolute path of a .png/.jpg/.webp keyframe or an .mp4 clip (3 frames sampled with FFmpeg)
    reference: absolute path of the front reference (brand/references/hero-front.png, brand/continuity.json "reference")
    config: the content of brand/continuity.json (thresholds, palette)
    expect: optional per-shot overrides {view: front|three_quarter|back|top, ball_visible, screen_visible,
            eyes_visible, body_visible, ears_check}
    ffmpeg, ffprobe: absolute paths (only for an .mp4)
Output: {pass, score, checks:[{name, value, target, pass, skipped?}], notes, frames?}
Every measure is plain colour and geometry (Lab distances, connected regions, a histogram and an edge correlation):
explainable, and the same input always gives the same verdict. No GPU, no network, nothing written except FFmpeg's
temporary frames in a system temp folder that is removed afterwards.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

os.environ['CUDA_VISIBLE_DEVICES'] = ''  # never the GPU (a render may be running)

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

IMAGE_EXTS = ('.png', '.jpg', '.jpeg', '.webp')


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------- colour ----------
def srgb_to_lab(rgb):
    """rgb: float array (..., 3) in 0..1 -> CIE Lab (D65)."""
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = (c @ m.T) / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def hex_lab(h):
    h = h.lstrip('#')
    return srgb_to_lab(np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]))


def de76(lab, ref):
    return np.sqrt(((lab - ref) ** 2).sum(-1))


def nearest_de(lab, hexes):
    """Distance from each pixel (or one colour) to the nearest of several palette colours."""
    return np.min(np.stack([de76(lab, hex_lab(h)) for h in hexes], 0), 0)


def lab_hex(lab):
    """Lab -> #RRGGBB (for notes)."""
    L, a, b = lab
    fy = (L + 16) / 116
    fx, fz = fy + a / 500, fy - b / 200
    inv = lambda t: t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787
    xyz = np.array([inv(fx) * 0.95047, inv(fy), inv(fz) * 1.08883])
    m = np.array([[3.2404542, -1.5371385, -0.4985314], [-0.9692660, 1.8760108, 0.0415560], [0.0556434, -0.2040259, 1.0572252]])
    c = m @ xyz
    c = np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.clip(c, 0, None) ** (1 / 2.4) - 0.055)
    return '#' + ''.join(f'{int(round(v * 255)):02X}' for v in np.clip(c, 0, 1))


# ---------- helpers ----------
def load(path, size):
    im = Image.open(path).convert('RGB')
    im.thumbnail((size, size), Image.BILINEAR)
    rgb = np.asarray(im, dtype=np.float64) / 255.0
    return rgb, srgb_to_lab(rgb)


def components(mask, min_area):
    """Connected regions of a mask (8-connected) larger than min_area: list of dicts sorted by area."""
    lab, n = ndi.label(mask, structure=np.ones((3, 3)))
    out = []
    if n == 0:
        return out, lab
    areas = ndi.sum(mask, lab, index=np.arange(1, n + 1))
    for i, a in enumerate(areas, start=1):
        if a < min_area:
            continue
        ys, xs = np.nonzero(lab == i)
        out.append({'label': i, 'area': int(a), 'x0': int(xs.min()), 'x1': int(xs.max()) + 1, 'y0': int(ys.min()), 'y1': int(ys.max()) + 1,
                    'cx': float(xs.mean()), 'cy': float(ys.mean())})
    out.sort(key=lambda c: -c['area'])
    return out, lab


def chroma_hue(lab):
    c = np.hypot(lab[..., 1], lab[..., 2])
    h = np.degrees(np.arctan2(lab[..., 2], lab[..., 1]))
    return c, h


def check(checks, name, value, target, ok, skipped=False, note=None):
    item = {'name': name, 'value': value, 'target': target, 'pass': bool(ok)}
    if skipped:
        item['skipped'] = True
    if note:
        item['note'] = note
    checks.append(item)


def rnd(v, k=3):
    return None if v is None else round(float(v), k)


# ---------- the measures ----------
def find_screen(lab, cfg, area):
    s = cfg['screen']
    c, _ = chroma_hue(lab)
    mask = (lab[..., 0] < s['max_L']) & (de76(lab, hex_lab(cfg['palette']['screen'])) < s['max_de_px']) & (lab[..., 1] > s['min_a'])
    mask = ndi.binary_opening(mask, iterations=2)
    mask = ndi.binary_fill_holes(ndi.binary_closing(mask, iterations=2))
    comps, labels = components(mask, area * s['min_area_frac'])
    # A screen is a solid rounded rectangle: keep regions that fill most of their bounding box.
    good = [k for k in comps if k['area'] / max(1, (k['x1'] - k['x0']) * (k['y1'] - k['y0'])) >= s['min_solidity']]
    return (good[0] if good else None), labels, len(good)


def n_screens_big(lab, cfg, area, scr):
    """Screen-like regions at least `second_screen_min` of the main screen's area (the main one included)."""
    s = cfg['screen']
    mask = (lab[..., 0] < s['max_L']) & (de76(lab, hex_lab(cfg['palette']['screen'])) < s['max_de_px']) & (lab[..., 1] > s['min_a'])
    mask = ndi.binary_fill_holes(ndi.binary_closing(ndi.binary_opening(mask, iterations=2), iterations=2))
    comps, labels = components(mask, scr['area'] * s['second_screen_min'])
    ref = hex_lab(cfg['palette']['screen'])
    n = 0
    for k in comps:
        if k['area'] / max(1, (k['x1'] - k['x0']) * (k['y1'] - k['y0'])) < s['min_solidity']:
            continue
        px = lab[(labels == k['label']) & (lab[..., 0] < s['max_L'])]
        # A second screen has the same raspberry tint; black props (a pumpkin's carved face) do not.
        med = np.median(px, 0) if len(px) else None
        if med is not None and med[1] >= s['second_screen_min_a'] and float(de76(med, ref)) <= cfg['drift']['screen_max_de']:
            n += 1
    return n


def head_box(lab, scr, cfg):
    """Head bounding box: the white bezel region around the screen (bounded by the outline), else the screen box
    scaled by the reference's head/screen ratios."""
    h_cfg = cfg['head']
    H, W = lab.shape[:2]
    sw, sh = scr['x1'] - scr['x0'], scr['y1'] - scr['y0']
    light = lab[..., 0] > h_cfg['bezel_min_L']
    comps, labels = components(light, 30)
    pad_x, pad_y = int(sw * 0.12) + 2, int(sh * 0.12) + 2
    ring = np.zeros_like(light)
    ring[max(0, scr['y0'] - pad_y):min(H, scr['y1'] + pad_y), max(0, scr['x0'] - pad_x):min(W, scr['x1'] + pad_x)] = True
    ring[scr['y0']:scr['y1'], scr['x0']:scr['x1']] = False
    best = None
    for k in comps:
        overlap = int((labels[ring] == k['label']).sum())
        if overlap and (best is None or overlap > best[0]):
            best = (overlap, k)
    if best:
        k = best[1]
        rw, rh = (k['x1'] - k['x0']) / sw, (k['y1'] - k['y0']) / sh
        if h_cfg['bezel_ratio_min'] <= rw <= h_cfg['bezel_ratio_max'] and h_cfg['bezel_ratio_min'] <= rh <= h_cfg['bezel_ratio_max']:
            return (k['x0'], k['y0'], k['x1'], k['y1']), 'bezel'
    rx, ry = h_cfg['ref_ratio_w'], h_cfg['ref_ratio_h']
    cx, cy = (scr['x0'] + scr['x1']) / 2, (scr['y0'] + scr['y1']) / 2
    return (int(cx - sw * rx / 2), int(cy - sh * ry / 2), int(cx + sw * rx / 2), int(cy + sh * ry / 2)), 'scaled screen'


def find_balls(lab, cfg, area):
    b = cfg['ball']
    c, h = chroma_hue(lab)
    mask = (c > b['min_chroma']) & (h > b['hue_min']) & (h < b['hue_max']) & (lab[..., 0] > b['min_L']) & (lab[..., 0] < b['max_L'])
    mask = ndi.binary_fill_holes(ndi.binary_closing(mask, iterations=2))
    comps, _ = components(mask, area * b['min_area_frac'])
    return comps, mask


def crop_box(box, shape, cfg, body=True):
    """Character crop from the head box: the ball above, the body below (head only when the body is hidden)."""
    H, W = shape[:2]
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    s = cfg['similarity']
    below = s['below_head'] if body else s['below_head_hidden_body']
    return (max(0, int(x0 - w * s['pad_x'])), max(0, int(y0 - h * s['pad_top'])), min(W, int(x1 + w * s['pad_x'])), min(H, int(y1 + h * below)))


def signature(rgb, box, cfg):
    """Colour histogram (Lab a/b plane, coloured pixels only, lightly smoothed) + Sobel edge map of the character crop.
    White, grey and pale backgrounds have almost no chroma and stay out of the histogram."""
    s = cfg['similarity']
    x0, y0, x1, y1 = box
    crop = Image.fromarray((rgb[y0:y1, x0:x1] * 255).astype(np.uint8))
    small = np.asarray(crop.resize((64, 80), Image.BILINEAR), dtype=np.float64) / 255.0
    lab = srgb_to_lab(small)
    c = np.hypot(lab[..., 1], lab[..., 2])
    sel = c > s['hist_min_chroma']
    hist, _, _ = np.histogram2d(lab[..., 1][sel], lab[..., 2][sel], bins=(10, 10), range=((-30, 90), (-60, 60)))
    hist = ndi.gaussian_filter(hist, s['hist_blur'])
    hist = hist / max(1e-9, hist.sum())
    g = np.asarray(crop.convert('L').resize((48, 60), Image.BILINEAR), dtype=np.float64) / 255.0
    edges = ndi.gaussian_filter(np.hypot(ndi.sobel(g, 0), ndi.sobel(g, 1)), cfg['similarity']['edge_blur'])  # tolerate small shifts
    return hist.ravel(), edges.ravel()


def corr(a, b):
    a, b = a - a.mean(), b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0


def similarity(sig, ref_sig, cfg):
    s = cfg['similarity']
    hc = float(np.sqrt(sig[0] * ref_sig[0]).sum())  # Bhattacharyya coefficient: 1 = same colour mix, 0 = no overlap
    ec = max(0.0, corr(sig[1], ref_sig[1]))
    return s['w_hist'] * hc + s['w_edges'] * ec, hc, ec


def expectations(expect):
    e = dict(expect or {})
    view = e.get('view', 'front')
    if view not in ('front', 'three_quarter', 'back', 'top'):
        raise ValueError(f'expect.view must be front, three_quarter, back or top (got {view!r})')
    e['view'] = view
    e.setdefault('ball_visible', True)
    e.setdefault('screen_visible', view in ('front', 'three_quarter', 'top'))
    e.setdefault('eyes_visible', e['screen_visible'])
    e.setdefault('body_visible', view != 'top')
    e.setdefault('ears_check', view != 'top')
    return e


def analyse(path, ref_sig, cfg, expect):
    e = expectations(expect)
    pal = cfg['palette']
    rgb, lab = load(path, cfg['work_size'])
    H, W = lab.shape[:2]
    area = H * W
    checks, notes = [], []
    skip = lambda name, target, why: check(checks, name, None, target, True, skipped=True, note=why)

    # 1. screen + head box
    scr, _, n_screens = find_screen(lab, cfg, area)
    head = None
    if e['screen_visible']:
        check(checks, 'screen_found', bool(scr), 'a dark raspberry screen region', bool(scr))
        if scr:
            head, method = head_box(lab, scr, cfg)
            notes.append(f'head box from {method}: {head}')
    else:
        no_scr = scr is None or e['view'] != 'back'
        if e['view'] == 'back':
            check(checks, 'no_screen_on_back_view', scr is None, 'no screen visible from behind', scr is None)
        else:
            skip('screen_found', 'a dark raspberry screen region', 'expect.screen_visible = false')
        _ = no_scr

    # 2. eyes (inside the screen box) and forbidden blue/cyan eyes
    if scr:
        sx0, sy0, sx1, sy1 = scr['x0'], scr['y0'], scr['x1'], scr['y1']
        sub = lab[sy0:sy1, sx0:sx1]
        sub_area = sub.shape[0] * sub.shape[1]
        eye_mask = nearest_de(sub, pal['eyes']) < cfg['eyes']['max_de_px']
        eyes, _ = components(eye_mask, sub_area * cfg['eyes']['min_area_frac'])
        if e['eyes_visible']:
            check(checks, 'eye_count', len(eyes), 2, len(eyes) == 2)
        else:
            skip('eye_count', 2, 'expect.eyes_visible = false')
        c, h = chroma_hue(sub)
        # Lab hue angle: blue sits around -55..-100 degrees, cyan around -160..-180 / 160..180 (the pink eyes are near -15).
        blue = (c > cfg['forbidden']['blue_min_chroma']) & ((h < -50) | (h > 160)) & (sub[..., 0] > cfg['forbidden']['blue_min_L'])
        blue_frac = float(blue.sum()) / max(1, sub_area)
        check(checks, 'no_blue_cyan_eyes', rnd(blue_frac, 4), f"< {cfg['forbidden']['blue_max_frac']} of the screen", blue_frac < cfg['forbidden']['blue_max_frac'])
        scr_lab = np.median(sub[ndi.binary_erosion(np.ones(sub.shape[:2], bool), iterations=3) & (sub[..., 0] < cfg['screen']['max_L'])], 0) \
            if (sub[..., 0] < cfg['screen']['max_L']).any() else None
        if scr_lab is not None:
            d = float(de76(scr_lab, hex_lab(pal['screen'])))
            check(checks, 'screen_colour_de', rnd(d, 1), f"<= {cfg['drift']['screen_max_de']} vs {pal['screen']} (got {lab_hex(scr_lab)})", d <= cfg['drift']['screen_max_de'])
        if eyes and e['eyes_visible']:
            em = np.median(sub[eye_mask], 0)
            d = float(nearest_de(em, pal['eyes']))
            check(checks, 'eye_colour_de', rnd(d, 1), f"<= {cfg['drift']['eyes_max_de']} vs {'/'.join(pal['eyes'])} (got {lab_hex(em)})", d <= cfg['drift']['eyes_max_de'])

    # 3. the red notification ball
    balls, _ = find_balls(lab, cfg, area)
    if head is not None:
        hx0, hy0, hx1, hy1 = head
        hw, hh = hx1 - hx0, hy1 - hy0
        # Only red regions in or near the head count as "the ball" (props elsewhere are not the hero).
        near = [b for b in balls if hx0 - hw * 0.5 <= b['cx'] <= hx1 + hw * 0.5 and hy0 - hh * 0.6 <= b['cy'] <= hy1 + hh * 0.2]
        others = len(balls) - len(near)
        if others:
            notes.append(f'{others} other red region(s) away from the head were ignored')
        balls_counted = near
    else:
        hw = hh = None
        balls_counted = balls
    if head is not None:
        # One hero per frame: a second ball-sized red sphere or a second screen anywhere means a second hero
        # (a turnaround sheet, a doubled character). Small red props (candy) are below the ball size range.
        lo = cfg['ball']['size_vs_head'][0]
        big_red = [b for b in balls if 2 * np.sqrt(b['area'] / np.pi) >= lo * hw]
        screens = n_screens_big(lab, cfg, area, scr)
        check(checks, 'one_hero_only', {'ball_sized_red': len(big_red), 'screens': screens}, 'at most 1 ball-sized red sphere and 1 screen in the frame',
              len(big_red) <= 1 and screens <= 1)
    if e['ball_visible']:
        check(checks, 'red_ball_count', len(balls_counted), 1, len(balls_counted) == 1)
    else:
        skip('red_ball_count', 1, 'expect.ball_visible = false')
    if balls_counted and e['ball_visible']:
        b = balls_counted[0]
        diam = 2 * np.sqrt(b['area'] / np.pi)
        _, blab = find_balls(lab, cfg, area)
        bcol = np.median(lab[blab & (lab[..., 0] > 30)], 0) if (blab & (lab[..., 0] > 30)).any() else None
        if bcol is not None:
            d = float(de76(bcol, hex_lab(pal['ball'])))
            check(checks, 'ball_colour_de', rnd(d, 1), f"<= {cfg['drift']['ball_max_de']} vs {pal['ball']} (got {lab_hex(bcol)})", d <= cfg['drift']['ball_max_de'])
        if head is not None:
            rel = diam / hw
            lo, hi = cfg['ball']['size_vs_head']
            check(checks, 'ball_size_vs_head', rnd(rel), f'{lo}-{hi} of head width (bible ~0.22)', lo <= rel <= hi)
            u, v = (b['cx'] - hx0) / hw, (b['cy'] - hy0) / hh
            if e['view'] == 'top':
                skip('ball_position', 'top-right corner of the head', 'expect.view = top')
            else:
                want_right = e['view'] != 'back'
                p = cfg['ball']['position']
                ok_x = u >= p['min_u'] if want_right else u <= 1 - p['min_u']
                ok_y = v <= p['max_v']
                check(checks, 'ball_position', {'u': rnd(u, 2), 'v': rnd(v, 2)},
                      f"{'top-right' if want_right else 'top-left (back view)'}: u {'>=' if want_right else '<='} {p['min_u'] if want_right else round(1 - p['min_u'], 2)}, v <= {p['max_v']}",
                      ok_x and ok_y)
        else:
            skip('ball_position', 'top-right corner of the head', 'no head box (screen not visible)')

    # 4. head colour, body, side ears (need the head box)
    if head is not None:
        hx0, hy0, hx1, hy1 = [int(v) for v in head]
        hx0c, hy0c, hx1c, hy1c = max(0, hx0), max(0, hy0), min(W, hx1), min(H, hy1)
        region = lab[hy0c:hy1c, hx0c:hx1c]
        not_screen = np.ones(region.shape[:2], bool)
        if scr:
            not_screen[max(0, scr['y0'] - hy0c):scr['y1'] - hy0c, max(0, scr['x0'] - hx0c):scr['x1'] - hx0c] = False
        bez = region[not_screen & (region[..., 0] > cfg['head']['bezel_min_L'])]
        if len(bez):
            hc = np.median(bez, 0)
            d = float(nearest_de(hc, pal['head']))
            check(checks, 'head_colour_de', rnd(d, 1), f"<= {cfg['drift']['head_max_de']} vs {'/'.join(pal['head'])} (got {lab_hex(hc)})", d <= cfg['drift']['head_max_de'])
        # body: pink below the head
        if e['body_visible']:
            by0, by1 = max(0, hy1 - int(hh * 0.05)), min(H, hy1 + int(hh * cfg['body']['search_below']))
            bx0, bx1 = max(0, hx0 - int(hw * 0.1)), min(W, hx1 + int(hw * 0.1))
            reg = lab[by0:by1, bx0:bx1]
            pink = nearest_de(reg, pal['body']) < cfg['body']['max_de_px'] if reg.size else np.zeros((0, 0), bool)
            frac = float(pink.sum()) / max(1, hw * hh)
            check(checks, 'body_pink_area_vs_head', rnd(frac), f">= {cfg['body']['min_frac_of_head']} of the head area", frac >= cfg['body']['min_frac_of_head'])
            if pink.sum():
                bc = np.median(reg[pink], 0)
                d = float(nearest_de(bc, pal['body']))
                check(checks, 'body_colour_de', rnd(d, 1), f"<= {cfg['drift']['body_max_de']} vs {'/'.join(pal['body'])} (got {lab_hex(bc)})", d <= cfg['drift']['body_max_de'])
        else:
            skip('body_pink_area_vs_head', f">= {cfg['body']['min_frac_of_head']} of the head area", 'expect.body_visible = false')
        # side ears: outlined grey/white discs just outside the head's left and right edges, at head height
        if e['ears_check']:
            ear = cfg['ears']
            vals, sizes = [], []
            # A side ear is a grey blob glued to the head's side: it touches the head edge and is enclosed within the
            # head's height band. Backgrounds, phone frames and mugs run past the band and are ignored.
            band_y0, band_y1 = max(0, hy0 - int(hh * ear['band_pad'])), min(H, hy1 + int(hh * ear['band_pad']))
            for side in ('left', 'right'):
                if side == 'left':
                    x_a, x_b = max(0, hx0 - int(hw * ear['strip_w'])), max(0, hx0)
                else:
                    x_a, x_b = min(W, hx1), min(W, hx1 + int(hw * ear['strip_w']))
                win = lab[band_y0:band_y1, x_a:x_b]
                if win.size == 0 or win.shape[1] < 3:
                    vals.append(0)
                    sizes.append(0.0)
                    continue
                c, _ = chroma_hue(win)
                grey = (win[..., 0] > ear['grey_L'][0]) & (win[..., 0] < ear['grey_L'][1]) & (c < ear['grey_max_chroma'])
                comps, labels = components(grey, hw * hh * ear['min_area_frac_head'])
                inner = win.shape[1] - 1 if side == 'left' else 0
                touch = int(max(2, hw * ear['touch_max']))
                n, biggest = 0, 0.0
                for k in comps:
                    if k['y0'] <= 0 or k['y1'] >= win.shape[0]:
                        continue  # runs past the head band: background or a prop
                    near_edge = (k['x1'] - 1 >= inner - touch) if side == 'left' else (k['x0'] <= inner + touch)
                    outer_hit = k['x0'] <= 0 if side == 'left' else k['x1'] >= win.shape[1]
                    if not near_edge or outer_hit:
                        continue  # an ear is a small disc inside the strip; a region filling it is background or a prop
                    kh, kw = k['y1'] - k['y0'], k['x1'] - k['x0']
                    if kh < hh * ear['min_height_vs_head'] or kh < kw * ear['min_aspect_h_over_w']:
                        continue  # flat or short: a table edge or a mug rim, not a disc on the head side
                    n += 1
                    biggest = max(biggest, k['area'] / (hw * hh))
                vals.append(n)
                sizes.append(biggest)
            skip_side = None
            if e['view'] == 'three_quarter':
                skip_side = 0 if sizes[0] >= sizes[1] else 1  # the head's own side panel shows on one side
                notes.append(f"three-quarter view: the {('left', 'right')[skip_side]} side is the head's own side panel and is ignored")
            worst = max(v for i, v in enumerate(vals) if i != skip_side)
            check(checks, 'no_side_ears', {'left': vals[0], 'right': vals[1], 'largest_vs_head': rnd(max(sizes))},
                  'no grey blob glued to a side of the head', worst == 0)
        else:
            skip('no_side_ears', 'nothing attached to the head sides', 'expect.ears_check = false')

    # 5. similarity to the reference (character crop)
    if head is not None and ref_sig is not None:
        body = bool(e['body_visible'])
        box = crop_box(head, lab.shape, cfg, body=body)
        sim, hc, ec = similarity(signature(rgb, box, cfg), ref_sig[body], cfg)
        check(checks, 'similarity_to_reference', rnd(sim), f">= {cfg['similarity']['min_score']} (colour histogram {rnd(hc, 2)}, edges {rnd(ec, 2)}; {'head and body' if body else 'head only'})", sim >= cfg['similarity']['min_score'])
        score = sim
    else:
        score = None
        if e['screen_visible']:
            check(checks, 'similarity_to_reference', None, f">= {cfg['similarity']['min_score']}", False, note='no character crop (screen not found)')
        else:
            skip('similarity_to_reference', f">= {cfg['similarity']['min_score']}", 'no head box when the screen is hidden')
    if n_screens > 1:
        notes.append(f'{n_screens} screen-like regions found (more than one character or a dark prop?)')
    counted = [c for c in checks if not c.get('skipped')]
    passed = all(c['pass'] for c in counted) and bool(counted)
    failed = [c['name'] for c in counted if not c['pass']]
    if failed:
        notes.insert(0, 'failed: ' + ', '.join(failed))
    if any(c.get('skipped') for c in checks):
        notes.append('skipped: ' + ', '.join(c['name'] for c in checks if c.get('skipped')))
    return {'pass': passed, 'score': None if score is None else rnd(score), 'checks': checks, 'notes': notes, 'expect': e}


def reference_signature(ref_path, cfg):
    """Signatures of the reference: {True: head and body, False: head only}."""
    rgb, lab = load(ref_path, cfg['work_size'])
    scr, _, _ = find_screen(lab, cfg, lab.shape[0] * lab.shape[1])
    if not scr:
        raise RuntimeError('no screen found in the reference image')
    head, _ = head_box(lab, scr, cfg)
    return {body: signature(rgb, crop_box(head, lab.shape, cfg, body=body), cfg) for body in (True, False)}


def sample_frames(video, ffmpeg, ffprobe, fractions, tmp):
    out = subprocess.run([ffprobe, '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', video],
                         capture_output=True, text=True, timeout=60)
    try:
        dur = float(out.stdout.strip())
    except ValueError:
        raise RuntimeError(f'ffprobe could not read the duration: {out.stderr.strip()[:200]}')
    frames = []
    for i, frac in enumerate(fractions):
        t = dur * min(0.98, max(0.0, float(frac)))
        dst = os.path.join(tmp, f'frame{i}.png')
        r = subprocess.run([ffmpeg, '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', video, '-frames:v', '1', dst], capture_output=True, text=True, timeout=120)
        if r.returncode != 0 or not os.path.exists(dst):
            raise RuntimeError(f'ffmpeg could not extract a frame at {t:.2f} s: {r.stderr.strip()[:200]}')
        frames.append((round(t, 2), dst))
    return frames


def main():
    req = json.loads(sys.stdin.read())
    cfg, path = req['config'], req['input']
    ref_sig = reference_signature(req['reference'], cfg)
    ext = os.path.splitext(path)[1].lower()
    if ext in IMAGE_EXTS:
        res = analyse(path, ref_sig, cfg, req.get('expect'))
        res['kind'] = 'image'
    elif ext == '.mp4':
        tmp = tempfile.mkdtemp(prefix='studio-continuity-')
        try:
            n = int(cfg.get('video_frames', 3))
            # expect.sample_at (fractions of the clip, e.g. [0.1, 0.4] when the hero hides at the end) overrides the default spread
            fractions = (req.get('expect') or {}).get('sample_at') or [0.15 + 0.7 * i / max(1, n - 1) for i in range(n)]
            frames = sample_frames(path, req['ffmpeg'], req['ffprobe'], fractions[:5], tmp)
            per = [(t, analyse(f, ref_sig, cfg, req.get('expect'))) for t, f in frames]
        finally:
            shutil.rmtree(tmp, ignore_errors=True)  # our own temp folder only
        scores = [r['score'] for _, r in per if r['score'] is not None]
        worst_t, worst = min(per, key=lambda tr: (tr[1]['pass'], tr[1]['score'] if tr[1]['score'] is not None else -1))
        res = {'pass': all(r['pass'] for _, r in per), 'score': min(scores) if len(scores) == len(per) else None,
               'checks': worst['checks'], 'notes': [f'worst frame at {worst_t} s decides'] + worst['notes'], 'expect': worst['expect'], 'kind': 'video',
               'frames': [{'t': t, 'pass': r['pass'], 'score': r['score'], 'failed': [c['name'] for c in r['checks'] if not c['pass']]} for t, r in per]}
    else:
        raise ValueError(f'unsupported file type {ext}')
    print(json.dumps(res))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:  # one clear line for the caller
        log(f'continuity check failed: {exc}')
        sys.exit(1)
