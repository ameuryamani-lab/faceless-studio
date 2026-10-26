// Faceless Studio: runs ONE agent once through Claude Code on your own Claude subscription (your Claude Code login).
//   node core/run-agent.mjs <agent_id> "<task>" [--video <video_id>] [--concept <concept_id>] [--dry-run]
// Model and effort come from core/agents-models.json.
// Guards: ANTHROPIC_API_KEY is removed from the child env (subscription billing), a daily run cap,
// max turns per run, studio-only MCP tools, no native tools, and a clean stop on rate limits.
// The concept is a parameter: the system prompt is COMPOSED for every run =
// agents/<agent>.md + brand/studio.md + concept/<id>/rules.md, separated by a "---" line, written to data/prompts/<agent>-<pid>.md
// (pid: a rehearsal with --concept and the real chain may run the same agent at the same time), passed to the flag already in
// use, --append-system-prompt-file, and deleted after the run (finally). The concept is --concept, else the video's (story.json
// "concept", or active.json "legacy" for an old video: conceptIdOf), else the active one. The prompt's first line says
// "Concept: <id>". If the composition fails (file missing, concept invalid): the agent file alone + a French error event,
// so the chain never stops for a prompt problem. Precedence inside the composed prompt: studio > concept > agent file > task.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { STUDIO_ROOT, AGENT_IDS, setAgent, addEvent, nowIso } from './db.mjs';
import { parseStream, rateLimited, readPlan, savePlan } from './claude-usage.mjs';
import { activeConceptId, conceptIdOf, loadConcept } from './concept.mjs';

const CONFIG = JSON.parse(readFileSync(path.join(STUDIO_ROOT, 'core', 'agents-models.json'), 'utf8'));
const DATA = path.join(STUDIO_ROOT, 'data');
const RUNS_LOG = path.join(DATA, 'runs.jsonl');
const PAUSE_FILE = path.join(DATA, 'paused.json');
const PROMPTS_DIR = path.join(DATA, 'prompts'); // composed system prompts, one file per running agent process
const STUDIO_RULES = path.join(STUDIO_ROOT, 'brand', 'studio.md'); // the studio rules (any concept)
const PROMPT_SEPARATOR = '\n\n---\n\n';
// A run is bounded by max_turns (and Lester kills chief_of_staff after 200 s with taskkill /F, which skips our finally):
// a composed prompt older than this is the leftover of a killed run and is swept at the next start.
const STALE_PROMPT_MS = 2 * 60 * 60_000;
// Claude Code: CLAUDE_BIN, else the native installer's place (~/.local/bin/claude.exe), else 'claude' on the PATH.
const NATIVE_CLAUDE = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
const CLAUDE = process.env.CLAUDE_BIN || (existsSync(NATIVE_CLAUDE) ? NATIVE_CLAUDE : 'claude');
const NATIVE_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'Agent'];
const PAUSE_MS = 60 * 60_000;

function parseArgs(argv) {
  const [agent, task, ...rest] = argv;
  const after = (flag) => (rest.includes(flag) ? rest[rest.indexOf(flag) + 1] ?? null : null);
  return { agent, task, video: after('--video'), concept: after('--concept'), dryRun: rest.includes('--dry-run') };
}

function loadAgent(id) {
  const file = path.join(STUDIO_ROOT, 'agents', `${id}.md`);
  const text = readFileSync(file, 'utf8');
  const tools = (text.match(/^tools:\s*(.+)$/m)?.[1] || '').split(',').map((t) => t.trim()).filter(Boolean);
  // TikTok trends: WebSearch is the one native tool, and only for trend_scout.
  if (tools.some((t) => !t.startsWith('mcp__studio__') && !(t === 'WebSearch' && id === 'trend_scout'))) throw new Error(`${id}: only mcp__studio__ tools are allowed`);
  return { file, tools };
}

function runsToday() {
  if (!existsSync(RUNS_LOG)) return 0;
  const today = nowIso().slice(0, 10);
  return readFileSync(RUNS_LOG, 'utf8').split('\n').filter((l) => l.includes(`"date":"${today}"`)).length;
}

function pausedUntil() {
  if (!existsSync(PAUSE_FILE)) return null;
  const { until } = JSON.parse(readFileSync(PAUSE_FILE, 'utf8'));
  return until && until > nowIso() ? until : null;
}

