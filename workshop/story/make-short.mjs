// Faceless Studio, narrated storybook format (read aloud like a picture book).
// One story JSON (concept/test-short/story.json shape) -> a 1080x1920 Short in media/<id>/final.mp4:
//   images  Z-Image Turbo stills, one per scene, hero lock + style (image_artist), img2img from the hero's cast sheet
//   voice   Kokoro narration, one clip per scene (voice_director); the narrator is the VIDEO's concept voice
//           (concept/<story.concept>/concept.json voice.id, 2026-10-24); the voice used is kept in audio/voice.txt
//   words   faster-whisper word timestamps -> captions of 1-3 words, large (voice_writer)
//   motion  slow Ken Burns per still, zoom in / out alternating (animator)
//   edit    concat, narration, loudness -14 LUFS, burned captions (editor), then core/qc (qc_inspector)
// Each step lights its agent in the vitrine (core/db.mjs setAgent) and is skipped when its files exist (resumable).
// The concept is a parameter: nothing about the show is written here any more. Voice, speed, framing
// sentences, hands rule, "always" clause, img2img denoise/steps and the cast sheets come from core/concept.mjs for the
// concept OF THIS VIDEO (story.json "concept"; an older story.json belongs to concept/active.json "legacy"), so a
// --redo on the stock keeps its own voice and look even after the active concept changes.
//   node --no-warnings workshop/story/make-short.mjs <story.json> [--redo images,voice,words,motion] [--scenes 3,10]
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDIO_ROOT, addEvent, closeDb, isRehearsal, setAgent, upsertVideo } from '../../core/db.mjs';
import { clarityPassed } from '../../core/clarity.mjs';
import { FFMPEG, FFPROBE, qc, run } from '../../core/qc/qc.mjs';
import { comfyReady, img2imgGraph, keyframeGraph, paintAroundGraph, runGraph, uploadImage } from '../comfy.mjs';
import { FRAMINGS, POSES, VIEWS, castLock, castSheet, conceptOf, loadConcept, placePrompt } from '../../core/concept.mjs';
// Tool paths (core/local-config.mjs): Kokoro's Python, ComfyUI's folder and its embedded Python (numpy, scipy, Pillow for
// sheet_scene.py); the faster-whisper Python comes from workshop/transcribe.mjs.
import { COMFY_HOME, COMFY_PY, KOKORO_PY } from '../../core/local-config.mjs';
import { PYTHON as WHISPER_PY } from '../transcribe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = 1080, H = 1920, FPS = 30;
const GAP_S = 0.35;          // silence after each scene's line
const MIN_SCENE_S = 3.5;     // a still stays at least this long
const ZOOM = 0.10;           // Ken Burns: 10 % over the scene
const VOICE_MATCH_MIN = 0.6; // share of a line's words whisper must hear back (words.py match_ratio), else the voice is redone
const pad = (n) => String(n).padStart(2, '0');

// ---------- the video's concept, framing and the hero's cast sheet ----------
/** The concept of THIS video: story.json "concept" first (the file in memory), else conceptOf(id) (an old story.json without
 *  the field = active.json "legacy"), else the active concept (a story.json outside media/, such as a test). Throws the
 *  French error of loadConcept when the concept folder is faulty: chain.mjs checks it before spawning this script. */
function conceptFor(story) {
  if (typeof story.concept === 'string' && story.concept.trim()) return loadConcept(story.concept.trim());
  return conceptOf(story.id) ?? loadConcept();
}
// 2026-10-22: 45 of the last 50 stills showed the hero full body and small, hands tiny or raised oddly. Default framing is
// waist-up, scene 1 a close shot, a full-body shot only when the scene asks for it. The sentences themselves are the concept's
// (c.prompt.framing / c.prompt.hands, concept/<id>/concept.json; the "never key prop" lesson is in its rules.md).
// 2026-10-24: a scene may carry shot {framing, view, pose} (storyboard_artist); framingOf() stays the fallback for the
// 29 story.json made before that field existed, and for a shot value outside the known lists (checkStory refuses those upstream).
function framingOf(image, index) {
  // scene 1, or a scene that asks for a close-up ("Medium close-up, waist-up" is the default waist shot, not a close-up)
  if (index === 0 || (/\bclose[- ]?up\b/i.test(image) && !/\bmedium close[- ]?up\b|\bwaist/i.test(image))) return 'closeup';
  if (/\b(full[- ]body|wide shot|whole room|from far)\b/i.test(image)) return 'full';
  return 'waist';
}
function shotOf(s, index) {
  const shot = s.shot && typeof s.shot === 'object' ? s.shot : {};
  return {
    framing: FRAMINGS.includes(shot.framing) ? shot.framing : framingOf(s.image, index),
    view: VIEWS.includes(shot.view) ? shot.view : 'front',
    pose: POSES.includes(shot.pose) ? shot.pose : 'standing',
  };
}
// 2026-10-24 (review H5): the forced "hands relaxed or holding the prop" phrase fought descriptions that hide the hands.
const HANDS_HIDDEN = /hands? (out of (the )?frame|in (her )?pockets|behind (her )?back|hidden)/i;
const relPath = (f) => path.relative(STUDIO_ROOT, f).split(path.sep).join('/');

