// Faceless Studio: the clarity verdict of qc_inspector, read in ONE strict way (2026-10-24, review of the agent files, M29/H8).
// The agent's raw answer also carries tool chatter, and "CLARITY PASS" anywhere in it used to count as a pass. Now the first
// line that starts with "CLARITY PASS" or "CLARITY FAIL" decides, and any "CLARITY FAIL" line wins over a later PASS.
// Used by workshop/story/chain.mjs (sets qc_passed only on a PASS), workshop/story/make-short.mjs (a re-render keeps qc_passed
// only if the saved verdict is a PASS) and core/publish-direct.mjs (a narrated story never goes out without a saved PASS).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { STUDIO_ROOT } from './db.mjs';

/** {pass, line} from an answer text: line = the first "CLARITY PASS|FAIL …" line (null when none). */
export function parseClarity(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim().replace(/^[*#>\s-]+/, ''));
  const verdicts = lines.filter((l) => /^CLARITY\s+(PASS|FAIL)\b/i.test(l));
  const first = verdicts[0] ?? null;
  const fail = verdicts.some((l) => /^CLARITY\s+FAIL\b/i.test(l));
  return { pass: !!first && /^CLARITY\s+PASS\b/i.test(first) && !fail, line: first };
}

export const clarityFile = (id) => path.join(STUDIO_ROOT, 'media', String(id), 'chain', 'qc_inspector.txt');

/** true when this video's saved clarity verdict is a PASS. */
export function clarityPassed(id) {
  const f = clarityFile(id);
  return existsSync(f) && parseClarity(readFileSync(f, 'utf8')).pass;
}
