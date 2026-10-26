// Faceless Studio: runs the trend scanner (workshop/trends.py, yt-dlp metadata only) and stores its rows in the trends table.
// Used by the scan_trends MCP tool, and by hand:  node --no-warnings core/trends.mjs [max_results]
// Tests set STUDIO_TRENDS_FIXTURE=<json file> to replay a saved scanner output instead of touching the network.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { insertTrends, listTrends, listTrendsForFlags, updateTrendFlags, STUDIO_ROOT } from './db.mjs';
import { safePath } from './paths.mjs';
import { KOKORO_PY } from './local-config.mjs';

/** A bare command name ("python") becomes its full path on the PATH, so existsSync checks keep working; else unchanged. */
function onPath(cmd) {
  if (!cmd || path.isAbsolute(cmd) || /[\\/]/.test(cmd)) return cmd;
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      if (existsSync(full)) return full;
    }
  }
  return cmd;
}

// A Python with yt_dlp installed: STUDIO_PYTHON, else the same Python as Kokoro (core/local-config.mjs). Run in isolated
// mode (-I); the studio never writes in that folder.
export const PYTHON = onPath(process.env.STUDIO_PYTHON || KOKORO_PY);
const SCANNER = path.join(STUDIO_ROOT, 'workshop', 'trends.py');
const SPAWN_TIMEOUT_MS = 570_000;      // hard kill at 9.5 min; the scanner's own budget (timeout_s) is shorter
// 2026-10-21 (2nd pass): 20 queries x 20 results (Shorts this week), 15 channel tabs, up to 70 full fetches,
// (freshness: see SCAN_PASSES below) -> target 40 stored rows, scanner budget 8 min, whole scan under 10 min.
const SCAN_BUDGET_S = 480;
const SCAN_SIZE = { per_query: 20, max_channel_tabs: 15, max_full: 70 };
// 2026-10-21 (owner's decision, brand/lanes.md TREND GATE FRESHNESS): two passes. Pass 10 = Shorts this week, rows
// 10 days old or less; pass 30 (default, the wider one) = Shorts this month, rows 30 days old or less.
export const SCAN_PASSES = { 10: { max_age_days: 10, search_filter: 'shorts_week' }, 30: { max_age_days: 30, search_filter: 'shorts_month' } };
export const DEFAULT_PASS = 30;
export const DEFAULT_MAX_RESULTS = 40;
const MAX_OUTPUT = 4 * 1024 * 1024;

/** "- item" lines under a "## <heading>" section of a markdown file. */
function listUnder(text, heading) {
  const out = [];
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s/.test(line)) { inside = line.replace(/^##\s+/, '').trim().toLowerCase() === heading.toLowerCase(); continue; }
    const m = inside && /^-\s+(.+)$/.exec(line.trim());
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** Queries from brand/trend-queries.md. */
export function readQueries(brandDir = 'brand') {
  const abs = safePath(`${brandDir}/trend-queries.md`);
  return existsSync(abs) ? listUnder(readFileSync(abs, 'utf8'), 'Queries').filter((q) => q.length <= 100).slice(0, 20) : [];
}

/** YouTube channels from brand/channels.md lines "- youtube · <url> · tier: … · why: …". */
export function readChannels(brandDir = 'brand') {
  const abs = safePath(`${brandDir}/channels.md`);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const item of listUnder(readFileSync(abs, 'utf8'), 'Channels')) {
    const parts = item.split('·').map((s) => s.trim());
    if (parts[0]?.toLowerCase() !== 'youtube') continue;
    let url = parts[1] ?? '';
    if (/^@[\w.-]+$/.test(url)) url = `https://www.youtube.com/${url}`;
    if (!/^https:\/\/(www\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]+)\/?$/.test(url)) continue;
    const name = /name:\s*([^·]+)/.exec(item)?.[1]?.trim() ?? null;
    out.push({ url: url.replace(/\/$/, ''), name });
  }
  return out.slice(0, 40);
}

