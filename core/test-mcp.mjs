// Faceless Studio: end-to-end test of the stdio MCP server against a throwaway DB in media/_test.
// Run: node core/test-mcp.mjs
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { COMFY_PY, FFMPEG as FFMPEG_BIN } from './local-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST = path.join(ROOT, 'media', '_test');
const DB = path.join(TEST, 'mcp-test.db');
mkdirSync(TEST, { recursive: true });
for (const f of [DB, `${DB}-wal`, `${DB}-shm`, `${DB}.approvals-queue.jsonl`, `${DB}.approval-waiter.json`]) if (existsSync(f)) rmSync(f); // our own throwaway test DB only
rmSync(path.join(TEST, 'brand'), { recursive: true, force: true });
// scan_trends never touches the network in tests: it replays this saved scanner output (STUDIO_TRENDS_FIXTURE).
mkdirSync(path.join(TEST, 'brand'), { recursive: true });
writeFileSync(path.join(TEST, 'brand', 'trend-queries.md'), '# Trend queries\n\n## Queries\n- funny animation shorts\n- halloween cartoon\n');
const FIXTURE = path.join(TEST, 'trends-fixture.json');
// media-file tools work in media/_test/mcp-media (STUDIO_MEDIA); mcp-outside is a throwaway target for the link-escape test.
const MEDIA = path.join(TEST, 'mcp-media');
const OUTSIDE = path.join(TEST, 'mcp-outside');
for (const d of [MEDIA, OUTSIDE]) rmSync(d, { recursive: true, force: true }); // our own test folders only
const fx = (id, ratio, vpd, extra = {}) => ({ source: 'query', query: 'funny animation shorts', video_url: `https://www.youtube.com/shorts/${id}`, title: `Clip ${id}`, channel: 'Toon A', channel_url: 'https://www.youtube.com/channel/UCtest', views: 100000, upload_date: '20261015', duration_s: 30, ratio, views_per_day: vpd, gap: ratio === null ? 1 : 0, ...extra });
writeFileSync(FIXTURE, JSON.stringify({ scanned_at: '2026-10-20T10:00:00Z', rows: [fx('aaa', 2.5, 900, { title: 'MrBeast tries the cat challenge #roblox' }), fx('bbb', 9.1, 100, { title: 'Cat learns to fly' }), fx('ccc', null, 50000, { title: 'Grim Reaper Vs The Angel Ep12', upload_date: '20261025' }), fx('aaa', 2.5, 900)], stats: { requests: 0 }, errors: [] }));
// "not usable for the show" flag list: the real brand file, copied into the throwaway brand folder.
copyFileSync(path.join(ROOT, 'brand', 'not-usable.md'), path.join(TEST, 'brand', 'not-usable.md'));
// 2026-10-24: the concept tools (read_brand_file "concept/…", write_cast_file, the story.json check) use a throwaway concept
// under media/_test/mcp-concept (STUDIO_CONCEPT_DIR, as core/concept.test.mjs does), never the real concept/ folder.
const CONCEPTS = path.join(TEST, 'mcp-concept');
rmSync(CONCEPTS, { recursive: true, force: true }); // our own test folder only
const CONCEPT_ID = 'test-show';
const CONCEPT_DIR = path.join(CONCEPTS, CONCEPT_ID);
const HERO_LOCK = 'Tess, a short adult woman in her fifties, grey braid, blue overalls, red clogs';
const CONCEPT = { id: CONCEPT_ID, hero: 'tess', hero_name: 'Tess', hero_lock: HERO_LOCK, style: 'paper cut-out style', palette: 'blue and red', voice: { id: 'bf_emma', speed: 1 },
  // An invented, neutral on-screen format: the script tools must read it from the video's concept (here the active one).
  on_screen: {
    lanes: {
      news: { opener: '^BREAKING:\\s*\\S', exclusive: true },
      alert: { opener: '^(?=.*[A-Z]{2})[^a-z]+$', hint: 'alert opens on an alert in capitals in second 1.' },
    },
    closer: 'See you tomorrow.', closer_variant_day: 0,
  } };
