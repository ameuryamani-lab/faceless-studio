// Faceless Studio: the single source of truth (data/studio.db), schema from CONTRAT.md.
// Every write goes through the helpers below; every agent state change also appends an event.
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inQuietHours, now as scheduleNow, quietReleaseAt, scheduleConfig } from './schedule.mjs';
import { ensureWaiter } from './approval-waiter.mjs';
import { studioInstant, studioParts } from './studio-time.mjs';
import { buildDrafts, computePublishAt, localDate, readScript } from './publish-plan.mjs';

export const STUDIO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DB = path.join(STUDIO_ROOT, 'data', 'studio.db');
export const DB_PATH = process.env.STUDIO_DB || DEFAULT_DB;
// Quiet-hours queue and waiter file: data/ for the real DB, "<db>.<name>" beside a test DB (never the real files).
const sidecar = (name) => (path.resolve(DB_PATH) === path.resolve(DEFAULT_DB) ? path.join(STUDIO_ROOT, 'data', name) : `${DB_PATH}.${name}`);
export const QUEUE_PATH = sidecar('approvals-queue.jsonl');
export const WAITER_PATH = sidecar('approval-waiter.json');
// Written by an external publisher after each publication (data/publications.jsonl), read by core/sync-publications.mjs.
export const PUBLICATIONS_PATH = sidecar('publications.jsonl');

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, team TEXT NOT NULL, label TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle',
  task TEXT,
  video_id TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  agent TEXT, to_agent TEXT, video_id TEXT,
  text TEXT,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  topic TEXT, lane TEXT,
  status TEXT NOT NULL DEFAULT 'idea',
  script_path TEXT, video_path TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  video_id TEXT NOT NULL, platform TEXT NOT NULL,
  title TEXT, caption TEXT, hashtags TEXT, ai_label INTEGER NOT NULL DEFAULT 1,
  scheduled_at TEXT, published_at TEXT, url TEXT,
  PRIMARY KEY (video_id, platform)
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT UNIQUE NOT NULL,
  video_id TEXT, kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT, created_at TEXT NOT NULL, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS metrics (
  video_id TEXT NOT NULL, platform TEXT NOT NULL, at TEXT NOT NULL,
  checkpoint TEXT,
  views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER,
  avg_view_pct REAL, followers_delta INTEGER,
  PRIMARY KEY (video_id, platform, at)
);
`;

const TEAMS = {
  chief: ['chief_of_staff'],
  research: ['outlier_analyst', 'trend_scout', 'teardown_analyst'],
  strategy: ['strategist', 'calendar_planner', 'topic_editor'],
  writing: ['copywriter', 'hook_auditor', 'fact_checker'],
  character: ['character_keeper', 'voice_writer', 'continuity_checker'],
  visual: ['storyboard_artist', 'image_artist', 'animator'],
  sound_edit: ['voice_director', 'editor', 'qc_inspector'],
  distribution: ['publisher', 'results_analyst', 'postmortem_writer'],
};
// chief_of_staff is "Lester": he answers the owner and launches work on the owner's request.
const LABEL_OVERRIDES = { chief_of_staff: 'Lester', qc_inspector: 'QC Inspector' };
const titleCase = (id) => id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

export const ROSTER = Object.freeze(
  Object.entries(TEAMS).flatMap(([team, ids]) => ids.map((id) => Object.freeze({ id, team, label: LABEL_OVERRIDES[id] ?? titleCase(id) }))),
);
export const AGENT_IDS = new Set(ROSTER.map((a) => a.id));

export const AGENT_STATES = ['idle', 'working', 'waiting', 'error'];
export const EVENT_KINDS = ['run_start', 'run_end', 'handoff', 'approval_request', 'approval_decision', 'publish', 'error', 'note'];
export const VIDEO_STATUSES = ['idea', 'scripted', 'storyboarded', 'animated', 'voiced', 'edited', 'qc_passed', 'awaiting_approval', 'approved', 'scheduled', 'published', 'rejected', 'superseded'];
// 'superseded' (added 2026-10-21): replaced before it ever reached the owner. Never publishes, holds no slot, counts for nothing.
export const PLATFORMS = ['youtube', 'instagram', 'tiktok'];
export const APPROVAL_KINDS = ['script', 'video', 'post'];
export const APPROVAL_STATUSES = ['pending', 'approved', 'changes', 'rejected', 'withdrawn'];
// 'withdrawn' (added 2026-10-21): closed by the studio before the owner answered; a late "oui" on it does nothing.
export const CHECKPOINTS = ['1h', '24h', '72h', '7d'];

export const nowIso = () => new Date().toISOString();

function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) throw new Error(`${name} must be one of ${allowed.join(', ')} (got ${JSON.stringify(value)})`);
  return value;
}
function shortText(value, name, max = 500) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new Error(`${name} is longer than ${max} characters`);
  return s;
}
export function checkAgent(id, name = 'agent') {
  if (id === undefined || id === null) return null;
  if (!AGENT_IDS.has(id)) throw new Error(`${name} "${id}" is not in the roster`);
  return id;
}
export function checkVideoId(id) {
  if (id === undefined || id === null) return null;
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(String(id))) throw new Error(`video_id "${id}" must be lowercase letters, digits and dashes (e.g. v-2026-10-21-01)`);
  return String(id);
}

/** Rehearsal (a test video goes through the whole chain but is never published): its id starts with "r-". */
export const isRehearsal = (id) => /^r-/.test(String(id ?? ''));

let db = null;

/** Opens (and creates on first use) data/studio.db in WAL mode, with the schema and the 22 agents seeded. */
export function openDb(file = DB_PATH) {
  if (db) return db;
  mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrateVideoColumns(db);
  migratePostColumns(db);
  const seed = db.prepare('INSERT OR IGNORE INTO agents (id, team, label, state, updated_at) VALUES (?, ?, ?, \'idle\', ?)');
  const at = nowIso();
  for (const a of ROSTER) seed.run(a.id, a.team, a.label, at);
  return db;
}

// Added 2026-10-21 (brand/lanes.md RULES 1): the planned publish date (YYYY-MM-DD, local) of each video.
// Additive migration: the column is added when missing; existing rows keep NULL (no planned date).
export const VIDEO_EXTRA_COLUMNS = { planned_publish_date: 'TEXT' };
function migrateVideoColumns(d) {
  const have = new Set(d.prepare('PRAGMA table_info(videos)').all().map((c) => c.name));
  for (const [col, type] of Object.entries(VIDEO_EXTRA_COLUMNS)) if (!have.has(col)) d.exec(`ALTER TABLE videos ADD COLUMN ${col} ${type}`);
}
// Added 2026-10-21 (brand/lanes.md RULES 4): posts.status per platform row, read by the external publisher.
// NULL = draft, not scheduled | 'scheduled' (the external publisher may publish at scheduled_at after its notice) | 'stopped' | 'published'.
export const POST_STATUSES = ['scheduled', 'stopped', 'published'];
export const POST_EXTRA_COLUMNS = { status: 'TEXT' };
function migratePostColumns(d) {
  const have = new Set(d.prepare('PRAGMA table_info(posts)').all().map((c) => c.name));
  for (const [col, type] of Object.entries(POST_EXTRA_COLUMNS)) if (!have.has(col)) d.exec(`ALTER TABLE posts ADD COLUMN ${col} ${type}`);
}
/** '' or null clears; otherwise a real calendar date YYYY-MM-DD. */
function plannedDate(v) {
  if (v === null || v === '') return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) throw new Error(`planned_publish_date must be YYYY-MM-DD (got ${JSON.stringify(s)})`);
  return s;
}

export function closeDb() {
  if (db) { db.close(); db = null; }
}

function tx(fn) {
  const d = openDb();
  d.exec('BEGIN IMMEDIATE');
  try { const r = fn(d); d.exec('COMMIT'); return r; }
  catch (e) { d.exec('ROLLBACK'); throw e; }
}

function insertEvent(d, { kind, agent = null, to_agent = null, video_id = null, text = null, demo = 0 }) {
  const row = {
    kind: oneOf(kind, EVENT_KINDS, 'kind'),
    agent: checkAgent(agent),
    to_agent: checkAgent(to_agent, 'to_agent'),
    video_id: checkVideoId(video_id),
    text: shortText(text, 'text'),
  };
  const r = d.prepare('INSERT INTO events (at, kind, agent, to_agent, video_id, text, demo) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(nowIso(), row.kind, row.agent, row.to_agent, row.video_id, row.text, demo ? 1 : 0);
  return Number(r.lastInsertRowid);
}

/** Appends one event (append-only table). Returns its id. */
export function addEvent(ev) {
  return tx((d) => insertEvent(d, ev));
}

const STATE_EVENT = { working: 'run_start', idle: 'run_end', waiting: 'note', error: 'error' };
// Everything the owner sees is in French: the default event text of a state change, shown in the vitrine's feed.
const STATE_FR = { working: 'en cours', idle: 'terminé', waiting: 'en attente', error: 'erreur' };

/** Changes an agent's state/task/video and appends the matching event in the same transaction. */
export function setAgent(id, { state, task = null, video_id = null, text } = {}) {
  checkAgent(id);
  oneOf(state, AGENT_STATES, 'state');
  const t = shortText(task, 'task', 200);
  const v = checkVideoId(video_id);
  return tx((d) => {
    d.prepare('UPDATE agents SET state = ?, task = ?, video_id = ?, updated_at = ? WHERE id = ?').run(state, t, v, nowIso(), id);
    const eventId = insertEvent(d, { kind: STATE_EVENT[state], agent: id, video_id: v, text: text ?? (t ? `${STATE_FR[state]} : ${t}` : STATE_FR[state]) });
    return { id, state, task: t, video_id: v, event_id: eventId };
  });
}

/** Creates or updates a video row (only the given fields change). */
export function upsertVideo({ id, topic, lane, status, script_path, video_path, planned_publish_date }) {
  const vid = checkVideoId(id);
  if (!vid) throw new Error('video id is required');
  if (status !== undefined) oneOf(status, VIDEO_STATUSES, 'status');
  const at = nowIso();
  return tx((d) => {
    const cur = d.prepare('SELECT * FROM videos WHERE id = ?').get(vid);
    const next = {
      topic: topic !== undefined ? shortText(topic, 'topic', 300) : cur?.topic ?? null,
      lane: lane !== undefined ? shortText(lane, 'lane', 80) : cur?.lane ?? null,
      status: status ?? cur?.status ?? 'idea',
      script_path: script_path !== undefined ? script_path : cur?.script_path ?? null,
      video_path: video_path !== undefined ? video_path : cur?.video_path ?? null,
      planned_publish_date: planned_publish_date !== undefined ? plannedDate(planned_publish_date) : cur?.planned_publish_date ?? null,
    };
    if (cur) {
      d.prepare('UPDATE videos SET topic = ?, lane = ?, status = ?, script_path = ?, video_path = ?, planned_publish_date = ?, updated_at = ? WHERE id = ?')
        .run(next.topic, next.lane, next.status, next.script_path, next.video_path, next.planned_publish_date, at, vid);
    } else {
      d.prepare('INSERT INTO videos (id, topic, lane, status, script_path, video_path, planned_publish_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(vid, next.topic, next.lane, next.status, next.script_path, next.video_path, next.planned_publish_date, at, at);
    }
    return { id: vid, ...next, created: !cur };
  });
}

/** Creates or updates one post draft (one row per platform per video). Never sets published_at or url from agents. */
export function upsertPost({ video_id, platform, title, caption, hashtags, ai_label, scheduled_at }) {
  const vid = checkVideoId(video_id);
  oneOf(platform, PLATFORMS, 'platform');
  const tags = Array.isArray(hashtags) ? hashtags.join(' ') : hashtags ?? null;
  return tx((d) => {
    const cur = d.prepare('SELECT * FROM posts WHERE video_id = ? AND platform = ?').get(vid, platform);
    if (cur?.status === 'published') throw new Error(`${vid} is already published on ${platform}: the draft can no longer change`);
    // A time set by the owner's yes (scheduled or stopped) is never moved by a draft save.
    const locked = cur?.status === 'scheduled' || cur?.status === 'stopped';
    const next = {
      title: title !== undefined ? title : cur?.title ?? null,
      caption: caption !== undefined ? caption : cur?.caption ?? null,
      hashtags: hashtags !== undefined ? tags : cur?.hashtags ?? null,
      ai_label: ai_label !== undefined ? (ai_label ? 1 : 0) : cur?.ai_label ?? 1,
      scheduled_at: scheduled_at !== undefined && !locked ? scheduled_at : cur?.scheduled_at ?? null,
    };
    if (cur) {
      d.prepare('UPDATE posts SET title = ?, caption = ?, hashtags = ?, ai_label = ?, scheduled_at = ? WHERE video_id = ? AND platform = ?')
        .run(next.title, next.caption, next.hashtags, next.ai_label, next.scheduled_at, vid, platform);
    } else {
      d.prepare('INSERT INTO posts (video_id, platform, title, caption, hashtags, ai_label, scheduled_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(vid, platform, next.title, next.caption, next.hashtags, next.ai_label, next.scheduled_at);
    }
    return { video_id: vid, platform, ...next };
  });
}

function insertApproval(d, { kind, vid, agent, text, tag = '' }) {
  const at = nowIso();
  const tmp = `tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const r = d.prepare('INSERT INTO approvals (ref, video_id, kind, status, created_at) VALUES (?, ?, ?, \'pending\', ?)').run(tmp, vid, kind, at);
  const ref = `ap-${Number(r.lastInsertRowid)}`;
  d.prepare('UPDATE approvals SET ref = ? WHERE id = ?').run(ref, r.lastInsertRowid);
  const base = text ?? `${ref}: ${kind} waiting for the owner`;
  // A released queue item always starts with its ref and ends with its queue tag (releaseDueApprovals reads both).
  const full = tag ? `${(text ? `${ref}: ${text}` : base).slice(0, 440)} ${tag}` : base;
  insertEvent(d, { kind: 'approval_request', agent, video_id: vid, text: full });
  return ref;
}

