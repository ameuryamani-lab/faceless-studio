// Faceless Studio: the morning post-mortem (2026-10-22, woken with the 3 other dormant agents). After results_analyst, the
// postmortem_writer reviews EVERY published story that is 72 h to 7 days online and has no postmortem.md yet (2026-10-24: one
// video a day was reviewed while 2 or more came out daily, so 25 of 27 Shorts were never reviewed), oldest first, one agent run
// each, at most MAX_PER_RUN per morning. Age counts from the FIRST real publication (data/publish-direct.jsonl), not from the
// last status change: a video still waiting for its YouTube catch-up is reviewed like the others. It compares the views with
// the benchmark (brand/mission.md), writes media/<id>/postmortem.md and may save a lesson (append_lesson, applied at once). Never blocks anything: a failure is logged and the morning goes on.
//   node --no-warnings workshop/story/postmortem.mjs [--max N]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { STUDIO_ROOT, closeDb, getVideo } from '../../core/db.mjs';

const MEDIA = path.join(STUDIO_ROOT, 'media');
const JOURNAL = path.join(STUDIO_ROOT, 'data', 'publish-direct.jsonl');
const MIN_AGE_MS = 72 * 3600_000; // the 72 h checkpoint exists (workshop/metrics_pull.mjs)
const MAX_AGE_MS = 7 * 86_400_000;
const MAX_PER_RUN = Number(process.argv.includes('--max') ? process.argv[process.argv.indexOf('--max') + 1] : 6) || 6;

/** First instant a video really went out on any network (studio journal), else null. */
function firstPublished() {
  const first = {};
  if (!existsSync(JOURNAL)) return first;
  for (const l of readFileSync(JOURNAL, 'utf8').split('\n')) {
    try { const j = JSON.parse(l); if (/result$/.test(j.phase ?? '') && j.nets?.some((n) => n.publie)) first[j.video_id] ??= j.at; } catch { /* skip */ }
  }
  return first;
}

function eligible() {
  const first = firstPublished();
  const now = Date.now();
  return readdirSync(MEDIA).filter((d) => /^s-\d{8}-\d{4}$/.test(d)).sort().filter((d) => {
    if (existsSync(path.join(MEDIA, d, 'postmortem.md'))) return false;
    const v = getVideo(d);
    const at = first[d] ?? (v?.status === 'published' ? v.updated_at : null);
    if (!at) return false;
    const age = now - Date.parse(at);
    return age >= MIN_AGE_MS && age <= MAX_AGE_MS;
  });
}

function review(id) {
  // 2026-10-24: the format rules come through the system prompt (run-agent gets --video, so the rules.md of THIS video's concept).
  const task = `Bilan : « ${id} » après 72 h. Follow the concept rules and the studio rules you were given. Read brand/mission.md first. Read media ${id} story.json, audio/voice.txt (the voice really used; story.json's "voice" may be older), qc.json (real duration) and qc-notes.md (clarity verdict), and call list_metrics for its views at the same checkpoint as the videos you compare it with. Compare with the benchmark in mission.md and with our own median. Write postmortem.md (agent postmortem_writer): views per network, what probably helped, what probably hurt (hook, premise, length, release hour), one concrete change for the next story. Then save at most ONE lesson with append_lesson (scope scripting, with rule_fr in French) only if the numbers support it: the same cause on at least 3 of our videos below our median, or a gap of 30 % or more. Everything shown to the owner (notes, lesson rule_fr) is in French. Answer POSTMORTEM DONE | the change.`;
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--no-warnings', path.join(STUDIO_ROOT, 'core', 'run-agent.mjs'), 'postmortem_writer', task, '--video', id], { cwd: STUDIO_ROOT, windowsHide: true, stdio: 'inherit' });
    p.on('close', (code) => { console.log(`postmortem ${id}: exit ${code}`); resolve(code); });
    p.on('error', (e) => { console.error(`postmortem ${id}: ${e.message}`); resolve(1); });
  });
}

const list = eligible();
closeDb();
if (!list.length) {
  console.log('postmortem: nothing to review yet');
} else {
  const todo = list.slice(0, MAX_PER_RUN);
  console.log(`postmortem: ${list.length} video(s) due, reviewing ${todo.length}`);
  for (const id of todo) {
    // Sequential: one agent at a time on the subscription; a non-zero exit (cap, pause, limit) stops the morning's reviews.
    // eslint-disable-next-line no-await-in-loop
    if ((await review(id)) !== 0) break;
  }
}
