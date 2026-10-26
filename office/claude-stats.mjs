// Faceless Studio office: Claude token use on this PC since 00:00 studio time, per hour, studio agents vs other sessions
// Reads Claude Code's local session logs (~/.claude/projects/**/*.jsonl) INCREMENTALLY (byte offsets kept in memory) and keeps
// only the usage numbers of assistant messages (input, output, cache tokens) with their time. Never keeps or returns any text,
// prompt, path, email or credential. Studio agents = Claude Code's project folder for this studio's own path. Plan windows: core/claude-usage.mjs.
import { createReadStream, readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { STUDIO_DIR as STUDIO_PATH } from "../core/local-config.mjs";
import { TIMEZONE, studioMidnight } from "../core/studio-time.mjs";

const PROJECTS = join(homedir(), ".claude", "projects");
// Claude Code names a project's log folder after its path with every non-alphanumeric character turned into "-".
const STUDIO_DIR = STUDIO_PATH.replace(/[^A-Za-z0-9]/g, "-");
const TZ = TIMEZONE; // the studio time zone (core/local-config.mjs)
const SCAN_MS = 120_000;

/** 00:00 studio time of today (Intl conversion, daylight saving included). */
const localMidnight = (now = new Date()) => studioMidnight(now, TZ);
const localHour = (t) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(t)) % 24;

function listLogs(dir, depth = 0, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory() && depth < 3) listLogs(p, depth + 1, out);
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

export function makeClaudeStats() {
  let day = null;
  let offsets = new Map();
  let seen = new Set();
  let hours = [];
  let scanning = false;
  let lastScan = 0;

  function resetDay(midnight) {
    day = midnight.toISOString();
    offsets = new Map();
    seen = new Set();
    hours = Array.from({ length: 24 }, (_, h) => ({ h, studio: 0, other: 0 }));
  }

  async function readFrom(file, start, studio, midnightMs) {
    let pos = start;
    const rl = createInterface({ input: createReadStream(file, { start, encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of rl) {
      pos += Buffer.byteLength(line, "utf8") + 1;
      if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      const u = j?.message?.usage;
      const t = Date.parse(j?.timestamp ?? "");
      if (!u || !Number.isFinite(t) || t < midnightMs) continue;
      const key = `${j.message?.id ?? ""}|${j.requestId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      // Cache reads weigh 0.1, like API pricing: counted in full they are most of the total and barely touch the plan.
      const tokens = n(u.input_tokens) + n(u.output_tokens) + n(u.cache_creation_input_tokens) + 0.1 * n(u.cache_read_input_tokens);
      hours[localHour(t)][studio ? "studio" : "other"] += tokens;
    }
    return pos;
  }

  async function scan() {
    if (scanning) return;
    scanning = true;
    try {
      const midnight = localMidnight();
      if (day !== midnight.toISOString()) resetDay(midnight);
      if (!existsSync(PROJECTS)) return;
      for (const file of listLogs(PROJECTS)) {
        let st;
        try { st = statSync(file); } catch { continue; }
        if (st.mtimeMs < midnight.getTime()) continue;
        const from = offsets.get(file) ?? 0;
        if (st.size <= from) continue;
        try { offsets.set(file, await readFrom(file, from, file.includes(STUDIO_DIR), midnight.getTime())); } catch { /* busy: next scan */ }
      }
      lastScan = Date.now();
    } finally {
      scanning = false;
    }
  }

  scan();
  setInterval(scan, SCAN_MS).unref();

  return {
    /** { since, scanned_at, hours: [{h, studio, other}] up to the current hour, studio, other } */
    tokens() {
      const shown = hours.slice(0, localHour(new Date()) + 1);
      return {
        since: day,
        scanned_at: lastScan ? new Date(lastScan).toISOString() : null,
        hours: shown,
        studio: shown.reduce((n, x) => n + x.studio, 0),
        other: shown.reduce((n, x) => n + x.other, 0),
      };
    },
  };
}

/** Plan windows: the latest reading and today's samples (core/claude-usage.mjs writes them). */
export function readPlanFiles(root) {
  const latest = (() => { try { return JSON.parse(readFileSync(join(root, "data", "claude-usage.json"), "utf8")); } catch { return null; } })();
  const midnight = localMidnight().getTime();
  let samples = [];
  try {
    samples = readFileSync(join(root, "data", "claude-usage.jsonl"), "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((s) => s && Date.parse(s.at) >= midnight)
      .map((s) => ({ at: s.at, five_hour: s.five_hour?.used_pct ?? null, seven_day: s.seven_day?.used_pct ?? null }));
  } catch { /* none yet */ }
  return { latest, samples: samples.slice(-200) };
}
