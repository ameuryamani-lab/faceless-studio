// Faceless Studio guardrails: small test suite. Run: node core/guardrails/test.mjs
import assert from 'node:assert/strict';
import {
  validateScript, validateCaptions, checkCopiedFromSource, findCopiedRuns, validateClaimLedger, extractNumbers,
  checkBanned, validatePublishPayload, parseBannedFromVoiceMd, checkPlaybookOnScreen, isSundayDate, weekdayOf, onScreenFormatProblems, REAL_PROMPT_WORDINGS,
} from './index.ts';
import { checkStoryboard, VERBS } from '../storyboard.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const codes = (r) => [...r.errors.map((e) => e.code)];
const warnCodes = (r) => [...r.warnings.map((e) => e.code)];

const beats = [
  { role: 'hook', text: 'Your phone battery dies faster in the cold for one reason.' },
  { role: 'turn', text: 'It is not the screen and it is not the apps running in the background.' },
  { role: 'proof', text: 'Lithium cells lose a big share of their usable charge near freezing, and the voltage drops with them.' },
  { role: 'rehook', text: 'But the real surprise is what happens when you bring it back inside too fast.' },
  { role: 'play', text: 'Keep the phone in an inside pocket, let it warm up slowly before charging, and never leave it on a frozen car seat overnight or near a heater.' },
  { role: 'close', text: 'So the cold steals your battery, but only for a while. Follow for more of these.' },
];
const goodScript = {
  title: 'Why cold kills your battery',
  body: beats.map((b) => b.text).join(' '),
  beats,
  hookText: 'Your phone battery dies faster in the cold for one reason.',
  hookSource: { pattern: 'reason_reveal', origin: 'fresh' },
  cta: { type: 'follow' },
  claimLedger: [],
  captions: {
    youtube: { title: 'Why your phone dies in the cold', description: 'The real reason, in 30 seconds.', hashtags: ['#batteryscience'] },
    instagram: { caption: 'Cold does not break your battery. It borrows it.', hashtags: ['#batteryscience', '#phonetips', '#winterhacks'] },
    tiktok: { caption: 'Cold does not break your battery. It borrows it.', hashtags: ['#batteryscience', '#phonetips', '#winterhacks'] },
  },
};

test('good script passes', () => {
  const r = validateScript(goodScript);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 1));
});

test('banned opener is an error', () => {
  const r = checkBanned('Hey guys, today we talk batteries.', {});
  assert.ok(codes(r).includes('script.banned_opener'));
});

test('stage directions in spoken words are errors', () => {
  const bad = { ...goodScript, body: goodScript.body + ' [cut to b-roll]', beats: [...beats.slice(0, 5), { role: 'close', text: beats[5].text + ' [cut to b-roll]' }] };
  const r = validateScript(bad);
  assert.ok(codes(r).includes('spoken.brackets'));
});

test('DM / bio-link funnel in the close is refused', () => {
  const close = { role: 'close', text: 'So the cold steals your battery, but only for a while. DM me for the full guide, link in bio.' };
  const b = [...beats.slice(0, 5), close];
  const r = validateScript({ ...goodScript, beats: b, body: b.map((x) => x.text).join(' ') });
  assert.ok(codes(r).includes('cta.lead_funnel'), codes(r).join(','));
});

test('unlisted number in a script is an error', () => {
  const b = beats.map((x) => (x.role === 'proof' ? { ...x, text: 'Lithium cells lose 40% of their charge near freezing.' } : x));
  const r = validateScript({ ...goodScript, beats: b, body: b.map((x) => x.text).join(' ') });
  assert.ok(codes(r).includes('claims.unlisted_number'));
});

test('known fake stat is caught', () => {
  const r = validateClaimLedger([{ claim: 'We only use 10% of our brains', verdict: 'PASS', source: 'https://example.org' }], { proof: [], cited: [] });
  assert.ok(codes(r).includes('claims.fake_stat'));
});

test('numbers are extracted from digits and words', () => {
  const n = extractNumbers('It took twenty five days and $5k to reach 1,200 views.');
  assert.deepEqual(n.map((x) => x.value), [25, 5000, 1200]);
});

