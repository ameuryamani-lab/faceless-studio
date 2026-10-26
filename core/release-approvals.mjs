// Faceless Studio: releases the approvals queued during the quiet hours (core/daily.json quietHours).
//   node --no-warnings core/release-approvals.mjs
// Inserts every DUE queued item of data/approvals-queue.jsonl as a real approval (normal ap-N ref) and marks it
// released in the jsonl. Idempotent: running it twice never inserts twice. core/approval-waiter.mjs calls the same code.
import { closeDb, listQueuedApprovals, releaseDueApprovals } from './db.mjs';

try {
  const released = releaseDueApprovals();
  const waiting = listQueuedApprovals().map((q) => ({ queue_id: q.id, kind: q.kind, video_id: q.video_id, release_at: q.release_at }));
  console.log(JSON.stringify({ released, still_queued: waiting }, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  closeDb();
}