// ---------- quiet hours (added 2026-10-20): THE choke point for every approval ----------
// A notifier may message the owner for every pending row, so no row is inserted during core/daily.json quietHours:
// the request goes to QUEUE_PATH (append-only jsonl) and core/approval-waiter.mjs releases it at the end of the quiet hours.
// Lines: {type:'queued', id, kind, video_id, agent, text, queued_at, release_at}, {type:'released', id, ref, released_at}
// and {type:'cancelled', id, reason, cancelled_at} (cancelQueuedApproval; a cancelled item is never released).

/** Queued items, oldest first (unreleased only unless includeReleased). */
export function listQueuedApprovals({ includeReleased = false } = {}) {
  if (!existsSync(QUEUE_PATH)) return [];
  const items = new Map();
  for (const line of readFileSync(QUEUE_PATH, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; } // a torn last line is ignored, never fatal
    if (r.type === 'queued' && r.id && !items.has(r.id)) items.set(r.id, { ...r, released: null });
    else if (r.type === 'released' && items.has(r.id) && !items.get(r.id).released) items.set(r.id, { ...items.get(r.id), released: { ref: r.ref ?? null, at: r.released_at } });
    else if (r.type === 'cancelled' && items.has(r.id)) items.set(r.id, { ...items.get(r.id), cancelled: { reason: r.reason ?? null, at: r.cancelled_at } });
  }
  const all = [...items.values()].map((q) => ({ cancelled: null, ...q }));
  return includeReleased ? all : all.filter((q) => !q.released && !q.cancelled);
}

