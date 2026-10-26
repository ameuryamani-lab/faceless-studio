// Faceless Studio: word timestamps for captions, through the local faster-whisper venv (no network, cached models).
//   node workshop/transcribe.mjs <audio-or-video> [--model medium|small] [--language en] [--device cpu|cuda] [--out words.json]
// The medium model is the default (download it once into the Hugging Face cache; runs offline). CPU int8 by default.
// The request goes to Python as JSON on stdin and the answer comes back as ASCII-only JSON, so paths with spaces or
// accents and the Windows console code page cannot break it.
// The faster-whisper Python: STUDIO_WHISPER_PY (or WHISPER_PYTHON) in the environment, else "whisper_python" in
// config.local.json, else "python" on the PATH.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDIO_DIR } from '../core/local-config.mjs';

function whisperPython() {
  const fromEnv = process.env.STUDIO_WHISPER_PY || process.env.WHISPER_PYTHON;
  if (fromEnv) return fromEnv;
  const file = path.join(STUDIO_DIR, 'config.local.json');
  if (existsSync(file)) {
    try { const v = JSON.parse(readFileSync(file, 'utf8')).whisper_python; if (v) return v; } catch { /* core/local-config.mjs reports bad JSON */ }
  }
  return 'python';
}
export const PYTHON = whisperPython();
const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'whisper_words.py');

export function transcribeWords(audio, { model = 'medium', language = 'en', device = 'cpu', timeoutMs = 20 * 60_000 } = {}) {
  if (!existsSync(audio)) return Promise.reject(new Error(`no such file: ${audio}`));
  if (path.isAbsolute(PYTHON) && !existsSync(PYTHON)) return Promise.reject(new Error(`faster-whisper Python not found at ${PYTHON}`));
  return new Promise((resolve, reject) => {
    const p = spawn(PYTHON, ['-I', HELPER], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', HF_HUB_OFFLINE: '1' },
    });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('transcription timed out')); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const line = out.trim().split(/\r?\n/).pop() || '';
      let j = null;
      try { j = JSON.parse(line); } catch { /* fallthrough */ }
      if (code !== 0 || !j || j.error) return reject(new Error(`faster-whisper failed: ${j?.error || err.trim().slice(-400) || `exit ${code}`}`));
      resolve(j);
    });
    p.stdin.end(`${JSON.stringify({ audio: path.resolve(audio), model, language, device })}\n`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
  const file = argv[0];
  if (!file || file.startsWith('--')) { console.error('Usage: node workshop/transcribe.mjs <audio-or-video> [--model medium] [--language en] [--out words.json]'); process.exit(1); }
  transcribeWords(file, { model: opt('--model', 'medium'), language: opt('--language', 'en'), device: opt('--device', 'cpu') }).then((r) => {
    const text = JSON.stringify(r, null, 2);
    const out = opt('--out', null);
    if (out) writeFileSync(out, `${text}\n`, 'utf8');
    console.log(text);
  }, (e) => { console.error(e.message); process.exitCode = 1; });
}
