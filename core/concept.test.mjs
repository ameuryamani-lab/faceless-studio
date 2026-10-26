// Faceless Studio: tests of core/concept.mjs against throwaway folders in media/_test (never the real concept/ or media/).
// Run: node --no-warnings core/concept.test.mjs
// Isolation (same idea as core/test-mcp.mjs with STUDIO_DB / STUDIO_MEDIA / STUDIO_BRAND_DIR): STUDIO_CONCEPT_DIR points at
// media/_test/concept, STUDIO_MEDIA at media/_test/concept-media, STUDIO_DB and STUDIO_DECISIONS at files of our own. The env is
// set BEFORE the module is imported (dynamic import), because db.mjs reads STUDIO_DB when it loads.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST = path.join(ROOT, 'media', '_test');
const CONCEPTS = path.join(TEST, 'concept');
const MEDIA = path.join(TEST, 'concept-media');
for (const d of [CONCEPTS, MEDIA]) rmSync(d, { recursive: true, force: true }); // our own throwaway folders only
for (const f of ['concept-test.db', 'concept-test.db-wal', 'concept-test.db-shm', 'concept-decisions.jsonl']) rmSync(path.join(TEST, f), { force: true });
const ENV = {
  STUDIO_CONCEPT_DIR: 'media/_test/concept', STUDIO_MEDIA: 'media/_test/concept-media',
  STUDIO_DB: path.join(TEST, 'concept-test.db'), STUDIO_DECISIONS: path.join(TEST, 'concept-decisions.jsonl'),
};
Object.assign(process.env, ENV);
delete process.env.STUDIO_CONCEPT;

