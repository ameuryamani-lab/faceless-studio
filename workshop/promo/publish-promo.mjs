// Faceless Studio: publishes the promo film on the networks the owner names, once, through Upload-Post. Never automatic:
// only run on the owner's own order. Key and profile come from .env (core/publish-direct.mjs readEnv). Logged in data/publications-promo.jsonl (not the story publications, so the stories'
// stock, catch-up and stats never count it) and in the 60-minute gap of core/publish-direct.mjs (a 'started' journal line).
//   node --no-warnings workshop/promo/publish-promo.mjs <file.mp4> <nets: tiktok[,instagram,youtube]> "<caption>" [--dry-run]
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { STUDIO_ROOT, addEvent, closeDb } from '../../core/db.mjs';
import { JOURNAL, readEnv } from '../../core/publish-direct.mjs';

const API = 'https://api.upload-post.com/api';
const LOG = path.join(STUDIO_ROOT, 'data', 'publications-promo.jsonl');
const [file, netsArg, caption] = process.argv.slice(2);
const dryRun = process.argv.includes('--dry-run');
const nets = String(netsArg ?? '').split(',').map((n) => n.trim()).filter(Boolean);
if (!file || !existsSync(file) || !nets.length || !nets.every((n) => ['tiktok', 'instagram', 'youtube'].includes(n)) || !caption) {
  throw new Error('usage: publish-promo.mjs <file.mp4> <tiktok[,instagram,youtube]> "<caption>" [--dry-run]');
}

async function call(key, route, options = {}) {
  const r = await fetch(API + route, { ...options, headers: { Authorization: `Apikey ${key}` }, signal: AbortSignal.timeout(options.timeout || 30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`Upload-Post: ${j.message || j.error || r.status}`);
  return j;
}

async function main() {
  const env = readEnv();
  const f = new FormData();
  f.append('user', env.profile);
  for (const n of nets) f.append('platform[]', n);
  f.append('title', caption.slice(0, 2200));
  if (nets.includes('tiktok')) f.append('tiktok_title', caption.slice(0, 2200));
  if (nets.includes('instagram')) f.append('instagram_title', caption.slice(0, 2200));
  if (nets.includes('youtube')) {
    f.append('youtube_title', 'This channel runs itself #Shorts');
    f.append('youtube_description', caption);
    f.append('privacyStatus', 'public');
    f.append('selfDeclaredMadeForKids', 'false');
    f.append('containsSyntheticMedia', 'true');
  }
  f.append('is_aigc', 'true');
  f.append('privacy_level', 'PUBLIC_TO_EVERYONE');
  f.append('post_mode', 'DIRECT_POST');
  f.append('media_type', 'REELS');
  f.append('async_upload', 'true');
  if (dryRun) { console.log(JSON.stringify({ dryRun: true, key: env.key ? 'present' : 'missing', profile: env.profile, nets, file, fields: [...new Set(f.keys())], caption })); return; }
  if (!env.key) throw new Error('no Upload-Post key');
  f.append('video', new Blob([readFileSync(file)], { type: 'video/mp4' }), path.basename(file));
  const at = new Date().toISOString();
  appendFileSync(JOURNAL, JSON.stringify({ phase: 'started', at, video_id: `promo:${path.basename(file)}`, nets, promo: true }) + '\n');
  const r = await call(env.key, '/upload', { method: 'POST', body: f, timeout: 600000 });
  let results = r.results ? Object.entries(r.results).map(([platform, v]) => ({ platform, ...v })) : null;
  for (let k = 0; !results && k < 60; k++) {
    await new Promise((ok) => setTimeout(ok, 10000));
    const s = await call(env.key, `/uploadposts/status?request_id=${encodeURIComponent(r.request_id)}`).catch(() => null);
    if (s?.status === 'completed' || s?.status === 'failed') results = s.results || [];
  }
  const out = nets.map((n) => {
    const t = (results ?? []).find((x) => x.platform === n);
    return t?.success ? { reseau: n, publie: true, lien: t.url || t.post_url || null } : { reseau: n, publie: false, erreur: String(t?.error_message || t?.error || (results ? 'no answer' : 'still processing')).slice(0, 300) };
  });
  appendFileSync(LOG, JSON.stringify({ kind: 'promo', file: path.basename(file), le: at, request_id: r.request_id, reseaux: out }) + '\n');
  addEvent({ kind: 'publish', agent: 'publisher', text: `promo ${path.basename(file)} published: ${out.map((n) => `${n.reseau} ${n.publie ? n.lien : `failed (${n.erreur})`}`).join(', ')}`.slice(0, 500) });
  console.log(JSON.stringify(out));
}

main().catch((e) => { console.error(`publish-promo failed: ${e.message}`); process.exitCode = 1; }).finally(() => closeDb());