/** The plan brake: null, or why agents wait (a window at or above its threshold that has not reset yet). */
function planBrake() {
  const b = CONFIG.limits.plan_brake;
  const plan = readPlan();
  if (!b || !plan) return null;
  for (const [key, max, label] of [['five_hour', b.five_hour_pct, 'session 5 h'], ['seven_day', b.seven_day_pct, 'semaine']]) {
    const w = plan[key];
    if (w && typeof max === 'number' && w.used_pct >= max && (!w.resets_at || Date.parse(w.resets_at) > Date.now())) return `${label} at ${w.used_pct} % (limit ${max} %), until ${w.resets_at ?? 'reset'}`;
  }
  return null;
}

// ---------- the composed system prompt (2026-10-24) ----------
/** --concept, else the video's concept (story.json "concept"; legacy for an old video; nothing without a story.json yet, as for
 *  the first steps of a chain), else the active concept. Throws a French error when none can be named (no active.json). */
function resolveConceptId({ concept, video }) {
  if (concept) return concept;
  return (video && conceptIdOf(video)) || activeConceptId();
}

/** Writes data/prompts/<agent>-<pid>.md = agent file + brand/studio.md + concept/<id>/rules.md and returns its path.
 *  Throws (French) when the concept does not load or a piece is missing: the caller then sends the agent file alone. */
function composeSystemPrompt(agent, agentFile, conceptId) {
  const c = loadConcept(conceptId); // validates concept.json + cast.json, one French error listing every fault
  if (!c.files.rules) throw new Error(`${c.rel}/rules.md manque`);
  if (!existsSync(STUDIO_RULES)) throw new Error('brand/studio.md manque');
  const parts = [agentFile, STUDIO_RULES, path.join(c.dir, 'rules.md')].map((f) => readFileSync(f, 'utf8').trim());
  mkdirSync(PROMPTS_DIR, { recursive: true });
  const file = path.join(PROMPTS_DIR, `${agent}-${process.pid}.md`);
  writeFileSync(file, `${parts.join(PROMPT_SEPARATOR)}\n`, 'utf8');
  return file;
}

/** Deletes composed prompts older than STALE_PROMPT_MS: leftovers of a run killed before its finally (taskkill, reboot). */
function sweepStalePrompts() {
  if (!existsSync(PROMPTS_DIR)) return;
  for (const name of readdirSync(PROMPTS_DIR).filter((n) => n.endsWith('.md'))) {
    const abs = path.join(PROMPTS_DIR, name);
    try { if (Date.now() - statSync(abs).mtimeMs > STALE_PROMPT_MS) rmSync(abs, { force: true }); } catch { /* another run deleted it first */ }
  }
}

function buildCommand({ agent, task, video }, { tools }, { conceptId, systemPromptFile }) {
  const pick = CONFIG.agents[agent];
  // 2026-10-24: the first line names the concept the agent works in; its rules are in the composed system prompt.
  const prompt = `${conceptId ? `Concept: ${conceptId}\n` : ''}${video ? `Video: ${video}\n` : ''}Task: ${task}`;
  const args = [
    '-p', prompt,
    '--model', pick.model, '--effort', pick.effort, '--fallback-model', CONFIG.fallback_model,
    '--max-turns', String(CONFIG.limits.max_turns_per_run),
    '--permission-mode', 'dontAsk', '--setting-sources', '',
    '--strict-mcp-config', '--mcp-config', path.join(STUDIO_ROOT, 'core', 'mcp.json'),
    // 2026-10-24: WebSearch only for an agent that declares it (trend_scout's TikTok sweep); every other native tool stays off.
    '--allowedTools', tools.join(','), '--disallowedTools', NATIVE_TOOLS.filter((t) => !(t === 'WebSearch' && tools.includes('WebSearch'))).join(','),
    '--append-system-prompt-file', systemPromptFile,
    // stream-json: the reply, its usage (tokens, turns) and the plan windows (rate_limit_event) for the vitrine's consumption panel.
    '--output-format', 'stream-json', '--verbose',
  ];
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // bill the Claude Code login (subscription), never the API credit
  return { args, env, pick };
}

function record(entry) {
  mkdirSync(DATA, { recursive: true });
  appendFileSync(RUNS_LOG, JSON.stringify({ date: nowIso().slice(0, 10), at: nowIso(), ...entry }) + '\n');
}

