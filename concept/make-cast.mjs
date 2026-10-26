// Faceless Studio: candidate character sheets for a concept's cast, each one shown to the owner before use. Everything is written to
// concept/<id>/cast/<member>/_candidats/: castSheet() (core/concept.mjs) never reads that folder, so nothing changes in production
// until the owner picks a candidate and it is copied under its real name.
//   node --no-warnings concept/make-cast.mjs hero    [concept]          FIRST: the hero's three front views from hero_lock (ComfyUI,
//                                                                       3 candidates each: closeup-front, waist-front, full-front)
//   node --no-warnings concept/make-cast.mjs layouts [concept]          hero framings with free space for the scene's object (ffmpeg)
//   node --no-warnings concept/make-cast.mjs poses   [concept]          hero poses: sitting, walking, back, three-quarter, profile (ComfyUI)
//   node --no-warnings concept/make-cast.mjs members [concept] [ids…]   turnaround sheets for members without one (ComfyUI, 2 each)
//   node --no-warnings concept/make-cast.mjs contact [concept]          one contact sheet per member, to show the owner
// Why "layouts": img2img from the hero sheet (concept.json image.use_sheet) keeps the hero identical but keeps the sheet's
// composition too, so the scene's main object had no room and was dropped (seen in rehearsals). A layout sheet is the
// SAME hero picture, reduced and moved to one side by ffmpeg (pixels unchanged), leaving a plain area where the object gets drawn.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { loadConcept } from '../core/concept.mjs';
import { FFMPEG } from '../core/qc/qc.mjs';
import { comfyReady, img2imgGraph, keyframeGraph, runGraph, uploadImage } from '../workshop/comfy.mjs';

const W = 1088, H = 1920;
const WIDE = { width: 1664, height: 928 };
// The hero keeps this share of the frame width; the rest is room for the object. 0.68 left the hero small at the bottom of the
// frame (a trial), and the hero must not look far away: 0.8 by default.
const LAYOUT_SCALE = Number(process.env.STUDIO_LAYOUT_SCALE) || 0.8;
// "paper" (default) = the sheet's own paper colour, seamless. "room" = a warm wall-to-floor gradient with the paper keyed out: tried
// and dropped, the key also removed the hero's white shoes and the object (kept only as an option).
const LAYOUT_BG_MODE = process.env.STUDIO_LAYOUT_BG || 'paper';
const LAYOUT_BG = '0xF4EFE6';   // warm cream, close to the sheets' paper; img2img repaints it as the scene's place
// 0.72 kept the sheet's pose untouched (every "pose" came back front and standing); 0.88 by default.
const POSE_DENOISE = Number(process.env.STUDIO_POSE_DENOISE) || 0.88;
const POSES = [
  { file: 'sitting-waist', from: 'waist-front', scene: 'medium shot cropped at the waist, sitting on a simple wooden chair, hands resting on the knees' },
  { file: 'walking-full', from: 'full-front', scene: 'full body shot, walking to the left in profile, one foot forward, arms relaxed' },
  { file: 'full-back', from: 'full-front', scene: 'full body shot seen from the back, the back of the head and of the outfit' },
  { file: 'full-three-quarter', from: 'full-front', scene: 'full body shot, three-quarter view turned to the right, standing, arms relaxed' },
  { file: 'waist-profile', from: 'waist-front', scene: 'medium shot cropped at the waist, side view facing left, calm face' },
];

