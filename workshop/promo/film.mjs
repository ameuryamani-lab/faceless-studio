// Faceless Studio promo film, step 2 : one REAL video made from A to Z while an invisible
// headless Edge films the vitrine in vertical (1080x1920, ?rec=1&follow=1&clean=1: the camera follows the order card, no text
// bars). Every screencast frame is kept with its time, so the edit can play the hand-offs in real time and fast-forward the rest.
//   node --no-warnings workshop/promo/film.mjs            (run by the one-off task "Faceless Studio - film promo")
// Output: media/promo-film/<stamp>/frames/<ms>.jpg, events.json (the chain's events with their times), film.json.
// The prepared subjects are set aside for this one run (so the chain starts with the research desks) and put back after.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { STUDIO_ROOT, closeDb, openDb } from '../../core/db.mjs';
import { studioParts } from '../../core/studio-time.mjs';

const EDGE = process.env.STUDIO_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const W = 1080, H = 1920;
const URL = 'http://127.0.0.1:8830/?rec=1&follow=1&clean=1';
const SUBJECTS = path.join(STUDIO_ROOT, 'data', 'story-subjects.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const OUT = path.join(STUDIO_ROOT, 'media', 'promo-film', stamp);
const FRAMES = path.join(OUT, 'frames');
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

function videoId() {
  const p = studioParts(); // ids carry the studio clock
  return `s-${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
        let id = 0;
        const waiting = new Map();
        const listeners = [];
        ws.onmessage = (m) => {
          const j = JSON.parse(m.data);
          if (j.id && waiting.has(j.id)) { waiting.get(j.id)(j); waiting.delete(j.id); } else if (j.method) listeners.forEach((f) => f(j));
        };
        return { send: (method, p = {}) => new Promise((ok) => { id += 1; waiting.set(id, ok); ws.send(JSON.stringify({ id, method, params: p })); }), on: (f) => listeners.push(f), close: () => ws.close() };
      }
    } catch { /* starting */ }
    await sleep(500);
  }
  throw new Error('headless Edge did not answer');
}

async function main() {
  mkdirSync(FRAMES, { recursive: true });
  const id = videoId();
  const savedSubjects = existsSync(SUBJECTS) ? readFileSync(SUBJECTS, 'utf8') : '[]';
  writeFileSync(SUBJECTS, '[]', 'utf8');
  const firstEvent = Number(openDb().prepare('SELECT COALESCE(MAX(id), 0) AS n FROM events').get().n);

  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(OUT, 'edge-profile')}`, `--window-size=${W},${H}`, '--hide-scrollbars', '--mute-audio', '--no-first-run', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const cdp = await connect();
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: URL });
  await sleep(5000);
  let frames = 0;
  const t0 = Date.now();
  cdp.on((m) => {
    if (m.method !== 'Page.screencastFrame') return;
    const ms = Math.round(m.params.metadata.timestamp * 1000);
    writeFileSync(path.join(FRAMES, `${ms}.jpg`), Buffer.from(m.params.data, 'base64'));
    frames += 1;
    cdp.send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  log(`filming ${URL}, chain for ${id}`);
  await sleep(4000); // a few seconds of the room before the Chief starts

  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, ['--no-warnings', path.join(STUDIO_ROOT, 'workshop', 'story', 'chain.mjs'), '--id', id], { cwd: STUDIO_ROOT, windowsHide: true, stdio: 'inherit' });
    p.on('close', resolve);
  });
  log(`chain exit ${code}`);
  await sleep(6000); // the last card lands
  await cdp.send('Page.stopScreencast');
  cdp.close();
  edge.kill();

  // Put the prepared subjects back, after the ones this run prepared.
  let added = [];
  try { added = JSON.parse(readFileSync(SUBJECTS, 'utf8')); } catch { /* none */ }
  let saved = [];
  try { saved = JSON.parse(savedSubjects); } catch { /* none */ }
  writeFileSync(SUBJECTS, JSON.stringify([...saved, ...added], null, 1), 'utf8');

  const events = openDb().prepare('SELECT id, at, kind, agent, to_agent, video_id, text FROM events WHERE id > ? AND demo = 0 ORDER BY id').all(firstEvent);
  writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(events, null, 1), 'utf8');
  writeFileSync(path.join(OUT, 'film.json'), JSON.stringify({ video_id: id, url: URL, started: new Date(t0).toISOString(), ended: new Date().toISOString(), frames, chain_exit: code }, null, 1), 'utf8');
  closeDb();
  log(`done: ${frames} frames, ${events.length} events in ${OUT}`);
}

main().catch((e) => { console.error(`film failed: ${e.message}`); process.exitCode = 1; });
