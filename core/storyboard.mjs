// Faceless Studio: storyboard.json shape (written by storyboard_artist through the MCP tool, read by workshop/pipeline.mjs).
//
// {
//   "video_id": "v-2026-10-21-01",
//   "title": "A short title",
//   "character": { "id": "hero", "prompt_prefix": "...", "seed": 4242 },   // fixed seed + prefix = same character every shot
//   "negative": "text, watermark, extra fingers",                           // optional
//   "voice": { "provider": "none", "text": "spoken words" },                 // provider is pluggable (cost step later)
//   "loop": true,                                                            // last shot = FLF closer ending on shot 1's pick
//   "shots": [ { "n": 1, "duration_s": 4, "verb": "vibrate", "keyframe_prompt": "...", "motion_prompt": "...",
//                "source": "new | still | reuse", "still": true, "negative": "...", "closer": true, "end_frame": { "shot": 1 } } ]
// }
//
// checkStoryboard(sb) = the shape every renderable storyboard needs (pipeline, video step, MCP).
// checkStoryboard(sb, { playbook: true }) adds the episode rules (the MCP tools write_storyboard and write_media_file use it):
//   8-9 shots; total 38-45 s; shots 3-5 s, the closer up to 6.5 s; the last shot is the closer (closer: true) with an FLF
//   end frame = the opening keyframe (storyboard loop: true, or end_frame {shot: 1}); one verb per shot from the
//   VERBS list; a shot that mentions a fingertip, paw or hand carries "human hand, fingers, morphing" in its negative;
//   no arms-raised shot unless it books 4 takes (arms morph in Wan).
// A storyboard built from a shot list (from_shotlist) is grandfathered and never gets the episode rules.
export const SHOT_MIN_S = 3;
export const SHOT_MAX_S = 5;
export const CLOSER_MAX_S = 6.5;
export const VIDEO_MIN_S = 5;
export const VIDEO_MAX_S = 60;
export const EPISODE_MIN_S = 38;
export const EPISODE_MAX_S = 45;
export const EPISODE_MIN_SHOTS = 8;
export const EPISODE_MAX_SHOTS = 9;
export const VOICE_PROVIDERS = ['none'];
export const SHOT_SOURCES = ['new', 'still', 'reuse'];
/** Single-action motion verbs that animate cleanly in Wan (one per shot); "tapped or flicked by a fingertip" also counts as either half. */
export const VERBS = Object.freeze([
  'hop in place', 'jolt up', 'tip over stiff', 'slide', 'belly-slide', 'sink', 'rise', 'sway', 'slow turn', 'vibrate',
  'slow crawl', 'stand still', 'tapped or flicked by a fingertip',
]);
const VERB_ALIASES = ['tapped by a fingertip', 'flicked by a fingertip'];
const verbKey = (v) => String(v).trim().toLowerCase().replace(/\s+/g, ' ');
const VERB_SET = new Set([...VERBS, ...VERB_ALIASES].map(verbKey));
/** The negative that keeps a fingertip, paw or hand from morphing in Wan. */
export const HAND_NEGATIVE = ['human hand', 'fingers', 'morphing'];
export const ARMS_UP_TAKES = 4;
const HANDY = /\b(finger\s*tips?|fingers?|paws?|hands?)\b/i;
const ARMS_UP = /\b(arms?|hands?)\s+(are\s+)?(raised|up|in the air|overhead|aloft)\b|\b(rais(e|es|ed|ing)|lift(s|ed|ing)?|throw(s|ing)?)\s+(up\s+)?(both\s+|his\s+|her\s+|their\s+|its\s+|one\s+)?(arms?|hands?)\b|\bvictory pose\b|\barms?-up\b/i;

/** The shot whose pick is this shot's last frame (FLF), or null; same rule as workshop/steps/wan.mjs flfEndShot. */
const flfEnd = (sb, shot) => (shot?.end_frame?.shot ? shot.end_frame.shot : (sb.loop && shot === sb.shots.at(-1) && sb.shots.length > 1 ? sb.shots[0].n : null));
const isCloser = (sb, s, i) => i === sb.shots.length - 1 && (s?.closer === true || flfEnd(sb, s) === sb.shots[0]?.n);
const negTerms = (...parts) => new Set(parts.filter((p) => typeof p === 'string').join(',').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));

