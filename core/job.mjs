// Faceless Studio: lights up the vitrine for any job, including ones run by hand (the office must show the real
// work). Also the production pause (the owner's "pause" / "reprends", or the vitrine button).
//   node core/job.mjs start <agent> "<what it does>" [--video <id>]   agent -> working, bubble = text, event run_start
//   node core/job.mjs end   <agent> "<result>"       [--video <id>]   agent -> idle, event run_end
//   node core/job.mjs note  <agent> "<text>"         [--video <id>]   event only
//   node core/job.mjs pause  [--source thread|vitrine]                 writes data/production-paused.json + event
//   node core/job.mjs resume [--source thread|vitrine]                 removes it + event
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STUDIO_ROOT, addEvent, closeDb, setAgent } from './db.mjs';

export const PAUSE_FILE = path.join(STUDIO_ROOT, 'data', 'production-paused.json');
const SOURCES = ['thread', 'vitrine'];

export function pause(source = 'thread') {
  if (existsSync(PAUSE_FILE)) return { paused: true, already: true };
  writeFileSync(PAUSE_FILE, JSON.stringify({ since: new Date().toISOString(), source }) + '\n');
  addEvent({ kind: 'note', agent: 'chief_of_staff', text: `Production en pause (${source === 'vitrine' ? 'bouton de la vitrine' : 'demande du propriétaire'})` });
  return { paused: true };
}

export function resume(source = 'thread') {
  if (!existsSync(PAUSE_FILE)) return { paused: false, already: true };
  rmSync(PAUSE_FILE, { force: true });
  addEvent({ kind: 'note', agent: 'chief_of_staff', text: `Production reprise (${source === 'vitrine' ? 'bouton de la vitrine' : 'demande du propriétaire'})` });
  return { paused: false };
}

function main(argv) {
  const flag = (name) => { const i = argv.indexOf(name); return i > 0 ? argv[i + 1] : null; };
  const [cmd, agent, text] = argv;
  const video_id = flag('--video');
  const source = SOURCES.includes(flag('--source')) ? flag('--source') : 'thread';
  if (cmd === 'pause') return pause(source);
  if (cmd === 'resume') return resume(source);
  if (!['start', 'end', 'note'].includes(cmd) || !agent || !text) throw new Error('usage: job.mjs start|end|note <agent> "<text>" [--video <id>] | pause | resume');
  if (cmd === 'note') return { event: addEvent({ kind: 'note', agent, video_id, text: String(text).slice(0, 300) }) };
  const task = String(text).slice(0, 200);
  return setAgent(agent, cmd === 'start' ? { state: 'working', task, video_id, text: task } : { state: 'idle', task: null, video_id, text: task });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)))); } catch (e) { console.error(`job failed: ${e.message}`); process.exitCode = 1; } finally { closeDb(); }
}
