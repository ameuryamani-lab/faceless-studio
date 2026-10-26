// Faceless Studio: publication planning (added 2026-10-21, standing order + guard).
// Pure helpers, no database: when a video's VIDEO approval becomes 'approved', core/db.mjs decideApproval uses them to
// build the missing per-platform drafts and to compute publish_at. An external publisher publishes; the studio only prepares the data.
// 2026-10-24 (the concept is a parameter): the fallback drafts carry the hashtags the caller passes (the video's concept,
// core/publish-direct.mjs drafts()), else a neutral pair; no show's name is written here any more. This file must not import
// core/concept.mjs: core/db.mjs imports this file and concept.mjs imports db.mjs (a cycle that would crash at load).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { localParts, scheduleConfig } from './schedule.mjs';
import { validateCaptions } from './guardrails/index.ts';

export const PUBLISH_AT = '18:00';      // local time on the slot date
export const NOTICE_MS = 60 * 60_000;   // the publication notice comes at least 1 h before
export const LAST_PUBLISH = '23:30';    // never later than this, local
export const GATED_LANES = ['trend', 'calendar']; // lanes whose topic expires (a trend, a calendar date): a late approval must re-check the gate, never auto-scheduled
const DAY_MS = 86_400_000;

const tz = () => scheduleConfig().timezone;

/** The UTC instant when the local clock (studio time zone) reads hhmm on the local date YYYY-MM-DD. */
export function localInstant(date, hhmm, zone = tz()) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall;
  for (let i = 0; i < 3; i += 1) { // converge on the zone offset (DST-safe)
    const p = localParts(new Date(t), zone);
    t += wall - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  }
  return new Date(t);
}
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const localDate = (d, zone = tz()) => localParts(d, zone).date;

/**
 * publish_at for a video approved at approvedAt (Date), planned for plannedDate (YYYY-MM-DD, local) or null.
 * - no date: { publish_at: null, reason: 'no date: not scheduled' }
 * - approved before 17:00 local on (or before) the slot date: slot date 18:00
 * - approved later that day: approval + 1 h, unless that is after 23:30, then 18:00 the next day
 * - approved after the slot date: gated lanes (trend, calendar) are not scheduled; others follow the same rule on the
 *   approval day (the slot day has passed)
 * - max 1 publication a day: a local date in takenDates moves it to 18:00 the next free day
 */
export function computePublishAt({ plannedDate, approvedAt, lane = null, takenDates = [], zone = tz() }) {
  if (!plannedDate) return { publish_at: null, reason: 'no date: not scheduled' };
  const approvedDay = localDate(approvedAt, zone);
  const late = approvedDay > plannedDate;
  if (late && GATED_LANES.includes(lane)) return { publish_at: null, reason: `approved after its slot date ${plannedDate} (${lane}): gate must be re-checked, not scheduled` };
  let day = late ? approvedDay : plannedDate;
  let t;
  if (approvedAt.getTime() + NOTICE_MS <= localInstant(day, PUBLISH_AT, zone).getTime()) t = localInstant(day, PUBLISH_AT, zone);
  else {
    const soon = new Date(approvedAt.getTime() + NOTICE_MS);
    if (soon.getTime() <= localInstant(day, LAST_PUBLISH, zone).getTime()) t = soon;
    else { day = addDays(day, 1); t = localInstant(day, PUBLISH_AT, zone); }
  }
  const notes = late ? [`slot date ${plannedDate} passed`] : [];
  const taken = new Set(takenDates);
  while (taken.has(localDate(t, zone))) {
    const from = localDate(t, zone);
    t = localInstant(addDays(from, 1), PUBLISH_AT, zone);
    notes.push(`${from} already has a publication`);
  }
  return { publish_at: t.toISOString(), local: `${localDate(t, zone)} ${localParts(t, zone).hhmm}`, reason: notes.join('; ') || null };
}

// ---------- drafts ----------
const stripTag = (s) => String(s ?? '').replace(/^\s*\[[^\]]*\]\s*/, '').trim();

/** The script JSON of a video (script_path, relative to the studio root), or null when missing or unreadable. */
export function readScript(root, scriptPath) {
  if (!scriptPath) return null;
  const full = path.resolve(root, scriptPath);
  if (!full.startsWith(path.resolve(root) + path.sep)) return null;
  try { return JSON.parse(readFileSync(full, 'utf8')); } catch { return null; }
}

/** Fallback hashtags when the caller passes none (no concept known): neutral, no show's name, never #fyp or #reels. */
export const NEUTRAL_HASHTAGS = Object.freeze({ youtube: ['#Shorts', '#Animation'], instagram: ['#animation', '#shorts'], tiktok: ['#animation', '#shorts'] });
/** The caller's list for this platform (3-5 tags from concept.json), else the neutral pair. */
function fallbackTags(platform, hashtags) {
  const list = hashtags?.[platform];
  return Array.isArray(list) && list.length ? list.map(String) : [...NEUTRAL_HASHTAGS[platform]];
}
/** Fallback draft from the title or topic (publisher rules: plain claim, niche tags, never #fyp). */
function fallbackDraft(platform, title, hashtags) {
  if (platform === 'youtube') return { title: title.slice(0, 100), caption: `${title}.`, hashtags: fallbackTags(platform, hashtags) };
  return { caption: `${title}.`, hashtags: fallbackTags(platform, hashtags) };
}

/**
 * One draft per missing platform: the script's own captions first (copywriter output), else a fallback from the
 * title/topic with `hashtags` ({ youtube, instagram, tiktok } of the video's concept, else NEUTRAL_HASHTAGS).
 * Each draft goes through the same caption guardrail as save_post_draft. Returns { drafts, errors }.
 */
export function buildDrafts({ platforms, script, topic, hashtags = null }) {
  const title = stripTag(script?.title || topic || '');
  const drafts = {};
  const errors = [];
  for (const p of platforms) {
    const c = script?.captions?.[p];
    const fromScript = c && (p === 'youtube' ? c.title && c.description !== undefined : c.caption)
      ? { title: p === 'youtube' ? String(c.title) : undefined, caption: String(p === 'youtube' ? c.description : c.caption), hashtags: (c.hashtags ?? []).map(String) }
      : null;
    const d = fromScript ?? (title ? fallbackDraft(p, title, hashtags) : null);
    if (!d) { errors.push(`${p}: no script captions and no title`); continue; }
    const cap = p === 'youtube' ? { title: d.title ?? '', description: d.caption, hashtags: d.hashtags } : { caption: d.caption, hashtags: d.hashtags };
    const guard = validateCaptions({ [p]: cap }, { platforms: [p] });
    if (!guard.ok) { errors.push(`${p}: ${guard.errors.map((i) => i.message).join(' ').slice(0, 160)}`); continue; }
    drafts[p] = { ...d, source: fromScript ? 'script' : 'fallback' };
  }
  return { drafts, errors };
}
