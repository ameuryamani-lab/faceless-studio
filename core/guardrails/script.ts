// Ported from AttentionOS by Evan Baker (MIT), commit 89f67813, packages/guardrails/src/script.ts. See licences/NOTICE.
// Faceless Studio adaptation: zod replaced by ./schema.ts; remix, keyword ledger and comment/DM/link/book-a-call CTA logic
// dropped (CTA types: follow | save_share | none); captions are the 3-platform set from ./captions.ts; optional source-copy check.
import { z } from "./schema.ts";
import { checkCopiedFromSource } from "./copy.ts";
import { CTA_OPENERS, DEFAULT_BANNED_OPENERS, DEFAULT_RUN_UPS, DEFAULT_SALES_WORDS } from "./banned.ts";
import { CTA_TYPE_VALUES, captionsSchema, validateCaptions, type CaptionContext, type CtaType } from "./captions.ts";
import { claimEntrySchema, findFakeStats, validateClaimLedger, type ClaimEntry, type ClaimSources } from "./claims.ts";
import { IssueCollector, schemaIssuesToIssues, type ValidationResult } from "./issues.ts";
import { extractNumbers } from "./numbers.ts";
import { checkPlaybookOnScreen, type OnScreenFormat } from "./playbook.ts";
import {
  collapseSpace, contentStems, countWords, ELLIPSIS, EM_DASH, EN_DASH, escapeRegExp, findAllPhrases, findPhrase,
  normalizeQuotes, quoteAround, sentences, tokenize, truncate,
} from "./text.ts";

/**
 * The script validator: a hard gate in code that the model never edits.
 * A script package is the spoken words split into the 6-beat skeleton plus everything needed to check it.
 */

export const BEAT_ROLES = ["hook", "turn", "proof", "rehook", "play", "close"] as const;
export type BeatRole = (typeof BEAT_ROLES)[number];

export const HOOK_ORIGINS = ["own", "competitor", "manual", "fresh"] as const;

export const beatSchema = z.object({ role: z.enum(BEAT_ROLES), text: z.string().min(1) });

export const hookSourceSchema = z.object({
  /** `hooks.id` of the bank entry this hook adapts. Required for own and competitor origins (or `ref`). */
  hookId: z.string().nullable().optional(),
  /** Pattern id from the hook taxonomy. */
  pattern: z.string().min(1),
  origin: z.enum(HOOK_ORIGINS),
  /** Free-form provenance: the source post URL or bank reference. */
  ref: z.string().nullable().optional(),
});

export const scriptPackageSchema = z.object({
  title: z.string().min(1).max(120),
  /** The words said out loud, nothing else. Must equal the beats joined in order. */
  body: z.string().min(1),
  beats: z.array(beatSchema).min(1),
  hookText: z.string().min(1),
  hookSource: hookSourceSchema,
  cta: z.object({ type: z.enum(CTA_TYPE_VALUES) }),
  claimLedger: z.array(claimEntrySchema).default([]),
  captions: captionsSchema.optional(),
});
export type ScriptPackage = {
  title: string; body: string; beats: { role: BeatRole; text: string }[]; hookText: string;
  hookSource: { hookId?: string | null; pattern: string; origin: (typeof HOOK_ORIGINS)[number]; ref?: string | null };
  cta: { type: CtaType }; claimLedger: ClaimEntry[]; captions?: unknown;
};

