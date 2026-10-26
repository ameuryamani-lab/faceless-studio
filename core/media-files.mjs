// Faceless Studio: guarded text-file access inside media/<video_id>/ for the MCP tools
// read_media_file, write_media_file and list_media_files.
// Scope: one video folder only. No "..", no absolute path, no drive letter, no ":" (alternate data streams),
// no ".env", no reserved Windows names, no symlink/junction escape (realpath checked). Binary files are never
// read or written; protected render outputs (keyframes/, clips/, render/, final*) are never overwritten.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { checkVideoId } from './db.mjs';
import { safePath } from './paths.mjs';

export class MediaError extends Error {}

export const MAX_MEDIA_TEXT = 256 * 1024;
export const READ_EXTS = ['.json', '.md', '.txt', '.srt'];
export const WRITE_EXTS = ['.json', '.md', '.txt'];
const MAX_PATH = 200;
const MAX_LIST = 500;
const MAX_DEPTH = 6;
// Studio-relative media root; tests point STUDIO_MEDIA at media/_test/... (same variable as workshop/pipeline.mjs).
const MEDIA_ROOT = (process.env.STUDIO_MEDIA || 'media').replace(/\\/g, '/').replace(/\/+$/, '');

/** Who may write what (paths relative to media/<video_id>/). "x/" = anything under x/, otherwise the exact file. */
export const WRITE_ALLOWLIST = Object.freeze({
  // story.json = the video's concept format (concept/<id>/concept.json + cast.json), checked by core/guardrails/story.mjs.
  topic_editor: ['brief.json'],
  copywriter: ['script.json', 'story.json'],
  hook_auditor: ['script.json', 'story.json'],
  voice_writer: ['script.json', 'story.json'],
  fact_checker: ['script.json', 'story.json'],
  voice_director: ['sound/cues.json'],
  storyboard_artist: ['storyboard.json', 'story.json'],
  character_keeper: ['storyboard.json', 'story.json'],
  editor: ['edit/'],
  qc_inspector: ['qc-notes.md'],
  postmortem_writer: ['postmortem.md'],
  continuity_checker: ['continuity/', 'story.json'],
  animator: ['story.json'], // kept for a future motion field (Higgsfield is off; its guide is archived), 2026-10-24
});
// Made by workshop code (renders): never overwritten through MCP, whatever the allowlist says.
const PROTECTED_DIRS = ['keyframes/', 'clips/', 'render/', 'voice/', 'audio/', 'build/'];
const PROTECTED_FINAL = /^final\./i; // media/<id>/final.mp4 and friends
const PROTECTED_EXT = /\.(mp4|mov|webm|mkv|png|jpe?g|webp|gif|wav|mp3|m4a|aac|flac|ogg)$/i;
const RESERVED = /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const BAD_CHARS = /[\0-\x1f<>"|?*:]/;

const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const inside = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Validates a path relative to the video folder; returns its clean "a/b.json" form ('' = the folder itself). */
export function cleanRel(p, { allowRoot = false } = {}) {
  if (typeof p !== 'string') throw new MediaError('path must be a string');
  if (p.length > MAX_PATH) throw new MediaError(`path is longer than ${MAX_PATH} characters`);
  if (/\.env/i.test(p)) throw new MediaError('paths containing ".env" are refused');
  if (BAD_CHARS.test(p)) throw new MediaError(`refused: ${JSON.stringify(p)} contains a forbidden character (":" drive letters and alternate data streams, control characters, < > " | ? *)`);
  const s = p.replace(/\\/g, '/');
  if (s.startsWith('/')) throw new MediaError(`refused: ${p} is an absolute path; give a path relative to media/<video_id>/`);
  if (s === '' || s === '.' || s === './') {
    if (allowRoot) return '';
    throw new MediaError('a file path is required (relative to media/<video_id>/)');
  }
  const parts = s.replace(/\/+$/, '').split('/');
  for (const seg of parts) {
    if (seg === '') throw new MediaError(`refused: ${p} has an empty path segment`);
    if (seg === '.' || seg === '..') throw new MediaError(`refused: ${p} uses "${seg}"; paths must stay inside media/<video_id>/`);
    if (/[. ]$/.test(seg)) throw new MediaError(`refused: "${seg}" ends with a dot or a space`);
    if (RESERVED.test(seg)) throw new MediaError(`refused: "${seg}" is a reserved Windows name`);
  }
  return parts.join('/');
}

/** media/<video_id>/ resolved (and created on demand), with its real location checked. */
function videoDir(videoId, { create = false } = {}) {
  const id = checkVideoId(videoId);
  if (!id) throw new MediaError('video_id is required');
  const abs = safePath(`${MEDIA_ROOT}/${id}`);
  if (create) mkdirSync(abs, { recursive: true });
  if (!existsSync(abs)) throw new MediaError(`no media folder for ${id} yet`);
  const rootReal = realpathSync.native(safePath(MEDIA_ROOT));
  const real = realpathSync.native(abs);
  if (norm(path.dirname(real)) !== norm(rootReal)) throw new MediaError(`refused: media folder of ${id} resolves outside ${MEDIA_ROOT}/`);
  return { id, abs, real };
}

/** Resolves rel inside the video folder; the deepest existing ancestor's real path must stay inside too. */
function resolveIn(dir, rel) {
  const abs = rel ? path.join(dir.abs, ...rel.split('/')) : dir.abs;
  if (!inside(dir.abs, abs)) throw new MediaError(`refused: ${rel} is outside media/${dir.id}/`);
  let probe = abs;
  while (!existsSync(probe) && norm(probe) !== norm(dir.abs)) probe = path.dirname(probe);
  if (!inside(dir.real, realpathSync.native(probe))) throw new MediaError(`refused: ${rel} resolves outside media/${dir.id}/ (link)`);
  return abs;
}

const extOf = (rel) => path.posix.extname(rel).toLowerCase();

/** Reads a text file (.json pretty-printed). */
export function readMediaFile({ video_id, path: p }) {
  const dir = videoDir(video_id);
  const rel = cleanRel(p);
  const ext = extOf(rel);
  if (!READ_EXTS.includes(ext)) throw new MediaError(`only ${READ_EXTS.join(', ')} files can be read (use list_media_files for images and videos)`);
  const abs = resolveIn(dir, rel);
  if (!existsSync(abs)) throw new MediaError(`not found: media/${dir.id}/${rel}`);
  const st = statSync(abs);
  if (!st.isFile()) throw new MediaError(`media/${dir.id}/${rel} is not a file`);
  if (st.size > MAX_MEDIA_TEXT) throw new MediaError(`media/${dir.id}/${rel} is larger than 256 KB`);
  const raw = readFileSync(abs, 'utf8').replace(/^﻿/, '');
  const base = { path: rel, size: st.size, modified: st.mtime.toISOString() };
  if (ext !== '.json') return { ...base, text: raw };
  try {
    return { ...base, format: 'json', text: JSON.stringify(JSON.parse(raw), null, 2) };
  } catch (e) {
    throw new MediaError(`media/${dir.id}/${rel} is not valid JSON: ${e.message}`);
  }
}

export function allowedFor(agent, rel) {
  const l = rel.toLowerCase();
  return (WRITE_ALLOWLIST[agent] ?? []).some((a) => (a.endsWith('/') ? l.startsWith(a) && l.length > a.length : l === a));
}

/**
 * Checks and serialises content for rel; returns the text to write.
 * `validate(rel, parsed)` may return a list of errors (e.g. the storyboard checker).
 * Exported 2026-10-24: core/mcp-server.mjs write_cast_file reuses it for concept/<active>/cast.json (same size limit,
 * same JSON parse, same "refused by its checker" wording), so a cast file is prepared exactly like a media file.
 */
export function prepareContent(rel, content, validate) {
  if (typeof content !== 'string') throw new MediaError('content must be a string (JSON as text for .json files)');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_MEDIA_TEXT) throw new MediaError(`content is ${Math.ceil(bytes / 1024)} KB; the limit is 256 KB`);
  if (extOf(rel) !== '.json') return content.endsWith('\n') ? content : `${content}\n`;
  let parsed;
  try { parsed = JSON.parse(content); } catch (e) { throw new MediaError(`content is not valid JSON: ${e.message}`); }
  const errs = validate?.(rel, parsed) ?? [];
  if (errs.length) throw new MediaError(`${rel} refused by its checker: ${errs.slice(0, 10).join('; ')}`);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/** Writes a text file atomically (tmp + rename) after the allowlist and protection checks. */
export function writeMediaFile({ agent, video_id, path: p, content }, { validate } = {}) {
  const rel = cleanRel(p);
  const l = rel.toLowerCase();
  if (PROTECTED_DIRS.some((d) => l.startsWith(d)) || PROTECTED_FINAL.test(l) || PROTECTED_EXT.test(l)) {
    throw new MediaError(`refused: ${rel} is a protected render file (keyframes/, clips/, render/, final renders, images, video, audio)`);
  }
  if (!WRITE_EXTS.includes(extOf(rel))) throw new MediaError(`only ${WRITE_EXTS.join(', ')} files can be written`);
  if (!allowedFor(agent, rel)) {
    const mine = WRITE_ALLOWLIST[agent];
    throw new MediaError(`refused: ${agent} may not write ${rel}${mine ? ` (allowed: ${mine.join(', ')})` : ' (this agent writes no media files)'}`);
  }
  const text = prepareContent(rel, content, validate);
  const dir = videoDir(video_id, { create: true });
  const abs = resolveIn(dir, rel);
  if (existsSync(abs)) {
    const st = lstatSync(abs);
    if (st.isSymbolicLink() || !st.isFile()) throw new MediaError(`refused: media/${dir.id}/${rel} exists and is not a plain file`);
  }
  mkdirSync(path.dirname(abs), { recursive: true });
  resolveIn(dir, rel); // re-check after creating parent folders
  writeAtomicText(abs, text);
  return { saved: true, path: rel, bytes: Buffer.byteLength(text, 'utf8') };
}

/** Writes text through a temp file in the same folder and a rename: a reader never sees a half-written file.
 *  2026-10-24: pulled out of writeMediaFile so write_cast_file (core/mcp-server.mjs) writes cast.json the same way. */
export function writeAtomicText(abs, text) {
  mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' });
    renameSync(tmp, abs);
  } catch (e) {
    rmSync(tmp, { force: true }); // our own temp file only
    throw e;
  }
}

