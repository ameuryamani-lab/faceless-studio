// Faceless Studio office server. Plain node:http on 127.0.0.1:8830 only.
// Serves the office page (public/), read-only thumbnails from media/, GET /api/state and GET /api/events (SSE).
// The database is opened read-only: this server never writes data/studio.db itself. One exception:
// POST /api/stop runs "node core/approve.mjs stop ap-N --source vitrine" (the CLI does the write) and needs the access
// key cookie or header, from any address. Demo mode (/?demo=1) runs entirely in the browser. Start: node office/server.mjs

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { makeStudioFiles } from "./studio-files.mjs";
import { makeClaudeStats, readPlanFiles } from "./claude-stats.mjs";
import { deskWork } from "./desk-work.mjs";
import { buildStats } from "./stats.mjs";
// The concept is a parameter: the vitrine shows the ACTIVE concept's cast through core/concept.mjs instead of
// listing concept/heroes/. Value-only imports: neither module opens data/studio.db when imported (core/db.mjs openDb is lazy and
// never called from here), so this server stays read-only.
import { clearConceptCache, loadConcept } from "../core/concept.mjs";
import { isRehearsal } from "../core/db.mjs";
import { studioDay, studioHour, studioInstant } from "../core/studio-time.mjs";

const HOST = "127.0.0.1";
// --port <n> runs a second, test instance (still 127.0.0.1 only); the office itself is 8830.
const portArg = process.argv.indexOf("--port");
const PORT_WANTED = portArg > 0 ? Number.parseInt(process.argv[portArg + 1] ?? "", 10) : 8830;
const PORT = Number.isInteger(PORT_WANTED) && PORT_WANTED >= 1024 && PORT_WANTED <= 65535 ? PORT_WANTED : 8830;
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");
const PUBLIC = join(HERE, "public");
const MEDIA = join(ROOT, "media");
// --db <file> points at another database (tests); the default is the studio's single source of truth.
const dbArg = process.argv.indexOf("--db");
const DB_PATH = dbArg > 0 && process.argv[dbArg + 1] ? process.argv[dbArg + 1] : join(ROOT, "data", "studio.db");

const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;
const MAX_BATCH = 200;
const RECENT = 20;
const TRENDS_SHOWN = 12;
const ALLOWED_HOSTS = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
// --tailnet <address> also listens on your own private VPN address (for phone access).
// Requests arriving there need the access key (data/office-key.txt, generated locally on first start and never committed):
// ?k=<key> once, then a cookie.
const tnArg = process.argv.indexOf("--tailnet");
const TAILNET = tnArg > 0 && /^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(process.argv[tnArg + 1] ?? "") ? process.argv[tnArg + 1] : null;
const KEY_FILE = join(ROOT, "data", "office-key.txt");
const OFFICE_KEY = TAILNET ? loadOrCreateKey() : null;
if (TAILNET) ALLOWED_HOSTS.add(`${TAILNET}:${PORT}`);

function loadOrCreateKey() {
  if (existsSync(KEY_FILE)) return readFileSync(KEY_FILE, "utf8").trim();
  const key = randomBytes(18).toString("hex");
  writeFileSync(KEY_FILE, `${key}\n`, "utf8");
  return key;
}

/** Tailnet requests must carry the key (query or cookie); local ones never need it. */
function keyOk(req, url, res) {
  // ?k=<key> also works on 127.0.0.1: it gives the local page the cookie the Stop button needs.
  if (OFFICE_KEY && sameKey(url.searchParams.get("k"))) {
    res.setHeader("Set-Cookie", `fs_key=${OFFICE_KEY}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict`);
    return true;
  }
  if (!TAILNET || req.headers.host !== `${TAILNET}:${PORT}`) return true;
  return hasKey(req);
}
function sameKey(value) {
  if (!OFFICE_KEY || typeof value !== "string" || value.length !== OFFICE_KEY.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(OFFICE_KEY));
}
/** The access key in the fs_key cookie or the X-Office-Key header (never optional for a write). */
function hasKey(req) {
  const cookie = /(?:^|;\s*)fs_key=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];
  return sameKey(cookie) || sameKey(req.headers["x-office-key"]);
}
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const COVER_NAMES = ["thumbnail", "thumb", "cover"];
const COVER_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const PLATFORMS = ["youtube", "instagram", "tiktok"];
const ERRORS_SHOWN = 5;
const files = makeStudioFiles(ROOT);
const claudeStats = makeClaudeStats();

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};
const CONCEPT = join(ROOT, "concept");
const CONCEPT_FILES = [".png", ".jpg", ".webp", ".wav", ".mp3"];
const PAUSE_FILE = join(ROOT, "data", "production-paused.json");

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

// ---------- Database (read-only) ----------

let db = null;

function openDb() {
  if (db) return db;
  if (!existsSync(DB_PATH)) return null;
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
    return db;
  } catch (err) {
    console.error(`[office] cannot open ${DB_PATH} read-only: ${err.message}`);
    db = null;
    return null;
  }
}

/** Runs a read query; a missing table (database still being created) gives the fallback instead of an error. */
function all(sql, params = [], fallback = []) {
  const handle = openDb();
  if (!handle) return fallback;
  try {
    return handle.prepare(sql).all(...params);
  } catch (err) {
    if (!/no such table|no such column/i.test(err.message)) console.error(`[office] query failed: ${err.message}`);
    return fallback;
  }
}

function one(sql, params = [], fallback = null) {
  const rows = all(sql, params, null);
  return rows && rows.length ? rows[0] : fallback;
}

