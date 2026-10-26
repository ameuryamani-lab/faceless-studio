// Faceless Studio office: the live extras that live in files, not in the database. Read-only, cheap, cached a few
// seconds. Sources: core/agents-models.json, core/daily.json, data/runs.jsonl, data/paused.json,
// data/approvals-queue.jsonl, data/daily/*.log and media/<video_id>/ (keyframes/shotNN/, clips/, log.md) with the shot
// list (media/<id>/storyboard.json). Nothing here writes, deletes or starts anything.

import { existsSync, openSync, readSync, closeSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TIMEZONE, studioDay, studioHour } from "../core/studio-time.mjs";

const CACHE_MS = 4000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const LOG_TAIL_BYTES = 8 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const MAX_RENDERS = 4;
const MAX_QUEUE = 20;
const RENDER_LIVE_MS = 30 * 60_000;   // a file written in the last 30 min = "rendering now"
const MEDIA_RECENT_MS = 14 * 86_400_000; // media folders untouched for 2 weeks are history
const CLOSED_STATUSES = new Set(["published", "rejected", "superseded"]);

// ---------- small safe readers ----------

/** Reads at most `limit` bytes; from the end when `tail` is set. Null when missing or unreadable. */
function readText(file, { limit = MAX_TEXT_BYTES, tail = false } = {}) {
  let fd;
  try {
    const size = statSync(file).size;
    const len = Math.min(size, limit);
    const buf = Buffer.alloc(len);
    fd = openSync(file, "r");
    readSync(fd, buf, 0, len, tail ? size - len : 0);
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function readJsonl(file) {
  const text = readText(file, { tail: true });
  if (!text) return [];
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === "object") rows.push(row);
    } catch {
      // A half-written or cut line (tail read) is skipped.
    }
  }
  return rows;
}

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function mtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

const str = (v, max = 200) => (typeof v === "string" ? (v.length > max ? `${v.slice(0, max - 1)}…` : v) : null);
const iso = (ms) => (ms > 0 ? new Date(ms).toISOString() : null);
const pad2 = (n) => String(n).padStart(2, "0");

function cached(fn, ms = CACHE_MS) {
  let at = 0;
  let value;
  return (...args) => {
    const now = Date.now();
    if (now - at > ms) {
      value = fn(...args);
      at = now;
    }
    return value;
  };
}

// ---------- agents, runs, pause, queue, daily log ----------

