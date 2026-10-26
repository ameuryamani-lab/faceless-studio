// Faceless Studio: where the local tools live on THIS computer. Every path comes from, in order: an environment variable, the file
// config.local.json at the studio root (yours, never committed; copy config.example.json), else a default that works when the tool
// is on the PATH or in the usual folder. Code never writes a personal path itself: it imports these.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STUDIO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(STUDIO_DIR, 'config.local.json');
let local = {};
if (existsSync(file)) {
  try { local = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`config.local.json is not valid JSON: ${e.message}`); }
}
const pick = (envName, key, fallback) => process.env[envName] || local[key] || fallback;

/** ComfyUI portable folder (contains ComfyUI/ and python_embeded/). */
export const COMFY_HOME = pick('STUDIO_COMFY_HOME', 'comfy_home', path.join(STUDIO_DIR, '..', 'ComfyUI_windows_portable'));
/** ComfyUI's own Python (numpy, scipy, Pillow), used by the image helpers. */
export const COMFY_PY = pick('STUDIO_COMFY_PY', 'comfy_python', path.join(COMFY_HOME, 'python_embeded', 'python.exe'));
/** The Python environment where Kokoro (the narrator voice) is installed. */
export const KOKORO_PY = pick('STUDIO_KOKORO_PY', 'kokoro_python', 'python');
/** ffmpeg and ffprobe (on the PATH by default). */
export const FFMPEG = pick('STUDIO_FFMPEG', 'ffmpeg', 'ffmpeg');
export const FFPROBE = pick('STUDIO_FFPROBE', 'ffprobe', FFMPEG.replace(/ffmpeg(\.exe)?$/i, (m, ext) => `ffprobe${ext ?? ''}`));
/** Node.js used to start the studio's scripts (the one running now by default). */
export const NODE = pick('STUDIO_NODE', 'node', process.execPath);
/** Blender, only for rebuilding the 3D room's models (optional). */
export const BLENDER = pick('STUDIO_BLENDER', 'blender', 'blender');

// The studio time zone (IANA name, e.g. "Europe/Paris"): the publication slots, quiet hours, "today" and every clock shown in the
// vitrine use it. Order: STUDIO_TIMEZONE, config.local.json "timezone", core/daily.json "timezone" (older installs), else this PC's zone.
const dailyZone = () => {
  try { return JSON.parse(readFileSync(path.join(STUDIO_DIR, 'core', 'daily.json'), 'utf8')).timezone; } catch { return undefined; }
};
const pcZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
function resolveZone() {
  const wanted = process.env.STUDIO_TIMEZONE || local.timezone || dailyZone();
  if (!wanted) return pcZone();
  try { return new Intl.DateTimeFormat('en-US', { timeZone: String(wanted) }).resolvedOptions().timeZone; }
  catch { throw new Error(`"${wanted}" is not a time zone (STUDIO_TIMEZONE or config.local.json "timezone"; use an IANA name such as "Europe/Paris")`); }
}
/** The studio time zone, e.g. "Africa/Algiers" or "Europe/Paris". */
export const TIMEZONE = resolveZone();
