// Faceless Studio: ComfyUI HTTP client (local only, 127.0.0.1:8188). It never starts
// ComfyUI itself; it only talks to it when it is already running (workshop/story/make-short.mjs starts it when it is down).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(COMFY)) throw new Error('COMFY_URL must be a local address');

const WORKFLOWS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'workflows');
const POLL_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True if ComfyUI answers /system_stats within 3 s. */
export async function comfyReady() {
  try {
    const r = await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

/** Unloads models and frees VRAM/RAM (images then videos need ~55 GB of models for 32 GB of RAM). */
export async function freeComfy() {
  try {
    const r = await fetch(`${COMFY}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) });
    return r.ok;
  } catch { return false; }
}

/** Uploads to ComfyUI's input folder, shared by every chain: `name` (default the file's name) is overwritten, so a caller that may
 *  run beside another chain gives a name unique to its video (2026-10-25 review: two concepts both upload "waist-front.png"). */
export async function uploadImage(file, name = path.basename(file)) {
  const form = new FormData();
  form.append('image', new Blob([await readFile(file)], { type: 'image/png' }), name);
  form.append('overwrite', 'true');
  const r = await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`ComfyUI upload failed: ${r.status}`);
  return (await r.json()).name;
}

export async function queuePrompt(graph) {
  const r = await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'faceless-studio' }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.prompt_id) throw new Error(`ComfyUI refused the graph: ${JSON.stringify(body.node_errors || body.error || body).slice(0, 600)}`);
  return body.prompt_id;
}

/** Polls /history until the prompt finishes; returns the history entry. */
export async function waitForPrompt(promptId, { timeoutMs = 60 * 60_000, onTick } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(POLL_MS);
    const all = await fetch(`${COMFY}/history/${promptId}`).then((x) => x.json()).catch(() => ({}));
    const h = all[promptId];
    onTick?.(Math.round((Date.now() - started) / 1000));
    if (!h) continue;
    if (h.status?.status_str === 'error') {
      const msg = (h.status.messages || []).find((m) => m[0] === 'execution_error')?.[1];
      throw new Error(`ComfyUI: ${msg?.exception_message || 'unknown error'}`.slice(0, 600));
    }
    if (h.status?.completed) return h;
  }
  throw new Error('ComfyUI: job took too long');
}

/** Every output file (images, videos) listed in a history entry. */
export function outputFiles(entry) {
  return Object.values(entry.outputs || {}).flatMap((o) => Object.values(o).filter(Array.isArray).flat()).filter((x) => x?.filename);
}

export async function fetchOutput(file, dest) {
  const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' });
  const r = await fetch(`${COMFY}/view?${q}`);
  if (!r.ok) throw new Error(`ComfyUI /view failed: ${r.status}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await r.arrayBuffer()));
  return dest;
}

/** Queues a graph, waits, and copies the first output to `dest`. */
export async function runGraph(graph, dest, opts = {}) {
  const id = await queuePrompt(graph);
  const entry = await waitForPrompt(id, opts);
  const first = outputFiles(entry)[0];
  if (!first) throw new Error('ComfyUI produced nothing');
  await fetchOutput(first, dest);
  return { prompt_id: id, dest };
}

// ---------- workflows (API format JSON in workshop/workflows) ----------
export async function loadWorkflow(name) {
  return JSON.parse(await readFile(path.join(WORKFLOWS, `${name}.json`), 'utf8'));
}

/** Finds a node by its _meta.title (stable across edits of the JSON). */
function node(graph, title) {
  const n = Object.values(graph).find((x) => x?._meta?.title === title);
  if (!n) throw new Error(`workflow has no node titled "${title}"`);
  return n;
}

/** Z-Image Turbo keyframe graph. Width/height must be divisible by 16 (1088x1920 is scaled to 1080x1920 later). */
export async function keyframeGraph({ prompt, seed, width = 1088, height = 1920, steps = 8, prefix = 'faceless/keyframe' }) {
  if (width % 16 || height % 16) throw new Error('keyframe size must be divisible by 16');
  const g = await loadWorkflow('zimage-keyframe');
  node(g, 'prompt').inputs.text = prompt;
  Object.assign(node(g, 'size').inputs, { width, height });
  Object.assign(node(g, 'sampler').inputs, { seed, steps });
  node(g, 'save').inputs.filename_prefix = prefix;
  return g;
}

/** Z-Image Turbo img2img: an uploaded image (see uploadImage) is VAE-encoded and re-noised by `denoise` (0-1). */
export async function img2imgGraph({ image, prompt, seed, denoise = 0.55, steps = 9, prefix = 'faceless/img2img' }) {
  if (!(denoise > 0 && denoise <= 1)) throw new Error('denoise must be in (0, 1]');
  const g = await loadWorkflow('zimage-img2img');
  node(g, 'source image').inputs.image = image;
  node(g, 'prompt').inputs.text = prompt;
  Object.assign(node(g, 'sampler').inputs, { seed, steps, denoise });
  node(g, 'save').inputs.filename_prefix = prefix;
  return g;
}

/** Z-Image Turbo, the noise limited to the white part of `mask` (an uploaded grey PNG, see uploadImage) at full strength: the rest of
 *  `image` is kept and the model paints the masked part to fit it (2026-10-25, the place around the hero of a cast sheet). */
export async function paintAroundGraph({ image, mask, prompt, seed, steps = 9, prefix = 'faceless/paint' }) {
  const g = await img2imgGraph({ image, prompt, seed, denoise: 1, steps, prefix });
  g.mask = { class_type: 'LoadImageMask', _meta: { title: 'mask' }, inputs: { image: mask, channel: 'red' } };
  g.masked = { class_type: 'SetLatentNoiseMask', _meta: { title: 'noise mask' }, inputs: { samples: node(g, 'sampler').inputs.latent_image, mask: ['mask', 0] } };
  node(g, 'sampler').inputs.latent_image = ['masked', 0];
  return g;
}

/** Wan 2.2 i2v with lightx2v 4-step LoRAs: high-noise model for the first half of the steps, low-noise for the rest. */
export const WAN_FPS = 16;
export const wanFrames = (seconds) => Math.max(17, Math.min(81, Math.round((seconds * WAN_FPS) / 4) * 4 + 1)); // 4k+1, 1-5 s
export async function clipGraph({ image, prompt, negative = '', seed, seconds = 4, width = 720, height = 1280, steps = 4, prefix = 'faceless/clip' }) {
  if (width % 16 || height % 16) throw new Error('clip size must be divisible by 16');
  const g = await loadWorkflow('wan22-i2v-4step');
  node(g, 'start image').inputs.image = image;
  node(g, 'prompt').inputs.text = prompt;
  node(g, 'negative').inputs.text = negative;
  Object.assign(node(g, 'image to video').inputs, { width, height, length: wanFrames(seconds) });
  const half = Math.floor(steps / 2);
  Object.assign(node(g, 'sampler high noise').inputs, { noise_seed: seed, steps, start_at_step: 0, end_at_step: half });
  Object.assign(node(g, 'sampler low noise').inputs, { noise_seed: seed, steps, start_at_step: half, end_at_step: 10000 });
  node(g, 'create video').inputs.fps = WAN_FPS;
  node(g, 'save').inputs.filename_prefix = prefix;
  return g;
}
