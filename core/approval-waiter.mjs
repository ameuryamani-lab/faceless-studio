// Faceless Studio: ONE-OFF approval waiter (no recurring task, no Windows scheduler).
// createApproval (core/db.mjs) launches it when it queues an approval during the quiet hours and no waiter is alive.
// It sleeps until release_at (07:00 studio time), runs releaseDueApprovals (the core/release-approvals.mjs path), then exits.
// Its file: data/approval-waiter.json {pid, release_at, started_at} (next to the DB for a test DB).
//   node core/approval-waiter.mjs            -> launches a waiter for the next release if items are queued and none is alive
//   node core/approval-waiter.mjs --run <iso> -> the waiter itself (what the launch spawns)
import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { now } from './schedule.mjs';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');
const CHUNK_MS = 60_000;          // wakes every minute: survives a PC sleep or a clock change
const STALE_AFTER_MS = 15 * 60_000; // a live pid whose release is this far past is a reused pid, not our waiter
const LAUNCH_LOCK_STALE_MS = 30_000;

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
export function readWaiter(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
/** The live waiter described by file, or null. */
export function liveWaiter(file) {
  const w = readWaiter(file);
  if (!w || !pidAlive(w.pid)) return null;
  if (Date.parse(w.release_at) < now().getTime() - STALE_AFTER_MS) return null;
  return w;
}

function takeLaunchLock(file) {
  const lock = `${file}.lock`;
  for (let i = 0; i < 2; i += 1) {
    try { closeSync(openSync(lock, 'wx')); return () => rmSync(lock, { force: true }); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - statSync(lock).mtimeMs < LAUNCH_LOCK_STALE_MS) return null;
      rmSync(lock, { force: true });
    }
  }
  return null;
}

/**
 * Launches the waiter unless one is alive. Returns { launched, pid, release_at, reason }.
 * spawnFn is injectable for tests; the real one is node:child_process spawn (detached, hidden, unref'd).
 */
export function ensureWaiter({ releaseAt, waiterFile, spawnFn = spawn }) {
  if (!releaseAt || Number.isNaN(Date.parse(releaseAt))) throw new Error(`ensureWaiter: bad releaseAt ${releaseAt}`);
  // Tests only: a fake clock at 23:45 must not leave a real process sleeping until 07:00.
  if (process.env.STUDIO_WAITER === 'off') return { launched: false, pid: null, release_at: releaseAt, reason: 'waiter disabled (STUDIO_WAITER=off)' };
  const alive = liveWaiter(waiterFile);
  if (alive) return { launched: false, pid: alive.pid, release_at: alive.release_at, reason: 'a waiter is already alive' };
  const unlock = takeLaunchLock(waiterFile);
  if (!unlock) return { launched: false, pid: null, release_at: releaseAt, reason: 'another launch is in progress' };
  try {
    const again = liveWaiter(waiterFile);
    if (again) return { launched: false, pid: again.pid, release_at: again.release_at, reason: 'a waiter is already alive' };
    const child = spawnFn(process.execPath, ['--no-warnings', SELF, '--run', releaseAt], {
      cwd: ROOT, env: process.env, detached: true, windowsHide: true, stdio: 'ignore',
    });
    child.unref?.();
    if (!child.pid) throw new Error('the approval waiter did not start (no pid)');
    writeFileSync(waiterFile, `${JSON.stringify({ pid: child.pid, release_at: releaseAt, started_at: new Date().toISOString() })}\n`, 'utf8');
    return { launched: true, pid: child.pid, release_at: releaseAt, reason: 'launched' };
  } finally {
    unlock();
  }
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function runWaiter(releaseAt) {
  const target = Date.parse(releaseAt);
  if (Number.isNaN(target)) throw new Error(`--run needs an ISO time (got ${releaseAt})`);
  const db = await import('./db.mjs');
  const file = db.WAITER_PATH;
  const other = liveWaiter(file);
  if (other && other.pid !== process.pid) { console.log(`another waiter is alive (pid ${other.pid}), exiting`); return; }
  if (!other) writeFileSync(file, `${JSON.stringify({ pid: process.pid, release_at: releaseAt, started_at: new Date().toISOString() })}\n`, 'utf8');
  try {
    for (let left = target - now().getTime(); left > 0; left = target - now().getTime()) await sleep(Math.min(CHUNK_MS, left));
    const released = db.releaseDueApprovals({ asOf: new Date(Math.max(target, now().getTime())) });
    if (released.length) {
      db.addEvent({ kind: 'note', agent: 'chief_of_staff', text: `approval waiter: ${released.length} queued approval(s) released (${released.map((r) => r.ref).join(', ')})` });
    }
    console.log(JSON.stringify({ released }));
  } finally {
    if (readWaiter(file)?.pid === process.pid) rmSync(file, { force: true });
    db.closeDb();
  }
}

async function launchFromCli() {
  const db = await import('./db.mjs');
  try {
    const next = db.listQueuedApprovals().map((q) => q.release_at).sort()[0];
    if (!next) { console.log('Nothing queued: no waiter needed.'); return; }
    console.log(JSON.stringify(ensureWaiter({ releaseAt: next, waiterFile: db.WAITER_PATH })));
  } finally {
    db.closeDb();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === SELF.toLowerCase()) {
  const i = process.argv.indexOf('--run');
  const job = i > -1 ? runWaiter(process.argv[i + 1]) : launchFromCli();
  job.catch((e) => { console.error(e.message); process.exitCode = 1; });
}

