// Faceless Studio: "no 4+ consecutive words copied from a source text" check.
// Uses the tokenizer from text.ts (ported from AttentionOS, MIT). Pure function.
import { IssueCollector, type ValidationResult } from "./issues.ts";
import { normalizeQuotes, tokenize } from "./text.ts";

export const COPY_RUN_MIN = 4;

const words = (text: string) => tokenize(normalizeQuotes(text)).map((t) => ({ ...t, w: t.word.toLowerCase() }));

/** Every run of `min`+ consecutive words of `text` that also appears, in order, in `source`. Longest runs, no overlaps. */
export function findCopiedRuns(text: string, source: string, min = COPY_RUN_MIN): { phrase: string; length: number; index: number }[] {
  const a = words(text);
  const b = words(source);
  if (a.length < min || b.length < min) return [];
  const grams = new Map<string, number[]>();
  for (let j = 0; j + min <= b.length; j++) {
    const key = b.slice(j, j + min).map((t) => t.w).join(" ");
    const list = grams.get(key);
    if (list) list.push(j); else grams.set(key, [j]);
  }
  const out: { phrase: string; length: number; index: number }[] = [];
  let i = 0;
  while (i + min <= a.length) {
    const starts = grams.get(a.slice(i, i + min).map((t) => t.w).join(" "));
    if (!starts) { i++; continue; }
    let best = min;
    for (const j of starts) {
      let k = min;
      while (i + k < a.length && j + k < b.length && a[i + k]!.w === b[j + k]!.w) k++;
      if (k > best) best = k;
    }
    const first = a[i]!;
    const last = a[i + best - 1]!;
    out.push({ phrase: normalizeQuotes(text).slice(first.index, last.end), length: best, index: first.index });
    i += best;
  }
  return out;
}

export function checkCopiedFromSource(text: string, source: string, opts: { sourceId?: string; min?: number; path?: string } = {}): ValidationResult {
  const c = new IssueCollector();
  const min = opts.min ?? COPY_RUN_MIN;
  const from = opts.sourceId ? ` from source "${opts.sourceId}"` : " from the source text";
  for (const run of findCopiedRuns(text, source, min)) {
    c.error("copy.source_run", `"${run.phrase}" copies ${run.length} consecutive words${from}.`, {
      path: opts.path ?? "body",
      fix: `Say it in your own words: no run of ${min} or more words may match the source.`,
    });
  }
  return c.result();
}
