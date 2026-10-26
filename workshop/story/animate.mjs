// Faceless Studio: real motion for 3 moments of a video (optional, Higgsfield; off by default).
// One Kling 3.0 Turbo image-to-video clip of 5 s per moment (opening, twist, ending), made from our own still through the
// Higgsfield CLI (your subscription credits; the CLI sends the start image with the job). Hard caps, checked before every job:
// 7.5 credits a clip (from `generate cost`), 22.5 a video, 45 a day (studio date). Every job is written to data/higgsfield-ledger.jsonl.
// If a cap is reached or a job fails, the scene keeps the free slow zoom (the caller falls back), so a video never waits for credits.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { STUDIO_ROOT } from '../../core/db.mjs';
import { studioDay } from '../../core/studio-time.mjs';

// Kling ("kling") was chosen after a comparison with Grok on the same scene: 7.5 credits a clip.
export const MODEL = 'kling3_0_turbo';
export const CLIP_CREDITS_MAX = 7.5;
export const VIDEO_CREDITS_MAX = 22.5;
export const DAY_CREDITS_MAX = 0; // 0 = off: no paid animation unless you raise this cap
const LEDGER = path.join(STUDIO_ROOT, 'data', 'higgsfield-ledger.jsonl');
const HIGGSFIELD = process.env.HIGGSFIELD_BIN || 'higgsfield';
const JOB_TIMEOUT_MS = 15 * 60_000;

/** The 3 animated moments: the opening, the twist (second-to-last scene, brand/playbook-story.md) and the ending. */
export const momentsOf = (count) => [...new Set([0, Math.max(0, count - 2), count - 1])];

const studioDayOf = (t = Date.now()) => studioDay(t); // the studio date (core/local-config.mjs TIMEZONE)
function ledger() {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}
export const spentToday = () => ledger().filter((e) => studioDayOf(Date.parse(e.at)) === studioDayOf()).reduce((n, e) => n + Number(e.credits || 0), 0);
export const spentOn = (videoId) => ledger().filter((e) => e.video_id === videoId).reduce((n, e) => n + Number(e.credits || 0), 0);

function cli(args) {
  return new Promise((resolve) => {
    const p = spawn(HIGGSFIELD, args, { windowsHide: true, shell: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); }, JOB_TIMEOUT_MS);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

// shell: true needs every argument quoted (prompts have spaces and commas).
const q = (s) => `"${String(s).replace(/"/g, "'")}"`;

/**
 * Makes one 5 s Kling clip of `still` and saves it to `dest` (an mp4 from Higgsfield, 720p 9:16).
 * Returns { ok: true, url, credits } or { ok: false, reason } (cap reached, cost too high, job failed): never throws.
 */
export async function motionClip({ videoId, scene, still, prompt, dest }) {
  if (DAY_CREDITS_MAX <= 0) return { ok: false, reason: 'Higgsfield off for the studio' };
  const cost = await cli(['generate', 'cost', MODEL, '--prompt', q('x'), '--aspect_ratio', '9:16', '--duration', '5']);
  const credits = Number(/([\d.]+)\s*credits?/i.exec(cost.out)?.[1]);
  if (!(credits > 0)) return { ok: false, reason: `cost unknown: ${cost.out.slice(0, 120)}` };
  if (credits > CLIP_CREDITS_MAX) return { ok: false, reason: `clip costs ${credits} > ${CLIP_CREDITS_MAX} credits` };
  if (spentOn(videoId) + credits > VIDEO_CREDITS_MAX) return { ok: false, reason: `video cap ${VIDEO_CREDITS_MAX} credits reached` };
  if (spentToday() + credits > DAY_CREDITS_MAX) return { ok: false, reason: `day cap ${DAY_CREDITS_MAX} credits reached` };
  const job = await cli(['generate', 'create', MODEL, '--prompt', q(prompt), '--start-image', q(still), '--aspect_ratio', '9:16', '--duration', '5', '--resolution', '720p', '--wait', '--wait-timeout', '12m', '--wait-interval', '10s']);
  const url = (job.out.match(/https:\/\/\S+\.mp4/g) ?? []).at(-1);
  // A job that came back with a result was charged; one that failed before is not, but is written down either way.
  appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), video_id: videoId, scene, model: MODEL, credits: url ? credits : 0, url: url ?? null, error: url ? null : job.out.slice(-200) }) + '\n');
  if (!url) return { ok: false, reason: `job failed: ${job.out.slice(-160)}` };
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) return { ok: false, reason: `download ${r.status}` };
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return { ok: true, url, credits };
}

const LOCK = 'Smooth, gentle, real-life speed. The same flat 2D storybook look, clean outlines and colours as the first frame throughout; the face, hair and outfit of the hero keep their exact shape.';

/** The prompt Higgsfield gets for one scene: the animator's detailed `motion` (brand/higgsfield-guide.md: beats, secondary
 *  motion, camera, lock line; only what moves, positive words), else a generic one built to the same norms from the line. */
export function motionPrompt(scene) {
  const motion = String(scene?.motion ?? '').trim();
  if (motion.length >= 60) return (motion.includes('keep their exact shape') ? motion : `${motion} ${LOCK}`).slice(0, 1200);
  return `0-2 s: she reacts to the moment with a clear, natural change of expression and a small head movement. 2-4 s: one small gesture that tells the line "${String(scene?.text ?? '').slice(0, 160)}", the main object of the scene answers with a little movement. 4-5 s: she holds the final pose, still. Secondary: the light shifts softly. Camera: slow push-in toward her face. ${LOCK}`;
}
