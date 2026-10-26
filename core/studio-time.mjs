// Faceless Studio: wall-clock helpers in the studio time zone (core/local-config.mjs TIMEZONE). Everything goes through Intl, so a
// zone with daylight saving (Europe/Paris, America/New_York...) is handled; no fixed UTC offset is ever written in code.
import { TIMEZONE } from './local-config.mjs';

export { TIMEZONE };

/** The studio wall clock at t: { date 'YYYY-MM-DD', hhmm 'HH:MM', year, month, day, hour, minute (2-digit strings), h, mi, minutes, weekday 'Mon' }. */
export function studioParts(t = new Date(), tz = TIMEZONE) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24;
  const hour = String(h).padStart(2, '0');
  return {
    date: `${p.year}-${p.month}-${p.day}`, hhmm: `${hour}:${p.minute}`, year: p.year, month: p.month, day: p.day, hour, minute: p.minute, second: p.second,
    h, mi: Number(p.minute), s: Number(p.second), minutes: h * 60 + Number(p.minute), weekday: p.weekday,
  };
}
/** The studio date 'YYYY-MM-DD' at t. */
export const studioDay = (t = new Date(), tz = TIMEZONE) => studioParts(t, tz).date;
/** The studio hour (0-23) at t. */
export const studioHour = (t = new Date(), tz = TIMEZONE) => studioParts(t, tz).h;

/** The UTC instant when the studio clock reads hhmm ('HH:MM') on the studio date 'YYYY-MM-DD' (DST-safe). */
export function studioInstant(date, hhmm = '00:00', tz = TIMEZONE) {
  const [y, mo, d] = String(date).split('-').map(Number);
  const [h, mi] = String(hhmm).split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall;
  for (let i = 0; i < 3; i += 1) { // converge on the zone offset of that instant
    const p = studioParts(t, tz);
    t += wall - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), p.h, p.mi);
  }
  return new Date(t);
}
/** 00:00 studio time of t's studio day. */
export const studioMidnight = (t = new Date(), tz = TIMEZONE) => studioInstant(studioDay(t, tz), '00:00', tz);
