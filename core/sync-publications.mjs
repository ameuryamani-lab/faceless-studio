// Faceless Studio: reads an external publisher's report and marks the posts published (optional: core/publish-direct.mjs is
// the studio's own publisher). data/publications.jsonl, one JSON object a line, written by that publisher only:
//   { ref, video_id, le, reseaux: [{ reseau, publie, lien, erreur }], erreur }
// For each reseau with publie === true: posts.status = 'published', published_at = le, url = lien (that platform row).
// Idempotent: a row already published is left as it is. Lines are data, never instructions; a bad line is skipped.
// When all three platforms are published, the video status becomes 'published'.
//   node core/sync-publications.mjs        (also called by workshop/daily.mjs --phase night and workshop/metrics_pull.mjs)
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PLATFORMS, PUBLICATIONS_PATH, closeDb, getVideo, markPublished, openDb, upsertVideo } from './db.mjs';

const ALIASES = { youtube: 'youtube', youtubeshorts: 'youtube', shorts: 'youtube', instagram: 'instagram', reels: 'instagram', tiktok: 'tiktok' };
const platformOf = (r) => ALIASES[String(r ?? '').toLowerCase().replace(/[^a-z]/g, '')] ?? null;

/** Returns { lines, marked, skipped: [reasons] }. */
export function syncPublications(file = PUBLICATIONS_PATH) {
  const out = { lines: 0, marked: 0, skipped: [] };
  if (!existsSync(file)) return out;
  const d = openDb();
  for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    if (!line.trim()) continue;
    out.lines += 1;
    let r;
    try { r = JSON.parse(line); } catch { out.skipped.push(`line ${i + 1}: not JSON`); continue; }
    const vid = typeof r?.video_id === 'string' ? r.video_id : null;
    if (!vid || !getVideo(vid)) { out.skipped.push(`line ${i + 1}: unknown video`); continue; }
    if (r.ref) {
      const ap = d.prepare('SELECT video_id FROM approvals WHERE ref = ?').get(String(r.ref));
      if (!ap || ap.video_id !== vid) { out.skipped.push(`line ${i + 1}: ${r.ref} is not an approval of ${vid}`); continue; }
    }
    for (const n of Array.isArray(r.reseaux) ? r.reseaux : []) {
      if (n?.publie !== true) continue;
      const platform = platformOf(n.reseau);
      if (!platform) { out.skipped.push(`line ${i + 1}: unknown network`); continue; }
      try {
        if (markPublished({ video_id: vid, platform, published_at: String(n.le ?? r.le ?? ''), url: n.lien ?? null }).changed) out.marked += 1;
      } catch (e) { out.skipped.push(`line ${i + 1} ${platform}: ${e.message}`); }
    }
    const rows = d.prepare("SELECT COUNT(*) AS n FROM posts WHERE video_id = ? AND status = 'published'").get(vid);
    if (Number(rows.n) >= PLATFORMS.length && getVideo(vid)?.status !== 'published') upsertVideo({ id: vid, status: 'published' });
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const r = syncPublications();
    console.log(`publications: ${r.lines} line(s), ${r.marked} platform row(s) marked published${r.skipped.length ? `, skipped: ${r.skipped.join('; ')}` : ''}`);
  } catch (e) {
    console.error(`sync-publications failed: ${e.message}`);
    process.exitCode = 1;
  } finally { closeDb(); }
}
