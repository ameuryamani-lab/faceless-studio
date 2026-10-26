// Faceless Studio: approvals CLI. Only the owner (or a supervising session, on the owner's word) uses this; agents have no decide tool.
//   node core/approve.mjs list
//   node core/approve.mjs approve ap-N ["note"] [--source thread|vitrine|phone|assistant]
//   node core/approve.mjs changes ap-N "what to change" [--source ...]
//   node core/approve.mjs reject  ap-N "why" [--source ...]
//   node core/approve.mjs stop    ap-N ["note"] [--source ...]   (N = the video approval, or its auto post approval)
// Standing order (2026-10-21, brand/lanes.md RULES 4): "approve" on a VIDEO approval also plans its publication
// (drafts, posts.scheduled_at + status 'scheduled', an approved post approval). An external publisher publishes; "stop" cancels.
import { closeDb, decideApproval, getVideo, listApprovals, listQueuedApprovals, stopPublication, upsertVideo, DECISION_SOURCES } from './db.mjs';

const USAGE = `Usage: node core/approve.mjs list | approve ap-N ["note"] | changes ap-N "note" | reject ap-N "note" | stop ap-N ["note"]  [--source ${DECISION_SOURCES.join('|')}]`;

/** Splits off "--source X" (anywhere after the command); the rest is cmd, ref and the note words. */
function parseArgs(argv) {
  const rest = [];
  let source = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') {
      source = argv[i + 1] ?? null;
      if (!source || !DECISION_SOURCES.includes(source)) throw new Error(`--source must be one of ${DECISION_SOURCES.join(', ')}`);
      i += 1;
    } else rest.push(argv[i]);
  }
  const [cmd, ref, ...words] = rest;
  return { cmd, ref, note: words.join(' ').trim() || null, source };
}

function list() {
  const rows = listApprovals({ status: 'pending' });
  // Quiet hours: these are not approvals yet (no ref); they become ap-N at release_at.
  for (const q of listQueuedApprovals()) console.log(`queued  ${q.kind.padEnd(6)}  ${q.video_id ?? '-'}  until ${q.release_at.slice(0, 16).replace('T', ' ')} UTC`);
  if (!rows.length) { console.log('No approval waiting.'); return; }
  for (const a of rows) {
    const v = a.video_id ? getVideo(a.video_id) : null;
    console.log(`${a.ref}  ${a.kind.padEnd(6)}  ${a.video_id ?? '-'}  ${v?.topic ?? ''}  (since ${a.created_at.slice(0, 16).replace('T', ' ')} UTC)`);
  }
}

function describePublication(p) {
  if (!p) return null;
  if (p.scheduled) return `publication planned: ${p.local} local (${p.publish_at}), ${p.post_ref} recorded${p.reason ? `; ${p.reason}` : ''}`;
  return `not scheduled: ${p.reason}${p.errors?.length ? ` (${p.errors.join(' | ')})` : ''}`;
}

const STATUS = { approve: 'approved', changes: 'changes', reject: 'rejected' };

try {
  const { cmd, ref, note, source } = parseArgs(process.argv.slice(2));
  if (cmd === 'list') list();
  else if (cmd === 'stop') {
    if (!ref) throw new Error(USAGE);
    const r = stopPublication(ref, note, { source });
    const pub = r.published.length ? ` (already published: ${r.published.join(', ')})` : '';
    if (r.already) console.log(`${r.video_ref}: ${r.video_id} was already stopped${pub}`);
    else console.log(`${r.video_ref} stopped: ${r.video_id} will not be published on ${r.stopped.join(', ')}${pub}`);
  } else if (STATUS[cmd]) {
    if (!ref) throw new Error(USAGE);
    if ((cmd === 'changes' || cmd === 'reject') && !note) throw new Error(`"${cmd}" needs a note saying why.`);
    const r = decideApproval(ref, STATUS[cmd], note, { source });
    // A decided video/post moves the video along; a script decision leaves the status to the agents.
    if (r.video_id && (r.kind === 'video' || r.kind === 'post')) {
      upsertVideo({ id: r.video_id, status: r.status === 'approved' ? 'approved' : r.status === 'rejected' ? 'rejected' : 'edited' });
    }
    console.log(`${r.ref} ${r.status}${r.note ? ` — ${r.note}` : ''}`);
    const pub = describePublication(r.publication);
    if (pub) console.log(pub);
  } else {
    console.log(USAGE);
    process.exitCode = cmd ? 1 : 0;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  closeDb();
}