export function makeStudioFiles(root) {
  const CORE = join(root, "core");
  const DATA = join(root, "data");
  const MEDIA = join(root, "media");

  const models = cached(() => {
    const cfg = readJson(join(CORE, "agents-models.json")) ?? {};
    const agents = cfg.agents && typeof cfg.agents === "object" ? cfg.agents : {};
    const maxRuns = Number(cfg.limits?.max_runs_per_day);
    return { agents, maxRuns: Number.isFinite(maxRuns) && maxRuns > 0 ? maxRuns : null, fallback: str(cfg.fallback_model, 40) };
  });

  /** Adds model and effort (core/agents-models.json) to each agent row. */
  function withModels(agents) {
    const { agents: picks } = models();
    return agents.map((a) => {
      const pick = picks[a.id] ?? {};
      return { ...a, model: str(pick.model, 40), effort: str(pick.effort, 40) };
    });
  }

  /** Same rule as core/run-agent.mjs: runs counted by UTC date in data/runs.jsonl. */
  const runsToday = cached(() => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = readJsonl(join(DATA, "runs.jsonl")).filter((r) => r.date === today);
    const last = rows.at(-1);
    // Usage per run (core/run-agent.mjs JSON output, since 2026-10-21 22:50 local): tokens, duration, API-equivalent cost.
    const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const tok = (r) => num(r.input_tokens) + num(r.output_tokens) + num(r.cache_read_tokens) + num(r.cache_write_tokens);
    const group = (key) => {
      const m = new Map();
      for (const r of rows) {
        const k = str(r[key], 60) ?? "?";
        const g = m.get(k) ?? { name: k, runs: 0, tokens: 0 };
        g.runs += 1;
        g.tokens += tok(r);
        m.set(k, g);
      }
      return [...m.values()].sort((a, b) => b.runs - a.runs || b.tokens - a.tokens);
    };
    const reset = new Date(`${today}T00:00:00Z`);
    reset.setUTCDate(reset.getUTCDate() + 1);
    return {
      date: today,
      used: rows.length,
      max: models().maxRuns,
      rate_limited: rows.filter((r) => r.rate_limited === true).length,
      failed: rows.filter((r) => typeof r.code === "number" && r.code !== 0).length,
      last_at: str(last?.at, 40),
      last_agent: str(last?.agent, 60),
      reset_at: reset.toISOString(),
      measured: rows.filter((r) => typeof r.input_tokens === "number").length,
      tokens: {
        input: rows.reduce((n, r) => n + num(r.input_tokens), 0),
        output: rows.reduce((n, r) => n + num(r.output_tokens), 0),
        cache: rows.reduce((n, r) => n + num(r.cache_read_tokens) + num(r.cache_write_tokens), 0),
      },
      api_equiv_usd: Number(rows.reduce((n, r) => n + num(r.api_equiv_usd), 0).toFixed(2)),
      by_agent: group("agent").slice(0, 8),
      by_model: group("model"),
      // Runs per studio-time hour since midnight (core/local-config.mjs TIMEZONE), for the vitrine's bar.
      by_hour: Array.from({ length: 24 }, (_, h) => readJsonl(join(DATA, "runs.jsonl")).filter((r) => {
        const t = Date.parse(r.at ?? "");
        if (!Number.isFinite(t)) return false;
        return studioDay(t) === studioDay() && studioHour(t) === h;
      }).length),
      recent: rows.slice(-5).reverse().map((r) => ({ at: str(r.at, 40), agent: str(r.agent, 60), model: str(r.model, 40), tokens: tok(r) || null, seconds: r.duration_ms ? Math.round(r.duration_ms / 1000) : null, ok: r.code === 0 })),
    };
  });

  /** data/paused.json, only while its `until` is still ahead. */
  const paused = cached(() => {
    const p = readJson(join(DATA, "paused.json"));
    const until = str(p?.until, 40);
    if (!until || Number.isNaN(Date.parse(until)) || Date.parse(until) <= Date.now()) return null;
    return { until, reason: str(p.reason, 200), at: str(p.at, 40) };
  }, 2000);

  /** Approvals held back until morning (data/approvals-queue.jsonl), not released yet, soonest first. */
  // Each request is a "queued" line; a later "released" or "cancelled" line with the same id closes it.
  const approvalsQueue = cached(() => {
    const rows = readJsonl(join(DATA, "approvals-queue.jsonl"));
    const closed = new Set(rows.filter((r) => r.type === "released" || r.type === "cancelled").map((r) => r.id));
    return rows
      .filter((r) => r.type === "queued" && !closed.has(r.id))
      .map((r) => ({
        kind: str(r.kind, 40) ?? "approval",
        video_id: str(r.video_id, 90),
        agent: str(r.agent, 60),
        text: str(r.text, 200),
        queued_at: str(r.queued_at, 40),
        release_at: str(r.release_at, 40),
      }))
      .sort((a, b) => String(a.release_at ?? "").localeCompare(String(b.release_at ?? "")))
      .slice(0, MAX_QUEUE);
  });

  /** Newest data/daily/*.log: its time and its last 3 lines. */
  const dailyLog = cached(() => {
    const dir = join(DATA, "daily");
    const logs = listDir(dir)
      .filter((d) => d.isFile() && d.name.endsWith(".log"))
      .map((d) => ({ name: d.name, at: mtime(join(dir, d.name)) }))
      .sort((a, b) => b.at - a.at);
    if (!logs.length) return null;
    const text = readText(join(dir, logs[0].name), { limit: LOG_TAIL_BYTES, tail: true }) ?? "";
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-3).map((l) => str(l, 180));
    return { file: logs[0].name, at: iso(logs[0].at), tail: lines };
  });

  // ---------- render progress per video ----------

  function shotList(id) {
    const sb = readJson(join(MEDIA, id, "storyboard.json"));
    const shots = Array.isArray(sb?.shots)
      ? sb.shots.map((s, i) => ({ n: Number(s?.n ?? i + 1), ...clipNeed(s) })).filter((s) => Number.isInteger(s.n) && s.n > 0)
      : [];
    return shots.length ? { shots, title: str(sb.title, 140), source: "storyboard" } : null;
  }

  /** Rejected takes named in log.md ("Shot 07 take a rejected"), and GPU seconds per keyframe batch and per clip. */
  function readLog(dir) {
    const text = readText(join(dir, "log.md"), { limit: 512 * 1024 }) ?? "";
    const rejected = new Set();
    for (const m of text.matchAll(/shot\s*0*(\d+)\s+take\s+([a-z0-9]+)\s+rejected/gi)) rejected.add(`${Number(m[1])}-${m[2].toLowerCase()}`);
    const gpu = (re) => [...text.matchAll(re)].map((m) => Number(m[1])).filter((n) => n > 0);
    return {
      rejected,
      keyframeSecs: gpu(/keyframes shot[^\n]*?GPU\s+(\d+(?:\.\d+)?)\s*s/gi),
      clipSecs: gpu(/Wan shot[^\n]*?GPU\s+(\d+(?:\.\d+)?)\s*s/gi),
      exists: text.length > 0,
    };
  }

  /**
   * Does this shot need a Wan clip? No for storyboard source "still"/"reuse", still: true, an explicit
   * needs_clip/clip/wan false, or a wan_action / motion_prompt that says "Skip Wan", "Still image" or "Reused clip".
   */
  function clipNeed(s) {
    if (!s || typeof s !== "object") return { needsClip: true, noClipReason: null };
    const source = String(s.source ?? "").trim().toLowerCase();
    if (source === "still" || source === "reuse") return { needsClip: false, noClipReason: source };
    if (s.still === true) return { needsClip: false, noClipReason: "still" };
    if (s.needs_clip === false || s.clip === false || s.wan === false) return { needsClip: false, noClipReason: "no clip" };
    const wan = String(s.wan_action ?? "");
    const motion = String(s.motion_prompt ?? "");
    if (/\bskip wan\b/i.test(wan)) return { needsClip: false, noClipReason: /push-?in/i.test(wan) ? "push-in" : "still" };
    if (/^\s*still image\b/i.test(motion)) return { needsClip: false, noClipReason: "still" };
    if (/^\s*reused? clip\b/i.test(motion)) return { needsClip: false, noClipReason: "reuse" };
    return { needsClip: true, noClipReason: null };
  }

  function mean(values) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  function renderProgress(id, dbVideo) {
    const dir = join(MEDIA, id);
    const kfDir = join(dir, "keyframes");
    const clipDir = join(dir, "clips");
    const list = shotList(id);
    const log = readLog(dir);
    let lastFile = 0;

    // Keyframes: keyframes/shotNN/pick.png (img2img, ep01 way) or keyframes/shotNN.png (t2i).
    const picked = new Set();
    const candidates = new Map();
    const seenShots = new Set();
    for (const d of listDir(kfDir)) {
      const m = /^shot(\d+)(\.png)?$/i.exec(d.name);
      if (!m) continue;
      const n = Number(m[1]);
      seenShots.add(n);
      if (d.isFile() && m[2]) {
        picked.add(n);
        lastFile = Math.max(lastFile, mtime(join(kfDir, d.name)));
      } else if (d.isDirectory()) {
        let count = 0;
        for (const f of listDir(join(kfDir, d.name))) {
          if (!f.isFile() || !/\.png$/i.test(f.name)) continue;
          lastFile = Math.max(lastFile, mtime(join(kfDir, d.name, f.name)));
          if (/^pick\.png$/i.test(f.name)) picked.add(n);
          else if (!/^(?:shot\d+-)?guide\w*\.png$|^pick-/i.test(f.name)) count += 1;
        }
        candidates.set(n, count);
      }
    }

    // Clips: clips/shotNN.mp4 or clips/shotNN-<take>.mp4; a take named "rejected" in log.md does not count.
    const takes = new Map();
    const clipSecs = [];
    const clipTimes = [];
    for (const f of listDir(clipDir)) {
      if (!f.isFile()) continue;
      const m = /^shot(\d+)(?:-([a-z0-9]+))?\.(mp4|json)$/i.exec(f.name);
      if (!m) continue;
      const n = Number(m[1]);
      const take = (m[2] ?? "").toLowerCase();
      seenShots.add(n);
      if (m[3].toLowerCase() === "json") {
        const meta = readJson(join(clipDir, f.name));
        if (typeof meta?.seconds === "number" && meta.seconds > 0) clipSecs.push(meta.seconds);
        continue;
      }
      const at = mtime(join(clipDir, f.name));
      lastFile = Math.max(lastFile, at);
      clipTimes.push(at);
      const entry = takes.get(n) ?? { good: 0, rejected: 0 };
      if (log.rejected.has(`${n}-${take}`)) entry.rejected += 1;
      else entry.good += 1;
      takes.set(n, entry);
    }

    const planned = list?.shots ?? [...seenShots].sort((a, b) => a - b).map((n) => ({ n, needsClip: true, noClipReason: null }));
    const shots = planned.map(({ n, needsClip, noClipReason }) => ({
      n,
      keyframe: picked.has(n),
      candidates: candidates.get(n) ?? 0,
      clip: (takes.get(n)?.good ?? 0) > 0,
      needs_clip: needsClip,
      no_clip_reason: noClipReason,
      rejected_takes: takes.get(n)?.rejected ?? 0,
    }));
    // Stills, reuses and push-ins need no Wan clip: they count as done and stay out of the ETA.
    const clipShots = shots.filter((s) => s.needs_clip);
    const clipsNeeded = clipShots.length;
    const clipsDone = clipShots.filter((s) => s.clip).length;
    const keyframesPicked = shots.filter((s) => s.keyframe).length;

    // Average GPU time per clip: clip sidecar JSON "seconds", else log.md, else gaps between clip file times.
    let avgClip = mean(clipSecs);
    let avgSource = avgClip !== null ? "clip logs" : null;
    if (avgClip === null && log.clipSecs.length) [avgClip, avgSource] = [mean(log.clipSecs), "log.md"];
    if (avgClip === null && clipTimes.length >= 2) {
      const sorted = [...clipTimes].sort((a, b) => a - b);
      const gaps = sorted.slice(1).map((t, i) => (t - sorted[i]) / 1000).filter((g) => g > 30 && g < 6 * 3600);
      if (gaps.length) [avgClip, avgSource] = [mean(gaps), "file times"];
    }
    const avgKeyframe = mean(log.keyframeSecs);
    const clipsLeft = clipsNeeded - clipsDone;
    const keyframesLeft = clipShots.filter((s) => !s.clip && !s.keyframe).length;
    let eta = null;
    if (clipsLeft > 0 && avgClip !== null) eta = clipsLeft * avgClip + (keyframesLeft > 0 && avgKeyframe !== null ? keyframesLeft * avgKeyframe : 0);
    if (clipsLeft === 0) eta = 0;

    const finalFile = listDir(dir).find((f) => f.isFile() && (/^final.*\.mp4$/i.test(f.name) || f.name.toLowerCase() === `${id.toLowerCase()}.mp4`));
    const derived = finalFile ? "edited" : shots.length && clipsLeft === 0 ? "animated" : list || keyframesPicked ? "storyboarded" : "idea";
    return {
      video_id: id,
      title: str(dbVideo?.topic, 140) ?? list?.title ?? null,
      status: dbVideo?.status ?? derived,
      status_source: dbVideo ? "db" : "files",
      shots_total: shots.length,
      shots_source: list?.source ?? (shots.length ? "folders" : null),
      keyframes_picked: keyframesPicked,
      clips_done: clipsDone,
      clips_needed: clipsNeeded,
      rejected_takes: shots.reduce((n, s) => n + s.rejected_takes, 0),
      shots,
      avg_clip_s: avgClip !== null ? Math.round(avgClip) : null,
      avg_clip_source: avgSource,
      avg_keyframe_s: avgKeyframe !== null ? Math.round(avgKeyframe) : null,
      eta_s: eta !== null ? Math.round(eta) : null,
      eta_partial: keyframesLeft > 0 && avgKeyframe === null && clipsLeft > 0,
      last_file_at: iso(lastFile),
      rendering_now: lastFile > 0 && Date.now() - lastFile < RENDER_LIVE_MS && clipsLeft > 0,
      finished: !!finalFile,
      has_log: log.exists,
    };
  }

  /** Videos in production: open DB videos plus media folders with keyframes/clips and no final cut. */
  const renders = cached((dbVideos) => {
    const byId = new Map(dbVideos.filter((v) => SAFE_ID.test(String(v.id))).map((v) => [String(v.id), v]));
    const ids = new Map();
    for (const v of byId.values()) if (!CLOSED_STATUSES.has(v.status)) ids.set(String(v.id), Date.parse(v.updated_at) || 0);
    for (const d of listDir(MEDIA)) {
      if (!d.isDirectory() || d.name.startsWith("_") || !SAFE_ID.test(d.name)) continue;
      const v = byId.get(d.name);
      if (v && CLOSED_STATUSES.has(v.status)) continue;
      const dir = join(MEDIA, d.name);
      const touched = Math.max(mtime(join(dir, "keyframes")), mtime(join(dir, "clips")));
      if (!touched || Date.now() - touched > MEDIA_RECENT_MS) continue;
      ids.set(d.name, Math.max(ids.get(d.name) ?? 0, touched));
    }
    return [...ids.entries()]
      .map(([id, at]) => ({ ...renderProgress(id, byId.get(id)), _at: at }))
      .filter((r) => r.status_source === "db" || !r.finished)
      .sort((a, b) => Math.max(Date.parse(b.last_file_at ?? "") || 0, b._at) - Math.max(Date.parse(a.last_file_at ?? "") || 0, a._at))
      .slice(0, MAX_RENDERS)
      .map(({ _at, ...r }) => r);
  });

  // ---------- PC schedule (core/daily.json) ----------

  const schedule = cached(() => buildSchedule(readJson(join(CORE, "daily.json")) ?? {}, new Date()));

  // ---------- live production (code-only renders run no agent, so the room is lit from the files) ----------

  const DEFAULT_CLIP_S = 17 * 60; // one Wan 2.2 clip at 6 steps on the RTX 5060 Ti (ComfyUI log, 21/10)
  const DEFAULT_KEYFRAME_S = 60;

  /**
   * The video being made now: a render whose files or data/daily/<id>-render.log moved in the last 30 min.
   * { video_id, title, step: keyframes|animation|assembly, agent, text, eta_at, log_at } or null.
   */
  function production(rendersNow) {
    for (const r of rendersNow) {
      const logAt = mtime(join(DATA, "daily", `${r.video_id}-render.log`));
      const live = r.rendering_now || (logAt && Date.now() - logAt < RENDER_LIVE_MS);
      if (!live || r.finished || r.status === "qc_passed") continue;
      const total = r.shots_total || 0;
      const clipsLeft = Math.max(0, r.clips_needed - r.clips_done);
      const kfLeft = Math.max(0, total - r.keyframes_picked);
      let step = "assembly", agent = "editor", text = "Montage, son et contrôle";
      if (kfLeft > 0 && r.clips_done === 0) { step = "keyframes"; agent = "image_artist"; text = `Images clés ${r.keyframes_picked}/${total}`; }
      else if (clipsLeft > 0) { step = "animation"; agent = "animator"; text = `Animation plan ${r.clips_done + 1}/${r.clips_needed}`; }
      const secs = r.eta_s ?? kfLeft * (r.avg_keyframe_s ?? DEFAULT_KEYFRAME_S) + clipsLeft * (r.avg_clip_s ?? DEFAULT_CLIP_S) + 120;
      return { video_id: r.video_id, title: r.title, step, agent, text, eta_at: iso(Date.now() + secs * 1000), log_at: iso(logAt) };
    }
    return null;
  }

  return { withModels, runsToday, paused, approvalsQueue, dailyLog, renders, schedule, production };
}