/** Returns a list of problems (empty = valid). Pure. */
export function checkStoryboard(sb, { videoId, playbook = false } = {}) {
  const errs = [];
  if (!sb || typeof sb !== 'object' || Array.isArray(sb)) return ['storyboard must be a JSON object'];
  if (videoId && sb.video_id !== videoId) errs.push(`video_id is "${sb.video_id}", expected "${videoId}"`);
  if (typeof sb.title !== 'string' || !sb.title.trim()) errs.push('title is required');
  const ch = sb.character;
  if (!ch || typeof ch.prompt_prefix !== 'string' || !ch.prompt_prefix.trim()) errs.push('character.prompt_prefix is required');
  if (!ch || !Number.isInteger(ch.seed) || ch.seed < 0) errs.push('character.seed must be a fixed non-negative integer');
  if (sb.negative !== undefined && typeof sb.negative !== 'string') errs.push('negative must be a string');
  const provider = sb.voice?.provider ?? 'none';
  if (!VOICE_PROVIDERS.includes(provider)) errs.push(`voice.provider "${provider}" is not available (only: ${VOICE_PROVIDERS.join(', ')})`);
  if (!Array.isArray(sb.shots) || sb.shots.length === 0) { errs.push('shots must be a non-empty list'); return errs; }
  let total = 0;
  sb.shots.forEach((s, i) => {
    const at = `shots[${i}]`;
    const max = isCloser(sb, s, i) ? CLOSER_MAX_S : SHOT_MAX_S;
    if (!Number.isInteger(s?.n) || s.n !== i + 1) errs.push(`${at}.n must be ${i + 1}`);
    if (typeof s?.duration_s !== 'number' || s.duration_s < SHOT_MIN_S || s.duration_s > max) errs.push(`${at}.duration_s must be ${SHOT_MIN_S} to ${max} seconds${max === SHOT_MAX_S ? ` (only the closer, the last shot, may run to ${CLOSER_MAX_S} s)` : ''}`);
    else total += s.duration_s;
    if (typeof s?.keyframe_prompt !== 'string' || s.keyframe_prompt.trim().length < 10) errs.push(`${at}.keyframe_prompt is required`);
    if (typeof s?.motion_prompt !== 'string' || s.motion_prompt.trim().length < 5) errs.push(`${at}.motion_prompt is required`);
    if (s?.line !== undefined && typeof s.line !== 'string') errs.push(`${at}.line must be a string`);
    if (s?.negative !== undefined && typeof s.negative !== 'string') errs.push(`${at}.negative must be a string`);
  });
  if (total && (total < VIDEO_MIN_S || total > VIDEO_MAX_S)) errs.push(`total duration ${total} s must be ${VIDEO_MIN_S} to ${VIDEO_MAX_S} s`);
  if (playbook && !sb.from_shotlist && !errs.length) errs.push(...checkPlaybook(sb, total));
  return errs;
}

/** The episode rules on a shape-valid storyboard. Pure. */
export function checkPlaybook(sb, total = sb.shots.reduce((a, s) => a + s.duration_s, 0)) {
  const errs = [];
  const shots = sb.shots;
  const t = Math.round(total * 100) / 100;
  if (shots.length < EPISODE_MIN_SHOTS || shots.length > EPISODE_MAX_SHOTS) errs.push(`playbook: ${shots.length} shots; an episode has ${EPISODE_MIN_SHOTS}-${EPISODE_MAX_SHOTS} (the episode shape)`);
  if (t < EPISODE_MIN_S || t > EPISODE_MAX_S) errs.push(`playbook: total ${t} s; an episode runs ${EPISODE_MIN_S}-${EPISODE_MAX_S} s`);
  const last = shots.at(-1);
  const li = shots.length - 1;
  if (last?.closer !== true) errs.push(`playbook: shots[${li}] (the last shot) must be the closer: set "closer": true`);
  if (flfEnd(sb, last) !== shots[0].n) errs.push(`playbook: the closer must end on the opening keyframe (FLF): set storyboard "loop": true or shots[${li}].end_frame = {"shot": 1}`);
  if (last?.still || last?.source === 'still' || last?.source === 'reuse') errs.push(`playbook: the closer shots[${li}] is a new Wan FLF clip, never a still or a reuse`);
  let verbListed = false;
  shots.forEach((s, i) => {
    const at = `shots[${i}]`;
    if (i < li && s.closer === true) errs.push(`playbook: ${at} is marked closer; only the last shot is`);
    if (typeof s.verb !== 'string' || !VERB_SET.has(verbKey(s.verb))) {
      errs.push(`playbook: ${at}.verb ${s.verb === undefined ? 'is missing' : `"${s.verb}" is not a playbook verb`}; use exactly one ${verbListed ? 'playbook verb' : `of: ${VERBS.join(', ')}`}`);
      verbListed = true;
    }
    if (s.source !== undefined && !SHOT_SOURCES.includes(s.source)) errs.push(`playbook: ${at}.source must be one of ${SHOT_SOURCES.join(', ')}`);
    const words = [s.keyframe_prompt, s.motion_prompt, s.action, s.verb].filter((x) => typeof x === 'string').join(' ');
    if (HANDY.test(words)) {
      const have = negTerms(sb.negative, s.negative);
      const missing = HAND_NEGATIVE.filter((x) => !have.has(x));
      if (missing.length) errs.push(`playbook: ${at} shows a fingertip, paw or hand, so its negative must include "${HAND_NEGATIVE.join(', ')}" (missing: ${missing.join(', ')}); put it in ${at}.negative`);
    }
    if (ARMS_UP.test(words) && !(Number(s.takes) >= ARMS_UP_TAKES)) errs.push(`playbook: ${at} raises the arms (arms morph in Wan: ${ARMS_UP_TAKES} takes); use a single-action verb pose instead, or book "takes": ${ARMS_UP_TAKES}`);
  });
  return errs;
}