function coverFor(videoId) {
  if (!SAFE_ID.test(videoId)) return null;
  for (const name of COVER_NAMES) {
    for (const ext of COVER_EXTS) {
      const file = join(MEDIA, videoId, name + ext);
      if (existsSync(file)) return `/media/${encodeURIComponent(videoId)}/${name}${ext}`;
    }
  }
  return null;
}

const LATEST_METRICS = `
  SELECT m.video_id, m.platform, m.views, m.followers_delta
  FROM metrics m
  JOIN (SELECT video_id, platform, MAX(at) AS at FROM metrics GROUP BY video_id, platform) l
    ON m.video_id = l.video_id AND m.platform = l.platform AND m.at = l.at`;

function metricsByPlatform(latest) {
  const out = {};
  for (const p of PLATFORMS) {
    const rows = latest.filter((r) => r.platform === p);
    const sum = (key) => {
      const vals = rows.map((r) => r[key]).filter((v) => typeof v === "number" || typeof v === "bigint");
      return vals.length ? vals.reduce((n, v) => n + Number(v), 0) : null;
    };
    out[p] = { views: sum("views"), followers_delta: sum("followers_delta") };
  }
  return out;
}

function lastEventId() {
  const row = one("SELECT MAX(id) AS id FROM events");
  return row && row.id != null ? Number(row.id) : 0;
}

/** Latest scan's top rows with the "not usable for the show" flag (usable, flag_reason); the old columns only on a database
 *  that has not been migrated yet (core/db.mjs adds the flag columns the first time trends are read or written). */
function readTrends() {
  const order = `WHERE scanned_at = (SELECT MAX(scanned_at) FROM trends) ORDER BY ratio IS NULL, ratio DESC, views_per_day DESC LIMIT ?`;
  const flagged = all(`SELECT video_url, title, channel, views, ratio, views_per_day, gap, scanned_at, upload_date, source, usable, flag_reason FROM trends ${order}`, [TRENDS_SHOWN], null);
  const rows = flagged ?? all(`SELECT video_url, title, channel, views, ratio, views_per_day, gap, scanned_at FROM trends ${order}`, [TRENDS_SHOWN]);
  const used = usedTrendText();
  const lower = used.toLowerCase();
  return rows.map((t) => ({
    ...t,
    used: (Boolean(t.video_url) && used.includes(String(t.video_url).replace(/^https?:\/\/(www\.)?/, "")))
      || (String(t.title ?? "").length > 12 && lower.includes(String(t.title).toLowerCase().slice(0, 40))),
  }));
}

/** What the trend scouts of our stories referred to (media/<id>/chain/trend_scout.txt), to mark a trend "used". Cached 60 s. */
let usedCache = { at: 0, text: "" };
function usedTrendText() {
  if (Date.now() - usedCache.at < 60_000) return usedCache.text;
  let text = "";
  try {
    for (const d of readdirSync(MEDIA, { withFileTypes: true })) {
      if (!d.isDirectory() || !SAFE_ID.test(d.name)) continue;
      const f = join(MEDIA, d.name, "chain", "trend_scout.txt");
      if (existsSync(f)) text += readFileSync(f, "utf8").slice(0, 20_000);
    }
  } catch { /* no media yet */ }
  usedCache = { at: Date.now(), text };
  return text;
}

const POSTS_SQL = (status) => `SELECT video_id, platform, title, scheduled_at, published_at, url${status ? ", status" : ""} FROM posts
  ORDER BY COALESCE(published_at, scheduled_at, '') DESC LIMIT 10`;
/** posts.status exists once core/db.mjs has migrated the database (2026-10-21); older databases have no status. */
const readPosts = () => all(POSTS_SQL(true), [], null) ?? all(POSTS_SQL(false));

/** Per video: planned publish time, status (scheduled | stopped | published | partly published | null), video approval ref. */
function publications() {
  const rows = all("SELECT video_id, platform, scheduled_at, published_at, status FROM posts", [], null) ?? [];
  const refs = new Map(all("SELECT video_id, ref FROM approvals WHERE kind = 'video' AND status = 'approved' ORDER BY id").map((r) => [r.video_id, r.ref]));
  const out = new Map();
  for (const r of rows) {
    const cur = out.get(r.video_id) ?? { scheduled_at: null, status: null, statuses: [], video_ref: refs.get(r.video_id) ?? null };
    if (r.scheduled_at && (!cur.scheduled_at || r.scheduled_at < cur.scheduled_at)) cur.scheduled_at = r.scheduled_at;
    cur.statuses.push(r.status ?? (r.published_at ? "published" : null));
    out.set(r.video_id, cur);
  }
  const result = new Map();
  for (const [id, p] of out) {
    const s = p.statuses;
    const status = s.includes("published") ? (s.every((x) => x === "published") ? "published" : "partly published")
      : s.length && s.every((x) => x === "stopped") ? "stopped" : s.includes("scheduled") ? "scheduled" : null;
    result.set(id, { scheduled_at: p.scheduled_at, status, video_ref: p.video_ref });
  }
  return result;
}

const IN_PRODUCTION = ["idea", "scripted", "storyboarded", "animated", "voiced", "edited"];
const READY = ["qc_passed", "approved", "awaiting_approval", "scheduled"];