/**
 * Added 2026-10-21: cancels one unreleased queued item, so no waiter or releaser ever turns it into an approval.
 * Appends {type:'cancelled', id, reason, cancelled_at} and, for a waiter launched before this change (its code only
 * knows 'released'), a {type:'released', id, ref:null, cancelled:true} line. Both readers then skip it. Logs a note event.
 */
export function cancelQueuedApproval(id, { reason, agent = 'chief_of_staff' } = {}) {
  const why = shortText(reason, 'reason', 240);
  if (!why) throw new Error('reason is required');
  checkAgent(agent);
  const q = listQueuedApprovals({ includeReleased: true }).find((x) => x.id === id);
  if (!q) throw new Error(`no queued approval ${id}`);
  if (q.cancelled) throw new Error(`${id} is already cancelled`);
  if (q.released) throw new Error(`${id} was already released as ${q.released.ref ?? '(no ref)'}: decide that approval instead`);
  const at = nowIso();
  appendFileSync(QUEUE_PATH, `${JSON.stringify({ type: 'cancelled', id, reason: why, cancelled_at: at })}
`, 'utf8');
  appendFileSync(QUEUE_PATH, `${JSON.stringify({ type: 'released', id, ref: null, cancelled: true, released_at: at })}
`, 'utf8');
  addEvent({ kind: 'note', agent, video_id: q.video_id, text: `queued ${q.kind} approval ${id} cancelled: ${why}` });
  return { id, kind: q.kind, video_id: q.video_id, cancelled_at: at };
}

/** The unreleased queued item for this video and kind, or null. */
export const findQueuedApproval = (video_id, kind) => listQueuedApprovals().find((q) => q.video_id === (video_id ?? null) && q.kind === kind) ?? null;