export type ScriptRules = {
  /** Speaking rate used to turn words into seconds. Default 160. */
  wpm?: number;
  /** Length window in seconds. Defaults 15 to 60. */
  minSeconds?: number;
  maxSeconds?: number;
  /** The hook's first sentence should land within this many seconds. Default 3. */
  hookMaxSeconds?: number;
  /** Where the rehook starts, as a share of the words. Default [0.25, 0.40]. */
  rehookWindow?: readonly [number, number];
  /** Outside the window by up to this much is a warning; further is an error. Default 0.05. */
  rehookTolerance?: number;
  /** From brand/voice.md (parseBannedFromVoiceMd). */
  bannedOpeners?: readonly string[];
  /** brand/brand.yaml bannedPhrases plus brand/voice.md. */
  bannedPhrases?: readonly string[];
  /** Also apply DEFAULT_BANNED_OPENERS. Default true. */
  useDefaultOpeners?: boolean;
  allowDashes?: boolean;
  allowEllipsis?: boolean;
  /** More exclamation marks than this warns. Default 1. */
  maxExclamations?: number;
  /** Words allowed in capitals beyond 3-letter acronyms (e.g. a 4-letter trade acronym). */
  allowedCaps?: readonly string[];
  /** Brand CTA lines per type. */
  ctaLines?: Partial<Record<CtaType, string>>;
  claimSources?: ClaimSources;
  /** Whether the proof beat must carry a number. Default "warn" (a faceless story may prove by example). */
  proofNumber?: "error" | "warn" | "off";
  /** Known hook pattern ids; an unknown pattern warns. */
  knownPatterns?: readonly string[];
  /** Captions are required unless set to false. */
  requireCaptions?: boolean;
  captions?: Omit<CaptionContext, "ctaType" | "bannedPhrases">;
  /** Source texts (teardown transcripts, articles) the script must not copy 4+ consecutive words from. */
  sourceTexts?: readonly { id: string; text: string }[];
  /** On-screen rules (./playbook.ts): the video's lane, planned publish date, onScreen required, the concept's on-screen format. */
  lane?: string | null;
  publishDate?: string | null;
  requireOnScreen?: boolean;
  onScreen?: OnScreenFormat | null;
};

export const DEFAULT_SCRIPT_RULES = {
  wpm: 160,
  minSeconds: 15,
  maxSeconds: 60,
  hookMaxSeconds: 3,
  rehookWindow: [0.25, 0.4] as const,
  rehookTolerance: 0.05,
  maxExclamations: 1,
};

const secondsFor = (words: number, wpm: number) => (words / wpm) * 60;
const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

// ---------------------------------------------------------------------------
// Reusable checks (also used by copyGuard)
// ---------------------------------------------------------------------------

const LABEL_RE = /^\s*(hook|turn|proof|re-?hook|the play|play|close|cta|beat\s*\d+|b-?roll|visual|on[- ]screen|text overlay|overlay|sfx|music|cut to|camera|shot|scene|title|caption|note|film note|speaker\s*\d*|host|narrator|v\.?o\.?)\s*[:\-]/i;

/** Spoken words only: no stage directions, labels, markdown, emoji, links, hashtags or symbols. */
export function checkSpokenOnly(text: string, path = "body"): ValidationResult {
  const c = new IssueCollector();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const where = lines.length > 1 ? ` (line ${i + 1})` : "";
    if (/^\s*#{1,6}\s/.test(line)) c.error("spoken.markdown_heading", `A markdown heading is in the spoken words${where}: "${truncate(line, 50)}".`, { path, fix: "Remove it. Only words said out loud belong in the script." });
    else if (/^\s*([-*+•]|\d+[.)])\s+/.test(line)) c.error("spoken.list_marker", `A list marker is in the spoken words${where}: "${truncate(line, 50)}".`, { path, fix: "Write it as spoken sentences, without bullets or numbering." });
    else if (/^\s*>/.test(line)) c.error("spoken.quote_block", `A quote block is in the spoken words${where}.`, { path, fix: "Remove the > marker and say the line." });
    if (/^\s*\|.*\|\s*$/.test(line)) c.error("spoken.table", `A table row is in the spoken words${where}.`, { path, fix: "Tables can't be said out loud. Write the point as a sentence." });
    const label = LABEL_RE.exec(line);
    if (label) c.error("spoken.label", `The line starts with the label "${label[0].trim()}"${where}. Labels and directions never go in the spoken words.`, { path, fix: "Delete the label and keep only what is said. Beat roles go in the beats list." });
  });
  for (const m of text.matchAll(/\[[^\]]*\]?|\{[^}]*\}?|<[^>]*>?/g)) {
    c.error("spoken.brackets", `Bracketed text "${truncate(m[0], 50)}" looks like a stage direction or placeholder.`, { path, fix: "Remove it. Directions go in the edit plan, and placeholders must be replaced with real words." });
  }
  for (const m of text.matchAll(/\([^)]*\)?/g)) {
    c.error("spoken.parenthetical", `"${truncate(m[0], 50)}" is in parentheses, which reads as a stage direction and can't be said out loud.`, { path, fix: "Say it as part of the sentence or delete it." });
  }
  if (/\*\*|__|`/.test(text)) c.error("spoken.markdown", "The spoken words contain markdown formatting (**, __ or backticks).", { path, fix: "Remove the formatting characters." });
  const emoji = /\p{Extended_Pictographic}/u.exec(text);
  if (emoji) c.error("spoken.emoji", `The spoken words contain an emoji (${emoji[0]}).`, { path, fix: "Remove it. Emoji can't be said out loud; put them in the caption if you want them." });
  const url = /\bhttps?:\/\/\S+|\bwww\.\S+/i.exec(text);
  if (url) c.error("spoken.url", `The spoken words contain a link (${truncate(url[0], 40)}).`, { path, fix: 'Say "link in bio" or the plain name of the site instead; links go in the caption.' });
  const tag = /(^|\s)(#[\p{L}\p{N}_]+)/u.exec(text);
  if (tag) c.error("spoken.hashtag", `The spoken words contain the hashtag ${tag[2]}.`, { path, fix: "Hashtags belong in the captions, not the script." });
  const handle = /(^|\s)(@[\w.]+)/.exec(text);
  if (handle) c.error("spoken.handle", `The spoken words contain the handle ${handle[2]}.`, { path, fix: "Say the name the way you'd say it out loud." });
  const sym = /[&+=~^|\\→←↑↓✓✔✗•]/.exec(text.replace(/\*\*|__/g, ""));
  if (sym) c.error("spoken.symbol", `The spoken words contain the symbol "${sym[0]}".`, { path, fix: `Write the word you'd say instead (for example "and" for "&", "plus" for "+").` });
  return c.result();
}

