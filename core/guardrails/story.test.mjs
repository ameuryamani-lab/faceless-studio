// Faceless Studio: tests of core/guardrails/story.mjs (checkStory under the video's concept). Run: node --no-warnings core/guardrails/story.test.mjs
// Read-only: it reads the owner's media/s-*/story.json when there are some (the regression test of the stock, under each video's own
// concept) and never writes a file nor opens the database (checkStory does not log events). The synthetic cases use an invented concept
// built in memory from DEFAULTS (no show of anyone: hero "Tess", cast "Bo" and "Élodie"), so a fresh install with no concept yet, or a
// later edit of the owner's cast.json by character_keeper, cannot move these tests.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, conceptOf } from '../concept.mjs';
import { STORY_RULES, checkStory, rulesOf } from './story.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MEDIA = path.resolve(ROOT, process.env.STUDIO_MEDIA || 'media');

let passed = 0, failed = 0, skipped = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
/** A check that needs data a fresh install does not have: printed, never counted as a failure. */
function skip(name, reason) { skipped++; console.log(`skip: ${reason} (${name})`); }
const has = (problems, re) => problems.some((x) => re.test(x));
const only = (problems, re) => problems.length === 1 && re.test(problems[0]);
const words = (s) => s.trim().split(/\s+/).length;

// ---------- the stock: every media/s-*/story.json passes under its own concept ----------
const STOCK = (existsSync(MEDIA) ? readdirSync(MEDIA) : []).filter((d) => /^s-\d{8}-\d{4}$/.test(d) && existsSync(path.join(MEDIA, d, 'story.json'))).sort();
const readStory = (d) => JSON.parse(readFileSync(path.join(MEDIA, d, 'story.json'), 'utf8'));
// Ids of published stories the owner documents as carrying an older style text (a published video's story.json is never rewritten).
// Comma-separated in STUDIO_KNOWN_STYLE_DRIFT; empty by default.
const KNOWN_STYLE_DRIFT = new Set(String(process.env.STUDIO_KNOWN_STYLE_DRIFT ?? '').split(',').map((s) => s.trim()).filter(Boolean));

// A fresh install has no published stock: the stock checks are skipped, not failed.
const NO_STOCK = STOCK.length === 0 ? `no media/s-* video folder with a story.json in ${MEDIA} (fresh install)` : null;
const stockTest = (name, fn) => (NO_STOCK ? skip(name, NO_STOCK) : test(name, fn));
stockTest(`the stock (${STOCK.length} story.json) passes checkStory under its concept, old titles included`, () => {
  const failures = [];
  for (const d of STOCK) {
    const story = readStory(d);
    const c = conceptOf(d);
    assert.ok(c, `${d}: conceptOf gives a concept`);
    const problems = checkStory(story, c);
    const expected = KNOWN_STYLE_DRIFT.has(d) ? [`style must be copied unchanged from ${c.rel}/concept.json`] : [];
    if (JSON.stringify(problems) !== JSON.stringify(expected)) failures.push(`${d}: ${problems.join('; ') || '(none)'}`);
  }
  assert.deepEqual(failures, []);
});
stockTest('the stock: checkStory without a concept resolves the same one (story.concept, else the video on disk, else legacy)', () => {
  for (const d of STOCK) {
    const story = readStory(d);
    assert.deepEqual(checkStory(story), checkStory(story, conceptOf(d)), d);
  }
});
stockTest('the stock: titles longer than the limit are still accepted when made before the title rules', () => {
  for (const d of STOCK.filter((x) => readStory(x).title.trim().length > 52 && x.slice(2) < '20261024-1900')) assert.ok(!has(checkStory(readStory(d)), /title must be/), d);
});

