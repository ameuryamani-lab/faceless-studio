// Faceless Studio: the schedule clock (core/daily.json, in the studio time zone core/local-config.mjs TIMEZONE).
// Render window, production days, scripts per day and quiet hours are decided here, from ONE clock:
//   STUDIO_NOW=<ISO> (tests only) starts a fake clock at that instant; it then runs at real speed.
//   advanceSimulated(ms) moves it forward (dry-run render simulation only; nothing sleeps).
// Event timestamps (db.mjs nowIso) stay on the real clock.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMEZONE } from './local-config.mjs';
import { studioInstant } from './studio-time.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DAILY_CONFIG = path.join(ROOT, 'core', 'daily.json');
const DAY_MS = 86_400_000;

let cfg = null;
export function scheduleConfig() {
  // The time zone is ONE setting (core/local-config.mjs TIMEZONE), whatever daily.json says.
  if (!cfg) cfg = { ...JSON.parse(readFileSync(DAILY_CONFIG, 'utf8')), timezone: TIMEZONE };
  return cfg;
}

// ---------- clock ----------
const STARTED = Date.now();
let simulatedMs = 0;
function fakeStart() {
  const s = process.env.STUDIO_NOW;
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`STUDIO_NOW is not an ISO date: ${s}`);
  return t;
}
export function now() {
  const start = fakeStart();
  return new Date((start === null ? Date.now() : start + (Date.now() - STARTED)) + simulatedMs);
}
export const isFakeClock = () => Boolean(process.env.STUDIO_NOW);
/** Dry-run only: a simulated render "took" ms. */
export function advanceSimulated(ms) { simulatedMs += ms; }

// ---------- local time ----------
export function toMinutes(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`"${hhmm}" is not an HH:MM time (core/daily.json)`);
  return Number(m[1]) * 60 + Number(m[2]);
}
export function localParts(d = now(), tz = scheduleConfig().timezone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const n = (k) => Number(p[k]);
  return {
    date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, hhmm: `${p.hour}:${p.minute}`,
    minutes: n('hour') * 60 + n('minute'), y: n('year'), mo: n('month'), d: n('day'), h: n('hour'), mi: n('minute'), s: n('second'),
  };
}
/** [start, end) in minutes; a range whose start is after its end crosses midnight. */
export function inRange(minutes, start, end) {
  const a = toMinutes(start);
  const b = toMinutes(end);
  return a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}
/** Next instant strictly after d when the local clock reads hh:mm (DST-safe: each day's offset is its own). */
export function nextLocalTime(hhmm, d = now()) {
  toMinutes(hhmm); // validates HH:MM
  const tz = scheduleConfig().timezone;
  let day = localParts(d, tz).date;
  for (let i = 0; i < 3; i += 1) {
    const t = studioInstant(day, hhmm, tz);
    if (t.getTime() > d.getTime()) return t;
    day = new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  }
  return studioInstant(day, hhmm, tz);
}

// ---------- quiet hours (approvals) ----------
export function inQuietHours(d = now()) {
  const q = scheduleConfig().quietHours;
  return Boolean(q) && inRange(localParts(d).minutes, q.start, q.end);
}
/** When an approval queued at d is released: the next end of the quiet hours. */
export const quietReleaseAt = (d = now()) => nextLocalTime(scheduleConfig().quietHours.end, d);

// ---------- scripts (day phase) ----------
/** Scripts to produce on d's local day: 0 outside scriptPhaseAt.days. */
export function scriptsFor(d = now()) {
  const s = scheduleConfig().scriptPhaseAt;
  const { weekday } = localParts(d);
  if (scheduleConfig().continuous) return Number(s.scriptsPerDay?.default ?? 1);
  if (!s.days.includes(weekday)) return 0;
  return Number(s.scriptsPerDay?.[weekday] ?? s.scriptsPerDay?.default ?? 1);
}

// ---------- render window (night phase) ----------
/**
 * { id, local, open, canStart, reason }: open = a render may continue; canStart = a render may start
 * (production day, inside the window and before noNewRenderAfter). id = local date the window started on.
 */
export function renderWindow(d = now()) {
  const c = scheduleConfig();
  const p = localParts(d);
  const { start, end } = c.renderWindow;
  const crossed = toMinutes(start) > toMinutes(end) && p.minutes < toMinutes(end);
  const startDay = crossed ? localParts(new Date(d.getTime() - DAY_MS)) : p;
  const local = `${p.weekday} ${p.date} ${p.hhmm}`;
  // Round the clock, every day: no window, no day off;
  // only the production pause (data/production-paused.json) stops it.
  if (c.continuous) return { id: p.date, local, open: true, canStart: true, reason: null };
  let reason = null;
  if (!c.productionDays.includes(startDay.weekday)) reason = `${startDay.weekday} is not a production day (${c.productionDays.join(', ')})`;
  else if (!inRange(p.minutes, start, end)) reason = `${p.hhmm} is outside the render window ${start}-${end}`;
  const open = !reason;
  if (open && inRange(p.minutes, c.noNewRenderAfter, end)) reason = `${p.hhmm} is after noNewRenderAfter ${c.noNewRenderAfter}`;
  return { id: startDay.date, local, open, canStart: !reason, reason };
}