test('YouTube title over 100 chars fails, exactly 100 passes', () => {
  const caps = (title) => ({ ...goodScript.captions, youtube: { ...goodScript.captions.youtube, title } });
  assert.ok(codes(validateCaptions(caps('x'.repeat(101)))).includes('captions.youtube_title_length'));
  assert.ok(!codes(validateCaptions(caps('x'.repeat(100)))).includes('captions.youtube_title_length'));
});

test('Instagram over 30 hashtags and over 2200 chars fail', () => {
  const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`);
  const r = validateCaptions({ ...goodScript.captions, instagram: { caption: 'a'.repeat(2300), hashtags: tags } });
  assert.ok(codes(r).includes('captions.instagram_hashtag_limit'));
  assert.ok(codes(r).includes('captions.too_long'));
});

test('TikTok caption over 2200 chars fails', () => {
  const r = validateCaptions({ ...goodScript.captions, tiktok: { caption: 'b'.repeat(2201), hashtags: [] } });
  assert.ok(codes(r).includes('captions.too_long'));
});

test('caption JSON with an unknown platform key is refused', () => {
  const r = validateCaptions({ ...goodScript.captions, linkedin: { text: 'hi', hashtags: [] } });
  assert.equal(r.ok, false);
});

test('4+ consecutive words copied from a source are caught', () => {
  const source = 'Lithium ion cells lose usable capacity when the temperature drops below freezing point.';
  const runs = findCopiedRuns('Fun fact: lithium ion cells lose usable capacity in winter.', source);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].length, 6);
  assert.equal(checkCopiedFromSource('Cold batteries hold less charge.', source).ok, true);
  assert.equal(checkCopiedFromSource('cells lose usable capacity', source).ok, false);
});

test('three shared words are allowed', () => {
  assert.equal(checkCopiedFromSource('the temperature drops quickly at night', 'when the temperature drops below zero').ok, true);
  assert.equal(checkCopiedFromSource('at night the temperature drops below it', 'when the temperature drops below zero').ok, false);
  assert.equal(checkCopiedFromSource('the temperature falls at night', 'when the temperature drops below zero').ok, true);
});

test('script with sourceTexts flags copied runs', () => {
  const r = validateScript(goodScript, { sourceTexts: [{ id: 'teardown-1', text: 'let it warm up slowly before charging it again' }] });
  assert.ok(codes(r).includes('copy.source_run'));
});

test('publish payload needs approval and AI label', () => {
  const r = validatePublishPayload({ platform: 'tiktok', idempotencyKey: 'v-1:tiktok:1', caption: 'x', media: [{ kind: 'video', localPath: 'a.mp4', durationS: 20 }] });
  assert.ok(codes(r).includes('payload.no_approval'));
  assert.ok(codes(r).includes('payload.ai_label'));
  assert.ok(codes(r).includes('payload.tiktok_privacy_missing'));
});

test('voice.md banned lists are parsed', () => {
  const md = '# Voice\n## Banned openers\n- "Ever wondered"\n## Words we never use\n- literally\n- "mind-blowing"\n';
  const l = parseBannedFromVoiceMd(md);
  assert.deepEqual(l.openers, ['Ever wondered']);
  assert.deepEqual(l.phrases, ['literally', 'mind-blowing']);
});

test('sales word is a warning, not an error', () => {
  const r = checkBanned('This trick will supercharge your battery.', {});
  assert.ok(warnCodes(r).includes('script.sales_word'));
  assert.equal(r.ok, true);
});

// ---------- on-screen rules (./playbook.ts) ----------
// The studio ships no show: lanes, openers and the closer caption come from a concept's "on_screen" format. FMT is an invented,
// neutral format used only to exercise the mechanism.
const CAPS = '^(?=.*[A-Z]{2})[^a-z]+$';
const FMT = {
  lanes: {
    news: { opener: '^BREAKING:\\s*\\S', exclusive: true, hint: 'news opens on "BREAKING: {TOPIC}" in second 1.' },
    howto: { opener: '^STEP 1:\\s*\\S', exclusive: true },
    alert: { opener: CAPS },
    countdown: { opener: CAPS, chip: '\\d{1,2}:\\d{2}' },
  },
  closer: 'See you tomorrow.',
  closer_variant_day: 0,
};
const CLOSER = [{ t: 2.5, text: 'See you tomorrow.' }];
const pb = (lane, hook, { close = CLOSER, chips = [], extra = {} } = {}) => ({
  ...goodScript, lane, stage: 'captioned',
  onScreen: [{ beat: 'hook', captions: hook.map((text, i) => ({ t: i * 0.4, text })), chips }, { beat: 'close', captions: close }], ...extra,
});
const pbCodes = (pkg, rules = {}) => checkPlaybookOnScreen(pkg, { onScreen: FMT, ...rules }).errors.map((e) => e.code);
const bareCodes = (pkg, rules = {}) => checkPlaybookOnScreen(pkg, rules).errors.map((e) => e.code);

test('on-screen: without a concept format only the show-independent rules run', () => {
  assert.deepEqual(bareCodes(pb('anything', ['whatever opener'], { close: [{ t: 2, text: 'Any close.' }] })), []);
  assert.deepEqual(bareCodes(pb('anything', [])), [], 'no second-1 rule without a format');
  assert.ok(bareCodes(pb('anything', ['SKIP AD'])).includes('playbook.real_prompt_wording'));
  const r = checkPlaybookOnScreen(pb('anything', ['x']), { onScreen: null });
  assert.equal(r.ok, true);
  assert.ok(!r.warnings.some((w) => w.code === 'playbook.lane_unknown'));
});
test('on-screen: an exclusive opener lane needs its opener in second 1', () => {
  assert.deepEqual(pbCodes(pb('news', ['BREAKING: THE BIG NEWS'])), []);
  assert.ok(pbCodes(pb('news', ['THE BIG NEWS'])).includes('playbook.second1_caption'));
  assert.ok(pbCodes(pb('news', ['BREAKING:'])).includes('playbook.second1_caption'));
  assert.ok(checkPlaybookOnScreen(pb('news', ['THE BIG NEWS']), { onScreen: FMT }).errors.some((e) => e.message.includes('BREAKING: {TOPIC}')), 'hint shown');
});
test('on-screen: exclusive openers are refused in any other lane', () => {
  assert.deepEqual(pbCodes(pb('howto', ['STEP 1: OPEN THE BOX'])), []);
  assert.ok(pbCodes(pb('howto', ['BREAKING: OPEN THE BOX'])).includes('playbook.opener_wrong_lane'));
  const wrong = pbCodes(pb('alert', ['BREAKING: LOW SIGNAL']));
  assert.ok(wrong.includes('playbook.second1_caption') && wrong.includes('playbook.opener_wrong_lane'), 'another lane\'s opener does not count as the caps caption');
  assert.deepEqual(pbCodes(pb('alert', ['LOW SIGNAL'])), []);
  assert.ok(pbCodes(pb('alert', ['low signal again'])).includes('playbook.second1_caption'));
});
test('on-screen: a lane with a chip needs the chip by 1.0 s', () => {
  assert.deepEqual(pbCodes(pb('countdown', ['DOORS OPEN TONIGHT'], { chips: [{ t: 0.5, text: 'IN 10:00' }] })), []);
  assert.ok(pbCodes(pb('countdown', ['DOORS OPEN TONIGHT'])).includes('playbook.second1_caption'));
  assert.ok(pbCodes(pb('countdown', ['DOORS OPEN TONIGHT'], { chips: [{ t: 2, text: 'IN 10:00' }] })).includes('playbook.second1_caption'));
});
test('on-screen: no caption in second 1 is an error with a format; unknown lane warns', () => {
  const pkg = pb('alert', []);
  pkg.onScreen[0].captions = [{ t: 1.4, text: 'LOW SIGNAL' }];
  assert.ok(pbCodes(pkg).includes('playbook.second1_missing'));
  assert.ok(!pbCodes(pkg, { onScreen: { ...FMT, second1_required: false } }).includes('playbook.second1_missing'));
  const r = checkPlaybookOnScreen(pb('no-such-lane', ['LOW SIGNAL']), { onScreen: FMT });
  assert.ok(r.warnings.some((w) => w.code === 'playbook.lane_unknown'));
});
test('on-screen: each real prompt wording is refused, any case or quote style', () => {
  for (const w of REAL_PROMPT_WORDINGS) {
    assert.ok(pbCodes(pb('alert', ['LOW SIGNAL'], { extra: { title: `Episode: ${w.toUpperCase()}` } })).includes('playbook.real_prompt_wording'), w);
  }
  assert.ok(pbCodes(pb('alert', ['I’M NOT A ROBOT'])).includes('playbook.real_prompt_wording'));
  assert.deepEqual(pbCodes({ ...pb('alert', ['LOW SIGNAL']), captionNotes: ['no "Skip Ad" wording used'] }), [], 'working notes are not scanned');
});
test('on-screen: the concept closer caption is required; a variant only on the variant weekday', () => {
  assert.ok(pbCodes(pb('alert', ['LOW SIGNAL'], { close: [{ t: 2, text: 'Bye.' }] }), { publishDate: '2026-10-21' }).includes('playbook.closer_caption'));
  assert.deepEqual(pbCodes(pb('alert', ['LOW SIGNAL'], { close: [{ t: 2, text: 'Bye.' }] }), { publishDate: '2026-10-25' }), []);
  assert.ok(pbCodes(pb('alert', ['LOW SIGNAL'], { close: [] }), { publishDate: '2026-10-25' }).includes('playbook.closer_caption'));
  assert.deepEqual(pbCodes(pb('alert', ['LOW SIGNAL'], { close: [{ t: 2, text: 'Bye.' }] }), { onScreen: { ...FMT, closer: null } }), [], 'free close');
  assert.equal(isSundayDate('2026-10-25'), true);
  assert.equal(isSundayDate('2026-10-21'), false);
  assert.equal(weekdayOf('2026-10-21'), 3);
});
test('on-screen: onScreen missing is an error once captioned, a warning on a draft', () => {
  const { onScreen, ...draft } = pb('alert', ['LOW SIGNAL']);
  assert.ok(bareCodes({ ...draft, stage: 'captioned' }).includes('playbook.onscreen_missing'));
  const r = checkPlaybookOnScreen({ ...draft, stage: 'draft' });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.code === 'playbook.onscreen_pending'));
  assert.ok(bareCodes({ ...draft, stage: 'draft' }, { requireOnScreen: true }).includes('playbook.onscreen_missing'));
});
test('on-screen: validateScript carries the rules (lane from rules wins over the package)', () => {
  const r = validateScript(pb('news', ['BREAKING: THE BIG NEWS']), { lane: 'alert', onScreen: FMT });
  assert.ok(codes(r).includes('playbook.second1_caption'));
  assert.ok(!codes(validateScript(pb('alert', ['LOW SIGNAL']), { lane: 'alert', onScreen: FMT })).some((c) => c.startsWith('playbook.')));
  assert.ok(!codes(validateScript(pb('alert', ['BREAKING: X']), { lane: 'alert' })).some((c) => c.startsWith('playbook.')), 'no format: no lane rule');
});
test('on-screen: onScreenFormatProblems reports a bad concept format', () => {
  assert.deepEqual(onScreenFormatProblems(null), []);
  assert.deepEqual(onScreenFormatProblems(FMT), []);
  assert.ok(onScreenFormatProblems({ lanes: { x: { opener: '(' } } }).some((p) => /not a valid regex/.test(p)));
  assert.ok(onScreenFormatProblems({ lanes: { x: {} } }).some((p) => /opener/.test(p)));
  assert.ok(onScreenFormatProblems({ closer_variant_day: 7 }).length === 1);
  assert.ok(onScreenFormatProblems([]).length === 1);
});
test('storyboard: shot-list storyboards stay grandfathered (no episode rules on from_shotlist)', () => {
  const sb = { video_id: 'v-test', title: 't', from_shotlist: true, character: { prompt_prefix: 'p', seed: 1 }, shots: [{ n: 1, duration_s: 4, keyframe_prompt: 'the hero at the table', motion_prompt: 'it sways' }, { n: 2, duration_s: 4, keyframe_prompt: 'the hero at the table', motion_prompt: 'it sways' }] };
  assert.deepEqual(checkStoryboard(sb, { playbook: true }), []);
  assert.ok(checkStoryboard({ ...sb, from_shotlist: false }, { playbook: true }).some((e) => /2 shots/.test(e)));
  assert.ok(VERBS.length > 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
