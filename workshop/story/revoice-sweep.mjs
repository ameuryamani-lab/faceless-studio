// Faceless Studio: re-voices every finished, unpublished story whose narrator is not the channel's (hero.json "voice"), code only
// (voice, captions, motion, edit, QC). Waits while another process is already working on that video. Stops when none is left
// or after 3 h. Task "Faceless Studio - revoix".
//   node --no-warnings workshop/story/revoice-sweep.mjs
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, getVideo } from '../../core/db.mjs';
import { wrongVoice } from '../../core/publish-direct.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MEDIA = path.join(ROOT, 'media');
const LIMIT_MS = 3 * 3600_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True while another make-short process works on this video. */
function busy(id) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { $_.CommandLine }"], { encoding: 'utf8', windowsHide: true });
    return out.split('\n').some((l) => l.includes('make-short.mjs') && l.includes(id));
  } catch { return true; }
}

const todo = () => readdirSync(MEDIA).filter((d) => /^s-\d{8}-\d{4}$/.test(d) && existsSync(path.join(MEDIA, d, 'chain', 'done.txt'))
  && getVideo(d)?.status !== 'published' && wrongVoice(d));

async function main() {
  const start = Date.now();
  const tries = new Map(); // a video that still fails after 2 tries is left for a human look
  for (let left = todo().filter((d) => (tries.get(d) ?? 0) < 2); left.length && Date.now() - start < LIMIT_MS; left = todo().filter((d) => (tries.get(d) ?? 0) < 2)) {
    const id = left.find((d) => !busy(d));
    if (id) tries.set(id, (tries.get(id) ?? 0) + 1);
    if (!id) { await sleep(20_000); continue; }
    console.log(`[${new Date().toISOString()}] re-voicing ${id}`);
    await new Promise((resolve) => {
      const p = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'workshop', 'story', 'make-short.mjs'), path.join(MEDIA, id, 'story.json'), '--redo', 'voice'], { cwd: ROOT, windowsHide: true, stdio: 'inherit' });
      p.on('close', resolve);
    });
  }
  console.log(`[${new Date().toISOString()}] sweep done, left: ${todo().join(', ') || 'none'}`);
}

main().catch((e) => { console.error(`sweep failed: ${e.message}`); process.exitCode = 1; }).finally(() => closeDb());
