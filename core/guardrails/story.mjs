// Faceless Studio: the story.json check of the video's concept (concept/<id>/concept.json "format" + cast.json).
// Used by core/mcp-server.mjs write_media_file (an agent cannot save a story that fails it) and by workshop/story/chain.mjs.
// 2026-10-24 (the concept is a parameter): checkStory(story, c) reads its limits from the concept of THE STORY (c = loadConcept(...)),
// not from a fixed hero.json; "concept", scenes[].shot and scenes[].cast are checked when present and tolerated when absent (the stock).
// Messages are English: they answer an agent tool (write_media_file), like checkCast in core/concept.mjs.
import { DEFAULTS, FRAMINGS, POSES, VIEWS, activeConceptId, conceptIdOf, esc, loadConcept, titlePattern } from '../concept.mjs';

const FORBIDDEN_IN_IMAGE = /\b(text|letters?|logo|sign that reads|caption|subtitle|words? on)\b/i;
// YouTube keeps 52 characters before " #Shorts", so the title length (and the final character a concept may ask for) is checked.
// Stories written before that rule existed (ids before TITLE_RULES_SINCE) keep passing (regression test core/guardrails/story.test.mjs;
// an agent resaving an old story): ids carry the studio clock (chain.mjs newId), so an id <letter>-YYYYMMDD-HHMM before that is
// old, any other id is new. A brand-new studio has no story that old.
const TITLE_RULES_SINCE = '20261024-1900';
const madeBeforeTitleRules = (id) => { const m = /^[a-z]-(\d{8}-\d{4})$/.exec(String(id ?? '')); return m !== null && m[1] < TITLE_RULES_SINCE; };

const BAIT_TAG = /^#(reels?|fyp|foryou(page)?|viral|trending|shorts)$/i;
// In scenes[].place (the still WITHOUT the hero): the hero's pronouns (concept.json "hero_pronouns": she | he | they; "she" when
// absent). The other set stays allowed for a secondary; "they" checks nothing (it names groups too).
const PRONOUNS = { she: /\b(she|her|hers|herself)\b/i, he: /\b(he|him|his|himself)\b/i };
const heroPronoun = (c) => (c?.hero_pronouns === 'they' ? null : PRONOUNS[c?.hero_pronouns] ?? PRONOUNS.she);
/** Every tag the code adds for the concept (concept.json "hashtags", all networks), lower case. */
const conceptTags = (c) => new Set(Object.values(isObj(c?.hashtags) ? c.hashtags : {}).flat().map((h) => String(h).toLowerCase()));

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isStr = (x) => typeof x === 'string' && x.trim().length > 0;
const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
// A first name as a whole word, Unicode-aware ("Élodie", "Ana's"): \b alone misses names that start or end with an accented letter.
const nameRe = (name) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, 'u');

/** The limits of one concept, in the shape the checks read; a field the concept did not set comes from DEFAULTS (core/concept.mjs). */
export function rulesOf(c) {
  const f = { ...DEFAULTS.format, ...(isObj(c?.format) ? c.format : {}) };
  return {
    minScenes: f.scenes[0], maxScenes: f.scenes[1], maxWordsPerLine: f.max_words_per_line,
    minWords: f.words[0], maxWords: f.words[1], seconds: f.seconds,
    titleMaxChars: f.title_max_chars, titleEndsWith: isStr(f.title_ends_with) ? f.title_ends_with : null, // null = no final "?" required
  };
}
// Today's values (= DEFAULTS.format of core/concept.mjs, one source): 8-12 scenes, 18 words a line, 90-140 words, title <= 52 characters, no final character imposed.
// maxWords 140: the narrator at speed 0.95 reads about 2.5 words a second plus 0.35 s between scenes, and core/qc caps at 60 s.
export const STORY_RULES = Object.freeze(rulesOf(DEFAULTS));

/** The concept id a story in memory belongs to: its "concept" field first, else the concept of that video on disk (media/<id>/story.json
 *  "concept", else active.json "legacy" — core/concept.mjs conceptIdOf), else the active concept (a brand-new story). */
function conceptIdOfStory(story) {
  return isStr(story?.concept) ? story.concept : (conceptIdOf(story?.id) ?? activeConceptId());
}
/** Loads that concept; a failure is one English problem (same wording as core/mcp-server.mjs write_media_file), never a crash. */
function conceptOfStory(story) {
  let id = null;
  try { id = conceptIdOfStory(story); return { concept: loadConcept(id) }; }
  catch (e) { return { problem: `concept ${id ? `"${id}" ` : ''}cannot be loaded: ${e.message}` }; }
}