function queueApproval({ kind, vid, agent, text, at }) {
  const existing = findQueuedApproval(vid, kind);
  const item = existing ?? {
    type: 'queued', id: `q-${at.getTime().toString(36)}-${randomBytes(3).toString('hex')}`, kind, video_id: vid, agent, text,
    queued_at: at.toISOString(), release_at: quietReleaseAt(at).toISOString(),
  };
  if (!existing) {
    mkdirSync(path.dirname(QUEUE_PATH), { recursive: true });
    appendFileSync(QUEUE_PATH, `${JSON.stringify(item)}\n`, 'utf8');
    addEvent({ kind: 'note', agent, video_id: vid, text: `approval queued until ${scheduleConfig().quietHours.end} (quiet hours): ${kind}${vid ? ` for ${vid}` : ''}` });
  }
  let waiter;
  try { waiter = ensureWaiter({ releaseAt: item.release_at, waiterFile: WAITER_PATH }); } catch (e) {
    console.error(`approval waiter not launched: ${e.message}`); // the queue is kept; core/release-approvals.mjs releases it by hand
    waiter = { launched: false, pid: null, reason: e.message };
  }
  return { ref: null, queued: true, release_at: item.release_at, queue_id: item.id, already_queued: Boolean(existing), waiter };
}

/**
 * Opens a pending approval and logs an approval_request event: { ref: 'ap-N', queued: false }.
 * During the quiet hours nothing is inserted: { ref: null, queued: true, release_at, queue_id } (see queueApproval).
 */
export function createApproval(kind, video_id, { agent = null, text = null } = {}) {
  oneOf(kind, APPROVAL_KINDS, 'kind');
  const vid = checkVideoId(video_id);
  checkAgent(agent);
  const t = shortText(text, 'text');
  const at = scheduleNow();
  if (inQuietHours(at)) return queueApproval({ kind, vid, agent, text: t, at });
  try { releaseDueApprovals({ asOf: at }); } catch (e) { console.error(`queued approvals not released: ${e.message}`); } // older ones first, if a waiter missed 07:00
  return { ref: tx((d) => insertApproval(d, { kind, vid, agent, text: t })), queued: false };
}

/**
 * Inserts every queued item due at asOf as a real approval (normal ap-N ref), oldest first, and appends a
 * 'released' line for it. Idempotent: the approval_request event carries "[queue <id>]" and is checked in the same
 * transaction, so a crash between the insert and the jsonl line, or two releasers at once, never double-inserts.
 */
export function releaseDueApprovals({ asOf = scheduleNow() } = {}) {
  const due = listQueuedApprovals().filter((q) => Date.parse(q.release_at) <= asOf.getTime());
  return due.map((q) => {
    const tag = `[queue ${q.id}]`;
    const r = tx((d) => {
      const dup = d.prepare("SELECT text FROM events WHERE kind = 'approval_request' AND text LIKE ? LIMIT 1").get(`%${tag}%`);
      if (dup) return { ref: /^(ap-\d+)/.exec(dup.text)?.[1] ?? null, duplicate: true };
      const ref = insertApproval(d, { kind: q.kind, vid: q.video_id, agent: q.agent, text: q.text ?? null, tag });
      return { ref, duplicate: false };
    });
    appendFileSync(QUEUE_PATH, `${JSON.stringify({ type: 'released', id: q.id, ref: r.ref, released_at: nowIso() })}\n`, 'utf8');
    return { queue_id: q.id, kind: q.kind, video_id: q.video_id, ...r };
  });
}

/** Where the owner's answer came from (recorded in the event text). phone = a message relayed from the owner's phone;
 *  assistant = a supervising Claude session relaying the owner's words. */
export const DECISION_SOURCES = ['thread', 'vitrine', 'phone', 'assistant'];
const checkSource = (s) => (s === undefined || s === null ? null : oneOf(String(s), DECISION_SOURCES, 'source'));
const via = (s) => (s ? ` (via ${s})` : '');

/**
 * Decides a pending approval (the owner's CLI only). status: approved | changes | rejected.
 * THE choke point of the standing order (2026-10-21): a VIDEO approval that becomes 'approved' also plans its
 * publication in the same transaction (planPublication). Script and post approvals never do.
 */
export function decideApproval(ref, status, note = null, { source = null } = {}) {
  oneOf(status, APPROVAL_STATUSES.filter((s) => s !== 'pending'), 'status');
  if (!/^ap-\d+$/.test(String(ref))) throw new Error(`"${ref}" is not an approval ref (ap-N)`);
  const src = checkSource(source);
  return tx((d) => {
    const cur = d.prepare('SELECT * FROM approvals WHERE ref = ?').get(ref);
    if (!cur) throw new Error(`no approval ${ref}`);
    if (cur.status !== 'pending') throw new Error(`${ref} is already ${cur.status}`);
    const n = shortText(note, 'note', 1000);
    d.prepare('UPDATE approvals SET status = ?, note = ?, decided_at = ? WHERE ref = ?').run(status, n, nowIso(), ref);
    insertEvent(d, { kind: 'approval_decision', video_id: cur.video_id, text: `${ref} ${status}${via(src)}${n ? `: ${n}` : ''}`.slice(0, 500) });
    const publication = cur.kind === 'video' && status === 'approved' && cur.video_id ? planPublication(d, cur) : null;
    return { ref, kind: cur.kind, video_id: cur.video_id, status, note: n, source: src, publication };
  });
}

/** Local dates (studio time zone) that already hold a publication of another video: max 1 a day. */
function takenPublishDates(d, vid) {
  const rows = d.prepare(`SELECT COALESCE(published_at, scheduled_at) AS at FROM posts
    WHERE video_id <> ? AND (status IN ('scheduled', 'published') OR (published_at IS NOT NULL AND published_at <> ''))`).all(vid);
  return [...new Set(rows.filter((r) => r.at && !Number.isNaN(Date.parse(r.at))).map((r) => localDate(new Date(r.at))))];
}

