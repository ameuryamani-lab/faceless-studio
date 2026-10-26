// Schedule and quiet-hours test: core/schedule.mjs, core/db.mjs createApproval (queue), release-approvals,
// approval-waiter (singleton, real 4-second sleep).
//   node --no-warnings workshop/test-schedule.mjs
// Throwaway DBs in media/_test only, fake clock through STUDIO_NOW. No Claude call, no render, no ComfyUI call.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST = path.join(ROOT, 'media', '_test');
const REAL = path.join(ROOT, 'data');
const SDB = path.join(TEST, 'schedule-test.db');   // in-process createApproval / release tests
const WDB = path.join(TEST, 'waiter-test.db');     // real waiter process
const sidecars = (db) => [db, `${db}-wal`, `${db}-shm`, `${db}.approvals-queue.jsonl`, `${db}.approval-waiter.json`, `${db}.approval-waiter.json.lock`];
mkdirSync(TEST, { recursive: true });
for (const f of [...sidecars(SDB), ...sidecars(WDB)]) rmSync(f, { recursive: true, force: true });

// The run counters (orchestrator share, daily cap) read the test's own files, never the real data/ ones.
const SHARE_DIR = path.join(TEST, 'share-logs');
process.env.STUDIO_SHARE_LOG_DIR = SHARE_DIR;
process.env.STUDIO_RUNS_LOG = path.join(TEST, 'runs-test.jsonl');
rmSync(SHARE_DIR, { recursive: true, force: true });
rmSync(process.env.STUDIO_RUNS_LOG, { force: true });
const realState = () => {
  if (!existsSync(path.join(REAL, 'studio.db'))) return `no studio.db queue:${existsSync(path.join(REAL, 'approvals-queue.jsonl'))} waiter:${existsSync(path.join(REAL, 'approval-waiter.json'))}`;
  const d = new DatabaseSync(path.join(REAL, 'studio.db'), { readOnly: true });
  const c = ['events', 'approvals'].map((t) => d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n).join('/');
  d.close();
  return `${c} queue:${existsSync(path.join(REAL, 'approvals-queue.jsonl'))} waiter:${existsSync(path.join(REAL, 'approval-waiter.json'))}`;
};
const realBefore = realState();
let failed = 0;
const ok = (cond, label, out = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) { failed += 1; console.log(String(out).slice(-1500)); } };
const q = (db, sql, ...a) => { const d = new DatabaseSync(db, { readOnly: true }); const r = d.prepare(sql).all(...a); d.close(); return r; };
// The expected instants below are written for the studio time zone Africa/Algiers: the test pins it (child processes inherit it).
process.env.STUDIO_TIMEZONE = 'Africa/Algiers';
const { studioInstant } = await import('../core/studio-time.mjs');
/** ISO instant of the studio wall clock date + 'HH:MM' or 'HH:MM:SS' (Intl conversion, no fixed offset). */
const local = (date, hhmm) => new Date(studioInstant(date, hhmm.slice(0, 5)).getTime() + Number(hhmm.slice(6) || 0) * 1000).toISOString();
const node = (args, env) => spawnSync(process.execPath, ['--no-warnings', ...args], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ---------- 1. schedule helpers ----------
process.env.STUDIO_DB = SDB;
process.env.STUDIO_WAITER = 'off';
const S = await import('../core/schedule.mjs');
const db = await import('../core/db.mjs');
const quiet = (date, t) => S.inQuietHours(new Date(local(date, t)));
ok(!quiet('2026-10-20', '23:29') && quiet('2026-10-20', '23:30') && quiet('2026-10-21', '06:59') && !quiet('2026-10-21', '07:00'), 'quiet hours are 23:30-07:00 studio time');
// The expectation comes from core/daily.json: continuous mode = scriptsPerDay.default every day; otherwise the weekday's own
// count on a production day (scriptPhaseAt.days), else 0.
{
  const cfg = S.scheduleConfig();
  const sp = cfg.scriptPhaseAt ?? {};
  const per = sp.scriptsPerDay ?? {};
  const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const expected = WEEK.map((wd) => {
    if (cfg.continuous) return Number(per.default ?? 1);
    return (sp.days ?? []).includes(wd) ? Number(per[wd] ?? per.default ?? 1) : 0;
  });
  const got = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'].map((d) => S.scriptsFor(new Date(local(d, '06:00'))));
  ok(got.join(',') === expected.join(','), `scripts per day Sun..Sat = ${expected.join(',')} (${cfg.continuous ? 'continuous mode: the default count every day' : 'scriptPhaseAt days'})`, `got ${got.join(',')}`);
}

// ---------- 2. quiet-hours queueing (createApproval, the one choke point) ----------
process.env.STUDIO_NOW = local('2026-10-20', '23:45');
let r = db.createApproval('video', 'ep01-halloween', { agent: 'chief_of_staff', text: 'ep01 final cut ready' });
const rows = () => q(SDB, 'SELECT ref, kind, video_id, status FROM approvals ORDER BY id');
const notes = q(SDB, "SELECT text FROM events WHERE kind = 'note' AND text LIKE 'approval queued until 07:00%'");
ok(r.queued === true && r.ref === null && r.release_at === '2026-10-21T06:00:00.000Z' && rows().length === 0 && db.listQueuedApprovals().length === 1 && notes.length === 1,
  '23:45: no approval row, one queue line, note "approval queued until 07:00", returns {ref:null, queued:true, release_at 07:00}', JSON.stringify({ r, rows: rows(), notes }));
const line = JSON.parse(readFileSync(db.QUEUE_PATH, 'utf8').split('\n')[0]);
ok(['kind', 'video_id', 'agent', 'text', 'queued_at', 'release_at'].every((k) => k in line) && line.text === 'ep01 final cut ready', 'queue line has kind, video_id, agent, text, queued_at, release_at', JSON.stringify(line));
r = db.createApproval('video', 'ep01-halloween', { agent: 'chief_of_staff' });
ok(r.queued && r.already_queued && db.listQueuedApprovals().length === 1, 'same kind + video again: not queued twice');
process.env.STUDIO_NOW = local('2026-10-21', '03:10');
r = db.createApproval('script', 'v-2026-10-21-01', { agent: 'chief_of_staff' });
ok(r.queued && r.release_at === '2026-10-21T06:00:00.000Z' && db.listQueuedApprovals().length === 2, '03:10: queued until 07:00 the same morning');

// ---------- 3. release at 07:00, never twice ----------
process.env.STUDIO_NOW = local('2026-10-21', '06:59');
ok(db.releaseDueApprovals().length === 0 && rows().length === 0, '06:59: nothing released yet');
process.env.STUDIO_NOW = local('2026-10-21', '07:00');
const rel = db.releaseDueApprovals();
ok(rel.length === 2 && rel.every((x) => /^ap-\d+$/.test(x.ref) && !x.duplicate) && rows().length === 2 && rows().every((x) => x.status === 'pending') && db.listQueuedApprovals().length === 0,
  '07:00: both released as normal pending ap-N approvals (oldest first)', JSON.stringify({ rel, rows: rows() }));
ok(db.releaseDueApprovals().length === 0 && rows().length === 2, 'releasing again inserts nothing');
// Crash between the insert and the 'released' line: the DB check still refuses a second insert.
writeFileSync(db.QUEUE_PATH, readFileSync(db.QUEUE_PATH, 'utf8').split('\n').filter((l) => l.includes('"type":"queued"')).join('\n') + '\n');
const again = db.releaseDueApprovals();
ok(again.length === 2 && again.every((x) => x.duplicate) && rows().length === 2, 'released lines lost (crash): no duplicate row, the refs are recovered', JSON.stringify(again));
const cli = node(['core/release-approvals.mjs'], { STUDIO_DB: SDB, STUDIO_NOW: local('2026-10-21', '07:05'), STUDIO_WAITER: 'off' });
ok(cli.status === 0 && JSON.parse(cli.stdout).released.length === 0 && rows().length === 2, 'core/release-approvals.mjs: idempotent', cli.stdout + cli.stderr);
// Cancel (added 2026-10-21): a cancelled queued item is never released, even by a pre-cancel reader (compat 'released' line).
process.env.STUDIO_NOW = local('2026-10-21', '03:20');
r = db.createApproval('script', 'v-2026-10-21-cx', { agent: 'chief_of_staff' });
const cx = db.cancelQueuedApproval(r.queue_id, { reason: 'replaced (test)' });
ok(cx.id === r.queue_id && db.listQueuedApprovals().length === 0 && db.listQueuedApprovals({ includeReleased: true }).find((x) => x.id === r.queue_id)?.cancelled,
  'cancelQueuedApproval: the item leaves the queue and is marked cancelled');
let cxErr = '';
try { db.cancelQueuedApproval(r.queue_id, { reason: 'again' }); } catch (e) { cxErr = e.message; }
ok(/already cancelled/.test(cxErr), 'cancelling twice is refused', cxErr);

process.env.STUDIO_NOW = local('2026-10-21', '07:10');
ok(db.releaseDueApprovals().length === 0 && rows().length === 2, 'a cancelled item is never released');
process.env.STUDIO_NOW = local('2026-10-21', '07:05');
r = db.createApproval('script', 'v-2026-10-21-02', { agent: 'chief_of_staff' });
ok(!r.queued && /^ap-\d+$/.test(r.ref) && rows().length === 3, '07:00 and later: a normal approval row at once');
db.closeDb();

// ---------- 4. the waiter: one detached process, real 4 s sleep, then release and exit ----------
const wenv = { STUDIO_DB: WDB, STUDIO_NOW: local('2026-10-21', '06:59:56'), STUDIO_WAITER: '' };
const q1 = node(['core/queue-approval.mjs', 'video', 'ep01-halloween', 'ep01 final cut ready'], wenv);
const waiterFile = `${WDB}.approval-waiter.json`;
const w1 = existsSync(waiterFile) ? JSON.parse(readFileSync(waiterFile, 'utf8')) : null;
const q2 = node(['core/queue-approval.mjs', 'script', 'v-2026-10-21-03', 'second item'], wenv);
const w2 = existsSync(waiterFile) ? JSON.parse(readFileSync(waiterFile, 'utf8')) : null;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
ok(/"launched":true/.test(q1.stdout) && w1?.pid && alive(w1.pid) && w1.release_at === '2026-10-21T06:00:00.000Z' && w1.started_at, 'quiet hours: queue-approval launches ONE waiter, data file {pid, release_at, started_at}', q1.stdout + q1.stderr);
ok(/a waiter is already alive/.test(q2.stdout) && w2?.pid === w1?.pid, 'second queued approval: no second waiter (pid alive)', q2.stdout + q2.stderr);
const l3 = node(['core/approval-waiter.mjs'], wenv);
ok(/already alive/.test(l3.stdout), 'launching the waiter by hand while one is alive: still one', l3.stdout + l3.stderr);
for (let i = 0; i < 60 && (existsSync(waiterFile) || alive(w1?.pid)); i += 1) await sleep(500);
const wrows = existsSync(WDB) ? q(WDB, "SELECT ref, kind FROM approvals WHERE status = 'pending'") : [];
ok(!existsSync(waiterFile) && !alive(w1?.pid) && wrows.length === 2, 'at 07:00 the waiter released both items, removed its file and exited', JSON.stringify(wrows));

const realAfter = realState();
ok(realBefore === realAfter, `real data/ untouched (${realBefore} -> ${realAfter})`);
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exitCode = failed ? 1 : 0;
