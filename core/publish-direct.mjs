// Faceless Studio: the studio's own publisher. The studio is fully autonomous: it picks the subjects, makes the videos round the
// clock and publishes every finished, checked video to YouTube, Instagram and TikTok through Upload-Post without asking each
// time, at least 60 minutes apart, until the owner says pause.
// Publishes the next finished video, once, through Upload-Post to YouTube Shorts, Instagram Reels and TikTok, with the AI-content
// label and "not made for kids". No approval rows; posts go straight from draft to 'published', so the approval flow (approvals,
// posts.status 'scheduled', an external publisher) never sees them.
//   node core/publish-direct.mjs            publish the next ready video if one is due (run by the "publication" task)
//   node core/publish-direct.mjs --check    key + linked accounts + what would go next; publishes nothing
//   node core/publish-direct.mjs --dry-run  same choice and drafts, sends nothing
// Gates: production pause (data/production-paused.json), qc.json pass, posts not 'stopped', at least 60 min between two
// publications (core/daily.json autonomy.min_gap_min, never below 60). A started upload without a result blocks that video for a
// human check (data/publish-direct.jsonl), so a crash never double-posts. The key comes from the environment or the studio's own
// .env (UPLOAD_POST_API_KEY) and is never printed.
// The concept is a parameter: the narrator voice, the hashtags, the hook format
// and the YouTube keywords come from the concept OF THE VIDEO (core/concept.mjs conceptOf: story.json "concept", else
// active.json "legacy"), never from a hard-coded show; a concept that fails to load never blocks an output (wrongVoice → false,
// storyDrafts → null, then the active concept or neutral drafts).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLATFORMS, PUBLICATIONS_PATH, STUDIO_ROOT, addEvent, closeDb, isRehearsal, openDb, setAgent, upsertPost } from './db.mjs';
import { buildDrafts, readScript } from './publish-plan.mjs';
import { clarityPassed } from './clarity.mjs';
import { conceptOf, loadConcept, titlePattern } from './concept.mjs';
import { syncPublications } from './sync-publications.mjs';
import { studioDay, studioInstant } from './studio-time.mjs';

const API = 'https://api.upload-post.com/api';
const DATA = path.join(STUDIO_ROOT, 'data');
export const JOURNAL = path.join(DATA, 'publish-direct.jsonl');
export const PAUSE_FILE = path.join(DATA, 'production-paused.json');
export const MIN_GAP_MIN = 60; // the owner's floor: never two publications under 60 min apart
const READY = ['qc_passed', 'approved', 'awaiting_approval'];
const NAMES = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok' };

function config() {
  try { return JSON.parse(readFileSync(path.join(STUDIO_ROOT, 'core', 'daily.json'), 'utf8')).autonomy ?? {}; } catch { return {}; }
}

/** UPLOAD_POST_API_KEY / UPLOAD_POST_PROFILE (your Upload-Post profile name) from the environment, else the studio's own .env. */
export function readEnv(file = path.join(STUDIO_ROOT, '.env')) {
  const out = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return {
    key: process.env.UPLOAD_POST_API_KEY || out.UPLOAD_POST_API_KEY || '',
    profile: process.env.UPLOAD_POST_PROFILE || out.UPLOAD_POST_PROFILE || '',
  };
}

export function productionPaused() {
  if (!existsSync(PAUSE_FILE)) return null;
  try { return JSON.parse(readFileSync(PAUSE_FILE, 'utf8')); } catch { return { since: 'unknown' }; }
}

