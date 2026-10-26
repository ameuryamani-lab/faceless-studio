// Faceless Studio: the shared goal with a real benchmark: each video should get as many views as the trending Shorts shown on
// the Trending wall, or more; agents that know the goal reason better.
// From the latest trend scan (the Trending wall), computes the median and top-quartile views of those Shorts by age (up to 1 day,
// up to 7 days) and writes brand/mission.md (read by every agent) and data/mission.json (the vitrine's benchmark bar).
// Refreshed at the start of every chain (workshop/story/chain.mjs), by activateConcept (core/concept.mjs) and by hand:
// node --no-warnings core/mission.mjs
// 2026-10-24 (the concept is a parameter): the file names the active concept ("Active concept: <id> — <name_fr>") so an agent
// reading it knows which rules apply; the goal, the benchmark and the studio-wide limits do not change with the concept.
// core/concept.mjs imports writeMission and this file imports concept.mjs: both only use the other's functions at call time.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STUDIO_ROOT, closeDb, openDb } from './db.mjs';
import { activeConceptId, loadConcept } from './concept.mjs';

export const MISSION_MD = path.join(STUDIO_ROOT, 'brand', 'mission.md');
export const MISSION_JSON = path.join(STUDIO_ROOT, 'data', 'mission.json');

const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]);
};
export const fmt = (n) => (n === null ? 'unknown' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : String(n));

/** { scanned_at, day, week, all: {n, median, top}, benchmark } from the latest scan; benchmark = the 7-day median. */
export function computeBenchmark() {
  const d = openDb();
  // 2026-10-23: hand-added web trend rows (no views) became "the latest scan" and the wall showed 0 Shorts: YouTube scans only.
  const rows = d.prepare("SELECT views, upload_date, scanned_at FROM trends WHERE scanned_at = (SELECT MAX(scanned_at) FROM trends WHERE source != 'web' AND views IS NOT NULL) AND source != 'web' AND views IS NOT NULL").all();
  const ageDays = (r) => {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(r.upload_date ?? ''));
    return m ? (Date.parse(r.scanned_at) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86_400_000 : null;
  };
  const pick = (max) => rows.filter((r) => { const a = ageDays(r); return a !== null && a <= max; }).map((r) => Number(r.views));
  const stats = (xs) => ({ n: xs.length, median: quantile(xs, 0.5), top: quantile(xs, 0.75) });
  const day = stats(pick(1.5));
  const weekRaw = pick(7.5);
  const all = stats(rows.map((r) => Number(r.views)));
  const week = weekRaw.length >= 3 ? stats(weekRaw) : all;
  return { scanned_at: rows[0]?.scanned_at ?? null, day, week, all, benchmark: week.median };
}

/** "Active concept: <id> — <name_fr>"; never throws: the mission is studio-wide, and a concept that does not load is reported
 *  by run-agent (error event) and `node core/concept.mjs check`, not by a missing mission file. */
function activeConceptLine() {
  try {
    const c = loadConcept();
    return `Active concept: ${c.id} — ${c.name_fr ?? c.name ?? c.hero_name} (its rules: concept/${c.id}/rules.md; studio rules: brand/studio.md).`;
  } catch (e) {
    console.error(`mission: active concept not loaded: ${e.message}`);
    let id = null;
    try { id = activeConceptId(); } catch { id = null; }
    return id ? `Active concept: ${id} (its rules could not be loaded; studio rules: brand/studio.md).` : 'Active concept: none yet (the owner has not created the show; studio rules: brand/studio.md).';
  }
}

export function writeMission() {
  const b = computeBenchmark();
  writeFileSync(MISSION_JSON, JSON.stringify({ ...b, at: new Date().toISOString() }, null, 1));
  const md = [
    '# Mission (shared by every agent)',
    '',
    `Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from the latest trend scan (${b.all.n} Shorts on the Trending wall).`,
    activeConceptLine(),
    '',
    '## The goal',
    'Each of our videos must reach as many views as the trending Shorts on our Trending wall, or more. That is the one measure of success.',
    '',
    '## The benchmark (real numbers from the wall)',
    `- Shorts up to 1 day old: median ${fmt(b.day.median)} views, top quarter ${fmt(b.day.top)} (${b.day.n} Shorts).`,
    `- Shorts up to 7 days old: median ${fmt(b.week.median)} views, top quarter ${fmt(b.week.top)} (${b.week.n} Shorts).`,
    `- Our target per video: ${fmt(b.benchmark)} views within 7 days.`,
    '',
    '## How to use it',
    '- Pick subjects closest to what is working on the wall (the situation, never the footage, people or brand).',
    '- Trend sources: the YouTube scan AND TikTok trends (list_trends: rows and tiktok). The reference network of the studio is Instagram at 24 h: when choosing a subject, first weight what performs for US on Instagram (list_metrics, Instagram views per video), then use the YouTube and TikTok trends to pick the angle.',
    '- Stop the scroll in the first second, be understood at once, be watched to the end, make people want to comment or share.',
    '',
    '## What the goal never changes',
    'The goal never overrides the channel rules: no clickbait or promise the video does not deliver, no lies, no politics, no religion mockery, no real people, celebrities, brands, logos or copyrighted characters, never the real identity or business of the channel owner, no medical or financial advice, nothing shocking or adult, nothing aimed at children.',
    '',
  ].join('\n');
  writeFileSync(MISSION_MD, md, 'utf8');
  return b;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { console.log(JSON.stringify(writeMission())); } catch (e) { console.error(`mission failed: ${e.message}`); process.exitCode = 1; } finally { closeDb(); }
}