/** Inserts an already-approved approval (no pending row, so no notification) with its decision event. */
function insertDecidedApproval(d, { kind, vid, note, text }) {
  const at = nowIso();
  const tmp = `tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const r = d.prepare("INSERT INTO approvals (ref, video_id, kind, status, note, created_at, decided_at) VALUES (?, ?, ?, 'approved', ?, ?, ?)").run(tmp, vid, kind, note, at, at);
  const ref = `ap-${Number(r.lastInsertRowid)}`;
  d.prepare('UPDATE approvals SET ref = ? WHERE id = ?').run(ref, r.lastInsertRowid);
  insertEvent(d, { kind: 'approval_decision', video_id: vid, text: `${ref} approved: ${text}`.slice(0, 500) });
  return ref;
}

/**
 * Standing order + guard (brand/lanes.md RULES 4): the owner's "oui" on video approval ap (a row of kind 'video') makes
 * the studio (1) keep or build the youtube/instagram/tiktok drafts, (2) set scheduled_at = publish_at (ISO UTC, Z) and
 * status = 'scheduled' on ALL three rows, (3) record an approved 'post' approval, note "source=video-oui; video=ap-N".
 * No planned date, a missing draft or a late gated lane: nothing is scheduled, no post approval, a note says why.
 * Rows already published are never touched. Runs inside decideApproval's transaction. No Claude run.
 */
function planPublication(d, ap) {
  const vid = ap.video_id;
  const v = d.prepare('SELECT * FROM videos WHERE id = ?').get(vid);
  const note = (text) => { insertEvent(d, { kind: 'note', agent: 'publisher', video_id: vid, text: text.slice(0, 500) }); };
  if (!v) { note(`${ap.ref}: no video row for ${vid}: not scheduled`); return { scheduled: false, reason: 'no video row' }; }
  const existing = new Map(d.prepare('SELECT * FROM posts WHERE video_id = ?').all(vid).map((p) => [p.platform, p]));
  const published = PLATFORMS.filter((p) => existing.get(p)?.status === 'published' || existing.get(p)?.published_at);
  if (published.length) { note(`${ap.ref}: already published on ${published.join(', ')}: not rescheduled`); return { scheduled: false, reason: 'already published' }; }

  const missing = PLATFORMS.filter((p) => !existing.get(p)?.caption);
  const built = missing.length ? buildDrafts({ platforms: missing, script: readScript(STUDIO_ROOT, v.script_path), topic: v.topic }) : { drafts: {}, errors: [] };
  for (const [platform, dr] of Object.entries(built.drafts)) {
    const tags = dr.hashtags.join(' ');
    if (existing.has(platform)) d.prepare('UPDATE posts SET title = ?, caption = ?, hashtags = ?, ai_label = 1 WHERE video_id = ? AND platform = ?').run(dr.title ?? null, dr.caption, tags, vid, platform);
    else d.prepare('INSERT INTO posts (video_id, platform, title, caption, hashtags, ai_label) VALUES (?, ?, ?, ?, ?, 1)').run(vid, platform, dr.title ?? null, dr.caption, tags);
  }
  const drafts = { reused: PLATFORMS.filter((p) => !missing.includes(p)), built: Object.keys(built.drafts) };
  if (built.errors.length) {
    insertEvent(d, { kind: 'error', agent: 'publisher', video_id: vid, text: `${ap.ref}: drafts missing, not scheduled: ${built.errors.join(' | ')}`.slice(0, 500) });
    return { scheduled: false, reason: 'drafts missing', drafts, errors: built.errors };
  }

  const plan = computePublishAt({ plannedDate: v.planned_publish_date, approvedAt: scheduleNow(), lane: v.lane, takenDates: takenPublishDates(d, vid) });
  if (!plan.publish_at) { note(`${ap.ref}: ${plan.reason}`); return { scheduled: false, reason: plan.reason, drafts }; }
  d.prepare("UPDATE posts SET scheduled_at = ?, status = 'scheduled' WHERE video_id = ?").run(plan.publish_at, vid);
  const postRef = insertDecidedApproval(d, {
    kind: 'post', vid, note: `source=video-oui; video=${ap.ref}`,
    text: `source=video-oui; video=${ap.ref}; publish at ${plan.publish_at} (${plan.local} local)`,
  });
  note(`${vid} scheduled for ${plan.local} local (${plan.publish_at}) on ${PLATFORMS.join(', ')}${plan.reason ? `; ${plan.reason}` : ''}. A notice may be sent 1 h before; "stop ${ap.ref}" cancels.`);
  return { scheduled: true, publish_at: plan.publish_at, local: plan.local, reason: plan.reason, post_ref: postRef, drafts };
}

/**
 * "stop ap-N": ref = the video approval (or the auto post approval, which points to it). Every not-yet-published post
 * row of that video gets status 'stopped' (scheduled_at kept for the record). Logs a note event. Idempotent.
 */
export function stopPublication(ref, note = null, { source = null } = {}) {
  if (!/^ap-\d+$/.test(String(ref))) throw new Error(`"${ref}" is not an approval ref (ap-N)`);
  const src = checkSource(source);
  const n = shortText(note, 'note', 300);
  return tx((d) => {
    const ap = d.prepare('SELECT * FROM approvals WHERE ref = ?').get(ref);
    if (!ap) throw new Error(`no approval ${ref}`);
    if (ap.kind === 'script') throw new Error(`${ref} is a script approval: nothing to stop (only a video or post ref)`);
    if (!ap.video_id) throw new Error(`${ref} has no video`);
    const videoRef = ap.kind === 'post' ? (/video=(ap-\d+)/.exec(ap.note ?? '')?.[1] ?? ref) : ref;
    const rows = d.prepare('SELECT platform, status, published_at FROM posts WHERE video_id = ?').all(ap.video_id);
    if (!rows.length) throw new Error(`${ap.video_id} has no post rows: nothing to stop`);
    const isPub = (r) => r.status === 'published' || Boolean(r.published_at);
    const toStop = rows.filter((r) => !isPub(r) && r.status !== 'stopped').map((r) => r.platform);
    const published = rows.filter(isPub).map((r) => r.platform);
    if (toStop.length) {
      const up = d.prepare("UPDATE posts SET status = 'stopped' WHERE video_id = ? AND platform = ?");
      for (const p of toStop) up.run(ap.video_id, p);
      insertEvent(d, { kind: 'note', video_id: ap.video_id, text: `stop ${videoRef}${via(src)}: ${ap.video_id} will not be published (${toStop.join(', ')})${published.length ? `; already published: ${published.join(', ')}` : ''}${n ? `: ${n}` : ''}`.slice(0, 500) });
    }
    return { ref, video_ref: videoRef, video_id: ap.video_id, stopped: toStop, already: !toStop.length, published, source: src };
  });
}

/** The external publisher's report (data/publications.jsonl): marks one platform row published. Idempotent. */
export function markPublished({ video_id, platform, published_at, url }) {
  const vid = checkVideoId(video_id);
  oneOf(platform, PLATFORMS, 'platform');
  if (Number.isNaN(Date.parse(published_at))) throw new Error(`published_at must be an ISO date (got ${JSON.stringify(published_at)})`);
  const link = url ? String(url) : null;
  if (link && (!/^https:\/\//.test(link) || link.length > 500)) throw new Error('url must be an https url');
  return tx((d) => {
    const cur = d.prepare('SELECT status, published_at, url FROM posts WHERE video_id = ? AND platform = ?').get(vid, platform);
    if (!cur) return { changed: false, reason: 'no post row' };
    if (cur.status === 'published' && cur.published_at && (!link || cur.url === link)) return { changed: false, reason: 'already published' };
    d.prepare("UPDATE posts SET status = 'published', published_at = ?, url = COALESCE(?, url) WHERE video_id = ? AND platform = ?").run(cur.published_at || published_at, link, vid, platform);
    insertEvent(d, { kind: 'publish', agent: 'publisher', video_id: vid, text: `${vid} published on ${platform} (reported by the external publisher)` });
    return { changed: true };
  });
}

export function listApprovals({ status = 'pending' } = {}) {
  const d = openDb();
  return status === 'all'
    ? d.prepare('SELECT * FROM approvals ORDER BY id').all()
    : d.prepare('SELECT * FROM approvals WHERE status = ? ORDER BY id').all(status);
}

const intOrNull = (v, name) => {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
  return n;
};

/** Records one metrics snapshot for a video on a platform. */
export function addMetric({ video_id, platform, at = nowIso(), checkpoint = null, views, likes, comments, shares, avg_view_pct, followers_delta }) {
  const vid = checkVideoId(video_id);
  oneOf(platform, PLATFORMS, 'platform');
  if (checkpoint !== null) oneOf(checkpoint, CHECKPOINTS, 'checkpoint');
  const pct = avg_view_pct === undefined || avg_view_pct === null ? null : Number(avg_view_pct);
  if (pct !== null && !(pct >= 0 && pct <= 1000)) throw new Error('avg_view_pct must be a number');
  return tx((d) => {
    d.prepare(`INSERT OR REPLACE INTO metrics (video_id, platform, at, checkpoint, views, likes, comments, shares, avg_view_pct, followers_delta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(vid, platform, at, checkpoint, intOrNull(views, 'views'), intOrNull(likes, 'likes'),
      intOrNull(comments, 'comments'), intOrNull(shares, 'shares'), pct, intOrNull(followers_delta, 'followers_delta'));
    return { video_id: vid, platform, at, checkpoint };
  });
}

