// Faceless Studio promo, step 3c (2026-10-22): the Blender frames (promo_comp.py) + the narration (voice_cb.py, one WAV per
// line) + the original music (music.py, no clicks) -> the final MP4. Each line lands on its section of the real film
// (timeline.json), never on top of the previous one; the music ducks under the voice; loudness -14 LUFS.
//   node --no-warnings workshop/promo/mux.mjs <frames_dir> <timeline.json> <voice_dir> <out.mp4>
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FFMPEG, FFPROBE, KOKORO_PY } from '../../core/local-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = KOKORO_PY; // numpy only, for music.py
const INTRO = 3.5, FPS = 30;   // same as promo_comp.py

const [framesDir, timelinePath, voiceDir, out] = process.argv.slice(2);
if (!out) throw new Error('usage: mux.mjs <frames_dir> <timeline.json> <voice_dir> <out.mp4>');
const tl = JSON.parse(readFileSync(timelinePath, 'utf8'));
const E = INTRO + tl.seconds;
const HOLD = 1.2; // the last image ("FOLLOW TO WATCH IT GROW") stays while the last line ends
const total = readdirSync(framesDir).filter((f) => /^\d{5}\.jpg$/.test(f)).length / FPS + HOLD;
const at = (name, fallback) => { const s = tl.sections.find((x) => x.name === name); return s ? INTRO + s.start + 0.2 : fallback; };
// Line -> where it should start (seconds in the promo).
const plan = [0.35, INTRO + 0.2, at('research'), at('pick'), at('write'), at('draw'), at('voice'), at('check'), at('live', E + 0.2), E + 5.3, E + 6.6, E + 9.2];
const dur = (f) => Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

const lines = [];
let free = 0;
plan.forEach((want, i) => {
  const file = path.join(voiceDir, `l${String(i).padStart(2, '0')}.wav`);
  if (!existsSync(file) || want === undefined) return;
  const start = Math.max(want, free + 0.12);
  const d = dur(file);
  lines.push({ file, start, d });
  free = start + d;
});
if (free > total - 0.3) console.warn(`narration ends at ${free.toFixed(2)}s, the film at ${total.toFixed(2)}s`);

// Whooshes on the big camera moves: into the film, the flight to the outro, the portals.
const music = path.join(path.dirname(timelinePath), `${path.basename(out, '.mp4')}-music.wav`); // not in the vitrine's folder
const m = spawnSync(PY, ['-I', path.join(HERE, 'music.py'), music, String(total), [INTRO, E + 0.5, E + 3.4].map((x) => x.toFixed(2)).join(',')], { encoding: 'utf8' });
if (m.status !== 0) throw new Error(`music: ${m.stderr.slice(-400)}`);

const inputs = ['-framerate', String(FPS), '-i', path.join(framesDir, '%05d.jpg'), '-i', music, ...lines.flatMap((l) => ['-i', l.file])];
const voices = lines.map((l, i) => `[${i + 2}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(l.start * 1000)}|${Math.round(l.start * 1000)}[v${i}]`).join(';');
const filter = `${voices};${lines.map((_, i) => `[v${i}]`).join('')}amix=inputs=${lines.length}:normalize=0,apad,asplit=2[vo][key];`
  // Voice padded to the full length; the music ducks well under it ("Ten" was heard "Then"); a limiter (auto-level off) after.
  + `[1:a]volume=0.5[mus];[mus][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[duck];`
  + `[duck][vo]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=9,alimiter=limit=0.84:level=disabled[a];[0:v]tpad=stop_mode=clone:stop_duration=${HOLD}[v]`;
const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', String(total), '-movflags', '+faststart', out], { encoding: 'utf8' });
if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.slice(-600)}`);
console.log(JSON.stringify({ out, seconds: +total.toFixed(2), lines: lines.map((l) => ({ start: +l.start.toFixed(2), end: +(l.start + l.d).toFixed(2) })) }));