// Added 2026-10-20 for compare_to_reference: images and clips are never opened by Node, only located for the checker.
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
export const CLIP_EXTS = ['.mp4'];
const MAX_MEDIA_BINARY = 500 * 1024 * 1024;

/** Absolute path of an existing keyframe or clip under media/<video_id>/ (same guards as the text files). */
export function resolveMediaBinary({ video_id, path: p }) {
  const dir = videoDir(video_id);
  const rel = cleanRel(p);
  const ext = extOf(rel);
  if (![...IMAGE_EXTS, ...CLIP_EXTS].includes(ext)) throw new MediaError(`only ${[...IMAGE_EXTS, ...CLIP_EXTS].join(', ')} files can be compared`);
  const abs = resolveIn(dir, rel);
  if (!existsSync(abs)) throw new MediaError(`not found: media/${dir.id}/${rel}`);
  const st = lstatSync(abs);
  if (st.isSymbolicLink() || !st.isFile()) throw new MediaError(`media/${dir.id}/${rel} is not a plain file`);
  if (st.size > MAX_MEDIA_BINARY) throw new MediaError(`media/${dir.id}/${rel} is larger than 500 MB`);
  if (!inside(dir.real, realpathSync.native(abs))) throw new MediaError(`refused: ${rel} resolves outside media/${dir.id}/ (link)`);
  return { id: dir.id, rel, abs, kind: IMAGE_EXTS.includes(ext) ? 'image' : 'video' };
}