// ---------- the hero pasted from her sheet, the place painted around her (2026-10-25) ----------
// Goal: the same hero AND a rich place. img2img from the sheet kept the hero but also the
// sheet's empty paper (pale places, r-20261025-0012); drawing from text gave rich places and a hero who changed. With
// concept.json image.paint_around: the sheet's paper is masked (sheet_scene.py), ComfyUI paints only the place there, the hero is
// pasted back pixel for pixel, and a light img2img (image.blend_denoise) blends light and edges. Trial of 25/10: 5 scenes of
// r-20261025-0012, the place prompt WITH the hero's action drew a second hero behind her, hence scenes[].place (storyboard_artist).
// Rehearsal r-20261025-1518: on the centred pose sheets the object was drawn behind the hero and covered when the hero was pasted back, so the
// sheet is first reduced to LAYOUT_SCALE and set bottom-right (free band on the left, where the concept rules put the object).
// A scene without `place` is drawn from text (the code review of 25/10: cutting the image text lost the object or the whole place).
const SHEET_SCENE_PY = path.join(HERE, 'sheet_scene.py');
// The sheet's share of the frame per framing, so about a third of the width is free on the left (r-20261025-1518 redraws: waist
// sheets fill ~60 % of the width, full ones ~45 %). Never smaller: a smaller hero reads as too far away. A close-up sheet is expected to be laid out
// already (set right, shoulders completed): reducing a close-up whose shoulders touch the frame shows the cut outfit inside the picture.
const LAYOUT_SCALE = { closeup: 1, waist: 0.8, full: 0.9 };
const placeOf = (s) => (typeof s.place === 'string' ? s.place.trim() : '');
/** Draws one still with the hero of `ref` (a cast sheet on plain paper) kept as drawn; work files in scenes/_paint/. */
async function paintAround({ c, story, s, shot, ref, prompt, seed, out, prefix }) {
  const work = path.join(path.dirname(out), '_paint');
  mkdirSync(work, { recursive: true });
  const f = (k) => path.join(work, `${story.id}-${path.basename(out, '.png')}-${k}.png`); // unique names: ComfyUI's input folder is shared
  await sh(COMFY_PY, ['-I', SHEET_SCENE_PY, 'prepare', ref, f('layout'), f('repaint'), f('keep'), String(LAYOUT_SCALE[shot.framing] ?? LAYOUT_SCALE.waist)]);
  // A white bubble appeared behind the hero: the place was painted with story.style,
  // which describes a character (dot eyes, tiny mouth, flat colours on the character), and with "only one person in the picture":
  // the model drew a white creature or a white bubble behind the hero. Same seed and layout with
  // the place words only: no creature. core/concept.mjs placePrompt: the place, a named cast member and how she is painted, the
  // palette without its "no …" clauses, placeStyle(c).
  await runGraph(await paintAroundGraph({ image: await uploadImage(f('layout')), mask: await uploadImage(f('repaint')), prompt: placePrompt(c, story, s), seed, steps: c.image.steps, prefix }), f('painted'));
  await sh(COMFY_PY, ['-I', SHEET_SCENE_PY, 'paste', f('painted'), f('layout'), f('keep'), f('pasted')]);
  await runGraph(await img2imgGraph({ image: await uploadImage(f('pasted')), prompt, seed, denoise: c.image.blend_denoise, steps: c.image.steps, prefix }), out);
}