/** The video queue: in production, ready to publish, published (with the post links). Superseded/rejected are left out. */
function readQueue() {
  // Rehearsal videos (r-…, 2026-10-24: test runs, never published) stay out of the vitrine's queue.
  const vids = all("SELECT id, topic, status, updated_at FROM videos WHERE status NOT IN ('superseded', 'rejected') ORDER BY updated_at DESC LIMIT 40").filter((v) => !isRehearsal(v.id));
  const links = new Map();
  for (const p of all("SELECT video_id, platform, url, published_at FROM posts WHERE url IS NOT NULL")) {
    const cur = links.get(p.video_id) ?? { links: {}, published_at: null };
    cur.links[p.platform] = p.url;
    if (p.published_at && (!cur.published_at || p.published_at > cur.published_at)) cur.published_at = p.published_at;
    links.set(p.video_id, cur);
  }
  const row = (v) => ({ id: v.id, title: String(v.topic ?? v.id).replace(/^\s*\[[^\]]*\]\s*/, "").slice(0, 120), status: v.status, updated_at: v.updated_at, cover: coverFor(String(v.id)), progress: progressOf(String(v.id)) });
  const published = vids.filter((v) => v.status === "published" || links.has(v.id))
    .map((v) => ({ ...row(v), ...links.get(v.id), nets: netsOf(String(v.id), links.get(v.id)?.links), views: viewsOf(String(v.id)) }))
    .sort((a, b) => String(b.published_at ?? "").localeCompare(String(a.published_at ?? "")));
  const pubIds = new Set(published.map((v) => v.id));
  // Ready videos go out one by one, min_gap_min apart (core/daily.json): their expected time.
  let gapMs = 3600_000;
  let slots = [];
  try {
    const auto = JSON.parse(readFileSync(join(ROOT, "core", "daily.json"), "utf8")).autonomy ?? {};
    gapMs = Math.max(60, Number(auto.min_gap_min) || 60) * 60_000;
    if (auto.two_a_day?.on) slots = auto.two_a_day.slots ?? [];
  } catch { /* defaults */ }
  const lastPub = Math.max(0, ...published.map((v) => Date.parse(v.published_at ?? "") || 0));
  // Rehearsal videos (r-…, 2026-10-24) go through the chain but are never published: they never wait for a slot.
  const waiting = vids.filter((v) => READY.includes(v.status) && !pubIds.has(v.id) && !isRehearsal(v.id)).sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
  // 2026-10-22: a 2-a-day (animated) video goes out at the next free 13:00 / 20:00 studio-time slot, the others every min_gap_min.
  const animated = (v) => existsSync(join(MEDIA, String(v.id), "animated.json"));
  const slotTimes = (() => {
    const out = [];
    const today = studioDay();
    for (let day = 0; day < 7 && slots.length; day++) for (const s of slots) {
      const date = new Date(Date.parse(`${today}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
      const t = studioInstant(date, String(s)).getTime(); // studio wall clock -> UTC (Intl, daylight saving included)
      if (t > Date.now() - 60 * 60_000) out.push(t);
    }
    return out.sort((a, b) => a - b);
  })();
  // 2026-10-23: same rules as core/publish-direct.mjs: nothing old goes out in the hour before a slot that has its video, and
  // the slot video restarts the gap (the countdown on the vitrine showed an old video at 18:41Z, inside the 18:00-19:00 hold).
  const slotVids = waiting.filter(animated);
  const used = slotTimes.slice(0, slotVids.length);
  let t = Math.max(Date.now(), lastPub + gapMs);
  const oldTimes = waiting.filter((v) => !animated(v)).map(() => {
    for (let s = used.find((x) => t >= x - 60 * 60_000 && t < x + gapMs); s !== undefined; s = used.find((x) => t >= x - 60 * 60_000 && t < x + gapMs)) t = s + gapMs;
    const at = t;
    t += gapMs;
    return at;
  });
  const ready = [
    ...waiting.filter((v) => !animated(v)).map((v, i) => ({ ...row(v), publish_at: new Date(oldTimes[i]).toISOString() })),
    ...slotVids.map((v, i) => ({ ...row(v), publish_at: new Date(slotTimes[i] ?? Date.now()).toISOString() })),
  ].sort((a, b) => a.publish_at.localeCompare(b.publish_at));
  return {
    in_production: vids.filter((v) => IN_PRODUCTION.includes(v.status) && !pubIds.has(v.id)).map((v) => ({ ...row(v), stepper: stepsOf(String(v.id), false) })),
    ready: ready.map((v) => ({ ...v, nets: netsOf(v.id, null) })),
    published,
  };
}

/** The 8 steps of a narrated story (Tendance … Publication): "done" | "now" | "todo", plus the stills made / planned. */
function stepsOf(id, published) {
  if (!SAFE_ID.test(id)) return null;
  const dir = join(MEDIA, id);
  if (!existsSync(join(dir, "chain"))) return null;
  const has = (p) => existsSync(join(dir, p));
  const count = (sub, re) => { try { return readdirSync(join(dir, sub)).filter((f) => re.test(f)).length; } catch { return 0; } };
  let scenes = 10;
  try { scenes = JSON.parse(readFileSync(join(dir, "story.json"), "utf8")).scenes.length || 10; } catch { /* not written yet */ }
  const images = count("scenes", /^\d+\.png$/);
  const done = [
    has("chain/subject.txt") || has("chain/topic_editor.txt"),
    has("chain/copywriter.txt"),
    has("chain/hook_auditor.txt") && has("chain/fact_checker.txt") && has("chain/storyboard_artist.txt"),
    images >= scenes,
    count("audio", /^\d+\.wav$/) >= scenes,
    has("final.mp4"),
    has("chain/qc_inspector.txt"),
    Boolean(published),
  ];
  const now = done.indexOf(false);
  return { steps: done.map((d, i) => (d ? "done" : i === now ? "now" : "todo")), images: { done: images, total: scenes } };
}

/** Latest known views per platform (null = never counted) and their sum, for the green tiles. */
function viewsOf(id) {
  const rows = all(`${LATEST_METRICS} WHERE m.video_id = ?`, [id]);
  const by = { youtube: null, instagram: null, tiktok: null };
  for (const r of rows) if (r.views != null && r.platform in by) by[r.platform] = Number(r.views);
  const known = Object.values(by).filter((n) => n !== null);
  return { ...by, total: known.length ? known.reduce((a, b) => a + b, 0) : null };
}

/** Per platform: "ok", "fail" (the last upload of that video failed there) or null, from data/publish-direct.jsonl. */
function netsOf(id, links) {
  const out = { youtube: links?.youtube ? "ok" : null, instagram: links?.instagram ? "ok" : null, tiktok: links?.tiktok ? "ok" : null };
  try {
    for (const l of readFileSync(join(ROOT, "data", "publish-direct.jsonl"), "utf8").split("\n")) {
      if (!l.includes(`"${id}"`)) continue;
      const j = JSON.parse(l);
      for (const n of j.nets ?? []) if (n && typeof n === "object" && n.publie === false && !out[n.reseau]) out[n.reseau] = "fail";
    }
  } catch { /* no journal yet */ }
  return out;
}

/** Rough progress (0-1) of a narrated story from its files: the 6 agent steps, stills, voice, captions, motion, final cut. */
function progressOf(id) {
  if (!SAFE_ID.test(id)) return null;
  const dir = join(MEDIA, id);
  if (!existsSync(join(dir, "chain")) && !existsSync(join(dir, "story.json"))) return null;
  const has = (p) => existsSync(join(dir, p));
  const count = (sub, re) => { try { return readdirSync(join(dir, sub)).filter((f) => re.test(f)).length; } catch { return 0; } };
  let scenes = 10;
  try { scenes = JSON.parse(readFileSync(join(dir, "story.json"), "utf8")).scenes.length || 10; } catch { /* not written yet */ }
  const agents = ["copywriter", "hook_auditor", "fact_checker", "storyboard_artist"].filter((a) => has(`chain/${a}.txt`)).length + (has("chain/subject.txt") ? 2 : 0);
  const done = agents + 3 * Math.min(1, count("scenes", /^\d+\.png$/) / scenes) + (count("audio", /^\d+\.wav$/) >= scenes ? 1 : 0)
    + (has("captions.ass") ? 1 : 0) + Math.min(1, count("clips", /^\d+\.mp4$/) / scenes) + (has("final.mp4") ? 1 : 0);
  return Math.round((done / 13) * 100) / 100;
}

/** The active concept's cast in the side panel's shape {heroes:[{id,name,line,images}], voices, voice, promo_voices}
 *  (office/src/panel/SidePanel.tsx consumes it), plus active {id, name_fr, since, hook_prefix}.
 *  2026-10-24 (the concept is a parameter): heroes = the members of concept/<active>/cast.json (core/concept.mjs loadConcept,
 *  the hero first), each with its PNGs from concept/<active>/cast/<member>/ served under /concept/<active>/cast/<member>/…;
 *  voice = the concept's narrator id (concept.json voice.id, the string hero.json gave before). The 21/10 hero gallery
 *  (concept/heroes/<id>/) is no longer listed. Cached 10 s; a concept that fails to load gives an empty cast, never a 500. */
const CONCEPT_CACHE_MS = 10_000;
let conceptCache = { at: 0, value: null, error: null };
function readConcept() {
  if (conceptCache.value && Date.now() - conceptCache.at < CONCEPT_CACHE_MS) return conceptCache.value;
  const list = (dir) => { try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
  const names = (dir, exts) => list(dir).filter((f) => f.isFile() && SAFE_ID.test(f.name) && exts.includes(extname(f.name).toLowerCase())).map((f) => f.name).sort();
  // concept/voices (narrator samples) and, since 2026-10-22, concept/promo-voices for the next promo (the owner chooses; never the narrator).
  const samples = (sub) => names(join(CONCEPT, sub), [".wav", ".mp3"]).map((n) => ({ name: n.replace(/\.[^.]+$/, ""), url: `/concept/${sub}/${n}` }));
  let heroes = [];
  let voice = null;
  let active = null;
  try {
    clearConceptCache(); // `node core/concept.mjs activate` runs in another process: re-read active.json and the concept files
    const c = loadConcept();
    const members = Object.entries(c.cast.members).sort(([a], [b]) => Number(b === c.hero) - Number(a === c.hero));
    heroes = members.map(([id, m]) => ({
      id,
      name: String(m.name).slice(0, 60),
      line: `${m.role} — ${String(m.lock ?? "").slice(0, 120)}`,
      images: names(join(c.dir, "cast", id), [".png", ".jpg", ".webp"]).map((n) => `/${c.rel}/cast/${id}/${n}`),
    }));
    voice = c.voice.id;
    active = { id: c.id, name_fr: c.name_fr ?? c.name ?? null, since: activeSince(c.id) ?? c.since ?? null, hook_prefix: c.format.hook_prefix ?? null };
    conceptCache.error = null;
  } catch (err) {
    // Said once per distinct problem (the state is polled every few seconds); the panel then shows no cast.
    if (conceptCache.error !== err.message) console.error(`[office] active concept unreadable: ${err.message}`);
    conceptCache.error = err.message;
  }
  conceptCache = { ...conceptCache, at: Date.now(), value: { heroes, voices: samples("voices"), voice, promo_voices: samples("promo-voices"), active } };
  return conceptCache.value;
}
/** concept/active.json "since" (when it became the active concept), only when it names this concept (STUDIO_CONCEPT may override it). */
function activeSince(id) {
  try {
    const a = JSON.parse(readFileSync(join(CONCEPT, "active.json"), "utf8"));
    return a.id === id && typeof a.since === "string" ? a.since : null;
  } catch { return null; }
}

/** The "coulisses" films (media/coulisses/run-<stamp>/), newest first, once both cuts exist. */
const COULISSES = join(MEDIA, "coulisses");
const COULISSES_FILES = new Set(["coulisses-accelere.mp4", "coulisses-temps-reel.mp4", "cover.jpg"]);
function readCoulisses() {
  let dirs = [];
  try { dirs = readdirSync(COULISSES, { withFileTypes: true }).filter((d) => d.isDirectory() && /^run-\d{12}$/.test(d.name)); } catch { return []; }
  return dirs
    .filter((d) => existsSync(join(COULISSES, d.name, "coulisses-accelere.mp4")) && existsSync(join(COULISSES, d.name, "coulisses-temps-reel.mp4")))
    .map((d) => {
      let info = {};
      try { info = JSON.parse(readFileSync(join(COULISSES, d.name, "info.json"), "utf8")); } catch { /* no info */ }
      return {
        run: d.name,
        at: typeof info.recorded_from === "string" ? info.recorded_from : null,
        seconds: Number.isFinite(info.seconds) ? info.seconds : null,
        fast: `/coulisses/${d.name}/coulisses-accelere.mp4`,
        full: `/coulisses/${d.name}/coulisses-temps-reel.mp4`,
        cover: existsSync(join(COULISSES, d.name, "cover.jpg")) ? `/coulisses/${d.name}/cover.jpg` : null,
      };
    })
    .sort((a, b) => b.run.localeCompare(a.run))
    .slice(0, 5);
}

/** One point per published post: its release hour (studio time), platform and latest view count. */
function viewsByHour() {
  const latest = new Map(all(LATEST_METRICS).map((m) => [`${m.video_id}|${m.platform}`, m.views]));
  return all("SELECT p.video_id, p.platform, p.published_at, v.topic FROM posts p LEFT JOIN videos v ON v.id = p.video_id WHERE p.published_at IS NOT NULL").map((p) => {
    const t = Date.parse(p.published_at);
    const title = String(p.topic ?? p.video_id).replace(/^\s*\[[^\]]*\]\s*/, "").slice(0, 80);
    return Number.isFinite(t) ? { h: studioHour(t), platform: p.platform, views: latest.get(`${p.video_id}|${p.platform}`) ?? null, title } : null;
  }).filter(Boolean);
}

/** Three status lights: the Windows tasks (the publication task writes its log every 10 min), ComfyUI, this server. */
let comfyHealth = { at: 0, ok: false };
async function probeComfy() {
  try { comfyHealth = { at: Date.now(), ok: (await fetch("http://127.0.0.1:8188/system_stats", { signal: AbortSignal.timeout(2500) })).ok }; } catch { comfyHealth = { at: Date.now(), ok: false }; }
}
probeComfy();
setInterval(probeComfy, 30_000).unref();
function health() {
  let tasks = false;
  try { tasks = Date.now() - statSync(join(ROOT, "data", "daily", "task-publish.log")).mtimeMs < 25 * 60_000; } catch { /* no log yet */ }
  return { tasks, comfy: comfyHealth.ok, server: true };
}

/** Promo films (media/promo/promo-<stamp>.mp4, workshop/promo/render.mjs), newest first. Never published automatically. */
const PROMO = join(MEDIA, "promo");
function readPromos() {
  try {
    // -voix2: the same promo with the spare narrator (2026-10-22), shown next to the main one.
    return readdirSync(PROMO).filter((f) => /^promo(3d)?-\d{12}(-voix2)?\.mp4$/.test(f)).sort().reverse().slice(0, 4)
      .map((f) => ({ name: f, three_d: f.startsWith("promo3d"), spare: f.includes("-voix2"), url: `/promo-video/${f}`, cover: existsSync(join(PROMO, f.replace(".mp4", ".jpg"))) ? `/promo-video/${f.replace(".mp4", ".jpg")}` : null }));
  } catch { return []; }
}

function productionPaused() {
  try { return JSON.parse(readFileSync(PAUSE_FILE, "utf8")); } catch { return existsSync(PAUSE_FILE) ? { since: null } : null; }
}

function readState() {
  const exists = existsSync(DB_PATH) && openDb() !== null;
  const latest = all(LATEST_METRICS);
  const viewsByVideo = new Map();
  for (const r of latest) {
    if (r.views == null) continue;
    viewsByVideo.set(r.video_id, (viewsByVideo.get(r.video_id) ?? 0) + Number(r.views));
  }
  const openVideos = all("SELECT id, topic, lane, status, updated_at FROM videos WHERE status NOT IN ('published', 'rejected') ORDER BY updated_at DESC LIMIT 10");
  const pubs = publications();
  const ytLinks = new Map(all("SELECT video_id, url FROM posts WHERE platform = 'youtube' AND url IS NOT NULL").map((p) => [p.video_id, p.url]));
  const videos = all("SELECT id, topic, lane, status, created_at, updated_at FROM videos WHERE status NOT IN ('superseded', 'rejected') ORDER BY updated_at DESC LIMIT 10").map((v) => ({
    ...v,
    publish: pubs.get(v.id) ?? null,
    cover: coverFor(String(v.id)),
    // Tap target on the wall: the YouTube post once published, else our own final cut.
    link: ytLinks.get(v.id) ?? (SAFE_ID.test(String(v.id)) && existsSync(join(MEDIA, String(v.id), "final.mp4")) ? `/media/${encodeURIComponent(v.id)}/final.mp4` : null),
    views: viewsByVideo.has(v.id) ? viewsByVideo.get(v.id) : null,
  }));
  // Every video (closed ones too), so a published or superseded media folder is never shown as "in production".
  const renders = files.renders(all("SELECT id, topic, lane, status, updated_at FROM videos"));
  const production = files.production(renders);
  const pendingCount = Number(one("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'")?.n ?? 0);
  // Code-only renders run no agent: the agent of the current step is shown working; a stale "Waiting for <owner>" is cleared.
  const agents = all("SELECT id, team, label, state, task, video_id, updated_at FROM agents ORDER BY team, id").map((a) => {
    if (production && a.id === production.agent) return { ...a, state: "working", task: production.text, video_id: production.video_id };
    if (a.state === "waiting" && /^Waiting for (the owner|you|approval)\b/i.test(a.task ?? "") && !pendingCount) {
      return { ...a, state: production ? "working" : "idle", task: production ? `Production: ${production.title ?? production.video_id}` : null };
    }
    return a;
  });
  return {
    // Each agent with its model and effort from core/agents-models.json.
    agents: files.withModels(agents),
    // What the PC is making right now (title, step, ETA), or null.
    production,
    // The owner's production pause (data/production-paused.json) or null.
    production_paused: productionPaused(),
    queue: readQueue(),
    concept: readConcept(),
    coulisses: readCoulisses(),
    // Per network: videos owed and hold end (core/publish-direct.mjs writes it each pass): a calm waiting state, not a problem.
    net_status: (() => { try { return JSON.parse(readFileSync(join(ROOT, "data", "net-status.json"), "utf8")); } catch { return null; } })(),
    promos: readPromos(),
    views_by_hour: viewsByHour(),
    // The benchmark from the Trending wall (core/mission.mjs): median views of trending Shorts up to 7 days old.
    benchmark: (() => { try { return JSON.parse(readFileSync(join(ROOT, "data", "mission.json"), "utf8")).benchmark ?? null; } catch { return null; } })(),
    health: health(),
    // The owner's Claude plan (5-hour and weekly windows, from Claude Code's own output) and the day's tokens per hour.
    claude: { plan: readPlanFiles(ROOT), tokens: claudeStats.tokens() },
    // Videos in production with shot-by-shot render progress read from media/<video_id>/ (cached a few seconds).
    renders,
    // Approvals held until morning (data/approvals-queue.jsonl), not released yet.
    approvals_queue: files.approvalsQueue(),
    // data/runs.jsonl, counted by UTC date like core/run-agent.mjs; max from core/agents-models.json.
    runs_today: files.runsToday(),
    // data/paused.json while its "until" is still ahead, else null.
    paused: files.paused(),
    // core/daily.json: automatic mode, window, next render slot and script phase, quiet hours (studio time zone).
    schedule: files.schedule(),
    // Newest data/daily/*.log (time and last lines), or null.
    daily_log: files.dailyLog(),
    // Last error events (newest first).
    // Errors of the last 6 hours only, and none from before the old format was retired. An error is solved (not shown) once
    // the same agent has succeeded since: a publication went out, or it finished a task (an error already fixed must not linger).
    errors: all(
      `SELECT id, at, agent, video_id, text FROM events e WHERE kind = 'error' AND demo = 0 AND at >= ?
         AND (e.video_id IS NULL OR e.video_id NOT LIKE 'r-%')
         AND id > COALESCE((SELECT MAX(id) FROM events WHERE text LIKE 'Ancien format retiré%'), 0)
         AND NOT EXISTS (SELECT 1 FROM events s WHERE s.agent = e.agent AND s.id > e.id AND s.demo = 0
           AND ((s.kind = 'publish' AND s.text LIKE '%published:%') OR s.kind = 'run_end'))
         ORDER BY id DESC LIMIT ?`,
      [new Date(Date.now() - 6 * 3600_000).toISOString(), ERRORS_SHOWN],
    ),
    videos,
    approvals: all(
      `SELECT a.id, a.ref, a.video_id, a.kind, a.status, a.note, a.created_at, v.topic
       FROM approvals a LEFT JOIN videos v ON v.id = a.video_id
       WHERE a.status = 'pending' ORDER BY a.created_at`,
    ),
    posts: readPosts(),
    metrics: metricsByPlatform(latest),
    // "Statistiques" (2026-10-23): views per network over the week, totals and followers with the change since yesterday,
    // top 5 videos, and the decisions the analysis applied on its own.
    stats: (() => { try { return buildStats((sql, p) => all(sql, p ?? []), ROOT, MEDIA); } catch { return null; } })(),
    // Top Shorts of the latest trend scan (core/trends.mjs). Strangers' titles: shown as text only.
    trends: readTrends(),
    // What each desk screen shows: the real work of the video its agent last touched (office/desk-work.mjs).
    desk_work: deskWork(agents, MEDIA, readTrends()),
    // Latest scan: how many Shorts, and how many are usable for the show (usable = 1). Null before the flag columns exist.
    trends_count: one(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN usable = 1 THEN 1 ELSE 0 END) AS usable FROM trends
       WHERE scanned_at = (SELECT MAX(scanned_at) FROM trends)`,
    ),
    recent: all("SELECT id, at, kind, agent, to_agent, video_id, text FROM events WHERE demo = 0 ORDER BY id DESC LIMIT ?", [RECENT]).reverse(),
    last_event_id: lastEventId(),
    db: exists,
  };
}

function eventsAfter(after) {
  return all("SELECT id, at, kind, agent, to_agent, video_id, text FROM events WHERE id > ? AND demo = 0 ORDER BY id LIMIT ?", [after, MAX_BATCH]);
}

// ---------- Stop (the one write, done by core/approve.mjs) ----------

const STOP_BODY_MAX = 2048;
const STOP_TIMEOUT_MS = 20_000;
let stopBusy = false;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > STOP_BODY_MAX) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleStop(req, res) {
  if (!OFFICE_KEY || !hasKey(req)) return send(res, 401, "Access key required");
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, "Forbidden origin");
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return send(res, 415, "JSON only");
  if (stopBusy) return send(res, 429, "A stop is already running");
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, "Bad JSON"); }
  const ref = typeof body?.ref === "string" ? body.ref : "";
  if (!/^ap-\d{1,9}$/.test(ref)) return send(res, 400, "ref must be ap-N");
  const note = typeof body?.note === "string" ? body.note.replace(/[\r\n]+/g, " ").replace(/^-+/, "").trim().slice(0, 200) : "";
  const args = ["--no-warnings", join(ROOT, "core", "approve.mjs"), "stop", ref, ...(note ? [note] : []), "--source", "vitrine"];
  const env = { ...process.env, ...(dbArg > 0 ? { STUDIO_DB: DB_PATH } : {}) };
  stopBusy = true;
  execFile(process.execPath, args, { cwd: ROOT, env, timeout: STOP_TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
    stopBusy = false;
    const out = String(stdout || stderr || (err ? err.message : "")).trim().slice(0, 400);
    console.log(`[office] stop ${ref}: ${err ? "failed" : "ok"}: ${out}`);
    send(res, err ? 400 : 200, JSON.stringify({ ok: !err, message: out }), "application/json; charset=utf-8");
  });
}

