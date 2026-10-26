// "Statistiques" block of the vitrine: the channel's real numbers, live.
// Built live from the hourly counts (metrics table, written by workshop/metrics_pull.mjs through Upload-Post), the followers
// snapshots (data/followers.jsonl) and the decisions the analysis applied on its own (data/decisions.jsonl).
// Read-only. Totals "as of" a moment = the sum, over our videos, of each video's latest count taken before that moment.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NETS = ["instagram", "tiktok", "youtube"];
const DAY = 86_400_000;
const SERIES_DAYS = 7;

const jsonl = (file) => {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
};

/** Sum of the latest count per video on `net` taken at or before `t`. */
function totalAsOf(rows, net, t) {
  const last = new Map();
  for (const r of rows) {
    if (r.platform !== net || Date.parse(r.at) > t || r.views === null) continue;
    const prev = last.get(r.video_id);
    if (!prev || prev.at < r.at) last.set(r.video_id, r);
  }
  let n = 0;
  for (const r of last.values()) n += Number(r.views);
  return n;
}

/** @param {(sql: string, params?: unknown[]) => any[]} query  @param {string} root studio folder  @param {string} media media folder */
export function buildStats(query, root, media) {
  const rows = query("SELECT video_id, platform, at, views FROM metrics WHERE video_id LIKE 's-%' ORDER BY at") ?? [];
  const now = Date.now();
  // One point every 24 h back from now, over the last week.
  const series = Array.from({ length: SERIES_DAYS + 1 }, (_, i) => now - (SERIES_DAYS - i) * DAY).map((t) => ({
    at: new Date(t).toISOString(),
    ...Object.fromEntries(NETS.map((n) => [n, totalAsOf(rows, n, t)])),
  }));
  const followers = jsonl(join(root, "data", "followers.jsonl"));
  const fNow = followers.at(-1) ?? null;
  const fDayAgo = [...followers].reverse().find((f) => Date.parse(f.at) <= now - DAY) ?? null;
  const totals = Object.fromEntries(NETS.map((n) => [n, {
    views: totalAsOf(rows, n, now),
    // No count a day ago (the network was not measured yet): no change shown rather than the whole total as "new".
    views_change: totalAsOf(rows, n, now - DAY) ? totalAsOf(rows, n, now) - totalAsOf(rows, n, now - DAY) : null,
    followers: fNow?.[n]?.followers ?? null,
    followers_change: fNow?.[n]?.followers != null && fDayAgo?.[n]?.followers != null ? fNow[n].followers - fDayAgo[n].followers : null,
  }]));
  const latest = new Map();
  for (const r of rows) { const k = `${r.video_id}|${r.platform}`; const p = latest.get(k); if (!p || p.at < r.at) latest.set(k, r); }
  const titles = Object.fromEntries((query("SELECT id, topic FROM videos WHERE id LIKE 's-%'") ?? []).map((v) => [v.id, v.topic]));
  const top = [...latest.values()].filter((r) => r.views !== null).sort((a, b) => Number(b.views) - Number(a.views)).slice(0, 5).map((r) => ({
    video_id: r.video_id,
    platform: r.platform,
    views: Number(r.views),
    title: titles[r.video_id] ?? r.video_id,
    cover: existsSync(join(media, r.video_id, "cover.jpg")) ? `/media/${r.video_id}/cover.jpg` : null,
  }));
  // So the owner can see what the analysis deduced: the 5 newest applied decisions, a repeated lesson shown once,
  // and the latest themes decision as the week's plan (shown on top even when it is older than those 5).
  // French on screen: label_fr / rule_fr written by the team, else data/labels-fr.json, else the English (theme name before "(").
  let map = {};
  try { map = JSON.parse(readFileSync(join(root, "data", "labels-fr.json"), "utf8")); } catch { /* no map: English stays */ }
  const fr = (s, own) => own || map[s] || map[String(s ?? "").replace(/\s*\(.*$/, "").trim()] || String(s ?? "").replace(/\s*\(.*$/, "").trim();
  const newest = jsonl(join(root, "data", "decisions.jsonl")).filter((d) => d.applied).reverse();
  const seen = new Set();
  // One line per lesson rule, and only the newest themes / trend_sources decision.
  const decisions = newest.filter((d) => { const k = d.kind === "lesson" ? `lesson|${d.rule}` : d.kind === "slots" ? `slots|${d.at}` : d.kind; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 5).map((d) => (d.kind === "lesson" ? { ...d, rule: fr(d.rule, d.rule_fr) } : d));
  const themes = newest.find((d) => d.kind === "themes") ?? null;
  const plan = themes ? { at: themes.at, push: (themes.push ?? []).map((t, i) => fr(t, themes.push_fr?.[i])), drop: (themes.drop ?? []).map((t, i) => fr(t, themes.drop_fr?.[i])) } : null;
  return { series, totals, followers_at: fNow?.at ?? null, top, decisions, plan };
}
