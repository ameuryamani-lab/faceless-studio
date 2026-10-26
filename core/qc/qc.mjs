// Faceless Studio QC: technical checks of a finished vertical video before it can be offered for approval.
//   node core/qc/qc.mjs <video.mp4> [--json-out report.json]
// Checks: 1080x1920, 30 fps, 5-60 s, integrated loudness -14 +/- 1 LUFS, true peak <= -1 dBTP, black segments,
// frozen segments, black first frame. Prints a JSON report; exit code 0 = pass, 2 = fail, 1 = could not run.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FFMPEG as FFMPEG_BIN, FFPROBE as FFPROBE_BIN } from '../local-config.mjs';

// FFMPEG_DIR (a folder holding ffmpeg.exe and ffprobe.exe) still overrides; otherwise core/local-config.mjs decides.
export const FFMPEG_DIR = process.env.FFMPEG_DIR || '';
export const FFMPEG = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffmpeg.exe') : FFMPEG_BIN;
export const FFPROBE = FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffprobe.exe') : FFPROBE_BIN;

export const QC_RULES = Object.freeze({
  width: 1080, height: 1920, fps: 30, fpsTolerance: 0.01,
  minSeconds: 5, maxSeconds: 60,
  targetLufs: -14, lufsTolerance: 1, maxTruePeak: -1,
  blackMinSeconds: 0.5,       // a black segment this long (or longer) fails
  blackPixelThreshold: 0.10,  // blackdetect pix_th
  freezeMinSeconds: 2,        // a frozen segment this long fails (stills in AI clips are often ~1 s)
  freezeNoise: '-60dB',
  firstFrameMaxLuma: 20,      // YAVG (0-255) under this = black first frame
});

/** Runs a binary, collects stdout and stderr. Never uses a shell. */
export function run(bin, args, { timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error(`${path.basename(bin)} timed out`)); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

const fraction = (s) => { const [a, b] = String(s || '0/1').split('/').map(Number); return b ? a / b : a; };

export async function probe(file) {
  const r = await run(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  if (r.code !== 0) throw new Error(`ffprobe failed: ${r.err.trim().slice(0, 300)}`);
  const j = JSON.parse(r.out);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return {
    width: v?.width ?? null, height: v?.height ?? null,
    fps: v ? Math.round(fraction(v.avg_frame_rate || v.r_frame_rate) * 1000) / 1000 : null,
    duration: Number(j.format?.duration ?? v?.duration ?? 0),
    videoCodec: v?.codec_name ?? null, audioCodec: a?.codec_name ?? null, hasAudio: !!a,
  };
}

/** One decoding pass: loudnorm (I, TP), blackdetect, freezedetect. */
export async function analyse(file, info, rules = QC_RULES) {
  const args = ['-hide_banner', '-nostats', '-i', file,
    '-vf', `blackdetect=d=0.05:pix_th=${rules.blackPixelThreshold},freezedetect=n=${rules.freezeNoise}:d=${Math.min(1, rules.freezeMinSeconds)}`];
  if (info.hasAudio) args.push('-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json');
  args.push('-f', 'null', '-');
  const r = await run(FFMPEG, args);
  if (r.code !== 0) throw new Error(`ffmpeg analysis failed: ${r.err.trim().slice(-300)}`);
  const black = [...r.err.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)].map((m) => ({ start: +m[1], end: +m[2], duration: +m[3] }));
  const freezes = [];
  let open = null;
  for (const line of r.err.split(/\r?\n/)) {
    let m = /freeze_start: ([\d.]+)/.exec(line); if (m) open = { start: +m[1] };
    m = /freeze_duration: ([\d.]+)/.exec(line); if (m && open) open.duration = +m[1];
    m = /freeze_end: ([\d.]+)/.exec(line); if (m && open) { freezes.push({ ...open, end: +m[1] }); open = null; }
  }
  if (open) freezes.push({ ...open, end: info.duration, duration: info.duration - open.start }); // frozen until the end
  let loud = null;
  if (info.hasAudio) {
    const i = r.err.lastIndexOf('{');
    const j = JSON.parse(r.err.slice(i, r.err.indexOf('}', i) + 1));
    loud = { integrated: Number(j.input_i), truePeak: Number(j.input_tp), lra: Number(j.input_lra) };
  }
  return { black, freezes, loud };
}

export async function firstFrameLuma(file) {
  const r = await run(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-']);
  const m = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(r.err);
  return m ? Number(m[1]) : null;
}

export async function qc(file, rules = QC_RULES) {
  const info = await probe(file);
  const { black, freezes, loud } = await analyse(file, info, rules);
  const luma = await firstFrameLuma(file);
  const checks = [];
  const add = (name, pass, value, expected) => checks.push({ name, pass: !!pass, value, expected });
  add('resolution', info.width === rules.width && info.height === rules.height, `${info.width}x${info.height}`, `${rules.width}x${rules.height}`);
  add('fps', info.fps !== null && Math.abs(info.fps - rules.fps) <= rules.fpsTolerance, info.fps, rules.fps);
  add('duration', info.duration >= rules.minSeconds && info.duration <= rules.maxSeconds, Math.round(info.duration * 100) / 100, `${rules.minSeconds}-${rules.maxSeconds} s`);
  add('audio_present', info.hasAudio, info.audioCodec, 'an audio stream');
  add('loudness_integrated', loud && Math.abs(loud.integrated - rules.targetLufs) <= rules.lufsTolerance, loud?.integrated ?? null, `${rules.targetLufs} +/- ${rules.lufsTolerance} LUFS`);
  add('true_peak', loud && loud.truePeak <= rules.maxTruePeak, loud?.truePeak ?? null, `<= ${rules.maxTruePeak} dBTP`);
  const longBlack = black.filter((b) => b.duration >= rules.blackMinSeconds);
  add('black_segments', longBlack.length === 0, longBlack, `no black segment >= ${rules.blackMinSeconds} s`);
  const longFreeze = freezes.filter((f) => f.duration >= rules.freezeMinSeconds);
  add('frozen_segments', longFreeze.length === 0, longFreeze, `no frozen segment >= ${rules.freezeMinSeconds} s`);
  add('first_frame_not_black', luma !== null && luma >= rules.firstFrameMaxLuma, luma, `YAVG >= ${rules.firstFrameMaxLuma}`);
  return { file: path.resolve(file), at: new Date().toISOString(), pass: checks.every((c) => c.pass), failed: checks.filter((c) => !c.pass).map((c) => c.name), info, checks };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const file = process.argv[2];
  const outIdx = process.argv.indexOf('--json-out');
  if (!file || !existsSync(file)) { console.error('Usage: node core/qc/qc.mjs <video.mp4> [--json-out report.json]'); process.exit(1); }
  try {
    const report = await qc(file);
    const text = JSON.stringify(report, null, 2);
    if (outIdx > -1 && process.argv[outIdx + 1]) writeFileSync(process.argv[outIdx + 1], `${text}\n`, 'utf8');
    console.log(text);
    process.exitCode = report.pass ? 0 : 2;
  } catch (e) {
    console.error(`QC could not run: ${e.message}`);
    process.exitCode = 1;
  }
}
