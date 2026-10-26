// Faceless Studio: asks the owner for an approval by hand, through the same choke point as agents and daily.mjs
// (core/db.mjs createApproval): during the quiet hours it is queued until 07:00, otherwise it is a normal ap-N.
//   node --no-warnings core/queue-approval.mjs <script|video|post> <video_id> "<one line for the owner>" [--agent <id>]
import { APPROVAL_KINDS, closeDb, createApproval, getVideo } from './db.mjs';

const USAGE = `Usage: node core/queue-approval.mjs <${APPROVAL_KINDS.join('|')}> <video_id> "<text>" [--agent <id>]`;
const argv = process.argv.slice(2);
const ai = argv.indexOf('--agent');
const agent = ai > -1 ? argv[ai + 1] : 'chief_of_staff';
const [kind, videoId, ...rest] = ai > -1 ? argv.filter((_, i) => i !== ai && i !== ai + 1) : argv;
const text = rest.join(' ').trim();

try {
  if (!kind || !videoId || !text) throw new Error(USAGE);
  if (!getVideo(videoId)) console.error(`note: ${videoId} is not in the videos table (the approval is still recorded)`);
  const r = createApproval(kind, videoId, { agent, text });
  console.log(JSON.stringify(r));
  console.log(r.queued ? `queued until ${r.release_at} (quiet hours)${r.already_queued ? ', already in the queue' : ''}; waiter: ${r.waiter?.reason}` : `${r.ref} waiting for the owner`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  closeDb();
}