// ---------- an invented concept + story (new rules) ----------
const HERO_LOCK = 'Tess, a short adult woman in her fifties, grey braid, blue overalls, red clogs';
const STYLE = 'flat paper cut-out illustration, simple cartoon character with thick outlines, detailed watercolour background, soft daylight, no text, no letters, no words, no writing, no signs, no watermark';
const C = {
  id: 'test-show', rel: 'concept/test-show', name: 'Test show', hero: 'tess', hero_name: 'Tess', hero_pronouns: 'she', hero_lock: HERO_LOCK,
  palette: 'teal and orange', style: STYLE, voice: { ...DEFAULTS.voice, id: 'bf_emma' },
  image: { ...DEFAULTS.image },
  format: { ...DEFAULTS.format, hook_prefix: 'Imagine', hook_regex: null, scenes: [8, 12], words: [90, 140], max_words_per_line: 18, title_max_chars: 52, title_ends_with: '?', last_scene_question: true },
  prompt: { ...DEFAULTS.prompt, scene1_framing: 'closeup', max_full_body: 2 },
  hashtags: { youtube: ['#Shorts', '#Storytime', '#PaperTales'], instagram: ['#storytime', '#papertales', '#shortstory'], tiktok: ['#storytime', '#papertales', '#animation'] },
  cast: {
    ...DEFAULTS.cast, max_per_scene: 1,
    members: {
      tess: { name: 'Tess', role: 'hero', lock: HERO_LOCK, never_changes: ['grey braid'], sheet: null, views: [] },
      'colleague-bo': { name: 'Bo', role: 'colleague', lock: 'Bo, a round man with a bright green scarf and a bowler hat', never_changes: [], sheet: null, views: [] },
      'boss-elodie': { name: 'Élodie', role: 'boss', lock: 'Élodie, a stern woman with a tight bun and a black coat', never_changes: [], sheet: null, views: [] },
    },
  },
};
const TEXTS = [
  'Imagine your umbrella only opened for strangers, and never once for you?',
  'You press the button at the bus stop and it stays shut tight.',
  'A stranger walks past, and the umbrella blooms open over their head.',
  'You try again at lunch, and it folds itself into a tiny knot.',
  'By evening it has sheltered a dog, a mailbox and a stack of newspapers.',
  'Someone ties a ribbon around the handle as a small thank you.',
  'The whole street starts waiting under your umbrella, and nobody gets wet.',
  'You walk home soaked and smiling, because the street finally talks to itself.',
  'At your door the umbrella opens, just once, right over your head.',
  'So tell me, what would your umbrella refuse to do for you?',
];
const IMAGES = [
  'close-up of Tess frowning at a closed yellow umbrella held against her chest, rainy bus stop',
  'Tess pressing the button of the closed umbrella at a bus stop, grey rain',
  'the yellow umbrella open over a stranger in a long raincoat, Tess watching from the kerb',
  'the umbrella folded into a tight knot on a cafe table, Tess staring at it, midday light',
  'the open umbrella sheltering a small dog and a red mailbox, Tess peeking from a doorway',
  'a ribbon tied around the umbrella handle, Tess looking puzzled, warm afternoon light',
  'full body shot of a street of people under one huge yellow umbrella, Tess in the middle',
  'Tess walking home in the rain, hair wet, smiling, cool street lamp light',
  'close view of the umbrella opening over Tess at her front door, evening light',
  'close-up of Tess smiling at the viewer with the umbrella behind her, evening light',
];
const BASE = {
  id: 's-20991101-0100', concept: C.id, title: 'Imagine your umbrella only opened for strangers?', voice: C.voice.id, speed: C.voice.speed, seed: 9001,
  hero_lock: C.hero_lock, palette: C.palette, style: C.style, hashtags: ['#RainyDay', '#Umbrella', '#CityLife'],
  scenes: TEXTS.map((text, i) => ({ text, image: IMAGES[i] })),
};
const TOTAL_WORDS = TEXTS.reduce((n, t) => n + words(t), 0);
const OLD_ID = 's-20250101-0900'; // an invented id dated before the title rules (2026-10-24 19:00)
const SHOT = (framing = 'waist') => ({ framing, view: 'front', pose: 'standing' });
const withShots = (story = BASE) => ({ ...story, scenes: story.scenes.map((s, i) => ({ ...s, shot: SHOT(i === 0 ? 'closeup' : 'waist'), cast: [] })) });
const scene = (story, i, patch) => ({ ...story, scenes: story.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

test('a new story without shot, cast or concept is accepted', () => {
  const { concept, ...noConcept } = BASE;
  assert.deepEqual(checkStory(noConcept, C), []);
  assert.deepEqual(checkStory(BASE, C), []);
});
test('a new story with shot and cast on every scene is accepted', () => {
  assert.deepEqual(checkStory(withShots(), C), []);
  assert.deepEqual(checkStory(scene(withShots(), 3, { cast: ['colleague-bo'], image: 'Bo shrugs beside the umbrella, Tess laughing, morning light' }), C), []);
});
test('a story that is not an object is refused', () => {
  assert.deepEqual(checkStory(null), ['story.json must be an object']);
  assert.deepEqual(checkStory([1], C), ['story.json must be an object']);
});

// cast
test('cast: more than max_per_scene ids refused', () => {
  const p = checkStory(scene(withShots(), 3, { cast: ['colleague-bo', 'boss-elodie'] }), C);
  assert.ok(has(p, /scene 4: at most 1 cast member\(s\) \(has 2\)/), p.join('; '));
});
test('cast: an id missing from cast.json refused', () => {
  assert.ok(only(checkStory(scene(withShots(), 3, { cast: ['uncle-bob'] }), C), /scene 4: unknown cast id "uncle-bob"/));
});
test('cast: the hero is never listed (she is in every scene)', () => {
  assert.ok(only(checkStory(scene(withShots(), 3, { cast: [C.hero] }), C), /scene 4: the hero .* never listed in cast/));
});
test('cast: a first name in the image without its id in cast refused (also possessive and accented names)', () => {
  assert.ok(only(checkStory(scene(withShots(), 3, { image: 'Bo shrugs beside the umbrella, Tess laughing, morning light' }), C), /scene 4: Bo is in the image but "colleague-bo" is not in cast/));
  assert.ok(only(checkStory(scene(BASE, 3, { image: "Bo's scarf on the umbrella, Tess laughing, morning light" }), C), /Bo is in the image/), 'possessive, cast absent');
  assert.ok(only(checkStory(scene(BASE, 3, { image: 'Élodie frowning at the umbrella from her office window, Tess below' }), C), /Élodie is in the image but "boss-elodie"/));
  assert.deepEqual(checkStory(scene(BASE, 3, { image: 'Boris the cat sleeping under the umbrella, Tess watching, morning light' }), C), [], 'a longer word is not the name');
});
test('cast: not a list, or the same id twice, refused', () => {
  assert.ok(has(checkStory(scene(withShots(), 3, { cast: 'colleague-bo' }), C), /scene 4: cast must be a list/));
  const two = { ...C, cast: { ...C.cast, max_per_scene: 2 } };
  assert.ok(has(checkStory(scene(withShots(), 3, { cast: ['colleague-bo', 'colleague-bo'] }), two), /scene 4: cast lists the same id twice/));
});

// shot
test('shot: a value outside the lists refused', () => {
  assert.ok(only(checkStory(scene(withShots(), 3, { shot: { framing: 'wide', view: 'front', pose: 'standing' } }), C), /scene 4: shot must be \{ framing: closeup\|waist\|full, view: front\|three-quarter\|profile\|back, pose: standing\|sitting\|walking\|hands-out \}/));
  assert.ok(only(checkStory(scene(withShots(), 3, { shot: { framing: 'waist', view: 'top', pose: 'standing' } }), C), /scene 4: shot must be/));
  assert.ok(only(checkStory(scene(withShots(), 3, { shot: { framing: 'waist', view: 'front', pose: 'flying' } }), C), /scene 4: shot must be/));
  assert.ok(only(checkStory(scene(withShots(), 3, { shot: 'waist' }), C), /scene 4: shot must be/));
});
test('shot: more than max_full_body full-body scenes refused, exactly max accepted', () => {
  let s = withShots();
  for (const i of [2, 6]) s = scene(s, i, { shot: SHOT('full') });
  assert.deepEqual(checkStory(s, C), []);
  s = scene(s, 7, { shot: SHOT('full') });
  assert.ok(only(checkStory(s, C), /at most 2 full-body scene\(s\) \(has 3\)/));
});
test('shot: scene 1 must have the concept\'s scene1_framing when it says its shot', () => {
  assert.ok(only(checkStory(scene(withShots(), 0, { shot: SHOT('waist') }), C), /scene 1 must be a closeup shot \(has waist\)/));
  assert.deepEqual(checkStory(scene(withShots(), 0, { shot: SHOT('waist') }), { ...C, prompt: { ...C.prompt, scene1_framing: 'waist' } }), []);
});

// concept
test('concept: a different id than the concept checked against refused', () => {
  assert.ok(only(checkStory({ ...BASE, concept: 'other-show' }, C), /concept must be "test-show" \(this video's concept\)/));
});
test('concept: without a concept argument, an unknown story.concept is one problem, not a crash', () => {
  const p = checkStory({ ...BASE, concept: 'nope-concept' });
  assert.ok(only(p, /^concept "nope-concept" cannot be loaded: .*introuvable/), p.join('; '));
});

// hero fields
test('hero_lock, palette and style must be copied from concept/<id>/concept.json', () => {
  const p = checkStory({ ...BASE, style: 'flat vector' }, C);
  assert.ok(only(p, /^style must be copied unchanged from concept\/test-show\/concept\.json$/), p.join('; '));
  assert.ok(only(checkStory({ ...BASE, hero_lock: 'Tess, a woman' }, C), /hero_lock must be copied unchanged/));
});

// title
test('title: the 52-character limit and the final "?" apply to stories made after 2026-10-24 19:00 studio time only', () => {
  const long = 'Imagine your umbrella argued with every cloud, one drop at a time?';
  assert.ok(long.length > 52);
  const p = checkStory({ ...BASE, title: long }, C);
  assert.ok(only(p, new RegExp(`title must be 52 characters or fewer .*this one has ${long.length}`)), p.join('; '));
  assert.deepEqual(checkStory({ ...BASE, id: OLD_ID, title: long }, C), [], 'an old id keeps the rules of its day');
  assert.ok(has(checkStory({ ...BASE, id: 'r-20991030-2000', title: long }, C), /title must be 52/), 'a rehearsal after the cutoff follows the rule');
  assert.ok(has(checkStory({ ...BASE, id: 'test-story', title: long }, C), /title must be 52/), 'an id without a date follows the rule');
  assert.ok(only(checkStory({ ...BASE, title: 'Imagine your umbrella only opened for strangers' }, C), /title must end with "\?"/));
});
test('title: must start with hook_prefix; scene 1 is the hook question; the last scene asks a question', () => {
  assert.ok(only(checkStory({ ...BASE, title: 'Suppose your umbrella only opened for strangers?' }, C), /title must start with "Imagine"/));
  assert.ok(only(checkStory(scene(BASE, 0, { text: 'Your umbrella only opened for strangers, and never once for you.' }), C), /scene 1 must be the "Imagine…" question/));
  assert.ok(only(checkStory(scene(BASE, 9, { text: 'So you keep the umbrella, and the street keeps dry.' }), C), /the last scene must ask the viewer a question/));
});
test('title: a concept with hook_regex accepts a title matching it and refuses the old prefix', () => {
  const riddle = { ...C, format: { ...C.format, hook_prefix: null, hook_regex: '^(Who|Why|Where)\\b', title_ends_with: null, last_scene_question: false } };
  const story = scene(scene({ ...BASE, title: 'Who taught your umbrella manners' }, 0, { text: 'Who taught your umbrella to open for strangers, and why only them?' }), 9, { text: 'So you keep the umbrella, and the street keeps dry.' });
  assert.deepEqual(checkStory(story, riddle), []);
  const p = checkStory({ ...story, title: BASE.title }, riddle);
  assert.ok(only(p, /title must match \/\^\(Who\|Why\|Where\)\\b\/i/), p.join('; '));
  assert.ok(has(checkStory(scene(story, 0, { text: 'Imagine your umbrella only opened for strangers every morning?' }), riddle), /scene 1 must be the hook question \(matching/));
});
test('title: no final "?" required when title_ends_with is null (hook_prefix kept)', () => {
  const free = { ...C, format: { ...C.format, title_ends_with: null } };
  assert.deepEqual(checkStory({ ...BASE, title: 'Imagine your umbrella only opened for strangers' }, free), []);
  assert.ok(has(checkStory({ ...BASE, title: `Imagine ${'x'.repeat(50)}` }, free), /title must be 52 characters or fewer/), 'the length still applies');
});

// counts
test('STORY_RULES are today\'s defaults; rulesOf(c) follows the concept\'s format', () => {
  assert.deepEqual({ ...STORY_RULES }, { minScenes: 8, maxScenes: 12, maxWordsPerLine: 18, minWords: 90, maxWords: 140, seconds: [45, 60], titleMaxChars: 52, titleEndsWith: null });
  assert.ok(Object.isFrozen(STORY_RULES));
  const short = { ...C, format: { ...C.format, scenes: [3, 5], words: [20, 60], max_words_per_line: 10, seconds: [15, 25], title_max_chars: 30, title_ends_with: null } };
  assert.deepEqual(rulesOf(short), { minScenes: 3, maxScenes: 5, maxWordsPerLine: 10, minWords: 20, maxWords: 60, seconds: [15, 25], titleMaxChars: 30, titleEndsWith: null });
  const p = checkStory(BASE, short);
  assert.ok(has(p, /^3-5 scenes \(has 10\)$/), p.join('; '));
  assert.ok(has(p, new RegExp(`narration ${TOTAL_WORDS} words, aim 20-60 \\(15-25 s\\)`)), p.join('; '));
  assert.ok(has(p, new RegExp(`scene 1: ${words(TEXTS[0])} words, at most 10`)), p.join('; '));
  assert.ok(has(p, /title must be 30 characters or fewer/), p.join('; '));
});
test('scenes: text and image required, no text/letters/logo asked in an image', () => {
  const p = checkStory(scene(BASE, 4, { text: '', image: 'a sign that reads OPEN above the umbrella' }), C);
  assert.ok(has(p, /scene 5: text missing/) && has(p, /scene 5: the image description asks for text, letters or a logo/), p.join('; '));
});

// hashtags (rules of 2026-10-24 kept)
test('hashtags: 3 to 5 clean tags, no bait or code-added tags', () => {
  assert.ok(only(checkStory({ ...BASE, hashtags: ['#A1', '#B2'] }, C), /hashtags: 3 to 5 tags/));
  assert.ok(only(checkStory({ ...BASE, hashtags: ['#RainyDay', '#Umbrella', '#reels'] }, C), /hashtags: no bait or generic tags/));
  assert.ok(only(checkStory({ ...BASE, hashtags: ['#RainyDay', '#Umbrella', '#Shorts'] }, C), /hashtags: no bait or generic tags/));
  const { hashtags, ...none } = BASE;
  assert.deepEqual(checkStory(none, C), [], 'hashtags optional');
});

// 2026-10-25: scenes[].place, the still without the hero (painted around the hero's sheet when concept.json image.paint_around is true).
test('place: optional, 3 to 60 words, never the hero\'s name, no text words, a named member needs its id', () => {
  const withPlace = (place, extra = {}) => ({ ...BASE, scenes: BASE.scenes.map((s, i) => (i === 1 ? { ...s, place, ...extra } : s)) });
  assert.deepEqual(checkStory(withPlace('a big white microwave drawn large on the left of the frame, office kitchen, warm light'), C), []);
  assert.ok(only(checkStory(withPlace('kitchen'), C), /scene 2: place must be 3 to 60 words/));
  assert.ok(only(checkStory(withPlace(`${C.hero_name} beside a big white microwave, office kitchen`), C), /scene 2: place describes the scene without/));
  assert.ok(only(checkStory(withPlace(`${C.hero_name.toUpperCase()} beside a big white microwave, office kitchen`), C), /scene 2: place describes the scene without/), 'any case');
  assert.ok(only(checkStory(withPlace('a big white microwave beside her, office kitchen, warm light'), C), /scene 2: place describes the scene without/), 'pronoun');
  assert.deepEqual(checkStory(withPlace('a big white microwave with a shepherd pie inside, office kitchen'), C), [], '"she" inside a word is fine');
  assert.ok(only(checkStory(withPlace('a microwave with a sign that reads lunch, office kitchen'), C), /scene 2: the place description asks for text/));
  assert.ok(has(checkStory(withPlace('Bo waits beside a big white microwave, office kitchen'), C), /Bo is in the image but/));
});

// 2026-10-25 (step 8): the tags the code adds are the concept's own (concept.json "hashtags"), not a fixed list.
test('hashtags: the concept\'s own tags are refused, whatever the concept', () => {
  const own = Object.values(C.hashtags).flat().find((h) => !/^#shorts$/i.test(h));
  assert.ok(only(checkStory({ ...BASE, hashtags: ['#RainyDay', '#Umbrella', own.toLowerCase()] }, C), /hashtags: no bait or generic tags/), own);
  const other = { ...C, hashtags: { youtube: ['#Shorts', '#LifeHack', '#Tips'], instagram: ['#lifehack', '#tips', '#howto'], tiktok: ['#lifehack', '#tips', '#howto'] } };
  assert.deepEqual(checkStory({ ...BASE, hashtags: ['#RainyDay', '#Umbrella', '#PaperTales'] }, other), [], '#PaperTales is a story tag for another show');
  assert.ok(only(checkStory({ ...BASE, hashtags: ['#RainyDay', '#Umbrella', '#HowTo'] }, other), /hashtags: no bait or generic tags/));
});

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
