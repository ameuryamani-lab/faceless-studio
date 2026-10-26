// Faceless Studio: tests of core/metrics-list.mjs (the short answer of list_metrics, 2026-10-26). Pure function, no database.
// Run: node --no-warnings core/metrics-list.test.mjs
import assert from 'node:assert/strict';
import { compactMetrics, MAX_CHARS } from './metrics-list.mjs';

let n = 0;
const test = (name, fn) => { fn(); n += 1; console.log(`ok ${n} - ${name}`); };
const row = (video_id, platform, checkpoint, measured_at, views, extra = {}) => ({ video_id, platform, checkpoint, measured_at, views, likes: 1, comments: 2, shares: 3, title: `Title ${video_id}`, ...extra });

const rows = [
  row('s-1', 'instagram', '1h', '2026-10-21T13:06:00.000Z', 100),
  row('s-1', 'instagram', '24h', '2026-10-22T12:30:00.000Z', 900),
  row('s-1', 'youtube', '24h', '2026-10-22T20:00:00.000Z', 40),
  row('s-2', 'tiktok', '1h', '2026-10-25T13:00:00.000Z', 15),
  row('s-2', 'tiktok', null, '2026-10-25T13:30:00.000Z', 99),
];
const firstPub = { 's-1': '2026-10-21T12:00:00.000Z', 's-2': '2026-10-25T12:00:00.000Z' };
const firstNet = { 's-1': { instagram: '2026-10-21T12:00:00.000Z', youtube: '2026-10-21T20:00:00.000Z' }, 's-2': { tiktok: '2026-10-25T12:00:00.000Z' } };

test('one row per video, newest first, each checkpoint a short array with its age in hours', () => {
  const out = compactMetrics(rows, { firstPub, firstNet });
  assert.deepEqual(out.videos.map((v) => v.video_id), ['s-2', 's-1']);
  const s1 = out.videos[1];
  assert.equal(s1.title, 'Title s-1');
  assert.equal(s1.published, '2026-10-21T12:00Z');
  assert.deepEqual(s1.nets.instagram['1h'], [100, 1, 2, 3, 1.1]);
  assert.deepEqual(s1.nets.instagram['24h'], [900, 1, 2, 3, 24.5]);
  assert.equal(typeof out.format, 'string');
});

test('a network released later (catch-up) carries its own release, and its age counts from it', () => {
  const yt = compactMetrics(rows, { firstPub, firstNet }).videos[1].nets.youtube;
  assert.equal(yt.published, '2026-10-21T20:00Z');
  assert.equal(yt['24h'][4], 24);
  assert.equal(compactMetrics(rows, { firstPub, firstNet }).videos[1].nets.instagram.published, undefined);
});

test('a row without checkpoint is not a snapshot', () => {
  assert.deepEqual(Object.keys(compactMetrics(rows, { firstPub, firstNet }).videos[0].nets.tiktok), ['1h']);
});

test('platform and video_id filters; video_id ignores the days bound', () => {
  assert.deepEqual(compactMetrics(rows, { firstPub, firstNet, platform: 'youtube' }).videos.map((v) => v.video_id), ['s-1']);
  const one = compactMetrics(rows, { firstPub, firstNet, videoId: 's-1', since: '2026-10-24T00:00:00.000Z' });
  assert.deepEqual(one.videos.map((v) => v.video_id), ['s-1']);
});

test('days bound: older videos out, a video with no known release stays in', () => {
  const out = compactMetrics([...rows, row('s-3', 'tiktok', '1h', '2026-10-25T14:00:00.000Z', 5)], { firstPub, firstNet, since: '2026-10-24T00:00:00.000Z' });
  assert.deepEqual(out.videos.map((v) => v.video_id).sort(), ['s-2', 's-3']);
  assert.equal(out.videos.find((v) => v.video_id === 's-3').nets.tiktok['1h'][4], null);
});

test('the ceiling drops the oldest videos and says how many', () => {
  const many = [];
  const pub = {};
  for (let i = 0; i < 200; i += 1) {
    const id = `s-${String(i).padStart(3, '0')}`;
    pub[id] = new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString();
    for (const p of ['youtube', 'instagram', 'tiktok']) for (const c of ['1h', '24h', '72h']) many.push(row(id, p, c, pub[id], 1000 + i));
  }
  const out = compactMetrics(many, { firstPub: pub });
  assert.ok(JSON.stringify(out).length <= MAX_CHARS, `length ${JSON.stringify(out).length}`);
  assert.ok(out.left_out.videos > 0);
  assert.equal(out.videos.length + out.left_out.videos, 200);
  assert.equal(out.videos[0].video_id, 's-199');
  assert.match(out.left_out.how, /video_id/);
});

test('no ceiling note when everything fits', () => {
  assert.equal(compactMetrics(rows, { firstPub, firstNet }).left_out, undefined);
});

console.log(`${n} tests passed`);
