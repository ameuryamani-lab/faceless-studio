// Faceless Studio: the results analyst's daily pass, applied without waiting (the chain decides on its own:
// recommendations apply as soon as the report is filed).
// The analyst reads the real counts (list_metrics) and ends with one line "SLOTS: HH:MM, HH:MM" (studio time) once the numbers
// are enough (20+ videos measured at 24 h), else "SLOTS: keep". A valid change moves core/daily.json autonomy.two_a_day.slots
// at once (the publisher and the vitrine read it); every decision is written to data/decisions.jsonl and the office feed.
// Guards: exactly 2 times, HH:MM, at least 4 h apart. Task "Faceless Studio - analyse" (run-phase.cmd analyse), daily.
//   node --no-warnings workshop/story/hours.mjs
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEvent, closeDb } from '../../core/db.mjs';
import { TIMEZONE } from '../../core/local-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAILY = path.join(ROOT, 'core', 'daily.json');
export const DECISIONS = path.join(ROOT, 'data', 'decisions.jsonl');
const MIN_GAP_MIN = 60;

function runAgent(task) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'core', 'run-agent.mjs'), 'results_analyst', task], { cwd: ROOT, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

const minutes = (s) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// The analyst also sets how many new videos a day (= how many slots), within what the networks allow
// (TikTok 15 posts / 24 h on the Upload-Post plan, YouTube's daily upload limit): 1 to MAX_PER_DAY, times at least MIN_GAP_MIN apart.
export const MAX_PER_DAY = 8; // YouTube refused after ~11 uploads in 24 h (catch-ups count); TikTok 15/24 h on Upload-Post Basic
const PER_DAY_EVERY_MS = 48 * 3_600_000; // one change of volume at a time, so its effect can be measured

/** The new slot times (one per new video a day) from the analyst's answer, or null (keep, missing or failing the guards). */
export function parseSlots(out) {
  const line = out.split('\n').map((l) => l.trim()).reverse().find((l) => /^SLOTS\s*:/i.test(l));
  if (!line || /keep/i.test(line)) return null;
  const times = [...new Set(line.match(/\b\d{2}:\d{2}\b/g) ?? [])];
  const mins = times.map(minutes);
  if (times.length < 1 || times.length > MAX_PER_DAY || mins.some((m) => m === null)) return null;
  const sorted = [...mins].sort((a, b) => a - b);
  const gaps = sorted.map((m, i) => (i ? m - sorted[i - 1] : sorted.length > 1 ? m + 1440 - sorted.at(-1) : 1440));
  if (gaps.some((g) => g < MIN_GAP_MIN)) return null;
  return [...times].sort((a, b) => minutes(a) - minutes(b));
}

async function main() {
  const r = await runAgent('Analyse : vues selon l\'heure de sortie. Call list_metrics({days: 30}) for the real counts (YouTube, TikTok, Instagram), read brand/mission.md, then follow your file (hour analysis against the benchmark). Log your HEURES: note, written in simple French for the owner (the vitrine shows it; the SLOTS: line keeps its exact format, the code reads it). Volume and posting hours are YOUR call: you decide how many new videos a day (1 to 8) and at what studio times (time zone ' + TIMEZONE + ') they go out, and your decision is applied automatically, so be exact. Weigh views per video against volume: more videos only if the numbers show more posts bring more views in total without dragging views per video down; fewer if extra posts clearly dilute them. Change one thing at a time (either the number or the hours) so its effect can be measured; the number of videos can change at most once every 48 h. End your answer with ONE last line, either "SLOTS: HH:MM, HH:MM, …" (one time per new video a day, 1 to 8 times, at least 1 h apart; change only when 20+ videos have a 24 h count on one network and the numbers clearly favour it) or "SLOTS: keep".');
  console.log(r.out.trim().slice(-2500));
  const cfg = JSON.parse(readFileSync(DAILY, 'utf8'));
  const old = cfg.autonomy?.two_a_day?.slots ?? [];
  let slots = parseSlots(r.out);
  const lastVolume = readFileSync(DECISIONS, { encoding: 'utf8', flag: 'a+' }).split('\n').flatMap((l) => { try { const d = JSON.parse(l); return d.applied && d.kind === 'slots' && (d.from ?? []).length !== (d.to ?? []).length ? [Date.parse(d.at)] : []; } catch { return []; } }).at(-1) ?? 0;
  if (slots && slots.length !== old.length && Date.now() - lastVolume < PER_DAY_EVERY_MS) { console.log(`volume change refused: last one ${new Date(lastVolume).toISOString()} (< 48 h)`); slots = null; }
  const decision = { at: new Date().toISOString(), agent: 'results_analyst', kind: 'slots', from: old, to: slots ?? old, applied: false };
  if (slots && slots.join() !== old.join() && cfg.autonomy?.two_a_day) {
    cfg.autonomy.two_a_day.slots = slots;
    cfg.autonomy.two_a_day.per_day = slots.length;
    cfg.autonomy.two_a_day._slots_by = `results_analyst ${decision.at} (applied automatically)`;
    writeFileSync(DAILY, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    decision.applied = true;
    addEvent({ kind: 'note', agent: 'results_analyst', text: `Décision appliquée : ${slots.length} vidéo(s) par jour, créneaux ${old.join(' / ')} → ${slots.join(' / ')} (heure du studio)` });
  }
  appendFileSync(DECISIONS, JSON.stringify(decision) + '\n');
  console.log(`slots: ${decision.applied ? `${old.join(', ')} -> ${slots.join(', ')}` : `kept ${old.join(', ')}`}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`hours failed: ${e.message}`); process.exitCode = 1; }).finally(() => closeDb());
}