// ---------- "not usable" classifier (added 2026-10-20, any concept) ----------
// Conservative keyword/regex check of the title and channel against brand/not-usable.md. Deterministic, no network.
const FLAG_SECTIONS = [
  ['people', 'real person'],
  ['brands', 'brand'],
  ['film, tv, game and character ip', 'IP'],
  ['dubbing and reuploads', 'dub/reupload'],
];
const UNCERTAIN_SECTION = 'uncertain hints';

/** Lower case, accents removed, curly quotes straightened. */
const fold = (t) => String(t ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'").toLowerCase();
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A term matches as whole words; spaces, dashes, dots, apostrophes and underscores inside it are optional. */
function termRegex(term) {
  const parts = fold(term).split(/[\s\-_.']+/).filter(Boolean).map(escapeRe);
  if (!parts.length) return null;
  return new RegExp(`(^|[^a-z0-9])${parts.join("[\\s\\-_.']*")}(?=[^a-z0-9]|$)`);
}
function itemRegex(item) {
  const m = /^\/(.+)\/([a-z]*)$/.exec(item.trim());
  if (!m) return termRegex(item);
  try { return new RegExp(m[1], m[2].replace(/[gy]/g, '') || 'i'); } catch { return null; }
}

/** Loads brand/not-usable.md into [{label, items:[{text, re}]}] plus the uncertain hints. Missing file = empty lists. */
export function loadFlagRules(brandDir = 'brand') {
  const abs = safePath(`${brandDir}/not-usable.md`);
  const text = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  const build = (heading) => listUnder(text, heading).slice(0, 1000).map((t) => {
    const [pat, label] = t.split(/\s+·\s+/);
    return { text: (label ?? pat).trim(), re: itemRegex(pat) };
  }).filter((x) => x.re);
  return { groups: FLAG_SECTIONS.map(([h, label]) => ({ label, items: build(h) })), uncertain: build(UNCERTAIN_SECTION), loaded: !!text };
}

// English-audience rule (director, 20/10): a trend is usable only if its title is English or has no words at all
// (pure visual). Other languages stay visible as signal only. Non-Latin letters, or common romanised Hindi/Urdu words.
const NON_LATIN_LETTER = /(?=\p{L})(?!\p{Script=Latin})/u;
const ROMANISED_HINTS = /\b(hai|hain|nahi|nahin|kya|kyun|wala|wali|wale|bhai|bhoot|yaar|accha|acha|mera|meri|tera|teri|kaise|kaisa|bahut|abhi|matlab|chalo|dekho)\b/i;

function nonEnglishReason(title) {
  if (NON_LATIN_LETTER.test(title)) return 'language: not English (non-Latin script)';
  const hint = title.match(ROMANISED_HINTS);
  if (hint) return `language: not English ("${hint[0]}")`;
  return null;
}

/** { usable: 1|0, flag_reason } for one trend row (title + channel). */
export function classifyTrend(row, rules) {
  const hay = fold(`${row.title ?? ''} ${row.channel ?? ''}`);
  if (!hay.trim()) return { usable: 0, flag_reason: 'uncertain: check (no title)' };
  if (!rules.loaded) return { usable: 0, flag_reason: 'uncertain: check (brand/not-usable.md missing)' };
  const hits = [];
  for (const g of rules.groups) {
    const found = g.items.filter((i) => i.re.test(hay)).map((i) => i.text);
    if (found.length) hits.push(`${g.label}: ${[...new Set(found)].slice(0, 4).join(', ')}`);
  }
  if (hits.length) return { usable: 0, flag_reason: hits.join('; ').slice(0, 300) };
  const lang = nonEnglishReason(row.title ?? '');
  if (lang) return { usable: 0, flag_reason: lang };
  const soft = rules.uncertain.filter((i) => i.re.test(hay)).map((i) => i.text);
  if (soft.length) return { usable: 0, flag_reason: `uncertain: check (${soft.slice(0, 3).join(', ')})`.slice(0, 300) };
  return { usable: 1, flag_reason: null };
}

/**
 * Classifies stored rows: by default only those never classified (usable NULL); all = true re-runs every row
 * except the ones an agent corrected with flag_trend ("set by ..."), which are kept.
 */
export function backfillTrendFlags({ brandDir = 'brand', all = false } = {}) {
  const rules = loadFlagRules(brandDir);
  const rows = listTrendsForFlags({ all }).filter((r) => !(all && /^set by /.test(r.flag_reason ?? '')));
  const updated = updateTrendFlags(rows.map((r) => ({ id: r.id, ...classifyTrend(r, rules) })));
  return { checked: rows.length, updated };
}

function runPython(config) {
  return new Promise((resolve, reject) => {
    if (!existsSync(PYTHON)) return reject(new Error(`python not found at ${PYTHON}`));
    const child = spawn(PYTHON, ['-I', '-X', 'utf8', SCANNER], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, cwd: STUDIO_ROOT });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`trend scan timed out after ${SPAWN_TIMEOUT_MS / 1000} s`)); }, SPAWN_TIMEOUT_MS);
    child.stdout.on('data', (b) => { out += b; if (out.length > MAX_OUTPUT) { child.kill(); reject(new Error('scanner output too large')); } });
    child.stderr.on('data', (b) => { err = (err + b).slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`scanner exited ${code}: ${err.trim().split('\n').slice(-3).join(' ').slice(0, 300)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('scanner printed invalid JSON')); }
    });
    child.stdin.end(JSON.stringify(config));
  });
}

/** Runs one scan (or replays STUDIO_TRENDS_FIXTURE), stores the rows, returns a short summary plus the top rows. */
export async function runTrendScan({ max_results = DEFAULT_MAX_RESULTS, brandDir = 'brand', days = DEFAULT_PASS } = {}) {
  const pass = SCAN_PASSES[Number(days)];
  if (!pass) throw new Error(`days must be one of ${Object.keys(SCAN_PASSES).join(', ')} (got ${JSON.stringify(days)})`);
  const max = Math.min(Math.max(Math.trunc(Number(max_results)) || DEFAULT_MAX_RESULTS, 1), 100);
  const queries = readQueries(brandDir);
  const channels = readChannels(brandDir);
  if (!queries.length && !channels.length) throw new Error(`no queries in ${brandDir}/trend-queries.md and no channels in ${brandDir}/channels.md`);
  const fixture = process.env.STUDIO_TRENDS_FIXTURE;
  const scan = fixture
    ? JSON.parse(readFileSync(safePath(fixture, { mustExist: true }), 'utf8'))
    : await runPython({ queries, channels, ...SCAN_SIZE, ...pass, max_results: max, timeout_s: SCAN_BUDGET_S });
  const rules = loadFlagRules(brandDir);
  const rows = (scan.rows ?? []).slice(0, max).map((r) => ({ ...r, ...classifyTrend(r, rules) }));
  const scannedAt = scan.scanned_at && !Number.isNaN(Date.parse(scan.scanned_at)) ? new Date(scan.scanned_at).toISOString() : new Date().toISOString();
  const stored = insertTrends(rows, scannedAt);
  return {
    scanned_at: scannedAt, pass_days: Number(days), stored, queries: queries.length, tracked_channels: channels.length,
    stats: scan.stats ?? null, errors: (scan.errors ?? []).slice(0, 5), fixture: !!fixture,
    channels: scan.channels ?? [],
    usable: rows.filter((r) => r.usable === 1).length,
    top: listTrends({ limit: 10 }).rows,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  if (process.argv[2] === '--reclassify') {
    // node --no-warnings core/trends.mjs --reclassify   re-runs the "not usable" flag on every stored row.
    const r = backfillTrendFlags({ all: true });
    const l = listTrends({ limit: 100 });
    console.log(JSON.stringify({ ...r, scanned_at: l.scanned_at, total: l.total, usable: l.usable, rows: l.rows.map((x) => ({ id: x.id, usable: x.usable, flag_reason: x.flag_reason, title: x.title })) }, null, 2));
  } else {
    // node --no-warnings core/trends.mjs [max_results] [--days 10|30]   (default pass: 30 days, Shorts this month)
    const di = process.argv.indexOf('--days');
    const r = await runTrendScan({ max_results: Number(process.argv[2]) || DEFAULT_MAX_RESULTS, days: di > -1 ? Number(process.argv[di + 1]) : DEFAULT_PASS });
    console.log(JSON.stringify(r, null, 2));
  }
}
