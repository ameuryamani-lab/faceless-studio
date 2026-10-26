// What each desk screen shows (viewers like to see the agents at work):
// the real work of the video the agent last touched, read from media/<video_id>/, never invented.
//   research desks  -> the strongest trending Short (its thumbnail)
//   strategy desks  -> the chosen subject (the hook field of the PICK line, whatever the concept's hook prefix)
//   writing / character / storyboard desks -> the story lines
//   image_artist / animator -> the newest scene image
//   voice_director  -> a waveform with the line being voiced
//   editor / qc / distribution -> the cover (qc adds its stamp, distribution its platforms)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SAFE_ID = /^[A-Za-z0-9._-]{1,80}$/;
const RESEARCH = new Set(["outlier_analyst", "trend_scout", "teardown_analyst"]);
const SUBJECT = new Set(["strategist", "calendar_planner", "topic_editor"]);
const STORY = new Set(["copywriter", "hook_auditor", "fact_checker", "character_keeper", "voice_writer", "continuity_checker", "storyboard_artist"]);
const SCENE = new Set(["image_artist", "animator"]);
const COVER = new Set(["editor", "qc_inspector", "publisher", "results_analyst", "postmortem_writer"]);
const CACHE_MS = 4000;
let cache = { at: 0, key: "", value: {} };

const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
const ytId = (url) => /(?:shorts\/|v=|youtu\.be\/)([A-Za-z0-9_-]{6,20})/.exec(url ?? "")?.[1] ?? null;

function newestScene(dir) {
  try {
    const files = readdirSync(join(dir, "scenes")).filter((f) => /^\d{2}\.(png|jpg)$/.test(f));
    files.sort((a, b) => statSync(join(dir, "scenes", b)).mtimeMs - statSync(join(dir, "scenes", a)).mtimeMs);
    return files[0] ?? null;
  } catch { return null; }
}

function workFor(agent, videoId, media, topTrend) {
  if (RESEARCH.has(agent)) return topTrend ? { kind: "image", url: topTrend } : null;
  if (!videoId || !SAFE_ID.test(videoId)) return null;
  const dir = join(media, videoId);
  if (!existsSync(dir)) return null;
  const story = readJson(join(dir, "story.json"));
  const cover = existsSync(join(dir, "cover.jpg")) ? `/media/${videoId}/cover.jpg` : null;
  if (SUBJECT.has(agent)) {
    const pick = existsSync(join(dir, "chain", "subject.txt")) ? readFileSync(join(dir, "chain", "subject.txt"), "utf8") : "";
    // 2026-10-24 (the concept is a parameter): the 2nd field of the "PICK | <hook> | <escalation>" line, whatever the hook
    // prefix (a hook was once hard-coded here, so the desks would have gone blank after a concept switch).
    const pickLine = pick.split(/\r?\n/).find((l) => /^\s*PICK\s*\|/i.test(l)) ?? pick;
    const title = story?.title ?? pickLine.split("|")[1]?.trim();
    return title ? { kind: "text", lines: [title.slice(0, 90)] } : null;
  }
  if (STORY.has(agent)) {
    const lines = (story?.scenes ?? []).map((s) => String(s.text ?? "")).filter(Boolean).slice(0, 4);
    return lines.length ? { kind: "text", lines } : null;
  }
  if (SCENE.has(agent)) {
    const f = newestScene(dir);
    return f ? { kind: "image", url: `/media/${videoId}/scenes/${f}`, zoom: agent === "animator" } : cover ? { kind: "image", url: cover } : null;
  }
  if (agent === "voice_director") {
    const line = story?.scenes?.[0]?.text;
    return { kind: "wave", lines: line ? [String(line).slice(0, 70)] : [] };
  }
  if (COVER.has(agent) && cover) {
    if (agent === "qc_inspector") return { kind: "image", url: cover, stamp: readJson(join(dir, "qc.json"))?.pass === true ? "ok" : null };
    return { kind: "image", url: cover, nets: agent === "publisher" };
  }
  return null;
}

/** agent id -> its screen's work, for the agents rows given (cached a few seconds). */
export function deskWork(agents, media, trends) {
  const top = (trends ?? []).find((t) => t.usable !== 0 && ytId(t.video_url));
  const topTrend = top ? `/thumb/${ytId(top.video_url)}.jpg` : null;
  const key = agents.map((a) => `${a.id}:${a.video_id}:${a.state}`).join("|") + topTrend;
  if (Date.now() - cache.at < CACHE_MS && cache.key === key) return cache.value;
  const value = Object.fromEntries(agents.map((a) => [a.id, workFor(a.id, a.video_id, media, topTrend)]).filter(([, w]) => w));
  cache = { at: Date.now(), key, value };
  return value;
}
