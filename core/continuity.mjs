// Faceless Studio: compare_to_reference. Runs workshop/continuity.py (CPU only, ComfyUI's embedded python with -I)
// on one keyframe or clip of media/<video_id>/, and saves the verdict to media/<video_id>/continuity/<file>.json
// through the continuity_checker write allowlist. Thresholds: brand/continuity.json. Used by the MCP tool and by hand:
//   node --no-warnings core/continuity.mjs <video_id> <path> ['{"view":"top"}']   (prints the verdict, saves nothing)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDIO_ROOT } from './db.mjs';
import { safePath } from './paths.mjs';
import { MediaError, resolveMediaBinary, writeMediaFile, readMediaFile } from './media-files.mjs';
import { COMFY_PY, FFMPEG as FFMPEG_BIN, FFPROBE as FFPROBE_BIN } from './local-config.mjs';

// Tool paths come from core/local-config.mjs (environment, config.local.json, or its defaults).
export const CV_PYTHON = process.env.STUDIO_CV_PYTHON || COMFY_PY;
export const FFMPEG = FFMPEG_BIN;
export const FFPROBE = FFPROBE_BIN;
const CHECKER = path.join(STUDIO_ROOT, 'workshop', 'continuity.py');
const TIMEOUT_MS = 180_000;
const MAX_OUTPUT = 1024 * 1024;

export const VIEWS = ['front', 'three_quarter', 'back', 'top'];
const EXPECT_BOOLS = ['ball_visible', 'screen_visible', 'eyes_visible', 'body_visible', 'ears_check'];

/** Validates a per-shot expect override: {view, ball_visible, screen_visible, eyes_visible, body_visible, ears_check, sample_at}. */
export function checkExpect(e) {
  if (e === undefined || e === null) return {};
  if (typeof e !== 'object' || Array.isArray(e)) throw new MediaError('expect must be an object');
  const out = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'view') {
      if (!VIEWS.includes(v)) throw new MediaError(`expect.view must be one of ${VIEWS.join(', ')}`);
      out.view = v;
    } else if (EXPECT_BOOLS.includes(k)) {
      if (typeof v !== 'boolean') throw new MediaError(`expect.${k} must be true or false`);
      out[k] = v;
    } else if (k === 'sample_at') {
      if (!Array.isArray(v) || !v.length || v.length > 5 || !v.every((x) => typeof x === 'number' && x >= 0 && x <= 1)) throw new MediaError('expect.sample_at must be 1 to 5 numbers between 0 and 1 (fractions of the clip)');
      out.sample_at = v;
    } else {
      throw new MediaError(`expect.${k} is not a known override (known: view, ${EXPECT_BOOLS.join(', ')}, sample_at)`);
    }
  }
  return out;
}

/** The storyboard's expect for the shot named in the path (".../shot03/..." or "shot03-a.mp4" -> shots[n=3].expect). */
export function storyboardExpect(videoId, rel) {
  const m = /shot0*(\d{1,3})/i.exec(rel);
  if (!m) return {};
  let sb;
  try { sb = JSON.parse(readMediaFile({ video_id: videoId, path: 'storyboard.json' }).text); } catch { return {}; }
  const shot = (sb.shots ?? []).find((s) => s?.n === Number(m[1]));
  return shot?.expect && typeof shot.expect === 'object' ? shot.expect : {};
}

export function loadContinuityConfig(brandDir = 'brand') {
  const rel = `${brandDir}/continuity.json`;
  const abs = safePath(rel, { mustExist: true });
  let cfg;
  try { cfg = JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { throw new Error(`${rel} is not valid JSON: ${e.message}`); }
  const ref = safePath(`${brandDir}/${cfg.reference ?? 'references/hero-front.png'}`, { mustExist: true });
  return { cfg, ref };
}

function runChecker(request) {
  return new Promise((resolve, reject) => {
    if (!existsSync(CV_PYTHON)) return reject(new Error(`python not found at ${CV_PYTHON}`));
    // CPU only: no CUDA device is visible to the checker (a GPU render may be running).
    const child = spawn(CV_PYTHON, ['-I', '-X', 'utf8', CHECKER], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, cwd: STUDIO_ROOT, env: { ...process.env, CUDA_VISIBLE_DEVICES: '' } });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`continuity check timed out after ${TIMEOUT_MS / 1000} s`)); }, TIMEOUT_MS);
    child.stdout.on('data', (b) => { out += b; if (out.length > MAX_OUTPUT) { child.kill(); reject(new Error('checker output too large')); } });
    child.stderr.on('data', (b) => { err = (err + b).slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`continuity check failed: ${err.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('continuity checker printed invalid JSON')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

/** Where the verdict of media/<id>/<rel> is saved: continuity/<rel with "/" as "-">.json */
export const verdictPath = (rel) => `continuity/${rel.replace(/\//g, '-')}.json`;

/**
 * Measures one keyframe or clip against the reference. Returns the verdict; with save = true also writes it
 * (as continuity_checker) to media/<video_id>/continuity/<file>.json.
 */
export async function compareToReference({ video_id, path: p, expect, brandDir = 'brand', save = true }) {
  const media = resolveMediaBinary({ video_id, path: p });
  const fromStoryboard = checkExpect(storyboardExpect(media.id, media.rel));
  const exp = { ...fromStoryboard, ...checkExpect(expect) };
  const { cfg, ref } = loadContinuityConfig(brandDir);
  const r = await runChecker({ input: media.abs, reference: ref, config: cfg, expect: exp, ffmpeg: FFMPEG, ffprobe: FFPROBE });
  const verdict = {
    video_id: media.id, file: media.rel, kind: r.kind, at: new Date().toISOString(),
    verdict: r.pass ? 'pass' : 'block', pass: r.pass, score: r.score, checks: r.checks, notes: r.notes,
    expect: exp, expect_source: Object.keys(fromStoryboard).length ? (expect ? 'storyboard + tool call' : 'storyboard') : (expect ? 'tool call' : 'default (front view)'),
    ...(r.frames ? { frames: r.frames } : {}),
    thresholds: `${brandDir}/continuity.json`,
  };
  if (save) {
    const saved = writeMediaFile({ agent: 'continuity_checker', video_id: media.id, path: verdictPath(media.rel), content: JSON.stringify(verdict) });
    verdict.saved = saved.path;
  }
  return verdict;
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const [, , vid, rel, exp] = process.argv;
  const r = await compareToReference({ video_id: vid, path: rel, expect: exp ? JSON.parse(exp) : undefined, save: false });
  console.log(JSON.stringify(r, null, 2));
}