// ---------- Pause / Reprendre (core/job.mjs does the write) ----------

let pauseBusy = false;
/** POST /api/pause {paused: true|false}: local page (127.0.0.1/localhost) or the access key; same origin, JSON only. */
async function handlePause(req, res) {
  const local = req.headers.host === `${HOST}:${PORT}` || req.headers.host === `localhost:${PORT}`;
  if (!local && !hasKey(req)) return send(res, 401, "Access key required");
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, "Forbidden origin");
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return send(res, 415, "JSON only");
  if (pauseBusy) return send(res, 429, "Busy");
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, "Bad JSON"); }
  if (typeof body?.paused !== "boolean") return send(res, 400, "paused must be true or false");
  pauseBusy = true;
  const args = ["--no-warnings", join(ROOT, "core", "job.mjs"), body.paused ? "pause" : "resume", "--source", "vitrine"];
  execFile(process.execPath, args, { cwd: ROOT, timeout: STOP_TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
    pauseBusy = false;
    const out = String(stdout || stderr || (err ? err.message : "")).trim().slice(0, 300);
    console.log(`[office] ${body.paused ? "pause" : "resume"}: ${err ? "failed" : "ok"}: ${out}`);
    send(res, err ? 500 : 200, JSON.stringify({ ok: !err, paused: body.paused }), "application/json; charset=utf-8");
  });
}

