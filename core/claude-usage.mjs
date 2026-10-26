// Faceless Studio: the owner's Claude plan usage (the 5-hour session and the week, as the Claude app shows them). Claude Code's own stream-json output carries a rate_limit_event with the plan's
// windows (five_hour, seven_day: utilization 0-1 and reset time). Every studio agent run saves the latest one here; between
// runs, `node core/claude-usage.mjs refresh` (Windows task, every 30 min) makes one tiny Haiku call to read it.
// Files: data/claude-usage.json (latest), data/claude-usage.jsonl (one line per reading, for the day's curve).
// Never stores the account email, token or any credential: only percentages and reset times.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const USAGE_FILE = path.join(ROOT, 'data', 'claude-usage.json');
export const USAGE_LOG = path.join(ROOT, 'data', 'claude-usage.jsonl');
// Claude Code: CLAUDE_BIN, else the native installer's place (~/.local/bin/claude.exe), else 'claude' on the PATH.
const NATIVE_CLAUDE = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
const CLAUDE = process.env.CLAUDE_BIN || (existsSync(NATIVE_CLAUDE) ? NATIVE_CLAUDE : 'claude');
const STALE_MS = 25 * 60_000;

/** Parses Claude Code stream-json output: the result line (reply, usage, cost) and the plan windows. */
export function parseStream(raw) {
  let result = null, plan = null;
  for (const line of String(raw).split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'result') result = j;
    if (j.type === 'rate_limit_event' && j.rate_limit_info) plan = j.rate_limit_info;
  }
  return { result, plan };
}

// The words of a real limit, in the reply of a failed run or in stderr. Never matched against the whole stream: every run holds a
// "rate_limit_event" line and ids that may contain "429" (night of 24-25/10: a DNS failure paused the studio twice for nothing).
const LIMIT_TEXT = /usage limit|limit reached|hit your limit|rate.?limited|\b429\b|overloaded/i;
/** True when a failed run (code ≠ 0) stopped on the plan: a rejected window, or a limit message in its reply or stderr. */
export function rateLimited({ code, result, plan, errOut = '' }) {
  if (code === 0) return false;
  if (plan?.status === 'rejected') return true;
  return LIMIT_TEXT.test(`${typeof result?.result === 'string' ? result.result : ''}\n${errOut}`);
}

/** Keeps only the plan's percentages and reset times, and saves them. */
export function savePlan(info) {
  const w = info?.unifiedWindows ?? {};
  const win = (x) => (x && typeof x.utilization === 'number' ? { used_pct: Math.round(x.utilization * 100), resets_at: x.resetsAt ? new Date(x.resetsAt * 1000).toISOString() : null } : null);
  const snap = { at: new Date().toISOString(), status: typeof info?.status === 'string' ? info.status : null, five_hour: win(w.five_hour), seven_day: win(w.seven_day) };
  if (!snap.five_hour && !snap.seven_day) return null;
  writeFileSync(USAGE_FILE, JSON.stringify(snap, null, 1));
  appendFileSync(USAGE_LOG, JSON.stringify(snap) + '\n');
  return snap;
}

export function readPlan() {
  try { return JSON.parse(readFileSync(USAGE_FILE, 'utf8')); } catch { return null; }
}

/** One tiny Haiku call to read the plan windows, unless a reading is fresher than 25 min. */
export async function refresh({ force = false } = {}) {
  const cur = readPlan();
  if (!force && cur && Date.now() - Date.parse(cur.at) < STALE_MS) return { skipped: true, at: cur.at };
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // the subscription login, never the API credit
  const raw = await new Promise((resolve) => {
    const p = spawn(CLAUDE, ['-p', 'Reply with the single word ok.', '--model', 'haiku', '--max-turns', '1', '--setting-sources', '', '--strict-mcp-config', '--output-format', 'stream-json', '--verbose'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '';
    p.stdout.on('data', (d) => { o += d; });
    p.on('close', () => resolve(o));
    p.on('error', () => resolve(''));
  });
  const { plan } = parseStream(raw);
  return plan ? savePlan(plan) : { error: 'no rate_limit_event in the output' };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv[2] !== 'refresh') console.log(JSON.stringify(readPlan()));
  else refresh({ force: process.argv.includes('--force') }).then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
