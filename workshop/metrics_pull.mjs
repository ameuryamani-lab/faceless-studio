// Faceless Studio: pulls the public counts of OUR published videos into the metrics table, at the checkpoint due.
//   node --no-warnings workshop/metrics_pull.mjs [--dry-run] [--publications <studio file>]
// Sources: posts rows with a url, the publisher's journal, and data/publications.jsonl lines in the publication format
// {ref, video_id, le, reseaux:[{reseau, publie, lien, erreur}]}.
// Your own accounts (for the yt-dlp fallback): STUDIO_YOUTUBE_HANDLE and STUDIO_TIKTOK_HANDLE in the environment, or
// youtube_handle / tiktok_handle in config.local.json. Without them only the Upload-Post counts are recorded.
// Checkpoints 1h / 24h / 72h / 7d after the publish time: the latest one already due and not yet recorded is written.
// YouTube via yt-dlp (views, likes, comments); TikTok best effort; Instagram skipped (no public count without a login).
// Only videos on our own accounts are recorded. Read-only on the network: nothing is posted, nothing is downloaded.
// Not scheduled: run by hand. Tests: STUDIO_METRICS_FIXTURE=<json file> replays fetch results instead of yt-dlp.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { addEvent, addMetric, checkVideoId, listMetricCheckpoints, listPublishedPosts, STUDIO_ROOT } from '../core/db.mjs';
import { JOURNAL, readEnv } from '../core/publish-direct.mjs';
import { safePath } from '../core/paths.mjs';
import { PYTHON } from '../core/trends.mjs';
import { syncPublications } from '../core/sync-publications.mjs';
import { STUDIO_DIR } from '../core/local-config.mjs';

/** The channel's own handles: environment first, then config.local.json; '' when not set. */
function ownHandles() {
  let local = {};
  const file = path.join(STUDIO_DIR, 'config.local.json');
  if (existsSync(file)) { try { local = JSON.parse(readFileSync(file, 'utf8')); } catch { local = {}; } }
  const yt = String(process.env.STUDIO_YOUTUBE_HANDLE || local.youtube_handle || '').trim().toLowerCase().replace(/^@/, '');
  const tt = String(process.env.STUDIO_TIKTOK_HANDLE || local.tiktok_handle || '').trim().toLowerCase().replace(/^@/, '');
  return { youtube: yt ? `@${yt}` : '', tiktok: tt };
}
const OUR = ownHandles();
const HOUR = 3_600_000;
const CHECKPOINT_AGE = [['1h', 1 * HOUR], ['24h', 24 * HOUR], ['72h', 72 * HOUR], ['7d', 168 * HOUR]];
// Past this age a checkpoint is still written (it is the nearest one left) but flagged late.
const LATE_AFTER = { '1h': 6 * HOUR, '24h': 48 * HOUR, '72h': 120 * HOUR, '7d': 336 * HOUR };
const FETCH_TIMEOUT_MS = 240_000;
const HELPER = path.join(STUDIO_ROOT, 'workshop', 'metrics_fetch.py');
const UPLOAD_POST = 'https://api.upload-post.com/api';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const pubIdx = args.indexOf('--publications');
const PUBLICATIONS = pubIdx >= 0 && args[pubIdx + 1] ? args[pubIdx + 1] : 'data/publications.jsonl';

/** The checkpoint to record now: the latest one already due that is not recorded yet (null when none). */
export function dueCheckpoint(publishedAt, recorded, now = Date.now()) {
  const age = now - Date.parse(publishedAt);
  if (!Number.isFinite(age) || age < 0) return null;
  const due = CHECKPOINT_AGE.filter(([, ms]) => age >= ms);
  if (!due.length) return null;
  const [cp] = due[due.length - 1];
  if (recorded.includes(cp)) return null;
  return { checkpoint: cp, late: age > LATE_AFTER[cp], age_h: Math.round(age / HOUR) };
}

const PLATFORM_OF = (s) => {
  const p = String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return p.startsWith('youtube') ? 'youtube' : p.startsWith('tiktok') ? 'tiktok' : p.startsWith('instagram') ? 'instagram' : null;
};