/** Punctuation and caps policy for spoken copy. */
export function checkPunctuation(
  text: string,
  rules: Pick<ScriptRules, "allowDashes" | "allowEllipsis" | "maxExclamations" | "allowedCaps">,
  path = "body",
): ValidationResult {
  const c = new IssueCollector();
  if (!rules.allowDashes) {
    const i = text.search(/[\u2013\u2014]|\s-{1,2}\s/);
    if (i >= 0) {
      const which = text[i] === EM_DASH ? "an em dash" : text[i] === EN_DASH ? "an en dash" : "a dash";
      c.error("punctuation.dash", `The copy uses ${which}: "${quoteAround(text, i)}".`, { path, fix: "Use a period or a comma instead. Dashes read as written text." });
    }
  }
  if (!rules.allowEllipsis) {
    const i = text.search(/\.{3}|\u2026/);
    if (i >= 0) c.error("punctuation.ellipsis", `The copy uses an ellipsis: "${quoteAround(text, i)}".`, { path, fix: "End the sentence with a period, or keep going. Pauses are made in the edit." });
  }
  const multi = /[!?]{2,}/.exec(text);
  if (multi) c.error("punctuation.repeated", `"${multi[0]}" stacks punctuation marks.`, { path, fix: "Use a single ! or ?." });
  const bangs = (text.match(/!/g) ?? []).length;
  const maxBangs = rules.maxExclamations ?? DEFAULT_SCRIPT_RULES.maxExclamations;
  if (bangs > maxBangs) c.warn("punctuation.exclamations", `${bangs} exclamation marks; more than ${maxBangs} reads as hype.`, { path, fix: "Keep at most one, where the energy is real." });
  if (text.includes(";")) c.warn("punctuation.semicolon", "A semicolon is written punctuation; nobody says one.", { path, fix: "Split it into two sentences." });

  const allowed = new Set((rules.allowedCaps ?? []).map((w) => w.toUpperCase()));
  const reported = new Set<string>();
  for (const t of tokenize(text)) {
    const w = t.word;
    if (w.length <= 3 || !/^[A-Z][A-Z']+$/.test(w)) continue;
    if (allowed.has(w) || reported.has(w)) continue;
    reported.add(w);
    c.error("caps.shouting", `"${w}" is written in capitals. Spoken copy is not shouted.`, {
      path,
      fix: `Write it as "${w.charAt(0) + w.slice(1).toLowerCase()}". If it's an acronym, add it to the allowed capitals list.`,
    });
  }
  return c.result();
}

/** Banned openers (first words of the copy) and banned phrases anywhere. */
export function checkBanned(
  text: string,
  lists: { openers?: readonly string[]; phrases?: readonly string[]; useDefaultOpeners?: boolean },
  path = "body",
): ValidationResult {
  const c = new IssueCollector();
  const start = collapseSpace(normalizeQuotes(text));
  const openers = [...(lists.useDefaultOpeners === false ? [] : DEFAULT_BANNED_OPENERS), ...(lists.openers ?? [])];
  const opener = findPhrase(start, openers, { anchored: true });
  if (opener) {
    c.error("script.banned_opener", `The script opens with "${opener.match}", which delays the topic.`, {
      path,
      fix: "Delete everything before the claim. Line one is the claim itself.",
    });
  }
  const cta = findPhrase(start, CTA_OPENERS, { anchored: true });
  if (cta) c.error("script.cta_opener", `The script opens with a call to action ("${cta.match}"). CTAs close, they never open.`, { path, fix: "Move the CTA to the last line and open with the claim." });
  for (const hit of findAllPhrases(text, lists.phrases ?? [])) {
    c.error("script.banned_phrase", `The copy says "${hit.match.trim()}", which is on the brand's banned list.`, {
      path,
      fix: "Rewrite that part in plain words (banned list: brand/brand.yaml bannedPhrases and brand/voice.md).",
    });
  }
  for (const hit of findAllPhrases(text, DEFAULT_SALES_WORDS)) {
    c.warn("script.sales_word", `"${hit.match.trim()}" is a sales word that sounds generated when said out loud.`, { path, fix: "Say what the thing actually does." });
  }
  for (const hit of findAllPhrases(text, DEFAULT_RUN_UPS)) {
    c.warn("script.run_up", `"${hit.match.trim()}" is a run-up that delays the point.`, { path, fix: "Cut it and make the point." });
  }
  const notXButY = /\b(it'?s|this is|that'?s)\s+not\s+(just\s+)?(about\s+)?[^.,!?]{1,40}[,.]\s*(it'?s|but)\b/i.exec(normalizeQuotes(text));
  if (notXButY) c.warn("script.not_x_but_y", `"${truncate(notXButY[0], 60)}" argues against something nobody claimed.`, { path, fix: "State the point directly." });
  return c.result();
}

// ---------------------------------------------------------------------------
// CTA
// ---------------------------------------------------------------------------

const CTA_SIGNALS = /\b(comment|dm me|message me|link in (my |the )?bio|follow (me|for)|book (a|your) call|save this|share this)\b/i;
const LEAD_FUNNEL = /\b(dm me|message me|book (a|your) call|link in (my |the )?bio)\b/i;

function checkCta(c: IssueCollector, pkg: ScriptPackage, closeText: string, rules: ScriptRules): void {
  const type = pkg.cta.type;
  const path = "cta";
  const close = normalizeQuotes(closeText);
  switch (type) {
    case "follow":
      if (!/\bfollow\b/i.test(close)) c.error("cta.mismatch", "The CTA type is follow, but the closing line never asks for a follow.", { path, fix: "Give one concrete reason to follow in the last line." });
      break;
    case "save_share":
      if (!/\b(save|share|send)\b/i.test(close)) c.error("cta.mismatch", "The CTA type is save or share, but the closing line never asks viewers to save or share it.", { path, fix: 'End with "Save this for ..." or "Send this to ...".' });
      break;
    case "none": {
      const sig = CTA_SIGNALS.exec(close);
      if (sig) c.warn("cta.unexpected", `The CTA type is none, but the closing line says "${sig[0]}".`, { path, fix: "Remove the ask or set the CTA type that matches it." });
      break;
    }
  }
  if (LEAD_FUNNEL.test(close)) {
    c.error("cta.lead_funnel", "The close asks for a DM, a call or a bio link. This channel has no funnel.", { path, fix: "Use a follow or save/share ask, or none." });
  }
  const template = rules.ctaLines?.[type];
  if (template) {
    const expected = collapseSpace(template).replace(/[.!?]+$/, "").toLowerCase();
    if (expected && !collapseSpace(close).toLowerCase().includes(expected)) {
      c.error("cta.line_mismatch", `The closing line doesn't use the brand's CTA line for ${type}: "${expected}".`, { path, fix: "Say the brand's CTA line as written." });
    }
  }
}

// ---------------------------------------------------------------------------
// validateScript
// ---------------------------------------------------------------------------

const norm = (s: string) => collapseSpace(normalizeQuotes(s));

export function validateScript(input: unknown, rules: ScriptRules = {}): ValidationResult {
  const c = new IssueCollector();
  const parsed = scriptPackageSchema.safeParse(input) as { success: true; data: ScriptPackage } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };
  if (!parsed.success) {
    for (const issue of schemaIssuesToIssues(parsed.error.issues, "script")) {
      c.error(issue.code, `The script package has the wrong shape: ${issue.message}.`, { path: issue.path, fix: "Return every field of the script package with the documented types." });
    }
    return c.result();
  }
  const pkg = parsed.data;
  const wpm = rules.wpm ?? DEFAULT_SCRIPT_RULES.wpm;
  const body = pkg.body;

  // Spoken words only, punctuation and caps.
  c.merge(checkSpokenOnly(body));
  c.merge(checkPunctuation(body, rules));

  // Length window.
  const words = countWords(body);
  const secs = secondsFor(words, wpm);
  const minS = rules.minSeconds ?? DEFAULT_SCRIPT_RULES.minSeconds;
  const maxS = rules.maxSeconds ?? DEFAULT_SCRIPT_RULES.maxSeconds;
  if (secs < minS) {
    c.error("length.too_short", `The script runs about ${fmt(secs)} seconds (${words} words at ${wpm} words a minute); the minimum is ${minS} seconds.`, {
      path: "body",
      fix: `Add about ${Math.ceil((minS * wpm) / 60) - words} words, ideally in the proof or the play.`,
    });
  } else if (secs > maxS) {
    c.error("length.too_long", `The script runs about ${fmt(secs)} seconds (${words} words at ${wpm} words a minute); the maximum is ${maxS} seconds.`, {
      path: "body",
      fix: `Cut about ${words - Math.floor((maxS * wpm) / 60)} words. Start with lines that repeat a point.`,
    });
  }

  // Banned openers and phrases.
  c.merge(checkBanned(body, { openers: rules.bannedOpeners, phrases: rules.bannedPhrases, useDefaultOpeners: rules.useDefaultOpeners }));
  for (const fake of findFakeStats(body)) {
    c.error("script.fake_stat", `The script repeats a known fake statistic (${fake.label}): "${truncate(fake.match, 60)}".`, { path: "body", fix: "Cut it. No source makes this one true." });
  }

  // 6-beat structure.
  const beats = pkg.beats;
  const firstIndex = new Map<BeatRole, number>();
  beats.forEach((b, i) => {
    if (!firstIndex.has(b.role)) firstIndex.set(b.role, i);
    else if (b.role === "hook" || b.role === "close") {
      c.error("beats.duplicate", `There are two ${b.role} beats (beats ${firstIndex.get(b.role)! + 1} and ${i + 1}).`, { path: `beats[${i}]`, fix: `Merge them into one ${b.role} beat.` });
    }
  });
  const remix = false; // remix mode dropped in Faceless Studio
  for (const role of BEAT_ROLES) {
    if (firstIndex.has(role)) continue;
    if (remix && role !== "hook" && role !== "close") {
      c.warn("beats.missing", `The script has no ${role} beat. Fine when the source post didn't have one either.`, { path: "beats", fix: `Only add it if the source had that beat. ${BEAT_FIX[role]}` });
    } else {
      c.error("beats.missing", `The script has no ${role} beat.`, { path: "beats", fix: BEAT_FIX[role] });
    }
  }
  if (beats[0] && beats[0].role !== "hook") c.error("beats.order", `The first beat is "${beats[0].role}"; the script must open with the hook.`, { path: "beats[0]", fix: "Put the hook first." });
  const last = beats[beats.length - 1];
  if (last && last.role !== "close") c.error("beats.order", `The last beat is "${last.role}"; the script must end with the close.`, { path: `beats[${beats.length - 1}]`, fix: "End with the close that calls back to the hook." });
  let prev = -1;
  let prevRole: BeatRole | null = null;
  for (const role of BEAT_ROLES) {
    const idx = firstIndex.get(role);
    if (idx === undefined) continue;
    if (idx < prev && prevRole) {
      // A remix keeps the source's beat order, so only the skeleton's own order is advice there.
      if (remix) c.warn("beats.order", `The ${role} beat comes before the ${prevRole} beat. Fine if the source post ran in that order.`, { path: `beats[${idx}]`, fix: "Follow the source's beat order." });
      else c.error("beats.order", `The ${role} beat comes before the ${prevRole} beat.`, { path: `beats[${idx}]`, fix: "Order the beats: hook, turn, proof, rehook, play, close." });
    }
    if (idx > prev) {
      prev = idx;
      prevRole = role;
    }
  }
  const joined = norm(beats.map((b) => b.text).join(" "));
  if (joined !== norm(body)) {
    c.error("beats.body_mismatch", "The beats joined in order don't match the script body word for word.", {
      path: "beats",
      fix: "Make the body exactly the beat texts in order, or rebuild the beats from the body.",
    });
  }

  const hookBeat = beats.find((b) => b.role === "hook");
  const closeBeat = beats.find((b) => b.role === "close");
  if (hookBeat) {
    if (!norm(hookBeat.text).toLowerCase().startsWith(norm(pkg.hookText).toLowerCase().replace(/[.!?]+$/, ""))) {
      c.error("hook.text_mismatch", `hookText "${truncate(pkg.hookText, 50)}" isn't how the hook beat starts.`, { path: "hookText", fix: "Set hookText to the hook as spoken (the start of the hook beat)." });
    }
    const hookLimit = rules.hookMaxSeconds ?? DEFAULT_SCRIPT_RULES.hookMaxSeconds;
    const firstSentence = sentences(hookBeat.text)[0] ?? hookBeat.text;
    const fw = countWords(firstSentence);
    const fs = secondsFor(fw, wpm);
    const budget = Math.floor((hookLimit * wpm) / 60);
    const sourceHook = 0;
    if (fs > Math.max(hookLimit * 1.5, sourceHook * 1.25)) {
      c.error("hook.too_slow", `The hook's first sentence takes about ${fmt(fs)} seconds to say (${fw} words). The whole claim has to land in the first ${hookLimit} seconds (about ${budget} words).`, {
        path: "beats[0]",
        fix: "Cut the hook to the claim alone. Move setup to the turn.",
      });
    } else if (fs > Math.max(hookLimit, sourceHook * 1.05)) {
      c.warn("hook.slow", `The hook's first sentence takes about ${fmt(fs)} seconds (${fw} words); aim for ${hookLimit} seconds (about ${budget} words).`, { path: "beats[0]", fix: "Trim words before the topic lands." });
    }
  }

  const proofBeats = beats.filter((b) => b.role === "proof");
  const proofNumber = rules.proofNumber ?? "warn";
  if (proofNumber !== "off" && proofBeats.length > 0 && !proofBeats.some((b) => extractNumbers(b.text, { all: true }).length > 0)) {
    if (proofNumber === "error") {
      c.error("beats.proof_without_number", "The proof beat has no number.", { path: `beats[${firstIndex.get("proof")}]`, fix: "Add one concrete number from the proof inventory (brand/proof-inventory.yaml) and list it in the claim ledger." });
    } else {
      c.warn("beats.proof_without_number", "The proof beat has no number.", {
        path: `beats[${firstIndex.get("proof")}]`,
        fix: "Fine when it shows a concrete example or demo instead. Never borrow a number: only the proof inventory may supply one.",
      });
    }
  }

  const rehookIdx = firstIndex.get("rehook");
  if (rehookIdx !== undefined && words > 0) {
    const before = countWords(beats.slice(0, rehookIdx).map((b) => b.text).join(" "));
    const share = before / words;
    const [lo, hi] = rules.rehookWindow ?? DEFAULT_SCRIPT_RULES.rehookWindow;
    const tol = rules.rehookTolerance ?? DEFAULT_SCRIPT_RULES.rehookTolerance;
    const pct = Math.round(share * 100);
    const window = `${Math.round(lo * 100)} to ${Math.round(hi * 100)}%`;
    if (!remix && (share < lo - tol || share > hi + tol)) {
      c.error("beats.rehook_position", `The rehook starts ${pct}% of the way in; it belongs between ${window}.`, {
        path: `beats[${rehookIdx}]`,
        fix: share < lo ? `Move it later: about ${Math.ceil(lo * words) - before} more words before it.` : `Move it earlier: about ${before - Math.floor(hi * words)} fewer words before it.`,
      });
    } else if (share < lo || share > hi) {
      c.warn("beats.rehook_position", `The rehook starts ${pct}% of the way in; the target is ${window}.`, { path: `beats[${rehookIdx}]`, fix: "Nudge it toward the window." });
    }
  }

  if (hookBeat && closeBeat) {
    const hookStems = contentStems(hookBeat.text);
    const closeStems = contentStems(closeBeat.text);
    const shared = [...hookStems].filter((s) => closeStems.has(s));
    if (shared.length === 0) {
      c.warn("beats.no_callback", "The close doesn't echo any word from the hook, so it may not call back to it.", { path: `beats[${firstIndex.get("close")}]`, fix: "Bring back the hook's key word or image in the close." });
    }
    const ctaInHook = CTA_SIGNALS.exec(hookBeat.text);
    if (ctaInHook) c.error("hook.cta_in_hook", `The hook contains a call to action ("${ctaInHook[0]}").`, { path: "beats[0]", fix: "Move the ask to the close." });
  }

  // CTA line matches the CTA type.
  const closeText = closeBeat?.text ?? sentences(body).at(-1) ?? "";
  checkCta(c, pkg, closeText, rules);

  // hook_source provenance.
  const hs = pkg.hookSource;
  if ((hs.origin === "own" || hs.origin === "competitor") && !hs.hookId && !hs.ref) {
    c.error("hook_source.missing_ref", `hook_source says the hook adapts a ${hs.origin} bank entry but doesn't say which one.`, { path: "hookSource", fix: "Set hookSource.hookId to the bank entry's id (or ref to its source)." });
  }
  if (rules.knownPatterns && !rules.knownPatterns.includes(hs.pattern)) {
    c.warn("hook_source.unknown_pattern", `Hook pattern "${hs.pattern}" isn't in the pattern taxonomy.`, { path: "hookSource.pattern", fix: `Use one of: ${rules.knownPatterns.join(", ")}.` });
  }

  // Claim ledger, and every number said is in it with PASS.
  const sources: ClaimSources = rules.claimSources ?? { proof: [], cited: [] };
  c.merge(validateClaimLedger(pkg.claimLedger, sources));
  const passValues = new Set<number>();
  const cutValues = new Set<number>();
  for (const entry of pkg.claimLedger) {
    const target = entry.verdict === "PASS" ? passValues : entry.verdict === "CUT" ? cutValues : null;
    if (!target) continue;
    for (const n of extractNumbers(entry.claim, { all: true })) target.add(n.value);
  }
  const reported = new Set<number>();
  for (const n of extractNumbers(body)) {
    if (passValues.has(n.value) || reported.has(n.value)) continue;
    reported.add(n.value);
    if (cutValues.has(n.value)) {
      c.error("claims.cut_in_script", `The script still says "${n.raw}", which the claim ledger marks CUT.`, { path: "body", fix: "Remove it from the script." });
    } else {
      c.error("claims.unlisted_number", `The script says "${n.raw}", but no PASS claim in the ledger backs it.`, {
        path: "body",
        fix: "Add a PASS claim with its source (proof inventory item or cited source), or cut the number.",
      });
    }
  }

  // Source texts: no 4+ consecutive words copied.
  for (const src of rules.sourceTexts ?? []) c.merge(checkCopiedFromSource(body, src.text, { sourceId: src.id }));

  // Captions.
  if (pkg.captions) {
    c.merge(validateCaptions(pkg.captions, { ...rules.captions, ctaType: pkg.cta.type, bannedPhrases: rules.bannedPhrases }), "captions");
  } else if (rules.requireCaptions !== false) {
    c.error("captions.missing", "The package has no captions.", { path: "captions", fix: "Add youtube, instagram and tiktok captions (strict JSON)." });
  }

  // On-screen rules: no real prompt wording, onScreen present once captioned, and the concept's format (second-1 caption per
  // lane, closer caption) when it has one (read from the raw package: onScreen, lane and stage are not part of the schema above).
  c.merge(checkPlaybookOnScreen(input, { lane: rules.lane, publishDate: rules.publishDate, requireOnScreen: rules.requireOnScreen, onScreen: rules.onScreen }));

  return c.result();
}

const BEAT_FIX: Record<BeatRole, string> = {
  hook: "Open with the whole claim in one sentence, said in the first 3 seconds.",
  turn: "After the hook, name the problem or flip the expectation in a line or two.",
  proof: "Add a proof beat with one real number from the proof inventory.",
  rehook: "Between 25 and 40% of the way in, add a line that raises the stakes or teases a bigger reveal.",
  play: "Give the play: the concrete thing to do, step by step.",
  close: "End with a line that calls back to the hook, then the CTA.",
};