/** Read-only snapshot used by tools and the CLI. */
/** {paused, since?, source?} from data/production-paused.json (the pause stops making AND publishing). */
export function pauseState() {
  const f = path.join(STUDIO_ROOT, 'data', 'production-paused.json');
  if (!existsSync(f)) return { paused: false };
  try { return { paused: true, ...JSON.parse(readFileSync(f, 'utf8')) }; } catch { return { paused: true }; }
}
/** Next 2-a-day slot (core/daily.json autonomy.two_a_day.slots, studio time), e.g. "20:00 (heure du studio, aujourd'hui)", or null when off. */
export function nextSlot(t = new Date()) {
  try {
    const cfg = JSON.parse(readFileSync(path.join(STUDIO_ROOT, 'core', 'daily.json'), 'utf8')).autonomy?.two_a_day;
    if (!cfg?.on) return null;
    const now = studioParts(t).minutes;
    const slots = (cfg.slots ?? ['13:00', '20:00']).map((s) => { const [h, m] = s.split(':').map(Number); return { s, min: h * 60 + m }; }).sort((a, b) => a.min - b.min);
    const next = slots.find((x) => x.min > now);
    return next ? `${next.s} (heure du studio, aujourd'hui)` : `${slots[0].s} (heure du studio, demain)`;
  } catch { return null; }
}

export function getState() {
  const d = openDb();
  const p = studioParts();
  const dayStartUtc = studioInstant(p.date, '00:00').toISOString();
  return {
    agents: d.prepare('SELECT * FROM agents ORDER BY team, id').all(),
    videos: d.prepare('SELECT * FROM videos ORDER BY updated_at DESC LIMIT 10').all(),
    approvals: d.prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY id").all(),
    posts: d.prepare('SELECT * FROM posts ORDER BY rowid DESC LIMIT 10').all(),
    events: d.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 20').all(),
    // 2026-10-24 (review M3, M0): what the chief of staff needs to answer the owner truthfully.
    pause: pauseState(),
    made_today: d.prepare("SELECT COUNT(*) AS n FROM videos WHERE id LIKE 's-%' AND created_at >= ?").get(dayStartUtc).n,
    next_slot: nextSlot(),
    studio_now: `${p.date} ${p.hhmm}`,
  };
}