// ---------- Trend thumbnails (YouTube's public hqdefault.jpg, fetched once into data/thumbs) ----------

const THUMBS = join(ROOT, "data", "thumbs");
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const thumbFetching = new Map();
async function serveThumb(res, file, method) {
  const id = file.replace(/\.jpg$/, "");
  if (!YT_ID.test(id) || file !== `${id}.jpg`) return send(res, 404, "Not found");
  const local = join(THUMBS, file);
  if (!existsSync(local)) {
    try {
      if (!thumbFetching.has(id)) {
        thumbFetching.set(id, (async () => {
          const r = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, { signal: AbortSignal.timeout(8000) });
          if (!r.ok || !/^image\/jpeg/.test(r.headers.get("content-type") ?? "")) throw new Error(`thumbnail ${r.status}`);
          mkdirSync(THUMBS, { recursive: true });
          writeFileSync(local, Buffer.from(await r.arrayBuffer()));
        })().finally(() => thumbFetching.delete(id)));
      }
      await thumbFetching.get(id);
    } catch {
      return send(res, 404, "Not found");
    }
  }
  return serveFile(res, local, method);
}

// ---------- HTTP ----------

function send(res, status, body, type = "text/plain; charset=utf-8", extra = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...SECURITY_HEADERS, ...extra });
  res.end(body);
}

