// Faceless Studio: seasonal subjects ahead of time (2026-10-21; calendar_planner's new job). For each secular / commercial date in
// the next 14 days that has no subject yet, calendar_planner proposes 2-3 subjects in the ACTIVE concept's hook format for its hero
// (2026-10-24: the concept is a parameter, core/concept.mjs); they go to the FRONT of data/story-subjects.json with "until" = the
// date, so the normal chain makes and publishes them in the days before. The subjects queue belongs to the active concept
// (activateConcept archives it on a switch). No religious holidays and nothing political (studio rule). Run weekly (task
// "Faceless Studio - saisons") or by hand.
//   node --no-warnings workshop/story/seasonal.mjs [--days 14]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb } from '../../core/db.mjs';
import { loadConcept, pickPattern } from '../../core/concept.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// The rules (hero, drawable subjects, safety) reach the agent through the system prompt core/run-agent.mjs composes (2026-10-24).
const RULES = 'Follow the concept rules and the studio rules you were given.';
const SUBJECTS = path.join(ROOT, 'data', 'story-subjects.json');
const days = process.argv.includes('--days') ? Number(process.argv[process.argv.indexOf('--days') + 1]) : 14;

/** Fixed secular / commercial dates (month-day), and Black Friday (4th Friday of November). */
function calendar(year) {
  const fixed = [['10-31', 'Halloween'], ['12-25', 'Christmas presents and decorations (gifts, lights, family dinner; no religion)'], ['12-31', "New Year's Eve"],
    ['02-14', "Valentine's Day"], ['04-01', "April Fools' Day"], ['09-01', 'Back to school or work after summer'], ['07-01', 'Summer heat and holidays']];
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const firstFri = 1 + ((5 - nov1.getUTCDay() + 7) % 7);
  return [...fixed.map(([md, name]) => ({ date: `${year}-${md}`, name })), { date: `${year}-11-${String(firstFri + 21).padStart(2, '0')}`, name: 'Black Friday shopping' }];
}

function runAgent(task) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'core', 'run-agent.mjs'), 'calendar_planner', task], { cwd: ROOT, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

async function main() {
  const c = loadConcept(); // the active concept: these subjects are for the next videos (a French error stops the run if it is invalid)
  const hook = c.format.hook_prefix ?? '';
  const now = Date.now();
  const y = new Date().getUTCFullYear();
  const upcoming = [...calendar(y), ...calendar(y + 1)].filter((e) => { const t = Date.parse(`${e.date}T23:00:00Z`); return t > now && t - now < days * 86_400_000; });
  const queue = existsSync(SUBJECTS) ? JSON.parse(readFileSync(SUBJECTS, 'utf8')) : [];
  for (const e of upcoming) {
    if (queue.some((s) => s.season === e.date)) { console.log(`${e.date} ${e.name}: subjects already queued`); continue; }
    const task = `Saisons : sujets pour ${e.name.split(' (')[0]}. ${RULES} Propose 3 light, kind, ${c.format.person} ${hook ? `"${hook}…" ` : ''}subjects for ${e.name}, on ${e.date}, for ${c.hero_name} (adult, everyday life, gentle humour; drawable as the concept rules say, around ONE common object; no religion, no politics, no real people or brands). Answer with exactly 3 lines: ${c.format.pick_line}. Each question is ${c.format.title_max_chars} characters at most.`;
    const r = await runAgent(task);
    const picks = r.out.split('\n').filter((l) => pickPattern(c).test(l)).map((l) => l.trim()).slice(0, 3);
    if (!picks.length) { console.log(`${e.date}: no subject (${r.code}) ${r.out.slice(-200)}`); continue; }
    const fresh = picks.map((pick) => ({ pick, at: new Date().toISOString(), season: e.date, until: `${e.date}T22:00:00Z` }));
    const current = existsSync(SUBJECTS) ? JSON.parse(readFileSync(SUBJECTS, 'utf8')) : [];
    writeFileSync(SUBJECTS, JSON.stringify([...fresh, ...current], null, 1), 'utf8');
    console.log(`${e.date} ${e.name}: ${picks.length} subjects queued first`);
  }
}

main().catch((e) => { console.error(`seasonal failed: ${e.message}`); process.exitCode = 1; }).finally(() => closeDb());