/**
 * Videos created in the last `days` days (1-3650, default 60), newest first: for cooldown, weekly max and 60-day repeat checks.
 * Each row: id, topic, lane, status, planned_publish_date (YYYY-MM-DD or null), published_at (earliest post, or null), dates.
 */
export const MAX_RECENT_DAYS = 3650;
export function listRecentVideos(days = 60) {
  const n = Math.min(Math.max(Math.trunc(Number(days)) || 60, 1), MAX_RECENT_DAYS);
  const since = new Date(Date.now() - n * 86_400_000).toISOString();
  return openDb()
    .prepare(`SELECT v.id, v.topic, v.lane, v.status, v.planned_publish_date,
      (SELECT MIN(p.published_at) FROM posts p WHERE p.video_id = v.id AND p.published_at IS NOT NULL AND p.published_at <> '') AS published_at,
      v.created_at, v.updated_at
      FROM videos v WHERE v.created_at >= ? ORDER BY v.created_at DESC LIMIT 500`)
    .all(since);
}

export function getVideo(id) {
  return openDb().prepare('SELECT * FROM videos WHERE id = ?').get(checkVideoId(id)) ?? null;
}

// ---------- trends (added 2026-10-20: scan_trends / list_trends) ----------
// Created lazily so the original SCHEMA stays untouched. One row per video per scan; the latest scan is MAX(scanned_at).
export const TRENDS_SCHEMA = `
CREATE TABLE IF NOT EXISTS trends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scanned_at TEXT NOT NULL,
  source TEXT NOT NULL,
  query TEXT,
  video_url TEXT NOT NULL,
  title TEXT, channel TEXT, channel_url TEXT,
  views INTEGER, upload_date TEXT, duration_s INTEGER,
  ratio REAL, views_per_day REAL,
  gap INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scanned_at, video_url)
);
CREATE INDEX IF NOT EXISTS trends_scan ON trends (scanned_at);
`;
export const TREND_SOURCES = ['query', 'channel', 'tiktok']; // tiktok: web-search sweep of TikTok trends

let trendsReadyOn = null; // the handle the trends table was checked on
function trendsDb() {
  const d = openDb();
  if (trendsReadyOn !== d) { d.exec(TRENDS_SCHEMA); migrateTrendFlags(d); trendsReadyOn = d; }
  return d;
}

// Added 2026-10-20: "not usable" flag (brand/not-usable.md applies to any concept). Additive migration: the two columns are added when missing;
// existing rows keep usable NULL until core/trends.mjs classifies them (backfillTrendFlags).
export const TREND_FLAG_COLUMNS = { usable: 'INTEGER', flag_reason: 'TEXT' };
function migrateTrendFlags(d) {
  const have = new Set(d.prepare('PRAGMA table_info(trends)').all().map((c) => c.name));
  for (const [col, type] of Object.entries(TREND_FLAG_COLUMNS)) if (!have.has(col)) d.exec(`ALTER TABLE trends ADD COLUMN ${col} ${type}`);
}
const numOrNull = (v) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? null : Number(v));
const trendUrl = (u) => {
  const s = String(u ?? '');
  if (!/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|tiktok\.com)\//i.test(s) || s.length > 300) throw new Error(`video_url must be a YouTube or TikTok https url (got ${JSON.stringify(s.slice(0, 80))})`);
  return s;
};