function json(res, value) {
  send(res, 200, JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), "application/json; charset=utf-8");
}

/** A file under `base`, or null when the path escapes it or is not a plain file. */
function safeFile(base, rel) {
  const full = normalize(join(base, rel));
  if (full !== base && !full.startsWith(base.endsWith(sep) ? base : base + sep)) return null;
  try {
    return statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

// The 3D room page (public/salle.html, 2026-10-24): framed by the vitrine itself, inline scripts, three.js from jsDelivr, Inter font.
const SALLE_HEADERS = {
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' data: blob:; frame-ancestors 'self'",
};

function serveFile(res, file, method) {
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) return send(res, 404, "Not found");
  const body = readFileSync(file);
  const extra = file === join(PUBLIC, "salle.html") ? SALLE_HEADERS : {};
  res.writeHead(200, { "Content-Type": type, "Content-Length": body.length, "Cache-Control": "no-cache", ...SECURITY_HEADERS, ...extra });
  res.end(method === "HEAD" ? undefined : body);
}

function serveEvents(req, res, url) {
  const raw = url.searchParams.get("after");
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
  // No starting point: start from the newest event so old history never replays as live motion.
  let after = Number.isFinite(parsed) && parsed >= 0 ? parsed : lastEventId();

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    ...SECURITY_HEADERS,
  });
  res.write(`retry: 2000\n: connected after ${after}\n\n`);

  const poll = () => {
    for (const row of eventsAfter(after)) {
      const id = Number(row.id);
      after = Math.max(after, id);
      res.write(`id: ${id}\ndata: ${JSON.stringify({ ...row, id })}\n\n`);
    }
  };
  poll();
  const pollTimer = setInterval(poll, POLL_MS);
  const beatTimer = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), HEARTBEAT_MS);
  const stop = () => {
    clearInterval(pollTimer);
    clearInterval(beatTimer);
  };
  req.on("close", stop);
  res.on("error", stop);
}