const ff = (args) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, timeout: 120_000 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${String(r.stderr ?? '').slice(-300)}`);
};
/** "0xRRGGBB" of a picture's top-left pixel (ffmpeg raw RGB), or null. */
function paperColour(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'crop=1:1:8:8', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { windowsHide: true, timeout: 60_000 });
  if (r.status !== 0 || !r.stdout || r.stdout.length < 3) return null;
  return `0x${[...r.stdout.subarray(0, 3)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
const memberDir = (c, id) => path.join(c.dir, 'cast', id);
const candDir = (c, id) => { const d = path.join(memberDir(c, id), '_candidats'); mkdirSync(d, { recursive: true }); return d; };

/** Hero reduced to LAYOUT_SCALE and moved to the right (space left) or mirrored to the left (space right), pixels kept. */
function layouts(c) {
  const out = candDir(c, c.hero);
  const w = Math.round((W * LAYOUT_SCALE) / 2) * 2, h = Math.round((H * LAYOUT_SCALE) / 2) * 2;
  for (const framing of ['closeup', 'waist', 'full']) {
    const src = path.join(memberDir(c, c.hero), `${framing}-front.png`);
    if (!existsSync(src)) { console.log(`layouts: ${framing}-front.png missing, skipped`); continue; }
    // Bottom-aligned so the hero stands on the frame's floor; the free side is a full-height band for the object. The canvas takes
    // the sheet's own paper colour (its top-left pixel), so no seam shows between the picture and the free band.
    const bg = paperColour(src) ?? LAYOUT_BG;
    // "room": a vertical gradient wall-to-floor; the hero's own paper is keyed out around her so the gradient shows behind her too.
    const canvas = LAYOUT_BG_MODE === 'room'
      ? ['-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=0xE8DCC8:c1=0xA89A88:x0=0:y0=0:x1=0:y1=${H}:nb_colors=2,format=rgb24`]
      : ['-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}`];
    const key = LAYOUT_BG_MODE === 'room' ? `,colorkey=${bg}:0.08:0.08` : '';
    ff([...canvas, '-i', src, '-filter_complex', `[1:v]scale=${w}:${h}${key}[p];[0:v][p]overlay=${W - w}:${H - h}`, '-frames:v', '1', path.join(out, `${framing}-front-space-left.png`)]);
    ff([...canvas, '-i', src, '-filter_complex', `[1:v]scale=${w}:${h},hflip${key}[p];[0:v][p]overlay=0:${H - h}`, '-frames:v', '1', path.join(out, `${framing}-front-space-right.png`)]);
    console.log(`layouts: ${framing} done (space left and right)`);
  }
}

/** The hero's three required front views (core/concept.mjs REQUIRED_HERO_VIEWS), drawn from text (hero_lock, palette, style) on a
 *  plain paper background: 3 candidates per framing in _candidats/, the owner picks one of each, copied as <framing>-front.png. */
async function hero(c) {
  if (!(await comfyReady())) throw new Error('ComfyUI is not running on 127.0.0.1:8188');
  const out = candDir(c, c.hero);
  for (const [k, framing] of ['closeup', 'waist', 'full'].entries()) {
    for (const seed of [0, 1, 2].map((s) => c.image.seed_base + 300 + k * 10 + s)) {
      const prompt = `${c.prompt.framing[framing]}, standing, front view, facing the viewer, arms relaxed, ${c.hero_lock}, ${c.prompt.always ?? ''}, plain light paper background, nothing else in the frame, ${c.palette}, ${c.style}`;
      const t = Date.now();
      await runGraph(await keyframeGraph({ prompt, seed, width: W, height: H, steps: c.image.steps, prefix: `faceless/cast-${c.hero}-${framing}-front` }), path.join(out, `${framing}-front-${seed}.png`));
      console.log(`hero: ${framing}-front seed ${seed} in ${Math.round((Date.now() - t) / 1000)} s`);
    }
  }
  console.log(`hero: candidates in ${out}; copy the chosen one of each framing to ${memberDir(c, c.hero)}/<framing>-front.png`);
}

async function poses(c) {
  if (!(await comfyReady())) throw new Error('ComfyUI is not running on 127.0.0.1:8188');
  const out = candDir(c, c.hero);
  for (const [k, p] of POSES.entries()) {
    const src = path.join(memberDir(c, c.hero), `${p.from}.png`);
    if (!existsSync(src)) { console.log(`poses: ${p.from}.png missing, ${p.file} skipped`); continue; }
    const image = await uploadImage(src);
    for (const seed of [c.image.seed_base + 500 + k * 10, c.image.seed_base + 501 + k * 10]) {
      const prompt = `${p.scene}, ${c.hero_lock}, ${c.prompt.always ?? ''}, plain light paper background, ${c.palette}, ${c.style}`;
      const t = Date.now();
      await runGraph(await img2imgGraph({ image, prompt, seed, denoise: POSE_DENOISE, steps: c.image.steps, prefix: `faceless/cast-${c.hero}-${p.file}` }), path.join(out, `${p.file}-${seed}.png`));
      console.log(`poses: ${p.file} seed ${seed} in ${Math.round((Date.now() - t) / 1000)} s`);
    }
  }
}

async function members(c, ids) {
  if (!(await comfyReady())) throw new Error('ComfyUI is not running on 127.0.0.1:8188');
  const todo = Object.entries(c.cast.members).filter(([id, m]) => id !== c.hero && (ids.length ? ids.includes(id) : !m.sheet));
  for (const [i, [id, m]] of todo.entries()) {
    const out = candDir(c, id);
    for (const seed of [c.image.seed_base + 700 + i * 10, c.image.seed_base + 701 + i * 10]) {
      const prompt = `${m.lock}, character turnaround sheet, the same adult character shown three times: front view, three-quarter view and side view, standing, arms relaxed, plain light paper background, ${c.palette}, ${c.style}`;
      const t = Date.now();
      await runGraph(await keyframeGraph({ prompt, seed, ...WIDE, steps: c.image.steps, prefix: `faceless/cast-${id}` }), path.join(out, `sheet-${seed}.png`));
      console.log(`members: ${id} seed ${seed} in ${Math.round((Date.now() - t) / 1000)} s`);
    }
  }
}

/** One JPEG per member with every candidate side by side (thumbnails 360 px high), for the owner. */
function contact(c) {
  for (const id of Object.keys(c.cast.members)) {
    const d = path.join(memberDir(c, id), '_candidats');
    if (!existsSync(d)) continue;
    const files = readdirSync(d).filter((f) => /\.png$/.test(f)).sort();
    if (!files.length) continue;
    const inputs = files.flatMap((f) => ['-i', path.join(d, f)]);
    const scaled = files.map((_, k) => `[${k}:v]scale=-2:360,pad=iw+12:372:6:6:white[s${k}]`).join(';');
    const joined = files.length === 1 ? '[s0]copy[o]' : `${files.map((_, k) => `[s${k}]`).join('')}hstack=inputs=${files.length}[o]`;
    ff([...inputs, '-filter_complex', `${scaled};${joined}`, '-map', '[o]', '-frames:v', '1', '-q:v', '3', path.join(d, 'planche-contact.jpg')]);
    console.log(`contact: ${id} (${files.length} candidate(s)) -> ${path.join(d, 'planche-contact.jpg')}`);
  }
}

async function main() {
  const [cmd, conceptId, ...ids] = process.argv.slice(2);
  const c = loadConcept(conceptId && !conceptId.startsWith('-') ? conceptId : undefined);
  if (cmd === 'hero') return hero(c);
  if (cmd === 'layouts') return layouts(c);
  if (cmd === 'poses') return poses(c);
  if (cmd === 'members') return members(c, ids);
  if (cmd === 'contact') return contact(c);
  throw new Error('usage: make-cast.mjs hero|layouts|poses|members|contact [concept] [member ids…]');
}

main().catch((e) => { console.error(`make-cast failed: ${e.message}`); process.exitCode = 1; });