const member = (name, role, lock, never) => ({ name, role, lock, never_changes: [never], sheet: null, views: [] });
const CAST = { concept: CONCEPT_ID, hero: 'tess', max_per_scene: 1, members: {
  tess: { name: 'Tess', role: 'hero', lock: '(copied by code)', never_changes: ['grey braid'], sheet: null, views: [] },
  'friend-bo': member('Bo', 'friend', 'Bo, a round man with a bright green scarf and a bowler hat', 'green scarf'),
  'boss-ada': member('Ada', 'boss', 'Ada, a stern woman with a tight bun and a black coat', 'bun'),
  'kid-next-door': member('Lou', 'neighbour', 'Lou, a young adult with a striped jumper and a skateboard', 'striped jumper'),
} };
const writeJson = (file, obj) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`); };
writeJson(path.join(CONCEPTS, 'active.json'), { id: CONCEPT_ID, legacy: CONCEPT_ID, since: '2026-10-24T00:00:00Z', by: 'test' });
writeJson(path.join(CONCEPT_DIR, 'concept.json'), CONCEPT);
writeJson(path.join(CONCEPT_DIR, 'cast.json'), CAST);
writeFileSync(path.join(CONCEPT_DIR, 'rules.md'), '# Concept rules — test-show\nScene 1 is the hook question.\n');
mkdirSync(path.join(CONCEPT_DIR, 'cast', 'tess'), { recursive: true });
writeFileSync(path.join(CONCEPT_DIR, 'cast', 'tess', 'closeup-front.png'), 'not really a picture');
// compare_to_reference: the owner's thresholds and hero reference (brand/continuity.json "reference"), plus small fixtures made from
// that reference below (CPU only). No hero is shipped: without the owner's reference picture these checks are skipped.
mkdirSync(path.join(TEST, 'brand', 'references'), { recursive: true });
copyFileSync(path.join(ROOT, 'brand', 'continuity.json'), path.join(TEST, 'brand', 'continuity.json'));
const REF_NAME = JSON.parse(readFileSync(path.join(ROOT, 'brand', 'continuity.json'), 'utf8')).reference ?? 'references/hero-front.png';
const REF_SRC = path.join(ROOT, 'brand', REF_NAME);
const REF_TEST = path.join(TEST, 'brand', REF_NAME);
if (existsSync(REF_SRC)) copyFileSync(REF_SRC, REF_TEST);
// Tool paths: core/local-config.mjs (environment, config.local.json, or its defaults), as the server uses them.
const CV_PYTHON = process.env.STUDIO_CV_PYTHON || COMFY_PY;
const FFMPEG = FFMPEG_BIN;
/** A full path must exist; a bare name ("ffmpeg") must answer on the PATH. */
const found = (bin) => (path.isAbsolute(bin) ? existsSync(bin) : spawnSync(bin, ['-version'], { windowsHide: true }).status === 0);
const CV_READY = existsSync(CV_PYTHON) && found(FFMPEG) && existsSync(REF_SRC);

/** Fixtures in media/_test/mcp-media/<vid>/: a half-size copy of the reference (should pass), the same with a second
 *  red ball drawn top-left (two balls), with cyan eyes (forbidden), and a 1 s clip of the copy. CPU only. */
function makeContinuityFixtures(vid) {
  const dir = path.join(MEDIA, vid);
  for (const d of ['keyframes/shot01', 'keyframes/shot02', 'keyframes/shot03', 'clips']) mkdirSync(path.join(dir, d), { recursive: true });
  const code = [
    'import sys', 'from PIL import Image, ImageDraw',
    'ref, out = sys.argv[1], sys.argv[2]',
    'im = Image.open(ref).convert("RGB"); im = im.resize((im.width // 2, im.height // 2))',
    'im.save(out + "/keyframes/shot01/pick.png")',
    'two = im.copy(); d = ImageDraw.Draw(two); d.ellipse((50, 85, 85, 120), fill=(232, 25, 47), outline=(60, 60, 70), width=2); two.save(out + "/keyframes/shot02/pick.png")',
    'px = im.load(); cy = im.copy(); q = cy.load()',
    'for y in range(180, 250):  # the two eyes of the half-size reference',
    '    for x in range(110, 260):',
    '        r, g, b = px[x, y]',
    '        if r > 200 and 60 < g < 170 and b > 150 and r - g > 70: q[x, y] = (40, 220, 255)',
    'cy.save(out + "/keyframes/shot03/pick.png")',
  ].join('\n');
  const py = spawnSync(CV_PYTHON, ['-I', '-c', code, REF_TEST, dir], { encoding: 'utf8', env: { ...process.env, CUDA_VISIBLE_DEVICES: '' } });
  if (py.status !== 0) throw new Error(`fixture images failed: ${py.stderr}`);
  const ff = spawnSync(FFMPEG, ['-v', 'error', '-y', '-loop', '1', '-i', path.join(dir, 'keyframes', 'shot01', 'pick.png'), '-t', '1', '-r', '8', '-vf', 'scale=320:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'clips', 'shot01-a.mp4')], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(`fixture clip failed: ${ff.stderr}`);
}

// STUDIO_NOW: a fixed daytime clock (Tue 11:00 in Africa/Algiers, pinned by STUDIO_TIMEZONE), so request_approval is never queued by the quiet hours.
// STUDIO_CONCEPT_DIR: the throwaway concept above; an outer STUDIO_CONCEPT would override its active.json, so it is dropped.
const serverEnv = { ...process.env, STUDIO_TIMEZONE: 'Africa/Algiers', STUDIO_NOW: '2026-10-20T10:00:00Z', STUDIO_DB: DB, STUDIO_BRAND_DIR: 'media/_test/brand', STUDIO_DECISIONS: path.join(ROOT, 'media', '_test', 'decisions.jsonl'), STUDIO_TRENDS_FIXTURE: 'media/_test/trends-fixture.json', STUDIO_MEDIA: 'media/_test/mcp-media', STUDIO_CONCEPT_DIR: 'media/_test/mcp-concept' };
delete serverEnv.STUDIO_CONCEPT;
const child = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'core', 'mcp-server.mjs')], { env: serverEnv, stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
readline.createInterface({ input: child.stdout }).on('line', (l) => {
  const m = JSON.parse(l);
  pending.get(m.id)?.(m);
});
let nextId = 1;
const rpc = (method, params) => new Promise((res) => { const id = nextId++; pending.set(id, res); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
const call = async (name, args) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r.result.content[0].text;
  return { isError: !!r.result.isError, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
};

let passed = 0, failed = 0, skipped = 0;
const check = (name, cond, info = '') => { if (cond) { passed++; console.log(`ok   ${name}`); } else { failed++; console.log(`FAIL ${name} ${info}`); } };
/** A check that needs a local tool this PC does not have: printed, never counted as a failure. */
const skip = (name, reason) => { skipped++; console.log(`skip: ${reason} (${name})`); };

const VID = 'v-test-mcp-01';
try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  check('initialize returns 2025-06-18', init.result?.protocolVersion === '2025-06-18');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const list = await rpc('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  check('29 tools listed (22 + flag_trend + compare_to_reference + list_metrics + add_tiktok_trends + view_scene_image + view_contact_sheet + write_cast_file)', names.length === 29 && names.includes('flag_trend') && names.includes('compare_to_reference') && names.includes('list_metrics') && names.includes('add_tiktok_trends') && names.includes('write_cast_file'), names.join(','));
  check('no publish / decide tool', !names.some((n) => /publish|decide|approve_/.test(n)));
  check('unknown method -> -32601', (await rpc('nope', {})).error?.code === -32601);

  const st = await call('get_state', {});
  check('get_state has 22 agents', st.json?.agents?.length === 22, st.text.slice(0, 200));
  check('set_agent_status works', !(await call('set_agent_status', { agent: 'copywriter', state: 'working', task: 'Writing hook' })).isError);
  check('unknown agent refused', (await call('set_agent_status', { agent: 'hacker', state: 'working' })).isError);
  check('extra argument refused', (await call('get_state', { x: 1 })).isError);
  check('create_video', !(await call('create_video', { agent: 'topic_editor', video_id: VID, topic: 'Why cold kills your battery' })).isError);
  check('bad video id refused', (await call('create_video', { agent: 'topic_editor', video_id: '../../evil', topic: 'x' })).isError);
  check('update_video cannot set published', (await call('update_video', { agent: 'publisher', video_id: VID, status: 'published' })).isError);

  const guard = await call('run_script_guard', { script: { title: 't', body: 'Hey guys, welcome back.', beats: [{ role: 'hook', text: 'Hey guys, welcome back.' }], hookText: 'Hey guys', hookSource: { pattern: 'x', origin: 'fresh' }, cta: { type: 'none' }, claimLedger: [] } });
  check('run_script_guard flags a bad script', guard.json?.ok === false && guard.json.errors.some((e) => e.code === 'script.banned_opener'));
  check('read_brand_file refuses traversal', (await call('read_brand_file', { path: '../../core/db.mjs' })).isError);
  check('read_brand_file refuses .env', (await call('read_brand_file', { path: '.env' })).isError);
  check('run_script_guard refuses outside path', (await call('run_script_guard', { script: {}, source_paths: ['C:/Windows/win.ini'] })).isError);
  const lesson = await call('append_lesson', { agent: 'chief_of_staff', rule: 'Hooks name the object in the first three words.', evidence: 'test', scope: 'scripting' });
  check('append_lesson tags the line with the active concept and the scope', lesson.json?.added === true && /^- \*\*\d{4}-\d{2}-\d{2}\*\* \[concept:test-show scripting\] Hooks name/.test(lesson.json.line ?? ''), lesson.text.slice(0, 200));
  check('append_lesson dedupes (the concept tag is skipped by the comparison)', (await call('append_lesson', { agent: 'chief_of_staff', rule: 'Hooks name the object in the first three words', evidence: 'test' })).json?.added === false);
  check('add_rejected_concept', (await call('add_rejected_concept', { agent: 'strategist', concept: 'Celebrity gossip', reason: 'off-brand' })).json?.added === true);
  check('read_brand_file reads lessons', (await call('read_brand_file', { path: 'lessons.md' })).json?.text?.includes('first three words'));

  const longTitle = await call('save_post_draft', { agent: 'publisher', video_id: VID, platform: 'youtube', title: 'x'.repeat(101), caption: 'desc' });
  check('save_post_draft refuses 101-char YouTube title', longTitle.json?.saved === false);
  check('save_post_draft saves instagram', (await call('save_post_draft', { agent: 'publisher', video_id: VID, platform: 'instagram', caption: 'Cold borrows your battery.', hashtags: ['#batteryscience', '#phonetips', '#winter'] })).json?.saved === true);

  // An episode storyboard: 9 shots, 42 s, one VERBS verb each, the fingertip shot carries the hand negative,
  // the last shot is the FLF closer (loop) ending on shot 1.
  const pbShot = (n, verb, extra = {}) => ({ n, duration_s: 4.5, verb, keyframe_prompt: `the hero at the wooden table beside a cup, shot ${n}`, motion_prompt: 'the hero moves once, camera static', ...extra });
  const sb = { video_id: VID, title: 'Test episode', loop: true, character: { id: 'hero', prompt_prefix: 'a small paper cut-out character', seed: 4242 }, voice: { provider: 'none' }, shots: [
    pbShot(1, 'vibrate'), pbShot(2, 'stand still', { still: true, source: 'still' }), pbShot(3, 'sway'),
    pbShot(4, 'tapped by a fingertip', { keyframe_prompt: 'the hero at the table, a giant fingertip enters from the right', negative: 'human hand, fingers, morphing' }),
    pbShot(5, 'slow crawl', { source: 'reuse' }), pbShot(6, 'hop in place'), pbShot(7, 'stand still', { still: true }), pbShot(8, 'tip over stiff'),
    pbShot(9, 'slow turn', { duration_s: 6, closer: true, source: 'new' }),
  ] };
  check('write_storyboard', (await call('write_storyboard', { agent: 'storyboard_artist', video_id: VID, storyboard: sb })).json?.saved === true);
  check('write_storyboard rejects a 9 s shot', (await call('write_storyboard', { agent: 'storyboard_artist', video_id: VID, storyboard: { ...sb, shots: [{ ...sb.shots[0], duration_s: 9 }] } })).json?.saved === false);
  const ap = await call('request_approval', { agent: 'chief_of_staff', kind: 'script', video_id: VID, summary: 'Script ready' });
  check('request_approval returns ap-N', /^ap-\d+$/.test(ap.json?.ref ?? ''));
  check('list_pending_approvals', (await call('list_pending_approvals', {})).json?.pending?.length === 1);
  check('record_metrics', !(await call('record_metrics', { agent: 'results_analyst', video_id: VID, platform: 'tiktok', checkpoint: '24h', views: 120 })).isError);
  check('queue_render_job records only', (await call('queue_render_job', { agent: 'storyboard_artist', video_id: VID })).json?.queued === true);
  const after = await call('get_state', {});
  check('9 events were appended (one per write)', after.json?.events?.length === 9);

  // Episode storyboard rules (write_storyboard and write_media_file storyboard.json)
  const sbTry = async (storyboard) => (await call('write_storyboard', { agent: 'storyboard_artist', video_id: VID, storyboard })).json ?? {};
  const refusedWith = (r, re) => r.saved === false && (r.errors ?? []).some((e) => re.test(e));
  const withShot = (i, patch) => ({ ...sb, shots: sb.shots.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const tenShots = { ...sb, shots: [...sb.shots.slice(0, 8), pbShot(9, 'sway', { duration_s: 3 }), { ...sb.shots[8], n: 10, duration_s: 3 }] };
  check('playbook: 10 shots refused', refusedWith(await sbTry(tenShots), /10 shots; an episode has 8-9/));
  check('playbook: 7 shots refused', refusedWith(await sbTry({ ...sb, shots: [...sb.shots.slice(0, 6), { ...sb.shots[8], n: 7 }] }), /7 shots/));
  check('playbook: 8 shots accepted', (await sbTry({ ...sb, shots: [...sb.shots.slice(0, 7).map((s) => ({ ...s, duration_s: 5 })), { ...sb.shots[8], n: 8 }] })).saved === true);
  check('playbook: total under 38 s refused', refusedWith(await sbTry({ ...sb, shots: sb.shots.map((s, k) => (k < 8 ? { ...s, duration_s: 3.5 } : s)) }), /total 34 s; an episode runs 38-45/));
  check('playbook: total over 45 s refused', refusedWith(await sbTry({ ...sb, shots: sb.shots.map((s, k) => (k < 8 ? { ...s, duration_s: 5 } : { ...s, duration_s: 6.5 })) }), /total 46.5 s/));
  check('playbook: a 5.5 s middle shot refused', refusedWith(await sbTry(withShot(2, { duration_s: 5.5 })), /shots\[2\]\.duration_s must be 3 to 5 /));
  check('playbook: closer at 6.5 s accepted, 6.6 s refused', (await sbTry(withShot(8, { duration_s: 6.5 }))).saved === true && refusedWith(await sbTry(withShot(8, { duration_s: 6.6 })), /shots\[8\]\.duration_s must be 3 to 6.5/));
  check('playbook: last shot not marked closer refused', refusedWith(await sbTry(withShot(8, { closer: undefined })), /must be the closer/));
  check('playbook: closer without loop or end_frame refused', refusedWith(await sbTry({ ...sb, loop: false }), /end on the opening keyframe/));
  check('playbook: closer with end_frame {shot: 1} accepted (no loop flag)', (await sbTry({ ...withShot(8, { end_frame: { shot: 1 } }), loop: false })).saved === true);
  check('playbook: closer as a still refused', refusedWith(await sbTry(withShot(8, { still: true })), /never a still or a reuse/));
  check('playbook: closer flag on a middle shot refused', refusedWith(await sbTry(withShot(3, { closer: true })), /shots\[3\] is marked closer/));
  check('playbook: missing verb refused', refusedWith(await sbTry(withShot(0, { verb: undefined })), /shots\[0\]\.verb is missing/));
  check('playbook: verb outside the VERBS list refused', refusedWith(await sbTry(withShot(5, { verb: 'dance' })), /"dance" is not a playbook verb/));
  check('playbook: fingertip shot without the hand negative refused', refusedWith(await sbTry(withShot(3, { negative: 'blur' })), /shots\[3\] shows a fingertip, paw or hand.*missing: human hand, fingers, morphing/));
  check('playbook: paw shot with the hand negative in the storyboard negative accepted', (await sbTry({ ...withShot(5, { verb: 'flicked by a fingertip', motion_prompt: 'a paw slowly nudges the hero' }), negative: 'human hand, fingers, morphing' })).saved === true);
  check('playbook: hand mention without the negative refused', refusedWith(await sbTry(withShot(5, { keyframe_prompt: 'the hero at the table, a hand reaches in from the right' })), /shots\[5\] shows a fingertip/));
  check('playbook: arms-raised shot refused', refusedWith(await sbTry(withShot(6, { still: false, keyframe_prompt: 'the hero standing proud with both arms raised', motion_prompt: 'The hero raises both arms in a victory pose.' })), /shots\[6\] raises the arms/));
  check('playbook: arms-raised shot with 4 takes booked accepted', (await sbTry(withShot(6, { still: false, motion_prompt: 'The hero raises both arms.', takes: 4 }))).saved === true);
  check('playbook: bad source value refused', refusedWith(await sbTry(withShot(1, { source: 'stock' })), /source must be one of new, still, reuse/));
  const pbMedia = await call('write_media_file', { agent: 'storyboard_artist', video_id: VID, path: 'storyboard.json', content: JSON.stringify(tenShots) });
  check('playbook: write_media_file storyboard.json gets the same rules', pbMedia.isError && /10 shots/.test(pbMedia.text), pbMedia.text.slice(0, 200));
  check('playbook: the valid storyboard is saved again', (await sbTry(sb)).saved === true);

  // On-screen script rules through the MCP tools (lane from the video row, format from the concept: here the active test-show)
  // save_script writes under the real media/ (like VID above); this test's own folder is removed at the end of the block.
  const VID2 = 'v-test-mcp-02';
  const VID2_DIR = path.join(ROOT, 'media', VID2);
  rmSync(VID2_DIR, { recursive: true, force: true });
  check('create_video with a lane', !(await call('create_video', { agent: 'topic_editor', video_id: VID2, topic: '[P01] The hero tries a new recipe', lane: 'alert' })).isError);
  const pbBeats = [{ role: 'hook', text: 'The oven is smoking.' }, { role: 'turn', text: 'Open a window.' }, { role: 'proof', text: 'Still smoking.' }, { role: 'rehook', text: 'One more try.' }, { role: 'play', text: 'The recipe was upside down.' }, { role: 'close', text: 'See you tomorrow.' }];
  const pbScript = (second1, closer = 'See you tomorrow.') => ({
    title: 'The hero tries a new recipe', body: pbBeats.map((b) => b.text).join(' '), beats: pbBeats, hookText: 'The oven is smoking', hookSource: { pattern: 'OA', origin: 'own', hookId: 'P01' }, cta: { type: 'none' }, claimLedger: [], stage: 'captioned', lane: 'alert',
    onScreen: [{ beat: 'hook', captions: [{ t: 0, text: second1 }], chips: [] }, { beat: 'close', captions: [{ t: 2.5, text: closer }] }],
  });
  const badSave = await call('save_script', { agent: 'voice_writer', video_id: VID2, script: pbScript('BREAKING: OVEN ON FIRE') });
  check('on-screen: save_script refuses another lane\'s exclusive opener (not saved)', badSave.json?.saved === false && badSave.json.errors.some((e) => e.code === 'playbook.second1_caption') && badSave.json.errors.some((e) => e.code === 'playbook.opener_wrong_lane') && !existsSync(path.join(ROOT, 'media', VID2, 'script.json')), badSave.text.slice(0, 300));
  const goodSave = await call('save_script', { agent: 'voice_writer', video_id: VID2, script: pbScript('OVEN ON FIRE') });
  check('on-screen: save_script saves an alert opener', goodSave.json?.saved === true, goodSave.text.slice(0, 300));
  const variant = await call('run_script_guard', { video_id: VID2, script: pbScript('OVEN ON FIRE', 'Bye.') });
  check('on-screen: run_script_guard flags a closer variant off the variant day', variant.json?.errors?.some((e) => e.code === 'playbook.closer_caption'), variant.text.slice(0, 300));
  const noOnScreen = await call('save_script', { agent: 'voice_writer', video_id: VID2, script: { ...pbScript('OVEN ON FIRE'), onScreen: undefined } });
  check('on-screen: voice_writer cannot save without onScreen', noOnScreen.json?.saved === false && noOnScreen.json.errors.some((e) => e.code === 'playbook.onscreen_missing'), noOnScreen.text.slice(0, 200));
  const draftSave = await call('save_script', { agent: 'copywriter', video_id: VID2, script: { ...pbScript('OVEN ON FIRE'), stage: 'draft', onScreen: undefined } });
  check('on-screen: copywriter draft without onScreen still saves (checked later)', draftSave.json?.saved === true, draftSave.text.slice(0, 200));
  const promptWords = await call('save_script', { agent: 'voice_writer', video_id: VID2, script: { ...pbScript('OVEN ON FIRE'), onScreen: [{ beat: 'hook', captions: [{ t: 0, text: 'OVEN ON FIRE' }], cards: [{ t: 2, text: 'Are you still watching?' }] }, { beat: 'close', captions: [{ t: 2, text: 'See you tomorrow.' }] }] } });
  check('on-screen: real prompt wording refused', promptWords.json?.saved === false && promptWords.json.errors.some((e) => e.code === 'playbook.real_prompt_wording'), promptWords.text.slice(0, 200));
  const viaMedia = await call('write_media_file', { agent: 'voice_writer', video_id: VID2, path: 'script.json', content: JSON.stringify(pbScript('oven on fire')) });
  check('on-screen: write_media_file script.json gets the same script rules (the concept hint)', viaMedia.isError && /alert opens on an alert in capitals/.test(viaMedia.text), viaMedia.text.slice(0, 300));
  rmSync(VID2_DIR, { recursive: true, force: true });

  // trends (fixture only, no network)
  check('list_trends before any scan is empty', (await call('list_trends', {})).json?.scanned_at === null);
  const scan = await call('scan_trends', { max_results: 10 });
  check('scan_trends stores the fixture rows (duplicate url skipped)', scan.json?.stored === 3 && scan.json?.fixture === true, scan.text.slice(0, 200));
  const lt = await call('list_trends', { limit: 5 });
  check('list_trends: highest ratio first, null ratio last', lt.json?.rows?.map((r) => r.video_url.slice(-3)).join(',') === 'bbb,aaa,ccc', lt.text.slice(0, 200));
  check('list_trends: gap flag kept', lt.json?.rows?.[2]?.gap === 1);
  const r0 = lt.json?.rows?.[0] ?? {};
  check('list_trends: first_seen = upload date when earlier than the first scan, name_as_typed = title', r0.first_seen === '2026-10-15' && r0.first_seen_from === 'upload_date' && r0.name_as_typed === 'Cat learns to fly', JSON.stringify(r0));
  const r2 = lt.json?.rows?.[2] ?? {};
  check('list_trends: first_seen = first scan date when the upload date is later', r2.first_seen === '2026-10-20' && r2.first_seen_from === 'first_scan', JSON.stringify(r2));
  const lrv = await call('list_recent_videos', { days: 3650 });
  check('list_recent_videos accepts 3650 days and carries planned_publish_date and published_at', Array.isArray(lrv.json) && lrv.json.length > 0 && lrv.json.every((v) => 'planned_publish_date' in v && 'published_at' in v), lrv.text.slice(0, 200));
  check('list_recent_videos refuses 3651 days', (await call('list_recent_videos', { days: 3651 })).isError);
  // "not usable for the show" flag (brand/not-usable.md, set at scan time)
  const errIs = (r, re) => r.isError && re.test(r.text);
  const byId = Object.fromEntries((lt.json?.rows ?? []).map((r) => [r.video_url.slice(-3), r]));
  check('flag: an original idea is usable', byId.bbb?.usable === 1 && byId.bbb.flag_reason === null, JSON.stringify(byId.bbb));
  check('flag: real person + brand -> not usable with the reason', byId.aaa?.usable === 0 && /real person: MrBeast/.test(byId.aaa.flag_reason) && /brand: Roblox/.test(byId.aaa.flag_reason), byId.aaa?.flag_reason);
  check('flag: someone\'s series -> "uncertain: check"', byId.ccc?.usable === 0 && /^uncertain: check \(episode number\)/.test(byId.ccc.flag_reason), byId.ccc?.flag_reason);
  check('list_trends returns total and usable counts', lt.json?.total === 3 && lt.json?.usable === 1, JSON.stringify({ t: lt.json?.total, u: lt.json?.usable }));
  const fl = await call('flag_trend', { agent: 'trend_scout', id: byId.ccc?.id, usable: true, reason: 'original series format, no real person or brand' });
  check('flag_trend: trend_scout marks a row usable', fl.json?.usable === 1 && /^set by trend_scout: /.test(fl.json.flag_reason) && fl.json.was?.usable === 0, fl.text.slice(0, 200));
  check('flag_trend appends a note event', (await call('get_state', {})).json?.events?.some((e) => e.kind === 'note' && e.agent === 'trend_scout' && /Tendance \d+ marquée utilisable/.test(e.text)));
  check('flag_trend: outlier_analyst may flag too', !(await call('flag_trend', { agent: 'outlier_analyst', id: byId.bbb?.id, usable: false, reason: 'uncertain: check the channel' })).isError);
  check('flag_trend: other agents refused', errIs(await call('flag_trend', { agent: 'copywriter', id: byId.bbb?.id, usable: true, reason: 'x' }), /only trend_scout and outlier_analyst/));
  check('flag_trend: unknown id refused', errIs(await call('flag_trend', { agent: 'trend_scout', id: 99999, usable: true, reason: 'x' }), /no trend 99999/));
  check('flag_trend: usable must be a boolean', (await call('flag_trend', { agent: 'trend_scout', id: byId.bbb?.id, usable: 1, reason: 'x' })).isError);
  const lt2 = await call('list_trends', { limit: 5 });
  check('list_trends shows the corrections and the new count', lt2.json?.usable === 1 && lt2.json.rows.find((r) => r.id === byId.ccc?.id)?.usable === 1, JSON.stringify({ u: lt2.json?.usable }));
  check('list_trends limit 0 refused', (await call('list_trends', { limit: 0 })).isError);
  check('scan_trends bad max_results refused', (await call('scan_trends', { max_results: 'all' })).isError);
  check('scan_trends extra argument refused', (await call('scan_trends', { query: 'x' })).isError);

  // media files (media/_test/mcp-media/<VID>/ through STUDIO_MEDIA)
  const errText = (r, re) => r.isError && re.test(r.text);
  check('list_media_files before any file: clear error', errText(await call('list_media_files', { video_id: VID }), /no media folder/));
  const brief = { claim: 'Cold slows the battery chemistry.', stakes: 'BROAD', heroAngle: 'the hero shivers', structure: 'original', hookPattern: 'question', sourcesNeeded: ['university page'], risks: [] };
  const wb = await call('write_media_file', { agent: 'topic_editor', video_id: VID, path: 'brief.json', content: JSON.stringify(brief) });
  check('write_media_file: topic_editor writes brief.json', wb.json?.saved === true && wb.json.path === 'brief.json', wb.text);
  check('write_media_file appends a note event', (await call('get_state', {})).json?.events?.some((e) => e.kind === 'note' && e.text === 'topic_editor a écrit brief.json'));
  const rb = await call('read_media_file', { video_id: VID, path: 'brief.json' });
  check('read_media_file returns pretty JSON', rb.json?.format === 'json' && rb.json.text.includes('\n  "claim": "Cold slows'), rb.text.slice(0, 200));
  check('write_media_file: editor writes edit/plan-v1.json', (await call('write_media_file', { agent: 'editor', video_id: VID, path: 'edit/plan-v1.json', content: '{"timeline":[]}' })).json?.saved === true);
  check('write_media_file: qc_inspector writes qc-notes.md', (await call('write_media_file', { agent: 'qc_inspector', video_id: VID, path: 'qc-notes.md', content: '# QC\nAll good.' })).json?.saved === true);
  check('read_media_file reads markdown', (await call('read_media_file', { video_id: VID, path: 'qc-notes.md' })).json?.text === '# QC\nAll good.\n');
  check('write_media_file: invalid JSON refused', errText(await call('write_media_file', { agent: 'copywriter', video_id: VID, path: 'script.json', content: '{"title": ' }), /not valid JSON/));
  writeFileSync(path.join(MEDIA, VID, 'broken.json'), '{ "a": ');
  check('read_media_file: broken JSON file -> clear error', errText(await call('read_media_file', { video_id: VID, path: 'broken.json' }), /not valid JSON/));
  const badSb = await call('write_media_file', { agent: 'storyboard_artist', video_id: VID, path: 'storyboard.json', content: JSON.stringify({ ...sb, shots: [{ ...sb.shots[0], duration_s: 9 }] }) });
  check('write_media_file: storyboard.json goes through the storyboard check', errText(badSb, /refused by its checker: .*duration_s/), badSb.text);
  for (const [label, p] of [['".."', '../mcp-test.json'], ['"..\\\\"', '..\\..\\core\\agents-models.json'], ['nested ".."', 'edit/../../x.json'], ['absolute path', '/etc/passwd.txt'], ['drive letter', 'C:/Windows/win.ini'], ['".env" name', '.env'], ['".env" inside a name', 'notes/.env.json'], ['alternate data stream', 'brief.json:hidden'], ['reserved name', 'CON.json']]) {
    check(`read_media_file refuses ${label}`, errText(await call('read_media_file', { video_id: VID, path: p }), /refused|\.env/), p);
  }
  check('write_media_file refuses ".." even for an allowed agent', errText(await call('write_media_file', { agent: 'editor', video_id: VID, path: 'edit/../brief.json', content: '{}' }), /refused/));
  check('write_media_file refuses an absolute path', errText(await call('write_media_file', { agent: 'editor', video_id: VID, path: 'C:\\Temp\\x.json', content: '{}' }), /refused/));
  check('read_media_file refuses a bad video_id', (await call('read_media_file', { video_id: '../brand', path: 'lessons.md' })).isError);
  mkdirSync(OUTSIDE, { recursive: true });
  writeFileSync(path.join(OUTSIDE, 'secret.json'), '{"secret":true}');
  symlinkSync(OUTSIDE, path.join(MEDIA, VID, 'link'), 'junction');
  check('read_media_file refuses a link that leaves the folder', errText(await call('read_media_file', { video_id: VID, path: 'link/secret.json' }), /resolves outside/));
  check('write_media_file: copywriter may not write brief.json', errText(await call('write_media_file', { agent: 'copywriter', video_id: VID, path: 'brief.json', content: '{}' }), /may not write brief\.json \(allowed: script\.json, story\.json\)/));
  check('write_media_file: publisher writes no media file', errText(await call('write_media_file', { agent: 'publisher', video_id: VID, path: 'script.json', content: '{}' }), /writes no media files/));
  check('write_media_file: editor may not write outside edit/', errText(await call('write_media_file', { agent: 'editor', video_id: VID, path: 'script.json', content: '{}' }), /may not write/));
  check('write_media_file: oversized content refused', errText(await call('write_media_file', { agent: 'qc_inspector', video_id: VID, path: 'qc-notes.md', content: 'x'.repeat(256 * 1024 + 1) }), /limit is 256 KB/));
  check('write_media_file: unknown video refused', errText(await call('write_media_file', { agent: 'topic_editor', video_id: 'v-nope-01', path: 'brief.json', content: '{}' }), /no video/));
  mkdirSync(path.join(MEDIA, VID, 'clips'), { recursive: true });
  writeFileSync(path.join(MEDIA, VID, 'clips', 'shot01.mp4'), 'not really a video');
  for (const p of ['clips/shot01.mp4', 'keyframes/shot01.png', 'final.mp4', 'continuity/shot01.png']) {
    check(`write_media_file: protected ${p} refused`, errText(await call('write_media_file', { agent: 'continuity_checker', video_id: VID, path: p, content: 'x' }), /protected render file/), p);
  }
  check('write_media_file: continuity_checker writes continuity/shot01.json', (await call('write_media_file', { agent: 'continuity_checker', video_id: VID, path: 'continuity/shot01.json', content: '{"verdict":"block","reason":"not measured"}' })).json?.saved === true);
  check('read_media_file refuses a binary file', errText(await call('read_media_file', { video_id: VID, path: 'clips/shot01.mp4' }), /only .json, .md, .txt, .srt/));
  const lm = await call('list_media_files', { video_id: VID });
  const paths = lm.json?.files?.map((f) => f.path) ?? [];
  check('list_media_files lists text and binary files with size and time', ['brief.json', 'clips/shot01.mp4', 'continuity/shot01.json', 'edit/plan-v1.json', 'qc-notes.md'].every((p) => paths.includes(p)) && lm.json.files.every((f) => Number.isInteger(f.size) && f.modified), lm.text.slice(0, 300));
  check('list_media_files skips links and leaves no temp file', !paths.some((p) => p.startsWith('link') || p.endsWith('.tmp')), paths.join(','));
  check('list_media_files of a sub-folder', (await call('list_media_files', { video_id: VID, dir: 'clips' })).json?.files?.map((f) => f.path).join(',') === 'clips/shot01.mp4');
  check('list_media_files refuses ".."', errText(await call('list_media_files', { video_id: VID, dir: '..' }), /refused/));

  // 2026-10-24: the concept is a parameter. read_brand_file "concept/…" = the ACTIVE concept's folder (media/_test/mcp-concept/test-show).
  const rules = await call('read_brand_file', { path: 'concept/rules.md' });
  check('read_brand_file "concept/rules.md" returns the active concept\'s rules', rules.json?.text === '# Concept rules — test-show\nScene 1 is the hook question.\n' && /mcp-concept\/test-show\/rules\.md$/.test(rules.json.path ?? ''), rules.text.slice(0, 200));
  check('read_brand_file "concept/cast.json" returns the cast', JSON.parse((await call('read_brand_file', { path: 'concept/cast.json' })).json?.text ?? '{}').members?.['friend-bo']?.name === 'Bo');
  check('read_brand_file "concept" lists the concept folder', (await call('read_brand_file', { path: 'concept' })).json?.entries?.join(',') === 'cast,cast.json,concept.json,rules.md');
  check('read_brand_file refuses a concept PNG', errText(await call('read_brand_file', { path: 'concept/cast/tess/closeup-front.png' }), /only .md, .txt or .json concept files/));
  check('read_brand_file refuses leaving the concept folder', errText(await call('read_brand_file', { path: 'concept/../active.json' }), /only files under concept\/test-show\//));
  check('read_brand_file still refuses traversal from brand/ into concept/', errText(await call('read_brand_file', { path: '../mcp-concept/active.json' }), /only files under brand\//));
  check('append_lesson scope "studio" is tagged [studio], not with the concept', /\[studio\] Studio rule/.test((await call('append_lesson', { agent: 'postmortem_writer', rule: 'Studio rule for any concept.', evidence: 'test', scope: 'studio' })).json?.line ?? ''));
  check('append_lesson without scope is tagged [concept:<active>]', /\[concept:test-show\] Lesson without/.test((await call('append_lesson', { agent: 'postmortem_writer', rule: 'Lesson without a scope.', evidence: 'test' })).json?.line ?? ''));
  // write_cast_file: character_keeper only, the active concept's cast.json, checkCast (core/concept.mjs) before the atomic write
  const castWith = (extra, patch = {}) => JSON.stringify({ ...CAST, ...patch, members: { ...CAST.members, ...extra } });
  const MAX = { 'barista-max': member('Max', 'barista', 'Max, a tall man with a waxed moustache and a striped apron', 'moustache') };
  check('write_cast_file: copywriter refused', errText(await call('write_cast_file', { agent: 'copywriter', content: castWith(MAX) }), /copywriter may not write cast\.json \(character_keeper only\)/));
  check('write_cast_file: invalid JSON refused', errText(await call('write_cast_file', { agent: 'character_keeper', content: '{"members": ' }), /not valid JSON/));
  check('write_cast_file: a list instead of an object refused', errText(await call('write_cast_file', { agent: 'character_keeper', content: '[]' }), /cast\.json must be an object/));
  check('write_cast_file: a modified hero entry refused', errText(await call('write_cast_file', { agent: 'character_keeper', content: castWith({ tess: { ...CAST.members.tess, never_changes: ['red braid'] } }) }), /the hero entry "tess" must not change/));
  check('write_cast_file: a hero removed from the cast refused', errText(await call('write_cast_file', { agent: 'character_keeper', content: JSON.stringify({ ...CAST, members: { ...MAX, 'friend-bo': CAST.members['friend-bo'], 'boss-ada': CAST.members['boss-ada'], 'kid-next-door': CAST.members['kid-next-door'] } }) }), /the hero "tess" must stay in the cast/));
  check('write_cast_file: a lock asking for a logo refused', errText(await call('write_cast_file', { agent: 'character_keeper', content: castWith({ 'barista-max': member('Max', 'barista', 'Max, a tall man with a big logo on his striped apron', 'apron') }) }), /lock must not ask for text, letters or a logo/));
  check('write_cast_file: a second member named Bo refused', errText(await call('write_cast_file', { agent: 'character_keeper', content: castWith({ 'barista-bo': member('Bo', 'barista', 'Bo, a tall man with a waxed moustache and a striped apron', 'moustache') }) }), /the name "Bo" is already friend-bo's/));
  check('write_cast_file: another concept id refused', errText(await call('write_cast_file', { agent: 'character_keeper', content: castWith(MAX, { concept: 'other-show' }) }), /concept must be "test-show"/));
  check('write_cast_file: a path argument is not accepted (the file is fixed)', (await call('write_cast_file', { agent: 'character_keeper', content: castWith(MAX), path: 'concept.json' })).isError);
  const wc = await call('write_cast_file', { agent: 'character_keeper', content: castWith(MAX) });
  check('write_cast_file: character_keeper adds a member', wc.json?.saved === true && wc.json.members === 5 && /mcp-concept\/test-show\/cast\.json$/.test(wc.json.path ?? ''), wc.text.slice(0, 200));
  const onDisk = JSON.parse(readFileSync(path.join(CONCEPT_DIR, 'cast.json'), 'utf8'));
  check('write_cast_file: the file on disk has the new member and the untouched hero', onDisk.members?.['barista-max']?.name === 'Max' && JSON.stringify(onDisk.members.tess) === JSON.stringify(CAST.members.tess) && !existsSync(path.join(ROOT, 'concept', CONCEPT_ID)));
  check('write_cast_file: read_brand_file "concept/cast.json" sees the new cast at once', /barista-max/.test((await call('read_brand_file', { path: 'concept/cast.json' })).json?.text ?? ''));
  check('write_cast_file appends a French note event', (await call('get_state', {})).json?.events?.some((e) => e.kind === 'note' && e.agent === 'character_keeper' && /^Casting mis à jour : .*cast\.json \(5 membres\)$/.test(e.text)));
  // write_media_file story.json: checked against the story's concept (story.concept, else the video's, else the active one)
  const lines = ['Imagine your cat paid the rent this month?', 'You find a tiny envelope on the mat, marked with a paw print.', 'Inside sits a wad of crumpled notes and a receipt for tuna.', 'You ask her where it came from and she just yawns.', 'The neighbour knocks: her goldfish has vanished and so has her wallet.', 'You check the cat\'s bed and find three more wallets and a snorkel.', 'Suddenly she is doing your taxes on the kitchen table.', 'By Friday she has bought the building and raised your rent.', 'So, would you still let her sleep on your pillow?'];
  const story = { id: VID, concept: CONCEPT_ID, title: lines[0], voice: 'bf_emma', speed: 1, seed: 9001, hero_lock: HERO_LOCK, palette: CONCEPT.palette, style: CONCEPT.style, scenes: lines.map((text, i) => ({ text, image: `Tess ${i === 0 ? 'stares at a cat on a doormat' : 'in a small kitchen, warm morning light, scene ' + (i + 1)}` })) };
  const ws = await call('write_media_file', { agent: 'copywriter', video_id: VID, path: 'story.json', content: JSON.stringify(story) });
  check('write_media_file: a story.json of the test concept is saved', ws.json?.saved === true, ws.text.slice(0, 300));
  const wrongLock = await call('write_media_file', { agent: 'copywriter', video_id: VID, path: 'story.json', content: JSON.stringify({ ...story, hero_lock: 'Rafe, a stocky adult man in his sixties' }) });
  check('write_media_file: a story.json with another hero_lock is refused, naming the concept\'s rules', errText(wrongLock, /hero_lock must be copied unchanged from .* \(concept\/test-show\/rules\.md\)/), wrongLock.text.slice(0, 300));
  check('write_media_file: a story.json of an unknown concept is refused', errText(await call('write_media_file', { agent: 'copywriter', video_id: VID, path: 'story.json', content: JSON.stringify({ ...story, concept: 'no-such-show' }) }), /concept "no-such-show" cannot be loaded/));
  const { concept: _dropped, ...legacyStory } = story;
  check('write_media_file: a story.json without "concept" takes the video\'s concept (legacy)', (await call('write_media_file', { agent: 'copywriter', video_id: VID, path: 'story.json', content: JSON.stringify(legacyStory) })).json?.saved === true);

  // compare_to_reference (continuity_checker only; CPU-only python checker on fixtures made from the reference)
  if (!CV_READY) {
    // A fresh install may have neither ComfyUI's Python nor ffmpeg yet: the compare_to_reference checks are skipped, not failed.
    const missing = [!existsSync(CV_PYTHON) && `ComfyUI python not found (${CV_PYTHON}, core/local-config.mjs COMFY_PY)`, !found(FFMPEG) && `ffmpeg not found (${FFMPEG})`, !existsSync(REF_SRC) && `no hero reference at brand/${REF_NAME} (brand/continuity.json "reference")`].filter(Boolean).join(', ');
    skip('compare_to_reference: ComfyUI python and FFmpeg found, and every compare_to_reference check', missing);
  } else {
    makeContinuityFixtures(VID);
    const cmp = (args) => call('compare_to_reference', { agent: 'continuity_checker', video_id: VID, ...args });
    check('compare_to_reference: other agents refused', errText(await call('compare_to_reference', { agent: 'image_artist', video_id: VID, path: 'keyframes/shot01/pick.png' }), /only continuity_checker/));
    const good = await cmp({ path: 'keyframes/shot01/pick.png' });
    const names = (r) => (r.json?.checks ?? []).map((c) => c.name);
    check('compare_to_reference: a copy of the reference passes', good.json?.pass === true && good.json.verdict === 'pass' && good.json.score >= 0.9, good.text.slice(0, 300));
    check('compare_to_reference: every measure is reported', ['screen_found', 'eye_count', 'no_blue_cyan_eyes', 'red_ball_count', 'ball_position', 'ball_size_vs_head', 'head_colour_de', 'body_pink_area_vs_head', 'body_colour_de', 'screen_colour_de', 'no_side_ears', 'one_hero_only', 'similarity_to_reference'].every((n) => names(good).includes(n)), names(good).join(','));
    check('compare_to_reference: each check has value, target and pass', good.json?.checks?.every((c) => 'value' in c && c.target !== undefined && typeof c.pass === 'boolean'));
    check('compare_to_reference: verdict saved under continuity/', good.json?.saved === 'continuity/keyframes-shot01-pick.png.json');
    const back = await call('read_media_file', { video_id: VID, path: 'continuity/keyframes-shot01-pick.png.json' });
    check('compare_to_reference: saved verdict reads back', back.json?.format === 'json' && JSON.parse(back.json.text).verdict === 'pass');
    check('compare_to_reference appends a note event', (await call('get_state', {})).json?.events?.some((e) => e.agent === 'continuity_checker' && /^Continuity pass keyframes\/shot01\/pick\.png/.test(e.text)));
    const two = await cmp({ path: 'keyframes/shot02/pick.png' });
    const failedOf = (r) => (r.json?.checks ?? []).filter((c) => !c.pass).map((c) => c.name);
    check('compare_to_reference: a second red ball blocks', two.json?.verdict === 'block' && failedOf(two).includes('red_ball_count'), failedOf(two).join(','));
    const cyan = await cmp({ path: 'keyframes/shot03/pick.png' });
    check('compare_to_reference: cyan eyes block', cyan.json?.verdict === 'block' && failedOf(cyan).includes('no_blue_cyan_eyes'), failedOf(cyan).join(','));
    const asBack = await cmp({ path: 'keyframes/shot01/pick.png', expect: { view: 'back' } });
    check('compare_to_reference: expect view "back" blocks a front view (screen visible)', asBack.json?.pass === false && failedOf(asBack).includes('no_screen_on_back_view'), failedOf(asBack).join(','));
    const noBody = await cmp({ path: 'keyframes/shot01/pick.png', expect: { body_visible: false } });
    check('compare_to_reference: expect body_visible false skips the body check', noBody.json?.pass === true && noBody.json.checks.find((c) => c.name === 'body_pink_area_vs_head')?.skipped === true && noBody.json.expect_source === 'tool call');
    const sbx = { ...sb, shots: sb.shots.map((s) => (s.n === 2 ? { ...s, expect: { body_visible: false, view: 'front' } } : s)) };
    check('storyboard with a per-shot expect is accepted', (await call('write_media_file', { agent: 'storyboard_artist', video_id: VID, path: 'storyboard.json', content: JSON.stringify(sbx) })).json?.saved === true);
    const fromSb = await cmp({ path: 'keyframes/shot02/pick.png' });
    check('compare_to_reference reads expect from the storyboard (shot02 -> shots[n=2])', fromSb.json?.expect_source === 'storyboard' && fromSb.json.checks.find((c) => c.name === 'body_pink_area_vs_head')?.skipped === true && fromSb.json.verdict === 'block', fromSb.text.slice(0, 200));
    const clip = await cmp({ path: 'clips/shot01-a.mp4' });
    check('compare_to_reference: a clip is sampled (3 frames) and passes', clip.json?.kind === 'video' && clip.json.frames?.length === 3 && clip.json.pass === true && clip.json.saved === 'continuity/clips-shot01-a.mp4.json', clip.text.slice(0, 300));
    check('compare_to_reference: unknown expect key refused', errText(await cmp({ path: 'keyframes/shot01/pick.png', expect: { colour: 'blue' } }), /not a known override/));
    check('compare_to_reference: bad view refused', errText(await cmp({ path: 'keyframes/shot01/pick.png', expect: { view: 'side' } }), /expect\.view must be one of/));
    check('compare_to_reference: ".." refused', errText(await cmp({ path: '../v-other/keyframes/x.png' }), /refused/));
    check('compare_to_reference: absolute path refused', errText(await cmp({ path: REF_SRC }), /refused/));
    check('compare_to_reference: text files refused', errText(await cmp({ path: 'brief.json' }), /only .png, .jpg, .jpeg, .webp, .mp4/));
    check('compare_to_reference: missing file -> clear error', errText(await cmp({ path: 'keyframes/shot09/pick.png' }), /not found/));
    check('compare_to_reference: link escape refused', errText(await cmp({ path: 'link/secret.png' }), /refused|not found/));
  }
} finally {
  child.stdin.end();
}

// Additive migration of an existing trends table (columns usable / flag_reason added, old rows classified once).
{
  const LEGACY = path.join(TEST, 'legacy-trends.db');
  for (const f of [LEGACY, `${LEGACY}-wal`, `${LEGACY}-shm`]) if (existsSync(f)) rmSync(f); // our own throwaway DB only
  const { DatabaseSync } = await import('node:sqlite');
  const old = new DatabaseSync(LEGACY);
  old.exec(`CREATE TABLE trends (id INTEGER PRIMARY KEY AUTOINCREMENT, scanned_at TEXT NOT NULL, source TEXT NOT NULL, query TEXT, video_url TEXT NOT NULL,
    title TEXT, channel TEXT, channel_url TEXT, views INTEGER, upload_date TEXT, duration_s INTEGER, ratio REAL, views_per_day REAL, gap INTEGER NOT NULL DEFAULT 0, UNIQUE (scanned_at, video_url));`);
  const ins = old.prepare("INSERT INTO trends (scanned_at, source, video_url, title, ratio) VALUES ('2026-10-19T10:00:00.000Z', 'query', ?, ?, ?)");
  ins.run('https://www.youtube.com/shorts/old1', 'Spider-Man vs Superman', 3);
  ins.run('https://www.youtube.com/shorts/old2', 'Kettle goes viral', 2);
  old.exec(`CREATE TABLE videos (id TEXT PRIMARY KEY, topic TEXT, lane TEXT, status TEXT NOT NULL DEFAULT 'idea', script_path TEXT, video_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO videos VALUES ('ep-old', 'old topic', 'everyday', 'idea', NULL, NULL, '${new Date().toISOString()}', '${new Date().toISOString()}');`);
  old.close();
  process.env.STUDIO_DB = LEGACY;
  const dbm = await import('./db.mjs');
  const tm = await import('./trends.mjs');
  const before = dbm.listTrends({ limit: 10 });
  check('migration: old rows get the new columns (null until classified)', before.rows.length === 2 && before.rows.every((r) => 'usable' in r && r.usable === null));
  const bf = tm.backfillTrendFlags({ brandDir: 'media/_test/brand' });
  const after = dbm.listTrends({ limit: 10 });
  const t = Object.fromEntries(after.rows.map((r) => [r.video_url.slice(-4), r]));
  check('migration: backfill classifies the old rows', bf.updated === 2 && t.old1?.usable === 0 && /IP: Spider-Man, Superman/.test(t.old1.flag_reason) && t.old2?.usable === 1, JSON.stringify(after.rows.map((r) => [r.usable, r.flag_reason])));
  check('migration: a second backfill has nothing left to do', tm.backfillTrendFlags({ brandDir: 'media/_test/brand' }).checked === 0);
  dbm.setTrendFlag({ agent: 'trend_scout', id: t.old1.id, usable: true, reason: 'parody idea only, no character shown' });
  tm.backfillTrendFlags({ brandDir: 'media/_test/brand', all: true });
  const oldVid = dbm.listRecentVideos(30).find((v) => v.id === 'ep-old');
  check('migration: videos gets planned_publish_date (null on old rows)', oldVid && oldVid.planned_publish_date === null && oldVid.topic === 'old topic', JSON.stringify(oldVid));
  dbm.upsertVideo({ id: 'ep-old', planned_publish_date: '2026-10-23' });
  check('upsertVideo sets planned_publish_date; other fields kept', dbm.getVideo('ep-old').planned_publish_date === '2026-10-23' && dbm.getVideo('ep-old').lane === 'everyday');
  let badDate = false; try { dbm.upsertVideo({ id: 'ep-old', planned_publish_date: '2026-02-30' }); } catch { badDate = true; }
  check('upsertVideo refuses an impossible planned date', badDate && dbm.getVideo('ep-old').planned_publish_date === '2026-10-23');
  check('migration: --reclassify keeps an agent correction', dbm.listTrends({ limit: 10 }).rows.find((r) => r.id === t.old1.id)?.usable === 1);
  dbm.closeDb();
}
console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exitCode = failed ? 1 : 0;