function readPublications(rel, notes) {
  let abs;
  try { abs = safePath(rel); } catch (e) { notes.push(`publications file refused: ${e.message}`); return []; }
  if (!existsSync(abs)) { notes.push(`${rel}: not found (no publications yet)`); return []; }
  const out = [];
  readFileSync(abs, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let row;
    try { row = JSON.parse(line); } catch { notes.push(`${rel} line ${i + 1}: not JSON, skipped`); return; }
    let vid;
    try { vid = checkVideoId(row.video_id); } catch { notes.push(`${rel} line ${i + 1}: video_id ${JSON.stringify(row.video_id)} not usable, skipped`); return; }
    for (const r of Array.isArray(row.reseaux) ? row.reseaux : []) {
      const platform = PLATFORM_OF(r.reseau);
      if (!platform || !r.publie || !r.lien) continue;
      out.push({ video_id: vid, platform, url: String(r.lien), published_at: row.le, source: 'publications.jsonl' });
    }
  });
  return out;
}

function fetchCounts(urls) {
  const fixture = process.env.STUDIO_METRICS_FIXTURE;
  if (fixture) return Promise.resolve(JSON.parse(readFileSync(safePath(fixture, { mustExist: true }), 'utf8')));
  return new Promise((resolve, reject) => {
    if (!existsSync(PYTHON)) return reject(new Error(`python not found at ${PYTHON}`));
    const child = spawn(PYTHON, ['-I', '-X', 'utf8', HELPER], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, cwd: STUDIO_ROOT });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('metrics fetch timed out')); }, FETCH_TIMEOUT_MS);
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err = (err + b).slice(-2000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`metrics helper exited ${code}: ${err.trim().slice(-300)}`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error('metrics helper printed invalid JSON')); }
    });
    child.stdin.end(JSON.stringify({ urls }));
  });
}

// The publisher's own journal gives every
// network a video reached, with its Upload-Post request_id; Upload-Post's per-post analytics then read the real counts on
// YouTube, TikTok and Instagram (same key, no login, nothing paid). yt-dlp stays as the fallback without a request_id.
function readJournal(notes) {
  const out = [];
  if (!existsSync(JOURNAL)) return out;
  for (const line of readFileSync(JOURNAL, 'utf8').split(/\r?\n/)) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (!/result$/.test(j.phase ?? '') || !j.request_id || !Array.isArray(j.nets)) continue;
    for (const n of j.nets) {
      if (!n.publie || !PLATFORM_OF(n.reseau)) continue;
      out.push({ video_id: j.video_id, platform: PLATFORM_OF(n.reseau), url: n.lien || `upload-post:${j.request_id}`, published_at: j.at, request_id: j.request_id, source: 'journal' });
    }
  }
  if (!out.length) notes.push('publish journal: no published network yet');
  return out;
}