const server = createServer((req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host ?? "")) return send(res, 403, "Forbidden host");
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    if (req.method === "POST" && url.pathname === "/api/stop") {
      handleStop(req, res).catch((err) => {
        stopBusy = false;
        console.error(`[office] stop failed: ${err.message}`);
        if (!res.headersSent) send(res, 500, "Server error");
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/pause") {
      handlePause(req, res).catch((err) => {
        pauseBusy = false;
        console.error(`[office] pause failed: ${err.message}`);
        if (!res.headersSent) send(res, 500, "Server error");
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Read-only server", "text/plain; charset=utf-8", { Allow: "GET, HEAD, POST /api/stop, POST /api/pause" });
    if (!keyOk(req, url, res)) return send(res, 401, "Access key required");
    const path = decodeURIComponent(url.pathname);

    if (path === "/api/state") return json(res, { ...readState(), can_stop: Boolean(OFFICE_KEY) && hasKey(req) });
    if (path === "/api/events") return serveEvents(req, res, url);

    if (path.startsWith("/media/")) {
      const [, , videoId, name, ...rest] = path.split("/");
      // media/<id>/scenes/NN.png: the stills on the image artist's and animator's desk screens.
      if (name === "scenes" && rest.length === 1 && SAFE_ID.test(videoId ?? "") && /^d{2}.(png|jpg)$/.test(rest[0])) {
        const scene = safeFile(MEDIA, join(videoId, "scenes", rest[0]));
        return scene ? serveFile(res, scene, req.method) : send(res, 404, "Not found");
      }
      if (rest.length || !videoId || !name || !SAFE_ID.test(videoId) || !SAFE_ID.test(name)) return send(res, 404, "Not found");
      if (!COVER_EXTS.includes(extname(name).toLowerCase()) && name !== "final.mp4") return send(res, 404, "Not found");
      const file = safeFile(MEDIA, join(videoId, name));
      return file ? serveFile(res, file, req.method) : send(res, 404, "Not found");
    }

    if (path.startsWith("/thumb/")) return serveThumb(res, path.slice(7), req.method);

    if (path.startsWith("/promo-video/")) {
      const name = path.slice("/promo-video/".length);
      if (!/^promo(3d)?-\d{12}(-voix2)?\.(mp4|jpg)$/.test(name)) return send(res, 404, "Not found");
      const file = safeFile(PROMO, name);
      return file ? serveFile(res, file, req.method) : send(res, 404, "Not found");
    }

    if (path.startsWith("/coulisses/")) {
      const [, , run, name, ...rest] = path.split("/");
      if (rest.length || !/^run-\d{12}$/.test(run ?? "") || !COULISSES_FILES.has(name ?? "")) return send(res, 404, "Not found");
      const file = safeFile(COULISSES, join(run, name));
      return file ? serveFile(res, file, req.method) : send(res, 404, "Not found");
    }

    if (path.startsWith("/concept/")) {
      const parts = path.split("/").slice(2);
      // Depth 5 since 2026-10-24: cast sheets live at concept/<id>/cast/<member>/<file>.png (SAFE_ID and CONCEPT_FILES unchanged).
      if (!parts.length || parts.length > 5 || !parts.every((p) => SAFE_ID.test(p))) return send(res, 404, "Not found");
      if (!CONCEPT_FILES.includes(extname(parts.at(-1)).toLowerCase())) return send(res, 404, "Not found");
      const file = safeFile(CONCEPT, join(...parts));
      return file ? serveFile(res, file, req.method) : send(res, 404, "Not found");
    }

    const rel = path === "/" ? "index.html" : path.slice(1);
    const file = safeFile(PUBLIC, rel);
    return file ? serveFile(res, file, req.method) : send(res, 404, "Not found");
  } catch (err) {
    console.error(`[office] ${req.method} ${req.url} failed: ${err.message}`);
    if (!res.headersSent) send(res, 500, "Server error");
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[office] http://${HOST}:${PORT}  (demo: http://${HOST}:${PORT}/?demo=1)`);
  console.log(`[office] database: ${existsSync(DB_PATH) ? DB_PATH : "not created yet, serving empty state"} (read-only)`);
});
let tailServer = null;
// At logon the VPN may not have its address yet: the tailnet listen throws EADDRNOTAVAIL. The local server stays up
// and the tailnet one retries.
const TAILNET_RETRY_MS = 30_000;
function listenTailnet(attempt = 1) {
  tailServer = createServer((req, res) => server.emit("request", req, res));
  tailServer.on("error", (err) => {
    if (err.code !== "EADDRNOTAVAIL" && err.code !== "EADDRINUSE") { console.error(`[office] tailnet: ${err.message}`); return; }
    if (attempt === 1) console.error(`[office] tailnet ${TAILNET} not available yet (${err.code}): retrying every ${TAILNET_RETRY_MS / 1000} s`);
    setTimeout(() => listenTailnet(attempt + 1), TAILNET_RETRY_MS);
  });
  tailServer.listen(PORT, TAILNET, () => console.log(`[office] tailnet: http://${TAILNET}:${PORT} (access key required)${attempt > 1 ? ` after ${attempt} tries` : ""}`));
}
if (TAILNET) listenTailnet();

const shutdown = () => {
  server.close();
  try {
    db?.close();
  } catch {
    // Already closed.
  }
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
