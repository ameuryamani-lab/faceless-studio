// Faceless Studio: tests of the words that paint the PLACE around the pasted hero (core/concept.mjs placeStyle / placePrompt, 2026-10-26).
// A white bubble behind the hero must never appear. The character words of `style`
// drew a white creature or a white bubble behind the hero; "no colour swatches" drew swatches. Pure functions on invented concepts.
// Run: node --no-warnings core/place-prompt.test.mjs
import assert from 'node:assert/strict';
import { placePrompt, placeStyle } from './concept.mjs';

let n = 0;
const test = (name, fn) => { fn(); n += 1; console.log(`ok ${n} - ${name}`); };
const FORBIDDEN = /\b(characters?|faces?|eyes?|mouths?|only one person|nobody else|swatch(es)?|palette)\b/i;

const style = 'flat paper cut-out illustration, simple cartoon character with thick brush outlines, round face with button eyes and a small mouth, flat colours on the character, detailed watercolour background, warm morning lighting, vertical composition with the character in the middle third, no text, no watermark';
const fake = {
  hero: 'hero', style, palette: 'teal and orange, no paint palette, no colour swatches',
  prompt: { place_style: null, place_member_style: '{name} painted in the same paper cut-out illustration style' },
  cast: { members: { hero: { name: 'Hero', lock: 'Hero, blue jacket' }, 'friend-kit': { name: 'Kit', lock: 'Kit, an adult man with a red beanie' } } },
};

test('without place_style, the style keeps only the clauses that describe no character', () => {
  assert.equal(placeStyle(fake), 'flat paper cut-out illustration, detailed watercolour background, warm morning lighting, no text, no watermark');
});

test('a scene without cast: place, palette without its "no …" clauses, place style; no character, no swatch word', () => {
  const p = placePrompt(fake, { palette: fake.palette }, { place: ' A kitchen at dawn, a big loaf on the left. ', cast: [] });
  assert.equal(p, 'A kitchen at dawn, a big loaf on the left., teal and orange, flat paper cut-out illustration, detailed watercolour background, warm morning lighting, no text, no watermark');
  assert.doesNotMatch(p, FORBIDDEN);
});

test('a scene with a cast member: the member lock, then how the member is painted', () => {
  const p = placePrompt(fake, { palette: fake.palette }, { place: 'A low hedge, Kit behind it', cast: ['friend-kit'] });
  assert.match(p, /^A low hedge, Kit behind it, Kit, an adult man with a red beanie, Kit painted in the same paper cut-out illustration style, teal and orange, /);
});

test('the hero named in cast adds nothing; no place_member_style adds nothing', () => {
  assert.doesNotMatch(placePrompt(fake, { palette: 'red' }, { place: 'A street', cast: ['hero'] }), /blue jacket/);
  const bare = { ...fake, prompt: { place_style: null, place_member_style: null } };
  assert.doesNotMatch(placePrompt(bare, { palette: 'red' }, { place: 'A hedge', cast: ['friend-kit'] }), /painted in the same/);
});

test('an explicit place_style is used as is and paints the place with no character word', () => {
  const c = { ...fake, prompt: { ...fake.prompt, place_style: 'flat paper cut-out illustration, detailed watercolour background, no text, no letters, no words, no signs, no watermark' } };
  assert.doesNotMatch(placeStyle(c), FORBIDDEN);
  const p = placePrompt(c, { palette: c.palette }, { place: 'A front lawn, a big green lawnmower on the left of the frame, soft light', cast: [] });
  assert.doesNotMatch(p, FORBIDDEN);
  assert.match(p, /no letters, no words/);
});

console.log(`${n} tests passed`);