async function uploadPostCounts(key, requestId, platform) {
  const r = await fetch(`${UPLOAD_POST}/uploadposts/post-analytics/${encodeURIComponent(requestId)}?platform=${platform}`, { headers: { Authorization: `Apikey ${key}` }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) return { ok: false, error: `Upload-Post ${r.status}` };
  const m = (await r.json())?.platforms?.[platform]?.post_metrics;
  if (!m) return { ok: false, error: 'Upload-Post: no post_metrics' };
  return { ok: true, views: m.views ?? null, likes: m.likes ?? null, comments: m.comments ?? null, shares: m.shares ?? null };
}

/** Followers and profile totals per network (Upload-Post profile analytics), one line a run in data/followers.jsonl. */
async function followersSnapshot(key, profile) {
  const r = await fetch(`${UPLOAD_POST}/analytics/${encodeURIComponent(profile)}?platforms=youtube,tiktok,instagram`, { headers: { Authorization: `Apikey ${key}` }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Upload-Post ${r.status}`);
  const j = await r.json();
  const row = { at: new Date().toISOString() };
  for (const p of ['youtube', 'tiktok', 'instagram']) if (j[p] && typeof j[p] === 'object') row[p] = { followers: j[p].followers ?? null, views: j[p].views ?? null, likes: j[p].likes ?? null };
  appendFileSync(path.join(STUDIO_ROOT, 'data', 'followers.jsonl'), JSON.stringify(row) + '\n');
  return row;
}

function isOurs(platform, url, fetched) {
  if (platform === 'youtube') return Boolean(OUR.youtube) && String(fetched.uploader_id ?? '').toLowerCase() === OUR.youtube;
  if (platform === 'tiktok') return Boolean(OUR.tiktok) && (url.toLowerCase().includes(`/@${OUR.tiktok}/`) || String(fetched.uploader_id ?? '').toLowerCase() === OUR.tiktok);
  return false;
}

async function main() {
  const notes = [];
  // The publications file first: posts.status / published_at / url (idempotent; skipped in a dry run, which writes nothing).
  if (!DRY) {
    try {
      const s = syncPublications(path.resolve(STUDIO_ROOT, PUBLICATIONS));
      if (s.marked || s.skipped.length) notes.push(`publications synced: ${s.marked} row(s) marked published${s.skipped.length ? `, skipped: ${s.skipped.join('; ')}` : ''}`);
    } catch (e) { notes.push(`publications not synced: ${e.message}`); }
  }
  const fromJournal = readJournal(notes);
  const fromDb = listPublishedPosts().map((p) => ({ ...p, source: 'posts' }));
  const fromFile = readPublications(PUBLICATIONS, notes);
  const seen = new Set();
  const items = [...fromJournal, ...fromDb, ...fromFile].filter((p) => { const k = `${p.video_id}|${p.platform}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const env = readEnv();
  if (env.key && !DRY) {
    try { const f = await followersSnapshot(env.key, env.profile); console.log(`followers: ${['youtube', 'tiktok', 'instagram'].map((p) => `${p} ${f[p]?.followers ?? '?'}`).join(', ')}`); } catch (e) { console.log(`  note: followers not read (${e.message})`); }
  }
  console.log(`metrics_pull${DRY ? ' (dry run: nothing written)' : ''} — ${new Date().toISOString()}`);
  console.log(`Sources: ${fromDb.length} post row(s) with a url, ${fromFile.length} published link(s) in ${PUBLICATIONS}.`);
  for (const n of notes) console.log(`  note: ${n}`);
  if (!items.length) {
    console.log(`No published videos yet: nothing to measure. (Our accounts: YouTube ${OUR.youtube || 'not set'}, TikTok ${OUR.tiktok ? `@${OUR.tiktok}` : 'not set'}; Instagram is skipped.)`);
    return;
  }
  const todo = [];
  for (const it of items) {
    if (it.platform === 'instagram' && !it.request_id) { console.log(`  skip ${it.video_id} instagram: no Upload-Post request id`); continue; }
    if (!it.published_at || Number.isNaN(Date.parse(it.published_at))) { console.log(`  skip ${it.video_id} ${it.platform}: no publish time`); continue; }
    const due = dueCheckpoint(it.published_at, listMetricCheckpoints(it.video_id, it.platform));
    if (!due) { console.log(`  wait ${it.video_id} ${it.platform}: no checkpoint due`); continue; }
    todo.push({ ...it, ...due });
  }
  if (!todo.length) { console.log('Nothing due now.'); return; }
  const viaUploadPost = new Map();
  if (env.key) for (const t of todo.filter((x) => x.request_id)) viaUploadPost.set(t, await uploadPostCounts(env.key, t.request_id, t.platform).catch((e) => ({ ok: false, error: e.message })));
  const rest = todo.filter((t) => !viaUploadPost.get(t)?.ok && !/^upload-post:/.test(t.url) && t.platform !== 'instagram');
  const results = rest.length ? await fetchCounts(rest.map((t) => t.url)) : [];
  const byUrl = new Map(results.map((r) => [r.url, r]));
  let written = 0;
  for (const t of todo) {
    const up = viaUploadPost.get(t);
    const r = up?.ok ? up : byUrl.get(t.url) ?? up;
    const label = `${t.video_id} ${t.platform} ${t.checkpoint}${t.late ? ' (late)' : ''}`;
    if (!r?.ok) { console.log(`  fail ${label}: ${r?.error ?? 'no answer'}`); continue; }
    if (!up?.ok && !isOurs(t.platform, t.url, r)) { console.log(`  skip ${label}: not on our account (${r.uploader_id ?? 'unknown uploader'})`); continue; }
    const counts = { views: r.views, likes: r.likes, comments: r.comments, shares: r.shares ?? null };
    console.log(`  ${DRY ? 'would write' : 'write'} ${label}: ${counts.views ?? '?'} views, ${counts.likes ?? '?'} likes, ${counts.comments ?? '?'} comments`);
    if (!DRY) { addMetric({ video_id: t.video_id, platform: t.platform, checkpoint: t.checkpoint, ...counts }); written++; }
  }
  if (!DRY && written) addEvent({ kind: 'note', agent: 'results_analyst', text: `Relevés des vues : ${written} enregistré(s)` });
  console.log(DRY ? 'Dry run done.' : `${written} snapshot(s) written.`);
}

main().catch((e) => { console.error(`metrics_pull failed: ${e.message}`); process.exitCode = 1; });
