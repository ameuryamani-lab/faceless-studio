// Faceless Studio "coulisses" film : the studio at work, in real time. Records the vitrine in recording mode (/?rec=1&tour=1: the room only, the studio clock and the job
// running, no side panel, generic covers for other creators' videos) with an invisible headless Edge (DevTools protocol, no
// window on your screen), while ONE full agent chain runs (workshop/story/chain.mjs, trend_scout to QC). It stops 60 s after
// the chain ends, then writes media/coulisses/<run>/coulisses-temps-reel.mp4 and coulisses-accelere.mp4 (about 75 s).
// The coulisses folder is never published (core/publish-direct.mjs only sends videos rows with a qc.json).
//   node --no-warnings workshop/coulisses/record.mjs [--no-chain --minutes 2]   (--no-chain: a test recording only)
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FFMPEG } from '../../core/local-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EDGE = process.env.STUDIO_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const URL_REC = 'http://127.0.0.1:8830/?rec=1&tour=1';
const FPS = 4;
const AFTER_CHAIN_MS = 60_000;
const MAX_MS = 3 * 3600_000; // never record more than 3 h
const FAST_SECONDS = 75;
const pad = (n, w = 6) => String(n).padStart(w, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const noChain = argv.includes('--no-chain');
const minutes = argv.includes('--minutes') ? Number(argv[argv.indexOf('--minutes') + 1]) : null;
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const OUT = path.join(ROOT, 'media', 'coulisses', `run-${stamp}`);
const FRAMES = path.join(OUT, 'frames');

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}Z] ${msg}`); }

function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { windowsHide: true, ...opts });
    let err = '';
    p.stderr?.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, err }));
  });
}

/** Minimal DevTools client over the page's WebSocket. */
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = ko; });
        let id = 0;
        const waiting = new Map();
        ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && waiting.has(j.id)) { waiting.get(j.id)(j); waiting.delete(j.id); } };
        const send = (method, params = {}) => new Promise((ok) => { id += 1; waiting.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
        return { send, close: () => ws.close() };
      }
    } catch { /* Edge still starting */ }
    await sleep(500);
  }
  throw new Error('headless Edge did not answer on the DevTools port');
}

async function main() {
  mkdirSync(FRAMES, { recursive: true });
  const profile = path.join(OUT, 'edge-profile');
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1920,1080',
    '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const cdp = await connect();
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: URL_REC });
  await sleep(4000);
  log(`recording ${URL_REC} -> ${OUT}`);

  let chainDone = noChain ? Date.now() + (minutes ?? 2) * 60_000 - AFTER_CHAIN_MS : null;
  let chainResult = null;
  if (!noChain) {
    const chain = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'workshop', 'story', 'chain.mjs')], { cwd: ROOT, windowsHide: true });
    let out = '';
    chain.stdout.on('data', (d) => { out += d; });
    chain.stderr.on('data', (d) => { out += d; });
    chain.on('close', (code) => { chainDone = Date.now(); chainResult = { code, tail: out.trim().split('\n').slice(-3).join(' | ') }; log(`chain ended (${code}): ${chainResult.tail.slice(0, 300)}`); });
  }

  const start = Date.now();
  let n = 0;
  while (true) {
    const t0 = Date.now();
    if (chainDone && t0 - chainDone > AFTER_CHAIN_MS) break;
    if (t0 - start > MAX_MS) { log('3 h limit reached'); break; }
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    if (shot.result?.data) { n += 1; writeFileSync(path.join(FRAMES, `${pad(n)}.jpg`), Buffer.from(shot.result.data, 'base64')); }
    await sleep(Math.max(0, 1000 / FPS - (Date.now() - t0)));
  }
  const seconds = (Date.now() - start) / 1000;
  cdp.close();
  edge.kill();
  log(`${n} frames in ${Math.round(seconds)} s`);

  const realFps = (n / seconds).toFixed(4);
  const full = path.join(OUT, 'coulisses-temps-reel.mp4');
  let r = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', realFps, '-i', path.join(FRAMES, '%06d.jpg'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-r', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', full]);
  if (r.code !== 0) throw new Error(`full film: ${r.err.slice(-300)}`);
  const fast = path.join(OUT, 'coulisses-accelere.mp4');
  const fastRate = Math.max(30, n / FAST_SECONDS).toFixed(3);
  r = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', fastRate, '-i', path.join(FRAMES, '%06d.jpg'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-r', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fast]);
  if (r.code !== 0) throw new Error(`fast cut: ${r.err.slice(-300)}`);
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '5', '-i', fast, '-frames:v', '1', '-vf', 'scale=960:540', path.join(OUT, 'cover.jpg')]);
  rmSync(profile, { recursive: true, force: true });
  writeFileSync(path.join(OUT, 'info.json'), JSON.stringify({ recorded_from: new Date(start).toISOString(), seconds: Math.round(seconds), frames: n, chain: chainResult }, null, 1));
  if (existsSync(full) && existsSync(fast)) rmSync(FRAMES, { recursive: true, force: true });
  log(`done: ${full} and ${fast}`);
}

main().catch((e) => { log(`coulisses failed: ${e.message}`); process.exitCode = 1; });
