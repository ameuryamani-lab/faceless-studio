// Faceless Studio promo, step 3a (2026-10-22): cuts the real A-to-Z film (workshop/promo/film.mjs) into the promo's footage.
// Every hand-off is kept at near real speed (the order card flies, the camera follows it), the image drawing is fast-forwarded,
// the waiting between steps is cut. Nothing is staged: each shot is a moment that happened, chosen from events.json.
//   node --no-warnings workshop/promo/edit.mjs <film_dir> [footage_seconds]
// Output in <film_dir>/edit/: foot/%05d.jpg (30 fps), timeline.json (shots, sections and badges in output seconds).
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const FPS = 30;
const HANDOFF_SPAN = [-0.1, 3.0];   // seconds around a hand-off: the card leaves, flies 1.7 s, lands
const PUBLISH_SPAN = [-0.1, 3.6];
const IMAGES_FF_S = 4;              // the image drawing, fast-forwarded to this long
const OPENING_S = 2.4;              // the room before the Chief starts, real time
// Which section of the narration a hand-off belongs to, by the agent who receives the card.
const SECTION = {
  outlier_analyst: 'research', teardown_analyst: 'research', strategist: 'research', trend_scout: 'research',
  calendar_planner: 'pick', topic_editor: 'pick',
  copywriter: 'write', hook_auditor: 'write', fact_checker: 'write',
  storyboard_artist: 'draw', continuity_checker: 'draw', image_artist: 'draw',
  voice_director: 'voice', voice_writer: 'voice', animator: 'voice', editor: 'voice',
  qc_inspector: 'check', publisher: 'check',
};
const BADGE = {
  outlier_analyst: 'OUTLIER ANALYST', teardown_analyst: 'TEARDOWN ANALYST', trend_scout: 'TREND SCOUT', strategist: 'STRATEGIST', calendar_planner: 'CALENDAR', topic_editor: 'TOPIC EDITOR',
  copywriter: 'COPYWRITER', hook_auditor: 'HOOK AUDITOR', fact_checker: 'FACT CHECKER', storyboard_artist: 'STORYBOARD',
  continuity_checker: 'CONTINUITY', image_artist: 'IMAGE ARTIST', voice_director: 'VOICE DIRECTOR', voice_writer: 'CAPTIONS',
  animator: 'ANIMATOR', editor: 'EDITOR', qc_inspector: 'QUALITY CHECK', publisher: 'PUBLISHER', results_analyst: 'RESULTS',
};

const dir = process.argv[2];
const target = Number(process.argv[3] ?? 42);
if (!dir || !existsSync(path.join(dir, 'events.json'))) throw new Error('usage: edit.mjs <film_dir> [footage_seconds] (events.json missing)');
const film = JSON.parse(readFileSync(path.join(dir, 'film.json'), 'utf8'));
const events = JSON.parse(readFileSync(path.join(dir, 'events.json'), 'utf8')).map((e) => ({ ...e, t: Date.parse(e.at) }));
const frames = readdirSync(path.join(dir, 'frames')).filter((f) => /^\d+\.jpg$/.test(f)).map((f) => Number(f.slice(0, -4))).sort((a, b) => a - b);
if (!frames.length) throw new Error('no frames');

// Shots in story order: opening, every hand-off of the filmed video, the image fast-forward, then a publication if one happened.
// An agent often announces its own hand-off (log_event) a few seconds before the chain sends the card after its run: keep the
// later one of a same pair within 10 s, so each card is shown once.
const handoffs = events.filter((e) => e.kind === 'handoff' && e.video_id === film.video_id && SECTION[e.to_agent])
  .filter((e, i, all) => !all.slice(i + 1).some((x) => x.agent === e.agent && x.to_agent === e.to_agent && x.t - e.t < 10_000));
const shots = [{ kind: 'opening', from: frames[0] + 300, to: frames[0] + 300 + OPENING_S * 1000, speed: 1, section: 'intro' }];
for (const h of handoffs) {
  shots.push({ kind: 'handoff', from: h.t + HANDOFF_SPAN[0] * 1000, to: h.t + HANDOFF_SPAN[1] * 1000, speed: 1.4, section: SECTION[h.to_agent], agent: h.to_agent });
  if (h.to_agent === 'image_artist') {
    const next = handoffs.find((x) => x.agent === 'image_artist');
    if (next) {
      const from = h.t + HANDOFF_SPAN[1] * 1000, to = next.t - 200;
      if (to - from > 4000) shots.push({ kind: 'fast', from, to, speed: (to - from) / 1000 / IMAGES_FF_S, section: 'draw', agent: 'image_artist' });
    }
  }
}
const published = events.filter((e) => e.kind === 'publish' && / published: /.test(e.text ?? '')).at(-1);
if (published) shots.push({ kind: 'publish', from: published.t + PUBLISH_SPAN[0] * 1000, to: published.t + PUBLISH_SPAN[1] * 1000, speed: 1.2, section: 'live' });

// Too long: hand-offs speed up together (never past 2.2x, the card must stay readable); too short is fine.
const length = () => shots.reduce((n, s) => n + (s.to - s.from) / 1000 / s.speed, 0);
for (let i = 0; i < 20 && length() > target; i++) for (const s of shots) if (s.kind === 'handoff') s.speed = Math.min(2.2, s.speed * 1.06);

// Source time -> nearest frame at or before it.
function frameAt(ms) {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid] <= ms) lo = mid; else hi = mid - 1; }
  return frames[lo];
}

const out = path.join(dir, 'edit');
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'foot'), { recursive: true });
let k = 0;
const timeline = { fps: FPS, video_id: film.video_id, shots: [], sections: [], badges: [] };
for (const s of shots) {
  const startOut = k / FPS;
  const n = Math.round(((s.to - s.from) / 1000 / s.speed) * FPS);
  for (let i = 0; i < n; i++) {
    const src = path.join(dir, 'frames', `${frameAt(s.from + (i / FPS) * s.speed * 1000)}.jpg`);
    const dst = path.join(out, 'foot', `${String(k + 1).padStart(5, '0')}.jpg`);
    try { linkSync(src, dst); } catch { copyFileSync(src, dst); }
    k += 1;
  }
  timeline.shots.push({ kind: s.kind, section: s.section, agent: s.agent ?? null, start: +startOut.toFixed(3), end: +(k / FPS).toFixed(3), speed: +s.speed.toFixed(2) });
  if (s.kind === 'handoff') timeline.badges.push({ at: +(startOut + 0.25).toFixed(3), text: BADGE[s.agent] ?? s.agent });
  const last = timeline.sections.at(-1);
  if (!last || last.name !== s.section) timeline.sections.push({ name: s.section, start: +startOut.toFixed(3) });
}
timeline.frames = k;
timeline.seconds = +(k / FPS).toFixed(3);
writeFileSync(path.join(out, 'timeline.json'), JSON.stringify(timeline, null, 1), 'utf8');
console.log(`edit: ${k} frames (${timeline.seconds}s), ${timeline.shots.length} shots, sections ${timeline.sections.map((x) => `${x.name}@${x.start}`).join(' ')}`);