/** Stores one scan's rows (all with the same scanned_at). Duplicate urls in a scan are ignored. Returns the count stored. */
export function insertTrends(rows, scannedAt = nowIso()) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  if (Number.isNaN(Date.parse(scannedAt))) throw new Error('scanned_at must be an ISO date');
  trendsDb();
  return tx((d) => {
    const ins = d.prepare(`INSERT OR IGNORE INTO trends (scanned_at, source, query, video_url, title, channel, channel_url, views, upload_date, duration_s, ratio, views_per_day, gap, usable, flag_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let n = 0;
    for (const r of rows) {
      const ch = r.channel_url ? String(r.channel_url) : null;
      const res = ins.run(scannedAt, oneOf(r.source, TREND_SOURCES, 'source'), shortText(r.query, 'query', 200), trendUrl(r.video_url),
        shortText(r.title, 'title', 300), shortText(r.channel, 'channel', 200), ch && /^https:\/\//.test(ch) ? ch.slice(0, 300) : null,
        numOrNull(r.views) === null ? null : Math.trunc(Number(r.views)), r.upload_date && /^\d{8}$/.test(String(r.upload_date)) ? String(r.upload_date) : null,
        numOrNull(r.duration_s) === null ? null : Math.round(Number(r.duration_s)), numOrNull(r.ratio), numOrNull(r.views_per_day), r.gap ? 1 : 0,
        r.usable === undefined || r.usable === null ? null : (r.usable ? 1 : 0), shortText(r.flag_reason, 'flag_reason', 300));
      n += Number(res.changes);
    }
    return n;
  });
}

/** YYYYMMDD -> YYYY-MM-DD (null when missing or malformed). */
const uploadDay = (u) => { const s = String(u ?? ''); return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null; };
/**
 * Added 2026-10-21 (brand/lanes.md TREND GATE): first_seen = the earliest of the first scan that stored this video_url
 * (UTC date of its scanned_at) and its upload_date; first_seen_from says which. name_as_typed = the title as people type it.
 */
function withTrendDates(r) {
  const scan = r.first_scanned_at ? String(r.first_scanned_at).slice(0, 10) : null;
  const up = uploadDay(r.upload_date);
  const firstSeen = [scan, up].filter(Boolean).sort()[0] ?? null;
  const { first_scanned_at: _f, ...rest } = r;
  return { ...rest, name_as_typed: r.title ?? null, first_seen: firstSeen, first_seen_from: !firstSeen ? null : firstSeen === up ? 'upload_date' : 'first_scan' };
}

/** Top rows of the latest scan: ratio first (nulls last), then views per day; each with first_seen and name_as_typed. */
export function listTrends({ limit = 10 } = {}) {
  const n = Math.min(Math.max(Math.trunc(Number(limit)) || 10, 1), 100);
  const d = trendsDb();
  const last = d.prepare('SELECT MAX(scanned_at) AS at FROM trends').get()?.at ?? null;
  if (!last) return { scanned_at: null, rows: [] };
  const rows = d.prepare(`SELECT id, source, query, video_url, title, channel, channel_url, views, upload_date, duration_s, ratio, views_per_day, gap, usable, flag_reason,
    (SELECT MIN(t2.scanned_at) FROM trends t2 WHERE t2.video_url = t.video_url) AS first_scanned_at
    FROM trends t WHERE scanned_at = ? AND source != 'tiktok' ORDER BY ratio IS NULL, ratio DESC, views_per_day DESC LIMIT ?`).all(last, n).map(withTrendDates);
  const c = d.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN usable = 1 THEN 1 ELSE 0 END) AS usable FROM trends WHERE scanned_at = ? AND source != 'tiktok'").get(last);
  // TikTok trends of the same scan (web-search sweep: no view counts), listed apart so they never push YouTube rows out.
  const tiktok = d.prepare("SELECT id, query, video_url, title, channel, upload_date FROM trends WHERE scanned_at = ? AND source = 'tiktok' ORDER BY id LIMIT 15").all(last);
  return { scanned_at: last, total: Number(c.total), usable: Number(c.usable ?? 0), rows, tiktok };
}

/**
 * TikTok trends from a web-search sweep (trend_scout, 2026-10-24): stored with the latest YouTube scan's scanned_at, so the
 * Trending wall and list_trends keep showing that scan. rows: [{kind: hashtag|sound|format, name, why, source_site, seen_date, url}]
 * url must be a tiktok.com https link (tag, music or search page). Returns the count stored.
 */
export function insertTikTokTrends(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('rows must be a non-empty array');
  if (rows.length > 15) throw new Error('at most 15 TikTok rows per sweep');
  const scan = trendsDb().prepare("SELECT MAX(scanned_at) AS at FROM trends WHERE source IN ('query', 'channel')").get()?.at;
  if (!scan) throw new Error('no YouTube scan yet: run the trend scan first');
  const kinds = ['hashtag', 'sound', 'format'];
  return insertTrends(rows.map((r) => {
    const kind = kinds.includes(r.kind) ? r.kind : 'format';
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(r.seen_date ?? '')) ? String(r.seen_date).replace(/-/g, '') : null;
    return { source: 'tiktok', query: `web: ${shortText(r.source_site, 'source_site', 80) || 'web'}${r.why ? ` | ${r.why}` : ''}`.slice(0, 200),
      video_url: r.url, title: shortText(r.name, 'name', 200), channel: `TikTok · ${kind}`, upload_date: day, usable: 1 };
  }), scan);
}

/** Rows to classify: those never classified (usable IS NULL), or every row when all = true. */
export function listTrendsForFlags({ all = false } = {}) {
  return trendsDb().prepare(`SELECT id, title, channel, usable, flag_reason FROM trends ${all ? '' : 'WHERE usable IS NULL'} ORDER BY id`).all();
}

/** Writes classifier results [{id, usable, flag_reason}] in one transaction (no event: code, not an agent). */
export function updateTrendFlags(rows) {
  trendsDb();
  return tx((d) => {
    const up = d.prepare('UPDATE trends SET usable = ?, flag_reason = ? WHERE id = ?');
    let n = 0;
    for (const r of rows) n += Number(up.run(r.usable ? 1 : 0, shortText(r.flag_reason, 'flag_reason', 300), Math.trunc(Number(r.id))).changes);
    return n;
  });
}

/** An agent corrects one trend's flag; appends a note event in the same transaction. */
export function setTrendFlag({ agent, id, usable, reason }) {
  checkAgent(agent);
  const tid = Number(id);
  if (!Number.isInteger(tid) || tid < 1) throw new Error('id must be a positive integer');
  const why = shortText(reason, 'reason', 240);
  if (!why) throw new Error('reason is required');
  trendsDb();
  return tx((d) => {
    const cur = d.prepare('SELECT id, title, usable, flag_reason FROM trends WHERE id = ?').get(tid);
    if (!cur) throw new Error(`no trend ${tid} (not found)`);
    const flag = `set by ${agent}: ${why}`;
    d.prepare('UPDATE trends SET usable = ?, flag_reason = ? WHERE id = ?').run(usable ? 1 : 0, flag, tid);
    const eventId = insertEvent(d, { kind: 'note', agent, text: `Tendance ${tid} marquée ${usable ? 'utilisable' : 'NON utilisable'} pour l'émission : ${why}`.slice(0, 500) });
    return { id: tid, usable: usable ? 1 : 0, flag_reason: flag, was: { usable: cur.usable, flag_reason: cur.flag_reason }, event_id: eventId };
  });
}

// ---------- metrics_pull helpers (added 2026-10-20) ----------
/** Post rows that carry a public url (published by the owner's yes). */
export function listPublishedPosts() {
  return openDb().prepare("SELECT video_id, platform, url, published_at FROM posts WHERE url IS NOT NULL AND url <> '' ORDER BY published_at").all();
}

/** Checkpoints already recorded for one video on one platform. */
export function listMetricCheckpoints(video_id, platform) {
  return openDb().prepare('SELECT DISTINCT checkpoint FROM metrics WHERE video_id = ? AND platform = ? AND checkpoint IS NOT NULL')
    .all(checkVideoId(video_id), oneOf(platform, PLATFORMS, 'platform')).map((r) => r.checkpoint);
}
