# Faceless Studio: the hero of a cast sheet kept pixel for pixel inside a painted scene (the same hero
# AND a rich place). Called by workshop/story/make-short.mjs when concept.json image.paint_around is true.
#   sheet_scene.py prepare <sheet.png> <layout.png> <repaint.png> <keep.png> <scale>
#       the sheet reduced to <scale> and set bottom-right on its own paper colour: a free band on the left for the line's main object
#       (on centred pose sheets the hero filled 60-70 % of the width and the object was drawn behind the hero,
#       then covered when the hero was pasted back; the clarity check set the video aside), then the masks below of that layout.
#   sheet_scene.py mask   <sheet.png> <repaint.png> <keep.png>
#       repaint.png: white = the sheet's plain paper around the hero (painted as the scene by ComfyUI), grown 4 px over her outline;
#       keep.png: white = the hero, soft edge. The paper is the border's median colour; only paper connected to the border counts, so
#       light parts inside the hero (white sneakers, a white collar) stay hers (a global colour key removed them, night of 24-25/10).
#       A LARGE patch of paper enclosed by the hero and her floor shadow (between the legs of the back view) is paper again.
#   sheet_scene.py paste  <painted.png> <sheet.png> <keep.png> <out.png>
#       the hero of the sheet pasted back over the painted scene through keep.png.
# Runs with ComfyUI's own Python (numpy, scipy, Pillow), started with -I.
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

PAPER_TOL = 16          # max channel distance to the paper colour
MIN_PART = 3000         # hero parts smaller than this (paper specks) are dropped
ENCLOSED_PAPER = 0.0045  # share of the frame above which enclosed paper is paper (back view: 15 444 px; sneakers at most 6 470 px)
GROW_PX = 4             # the painted area covers the outline's soft edge
CUT_BAND = 60           # px of the hero painted along a cut border shown inside the frame (see prepare)
EDGE_NEAR = 16          # the hero "touches" the left border within this many px (the 21/10 close-up stops 7 px short)
EDGE_BLUR = 1.2         # softness of the pasted hero's edge


def paper_of(im):
    border = np.concatenate([im[0], im[-1], im[:, 0], im[:, -1]])
    return np.median(border, axis=0)


def layout(src, out, scale):
    s = Image.open(src).convert('RGB')
    w, h = s.size
    paper = tuple(int(v) for v in paper_of(np.asarray(s).astype(np.int16)))
    small = s.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    canvas = Image.new('RGB', (w, h), paper)
    canvas.paste(small, (w - small.width, h - small.height))
    canvas.save(out)


def touches_left(src):
    """True when the hero of the sheet reaches its left border (the close-up's shoulders): once the sheet is reduced and set
    bottom-right, that straight cut shows inside the frame (r-20261025-1518 scene 1: a ragged coat edge)."""
    im = np.asarray(Image.open(src).convert('RGB')).astype(np.int16)
    rows = (np.abs(im[:, :EDGE_NEAR] - paper_of(im)).max(axis=2) > PAPER_TOL).any(axis=1)
    return rows.mean() > 0.02


def prepare(src, out_layout, out_repaint, out_keep, scale):
    """layout, then mask; when the hero touched the left border, a band of her along the cut is painted too, so the model
    continues the coat instead of leaving the cut."""
    layout(src, out_layout, scale)
    w = Image.open(src).size[0]
    mask(out_layout, out_repaint, out_keep, cut_x=w - round(w * scale) if touches_left(src) and scale < 1 else None)


def mask(src, out_repaint, out_keep, cut_x=None):
    im = np.asarray(Image.open(src).convert('RGB')).astype(np.int16)
    paper = paper_of(im)
    paperlike = np.abs(im - paper).max(axis=2) <= PAPER_TOL
    labels, _ = ndimage.label(paperlike)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    hero = ndimage.binary_fill_holes(~np.isin(labels, edge[edge > 0]))
    enclosed, n = ndimage.label(hero & paperlike)
    if n:
        sizes = ndimage.sum(np.ones(enclosed.shape), enclosed, range(1, n + 1))
        hero &= ~np.isin(enclosed, [i + 1 for i, s in enumerate(sizes) if s >= ENCLOSED_PAPER * hero.size])
    parts, n = ndimage.label(hero)
    if n:
        sizes = ndimage.sum(hero, parts, range(1, n + 1))
        hero = np.isin(parts, [i + 1 for i, s in enumerate(sizes) if s >= MIN_PART])
    if hero.mean() < 0.02:
        raise SystemExit(f'no hero found on {src} (paper {paper.tolist()})')
    if cut_x is not None:
        hero[:, :cut_x + CUT_BAND] = False
    Image.fromarray((ndimage.binary_dilation(~hero, iterations=GROW_PX) * 255).astype(np.uint8)).save(out_repaint)
    keep = Image.fromarray((ndimage.binary_erosion(hero, iterations=1) * 255).astype(np.uint8))
    keep.filter(ImageFilter.GaussianBlur(EDGE_BLUR)).save(out_keep)
    print(f'hero {hero.mean():.3f} of the frame')


def paste(painted, sheet, keep, out):
    p = Image.open(painted).convert('RGB')
    s = Image.open(sheet).convert('RGB').resize(p.size, Image.LANCZOS)
    a = np.asarray(Image.open(keep).convert('L').resize(p.size, Image.BILINEAR)).astype(np.float32)[..., None] / 255.0
    res = np.asarray(s).astype(np.float32) * a + np.asarray(p).astype(np.float32) * (1 - a)
    Image.fromarray(res.round().clip(0, 255).astype(np.uint8)).save(out)


if __name__ == '__main__':
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'prepare' and len(args) == 5 and 0.3 <= float(args[4]) <= 1:
        prepare(*args[:4], float(args[4]))
    elif cmd == 'mask' and len(args) == 3:
        mask(*args)
    elif cmd == 'paste' and len(args) == 4:
        paste(*args)
    else:
        raise SystemExit('usage: sheet_scene.py prepare <sheet> <layout> <repaint> <keep> <scale 0.3-1> | mask <sheet> <repaint> <keep> | paste <painted> <sheet> <keep> <out>')
