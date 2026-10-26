// Faceless Studio: tests of the standing order (2026-10-21): publish_at rule, the video-oui hook, stop, script
// approvals that must not schedule, and the sync of an external publisher's publications.jsonl. Throwaway DB in media/_test only.
// 2026-10-24: + the publisher's concept-driven parts (hashtags, YouTube keywords, voice check), on an invented in-memory concept (no show is shipped).
//   node --no-warnings core/test-publish.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST = path.join(ROOT, 'media', '_test');
const DB = path.join(TEST, 'publish-test.db');
for (const f of [DB, `${DB}-wal`, `${DB}-shm`, `${DB}.publications.jsonl`, `${DB}.approvals-queue.jsonl`]) rmSync(f, { force: true });
const MEDIA = path.join(TEST, 'publish-media');
rmSync(MEDIA, { recursive: true, force: true });
process.env.STUDIO_DB = DB;
process.env.STUDIO_WAITER = 'off';
// The expected instants below are written for the studio time zone Africa/Algiers: the test pins it (child processes inherit it).
process.env.STUDIO_TIMEZONE = 'Africa/Algiers';
const { studioInstant } = await import('./studio-time.mjs');
const local = (date, hhmm) => studioInstant(date, hhmm).toISOString(); // Intl conversion, no fixed offset
process.env.STUDIO_NOW = local('2026-10-22', '09:00');

const db = await import('./db.mjs');
const { NEUTRAL_HASHTAGS, buildDrafts, computePublishAt } = await import('./publish-plan.mjs');
const { syncPublications } = await import('./sync-publications.mjs');
const { buildForm, storyTags, wrongVoice } = await import('./publish-direct.mjs');

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`ok   ${name}`); } else { failed += 1; console.log(`FAIL ${name}${extra ? `: ${extra}` : ''}`); }
}
const at = (date, hhmm) => new Date(local(date, hhmm));

// ---------- publish_at rule ----------
const D = '2026-10-23';
const r1 = computePublishAt({ plannedDate: D, approvedAt: at(D, '10:00') });
check('slot day, approved 10:00 -> 18:00 local (17:00Z)', r1.publish_at === '2026-10-23T17:00:00.000Z', r1.publish_at);
const r1b = computePublishAt({ plannedDate: D, approvedAt: at('2026-10-21', '20:00') });
check('approved the day before -> slot day 18:00', r1b.publish_at === '2026-10-23T17:00:00.000Z', r1b.publish_at);
const r1c = computePublishAt({ plannedDate: D, approvedAt: at(D, '17:00') });
check('approved at exactly 17:00 -> 18:00', r1c.publish_at === '2026-10-23T17:00:00.000Z', r1c.publish_at);
const r2 = computePublishAt({ plannedDate: D, approvedAt: at(D, '17:30') });
check('approved 17:30 -> approval + 1 h = 18:30 local', r2.publish_at === '2026-10-23T17:30:00.000Z', r2.publish_at);
const r2b = computePublishAt({ plannedDate: D, approvedAt: at(D, '22:30') });
check('approved 22:30 -> 23:30 (the last allowed time)', r2b.publish_at === '2026-10-23T22:30:00.000Z', r2b.publish_at);
const r3 = computePublishAt({ plannedDate: D, approvedAt: at(D, '22:45') });
check('approved 22:45 -> 18:00 next day', r3.publish_at === '2026-10-24T17:00:00.000Z', r3.publish_at);
const r4 = computePublishAt({ plannedDate: null, approvedAt: at(D, '10:00') });
check('no planned date -> not scheduled', r4.publish_at === null && r4.reason === 'no date: not scheduled', JSON.stringify(r4));
const r5 = computePublishAt({ plannedDate: D, approvedAt: at(D, '10:00'), takenDates: ['2026-10-23'] });
check('max 1 a day: taken slot date -> next day 18:00', r5.publish_at === '2026-10-24T17:00:00.000Z' && /already has/.test(r5.reason), JSON.stringify(r5));
const r6 = computePublishAt({ plannedDate: D, approvedAt: at('2026-10-24', '09:00'), lane: 'calendar' });
check('late approval, calendar lane -> not scheduled (gate)', r6.publish_at === null, JSON.stringify(r6));
const r7 = computePublishAt({ plannedDate: D, approvedAt: at('2026-10-24', '09:00'), lane: 'everyday' });
check('late approval, other lane -> approval day 18:00', r7.publish_at === '2026-10-24T17:00:00.000Z', JSON.stringify(r7));
check('publish_at is ISO UTC with Z', /Z$/.test(r1.publish_at));

