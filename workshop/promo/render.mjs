// Faceless Studio promo renderer (2026-10-22). Opens office/public/promo.html in an invisible headless Edge (DevTools protocol),
// calls window.renderFrame(n) for every frame at 30 fps and captures it, then adds a narration (Kokoro, the channel voice) over a
// simple synthesized beat and writes media/promo/promo-<stamp>.mp4. Never published automatically.
//   node --no-warnings workshop/promo/render.mjs [--preview 0,90,400,700,900,1150]   (preview: a few PNG frames only)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FFMPEG, KOKORO_PY } from '../../core/local-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EDGE = process.env.STUDIO_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// ffmpeg and Kokoro's Python: core/local-config.mjs.
const PORT = 9334;
const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const arg = (name, def) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : def);
const preview = argv.includes('--preview') ? arg('--preview').split(',').map(Number) : null;
const params = new URLSearchParams({ videos: arg('--videos', '10'), runs: arg('--runs', '120'), tokens: arg('--tokens', '3.2M') });
// --mux <stamp>: reuse the frames already captured in media/promo/frames-<stamp> and only redo the sound and the final file.
const muxOnly = arg('--mux', null);
const stamp = muxOnly ?? new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const OUT = path.join(ROOT, 'media', 'promo');
const FRAMES = path.join(OUT, `frames-${stamp}`);

function run(bin, args) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { windowsHide: true });
    let err = '';
    p.stderr?.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, err }));
  });
}

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
        let id = 0;
        const waiting = new Map();
        ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && waiting.has(j.id)) { waiting.get(j.id)(j); waiting.delete(j.id); } };
        return { send: (method, p = {}) => new Promise((ok) => { id += 1; waiting.set(id, ok); ws.send(JSON.stringify({ id, method, params: p })); }), close: () => ws.close() };
      }
    } catch { /* starting */ }
    await sleep(500);
  }
  throw new Error('headless Edge did not answer');
}

/** Narration in the channel voice (the active concept's narrator, core/concept.mjs), one clip per line, placed at its second. */
async function narration(dir) {
  const { loadConcept } = await import('../../core/concept.mjs');
  const voice = loadConcept().voice.id;
  const lines = [[0.3, 'This channel runs itself.'], [3.4, 'Twenty-two AI agents.'], [5.2, 'They hunt the trends, write the story, draw every frame, record the voice.'], [11.3, 'One video goes from idea, to ready, to live.'], [17.0, 'On YouTube, TikTok and Instagram.'], [19.8, 'A new story every hour.'], [29.4, 'Since last night: zero human edits.'], [37.3, 'Follow, and watch it grow.']];
  const parts = [];
  for (const [i, [at, text]] of lines.entries()) {
    const txt = path.join(dir, `n${i}.txt`), wav = path.join(dir, `n${i}.wav`);
    writeFileSync(txt, text, 'utf8');
    await run(KOKORO_PY, ['-I', path.join(ROOT, 'workshop', 'voice', 'kokoro_say.py'), txt, voice, wav, '1.05']);
    parts.push({ at, wav });
  }
  return parts;
}

async function main() {
  if (muxOnly) return mux(42);
  mkdirSync(FRAMES, { recursive: true });
  const profile = path.join(FRAMES, 'edge-profile');
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1080,1920', '--hide-scrollbars', '--mute-audio', '--no-first-run', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const cdp = await connect();
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:8830/promo.html?${params}` });
  await sleep(3000);
  const seconds = (await cdp.send('Runtime.evaluate', { expression: 'window.PROMO_SECONDS', returnByValue: true })).result.result.value;
  const total = Math.round(seconds * FPS);
  const list = preview ?? Array.from({ length: total }, (_, i) => i);
  for (const [k, n] of list.entries()) {
    await cdp.send('Runtime.evaluate', { expression: `window.renderFrame(${n})` });
    await cdp.send('Runtime.evaluate', { expression: 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))', awaitPromise: true });
    const shot = await cdp.send('Page.captureScreenshot', preview ? { format: 'png' } : { format: 'jpeg', quality: 92 });
    writeFileSync(path.join(FRAMES, preview ? `preview-${n}.png` : `${String(k + 1).padStart(5, '0')}.jpg`), Buffer.from(shot.result.data, 'base64'));
  }
  cdp.close();
  edge.kill();
  if (preview) { console.log(`preview frames in ${FRAMES}`); return; }
  return mux(seconds);
}

async function mux(seconds) {
  // Sound: a 120 bpm beat (kick + hat) under the narration, then loudness -14 LUFS.
  const voices = await narration(FRAMES);
  const beat = path.join(FRAMES, 'beat.wav');
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='0.55*sin(2*PI*t*(45+110*exp(-mod(t,0.5)*28)))*exp(-mod(t,0.5)*7)+0.08*(random(0)*2-1)*exp(-mod(t+0.25,0.5)*55)':s=48000:d=${seconds}`, beat]);
  const inputs = [beat, ...voices.map((v) => v.wav)].flatMap((f) => ['-i', f]);
  // Input 0 is the frame sequence, 1 the beat, 2.. the narration clips.
  const delays = voices.map((v, i) => `[${i + 2}:a]adelay=${Math.round(v.at * 1000)}|${Math.round(v.at * 1000)},volume=1.6[v${i}]`).join(';');
  const mix = `[1:a]volume=0.35[b];${delays};[b]${voices.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voices.length + 1}:normalize=0,loudnorm=I=-14:TP=-1.5[a]`;
  mkdirSync(OUT, { recursive: true });
  const out = path.join(OUT, `promo${arg('--tag', '')}-${stamp.replace(/^3d/, '')}.mp4`);
  const r = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(FRAMES, '%05d.jpg'), ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
  if (r.code !== 0) throw new Error(r.err.slice(-400));
  rmSync(FRAMES, { recursive: true, force: true });
  console.log(`done: ${out}`);
}

main().catch((e) => { console.error(`promo failed: ${e.message}`); process.exitCode = 1; });