/** YouTube Shorts title: 60 characters at most, ending with #Shorts (cut at the last whole word). */
export function shortsTitle(title) {
  const end = ' #Shorts', room = 60 - end.length;
  let t = String(title || '').split('\n')[0].replace(/#shorts/gi, '').replace(/^\s*\[[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim();
  if (t.length > room) t = (t.slice(0, room + 1).replace(/\s+\S*$/, '') || t.slice(0, room)).replace(/[\s,;:.!?-]+$/, '');
  return (t + end).trim();
}

const journal = () => (existsSync(JOURNAL) ? readFileSync(JOURNAL, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
const writeJournal = (o) => appendFileSync(JOURNAL, JSON.stringify(o) + '\n');

/** Last publication instant (ms) from the studio journal and the external publisher's report, or 0. */
function lastPublishedMs() {
  const times = effectiveStarts(journal()).filter((j) => j.phase === 'started').map((j) => Date.parse(j.at));
  if (existsSync(PUBLICATIONS_PATH)) {
    // 2026-10-23: the studio's own rows are already in the journal ('started'); its hourly catch-up rows kept restarting the
    // 100-min gap and the old stock never went out (s-1116 waited from 11:42Z). Only posts made elsewhere count here.
    for (const l of readFileSync(PUBLICATIONS_PATH, 'utf8').split('\n')) { try { const r = JSON.parse(l); if (r?.le && r.source !== 'studio') times.push(Date.parse(r.le)); } catch { /* skip */ } }
  }
  return Math.max(0, ...times.filter(Number.isFinite));
}

function qcPassed(videoId) {
  try { return JSON.parse(readFileSync(path.join(STUDIO_ROOT, 'media', videoId, 'qc.json'), 'utf8')).pass === true; } catch { return false; }
}

/** A narrated story (it has story.json) whose voice is not its concept's narrator (concept/<id>/concept.json voice.id), e.g. made
 *  before a voice change in the same concept. 2026-10-24: the concept OF THE VIDEO (conceptOf), so switching the active concept
 *  never flags the finished stock; false without story.json or when the concept does not load (an outing is never blocked by a
 *  typo in concept.json); true when voice.txt is missing. */
export function wrongVoice(videoId) {
  const dir = path.join(STUDIO_ROOT, 'media', videoId);
  if (!existsSync(path.join(dir, 'story.json'))) return false;
  let channel = null;
  try { channel = conceptOf(videoId)?.voice.id ?? null; } catch { return false; }
  if (!channel) return false;
  try { return readFileSync(path.join(dir, 'audio', 'voice.txt'), 'utf8').trim() !== channel; } catch { return true; }
}

/** The concept the publisher applies to ONE video: story.concept when the story is already in memory, else conceptOf(videoId)
 *  (story.json "concept", else active.json "legacy"), else the active concept (a video without story.json, or a concept that
 *  does not load); null when nothing loads. Never throws. */
function videoConcept(videoId, story = null) {
  const own = typeof story?.concept === 'string' && story.concept.trim() ? story.concept.trim() : null;
  if (own) { try { return loadConcept(own); } catch { /* the video's folder or the active concept below */ } }
  try { const c = conceptOf(videoId); if (c) return c; } catch { /* the active concept below */ }
  try { return loadConcept(); } catch { return null; }
}

/** The finished videos, oldest first, each with the reason it cannot go (null = it can). */
export function candidates() {
  const d = openDb();
  const entries = journal();
  const count = (id, phase) => entries.filter((j) => j.phase === phase && j.video_id === id).length;
  const started = new Set(entries.filter((j) => j.phase === 'started').map((j) => j.video_id).filter((id) => count(id, 'started') > count(id, 'result')));
  const done = new Set(entries.filter((j) => j.phase === 'result' && !isRefused(j)).map((j) => j.video_id));
  // Rehearsal videos (r-…, 2026-10-24) never reach the publisher, whatever their status.
  const vids = d.prepare(`SELECT * FROM videos WHERE status IN (${READY.map(() => '?').join(',')}) ORDER BY updated_at`).all(...READY).filter((v) => !isRehearsal(v.id));
  return vids.map((v) => {
    const posts = d.prepare('SELECT * FROM posts WHERE video_id = ?').all(v.id);
    const file = v.video_path ? path.resolve(STUDIO_ROOT, v.video_path) : null;
    let blocked = null;
    if (!file || !existsSync(file)) blocked = 'no video file';
    else if (!qcPassed(v.id)) blocked = 'QC not passed';
    // 2026-10-24 (review H8): a narrated story never goes out without qc_inspector's saved CLARITY PASS, whatever its status says.
    else if (existsSync(path.join(STUDIO_ROOT, 'media', v.id, 'story.json')) && !clarityPassed(v.id)) blocked = 'clarity check not passed (qc_inspector)';
    else if (wrongVoice(v.id)) blocked = 'old narrator voice: waiting for its re-voice';
    else if (posts.some((p) => p.status === 'stopped')) blocked = 'stopped by the owner';
    else if (posts.length && posts.every((p) => p.status === 'published')) blocked = 'already published';
    else if (started.has(v.id)) blocked = 'an upload started without a result: check the accounts by hand';
    else if (done.has(v.id)) blocked = 'already sent';
    return { video: v, posts, file, blocked };
  });
}

// Hashtags (2026-10-22: the old fallback drafts carried a fixed show's tags and "title?." — wrong show, no keywords; 2026-10-24,
// review M31: every video carried the same 5 generic tags, #reels among them, a bait tag the studio's own captions guard refuses).
// Stories carry 3-5 tags about their situation (story.json "hashtags"); the show's own tags are the concept's (concept.json
// "hashtags" per network, DEFAULTS of core/concept.mjs when absent), never written here.
const SHORTS_TAG = '#Shorts'; // YouTube's format tag, a platform rule, not a concept one
const isShortsTag = (h) => h.toLowerCase() === SHORTS_TAG.toLowerCase();
/** Platform hashtags for one story under concept `c`: the story's own tags first, led by #Shorts (YouTube) and the concept's
 *  lead tag (its first tag that is not #Shorts); the concept's whole list when the story has none. */
export function storyTags(story, platform, c) {
  const base = c.hashtags[platform];
  const lead = base.find((h) => !isShortsTag(h)) ?? null;
  const own = Array.isArray(story.hashtags) ? story.hashtags.map(String).filter((h) => /^#[A-Za-z][A-Za-z0-9]{1,29}$/.test(h) && !isShortsTag(h) && !(lead && h.toLowerCase() === lead.toLowerCase())).slice(0, 5) : [];
  if (!own.length) return base;
  return [...(platform === 'youtube' ? [SHORTS_TAG] : []), ...(lead ? [lead] : []), ...own];
}
/** Post texts from the story itself: the hook question, the closing question to the viewer, the hashtags and the YouTube keywords
 *  of the VIDEO's concept. null without story.json, when no concept loads, or when the title is not in the concept's hook format
 *  (titlePattern: hook_regex, else ^hook_prefix). Returns { posts: { platform: { title, caption, hashtags } }, ytTags }. */
function storyDrafts(video) {
  let story = null;
  try { story = JSON.parse(readFileSync(path.join(STUDIO_ROOT, 'media', video.id, 'story.json'), 'utf8')); } catch { return null; }
  const c = videoConcept(video.id, story);
  const title = String(story.title ?? video.topic ?? '').trim();
  const ask = String(story.scenes?.at(-1)?.text ?? '').trim();
  if (!c || !titlePattern(c).test(title)) return null;
  const caption = [title, ask].filter(Boolean).join('\n\n');
  const posts = Object.fromEntries(PLATFORMS.map((p) => [p, { title: p === 'youtube' ? title : null, caption, hashtags: storyTags(story, p, c).join(' ') }]));
  return { posts, ytTags: [...c.yt_tags] };
}

/** The texts to send for one candidate: { text(platform), ytTitle, ytTags }. Saves the drafts as posts rows when `save`. */
function drafts(c, { save }) {
  const have = Object.fromEntries(c.posts.map((p) => [p.platform, p]));
  const fromStory = storyDrafts(c.video);
  if (fromStory) {
    for (const p of PLATFORMS) {
      if (have[p]?.caption && !/#reels\b/i.test(have[p].hashtags ?? '')) continue; // 2026-10-24: old drafts with the bait tag #reels are rewritten
      const dr = fromStory.posts[p];
      if (save) upsertPost({ video_id: c.video.id, platform: p, title: dr.title, caption: dr.caption, hashtags: dr.hashtags, ai_label: 1 });
      have[p] = dr;
    }
  }
  // Without story drafts (no story.json, or a concept that does not load): the video's concept, else the active one, gives the
  // fallback hashtags and the YouTube keywords; publish-plan.mjs keeps a neutral pair when there is none.
  const concept = fromStory ? null : videoConcept(c.video.id);
  const missing = PLATFORMS.filter((p) => !have[p]?.caption);
  if (missing.length) {
    const built = buildDrafts({ platforms: missing, script: readScript(STUDIO_ROOT, c.video.script_path), topic: c.video.topic, hashtags: concept?.hashtags });
    if (built.errors.length) throw new Error(`drafts: ${built.errors.join('; ')}`);
    for (const [p, dr] of Object.entries(built.drafts)) {
      const tags = dr.hashtags.join(' ');
      if (save) upsertPost({ video_id: c.video.id, platform: p, title: dr.title ?? null, caption: dr.caption, hashtags: tags, ai_label: 1 });
      have[p] = { title: dr.title ?? null, caption: dr.caption, hashtags: tags };
    }
  }
  const text = (p) => [have[p].caption, have[p].hashtags].filter(Boolean).join('\n\n');
  return { text, ytTitle: shortsTitle(have.youtube.title || c.video.topic || c.video.id), ytTags: fromStory?.ytTags ?? (concept ? [...concept.yt_tags] : []) };
}

async function call(key, route, options = {}) {
  const r = await fetch(API + route, { ...options, headers: { Authorization: `Apikey ${key}`, ...options.headers }, signal: AbortSignal.timeout(options.timeout || 30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`Upload-Post: ${j.message || j.error || r.status}`);
  return j;
}

/** Which of the three networks are linked (not waiting for a reconnection, not restricted right now) on the profile.
 *  restricted: network -> ISO time until which Upload-Post holds it (2026-10-22: YouTube's daily upload limit). */
async function linked(key, profile, now = Date.now()) {
  const j = await call(key, '/uploadposts/users');
  const p = (j.profiles || []).find((x) => x.username === profile);
  if (!p) throw new Error(`profile "${profile}" not found in Upload-Post`);
  const acc = (n) => (p.social_accounts?.[n] && typeof p.social_accounts[n] === 'object' ? p.social_accounts[n] : null);
  const restricted = Object.fromEntries(PLATFORMS.map((n) => [n, acc(n)?.posting_restricted_until]).filter(([, u]) => u && Date.parse(u) > now));
  const ok = PLATFORMS.filter((n) => acc(n) && !acc(n).reauth_required && !restricted[n]);
  return { ok, restricted, missing: PLATFORMS.filter((n) => !acc(n) || acc(n).reauth_required) };
}

// ---------- Network holds and catch-up (2026-10-22) ----------
// Two limits stopped publishing on 22/10: YouTube's daily upload limit per channel (Upload-Post then holds the account with
// posting_restricted_until), and Upload-Post's own cap of 15 TikTok posts in 24 h ("Used 15/15 in the last 24 hours"), which made
// it refuse the whole upload, Instagram included, at 11:11 and 12:11Z. Now a held network is left out and the others go out on
// time; the video is owed to the held network and sent there later (oldest first, at most one an hour per network) once the hold
// ends, after checking that its first request did not reach it in the meantime (Upload-Post retries YouTube on its own). A cap
// learnt from an error message is kept in data/net-caps.json and counted before sending, so the same refusal does not come back.
const MARGIN_MIN = { youtube: 30, instagram: 5, tiktok: 5 };
const CATCH_GAP_MIN = 60;
const REFUSED_HOLD_MIN = 60; // after a cap refusal, even if our own count says the network is free
const CAPS_FILE = path.join(DATA, 'net-caps.json');
const OLD_YT_HOLD_FILE = path.join(DATA, 'youtube-hold.json'); // written before 12:30Z on 22/10
const CAP_RE = /posting cap on (\w+)[^U]*Used (\d+)\/(\d+)/i;

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const isStart = (j) => ['started', 'yt-started', 'catch-started'].includes(j.phase);
const isResult = (j) => ['result', 'yt-result', 'catch-result'].includes(j.phase);
/** A result where Upload-Post refused the whole upload for a cap: nothing went out, the video is still to send. */
export const isRefused = (j) => isResult(j) && !j.nets && /posting cap/i.test(j.error ?? '');

/** Starts that really sent something (a start answered by a refusal is dropped). */
function effectiveStarts(entries) {
  return entries.filter((j, i) => {
    if (!isStart(j)) return false;
    const answer = entries.slice(i + 1).find((r) => isResult(r) && r.video_id === j.video_id);
    return !(answer && isRefused(answer));
  });
}

function saveCaps(patch) {
  const cur = readJson(CAPS_FILE, {});
  writeFileSync(CAPS_FILE, JSON.stringify({ ...cur, ...patch, holds: { ...cur.holds, ...patch.holds }, lastHold: { ...cur.lastHold, ...patch.lastHold } }, null, 1));
}

/** Learns "posting cap on <net>. Used N/M" from an Upload-Post error and holds that network; returns it or null. */
function learnCap(message, now) {
  const m = CAP_RE.exec(message ?? '');
  const net = m?.[1]?.toLowerCase();
  if (!net || !PLATFORMS.includes(net)) return null;
  saveCaps({ [net]: Number(m[3]), holds: { [net]: new Date(now + REFUSED_HOLD_MIN * 60_000).toISOString() } });
  return net;
}

/** network -> hold end (ms): Upload-Post's restriction, a full 24 h cap (oldest of the last M sends + 24 h), a recent refusal. */
function holds(link, entries, now) {
  const caps = readJson(CAPS_FILE, {});
  const out = {};
  for (const n of PLATFORMS) {
    let capEnd = 0;
    if (caps[n]) {
      const sends = effectiveStarts(entries).filter((j) => (j.nets ?? []).includes(n)).map((j) => Date.parse(j.at)).filter((t) => now - t < 86_400_000).sort((a, b) => b - a);
      if (sends.length >= caps[n]) capEnd = sends[caps[n] - 1] + 86_400_000;
    }
    const until = Math.max(link.restricted[n] ? Date.parse(link.restricted[n]) : 0, capEnd, Date.parse(caps.holds?.[n] ?? '') || 0);
    if (until > now) out[n] = until;
  }
  if (Object.keys(out).length) saveCaps({ lastHold: Object.fromEntries(Object.entries(out).map(([n, t]) => [n, new Date(t).toISOString()])) });
  writeNetStatus(out, entries, now);
  return out;
}

// For the vitrine (the Problems box must not show limits that are handled on their own): per network, how many
// videos it is owed and until when it is on hold, shown as a calm waiting state, not as a problem.
const NET_STATUS = path.join(DATA, 'net-status.json');
function writeNetStatus(held, entries, now) {
  const nets = Object.fromEntries(PLATFORMS.map((n) => [n, { owed: owedTo(n, entries).length, until: held[n] ? new Date(held[n]).toISOString() : null }]));
  writeFileSync(NET_STATUS, JSON.stringify({ at: new Date(now).toISOString(), catch_gap_min: CATCH_GAP_MIN, nets }, null, 1));
}
/** Refreshes data/net-status.json now (normally written on every publication pass). */
export async function refreshNetStatus(now = Date.now()) {
  const env = readEnv();
  return holds(await linked(env.key, env.profile, now), journal(), now);
}

/** Videos sent to other networks whose upload to `net` has not succeeded yet, oldest first. */
export function owedTo(net, entries = journal()) {
  const results = entries.filter((j) => isResult(j) && Array.isArray(j.nets));
  const done = new Set(results.filter((j) => j.nets.some((n) => n.reseau === net && n.publie)).map((j) => j.video_id));
  const owed = results.filter((j) => j.phase === 'result' && j.nets.some((n) => n.reseau === net && !n.publie)).map((j) => j.video_id);
  const catchStarts = entries.filter((j) => (j.phase === 'catch-started' || j.phase === 'yt-started') && (j.nets ?? []).includes(net));
  const hanging = new Set(catchStarts.map((j) => j.video_id).filter((id) => !results.some((r) => (r.phase === 'catch-result' || r.phase === 'yt-result') && r.video_id === id && r.nets.some((n) => n.reseau === net))));
  // 2026-10-23: slot videos (13:00 / 20:00 studio time, media/<id>/animated.json) come first, the old stock fills in after.
  const slotVideo = (id) => existsSync(path.join(STUDIO_ROOT, 'media', String(id), 'animated.json'));
  const list = [...new Set(owed)].filter((id) => !done.has(id) && !hanging.has(id));
  return [...list.filter(slotVideo), ...list.filter((id) => !slotVideo(id))];
}
export const youtubeBacklog = (entries = journal()) => owedTo('youtube', entries);

/** The result of a past request on one network (Upload-Post may have retried it), or null. */
async function resultOn(key, requestId, net) {
  if (!requestId) return null;
  const s = await call(key, `/uploadposts/status?request_id=${encodeURIComponent(requestId)}`).catch(() => null);
  const t = (s?.results || []).find((x) => x.platform === net);
  return t?.success ? (t.url || t.post_url || 'posted') : null;
}

function recordCatch(id, at, n) {
  appendFileSync(PUBLICATIONS_PATH, JSON.stringify({ ref: null, video_id: id, le: at, source: 'studio', reseaux: [{ ...n, reseau: NAMES[n.reseau] }], erreur: null }) + '\n');
  syncPublications();
  addEvent({ kind: 'publish', agent: 'publisher', video_id: id, text: `${id} published: ${NAMES[n.reseau]} (catch-up)` });
}

/** Sends the oldest video owed to `net`, if the network is free and its hour has passed. Returns a short line or null. */
async function catchUpOne(env, net, held, now) {
  const entries = journal();
  const owed = owedTo(net, entries);
  if (!owed.length) return null;
  if (held[net]) return `${NAMES[net]} on hold until ${new Date(held[net]).toISOString()}: ${owed.length} owed`;
  const lastHold = Math.max(Date.parse(readJson(CAPS_FILE, {}).lastHold?.[net] ?? '') || 0, net === 'youtube' ? Date.parse(readJson(OLD_YT_HOLD_FILE, {}).youtube_until ?? '') || 0 : 0);
  const free = lastHold + MARGIN_MIN[net] * 60_000;
  if (now < free) return `${NAMES[net]} catch-up after ${new Date(free).toISOString()}: ${owed.length} owed`;
  const lastSend = Math.max(0, ...effectiveStarts(entries).filter((j) => (j.nets ?? []).includes(net)).map((j) => Date.parse(j.at)).filter(Number.isFinite));
  if (now - lastSend < CATCH_GAP_MIN * 60_000) return `${NAMES[net]} catch-up waits its hour: ${owed.length} owed`;
  const id = owed[0];
  const at = new Date(now).toISOString();
  const first = entries.filter((j) => j.phase === 'result' && j.video_id === id && j.request_id).at(-1);
  const already = await resultOn(env.key, first?.request_id, net);
  if (already) {
    const n = { reseau: net, publie: true, lien: already };
    writeJournal({ phase: 'catch-result', at, video_id: id, request_id: first.request_id, nets: [n], note: 'reached the network on an Upload-Post retry' });
    recordCatch(id, at, n);
    return `${id}: already on ${NAMES[net]} (Upload-Post retry)`;
  }
  const d = openDb();
  const video = d.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  const file = video?.video_path ? path.resolve(STUDIO_ROOT, video.video_path) : null;
  if (!video || !file || !existsSync(file)) return `${id}: owed to ${NAMES[net]} but its file is missing`;
  const c = { video, posts: d.prepare('SELECT * FROM posts WHERE video_id = ?').all(id), file };
  if (c.posts.some((p) => p.status === 'stopped')) return `${id}: stopped by the owner, not sent to ${NAMES[net]}`;
  const { text, ytTitle, ytTags } = drafts(c, { save: false });
  writeJournal({ phase: 'catch-started', at, video_id: id, nets: [net] });
  addEvent({ kind: 'publish', agent: 'publisher', video_id: id, text: `publishing ${id} to ${NAMES[net]} (catch-up)` });
  let res;
  try { res = await send(env.key, buildForm({ profile: env.profile, nets: [net], text, ytTitle, file, ytTags }), [net]); } catch (e) {
    learnCap(e.message, now);
    writeJournal({ phase: 'catch-result', at: new Date().toISOString(), video_id: id, nets: [{ reseau: net, publie: false, erreur: e.message.slice(0, 300) }] });
    return `${id}: ${NAMES[net]} catch-up failed: ${e.message}`;
  }
  writeJournal({ phase: 'catch-result', at: new Date().toISOString(), video_id: id, request_id: res.request_id, pending: !!res.pending, nets: res.nets });
  const n = res.nets.find((x) => x.reseau === net);
  if (n?.publie) recordCatch(id, at, n);
  return `${id}: ${NAMES[net]} catch-up ${n?.publie ? 'published' : `not published (${n?.erreur ?? 'pending'})`}`;
}

/** The Upload-Post form; ytTags = the YouTube keywords of the video's concept (concept.json yt_tags), none when unknown. */
export function buildForm({ profile, nets, text, ytTitle, file, ytTags = [] }) {
  const f = new FormData();
  f.append('user', profile);
  for (const n of nets) f.append('platform[]', n);
  f.append('title', text('tiktok').slice(0, 2200));
  if (nets.includes('tiktok')) f.append('tiktok_title', text('tiktok').slice(0, 2200));
  if (nets.includes('instagram')) f.append('instagram_title', text('instagram').slice(0, 2200));
  if (nets.includes('youtube')) {
    f.append('youtube_title', ytTitle);
    f.append('youtube_description', text('youtube').slice(0, 4900));
    f.append('privacyStatus', 'public');
    f.append('selfDeclaredMadeForKids', 'false');
    f.append('containsSyntheticMedia', 'true');
    for (const t of ytTags) f.append('tags[]', String(t)); // YouTube keywords (Upload-Post's tags[] field)
  }
  f.append('is_aigc', 'true');
  f.append('privacy_level', 'PUBLIC_TO_EVERYONE');
  f.append('post_mode', 'DIRECT_POST');
  f.append('media_type', 'REELS');
  f.append('async_upload', 'true');
  if (file) f.append('video', new Blob([readFileSync(file)], { type: 'video/mp4' }), path.basename(file));
  return f;
}

/** Sends, then follows the request until the links come back (10 min at most). */
async function send(key, f, nets) {
  const r = await call(key, '/upload', { method: 'POST', body: f, timeout: 600000 });
  let results = r.results ? Object.entries(r.results).map(([platform, v]) => ({ platform, ...v })) : null;
  for (let k = 0; !results && k < 60; k++) {
    await new Promise((ok) => setTimeout(ok, 10000));
    const s = await call(key, `/uploadposts/status?request_id=${encodeURIComponent(r.request_id)}`).catch(() => null);
    if (s?.status === 'completed' || s?.status === 'failed') results = s.results || [];
  }
  if (!results) return { request_id: r.request_id, pending: true, nets: [] };
  return {
    request_id: r.request_id,
    nets: nets.map((n) => {
      const t = results.find((x) => x.platform === n);
      // error_message carries the real cause (2026-10-22: "no answer" hid YouTube's daily upload limit).
      if (!t || t.success === false || t.skipped || t.error) return { reseau: n, publie: false, erreur: String(t?.error_message || t?.error || t?.skip_reason || t?.message || 'no answer').slice(0, 300) };
      if (t.fallback_to_inbox) return { reseau: n, publie: false, erreur: 'left in the app drafts instead of being posted' };
      return { reseau: n, publie: true, lien: t.url || t.post_url || null };
    }),
  };
}

/** The start (ms) of the 2-a-day slot we are in ("HH:MM" studio time, core/local-config.mjs TIMEZONE, open window_min minutes), or null. */
export function slotNow(tad, now = Date.now()) {
  if (!tad?.on || !Array.isArray(tad.slots)) return null;
  const day = studioDay(now); // the studio's date (Intl, daylight saving included)
  const starts = tad.slots.map((s) => studioInstant(day, String(s)).getTime()).sort((a, b) => a - b);
  // 2026-10-24 (review M33): a slot's window ends at the next slot's start at the latest, so slots 60 min apart (the analyst may
  // choose them) never make the next video wait or slip to the next day.
  for (const [i, start] of starts.entries()) {
    const end = Math.min(start + (tad.window_min ?? 120) * 60_000, starts[i + 1] ?? Infinity);
    if (now >= start && now < end) return start;
  }
  return null;
}

/** One pass: publishes at most one video. The result never contains the key. */
export async function publishNext({ check = false, dryRun = false, now = Date.now() } = {}) {
  const cfg = config();
  const paused = productionPaused();
  const list = candidates();
  // 2026-10-22 20:00Z (the owner): the new animated videos go out only in the 13:00 and 20:00 studio-time slots, one per slot;
  // the videos made before keep going out every min_gap_min. In a slot, the animated one goes first.
  const animated = (c) => existsSync(path.join(STUDIO_ROOT, 'media', c.video.id, 'animated.json'));
  const free = list.filter((c) => !c.blocked);
  const slot = slotNow(cfg.two_a_day, now);
  const slotTaken = slot && journal().some((j) => j.phase === 'started' && Date.parse(j.at) >= slot && existsSync(path.join(STUDIO_ROOT, 'media', String(j.video_id), 'animated.json')));
  const inSlot = slot && !slotTaken ? free.find(animated) : null;
  // 2026-10-23: an old-stock video in the hour before a slot would push the slot video back (60-min floor), so it waits.
  const slotSoon = cfg.two_a_day?.on && !slot && slotNow(cfg.two_a_day, now + 60 * 60_000) !== null;
  const next = inSlot ?? (slotSoon ? null : free.find((c) => !animated(c))) ?? null;
  if (next && (isRehearsal(next.video.id) || existsSync(path.join(STUDIO_ROOT, 'media', next.video.id, 'repetition.json')))) throw new Error(`${next.video.id} est une répétition : jamais publiée`);
  const out = { ready: list.filter((c) => !c.blocked).map((c) => c.video.id), blocked: list.filter((c) => c.blocked).map((c) => `${c.video.id}: ${c.blocked}`) };
  const env = readEnv();
  if (check) {
    out.key = env.key ? 'present' : 'MISSING (UPLOAD_POST_API_KEY in the studio\'s .env)';
    out.profile = env.profile ? 'present' : 'MISSING (UPLOAD_POST_PROFILE in the studio\'s .env)';
    if (env.key && env.profile) { try { out.linked = await linked(env.key, env.profile); } catch (e) { out.linked = `error: ${e.message}`; } }
    out.paused = paused ? `yes (since ${paused.since})` : 'no';
    return out;
  }
  if (cfg.publish === false) return { ...out, result: 'autonomous publishing is off (core/daily.json autonomy.publish)' };
  if (paused) return { ...out, result: `paused since ${paused.since}` };
  // Each pass also sends owed videos to the networks that were held (catchUpOne); the regular hourly slot is unchanged.
  const catchUp = async (o) => {
    if (dryRun || !env.key || !env.profile || !PLATFORMS.some((n) => owedTo(n).length)) return o;
    // 2026-10-23: a catch-up at 11:11Z restarted the 60-min floor and the 12:00Z slot video went out at 12:21Z.
    if (slotSoon) return { ...o, catch_up: 'held: a slot starts within the hour' };
    try {
      const held = holds(await linked(env.key, env.profile, now), journal(), now);
      const lines = {};
      for (const n of PLATFORMS) { const l = await catchUpOne(env, n, held, Date.now()); if (l) lines[n] = l; }
      return { ...o, catch_up: lines };
    } catch (e) { return { ...o, catch_up: `error: ${e.message}` }; }
  };
  if (!next) return catchUp({ ...out, result: 'nothing ready' });
  // A slot video only keeps the owner's 60-min floor; the old stock keeps min_gap_min (100 since 22/10 14:18Z).
  const gapMs = (inSlot ? MIN_GAP_MIN : Math.max(MIN_GAP_MIN, Number(cfg.min_gap_min) || MIN_GAP_MIN)) * 60_000;
  const last = lastPublishedMs();
  if (now - last < gapMs) return catchUp({ ...out, result: `${next.video.id} waits: last publication ${Math.round((now - last) / 60_000)} min ago, gap ${gapMs / 60_000} min` });
  const { text, ytTitle, ytTags } = drafts(next, { save: !dryRun });
  if (dryRun) {
    const f = buildForm({ profile: env.profile, nets: PLATFORMS, text, ytTitle, file: null, ytTags });
    const fields = [...f.keys()].filter((k, i, a) => a.indexOf(k) === i);
    return { ...out, result: `dry-run: would publish ${next.video.id} (${next.file})`, key: env.key ? 'present' : 'missing', youtube_title: ytTitle, youtube_tags: ytTags, fields, tiktok_text: text('tiktok').slice(0, 300) };
  }
  if (!env.key) return { ...out, result: 'no Upload-Post key (UPLOAD_POST_API_KEY in the studio\'s .env)' };
  if (!env.profile) return { ...out, result: 'no Upload-Post profile (UPLOAD_POST_PROFILE in the studio\'s .env)' };
  const link = await linked(env.key, env.profile, now);
  const { missing } = link;
  const entries = journal();
  const held = holds(link, entries, now);
  // A network on hold, or still owed an older video, gets this one later (catch-up, in order); the others get it now.
  const usable = PLATFORMS.filter((n) => !missing.includes(n));
  // A slot video skips the queue of older owed videos (2026-10-23): it goes out at its slot wherever the network is free.
  let nets = usable.filter((n) => !held[n] && (inSlot || !owedTo(n, entries).length));
  const heldBack = (n) => ({ reseau: n, publie: false, erreur: held[n] ? `on hold until ${new Date(held[n]).toISOString()} (daily limit): queued` : 'queued behind older videos owed to this network', until: held[n] ? new Date(held[n]).toISOString() : null });
  if (!nets.length) return catchUp({ ...out, result: `no network free now (${usable.map((n) => `${NAMES[n]}${held[n] ? ` until ${new Date(held[n]).toISOString()}` : ' owed older videos'}`).join(', ')})` });

  const title = String(next.video.topic ?? next.video.id).replace(/^\s*\[[^\]]*\]\s*/, '').slice(0, 120);
  setAgent('publisher', { state: 'working', task: `Publication : ${title}`, video_id: next.video.id, text: `Publication : ${title}` });
  let res = null;
  const at = new Date(now).toISOString();
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    writeJournal({ phase: 'started', at: new Date().toISOString(), video_id: next.video.id, nets });
    addEvent({ kind: 'publish', agent: 'publisher', video_id: next.video.id, text: `publishing ${next.video.id} to ${nets.map((n) => NAMES[n]).join(', ')}` });
    try { res = await send(env.key, buildForm({ profile: env.profile, nets, text, ytTitle, file: next.file, ytTags }), nets); } catch (e) {
      writeJournal({ phase: 'result', at: new Date().toISOString(), video_id: next.video.id, error: e.message.slice(0, 300) });
      // A cap on one network refuses the whole upload: hold that network and send the others straight away (once).
      const capped = learnCap(e.message, now);
      if (attempt === 0 && capped && nets.includes(capped) && nets.length > 1) {
        held[capped] = Date.parse(readJson(CAPS_FILE, {}).holds?.[capped] ?? '') || now + REFUSED_HOLD_MIN * 60_000;
        nets = nets.filter((n) => n !== capped);
        continue;
      }
      addEvent({ kind: 'error', agent: 'publisher', video_id: next.video.id, text: `publication failed: ${e.message}`.slice(0, 500) });
      setAgent('publisher', { state: 'error', task: 'Publication échouée', video_id: next.video.id, text: `Publication échouée : ${e.message}`.slice(0, 300) });
      return catchUp({ ...out, result: `failed: ${e.message}` });
    }
  }
  setAgent('publisher', { state: 'idle', video_id: next.video.id, text: `${title} : envoyée` });
  for (const n of usable) if (!nets.includes(n)) res.nets.push(heldBack(n));
  // A refusal for a daily limit inside the answer is remembered with its end, so the catch-up waits for it.
  for (const n of res.nets) if (!n.publie && /upload limit|number of videos it may upload|posting cap/i.test(n.erreur ?? '') && !n.until) n.until = new Date(held[n.reseau] ?? now + 2 * 3600_000).toISOString();
  writeJournal({ phase: 'result', at: new Date().toISOString(), video_id: next.video.id, request_id: res.request_id, pending: !!res.pending, nets: res.nets });
  if (res.pending) return { ...out, result: `${next.video.id} sent, Upload-Post still processing after 10 min (request ${res.request_id})` };
  const row = { ref: null, video_id: next.video.id, le: at, source: 'studio', reseaux: res.nets.map((n) => ({ ...n, reseau: NAMES[n.reseau] })), erreur: null };
  appendFileSync(PUBLICATIONS_PATH, JSON.stringify(row) + '\n');
  syncPublications();
  const failed = res.nets.filter((n) => !n.publie);
  addEvent({ kind: 'publish', agent: 'publisher', video_id: next.video.id, text: `${next.video.id} published: ${res.nets.filter((n) => n.publie).map((n) => NAMES[n.reseau]).join(', ') || 'none'}${failed.length ? `; later: ${failed.map((n) => `${NAMES[n.reseau]} (${n.erreur})`).join(', ')}` : ''}`.slice(0, 500) });
  addEvent({ kind: 'handoff', agent: 'publisher', to_agent: 'results_analyst', video_id: next.video.id, text: 'En ligne : compte les vues' });
  return { ...out, result: 'published', video: next.video.id, youtube_title: ytTitle, nets: res.nets, missing };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  try {
    console.log(JSON.stringify(await publishNext({ check: argv.includes('--check'), dryRun: argv.includes('--dry-run') }), null, 1));
  } catch (e) {
    console.error(`publish-direct failed: ${e.message}`);
    process.exitCode = 1;
  } finally { closeDb(); }
}