// ---------- fixtures ----------
const q = (sql, ...p) => db.openDb().prepare(sql).all(...p);
const posts = (vid) => q('SELECT * FROM posts WHERE video_id = ? ORDER BY platform', vid);
const scriptRel = (vid) => path.relative(ROOT, path.join(MEDIA, vid, 'script.json')).replace(/\\/g, '/');
function video(vid, { date, lane = 'everyday', captions = true, topic = '[P01] The hero tries a test' } = {}) {
  mkdirSync(path.join(MEDIA, vid), { recursive: true });
  const script = { ...(captions ? { title: 'The hero tries a test' } : {}), ...(captions ? { captions: {
    youtube: { title: 'The hero tries a test', description: 'The hero tries a test. Which would break the hero faster?', hashtags: ['#Shorts', '#Test', '#Animation', '#PaperCraft', '#TestShow'] },
    instagram: { caption: 'me during a test. Which would break the hero faster?', hashtags: ['#test', '#animation', '#papercraft', '#testshow'] },
    tiktok: { caption: 'me during a test', hashtags: ['#test', '#animation', '#papercraft', '#testshow'] },
  } } : {}) };
  writeFileSync(path.join(MEDIA, vid, 'script.json'), JSON.stringify(script), 'utf8');
  db.upsertVideo({ id: vid, topic, lane, status: 'awaiting_approval', script_path: scriptRel(vid), planned_publish_date: date ?? null });
}
const ask = (kind, vid) => db.createApproval(kind, vid, { agent: 'chief_of_staff' }).ref;

// ---------- the video-oui hook ----------
process.env.STUDIO_NOW = local('2026-10-23', '10:00');
video('v-pub-a', { date: '2026-10-23' });
db.upsertPost({ video_id: 'v-pub-a', platform: 'youtube', title: 'Kept title', caption: 'Kept caption from the publisher.', hashtags: ['#Shorts', '#TestShow', '#Animation'] });
const apA = ask('video', 'v-pub-a');
const resA = db.decideApproval(apA, 'approved', 'oui', { source: 'phone' });
const pa = posts('v-pub-a');
check('video oui: three post rows', pa.length === 3, pa.map((p) => p.platform).join(','));
check('video oui: ALL three rows status scheduled', pa.every((p) => p.status === 'scheduled'), pa.map((p) => p.status).join(','));
check('video oui: scheduled_at = 18:00 local ISO Z on all rows', pa.every((p) => p.scheduled_at === '2026-10-23T17:00:00.000Z'), pa.map((p) => p.scheduled_at).join(','));
check('video oui: existing youtube draft reused', pa.find((p) => p.platform === 'youtube').caption === 'Kept caption from the publisher.');
check('video oui: missing drafts built from the script captions, AI label on', pa.find((p) => p.platform === 'tiktok').caption === 'me during a test' && pa.every((p) => p.ai_label === 1));
const postAp = q("SELECT * FROM approvals WHERE kind = 'post' AND video_id = 'v-pub-a'");
check('video oui: one approved post approval, note source=video-oui; video=ap-N', postAp.length === 1 && postAp[0].status === 'approved' && postAp[0].note === `source=video-oui; video=${apA}`, JSON.stringify(postAp));
check('video oui: result names the post ref and the time', resA.publication?.scheduled && resA.publication.post_ref === postAp[0]?.ref);
check('video oui: source recorded in the event', q('SELECT text FROM events WHERE kind = ? AND text LIKE ?', 'approval_decision', `${apA} approved (via phone)%`).length === 1);
check('no pending row was opened for the post approval', !q("SELECT 1 FROM approvals WHERE status = 'pending' AND kind = 'post'").length);

// draft saves never move a scheduled time
db.upsertPost({ video_id: 'v-pub-a', platform: 'instagram', caption: 'me during a test. Which would break the hero faster?', scheduled_at: '2030-01-01T00:00:00Z' });
check('a later draft save does not move scheduled_at', posts('v-pub-a').find((p) => p.platform === 'instagram').scheduled_at === '2026-10-23T17:00:00.000Z');

