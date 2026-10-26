// Faceless Studio: the concept is a parameter.
// Everything that changes with the show (hero, narrator voice, hook format, drawing style, framing, hashtags, cast) lives in
// concept/<id>/{concept.json, cast.json, rules.md, cast/<member>/*.png}; concept/active.json names the concept NEW videos use.
// A video keeps the concept written in its story.json ("concept"); an old story.json without that field belongs to active.json
// "legacy". A field missing from concept.json = today's behaviour (DEFAULTS below), never a crash. Messages meant for the owner
// (loadConcept, check, activate) are in French; checkCast speaks to an agent tool, so it stays in English like checkStory.
// chain.mjs, make-short.mjs, publish-direct.mjs, story.mjs, mcp-server.mjs and run-agent.mjs read the concept here.
// A fresh studio has NO active concept (active.json "id": null): nothing is made until the owner creates a show (CLAUDE.md,
// "First run": copy concept/_modele/, fill every <…> placeholder, check, rehearse, activate). A field that still holds a
// placeholder makes loadConcept refuse the concept, so nothing ever runs on the template's words.
//   node --no-warnings core/concept.mjs check [id]     what the concept folder contains and what is missing (French);
//                                                     "check _modele" lists the fields of the blank template to fill
//   node --no-warnings core/concept.mjs activate <id>  make it the active concept (guards: fields, hero views, no chain running)
//   node --no-warnings core/concept.mjs stamp          write "concept" into every media/s-*/story.json that has none (step 2)
//   node --no-warnings core/concept.mjs show           the resolved active concept as JSON
// Test env, on the model of STUDIO_DB / STUDIO_MEDIA / STUDIO_BRAND_DIR: STUDIO_CONCEPT (active id), STUDIO_CONCEPT_DIR
// (concept root, default concept/), STUDIO_MEDIA (media root), STUDIO_DECISIONS (decisions file).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLATFORMS, STUDIO_ROOT, addEvent, closeDb, nowIso } from './db.mjs';
import { writeMission } from './mission.mjs';
import { onScreenFormatProblems } from './guardrails/playbook.ts';

const CONCEPT_ROOT = path.resolve(STUDIO_ROOT, process.env.STUDIO_CONCEPT_DIR || 'concept');
const MEDIA_ROOT = path.resolve(STUDIO_ROOT, process.env.STUDIO_MEDIA || 'media');
const DATA = path.join(STUDIO_ROOT, 'data');
const DECISIONS_FILE = process.env.STUDIO_DECISIONS || path.join(DATA, 'decisions.jsonl');

export const ID_RE = /^[a-z][a-z0-9-]{2,30}$/;
export const FRAMINGS = Object.freeze(['closeup', 'waist', 'full']);
export const VIEWS = Object.freeze(['front', 'three-quarter', 'profile', 'back']);
export const POSES = Object.freeze(['standing', 'sitting', 'walking', 'hands-out']);
export const REQUIRED_HERO_VIEWS = Object.freeze(['closeup-front', 'waist-front', 'full-front']);
const STORY_DIR_RE = /^s-\d{8}-\d{4}$/; // same as workshop/story/chain.mjs (a rehearsal r-… may run another concept on purpose)
const VIDEO_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/; // core/db.mjs checkVideoId, without the throw
const FORBIDDEN_IN_LOCK = /\b(text|letters?|logo)\b/i; // core/guardrails/story.mjs FORBIDDEN_IN_IMAGE, the words that pollute an image prompt
const KOKORO_ID_RE = /^[ab][fm]_[a-z]+$/; // af_heart, am_puck, bf_emma, bm_george… (a warning only; a rehearsal reveals a wrong id)

/** The value of every field a concept does not set: engineering defaults with no show in them (no hook words, no show
 *  hashtags); story.mjs STORY_RULES reads them here. No default for id, voice.id, hero_lock, style, palette: a concept must say
 *  them. The template concept/_modele/concept.json spells out every field anyway. */