// ---------- schedule maths, in the studio's time zone ----------

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const FR_DAYS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];

/** "07:52 (after the morning routine)" → 472 minutes; null when there is no HH:MM. */
function minutesOf(v) {
  const m = /(\d{1,2})[:h](\d{2})/.exec(String(v ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** "00:30-14:30", "00:30–14:30", {start,end} / {from,to}, ["00:30","14:30"] → {start, end} in minutes. */
function rangeOf(v) {
  if (!v) return null;
  let a;
  let b;
  if (typeof v === "string") [a, b] = v.split(/\s*(?:-|–|—|to|à)\s*(?=\d)/);
  else if (Array.isArray(v)) [a, b] = v;
  else if (typeof v === "object") [a, b] = [v.start ?? v.from ?? v.begin, v.end ?? v.to ?? v.until];
  const start = minutesOf(a);
  const end = minutesOf(b);
  return start !== null && end !== null ? { start, end } : null;
}

/** Days the PC may work, as weekday numbers (0 = Sunday). Missing or unreadable = every day. */
function daysOf(v) {
  const all = [0, 1, 2, 3, 4, 5, 6];
  if (v === undefined || v === null) return all;
  const items = Array.isArray(v) ? v : String(v).split(/[\s,;]+/);
  const out = new Set();
  for (const raw of items) {
    if (typeof raw === "number" && Number.isInteger(raw)) {
      out.add(((raw % 7) + 7) % 7);
      continue;
    }
    const s = String(raw).trim().toLowerCase();
    if (!s) continue;
    if (["daily", "all", "*", "every day", "everyday", "tous"].includes(s)) return all;
    const span = /^([a-z]{3})[a-z]*\s*-\s*([a-z]{3})[a-z]*$/.exec(s);
    const idx = (k) => (DAY_NAMES.indexOf(k) >= 0 ? DAY_NAMES.indexOf(k) : FR_DAYS.indexOf(k));
    if (span && idx(span[1]) >= 0 && idx(span[2]) >= 0) {
      for (let d = idx(span[1]); ; d = (d + 1) % 7) {
        out.add(d);
        if (d === idx(span[2])) break;
      }
      continue;
    }
    const i = idx(s.slice(0, 3));
    if (i >= 0) out.add(i);
  }
  return out.size ? [...out].sort() : all;
}

function zoneParts(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    second: Number(parts.second),
    weekday: DAY_NAMES.indexOf(String(parts.weekday).slice(0, 3).toLowerCase()),
  };
}

/** UTC instant of local date (y, m, d) at `minutes` in `tz` (two passes, so DST zones work too). */
function zonedInstant(y, m, d, minutes, tz) {
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = wall;
  for (let i = 0; i < 2; i += 1) {
    const p = zoneParts(new Date(guess), tz);
    const seen = Date.UTC(p.y, p.m - 1, p.d, 0, p.minutes);
    guess += wall - seen;
  }
  return guess;
}

function inRange(range, minutes) {
  if (!range) return false;
  return range.start <= range.end ? minutes >= range.start && minutes < range.end : minutes >= range.start || minutes < range.end;
}

/** Next time `startMin` comes round on an allowed day (strictly after now). */
function nextAt(startMin, now, tz, days) {
  const p = zoneParts(now, tz);
  for (let k = 0; k <= 7; k += 1) {
    const base = new Date(Date.UTC(p.y, p.m - 1, p.d + k));
    const weekday = (p.weekday + k) % 7;
    if (!days.includes(weekday)) continue;
    const at = zonedInstant(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), startMin, tz);
    if (at > now.getTime()) return new Date(at).toISOString();
  }
  return null;
}

const hm = (min) => (min === null || min === undefined ? null : `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`);
const pick = (o, keys) => keys.map((k) => k.split(".").reduce((v, part) => (v && typeof v === "object" ? v[part] : undefined), o)).find((v) => v !== undefined && v !== null);

/** Automatic mode, work window, next render slot, next script phase and quiet hours, from core/daily.json. */
export function buildSchedule(rawCfg, now) {
  const cfg = rawCfg.schedule && typeof rawCfg.schedule === "object" ? { ...rawCfg, ...rawCfg.schedule } : rawCfg;
  const zone = TIMEZONE; // ONE setting for the whole studio (core/local-config.mjs), checked there
  const days = daysOf(pick(cfg, ["productionDays", "production_days", "days", "work_days", "workDays"]));
  const window = rangeOf(pick(cfg, ["render_window", "renderWindow", "window", "work_window", "workWindow"]));
  const quiet = rangeOf(pick(cfg, ["quietHours", "quiet_hours", "quiet"]));
  const noNewRender = minutesOf(pick(cfg, ["noNewRenderAfter", "no_new_render_after"]));
  const scriptRaw = pick(cfg, ["scriptPhaseAt", "script_phase_at", "script_phase", "scriptPhase", "script_at", "scriptAt", "script_window", "scriptWindow", "phases.script", "phases.day", "proposed_start.day"]);
  const scriptObj = scriptRaw && typeof scriptRaw === "object" && !Array.isArray(scriptRaw) ? scriptRaw : null;
  const scriptStart = rangeOf(scriptRaw)?.start ?? minutesOf(scriptObj ? scriptObj.time ?? scriptObj.start ?? scriptObj.at : scriptRaw);
  const scriptDays = scriptObj && scriptObj.days !== undefined ? daysOf(scriptObj.days) : days;
  const maxRenders = Number(pick(cfg, ["maxRendersPerWindow", "max_renders_per_window"]));
  const activeRaw = pick(cfg, ["active", "enabled", "auto"]);
  const local = zoneParts(now, zone);
  const today = days.includes(local.weekday);

  // Continuous mode: no window, no day off, no quiet hours; only the production pause stops it.
  if (cfg.continuous === true) {
    return {
      timezone: zone,
      active: typeof activeRaw === "boolean" ? activeRaw : null,
      activated: typeof cfg?.activated === "string" ? cfg.activated.slice(0, 200) : null,
      days: DAY_NAMES.slice(),
      window: { start: "00:00", end: "24:00" },
      no_new_render_after: null,
      quiet_hours: null,
      in_quiet_hours: false,
      local_now: `${local.y}-${pad2(local.m)}-${pad2(local.d)} ${hm(local.minutes)}`,
      render_open_now: true,
      next_render: null,
      next_script: null,
      max_renders_per_window: null,
      script_at: null,
    };
  }
  const lastStart = noNewRender ?? window?.end ?? null;
  const renderOpen = !!window && today && inRange(window, local.minutes) && (lastStart === null || inRange({ start: window.start, end: lastStart }, local.minutes));
  return {
    timezone: zone,
    active: typeof activeRaw === "boolean" ? activeRaw : null,
    activated: typeof cfg?.activated === "string" ? cfg.activated.slice(0, 200) : null,
    days: days.map((d) => DAY_NAMES[d]),
    window: window ? { start: hm(window.start), end: hm(window.end) } : null,
    no_new_render_after: hm(noNewRender),
    quiet_hours: quiet ? { start: hm(quiet.start), end: hm(quiet.end) } : null,
    in_quiet_hours: quiet ? inRange(quiet, local.minutes) : false,
    local_now: `${local.y}-${pad2(local.m)}-${pad2(local.d)} ${hm(local.minutes)}`,
    render_open_now: renderOpen,
    next_render: window ? nextAt(window.start, now, zone, days) : null,
    next_script: scriptStart !== null ? nextAt(scriptStart, now, zone, scriptDays) : null,
    max_renders_per_window: Number.isFinite(maxRenders) && maxRenders > 0 ? maxRenders : null,
    script_at: hm(scriptStart),
  };
}