function sh(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, ...opts });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exit ${code}: ${(err || out).slice(-400)}`))));
  });
}

/** Who gets the work next, and what the order card says (the vitrine shows the orders passing from agent to agent). */
const NEXT = {
  image_artist: ['voice_director', 'Images faites : la voix'],
  voice_director: ['voice_writer', 'Voix faite : les sous-titres'],
  voice_writer: ['animator', 'Sous-titres faits : le mouvement'],
  animator: ['editor', 'Mouvement fait : le montage'],
  editor: ['qc_inspector', 'Montage fait : le contrôle'],
};
const REDO_RUN = process.argv.includes('--redo'); // a re-voice sweep is not a new video: no order cards

async function step(agent, task, videoId, fn) {
  setAgent(agent, { state: 'working', task, video_id: videoId, text: task });
  try {
    const r = await fn();
    setAgent(agent, { state: 'idle', video_id: videoId, text: `${task} : terminé` });
    // Right after run_end: the room then sends the card on to the next desk instead of back to the Chief.
    if (NEXT[agent] && !REDO_RUN) addEvent({ kind: 'handoff', agent, to_agent: NEXT[agent][0], video_id: videoId, text: NEXT[agent][1] });
    return r;
  } catch (e) {
    setAgent(agent, { state: 'error', task: e.message.slice(0, 180), video_id: videoId, text: `${task} : échec (${e.message.slice(0, 200)})` });
    throw e;
  }
}

const TARGET_LUFS = -14;
/**
 * One-pass loudnorm can land a voice 1 LU off (bf_emma came out at -15.2, QC allows ±1): measure the final cut and, when it
 * is more than 0.3 LU off, apply the exact gain to the audio only (the picture is copied, not re-encoded).
 */
async function fixLoudness(file) {
  const m = await run(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  const json = /\{[\s\S]*"input_i"[\s\S]*\}/.exec(m.err)?.[0];
  const measured = json ? Number(JSON.parse(json).input_i) : NaN;
  if (!Number.isFinite(measured) || Math.abs(measured - TARGET_LUFS) <= 0.3) return;
  const gain = (TARGET_LUFS - measured).toFixed(2);
  const tmp = file.replace(/\.mp4$/, '.gain.mp4');
  // limit 0.7 (-3.1 dBFS sample peak): AAC adds inter-sample peaks; 0.79 came out at -0.86 dBTP (QC limit -1).
  const r = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-c:v', 'copy', '-af', `volume=${gain}dB,alimiter=limit=0.7:level=disabled`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', tmp]);
  if (r.code !== 0) throw new Error(`loudness fix: ${r.err.slice(-200)}`);
  renameSync(tmp, file);
}

/** 540x960 JPEG cover for the vitrine wall, from a still or from a video frame at `at` seconds. Never fails the render. */
async function writeCover(src, dest, at = null) {
  const r = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...(at ? ['-ss', String(at)] : []), '-i', src, '-frames:v', '1', '-vf', 'scale=540:960', '-q:v', '3', dest]);
  if (r.code !== 0) console.error(`cover not written: ${r.err.slice(-200)}`);
}

const duration = async (file) => Number((await sh(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])).trim());

/** Groups words into captions of 1-3 words, cut at punctuation, never longer than ~14 characters per caption. */
export function captionGroups(words) {
  const groups = [];
  let cur = [];
  const flush = () => { if (cur.length) groups.push({ text: cur.map((w) => w.w).join(' '), s: cur[0].s, e: cur.at(-1).e }); cur = []; };
  for (const w of words) {
    cur.push(w);
    const len = cur.map((x) => x.w).join(' ').length;
    if (cur.length >= 3 || len >= 14 || /[.,!?;:]$/.test(w.w)) flush();
  }
  flush();
  return groups;
}

const assTime = (t) => { const cs = Math.max(0, Math.round(t * 100)); const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60; return `${h}:${pad(m)}:${pad(s)}.${pad(cs % 100)}`; };
const assEscape = (s) => s.replace(/[{}\\]/g, '').toUpperCase();

function assFile(captions) {
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Cap,Arial Black,96,&H00FFFFFF,&H00FFFFFF,&H00201010,&H64000000,1,0,0,0,100,100,0,0,1,7,3,2,80,80,520,1',
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = captions.map((c) => `Dialogue: 0,${assTime(c.s)},${assTime(c.e)},Cap,,0,0,0,,{\\fad(60,60)}${assEscape(c.text)}`);
  return [...head, ...lines, ''].join('\r\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const storyFile = path.resolve(argv[0] ?? '');
  if (!existsSync(storyFile)) throw new Error('usage: make-short.mjs <story.json>');
  const redo = new Set(argv.includes('--redo') ? argv[argv.indexOf('--redo') + 1].split(',') : []);
  // --scenes 3,10 (2026-10-24): limits "--redo images" to those scenes (the clarity check refused them); their stills get a new
  // seed and only their clips are rebuilt, then the video is assembled and checked again.
  const only = argv.includes('--scenes') ? new Set(argv[argv.indexOf('--scenes') + 1].split(',').map((x) => Number(x)).filter((x) => x >= 1)) : null;
  const redoScene = (i) => redo.has('images') && (!only || only.has(i + 1));
  const story = JSON.parse(readFileSync(storyFile, 'utf8'));
  const id = story.id;
  const c = conceptFor(story);
  // The concept's narrator always wins over the voice written in an older story.json; it is the concept OF THIS VIDEO, so a
  // --redo voice on the stock keeps its voice after the active concept changes (2026-10-24).
  const voice = c.voice.id;
  const speed = c.voice.speed ?? story.speed ?? 1;
  const voiceFile = path.join(STUDIO_ROOT, 'media', story.id, 'audio', 'voice.txt');
  if (existsSync(voiceFile) && readFileSync(voiceFile, 'utf8').trim() !== voice) for (const r of ['voice', 'words', 'motion']) redo.add(r);
  const dir = path.join(STUDIO_ROOT, 'media', id);
  for (const d of ['scenes', 'audio', 'clips']) mkdirSync(path.join(dir, d), { recursive: true });
  upsertVideo({ id, topic: story.title, lane: isRehearsal(id) ? 'repetition' : 'story', status: 'storyboarded' });
  const scenes = story.scenes;

  await step('image_artist', `Images : ${scenes.length} scènes`, id, async () => {
    // 2026-10-23: after a PC restart ComfyUI was down and the 2-a-day chain would have failed here; start it hidden and wait.
    if (!(await comfyReady())) {
      // python directly (the .bat ends with "pause" and died when started hidden through cmd).
      spawn(COMFY_PY, ['-s', 'ComfyUI\\main.py', '--windows-standalone-build', '--disable-auto-launch'], { cwd: COMFY_HOME, detached: true, stdio: 'ignore', windowsHide: true }).unref();
      for (let t = 0; t < 180 && !(await comfyReady()); t += 5) await new Promise((r) => setTimeout(r, 5000));
    }
    if (!(await comfyReady())) throw new Error('ComfyUI is not running on 127.0.0.1:8188');
    for (const [i, s] of scenes.entries()) {
      const out = path.join(dir, 'scenes', `${pad(i + 1)}.png`);
      if (existsSync(out) && !redoScene(i)) continue;
      // Hero too far and odd hands otherwise: the framing comes first, then the hero lock and the
      // concept's "always" clause (e.g. the outfit keeps its colour); the scene starts from the hero's cast sheet that matches its
      // shot (core/concept.mjs castSheet: declared view, <pose>-<framing>, <framing>-<view>, <framing>-front, else text-to-image).
      // A named secondary (scenes[].cast[0]) adds its lock sentence; Z-Image takes ONE source image, so the secondary is held by
      // its text, not by its sheet (conception G).
      const shot = shotOf(s, i);
      // 2026-10-24: img2img from the sheet keeps the hero but drops the scene's object (r-20261024-2234: a chair never drawn in 5
      // scenes). concept.json image.use_sheet = false (or STUDIO_NO_REF=1 for a trial) draws from text only, hero_lock in the prompt.
      // 2026-10-25: with image.paint_around the sheet's hero is pasted and scenes[].place painted around her (paintAround); a scene
      // without place is drawn from text, never painted from an empty place.
      const sheet = process.env.STUDIO_NO_REF === '1' || c.image?.use_sheet === false ? null : castSheet(c, c.hero, shot);
      const paint = Boolean(sheet) && c.image.paint_around === true;
      const ref = paint && !placeOf(s) ? null : sheet;
      if (paint && !ref) addEvent({ kind: 'note', agent: 'image_artist', video_id: id, text: `Scène ${i + 1} sans « lieu » : dessinée depuis le texte` });
      const from = ref ? relPath(ref) : null;
      setAgent('image_artist', { state: 'working', task: `Image ${i + 1}/${scenes.length}`, video_id: id, text: `Image ${i + 1}/${scenes.length} (${shot.framing}${from ? `, depuis ${from}` : ', sans planche'})` });
      console.log(`scene ${pad(i + 1)}: ${shot.framing} ${shot.view} ${shot.pose}, from ${from ?? 'text only'}`);
      const hands = HANDS_HIDDEN.test(s.image) ? null : c.prompt.hands;
      // 2026-10-24 (r-20261024-2234: the chair of 5 scenes never drawn): the scene text, which names the main object, comes BEFORE
      // the long hero description, so the object is not buried after 60 words about the hero.
      const prompt = [c.prompt.framing[shot.framing], s.image, story.hero_lock, c.prompt.always, castLock(c, s.cast?.[0]), hands, story.palette, story.style].filter(Boolean).join(', ');
      const seed = story.seed + i + (redoScene(i) && existsSync(out) ? 777 : 0); // a redraw after a refused check gets another seed
      const prefix = `faceless/${id}-${pad(i + 1)}`;
      if (ref && paint) await paintAround({ c, story, s, shot, ref, prompt, seed, out, prefix });
      else {
        const graph = ref
          ? await img2imgGraph({ image: await uploadImage(ref, `${id}-${pad(i + 1)}-${path.basename(ref)}`), prompt, seed, denoise: c.image.ref_denoise, steps: c.image.steps, prefix })
          : await keyframeGraph({ prompt, seed, width: 1088, height: 1920, steps: c.image.steps, prefix });
        await runGraph(graph, out);
      }
      await writeCover(out, path.join(dir, 'cover.jpg')); // the vitrine wall shows the latest finished still
    }
  });

  await step('voice_director', `Voix : ${scenes.length} répliques`, id, async () => {
    for (const [i, s] of scenes.entries()) {
      const wav = path.join(dir, 'audio', `${pad(i + 1)}.wav`);
      if (existsSync(wav) && !redo.has('voice')) continue;
      const txt = path.join(dir, 'audio', `${pad(i + 1)}.txt`);
      writeFileSync(txt, s.text, 'utf8');
      await sh(KOKORO_PY, ['-I', path.join(STUDIO_ROOT, 'workshop', 'voice', 'kokoro_say.py'), txt, voice, wav, String(speed)]);
    }
    writeFileSync(voiceFile, voice, 'utf8');
  });

  const wavs = scenes.map((_, i) => path.join(dir, 'audio', `${pad(i + 1)}.wav`));
  const lens = [];
  for (const w of wavs) lens.push(await duration(w));
  const sceneLen = lens.map((l) => Math.max(MIN_SCENE_S, l + GAP_S));

  const wordsFile = path.join(dir, 'words.json');
  // Misheard captions ("RAHANG", "THAN IT HAPPENS") reached published videos: words.py now shows the SCRIPT's words (audio/NN.txt) and
  // takes only the timing from whisper; its match_ratio says how much of the line was really heard. A clip heard below
  // VOICE_MATCH_MIN is recorded once more (Kokoro can stumble), then flagged for qc.json if still poor: the video is held.
  const voiceAlignment = { min: VOICE_MATCH_MIN, poor: [] };
  await step('voice_writer', 'Sous-titres mot à mot', id, async () => {
    if (!existsSync(wordsFile) || redo.has('words') || redo.has('voice')) await sh(WHISPER_PY, ['-I', path.join(HERE, 'words.py'), wordsFile, ...wavs]);
    let clips = JSON.parse(readFileSync(wordsFile, 'utf8'));
    const poor = () => clips.map((c, i) => [c, i]).filter(([c]) => typeof c.match_ratio === 'number' && c.match_ratio < VOICE_MATCH_MIN).map(([, i]) => i);
    if (poor().length) {
      for (const i of poor()) {
        setAgent('voice_director', { state: 'working', task: `Voix refaite ${i + 1}/${scenes.length}`, video_id: id, text: `Réplique ${i + 1} mal entendue (${clips[i].match_ratio}) : voix réenregistrée` });
        await sh(KOKORO_PY, ['-I', path.join(STUDIO_ROOT, 'workshop', 'voice', 'kokoro_say.py'), path.join(dir, 'audio', `${pad(i + 1)}.txt`), voice, wavs[i], String(speed)]);
        lens[i] = await duration(wavs[i]);
        sceneLen[i] = Math.max(MIN_SCENE_S, lens[i] + GAP_S);
      }
      redo.add('motion'); // the clips of a re-recorded line are rebuilt below
      await sh(WHISPER_PY, ['-I', path.join(HERE, 'words.py'), wordsFile, ...wavs]);
      clips = JSON.parse(readFileSync(wordsFile, 'utf8'));
      voiceAlignment.poor = poor().map((i) => ({ scene: i + 1, match_ratio: clips[i].match_ratio }));
      if (voiceAlignment.poor.length) addEvent({ kind: 'note', agent: 'voice_director', video_id: id, text: `Voix mal entendue malgré un second essai : scène(s) ${voiceAlignment.poor.map((p) => p.scene).join(', ')}` });
    }
    let t = 0;
    const caps = [];
    clips.forEach((c, i) => { for (const g of captionGroups(c.words)) caps.push({ text: g.text, s: t + g.s, e: t + Math.max(g.e, g.s + 0.35) }); t += sceneLen[i]; });
    writeFileSync(path.join(dir, 'captions.ass'), assFile(caps), 'utf8');
  });

  // No paid animation in the studio: every scene gets the free slow zoom
  // (workshop/story/animate.mjs stays on disk, unused).
  await step('animator', 'Mouvements lents (Ken Burns)', id, async () => {
    for (const [i] of scenes.entries()) {
      const clip = path.join(dir, 'clips', `${pad(i + 1)}.mp4`);
      if (existsSync(clip) && !redo.has('motion') && !redo.has('voice') && !redoScene(i)) continue;
      setAgent('animator', { state: 'working', task: `Mouvement ${i + 1}/${scenes.length}`, video_id: id, text: `Mouvement ${i + 1}/${scenes.length}` });
      const frames = Math.round(sceneLen[i] * FPS);
      const z = i % 2 === 0 ? `1+${ZOOM}*on/${frames}` : `${1 + ZOOM}-${ZOOM}*on/${frames}`;
      const vf = `scale=${W * 2}:${H * 2},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},format=yuv420p`;
      const r = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', path.join(dir, 'scenes', `${pad(i + 1)}.png`), '-vf', vf, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', clip]);
      if (r.code !== 0) throw new Error(r.err.slice(-300));
    }
  });

  const final = path.join(dir, 'final.mp4');
  await step('editor', 'Montage, voix et sous-titres', id, async () => {
    const list = path.join(dir, 'clips', 'list.txt');
    writeFileSync(list, scenes.map((_, i) => `file '${pad(i + 1)}.mp4'`).join('\n'), 'utf8');
    const narration = path.join(dir, 'audio', 'narration.wav');
    const inputs = wavs.flatMap((w) => ['-i', w]);
    const pads = wavs.map((_, i) => `[${i}:a]aresample=48000,apad=whole_dur=${sceneLen[i].toFixed(3)}[a${i}]`).join(';');
    const cat = `${wavs.map((_, i) => `[a${i}]`).join('')}concat=n=${wavs.length}:v=0:a=1[out]`;
    let r = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${pads};${cat}`, '-map', '[out]', '-ar', '48000', narration]);
    if (r.code !== 0) throw new Error(r.err.slice(-300));
    const ass = path.join(dir, 'captions.ass').replace(/\\/g, '/').replace(':', '\\:');
    r = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-i', narration,
      '-vf', `ass='${ass}'`, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(FPS), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', final], { timeoutMs: 20 * 60_000 });
    if (r.code !== 0) throw new Error(r.err.slice(-300));
    await fixLoudness(final);
  });

  await writeCover(final, path.join(dir, 'cover.jpg'), (lens.reduce((a, b) => a + b, 0) * 0.3).toFixed(2));
  const report = await step('qc_inspector', 'Contrôle qualité', id, async () => {
    const rep = await qc(final);
    // Voice check (2026-10-24): a line still poorly heard after a second recording fails the technical QC like a black frame would.
    rep.checks.push({ name: 'voice_alignment', pass: voiceAlignment.poor.length === 0, value: voiceAlignment.poor.length ? voiceAlignment.poor : 'all lines heard', expected: `every line heard at ${VOICE_MATCH_MIN * 100} % or more` });
    if (voiceAlignment.poor.length) { rep.pass = false; rep.failed.push('voice_alignment'); }
    writeFileSync(path.join(dir, 'qc.json'), JSON.stringify(rep, null, 1));
    return rep;
  });
  // 2026-10-24 (review H8): the render never marks a video ready by itself. "qc_passed" needs the technical QC AND a saved
  // CLARITY PASS from qc_inspector (chain.mjs sets it after the clarity step; a re-voice keeps it only if that verdict exists).
  upsertVideo({ id, status: report.pass && clarityPassed(id) ? 'qc_passed' : 'edited', video_path: `media/${id}/final.mp4` });
  console.log(JSON.stringify({ id, final, seconds: sceneLen.reduce((a, b) => a + b, 0).toFixed(1), qc: report.pass, report: JSON.stringify(report).slice(0, 600) }));
}

main().catch((e) => { console.error(`make-short failed: ${e.message}`); process.exitCode = 1; }).finally(() => closeDb());