/** scenes[n].cast: a list of at most cast.max_per_scene ids of cast.json (never the hero: the concept puts the hero in every scene);
 *  a member's first name in the image without its id in cast = a secondary named "on the sly" (refused). Absent cast = accepted. */
function checkSceneCast(s, n, c) {
  const p = [];
  const cast = s?.cast;
  if (cast !== undefined) {
    if (!Array.isArray(cast) || cast.some((id) => typeof id !== 'string')) p.push(`scene ${n}: cast must be a list of cast ids (["friend-bo"] or [])`);
    else {
      if (cast.length > c.cast.max_per_scene) p.push(`scene ${n}: at most ${c.cast.max_per_scene} cast member(s) (has ${cast.length})`);
      if (new Set(cast).size !== cast.length) p.push(`scene ${n}: cast lists the same id twice`);
      for (const id of cast) {
        if (id === c.hero) p.push(`scene ${n}: the hero "${c.hero}" is in every scene, never listed in cast`);
        else if (!c.cast.members[id]) p.push(`scene ${n}: unknown cast id "${id}" (not in ${c.rel ?? `concept/${c.id}`}/cast.json)`);
      }
    }
  }
  const listed = Array.isArray(cast) ? cast : [];
  const image = [s?.image, s?.place].filter((x) => typeof x === 'string').join(' '); // a secondary named in place needs its id too
  for (const [id, m] of Object.entries(c.cast.members)) {
    if (id === c.hero || !isStr(m.name) || listed.includes(id)) continue;
    if (nameRe(m.name).test(image)) p.push(`scene ${n}: ${m.name} is in the image but "${id}" is not in cast`);
  }
  return p;
}

/** scenes[n].place (2026-10-25): the same still WITHOUT the hero (the place, the main object, the light, a cast member or background
 *  group the image names). make-short.mjs paints it around the hero pasted from her sheet when concept.json image.paint_around is true;
 *  the hero's name there would draw her twice. Absent = accepted (the stock; make-short cuts the image text instead). */
function checkScenePlace(s, n, c) {
  const place = s?.place;
  if (place === undefined) return [];
  if (typeof place !== 'string' || words(place) < 3 || words(place) > 60) return [`scene ${n}: place must be 3 to 60 words: the place, the main object and the light, without the hero`];
  if (FORBIDDEN_IN_IMAGE.test(place)) return [`scene ${n}: the place description asks for text, letters or a logo`];
  // The hero's name in any case, and the pronouns that point at the hero, draw the hero twice just the same.
  const hero = isStr(c.hero_name) ? new RegExp(nameRe(c.hero_name).source, 'iu') : null;
  const pronoun = heroPronoun(c);
  if ((hero && hero.test(place)) || (pronoun && pronoun.test(place))) return [`scene ${n}: place describes the scene without ${c.hero_name ?? 'the hero'} (no name, no pronoun for the hero: the code pastes the hero from the pose sheet; naming the hero draws the hero twice)`];
  return [];
}

/** scenes[n].shot: { framing, view, pose } from the three lists of core/concept.mjs. Absent = accepted (framingOf() is the fallback). */
function checkSceneShot(s, n) {
  const shot = s?.shot;
  if (shot === undefined) return [];
  if (!isObj(shot) || !FRAMINGS.includes(shot.framing) || !VIEWS.includes(shot.view) || !POSES.includes(shot.pose)) {
    return [`scene ${n}: shot must be { framing: ${FRAMINGS.join('|')}, view: ${VIEWS.join('|')}, pose: ${POSES.join('|')} }`];
  }
  return [];
}

/** Returns a list of problems (empty = the story passes). `c` = the loaded concept (core/concept.mjs loadConcept) the story is checked
 *  against; when absent, the concept of the story (its "concept" field, else the video's on disk, else the active one). */