function pauseForRateLimit(agent, video) {
  const until = new Date(Date.now() + PAUSE_MS).toISOString();
  writeFileSync(PAUSE_FILE, JSON.stringify({ until, reason: 'Claude subscription limit reached', at: nowIso() }));
  addEvent({ kind: 'error', agent, video_id: video, text: "Limite de l'abonnement Claude atteinte : studio en pause pendant 1 h" });
  setAgent(agent, { state: 'error', task: "En pause : limite de l'abonnement", video_id: video });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!AGENT_IDS.has(opts.agent) || !opts.task) throw new Error('Usage: node core/run-agent.mjs <agent_id> "<task>" [--video id] [--concept id] [--dry-run]');
  const until = pausedUntil();
  if (until) throw new Error(`Studio paused after a rate limit until ${until}`);
  const used = runsToday();
  if (typeof CONFIG.limits.max_runs_per_day === 'number' && used >= CONFIG.limits.max_runs_per_day) throw new Error(`Daily cap reached (${used}/${CONFIG.limits.max_runs_per_day} runs)`);
  const brake = planBrake();
  if (brake) throw new Error(`Studio paused by the plan brake: ${brake}`);

  const agentDef = loadAgent(opts.agent);
  sweepStalePrompts();
  // The system prompt: composed when the concept loads; the agent file alone otherwise (a prompt problem never blocks a chain).
  let conceptId = null, composed = null, promptError = null;
  try {
    conceptId = resolveConceptId(opts);
    composed = composeSystemPrompt(opts.agent, agentDef.file, conceptId);
  } catch (e) {
    promptError = e.message;
  }
  // A dry run writes nothing in the database: the problem is in its JSON instead.
  if (promptError && !opts.dryRun) addEvent({ kind: 'error', agent: opts.agent, video_id: opts.video, text: `Prompt système incomplet pour ${opts.agent} (fiche seule envoyée) : ${promptError}` });

  try {
    const { args, env, pick } = buildCommand(opts, agentDef, { conceptId, systemPromptFile: composed ?? agentDef.file });
    if (opts.dryRun) {
      const rel = (f) => path.relative(STUDIO_ROOT, f).split(path.sep).join('/');
      console.log(JSON.stringify({
        agent: opts.agent, model: pick.model, effort: pick.effort, concept: conceptId,
        system_prompt_file: rel(composed ?? agentDef.file), system_prompt_bytes: statSync(composed ?? agentDef.file).size,
        system_prompt_composed: Boolean(composed), system_prompt_error: promptError,
        runs_today: used, api_key_in_env: 'ANTHROPIC_API_KEY' in env, args,
      }, null, 2));
      return;
    }

    // The vitrine bubble: the task's short French label (the text before its first ". "), not the instructions that follow.
    setAgent(opts.agent, { state: 'working', task: opts.task.split('. ')[0].slice(0, 80), video_id: opts.video });
    const started = Date.now();
    const child = spawn(CLAUDE, args, { env, cwd: STUDIO_ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let raw = '';
    let errOut = '';
    child.stdout.on('data', (d) => { raw += d; });
    child.stderr.on('data', (d) => { errOut += d; });
    const code = await new Promise((resolve) => child.on('close', resolve));

    // stream-json: the reply text goes to stdout as before; usage goes to data/runs.jsonl (no prompt or reply text stored);
    // the plan windows go to data/claude-usage.json (percentages and reset times only).
    const { result: parsed, plan } = parseStream(raw);
    if (plan) savePlan(plan);
    const out = (parsed && typeof parsed.result === 'string' ? parsed.result : raw) + errOut;
    const u = parsed?.usage ?? {};
    const usage = parsed ? {
      input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null,
      cache_read_tokens: u.cache_read_input_tokens ?? null, cache_write_tokens: u.cache_creation_input_tokens ?? null,
      api_equiv_usd: typeof parsed.total_cost_usd === 'number' ? Number(parsed.total_cost_usd.toFixed(4)) : null,
      turns: parsed.num_turns ?? null,
    } : {};
    const limited = rateLimited({ code, result: parsed, plan, errOut });
    // 2026-10-24: "concept" in runs.jsonl, to compare the input/cache_write cost of the composed prompt per concept.
    record({ agent: opts.agent, model: pick.model, effort: pick.effort, video_id: opts.video, concept: conceptId, code, rate_limited: limited, duration_ms: Date.now() - started, ...usage });
    if (limited && CONFIG.limits.stop_if_rate_limited) {
      pauseForRateLimit(opts.agent, opts.video);
      throw new Error('Rate limited: studio paused for 1 hour');
    }
    setAgent(opts.agent, { state: code === 0 ? 'idle' : 'error', task: null, video_id: opts.video });
    process.stdout.write(out);
    process.exitCode = code;
  } finally {
    if (composed) rmSync(composed, { force: true }); // the composed prompt lives only as long as the run
  }
}

main().catch((err) => { console.error(`run-agent: ${err.message}`); process.exitCode = 1; });
