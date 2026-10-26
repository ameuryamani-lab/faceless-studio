// Faceless Studio: path guard. Agents may only touch files inside the studio folder, never a .env file.
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { STUDIO_ROOT } from './db.mjs';

const ROOT = path.resolve(STUDIO_ROOT);
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

/** Resolves `p` (relative to the studio root, or absolute) and refuses anything outside the studio or naming .env. */
export function safePath(p, { mustExist = false } = {}) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('a path is required');
  if (p.includes('\0')) throw new Error('invalid path');
  if (/\.env/i.test(p)) throw new Error('paths containing ".env" are refused');
  const abs = path.resolve(ROOT, p);
  const rel = path.relative(ROOT, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`refused: ${p} is outside the studio folder`);
  if (/\.env/i.test(abs)) throw new Error('paths containing ".env" are refused');
  // Follow symlinks/junctions of the deepest existing ancestor: the real location must stay inside too.
  let probe = abs;
  while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const real = realpathSync.native(probe);
  const realRoot = realpathSync.native(ROOT);
  const realRel = path.relative(realRoot, real);
  if (norm(real) !== norm(realRoot) && (realRel.startsWith('..') || path.isAbsolute(realRel))) throw new Error(`refused: ${p} resolves outside the studio folder`);
  if (mustExist && !existsSync(abs)) throw new Error(`not found: ${p}`);
  return abs;
}

/** Path relative to the studio root with forward slashes (what goes into the DB). */
export const studioRel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

/** media/<video_id>/ for a validated video id. */
export const mediaDir = (videoId) => safePath(path.join('media', videoId));