// max 1 a day: a second video for the same slot date moves to the next day
video('v-pub-b', { date: '2026-10-23', captions: false, topic: '[P03] The hero tries the fallback' });
const apB = ask('video', 'v-pub-b');
db.decideApproval(apB, 'approved');
const pb = posts('v-pub-b');
check('second video same day -> next day 18:00', pb.length === 3 && pb.every((p) => p.scheduled_at === '2026-10-24T17:00:00.000Z' && p.status === 'scheduled'), pb.map((p) => `${p.platform}:${p.scheduled_at}`).join(','));
check('no script captions -> fallback drafts from the topic (tag stripped)', pb.find((p) => p.platform === 'youtube').title === 'The hero tries the fallback' && !/#fyp/.test(pb.map((p) => p.hashtags).join(' ')));

// approved late on the slot day
process.env.STUDIO_NOW = local('2026-10-26', '17:30');
video('v-pub-c', { date: '2026-10-26' });
db.decideApproval(ask('video', 'v-pub-c'), 'approved');
// the fake clock runs at real speed from the test's start: allow a minute
const near = (iso, want) => Math.abs(Date.parse(iso) - Date.parse(want)) < 60_000;
check('approved 17:30 on the slot day -> 18:30 local', posts('v-pub-c').every((p) => near(p.scheduled_at, '2026-10-26T17:30:00.000Z')), posts('v-pub-c').map((p) => p.scheduled_at).join(','));
process.env.STUDIO_NOW = local('2026-10-27', '22:50');
video('v-pub-d', { date: '2026-10-27' });
db.decideApproval(ask('video', 'v-pub-d'), 'approved');
check('approved 22:50 on the slot day -> 18:00 next day', posts('v-pub-d').every((p) => p.scheduled_at === '2026-10-28T17:00:00.000Z'));

// no planned date (an older video without a slot)
process.env.STUDIO_NOW = local('2026-10-29', '10:00');
video('v-pub-nodate', { date: null });
const resN = db.decideApproval(ask('video', 'v-pub-nodate'), 'approved');
const pn = posts('v-pub-nodate');
check('no date: drafts exist, scheduled_at NULL, status NULL', pn.length === 3 && pn.every((p) => p.scheduled_at === null && p.status === null));
check('no date: logged "no date: not scheduled", no post approval', resN.publication?.reason === 'no date: not scheduled'
  && q("SELECT 1 FROM events WHERE text LIKE '%no date: not scheduled%' AND video_id = 'v-pub-nodate'").length === 1
  && !q("SELECT 1 FROM approvals WHERE kind = 'post' AND video_id = 'v-pub-nodate'").length);

// script approvals never schedule; changes on a video do not either
video('v-pub-script', { date: '2026-10-29' });
const resS = db.decideApproval(ask('script', 'v-pub-script'), 'approved');
check('script oui: no publication, no post rows, no post approval', resS.publication === null && !posts('v-pub-script').length && !q("SELECT 1 FROM approvals WHERE kind = 'post' AND video_id = 'v-pub-script'").length);
const resCh = db.decideApproval(ask('video', 'v-pub-script'), 'changes', 'shorter');
check('video "changes": no publication', resCh.publication === null && !posts('v-pub-script').length);

// ---------- stop (CLI, as a supervising session runs it) ----------
const cli = (...a) => spawnSync(process.execPath, ['--no-warnings', 'core/approve.mjs', ...a], { cwd: ROOT, env: { ...process.env }, encoding: 'utf8' });
const s1 = cli('stop', apA, 'trop tôt', '--source', 'phone');
const pa2 = posts('v-pub-a');
check('stop ap-N (video ref) via CLI: all rows stopped', s1.status === 0 && pa2.every((p) => p.status === 'stopped'), s1.stderr || s1.stdout);
check('stop keeps scheduled_at for the record', pa2.every((p) => p.scheduled_at === '2026-10-23T17:00:00.000Z'));
check('stop logged with its source and note', q("SELECT 1 FROM events WHERE kind = 'note' AND text LIKE ?", `stop ${apA} (via phone)%trop tôt%`).length === 1);
const s2 = cli('stop', apA, '--source', 'assistant');
check('stop again: idempotent, no second event', s2.status === 0 && /already stopped/.test(s2.stdout) && q("SELECT 1 FROM events WHERE text LIKE ?", `stop ${apA}%`).length === 1, s2.stdout + s2.stderr);
const postRefB = q("SELECT ref FROM approvals WHERE kind = 'post' AND video_id = 'v-pub-b'")[0].ref;
const s3 = cli('stop', postRefB, '--source', 'vitrine');
check('stop with the post ref resolves to the video ref', s3.status === 0 && posts('v-pub-b').every((p) => p.status === 'stopped') && new RegExp(`^${apB} stopped`).test(s3.stdout), s3.stdout + s3.stderr);
const s4 = cli('stop', apA, '--source', 'email');
check('unknown --source refused', s4.status !== 0 && /--source must be one of/.test(s4.stderr));
const scriptRef = q("SELECT ref FROM approvals WHERE kind = 'script' AND video_id = 'v-pub-script'")[0].ref;
const s5 = cli('stop', scriptRef);
check('stop on a script approval refused', s5.status !== 0 && /script approval/.test(s5.stderr));
const s6 = cli('approve', ask('video', 'v-pub-c'), 'oui', '--source', 'thread');
check('approve CLI with --source prints the plan or the reason', s6.status === 0 && /approved/.test(s6.stdout), s6.stdout + s6.stderr);

// ---------- an external publisher's publications.jsonl ----------
const PUB = `${DB}.publications.jsonl`;
const apC = q("SELECT ref FROM approvals WHERE kind = 'video' AND video_id = 'v-pub-c' ORDER BY id")[0].ref;
writeFileSync(PUB, [
  JSON.stringify({ ref: apC, video_id: 'v-pub-c', le: '2026-10-26T17:30:05Z', reseaux: [
    { reseau: 'youtube', publie: true, lien: 'https://youtube.com/shorts/abc', erreur: null },
    { reseau: 'Instagram', publie: true, lien: 'https://www.instagram.com/reel/xyz/', erreur: null },
    { reseau: 'tiktok', publie: false, lien: null, erreur: 'timeout' }] }),
  '{not json',
  JSON.stringify({ ref: apA, video_id: 'v-pub-c', le: '2026-10-26T17:30:05Z', reseaux: [{ reseau: 'tiktok', publie: true, lien: 'https://www.tiktok.com/@x/video/1' }] }),
  JSON.stringify({ ref: apC, video_id: 'v-pub-c', le: '2026-10-26T18:01:00Z', reseaux: [{ reseau: 'tiktok', publie: true, lien: 'https://www.tiktok.com/@x/video/2' }] }),
  '',
].join('\n'), 'utf8');
const y1 = syncPublications(PUB);
const pc = posts('v-pub-c');
check('sync: publie=true rows marked published with published_at and url', y1.marked === 3 && pc.every((p) => p.status === 'published')
  && pc.find((p) => p.platform === 'youtube').url === 'https://youtube.com/shorts/abc' && pc.find((p) => p.platform === 'youtube').published_at === '2026-10-26T17:30:05Z', JSON.stringify(y1));
check('sync: bad JSON and a ref of another video skipped', y1.skipped.length === 2, y1.skipped.join(' | '));
check('sync: video status published once all three are', db.getVideo('v-pub-c').status === 'published');
const y2 = syncPublications(PUB);
check('sync: idempotent (second run marks nothing, no new publish event)', y2.marked === 0 && q("SELECT 1 FROM events WHERE kind = 'publish' AND video_id = 'v-pub-c'").length === 3, JSON.stringify(y2));
const s7 = cli('stop', apC, '--source', 'phone');
check('stop after publication: nothing to stop, says published', s7.status === 0 && /already published/.test(s7.stdout), s7.stdout + s7.stderr);
let threw = false;
try { db.upsertPost({ video_id: 'v-pub-c', platform: 'youtube', caption: 'changed' }); } catch { threw = true; }
check('a published row refuses draft changes', threw);
check('missing publications file: nothing happens', syncPublications(path.join(TEST, 'no-such-file.jsonl')).lines === 0);

// ---------- the concept is a parameter (2026-10-24): hashtags, YouTube keywords and the voice come from the video's concept ----------
// An invented concept (the owner's own concept is never read by this test): its hashtags per network and its YouTube keywords.
const concept = Object.freeze({ id: 'test-show', hashtags: { youtube: ['#Shorts', '#PaperTales', '#Storytime'], instagram: ['#papertales', '#storytime', '#shortstory'], tiktok: ['#papertales', '#storytime', '#animation'] }, yt_tags: ['paper tales', 'storytime', 'shorts'] });
const fb = buildDrafts({ platforms: ['youtube', 'instagram', 'tiktok'], script: null, topic: '[P03] A fallback title' });
check('fallback drafts without a concept: neutral tags, no show name', fb.errors.length === 0 && fb.drafts.youtube.hashtags.join(' ') === NEUTRAL_HASHTAGS.youtube.join(' ')
  && fb.drafts.tiktok.hashtags.join(' ') === NEUTRAL_HASHTAGS.tiktok.join(' ') && !/testshow|papercraft|papertales/i.test(Object.values(fb.drafts).map((d) => d.hashtags.join(' ')).join(' ')), JSON.stringify(fb));
const fc = buildDrafts({ platforms: ['youtube', 'instagram'], script: null, topic: 'A fallback title', hashtags: concept.hashtags });
check('fallback drafts with the concept: its hashtags per network', fc.errors.length === 0 && fc.drafts.youtube.hashtags.join(' ') === concept.hashtags.youtube.join(' ')
  && fc.drafts.instagram.hashtags.join(' ') === concept.hashtags.instagram.join(' '), JSON.stringify(fc));
const fe = buildDrafts({ platforms: ['tiktok'], script: null, topic: 'A fallback title', hashtags: { tiktok: [] } });
check('fallback drafts with an empty concept list: neutral tags', fe.drafts.tiktok?.hashtags.join(' ') === NEUTRAL_HASHTAGS.tiktok.join(' '), JSON.stringify(fe));
const own = { hashtags: ['#RainyDay', '#Umbrella', '#papertales', '#Shorts', 'bad tag', '#BusStop', '#CityLife', '#Extra1', '#Extra2'] };
check('storyTags: story tags led by #Shorts and the concept lead tag, lead and #Shorts never repeated, 5 own tags at most',
  storyTags(own, 'youtube', concept).join(' ') === '#Shorts #PaperTales #RainyDay #Umbrella #BusStop #CityLife #Extra1'
  && storyTags(own, 'instagram', concept).join(' ') === '#papertales #RainyDay #Umbrella #BusStop #CityLife #Extra1', storyTags(own, 'youtube', concept).join(' '));
check('storyTags: a story without tags gets the concept list of that network', storyTags({}, 'tiktok', concept).join(' ') === concept.hashtags.tiktok.join(' ') && storyTags({ hashtags: 'x' }, 'youtube', concept).join(' ') === concept.hashtags.youtube.join(' '));
const other = { ...concept, hashtags: { youtube: ['#Shorts', '#TipTime', '#Advice'], instagram: ['#tiptime', '#advice', '#howto'], tiktok: ['#tiptime', '#advice', '#howto'] } };
check('storyTags: the lead tag follows the concept, never a coded tag', storyTags({ hashtags: ['#Kitchen', '#TipTime'] }, 'youtube', other).join(' ') === '#Shorts #TipTime #Kitchen' && storyTags({ hashtags: ['#Kitchen'] }, 'tiktok', other).join(' ') === '#tiptime #Kitchen');
const form = buildForm({ profile: 'p', nets: ['youtube', 'tiktok'], text: () => 'caption', ytTitle: 'Title #Shorts', file: null, ytTags: concept.yt_tags });
check('buildForm: YouTube keywords are the concept yt_tags', form.getAll('tags[]').join('|') === concept.yt_tags.join('|'), form.getAll('tags[]').join('|'));
check('buildForm: no keywords when none are known', buildForm({ profile: 'p', nets: ['youtube'], text: () => 'caption', ytTitle: 'T #Shorts', file: null }).getAll('tags[]').length === 0);
check('wrongVoice: a video without story.json is never flagged', wrongVoice('v-pub-a') === false && wrongVoice('no-such-video') === false);

db.closeDb();
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
