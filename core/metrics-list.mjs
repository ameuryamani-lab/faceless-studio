// Faceless Studio: the answer of the list_metrics tool (core/mcp-server.mjs), kept short enough for an agent to read.
// 2026-10-26 (a shorter answer): one row per video AND network, every snapshot spelled out with its date,
// reached 56 000 characters for 31 videos; from 25/10 23:17 the agents' tool reader refused it and topic_editor, trend_scout,
// results_analyst and postmortem_writer worked without our numbers. Now: one row per video, each checkpoint a short array, the
// measure date replaced by its age in hours after that network's release (what the analysts computed from it), a size ceiling
// that drops the OLDEST videos and says so, and video_id / platform filters.
// Run the tests: node --no-warnings core/metrics-list.test.mjs

export const MAX_CHARS = 20_000; // the 3-day answer (19 020 characters) was read; the 56 145 one never was
export const FORMAT = 'nets.<network>.<checkpoint> = [views, likes, comments, shares, hours after that network\'s release when measured]; '
  + 'nets.<network>.published only when that network went out later than the video (catch-up). Videos newest first.';

const minute = (iso) => (iso ? `${String(iso).slice(0, 16)}Z` : null);
const hoursBetween = (from, to) => (from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 360_000) / 10 : null);

/**
 * rows: metrics rows {video_id, platform, checkpoint, measured_at, views, likes, comments, shares, title}, oldest first.
 * firstPub: video_id -> first release (any network); firstNet: video_id -> {network: release}; since: ISO lower bound.
 */
export function compactMetrics(rows, { firstPub = {}, firstNet = {}, followers = null, since = null, videoId = null, platform = null, maxChars = MAX_CHARS } = {}) {
  const byVideo = new Map();
  for (const r of rows) {
    if (videoId && r.video_id !== videoId) continue;
    if (platform && r.platform !== platform) continue;
    if (!r.checkpoint) continue;
    const published = firstPub[r.video_id] ?? null;
    const v = byVideo.get(r.video_id) ?? { video_id: r.video_id, title: r.title ?? null, published: minute(published), nets: {} };
    const netRelease = firstNet[r.video_id]?.[r.platform] ?? published;
    const net = v.nets[r.platform] ?? (netRelease && published && netRelease !== published ? { published: minute(netRelease) } : {});
    net[r.checkpoint] = [r.views ?? null, r.likes ?? null, r.comments ?? null, r.shares ?? null, hoursBetween(netRelease, r.measured_at)];
    v.nets[r.platform] = net;
    byVideo.set(r.video_id, v);
  }
  // A video with no known release stays in (as before 26/10): its counts exist, only its date is missing.
  const videos = [...byVideo.values()]
    .filter((v) => videoId || !since || !firstPub[v.video_id] || firstPub[v.video_id] >= since)
    .sort((a, b) => String(b.published ?? '').localeCompare(String(a.published ?? '')));
  const out = { format: FORMAT, videos, followers };
  let dropped = 0;
  const room = JSON.stringify(out).length > maxChars ? maxChars - 300 : maxChars; // 300: the left_out note itself
  while (JSON.stringify(out).length > room && out.videos.length > 1) {
    out.videos = out.videos.slice(0, -1);
    dropped += 1;
  }
  if (dropped) {
    out.left_out = {
      videos: dropped,
      why: `the answer must stay under ${maxChars} characters`,
      how: 'ask with fewer days, with platform (one network), or with video_id (one video)',
    };
  }
  return out;
}