/** Lists files (name, size, modified) under media/<video_id>/[dir], metadata only, links not followed. */
export function listMediaFiles({ video_id, dir: d = '' }) {
  const vd = videoDir(video_id);
  const rel = cleanRel(d ?? '', { allowRoot: true });
  const start = resolveIn(vd, rel);
  if (!existsSync(start)) throw new MediaError(`not found: media/${vd.id}/${rel}`);
  if (!statSync(start).isDirectory()) throw new MediaError(`media/${vd.id}/${rel} is not a folder`);
  const files = [];
  let truncated = false;
  const walk = (absDir, relDir, depth) => {
    for (const ent of readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (/\.env/i.test(ent.name) || ent.isSymbolicLink()) continue;
      const r = relDir ? `${relDir}/${ent.name}` : ent.name;
      const a = path.join(absDir, ent.name);
      if (ent.isDirectory()) { if (depth < MAX_DEPTH) walk(a, r, depth + 1); continue; }
      if (!ent.isFile() || /\.tmp$/i.test(ent.name)) continue;
      if (files.length >= MAX_LIST) { truncated = true; return; }
      const st = statSync(a);
      files.push({ path: r, size: st.size, modified: st.mtime.toISOString() });
    }
  };
  walk(start, rel, 0);
  return { video_id: vd.id, dir: rel || '.', count: files.length, truncated, files };
}