export const DEFAULTS = Object.freeze({
  voice: { engine: 'kokoro', speed: 0.95 },
  // paint_around (2026-10-25): the hero is pasted from her cast sheet and only the place around her is painted (make-short.mjs
  // paintAround), then the whole still is blended by img2img at blend_denoise. false = img2img from the sheet at ref_denoise.
  image: { ref_denoise: 0.72, steps: 9, seed_base: 9000, paint_around: false, blend_denoise: 0.6 },
  format: {
    hook_prefix: null, hook_regex: null, person: 'second person (you)',
    scenes: [8, 12], scenes_target: '9-11', words: [90, 140], words_target: '110-135',
    max_words_per_line: 18, seconds: [45, 60], twist: 'second-to-last scene', last_scene_question: false,
    // YouTube keeps 52 characters before " #Shorts".
    title_max_chars: 52, title_ends_with: null,
    // placeholder_fr, idea_line and pick_line are derived from hook_prefix when absent (see derive()).
  },
  prompt: {
    framing: {
      closeup: 'close-up portrait cropped at the chest, head and shoulders filling the frame, the main object of the scene beside the hero, no legs, no feet visible',
      waist: 'medium shot cropped at the waist, the hero large in frame, the place clearly visible behind the hero, legs and feet out of frame',
      full: 'full body shot',
    },
    scene1_framing: 'closeup', max_full_body: 2,
    hands: 'hands relaxed or holding the object of the scene naturally, five fingers, no raised or waving hands',
    always: null, // a clause added to every image of the hero ("the coat is always grey"): the concept's own, never a default
    place_style: null, // the style words that paint the PLACE around a pasted hero; null = the style without its character clauses (placeStyle)
    place_member_style: null, // "{name} painted in …": how a cast member is painted in that place (placePrompt); null = nothing added
  },
  hashtags: {
    youtube: ['#Shorts', '#Storytime', '#Animation'],
    instagram: ['#storytime', '#animation', '#shortstory'],
    tiktok: ['#storytime', '#animation', '#shortstory'],
  },
  yt_tags: ['storytime', 'animation', 'shorts'],
  cast: { max_per_scene: 1, extras_rule: 'anonymous extras only as a blurred background group, never named, never in focus', members: {} },
});

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isStr = (x) => typeof x === 'string' && x.trim().length > 0;
const isInt = (x, min = 0) => Number.isInteger(x) && x >= min;
const isRange = (x, min = 1) => Array.isArray(x) && x.length === 2 && isInt(x[0], min) && isInt(x[1], min) && x[0] <= x[1];
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** New object: `over` on top of `base`, plain objects merged key by key, arrays and scalars replaced, undefined ignored. */
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) { if (v !== undefined) out[k] = isObj(base[k]) && isObj(v) ? merge(base[k], v) : v; }
  return out;
}
/** JSON text with keys sorted at every level: two objects that say the same thing give the same text. */
const canon = (x) => JSON.stringify(x, (_, v) => (isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
function deepFreeze(x) {
  if (isObj(x) || Array.isArray(x)) { Object.freeze(x); for (const v of Object.values(x)) deepFreeze(v); }
  return x;
}
/** Writes a text file through a temp file and a rename, so a task waking up never reads a half-written file. */
function writeAtomic(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}
function readJson(file, label) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${label} illisible : ${e.message}`); }
}

// ---------- active concept ----------
const ACTIVE_FILE = path.join(CONCEPT_ROOT, 'active.json');
let activeCache = null;
const conceptCache = new Map();
/** Forgets the cached active.json and concepts (tests, and after activateConcept). */
export function clearConceptCache() { activeCache = null; conceptCache.clear(); }

function readActive() {
  if (activeCache) return activeCache;
  const a = existsSync(ACTIVE_FILE) ? readJson(ACTIVE_FILE, 'concept/active.json') : {};
  activeCache = { id: isStr(a.id) ? a.id : null, legacy: isStr(a.legacy) ? a.legacy : null, since: a.since ?? null, by: a.by ?? null };
  return activeCache;
}
/** The French message of a studio that has no show yet (fresh install): the owner's next step, never a stack trace. */
export const NO_ACTIVE_CONCEPT_FR = 'Aucun concept actif : lancez la création du concept (CLAUDE.md, « First run » : Claude Code vous pose les questions et prépare votre émission)';
/** STUDIO_CONCEPT (tests, rehearsals) else concept/active.json "id", else null (no show yet). */
function activeIdOrNull() {
  if (isStr(process.env.STUDIO_CONCEPT)) return process.env.STUDIO_CONCEPT.trim();
  return readActive().id;
}
/** true when a concept is active (STUDIO_CONCEPT or concept/active.json "id"). */
export function hasActiveConcept() { return Boolean(activeIdOrNull()); }
/** STUDIO_CONCEPT (tests, rehearsals) else concept/active.json "id"; throws NO_ACTIVE_CONCEPT_FR when there is none. */
export function activeConceptId() {
  const id = activeIdOrNull();
  if (!id) throw new Error(NO_ACTIVE_CONCEPT_FR);
  return id;
}
/** The concept of story.json files without a "concept" field (active.json "legacy"), else the active one, else null. */
export function legacyConceptId() { return readActive().legacy ?? activeIdOrNull(); }
/** Folders under concept/ (and concept/_archive/) that hold a concept.json. */
export function listConcepts({ archived = false } = {}) {
  const root = archived ? path.join(CONCEPT_ROOT, '_archive') : CONCEPT_ROOT;
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && ID_RE.test(d.name) && existsSync(path.join(root, d.name, 'concept.json'))).map((d) => d.name).sort();
}

// ---------- loading ----------
// concept/_exemples/<id>/ is searched too, so `check <example>` lists an example's missing views; an example is never activated in
// place (activationBlockers), it is copied first. concept/_modele/ is the blank template ("check _modele"): it never loads, its
// fields are placeholders.
const EXAMPLES_DIR = '_exemples';
export const TEMPLATE_ID = '_modele';
// A placeholder of the template: "<describe …>", "<your …>", "<fill …>", "<choose …>", "<pick …>", "<list …>", "<write …>", "<name …>".
export const PLACEHOLDER_RE = /<(?:describe|your|fill|choose|pick|list|write|name)\b[^<>\n]*>/i;
/** Every field (dotted path; keys too) of a parsed JSON whose text still holds a template placeholder; "_" notes are skipped. */
export function placeholderFields(obj, prefix = '') {
  const out = [];
  const walk = (x, p) => {
    if (typeof x === 'string') { const m = PLACEHOLDER_RE.exec(x); if (m) out.push(`${p || '(racine)'} : « ${m[0]} »`); return; }
    if (Array.isArray(x)) { x.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
    if (!isObj(x)) return;
    for (const [k, v] of Object.entries(x)) {
      if (k.startsWith('_')) continue;
      const here = p ? `${p}.${k}` : k;
      const mk = PLACEHOLDER_RE.exec(k);
      if (mk) out.push(`${here} (nom du champ) : « ${mk[0]} »`);
      walk(v, here);
    }
  };
  walk(obj, prefix);
  return out;
}
/** The placeholder lines left in a rules.md ("ligne N : « <describe …> »"). */
export function placeholderLines(text) {
  return String(text ?? '').split(/\r?\n/).flatMap((l, i) => { const m = PLACEHOLDER_RE.exec(l); return m ? [`ligne ${i + 1} : « ${m[0]} »`] : []; });
}
function conceptDir(id) {
  if (id === TEMPLATE_ID) {
    const dir = path.join(CONCEPT_ROOT, TEMPLATE_ID);
    if (existsSync(path.join(dir, 'concept.json'))) return { dir, rel: `concept/${TEMPLATE_ID}` };
    throw new Error(`modèle introuvable : concept/${TEMPLATE_ID}/concept.json`);
  }
  if (!ID_RE.test(String(id ?? ''))) throw new Error(`identifiant de concept invalide « ${id} » (minuscules, chiffres et tirets, 3 à 31 caractères)`);
  for (const sub of ['', '_archive', EXAMPLES_DIR]) {
    const dir = path.join(CONCEPT_ROOT, sub, id);
    if (existsSync(path.join(dir, 'concept.json'))) return { dir, rel: `concept/${sub ? `${sub}/` : ''}${id}` };
  }
  throw new Error(`concept « ${id} » introuvable : ni concept/${id}/concept.json ni concept/_archive/${id}/concept.json ni concept/${EXAMPLES_DIR}/${id}/concept.json`);
}

/** Fields the concept did not set (leaf paths of DEFAULTS absent from concept.json + cast.json): "today's behaviour" for each. */
export function defaultedKeys(conceptJson, castJson = {}) {
  const out = [];
  const walk = (def, got, prefix) => {
    for (const [k, v] of Object.entries(def)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (isObj(v) && k !== 'members') walk(v, isObj(got?.[k]) ? got[k] : {}, p); // a missing section lists its leaves
      else if (got?.[k] === undefined) out.push(p);
    }
  };
  const { cast: castDefaults, ...rest } = DEFAULTS;
  walk(rest, conceptJson, '');
  walk(castDefaults, castJson, 'cast');
  return out;
}

// 2026-10-26 (a white bubble appeared behind the hero, which must never happen): the place
// around a pasted hero was painted with the concept's style, which describes a CHARACTER ("simple cartoon character … minimal expressive
// face with small dot eyes and a tiny mouth, flat colours on the character … the character in the middle third"). The model drew that
// character in the place: a white blob with dot eyes, or a faceless white bubble, behind the hero (4 videos of the night of 25-26/10,
// 2 set aside; same seed and layout without those words: none). The place is now painted with placeStyle(), never a character.
const CHARACTER_WORDS = /\b(characters?|faces?|eyes?|mouths?|heroe?s?|person|people|figures?)\b/i;
/** The style words for the place painted around the hero (make-short.mjs paintAround): prompt.place_style, else the style's
 *  comma-separated clauses that describe no character. */
export function placeStyle(c) {
  if (isStr(c.prompt?.place_style)) return c.prompt.place_style;
  return String(c.style ?? '').split(',').map((s) => s.trim()).filter((s) => s && !CHARACTER_WORDS.test(s)).join(', ');
}
/** The whole prompt that paints the PLACE around the pasted hero (make-short.mjs paintAround): the scene's place, a named cast member
 *  with prompt.place_member_style ("{name} painted in …": without it a member came out photographic, with the character words she came
 *  out white as the paper, r-tests of 26/10), the palette without its "no …" clauses (Z-Image at cfg 1 draws what a prompt denies:
 *  "no colour swatches" drew a strip of swatches beside the hero once the character words were gone), and placeStyle(c). */
export function placePrompt(c, story, scene) {
  const id = scene.cast?.[0];
  const member = castLock(c, id);
  const name = member ? c.cast.members[id]?.name : null;
  const memberStyle = name && isStr(c.prompt?.place_member_style) ? c.prompt.place_member_style.replaceAll('{name}', name) : null;
  const palette = String(story.palette ?? c.palette ?? '').split(',').map((s) => s.trim()).filter((s) => s && !/^no\b/i.test(s)).join(', ');
  const place = typeof scene.place === 'string' ? scene.place.trim() : '';
  return [place, member, memberStyle, palette, placeStyle(c)].filter(Boolean).join(', ');
}

/** Validation of the merged concept; every problem is one French line (field: what is wrong). */
function validate(c, id) {
  const p = [];
  if (!isStr(c.id)) p.push('id : manquant');
  else if (c.id !== id) p.push(`id : « ${c.id} » ne correspond pas au dossier concept/${id}/`);
  for (const k of ['hero_lock', 'style', 'palette']) if (!isStr(c[k])) p.push(`${k} : texte obligatoire manquant`);
  if (!ID_RE.test(String(c.hero ?? ''))) p.push(`hero : identifiant invalide « ${c.hero} » (minuscules, chiffres et tirets)`);
  if (!isStr(c.hero_name)) p.push('hero_name : prénom du héros manquant');
  if (c.hero_pronouns !== undefined && !['she', 'he', 'they'].includes(c.hero_pronouns)) p.push(`hero_pronouns : she, he ou they attendu (reçu ${JSON.stringify(c.hero_pronouns)})`);
  if (!isObj(c.voice) || !isStr(c.voice.id)) p.push('voice.id : identifiant de voix obligatoire (ex. af_heart)');
  else if (typeof c.voice.speed !== 'number' || !(c.voice.speed > 0 && c.voice.speed <= 2)) p.push('voice.speed : nombre entre 0 et 2 attendu');
  const im = c.image ?? {};
  if (!(typeof im.ref_denoise === 'number' && im.ref_denoise > 0 && im.ref_denoise <= 1)) p.push(`image.ref_denoise : nombre entre 0 (exclu) et 1 attendu (reçu ${JSON.stringify(im.ref_denoise)})`);
  if (!isInt(im.steps, 1)) p.push('image.steps : entier ≥ 1 attendu');
  if (!isInt(im.seed_base, 0)) p.push('image.seed_base : entier ≥ 0 attendu');
  if (typeof im.paint_around !== 'boolean') p.push('image.paint_around : true ou false attendu');
  if (!(typeof im.blend_denoise === 'number' && im.blend_denoise > 0 && im.blend_denoise <= 1)) p.push(`image.blend_denoise : nombre entre 0 (exclu) et 1 attendu (reçu ${JSON.stringify(im.blend_denoise)})`);
  const f = c.format ?? {};
  for (const k of ['scenes', 'words', 'seconds']) if (!isRange(f[k])) p.push(`format.${k} : [min, max] d'entiers avec min ≤ max attendu (reçu ${JSON.stringify(f[k])})`);
  if (!isInt(f.max_words_per_line, 1)) p.push('format.max_words_per_line : entier ≥ 1 attendu');
  if (!isInt(f.title_max_chars, 10)) p.push('format.title_max_chars : entier ≥ 10 attendu');
  if (f.hook_prefix !== null && !isStr(f.hook_prefix)) p.push('format.hook_prefix : texte ou null attendu');
  if (f.hook_regex !== null && !isStr(f.hook_regex)) p.push('format.hook_regex : texte ou null attendu');
  else if (isStr(f.hook_regex)) { try { new RegExp(f.hook_regex, 'i'); } catch (e) { p.push(`format.hook_regex : expression invalide (${e.message})`); } }
  if (typeof f.last_scene_question !== 'boolean') p.push('format.last_scene_question : true ou false attendu');
  if (f.title_ends_with !== null && typeof f.title_ends_with !== 'string') p.push('format.title_ends_with : texte ou null attendu');
  const pr = c.prompt ?? {};
  for (const k of FRAMINGS) if (!isStr(pr.framing?.[k])) p.push(`prompt.framing.${k} : texte manquant`);
  if (!FRAMINGS.includes(pr.scene1_framing)) p.push(`prompt.scene1_framing : un de ${FRAMINGS.join(', ')} attendu`);
  if (!isInt(pr.max_full_body, 0)) p.push('prompt.max_full_body : entier ≥ 0 attendu');
  if (!isStr(pr.hands)) p.push('prompt.hands : texte manquant');
  if (pr.always !== null && typeof pr.always !== 'string') p.push('prompt.always : texte ou null attendu');
  if (pr.place_style !== null && !isStr(pr.place_style)) p.push('prompt.place_style : texte ou null attendu');
  else if (isStr(pr.place_style) && CHARACTER_WORDS.test(pr.place_style)) p.push('prompt.place_style : ne doit décrire aucun personnage (character, face, eyes, mouth…) : le décor en ferait un second');
  if (pr.place_member_style !== null && !(isStr(pr.place_member_style) && pr.place_member_style.includes('{name}'))) p.push('prompt.place_member_style : texte contenant {name}, ou null attendu');
  for (const net of PLATFORMS) {
    const tags = c.hashtags?.[net];
    if (!Array.isArray(tags) || tags.length < 3 || tags.length > 5 || tags.some((h) => !/^#[A-Za-z][A-Za-z0-9]{1,29}$/.test(String(h)))) p.push(`hashtags.${net} : 3 à 5 tags comme "#Storytime" attendus (reçu ${JSON.stringify(tags)})`);
  }
  if (!Array.isArray(c.yt_tags) || c.yt_tags.length > 10 || c.yt_tags.some((t) => !isStr(t))) p.push('yt_tags : liste de 10 textes au plus attendue');
  // on_screen (optional): the show's on-screen format for script packages (core/guardrails/playbook.ts OnScreenFormat).
  for (const x of onScreenFormatProblems(c.on_screen)) p.push(`${x} (format à l'écran)`);
  p.push(...validateCast(c.cast, c.hero, 'cast'));
  return p;
}
/** cast.json shape (French, for loadConcept); the hero's own entry gets its lock from concept.json so it is not checked here. */
function validateCast(cast, hero, at) {
  const p = [];
  if (!isObj(cast)) return [`${at} : objet attendu`];
  if (!isInt(cast.max_per_scene, 0) || cast.max_per_scene > 2) p.push(`${at}.max_per_scene : entier entre 0 et 2 attendu (reçu ${JSON.stringify(cast.max_per_scene)})`);
  if (cast.extras_rule !== undefined && !isStr(cast.extras_rule)) p.push(`${at}.extras_rule : texte attendu`);
  if (!isObj(cast.members)) return [...p, `${at}.members : objet { id: membre } attendu`];
  const names = new Map();
  for (const [id, m] of Object.entries(cast.members)) {
    const here = `${at}.members.${id}`;
    if (!ID_RE.test(id)) p.push(`${here} : identifiant invalide (minuscules, chiffres et tirets, 3 à 31 caractères)`);
    if (!isObj(m)) { p.push(`${here} : objet attendu`); continue; }
    if (!isStr(m.name)) p.push(`${here}.name : prénom manquant`);
    else if (names.has(m.name)) p.push(`${here}.name : « ${m.name} » déjà pris par ${names.get(m.name)} (un prénom par membre)`);
    else names.set(m.name, id);
    if (!isStr(m.role)) p.push(`${here}.role : rôle manquant`);
    if (id !== hero) {
      if (!isStr(m.lock) || m.lock.trim().length < 20 || m.lock.trim().length > 300) p.push(`${here}.lock : description de 20 à 300 caractères attendue`);
      else if (FORBIDDEN_IN_LOCK.test(m.lock)) p.push(`${here}.lock : les mots text / letters / logo sont interdits dans une description d'image`);
    }
    if (m.never_changes !== undefined && (!Array.isArray(m.never_changes) || m.never_changes.some((x) => !isStr(x)))) p.push(`${here}.never_changes : liste de textes attendue`);
    if (m.sheet !== null && m.sheet !== undefined && !safeRel(m.sheet)) p.push(`${here}.sheet : chemin relatif .png sous cast/ attendu, ou null`);
    for (const [i, v] of (Array.isArray(m.views) ? m.views : []).entries()) {
      if (!isObj(v) || !safeRel(v.file) || !FRAMINGS.includes(v.framing) || !VIEWS.includes(v.view) || !POSES.includes(v.pose)) p.push(`${here}.views[${i}] : { file: "cast/…png", framing: ${FRAMINGS.join('|')}, view: ${VIEWS.join('|')}, pose: ${POSES.join('|')} } attendu`);
    }
    if (m.views !== undefined && !Array.isArray(m.views)) p.push(`${here}.views : liste attendue`);
  }
  return p;
}
const safeRel = (f) => isStr(f) && /^cast\/[a-z0-9-]+\/[A-Za-z0-9_.-]+\.png$/.test(f);

/** Derived fields: hero id/name from hero_lock, the hero's cast entry, the task lines built from hook_prefix. */
function derive(c, castRaw) {
  const hero_name = isStr(c.hero_name) ? c.hero_name : String(c.hero_lock ?? '').split(',')[0].trim();
  const hero = isStr(c.hero) ? c.hero : slug(hero_name);
  const f = isObj(c.format) ? c.format : {};
  const prefix = isStr(f.hook_prefix) ? f.hook_prefix : null;
  const format = isObj(c.format) ? {
    ...f,
    placeholder_fr: f.placeholder_fr ?? `${prefix ?? ''}… (en préparation)`,
    idea_line: f.idea_line ?? `IDEA | ${prefix ? `${prefix} ` : ''}… ? | why it can travel`,
    pick_line: f.pick_line ?? `PICK | ${prefix ? `${prefix} ` : ''}… ? | the escalation in one sentence`,
  } : c.format;
  const heroRaw = isObj(castRaw.members) && isObj(castRaw.members[hero]) ? castRaw.members[hero] : null;
  // The hero's entry: concept.json owns the name and the lock; cast.json may add never_changes, sheet and views.
  const heroEntry = { role: 'hero', never_changes: [], sheet: null, views: [], ...(heroRaw ?? {}), name: hero_name, lock: c.hero_lock };
  const cast = isObj(c.cast) && isObj(c.cast.members) ? { ...c.cast, members: { ...c.cast.members, [hero]: heroEntry } } : c.cast;
  return { ...c, hero, hero_name, format, cast, _raw: { hero_entry: heroRaw } };
}

/** concept.json + cast.json merged over DEFAULTS, validated, frozen, cached per process. Looks in concept/<id>/ then
 *  concept/_archive/<id>/ then concept/_exemples/<id>/ (examples: `check` only). Throws one French error listing every faulty field. */
export function loadConcept(id = activeConceptId()) {
  if (conceptCache.has(id)) return conceptCache.get(id);
  const { dir, rel } = conceptDir(id);
  const cj = readJson(path.join(dir, 'concept.json'), `${rel}/concept.json`);
  if (!isObj(cj)) throw new Error(`${rel}/concept.json : un objet JSON est attendu`);
  const castFile = path.join(dir, 'cast.json');
  const castRaw = existsSync(castFile) ? readJson(castFile, `${rel}/cast.json`) : {};
  if (!isObj(castRaw)) throw new Error(`${rel}/cast.json : un objet JSON est attendu`);
  // "_by"-style notes, and the concept/hero echoes (checked below), are not part of the merged cast.
  // A field still holding a template placeholder: refused before anything else, with the list of what to fill (French).
  const todo = [...placeholderFields(cj), ...placeholderFields(castRaw, 'cast')];
  if (todo.length) throw new Error(`concept « ${id} » pas prêt (${rel}/) : remplacez chaque <…> par votre valeur :\n- ${todo.join('\n- ')}`);
  const castClean = Object.fromEntries(Object.entries(castRaw).filter(([k]) => !k.startsWith('_') && k !== 'concept' && k !== 'hero'));
  const merged = merge({ ...DEFAULTS, cast: merge(DEFAULTS.cast, castClean) }, { ...cj, cast: undefined });
  const c = derive(merged, castRaw);
  const problems = validate(c, id);
  if (castRaw.concept !== undefined && castRaw.concept !== id) problems.push(`cast.concept : « ${castRaw.concept} » au lieu de « ${id} »`);
  if (castRaw.hero !== undefined && castRaw.hero !== c.hero) problems.push(`cast.hero : « ${castRaw.hero} » au lieu de « ${c.hero} » (concept.json)`);
  if (problems.length) throw new Error(`concept « ${id} » invalide (${rel}/) :\n- ${problems.join('\n- ')}`);
  const files = { concept: true, cast: existsSync(castFile), rules: existsSync(path.join(dir, 'rules.md')), trend_queries: existsSync(path.join(dir, 'trend-queries.md')) };
  // id, names and hero first (what `show` prints first), then the merged sections.
  const full = deepFreeze({ id: c.id, name: c.name, name_fr: c.name_fr, since: c.since, hero: c.hero, hero_name: c.hero_name, hero_lock: c.hero_lock, palette: c.palette, style: c.style, ...c, dir, rel, files, defaulted: defaultedKeys(cj, castClean) });
  conceptCache.set(id, full);
  return full;
}

/** The concept of ONE video: media/<id>/story.json "concept", else active.json "legacy"; null without a story.json
 *  (test folders) or when no concept was ever active. Code acting on a given video uses this, never the active concept. */
export function conceptIdOf(videoId) {
  if (!VIDEO_ID_RE.test(String(videoId ?? ''))) return null;
  const file = path.join(MEDIA_ROOT, videoId, 'story.json');
  if (!existsSync(file)) return null;
  let story = null;
  try { story = JSON.parse(readFileSync(file, 'utf8')); } catch { story = null; }
  return isStr(story?.concept) ? story.concept : legacyConceptId();
}
export function conceptOf(videoId) {
  const id = conceptIdOf(videoId);
  return id ? loadConcept(id) : null;
}

// ---------- hook format ----------
/** hook_regex when set, else ^<hook_prefix>\b, else /./ (a format without a fixed opening). */
export function titlePattern(c) {
  if (isStr(c.format.hook_regex)) return new RegExp(c.format.hook_regex, 'i');
  if (isStr(c.format.hook_prefix)) return new RegExp(`^${esc(c.format.hook_prefix)}\\b`, 'i');
  return /./;
}
/** The "PICK | <hook> | escalation" line of topic_editor / calendar_planner. */
export function pickPattern(c) {
  const hook = isStr(c.format.hook_regex) ? c.format.hook_regex.replace(/^\^/, '') : isStr(c.format.hook_prefix) ? `${esc(c.format.hook_prefix)}\\b` : '';
  return new RegExp(`^\\s*PICK\\s*\\|\\s*${hook}`, 'i');
}

// ---------- cast sheets ----------
const castFile = (c, memberId, name) => path.join(c.dir, 'cast', memberId, `${name}.png`);
const existing = (f) => (f && existsSync(f) ? f : null);
/** The views of a member that exist on disk: declared in views[] first, then by file-name convention. */
export function castViews(c, memberId) {
  const m = c.cast.members[memberId];
  if (!m) return [];
  const seen = new Set();
  const out = [];
  for (const v of m.views ?? []) {
    const abs = path.join(c.dir, v.file);
    if (existsSync(abs) && !seen.has(abs)) { seen.add(abs); out.push({ ...v, file: abs, declared: true }); }
  }
  for (const framing of FRAMINGS) {
    for (const view of VIEWS) { const f = existing(castFile(c, memberId, `${framing}-${view}`)); if (f && !seen.has(f)) { seen.add(f); out.push({ file: f, framing, view, pose: 'standing', declared: false }); } }
    for (const pose of POSES.filter((x) => x !== 'standing')) { const f = existing(castFile(c, memberId, `${pose}-${framing}`)); if (f && !seen.has(f)) { seen.add(f); out.push({ file: f, framing, view: 'front', pose, declared: false }); } }
  }
  return out;
}
/** The hero's required front views (closeup-front, waist-front, full-front) that are missing: [] = ready. */
export function missingHeroViews(c) {
  return REQUIRED_HERO_VIEWS.filter((name) => !existing(castFile(c, c.hero, name)));
}
/** The image a scene starts from (img2img), first existing wins: declared view (framing+pose+view, framing+pose, framing+view),
 *  <pose>-<framing>.png, <framing>-<view>.png, <framing>-front.png, else null = text-to-image. */
export function castSheet(c, memberId, shot = {}) {
  const m = c.cast.members[memberId];
  if (!m) return null;
  const framing = FRAMINGS.includes(shot.framing) ? shot.framing : 'waist';
  const view = VIEWS.includes(shot.view) ? shot.view : 'front';
  const pose = POSES.includes(shot.pose) ? shot.pose : 'standing';
  const declared = (m.views ?? []).filter((v) => v.framing === framing);
  const pick = (pred) => { const v = declared.find(pred); return v ? existing(path.join(c.dir, v.file)) : null; };
  // A file named for the asked pose or view comes before a declared view that matches only the pose or only the view; with the
  // old order a hero's declared "full, front, standing" won a back shot over full-back.png, and sitting / profile scenes got
  // waist-front.png.
  return pick((v) => v.pose === pose && v.view === view)
    ?? (pose !== 'standing' ? existing(castFile(c, memberId, `${pose}-${framing}`)) : null)
    ?? existing(castFile(c, memberId, `${framing}-${view}`))
    ?? pick((v) => v.pose === pose)
    ?? pick((v) => v.view === view)
    ?? existing(castFile(c, memberId, `${framing}-front`));
}
/** The lock sentence of a secondary (for the image prompt); null for nobody, an unknown id, or the hero (hero_lock is already there). */
export function castLock(c, memberId) {
  if (!memberId || memberId === c.hero) return null;
  return c.cast.members[memberId]?.lock ?? null;
}

/** Validation of a cast.json an agent wants to write (write_cast_file): English, like checkStory, for the tool's answer. */
export function checkCast(parsed, c) {
  if (!isObj(parsed)) return ['cast.json must be an object'];
  const p = [];
  if (parsed.concept !== undefined && parsed.concept !== c.id) p.push(`concept must be "${c.id}"`);
  if (parsed.hero !== undefined && parsed.hero !== c.hero) p.push(`hero must be "${c.hero}"`);
  if (!isInt(parsed.max_per_scene, 0) || parsed.max_per_scene > 2) p.push('max_per_scene: an integer from 0 to 2');
  if (parsed.extras_rule !== undefined && !isStr(parsed.extras_rule)) p.push('extras_rule: a sentence');
  if (!isObj(parsed.members)) return [...p, 'members: an object { id: member }'];
  const ids = Object.keys(parsed.members);
  if (ids.length < 4 || ids.length > 8) p.push(`4 to 8 members (has ${ids.length})`);
  if (!parsed.members[c.hero]) p.push(`the hero "${c.hero}" must stay in the cast`);
  else if (c._raw.hero_entry && canon(parsed.members[c.hero]) !== canon(c._raw.hero_entry)) p.push(`the hero entry "${c.hero}" must not change (concept.json owns the hero)`);
  const names = new Map();
  for (const [id, m] of Object.entries(parsed.members)) {
    if (!ID_RE.test(id)) p.push(`member id "${id}": lowercase letters, digits and dashes, 3 to 31 characters`);
    if (!isObj(m)) { p.push(`member ${id}: an object`); continue; }
    if (!isStr(m.name)) p.push(`member ${id}: name missing`);
    else if (names.has(m.name)) p.push(`member ${id}: the name "${m.name}" is already ${names.get(m.name)}'s`);
    else names.set(m.name, id);
    if (!isStr(m.role)) p.push(`member ${id}: role missing`);
    if (id !== c.hero) {
      if (!isStr(m.lock) || m.lock.trim().length < 20 || m.lock.trim().length > 300) p.push(`member ${id}: lock must be 20 to 300 characters`);
      else if (FORBIDDEN_IN_LOCK.test(m.lock)) p.push(`member ${id}: lock must not ask for text, letters or a logo`);
    }
    if (m.never_changes !== undefined && (!Array.isArray(m.never_changes) || m.never_changes.some((x) => !isStr(x)))) p.push(`member ${id}: never_changes must be a list of short texts`);
    if (m.sheet !== null && m.sheet !== undefined && !safeRel(m.sheet)) p.push(`member ${id}: sheet must be null or "cast/<id>/<file>.png"`);
    if (m.views !== undefined && (!Array.isArray(m.views) || m.views.some((v) => !isObj(v) || !safeRel(v.file) || !FRAMINGS.includes(v.framing) || !VIEWS.includes(v.view) || !POSES.includes(v.pose)))) p.push(`member ${id}: views must be [{ file, framing, view, pose }] from the known lists`);
  }
  return p;
}

// ---------- activation ----------
/** Story folders (media/s-…) whose chain started (chain/start.txt) and has not finished (chain/done.txt). */
export function chainsInProgress() {
  if (!existsSync(MEDIA_ROOT)) return [];
  return readdirSync(MEDIA_ROOT).filter((d) => STORY_DIR_RE.test(d) && existsSync(path.join(MEDIA_ROOT, d, 'chain', 'start.txt')) && !existsSync(path.join(MEDIA_ROOT, d, 'chain', 'done.txt')));
}
/** French reasons why `activate` would refuse this (loaded) concept: [] = ready. */
export function activationBlockers(c) {
  const out = [];
  const missing = missingHeroViews(c);
  if (missing.length) out.push(`vues du héros manquantes : ${missing.map((v) => `${c.rel}/cast/${c.hero}/${v}.png`).join(', ')}`);
  if (!c.files.rules) out.push(`${c.rel}/rules.md manque (les règles du concept que les agents reçoivent)`);
  else {
    const left = placeholderLines(readFileSync(path.join(c.dir, 'rules.md'), 'utf8'));
    if (left.length) out.push(`${c.rel}/rules.md contient encore ${left.length} passage(s) à remplir : ${left.join(' ; ')}`);
  }
  if (c.rel === `concept/${TEMPLATE_ID}`) out.push(`concept/${TEMPLATE_ID}/ est le modèle : le copier en concept/<id>/ et le remplir`);
  if (c.rel.startsWith(`concept/${EXAMPLES_DIR}/`)) out.push(`${c.rel}/ est un exemple : le copier en concept/${c.id}/ (et le compléter) avant de l'activer`);
  return out;
}
/** Warnings (French): things that do not block but that the owner should know. */
export function conceptWarnings(c) {
  const out = [];
  if (!KOKORO_ID_RE.test(c.voice.id)) out.push(`voix « ${c.voice.id} » : forme inhabituelle pour Kokoro (attendu af_…, am_…, bf_…, bm_…) ; une répétition le dira`);
  const samples = ['voices', 'promo-voices', 'voices-archive'].map((d) => path.join(STUDIO_ROOT, 'concept', d)).filter(existsSync).flatMap((d) => readdirSync(d));
  if (!samples.some((f) => f.includes(`-${c.voice.id}.`))) out.push(`aucun échantillon concept/voices/*-${c.voice.id}.wav pour écouter la voix (à fabriquer avec Kokoro, voir CLAUDE.md « First run »)`);
  if (!c.files.cast) out.push(`${c.rel}/cast.json absent : le héros seul, sans personnage secondaire`);
  return out;
}
function archiveDataFile(name, from) {
  const src = path.join(DATA, `${name}.json`);
  if (!from || !existsSync(src)) return null;
  let dst = path.join(DATA, `${name}.${from}.json`);
  if (existsSync(dst)) dst = path.join(DATA, `${name}.${from}.${nowIso().replace(/[-:]/g, '').slice(0, 13)}.json`);
  renameSync(src, dst);
  return path.relative(STUDIO_ROOT, dst).split(path.sep).join('/');
}
/** Makes `id` the active concept (the owner's order, through Lester or the CLI). In order: (1) full check, (2) refused while a
 *  media/s-* chain runs, (3) data/story-subjects.json and data/strategy.json archived as .<old>.json (they hold the old
 *  concept's subjects and themes), (4) active.json written (tmp + rename), (5) data/decisions.jsonl line + chief_of_staff
 *  note event, (6) brand/mission.md refreshed. Nothing is written before (3). */
export function activateConcept(id, by = 'cli') {
  const c = loadConcept(id);
  const blockers = activationBlockers(c);
  if (blockers.length) throw new Error(`concept « ${id} » refusé :\n- ${blockers.join('\n- ')}`);
  const busy = chainsInProgress();
  if (busy.length) throw new Error(`concept non changé : une chaîne est en cours (${busy.join(', ')}) ; réessayer quand media/<id>/chain/done.txt existe`);
  const active = readActive();
  const from = active.id;
  if (from === id) return { id, from, changed: false, archived: [] };
  const archived = ['story-subjects', 'strategy'].map((n) => archiveDataFile(n, from)).filter(Boolean);
  const since = nowIso();
  const next = { id, legacy: active.legacy ?? from ?? id, since, by };
  writeAtomic(ACTIVE_FILE, `${JSON.stringify(next, null, 1)}\n`);
  clearConceptCache();
  appendFileSync(DECISIONS_FILE, `${JSON.stringify({ at: since, agent: 'owner', kind: 'concept', from, to: id, by, applied: true, archived })}\n`);
  addEvent({ kind: 'note', agent: 'chief_of_staff', text: `Concept actif : ${id} (${c.name ?? c.hero_name})${from ? `, avant : ${from}` : ''} — ${by}` });
  let mission = true;
  try { writeMission(); } catch (e) { mission = false; console.error(`mission not refreshed: ${e.message}`); }
  return { id, from, changed: true, since, archived, mission };
}

/** Writes "concept": <legacy> into every story.json of media/s-… that has no "concept" field. */
export function stampStories({ dryRun = false } = {}) {
  const legacy = legacyConceptId();
  if (!legacy) throw new Error(NO_ACTIVE_CONCEPT_FR);
  loadConcept(legacy); // never stamp an id that does not load
  const stamped = [], skipped = [];
  for (const d of (existsSync(MEDIA_ROOT) ? readdirSync(MEDIA_ROOT) : []).filter((x) => STORY_DIR_RE.test(x))) {
    const f = path.join(MEDIA_ROOT, d, 'story.json');
    if (!existsSync(f)) continue;
    const text = readFileSync(f, 'utf8');
    let story;
    try { story = JSON.parse(text); } catch { skipped.push(`${d} : story.json illisible`); continue; }
    if (!isObj(story)) { skipped.push(`${d} : story.json n'est pas un objet`); continue; }
    if (isStr(story.concept)) { skipped.push(`${d} : déjà « ${story.concept} »`); continue; }
    const { id, ...rest } = story;
    if (!dryRun) writeAtomic(f, `${JSON.stringify({ id, concept: legacy, ...rest }, null, 2)}\n`);
    stamped.push(d);
  }
  return { legacy, stamped, skipped };
}

// ---------- CLI ----------
/** `check` of a folder that does not load yet (placeholders left, or wrong fields): what to fill, in French; exit code 1. */
function printNotReady(id, e) {
  console.log(id === TEMPLATE_ID
    ? `Modèle concept/${TEMPLATE_ID}/ : à copier en concept/<id>/ puis à remplir (CLAUDE.md, « First run »). Champs à remplir :`
    : `Concept « ${id} » : PAS PRÊT, rien ne tournera dessus tant que ces points restent :`);
  console.log(`  ${e.message.split('\n').slice(1).join('\n  ') || e.message}`);
  let rules = null;
  try { const f = path.join(conceptDir(id).dir, 'rules.md'); rules = existsSync(f) ? placeholderLines(readFileSync(f, 'utf8')) : null; } catch { rules = null; }
  if (rules === null) console.log('  rules.md : MANQUE');
  else if (rules.length) console.log(`  rules.md : à remplir\n    - ${rules.join('\n    - ')}`);
  console.log(`  ensuite : planches du héros (node --no-warnings concept/make-cast.mjs hero ${id === TEMPLATE_ID ? '<id>' : id}, ComfyUI), puis check à nouveau.`);
  process.exitCode = 1;
}
function printCheck(id) {
  let c;
  try { c = loadConcept(id); } catch (e) {
    if (/pas prêt|» invalide/.test(e.message)) return printNotReady(id, e);
    throw e;
  }
  const yn = (b) => (b ? 'oui' : 'MANQUE');
  console.log(`Concept « ${c.id} » (${c.rel}/) : champs valides.`);
  if (c.name || c.name_fr) console.log(`  ${[c.name, c.name_fr].filter(Boolean).join(' — ')}`);
  console.log(`  héros : ${c.hero_name} (id ${c.hero}) · voix ${c.voice.engine} ${c.voice.id} ×${c.voice.speed} · accroche ${c.format.hook_regex ? `regex ${c.format.hook_regex}` : c.format.hook_prefix ? `« ${c.format.hook_prefix} »` : 'libre'} · ${c.format.scenes.join('-')} scènes, ${c.format.words.join('-')} mots, ${c.format.seconds.join('-')} s · titre ≤ ${c.format.title_max_chars} caractères${c.format.title_ends_with ? `, finit par « ${c.format.title_ends_with} »` : ''}`);
  console.log(`  fichiers : concept.json oui · cast.json ${c.files.cast ? 'oui' : 'non (héros seul)'} · rules.md ${yn(c.files.rules)} · trend-queries.md ${c.files.trend_queries ? 'oui' : 'non (facultatif : brand/trend-queries.md)'}`);
  console.log(`  champs pris par défaut (= comportement d'aujourd'hui) : ${c.defaulted.length ? c.defaulted.join(', ') : 'aucun'}`);
  console.log(`  casting : ${Object.keys(c.cast.members).length} membre(s), au plus ${c.cast.max_per_scene} secondaire(s) par scène`);
  for (const [mid, m] of Object.entries(c.cast.members)) {
    const views = castViews(c, mid).map((v) => `${path.basename(v.file)}${v.declared ? ' (déclarée)' : ''}`);
    const sheet = m.sheet ? (existsSync(path.join(c.dir, m.sheet)) ? 'oui' : `MANQUE (${m.sheet})`) : 'non';
    const missing = mid === c.hero ? missingHeroViews(c) : [];
    console.log(`    - ${mid} (${m.name}, ${m.role}) : planche ${sheet} · vues : ${views.length ? views.join(', ') : 'aucune'}${mid === c.hero ? (missing.length ? ` · MANQUENT (obligatoires) : ${missing.map((v) => `${v}.png`).join(', ')}` : ' · les 3 vues de face obligatoires sont là') : views.length ? '' : ' (tenu par son texte lock)'}`);
  }
  for (const w of conceptWarnings(c)) console.log(`  avertissement : ${w}`);
  const blockers = activationBlockers(c);
  console.log(blockers.length ? `  activation : REFUSÉE tant que\n    - ${blockers.join('\n    - ')}` : '  activation : possible (node --no-warnings core/concept.mjs activate ' + c.id + ')');
  const busy = chainsInProgress();
  if (busy.length) console.log(`  chaîne en cours : ${busy.join(', ')} (l'activation attend chain/done.txt)`);
}

function cli(argv) {
  const [cmd, arg] = argv;
  if (cmd === 'check') {
    if (!arg && !hasActiveConcept()) { console.log(`${NO_ACTIVE_CONCEPT_FR}.\nLe modèle à copier et remplir : node --no-warnings core/concept.mjs check ${TEMPLATE_ID}`); return; }
    printCheck(arg ?? activeConceptId());
    return;
  }
  if (cmd === 'show') { console.log(JSON.stringify(loadConcept(arg ?? activeConceptId()), null, 1)); return; }
  if (cmd === 'activate') {
    if (!arg) throw new Error('usage : activate <id>');
    const r = activateConcept(arg, 'propriétaire (CLI core/concept.mjs)');
    console.log(r.changed ? `Concept actif : ${r.id} (avant : ${r.from ?? 'aucun'}). Archivé : ${r.archived.join(', ') || 'rien'}. La prochaine vidéo le prend ; les anciennes gardent le leur.` : `Concept déjà actif : ${r.id}. Rien à faire.`);
    return;
  }
  if (cmd === 'stamp') {
    const r = stampStories({ dryRun: argv.includes('--dry-run') });
    console.log(`${argv.includes('--dry-run') ? 'À marquer' : 'Marqués'} « ${r.legacy} » : ${r.stamped.length} story.json${r.stamped.length ? ` (${r.stamped.join(', ')})` : ''}.`);
    for (const s of r.skipped) console.log(`  ignoré : ${s}`);
    return;
  }
  throw new Error('usage : node --no-warnings core/concept.mjs check [id] | activate <id> | stamp [--dry-run] | show [id]');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { cli(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } finally { closeDb(); }
}
