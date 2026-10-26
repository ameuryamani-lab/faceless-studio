// Faceless Studio: the strategist's weekly pass (2026-10-21). Once 10+ published videos have view counts, the strategist reads the
// results and names 3 themes to push and 3 to drop; workshop/story/chain.mjs gives them to trend_scout (data/strategy.json).
// Before that it does not run (a note says how many videos have counts). Task "Faceless Studio - stratégie", Sundays 08:00.
// 2026-10-24: strategy.json carries "concept" (the active concept it was decided for); chain.mjs ignores a file of another concept
// and activateConcept archives it on a switch. The themes themselves stay as the agent names them.
//   node --no-warnings workshop/story/strategy.mjs
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addEvent, closeDb, openDb } from '../../core/db.mjs';
import { activeConceptId } from '../../core/concept.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STRATEGY_FILE = path.join(ROOT, 'data', 'strategy.json');
const MIN_VIDEOS = 10;

function runAgent(task) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'core', 'run-agent.mjs'), 'strategist', task], { cwd: ROOT, windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

async function main() {
  const counted = Number(openDb().prepare('SELECT COUNT(DISTINCT video_id) AS n FROM metrics WHERE views IS NOT NULL').get().n);
  if (counted < MIN_VIDEOS) {
    addEvent({ kind: 'note', agent: 'strategist', text: `Stratégie : en attente, ${counted}/${MIN_VIDEOS} vidéos avec des vues` });
    console.log(`strategist waits: ${counted}/${MIN_VIDEOS} videos with views`);
    return;
  }
  // 2026-10-24 (reviews M14, M15, M43): the strategist runs daily (task "analyse") and weekly (task "strategie"); a decision younger
  // than 20 h is kept (no second run the same morning), the previous decision is given back to it, a DROP needs numbers, and a
  // theme pushed less than 7 days ago cannot be dropped (code guard): in 16 h a theme had gone from DROP to PUSH.
  const conceptId = activeConceptId();
  const prevAny = existsSync(STRATEGY_FILE) ? (() => { try { return JSON.parse(readFileSync(STRATEGY_FILE, 'utf8')); } catch { return null; } })() : null;
  // A decision taken for another concept is neither kept nor given back (2026-10-24; activateConcept archives it, this is the guard).
  const prev = prevAny && (!prevAny.concept || prevAny.concept === conceptId) ? prevAny : null;
  if (prev?.at && Date.now() - Date.parse(prev.at) < 20 * 3600_000) { console.log(`strategy: decided ${prev.at}, less than 20 h ago, kept`); return; }
  const prevText = prev ? ` Previous decision (${prev.at}): PUSH ${prev.push?.join(' / ') || 'none'}; DROP ${prev.drop?.join(' / ') || 'none'}. Keep it unless the numbers changed; keep a pushed theme at least 7 days unless at least 3 of its videos are under our median.` : '';
  // The format and the hero reach the agent through its system prompt (run-agent: studio rules + concept rules), not through this text.
  const r = await runAgent(`Stratégie : thèmes à pousser et à éviter. Follow the concept rules and the studio rules you were given. Call list_metrics({days: 30}) and list_recent_videos({days: 30}). Compare the story themes at the SAME checkpoint (the 24h snapshots) by views and comments.${prevText} Answer with 1 to 3 lines PUSH | theme | why (numbers) | FR: short French label of the theme (for the owner, max 50 chars), then 0 to 3 lines DROP | theme | why (numbers) | FR: French label. A DROP needs a clear gap on at least 3 videos; "trend only" (fewer than 3 videos) is never a DROP. Your PUSH and DROP apply at once to trend_scout and topic_editor.`);
  const lines = r.out.split('\n').map((l) => l.trim());
  // 2026-10-24: each line may end with "FR: <label>" (French label for the vitrine); kept apart, never mixed into the theme.
  const rows = (tag) => lines.filter((l) => l.toUpperCase().startsWith(`${tag} |`)).slice(0, 3).map((l) => {
    const parts = l.split('|').slice(1).map((x) => x.trim());
    const fr = parts.find((x) => /^FR\s*:/i.test(x));
    return { line: parts.filter((x) => x !== fr).join(' | '), fr: fr ? fr.replace(/^FR\s*:\s*/i, '').slice(0, 60) : null };
  });
  const pushRows = rows('PUSH');
  const key = (l) => String(l).split('|')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const protectedKeys = Object.entries(prev?.pushed_since ?? {}).filter(([, since]) => Date.now() - Date.parse(since) < 7 * 86_400_000).map(([k]) => k);
  const dropRows = rows('DROP').filter((x) => {
    if (!protectedKeys.includes(key(x.line))) return true;
    addEvent({ kind: 'note', agent: 'strategist', text: `Thème gardé malgré l'avis (poussé depuis moins de 7 jours) : ${x.fr ?? x.line.split('|')[0].trim()}`.slice(0, 300) });
    return false;
  });
  const pick = (r) => r.map((x) => x.line);
  const at = new Date().toISOString();
  const pushedSince = Object.fromEntries(pushRows.map((x) => [key(x.line), prev?.pushed_since?.[key(x.line)] ?? at]));
  const strategy = { at, concept: conceptId, push: pick(pushRows), drop: pick(dropRows), push_fr: pushRows.map((x) => x.fr), drop_fr: dropRows.map((x) => x.fr), pushed_since: pushedSince };
  if (!strategy.push.length && !strategy.drop.length) throw new Error(`strategist gave no PUSH/DROP lines (exit ${r.code})`);
  writeFileSync(STRATEGY_FILE, JSON.stringify(strategy, null, 1), 'utf8');
  // Applied at once, no validation; every decision is logged for the vitrine.
  const name = (l) => l.split('|')[0].trim();
  appendFileSync(path.join(ROOT, 'data', 'decisions.jsonl'), JSON.stringify({ at: strategy.at, agent: 'strategist', kind: 'themes', push: strategy.push.map(name), drop: strategy.drop.map(name), push_fr: strategy.push_fr, drop_fr: strategy.drop_fr, applied: true }) + '\n');
  addEvent({ kind: 'note', agent: 'strategist', text: `Décision appliquée : pousser ${strategy.push.map(name).join(', ')} ; abandonner ${strategy.drop.map(name).join(', ')}`.slice(0, 300) });
  console.log(JSON.stringify(strategy));
}

main().catch((e) => { console.error(`strategy failed: ${e.message}`); process.exitCode = 1; }).finally(() => closeDb());