const json = (file, obj) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`); };
const touch = (file, text = '') => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const cdir = (id) => path.join(CONCEPTS, id);

// ---------- fixtures ----------
const MINA_LOCK = 'Mina, a tall adult woman in her thirties, curly black hair, yellow raincoat, green boots';
const TESS_LOCK = 'Tess, a short adult woman in her fifties, grey braid, blue overalls, red clogs';
json(path.join(CONCEPTS, 'active.json'), { id: 'test-mini', legacy: 'test-mini', since: '2026-10-24T00:00:00Z', by: 'test' });
// minimal: only the five required fields -> everything else comes from DEFAULTS; hero "mina" derived from the lock
json(path.join(cdir('test-mini'), 'concept.json'), { id: 'test-mini', voice: { id: 'af_heart' }, hero_lock: MINA_LOCK, style: 'flat vector style', palette: 'yellow and grey' });
// full: a hook regex, its own hashtags, a cast with sheets and a declared view
json(path.join(cdir('test-full'), 'concept.json'), {
  id: 'test-full', hero: 'tess', hero_name: 'Tess', hero_lock: TESS_LOCK, style: 'paper cut-out style', palette: 'blue and red',
  voice: { id: 'bf_emma', speed: 1 }, image: { ref_denoise: 0.8 },
  format: { hook_prefix: null, hook_regex: '^(Who|Why|Where)\\b', last_scene_question: false, title_ends_with: null },
  hashtags: { youtube: ['#Shorts', '#Riddle', '#Cartoon'], instagram: ['#riddle', '#cartoon', '#shortstory'], tiktok: ['#riddle', '#cartoon', '#animation'] },
  yt_tags: ['riddle'],
});
const FULL_CAST = {
  concept: 'test-full', hero: 'tess', max_per_scene: 2,
  members: {
    tess: { name: 'Tess', role: 'hero', lock: '(copied by code)', never_changes: ['grey braid'], sheet: 'cast/tess/sheet.png', views: [{ file: 'cast/tess/special.png', framing: 'waist', view: 'profile', pose: 'standing' }] },
    'friend-bo': { name: 'Bo', role: 'friend', lock: 'Bo, a round man with a bright green scarf and a bowler hat', never_changes: ['green scarf'], sheet: null, views: [] },
    'boss-ada': { name: 'Ada', role: 'boss', lock: 'Ada, a stern woman with a tight bun and a black coat', never_changes: ['bun'], sheet: null, views: [] },
    'kid-next-door': { name: 'Lou', role: 'neighbour', lock: 'Lou, a young adult with a striped jumper and a skateboard', never_changes: ['striped jumper'], sheet: null, views: [] },
  },
  _by: 'test fixture',
};
json(path.join(cdir('test-full'), 'cast.json'), FULL_CAST);
touch(path.join(cdir('test-full'), 'rules.md'), '# rules\n');
for (const f of ['sheet', 'closeup-front', 'waist-front', 'full-front', 'sitting-waist', 'special']) touch(path.join(cdir('test-full'), 'cast', 'tess', `${f}.png`));
// archived concept, found under _archive/
json(path.join(CONCEPTS, '_archive', 'test-old', 'concept.json'), { id: 'test-old', voice: { id: 'am_puck' }, hero_lock: 'Olaf, an old man with a white moustache and a brown hat', style: 's', palette: 'p' });
// example concept (concept/_exemples/): `check` finds it, `activate` refuses it in place, listConcepts skips it
json(path.join(CONCEPTS, '_exemples', 'test-demo', 'concept.json'), { id: 'test-demo', voice: { id: 'am_puck' }, hero_lock: 'Dan, a round man with a blue cap and a red apron', style: 's', palette: 'p' });
touch(path.join(CONCEPTS, '_exemples', 'test-demo', 'rules.md'), '# rules\n');
for (const f of ['closeup-front', 'waist-front', 'full-front']) touch(path.join(CONCEPTS, '_exemples', 'test-demo', 'cast', 'dan', `${f}.png`));
// a hero without a cast folder: no sheet at all (no legacy model-sheet fallback)
json(path.join(cdir('test-rafe'), 'concept.json'), { id: 'test-rafe', voice: { id: 'bm_george' }, hero_lock: 'Rafe, a stocky adult man in his sixties, bald head, green cardigan, brown loafers', style: 's', palette: 'p' });
// faulty: several wrong fields at once -> one French error naming each
json(path.join(cdir('test-bad'), 'concept.json'), { id: 'test-bad', voice: { id: 'am_puck' }, hero_lock: 'Zed, a man', style: 's', palette: 'p', image: { ref_denoise: 1.5, paint_around: 'yes', blend_denoise: 0 }, format: { scenes: [12, 8] }, hashtags: { youtube: ['#Shorts'] } });
// videos: one without "concept" (legacy), one with, one without story.json, one chain in progress
json(path.join(MEDIA, 's-20991231-0001', 'story.json'), { id: 's-20991231-0001', title: 'A title x?', scenes: [] });
json(path.join(MEDIA, 's-20991231-0002', 'story.json'), { id: 's-20991231-0002', concept: 'test-full', title: 'Who x?', scenes: [] });
mkdirSync(path.join(MEDIA, 'ep99-nothing'), { recursive: true });
touch(path.join(MEDIA, 's-20991231-0003', 'chain', 'start.txt'), '2099-12-31T00:00:00Z');

const concept = await import('./concept.mjs');
const { DEFAULTS, activeConceptId, loadConcept, conceptOf, conceptIdOf, titlePattern, pickPattern, esc, castSheet, castLock, castViews, missingHeroViews, checkCast, activateConcept, activationBlockers, chainsInProgress, stampStories, listConcepts, clearConceptCache } = concept;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const RE_FRENCH = /invalide|introuvable|manquant|refusé|en cours/;

// ---------- active concept ----------
test('activeConceptId reads concept/active.json, STUDIO_CONCEPT overrides it', () => {
  assert.equal(activeConceptId(), 'test-mini');
  process.env.STUDIO_CONCEPT = 'test-full';
  assert.equal(activeConceptId(), 'test-full');
  delete process.env.STUDIO_CONCEPT;
  assert.equal(activeConceptId(), 'test-mini');
});
test('listConcepts lists the folders with a concept.json, archived apart', () => {
  assert.deepEqual(listConcepts(), ['test-bad', 'test-full', 'test-mini', 'test-rafe']);
  assert.deepEqual(listConcepts({ archived: true }), ['test-old']);
});

// ---------- DEFAULTS ----------
test('a minimal concept gets today\'s values for every missing field', () => {
  const c = loadConcept('test-mini');
  assert.equal(c.id, 'test-mini');
  assert.equal(c.hero, 'mina', 'hero id derived from the lock');
  assert.equal(c.hero_name, 'Mina');
  assert.equal(c.voice.id, 'af_heart');
  assert.equal(c.voice.speed, 0.95);
  assert.equal(c.voice.engine, 'kokoro');
  assert.equal(c.image.ref_denoise, 0.72);
  assert.equal(c.image.steps, 9);
  assert.equal(c.image.seed_base, 9000);
  assert.equal(c.image.paint_around, false, '2026-10-25: a concept paints around its hero only when it says so');
  assert.equal(c.image.blend_denoise, 0.6);
  assert.equal(c.format.hook_prefix, null, 'no hook words by default: the hook format is the concept\'s own');
  assert.deepEqual(c.format.scenes, [8, 12]);
  assert.deepEqual(c.format.words, [90, 140]);
  assert.equal(c.format.max_words_per_line, 18);
  assert.equal(c.format.title_max_chars, 52);
  assert.equal(c.format.title_ends_with, null);
  assert.equal(c.format.placeholder_fr, '… (en préparation)');
  assert.equal(c.format.pick_line, 'PICK | … ? | the escalation in one sentence');
  assert.equal(c.prompt.framing.closeup, DEFAULTS.prompt.framing.closeup);
  assert.equal(c.prompt.framing.waist, DEFAULTS.prompt.framing.waist);
  assert.equal(c.prompt.framing.full, 'full body shot');
  assert.equal(c.prompt.hands, DEFAULTS.prompt.hands);
  assert.equal(c.prompt.always, null);
  assert.equal(c.prompt.scene1_framing, 'closeup');
  assert.equal(c.prompt.max_full_body, 2);
  assert.deepEqual(c.hashtags.youtube, DEFAULTS.hashtags.youtube);
  assert.deepEqual(c.hashtags.instagram, DEFAULTS.hashtags.instagram);
  assert.deepEqual(c.hashtags.tiktok, DEFAULTS.hashtags.tiktok);
  assert.deepEqual(c.yt_tags, DEFAULTS.yt_tags);
  assert.equal(c.cast.max_per_scene, 1);
  assert.deepEqual(Object.keys(c.cast.members), ['mina'], 'the hero is always in the cast');
  assert.equal(c.cast.members.mina.lock, MINA_LOCK, 'the hero entry takes hero_lock');
  assert.ok(c.defaulted.includes('image.ref_denoise') && c.defaulted.includes('format.hook_prefix') && c.defaulted.includes('cast.max_per_scene'));
  assert.ok(!c.defaulted.includes('voice.id'));
  assert.ok(Object.isFrozen(c) && Object.isFrozen(c.format), 'a loaded concept is read-only');
  assert.equal(loadConcept('test-mini'), c, 'cached per process');
});
test('a full concept keeps its own values and merges the cast', () => {
  const c = loadConcept('test-full');
  assert.equal(c.hero, 'tess');
  assert.equal(c.voice.speed, 1);
  assert.equal(c.image.ref_denoise, 0.8);
  assert.equal(c.image.steps, 9, 'steps still from DEFAULTS');
  assert.equal(c.format.hook_prefix, null);
  assert.equal(c.format.hook_regex, '^(Who|Why|Where)\\b');
  assert.equal(c.format.last_scene_question, false);
  assert.equal(c.format.placeholder_fr, '… (en préparation)');
  assert.equal(c.format.pick_line, 'PICK | … ? | the escalation in one sentence');
  assert.equal(c.cast.max_per_scene, 2);
  assert.deepEqual(Object.keys(c.cast.members).sort(), ['boss-ada', 'friend-bo', 'kid-next-door', 'tess']);
  assert.equal(c.cast.members.tess.lock, TESS_LOCK, 'the placeholder lock is replaced by hero_lock');
  assert.equal(c.cast.members.tess.sheet, 'cast/tess/sheet.png');
  assert.equal(c.files.rules, true);
  assert.equal(c.files.cast, true);
});
test('an archived concept is found under concept/_archive/', () => {
  const c = loadConcept('test-old');
  assert.equal(c.rel, 'concept/_archive/test-old');
  assert.equal(c.hero, 'olaf');
});
test('an example under concept/_exemples/ loads for `check`, is not listed, and is refused by `activate` in place', () => {
  const c = loadConcept('test-demo');
  assert.equal(c.rel, 'concept/_exemples/test-demo');
  assert.equal(c.hero, 'dan');
  assert.deepEqual(missingHeroViews(c), [], 'its three front views are there');
  assert.ok(!listConcepts().includes('test-demo'), 'examples are not activation candidates for Lester');
  const b = activationBlockers(c);
  assert.equal(b.length, 1, b.join(' | '));
  assert.match(b[0], /est un exemple : le copier en concept\/test-demo\//);
  assert.throws(() => activateConcept('test-demo', 'test'), /refusé[\s\S]*est un exemple/);
  assert.throws(() => loadConcept('nope-nope'), /concept\/_exemples\/nope-nope\/concept\.json/);
});

// ---------- errors in French ----------
test('an unknown concept is an error in French', () => {
  assert.throws(() => loadConcept('nope-nope'), /introuvable/);
  assert.throws(() => loadConcept('nope-nope'), /concept\/nope-nope\/concept\.json/);
  assert.throws(() => loadConcept('Bad Id!'), /identifiant de concept invalide/);
});
test('a faulty concept names every wrong field in French', () => {
  let msg = '';
  try { loadConcept('test-bad'); } catch (e) { msg = e.message; }
  assert.match(msg, /invalide/);
  assert.match(msg, /image\.ref_denoise/);
  assert.match(msg, /image\.paint_around/);
  assert.match(msg, /image\.blend_denoise/);
  assert.match(msg, /format\.scenes/);
  assert.match(msg, /hashtags\.youtube/);
  assert.ok(!/hashtags\.instagram/.test(msg), 'a missing network takes today\'s tags, no error');
  assert.ok(!/hero_lock/.test(msg), 'hero_lock was given');
});
test('conceptOf throws in French when the story names a concept that does not load', () => {
  json(path.join(MEDIA, 's-20991231-0009', 'story.json'), { id: 's-20991231-0009', concept: 'test-bad' });
  assert.throws(() => conceptOf('s-20991231-0009'), RE_FRENCH);
});

// ---------- conceptOf ----------
test('conceptOf: story.json without "concept" = legacy; with = its own; no story.json = null', () => {
  assert.equal(conceptIdOf('s-20991231-0001'), 'test-mini');
  assert.equal(conceptOf('s-20991231-0001').id, 'test-mini');
  assert.equal(conceptOf('s-20991231-0002').id, 'test-full');
  assert.equal(conceptOf('ep99-nothing'), null);
  assert.equal(conceptOf('does-not-exist'), null);
  assert.equal(conceptOf('../etc'), null, 'an unsafe id is never a path');
  assert.equal(conceptOf(null), null);
});

// ---------- hook format ----------
const HOOKED = { format: { hook_prefix: 'Imagine', hook_regex: null } };
test('titlePattern with a prefix: ^Imagine\\b, case-insensitive', () => {
  const re = titlePattern(HOOKED);
  assert.ok(re.test('Imagine your cat kept receipts?'));
  assert.ok(re.test('imagine lowercase?'));
  assert.ok(!re.test('Imagined you do?'));
  assert.ok(!re.test('Suppose a cat?'));
});
test('titlePattern of a concept without hook words: a free opening', () => {
  assert.equal(titlePattern(loadConcept('test-mini')).source, '.');
});
test('titlePattern with hook_regex: the regex wins', () => {
  const re = titlePattern(loadConcept('test-full'));
  assert.ok(re.test('Who left the door open?'));
  assert.ok(re.test('why is the sky green?'));
  assert.ok(!re.test('Imagine the sky were green?'));
});
test('titlePattern without prefix nor regex: /./ (a free opening)', () => {
  const free = { format: { hook_prefix: null, hook_regex: null } };
  assert.equal(titlePattern(free).source, '.');
  assert.ok(titlePattern(free).test('Try this with your keys'));
  assert.ok(pickPattern(free).test('PICK | Try this with your keys | esc'));
});
test('pickPattern: PICK | <hook> | …', () => {
  const hooked = pickPattern(HOOKED);
  assert.ok(hooked.test('PICK | Imagine the crosswalk button wanted a please first? | escalation'));
  assert.ok(hooked.test('  pick|imagine x? | y'));
  assert.ok(!hooked.test('PICK | Suppose x? | y'));
  assert.ok(!hooked.test('IDEA | Imagine x? | y'));
  const full = pickPattern(loadConcept('test-full'));
  assert.ok(full.test('PICK | Who ate the cake? | esc'));
  assert.ok(!full.test('PICK | Imagine x? | esc'));
});
test('esc escapes regex characters', () => {
  assert.equal(esc('Imagine (really)?'), 'Imagine \\(really\\)\\?');
  assert.ok(new RegExp(`^${esc('Try this.')}`).test('Try this. now'));
  assert.ok(!new RegExp(`^${esc('Try this.')}`).test('Try thisX now'));
});

// ---------- cast sheets ----------
test('castSheet: declared view (framing + view) wins', () => {
  const c = loadConcept('test-full');
  assert.equal(path.basename(castSheet(c, 'tess', { framing: 'waist', view: 'profile', pose: 'standing' })), 'special.png');
});
test('castSheet: <pose>-<framing>.png when the pose is not standing', () => {
  const c = loadConcept('test-full');
  assert.equal(path.basename(castSheet(c, 'tess', { framing: 'waist', view: 'front', pose: 'sitting' })), 'sitting-waist.png');
  assert.equal(path.basename(castSheet(c, 'tess', { framing: 'closeup', view: 'front', pose: 'walking' })), 'closeup-front.png', 'no walking-closeup: falls back');
});
test('castSheet: <framing>-<view>.png, else <framing>-front.png', () => {
  const c = loadConcept('test-full');
  assert.equal(path.basename(castSheet(c, 'tess', { framing: 'closeup', view: 'back', pose: 'standing' })), 'closeup-front.png');
  assert.equal(path.basename(castSheet(c, 'tess', { framing: 'full', view: 'front', pose: 'standing' })), 'full-front.png');
  assert.equal(path.basename(castSheet(c, 'tess', { framing: 'full', view: 'back' })), 'full-front.png', 'view and pose default to front / standing');
  // 2026-10-25: a file named for the asked view beats a declared view of another angle (D.3 (1) said the opposite before the pose sheets)
  assert.equal(path.basename(castSheet(c, 'tess', { framing: 'waist' })), 'waist-front.png');
  assert.equal(path.basename(castSheet(c, 'tess', {})), 'waist-front.png', 'framing defaults to waist');
});
test('castSheet: the pose sheets win over declared front views (otherwise a back shot gets full-front.png)', () => {
  const c = loadConcept('test-full');
  const poses = { ...c, cast: { ...c.cast, members: { ...c.cast.members, tess: { ...c.cast.members.tess, views: [
    { file: 'cast/tess/waist-front.png', framing: 'waist', view: 'front', pose: 'standing' },
    { file: 'cast/tess/full-front.png', framing: 'full', view: 'front', pose: 'standing' },
  ] } } } };
  for (const f of ['full-back', 'waist-profile', 'walking-full']) touch(path.join(cdir('test-full'), 'cast', 'tess', `${f}.png`));
  assert.equal(path.basename(castSheet(poses, 'tess', { framing: 'full', view: 'back', pose: 'standing' })), 'full-back.png');
  assert.equal(path.basename(castSheet(poses, 'tess', { framing: 'waist', view: 'profile', pose: 'standing' })), 'waist-profile.png');
  assert.equal(path.basename(castSheet(poses, 'tess', { framing: 'waist', view: 'front', pose: 'sitting' })), 'sitting-waist.png');
  assert.equal(path.basename(castSheet(poses, 'tess', { framing: 'full', view: 'three-quarter', pose: 'walking' })), 'walking-full.png');
  assert.equal(path.basename(castSheet(poses, 'tess', { framing: 'waist', view: 'front', pose: 'standing' })), 'waist-front.png', 'declared exact match');
  assert.equal(path.basename(castSheet(poses, 'tess', { framing: 'full', view: 'three-quarter', pose: 'standing' })), 'full-front.png', 'no file for the angle: the declared pose match');
  for (const f of ['full-back', 'waist-profile', 'walking-full']) rmSync(path.join(cdir('test-full'), 'cast', 'tess', `${f}.png`));
});
test('castSheet: null for a member without any sheet, an unknown member, a hero without a cast folder', () => {
  const c = loadConcept('test-full');
  assert.equal(castSheet(c, 'friend-bo', { framing: 'waist', view: 'front', pose: 'standing' }), null);
  assert.equal(castSheet(c, 'nobody', { framing: 'waist' }), null);
  assert.equal(castSheet(loadConcept('test-mini'), 'mina', { framing: 'closeup', view: 'front', pose: 'standing' }), null, 'Mina has no folder and no legacy sheet');
});
test('castSheet: a hero without a cast folder has no sheet (no legacy model-sheet fallback)', () => {
  assert.equal(castSheet(loadConcept('test-rafe'), 'rafe', { framing: 'closeup', view: 'front', pose: 'standing' }), null);
});
test('castViews and missingHeroViews', () => {
  const c = loadConcept('test-full');
  const names = castViews(c, 'tess').map((v) => path.basename(v.file)).sort();
  assert.deepEqual(names, ['closeup-front.png', 'full-front.png', 'sitting-waist.png', 'special.png', 'waist-front.png']);
  assert.ok(castViews(c, 'tess').find((v) => v.declared && path.basename(v.file) === 'special.png'));
  assert.deepEqual(missingHeroViews(c), []);
  assert.deepEqual(missingHeroViews(loadConcept('test-mini')), ['closeup-front', 'waist-front', 'full-front']);
});
test('castLock: a secondary\'s lock, null for nobody or the hero', () => {
  const c = loadConcept('test-full');
  assert.equal(castLock(c, 'friend-bo'), 'Bo, a round man with a bright green scarf and a bowler hat');
  assert.equal(castLock(c, 'tess'), null);
  assert.equal(castLock(c, undefined), null);
  assert.equal(castLock(c, 'nobody'), null);
});

// ---------- checkCast ----------
const castCopy = () => structuredClone(FULL_CAST);
test('checkCast accepts the cast on disk unchanged', () => {
  assert.deepEqual(checkCast(castCopy(), loadConcept('test-full')), []);
});
test('checkCast refuses an invalid id', () => {
  const cast = castCopy();
  cast.members['Bad_Id'] = { name: 'Zed', role: 'extra', lock: 'Zed, a thin man with a purple tie and a long nose', never_changes: [], sheet: null, views: [] };
  const p = checkCast(cast, loadConcept('test-full'));
  assert.ok(p.some((x) => /member id "Bad_Id"/.test(x)), p.join('; '));
});
test('checkCast refuses a lock that is too short, or asks for text', () => {
  const cast = castCopy();
  cast.members['friend-bo'].lock = 'Bo';
  assert.ok(checkCast(cast, loadConcept('test-full')).some((x) => /friend-bo: lock must be 20 to 300/.test(x)));
  cast.members['friend-bo'].lock = 'Bo, a round man wearing a shirt with the text HELLO on it';
  assert.ok(checkCast(cast, loadConcept('test-full')).some((x) => /friend-bo: lock must not ask for text/.test(x)));
});
test('checkCast refuses a modified or removed hero entry', () => {
  const cast = castCopy();
  cast.members.tess.never_changes = ['grey braid', 'a new hat'];
  assert.ok(checkCast(cast, loadConcept('test-full')).some((x) => /hero entry "tess" must not change/.test(x)));
  const reordered = castCopy();
  reordered.members.tess = { views: FULL_CAST.members.tess.views, sheet: 'cast/tess/sheet.png', never_changes: ['grey braid'], lock: '(copied by code)', role: 'hero', name: 'Tess' };
  assert.deepEqual(checkCast(reordered, loadConcept('test-full')), [], 'key order does not count as a change');
  const gone = castCopy();
  delete gone.members.tess;
  assert.ok(checkCast(gone, loadConcept('test-full')).some((x) => /hero "tess" must stay/.test(x)));
});
test('checkCast refuses max_per_scene 3, fewer than 4 or more than 8 members, a wrong concept', () => {
  const cast = castCopy();
  cast.max_per_scene = 3;
  assert.ok(checkCast(cast, loadConcept('test-full')).some((x) => /max_per_scene/.test(x)));
  const few = castCopy();
  delete few.members['boss-ada'];
  assert.ok(checkCast(few, loadConcept('test-full')).some((x) => /4 to 8 members \(has 3\)/.test(x)));
  const many = castCopy();
  for (let i = 0; i < 5; i++) many.members[`extra-${i}`] = { name: `Extra${i}`, role: 'extra', lock: `Extra ${i}, a plain person in a beige coat and brown shoes`, never_changes: [], sheet: null, views: [] };
  assert.ok(checkCast(many, loadConcept('test-full')).some((x) => /4 to 8 members \(has 9\)/.test(x)));
  const wrong = castCopy();
  wrong.concept = 'test-mini';
  assert.ok(checkCast(wrong, loadConcept('test-full')).some((x) => /concept must be "test-full"/.test(x)));
  assert.deepEqual(checkCast('nope', loadConcept('test-full')), ['cast.json must be an object']);
});

// ---------- activation ----------
test('activationBlockers: missing hero views and rules.md are named in French; test-full is ready', () => {
  const b = activationBlockers(loadConcept('test-mini'));
  assert.equal(b.length, 2, b.join(' | '));
  assert.match(b[0], /vues du héros manquantes/);
  assert.match(b[0], /closeup-front\.png/);
  assert.match(b[1], /rules\.md manque/);
  assert.deepEqual(activationBlockers(loadConcept('test-full')), []);
});
test('activateConcept refuses an incomplete concept before touching anything', () => {
  assert.throws(() => activateConcept('test-mini', 'test'), /refusé[\s\S]*vues du héros manquantes/);
  assert.throws(() => activateConcept('test-bad', 'test'), /invalide/);
  assert.equal(JSON.parse(readFileSync(path.join(CONCEPTS, 'active.json'), 'utf8')).id, 'test-mini');
});
test('activateConcept is refused while a media/s-*/chain/start.txt has no done.txt', () => {
  assert.deepEqual(chainsInProgress(), ['s-20991231-0003']);
  assert.throws(() => activateConcept('test-full', 'test'), /une chaîne est en cours \(s-20991231-0003\)/);
  assert.equal(JSON.parse(readFileSync(path.join(CONCEPTS, 'active.json'), 'utf8')).id, 'test-mini', 'active.json untouched');
  assert.ok(!existsSync(path.join(TEST, 'concept-decisions.jsonl')), 'no decision line written');
  assert.ok(!existsSync(path.join(TEST, 'concept-test.db')), 'no event written');
  touch(path.join(MEDIA, 's-20991231-0003', 'chain', 'done.txt'), 'done');
  touch(path.join(MEDIA, 'r-20991231-0004', 'chain', 'start.txt'), '2099-12-31T00:00:00Z');
  assert.deepEqual(chainsInProgress(), [], 'a finished chain, and a rehearsal r-… in progress, never block');
});

// ---------- stamp ----------
test('stampStories writes "concept": <legacy> into the story.json files without it (test media only)', () => {
  const dry = stampStories({ dryRun: true });
  assert.equal(dry.legacy, 'test-mini');
  assert.deepEqual(dry.stamped, ['s-20991231-0001']);
  assert.ok(dry.skipped.some((s) => /s-20991231-0002 : déjà « test-full »/.test(s)));
  assert.equal(JSON.parse(readFileSync(path.join(MEDIA, 's-20991231-0001', 'story.json'), 'utf8')).concept, undefined, 'dry run writes nothing');
  const r = stampStories();
  assert.deepEqual(r.stamped, ['s-20991231-0001']);
  const text = readFileSync(path.join(MEDIA, 's-20991231-0001', 'story.json'), 'utf8');
  const after = JSON.parse(text);
  assert.equal(after.concept, 'test-mini');
  assert.deepEqual(Object.keys(after).slice(0, 2), ['id', 'concept'], '"concept" right after "id"');
  assert.equal(after.title, 'A title x?', 'the rest is kept');
  assert.ok(text.endsWith('}\n') && text.includes('\n  "id"'), '2-space JSON with a final newline, like prepareContent');
  assert.equal(conceptOf('s-20991231-0001').id, 'test-mini');
  assert.deepEqual(stampStories().stamped, [], 'idempotent');
});

// ---------- CLI ----------
test('the CLI "check" prints the French report and exits 0; an unknown id exits 1', () => {
  const run = (...args) => spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'core', 'concept.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, ...ENV } });
  const ok = run('check', 'test-full');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Concept « test-full »/);
  assert.match(ok.stdout, /tess \(Tess, hero\)/);
  assert.match(ok.stdout, /activation : possible/);
  const mini = run('check');
  assert.equal(mini.status, 0, mini.stderr);
  assert.match(mini.stdout, /MANQUENT \(obligatoires\) : closeup-front\.png, waist-front\.png, full-front\.png/);
  assert.match(mini.stdout, /activation : REFUSÉE/);
  const bad = run('check', 'nope-nope');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /introuvable/);
  const show = run('show', 'test-full');
  assert.equal(show.status, 0, show.stderr);
  assert.equal(JSON.parse(show.stdout).id, 'test-full');
});

// Last: active.json is rewritten here, so the tests above (legacy = test-mini) are not disturbed.
test('activateConcept on the concept already active changes nothing and writes nothing', () => {
  json(path.join(CONCEPTS, 'active.json'), { id: 'test-full', legacy: 'test-mini', since: '2026-10-24T00:00:00Z', by: 'test' });
  clearConceptCache();
  const r = activateConcept('test-full', 'test');
  assert.equal(r.changed, false);
  assert.equal(r.from, 'test-full');
  assert.ok(!existsSync(path.join(TEST, 'concept-decisions.jsonl')), 'no decision line written');
  assert.ok(!existsSync(path.join(TEST, 'concept-test.db')), 'no event written');
});

clearConceptCache();
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