export function checkStory(story, c) {
  if (!story || typeof story !== 'object' || Array.isArray(story)) return ['story.json must be an object'];
  const resolved = c ? { concept: c } : conceptOfStory(story);
  if (!resolved.concept) return [resolved.problem];
  const { concept } = resolved;
  const p = [];
  const r = rulesOf(concept);
  const f = concept.format;
  const hook = titlePattern(concept);
  const conceptFile = `${concept.rel ?? `concept/${concept.id}`}/concept.json`;
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(String(story.id ?? ''))) p.push('id: lowercase letters, digits and dashes');
  // "concept" absent is tolerated (the stock before `stamp`); present and different from the concept checked against is an error.
  if (story.concept !== undefined && story.concept !== concept.id) p.push(`concept must be "${concept.id}" (this video's concept)`);
  const title = String(story.title ?? '').trim();
  if (!hook.test(title)) p.push(isStr(f.hook_regex) ? `title must match /${f.hook_regex}/i` : isStr(f.hook_prefix) ? `title must start with "${f.hook_prefix}"` : 'title missing');
  if (!madeBeforeTitleRules(story.id)) {
    if (title.length > r.titleMaxChars) p.push(`title must be ${r.titleMaxChars} characters or fewer (YouTube cuts longer titles; this one has ${title.length})`);
    if (r.titleEndsWith && !title.endsWith(r.titleEndsWith)) p.push(`title must end with "${r.titleEndsWith}"`);
  }
  // 2026-10-24 (review M31): hashtags about THIS story (optional for older stories); the code adds the concept's own tags
  // (concept.json "hashtags", per network) itself, so those are refused here along with the bait tags (e.g. #Shorts).
  if (story.hashtags !== undefined) {
    const tags = Array.isArray(story.hashtags) ? story.hashtags.map(String) : null;
    const added = conceptTags(concept);
    if (!tags || tags.length < 3 || tags.length > 5 || tags.some((h) => !/^#[A-Za-z][A-Za-z0-9]{1,29}$/.test(h))) p.push('hashtags: 3 to 5 tags like "#LaundryDay" (letters and digits only)');
    else if (tags.some((h) => BAIT_TAG.test(h) || added.has(h.toLowerCase()))) p.push(`hashtags: no bait or generic tags (#reels, #fyp, #viral, #Shorts and the concept's own ${[...added].join(' ')} are added by the code or refused)`);
  }
  // The voice is not checked: make-short.mjs uses the narrator of the video's concept (concept.json voice), whatever story.json says.
  for (const k of ['hero_lock', 'palette', 'style']) if (story[k] !== concept[k]) p.push(`${k} must be copied unchanged from ${conceptFile}`);
  const scenes = Array.isArray(story.scenes) ? story.scenes : [];
  if (scenes.length < r.minScenes || scenes.length > r.maxScenes) p.push(`${r.minScenes}-${r.maxScenes} scenes (has ${scenes.length})`);
  scenes.forEach((s, i) => {
    const n = i + 1;
    if (!s?.text || typeof s.text !== 'string') p.push(`scene ${n}: text missing`);
    else if (words(s.text) > r.maxWordsPerLine) p.push(`scene ${n}: ${words(s.text)} words, at most ${r.maxWordsPerLine}`);
    if (!s?.image || typeof s.image !== 'string') p.push(`scene ${n}: image missing`);
    else if (FORBIDDEN_IN_IMAGE.test(s.image)) p.push(`scene ${n}: the image description asks for text, letters or a logo`);
    p.push(...checkSceneCast(s, n, concept), ...checkSceneShot(s, n), ...checkScenePlace(s, n, concept));
  });
  // Framing across the story (concept.json "prompt"): at most max_full_body full-body scenes; scene 1 = scene1_framing when it says its shot.
  const fullShots = scenes.filter((s) => s?.shot?.framing === 'full').length;
  if (fullShots > concept.prompt.max_full_body) p.push(`at most ${concept.prompt.max_full_body} full-body scene(s) (has ${fullShots})`);
  const first = scenes[0]?.shot?.framing;
  if (FRAMINGS.includes(first) && first !== concept.prompt.scene1_framing) p.push(`scene 1 must be a ${concept.prompt.scene1_framing} shot (has ${first})`);
  const total = scenes.reduce((n, s) => n + words(s?.text), 0);
  if (scenes.length && (total < r.minWords || total > r.maxWords)) p.push(`narration ${total} words, aim ${r.minWords}-${r.maxWords} (${r.seconds.join('-')} s)`);
  if (scenes[0]?.text && !hook.test(scenes[0].text)) p.push(isStr(f.hook_regex) ? `scene 1 must be the hook question (matching /${f.hook_regex}/i)` : `scene 1 must be the "${f.hook_prefix ?? ''}…" question`);
  if (f.last_scene_question && scenes.length && !/\?/.test(scenes.at(-1)?.text ?? '')) p.push('the last scene must ask the viewer a question');
  return p;
}
