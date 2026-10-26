// Faceless Studio: on-screen text rules of a script package (the voice_writer's onScreen block).
// Deterministic, read by run_script_guard and save_script. The studio ships no show, so no lane, opener or closer caption is
// written here: they come from the video's concept (concept/<id>/concept.json "on_screen", see OnScreenFormat below). Without a
// concept format only the show-independent rules run:
//  - no real platform prompt wording (a fake "Skip Ad" or CAPTCHA prompt misleads the viewer), in every viewer-facing field;
//  - the onScreen block must be there once the package is captioned.
// With a concept format, also: the lane's second-1 caption (and chip), exclusive openers kept to their own lane, the closer caption.
import { IssueCollector, type ValidationResult } from "./issues.ts";
import { collapseSpace, normalizeQuotes } from "./text.ts";

/** Never real prompt wording on screen or in the words (show-independent). */
export const REAL_PROMPT_WORDINGS = ["Verify you are human", "I'm not a robot", "Skip Ad", "Are you still watching?"] as const;
/** "Second 1" = an item starting before 1.0 s of the hook beat; a chip may land exactly on 1.0 s. */
const SECOND_ONE = 1;

/** One lane of a concept's on-screen format. Regexes are JavaScript sources, matched case-sensitively. */
export type OnScreenLane = {
  /** A caption starting in second 1 of the hook beat must match this. */
  opener: string;
  /** When set, a chip shown by 1.0 s of the hook beat must match this too. */
  chip?: string | null;
  /** The opener belongs to this lane only: it is refused on screen in any other lane. */
  exclusive?: boolean;
  /** One plain sentence telling the writer what the second-1 caption looks like (shown in the error). */
  hint?: string | null;
};

/** A concept's on-screen format (concept.json "on_screen"); null/absent = no show-specific on-screen rule. */
export type OnScreenFormat = {
  lanes?: Record<string, OnScreenLane> | null;
  /** The caption the close beat must show, or null for a free close. */
  closer?: string | null;
  /** Weekday (0 = Sunday … 6 = Saturday, studio calendar date) on which any closer caption is accepted, or null. */
  closer_variant_day?: number | null;
  /** A caption must start in second 1 of the hook beat (default true when a format is given). */
  second1_required?: boolean;
};

export type PlaybookRules = {
  /** The video's lane (brief.json / videos.lane); falls back to the package's own `lane`. */
  lane?: string | null;
  /** Planned publish date YYYY-MM-DD (brief.json slotDate / videos.planned_publish_date); see closer_variant_day. */
  publishDate?: string | null;
  /** The onScreen block must be there (voice_writer saves, stage "captioned"). */
  requireOnScreen?: boolean;
  /** The video's concept on-screen format; absent = only the show-independent rules. */
  onScreen?: OnScreenFormat | null;
};

type Item = { t?: unknown; text?: unknown };
type Entry = { beat?: unknown; captions?: Item[]; chips?: Item[]; labels?: Item[]; meters?: Item[]; cards?: Item[] };
type CompiledLane = { id: string; opener: RegExp; chip: RegExp | null; exclusive: boolean; hint: string | null };

const textOf = (x: Item) => collapseSpace(normalizeQuotes(typeof x?.text === "string" ? x.text : ""));
const timeOf = (x: Item) => (typeof x?.t === "number" ? x.t : Number.NaN);
const list = (v: unknown): Item[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
/** Lowercase letters, digits and spaces only: "I’m not a robot!" and "im not a robot" compare equal. */
const loose = (s: string) => ` ${normalizeQuotes(s).toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Every string under a value (objects and arrays walked), for the prompt-wording scan. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** Weekday (0 = Sunday) of a YYYY-MM-DD calendar date, or null when it is not one. */
export function weekdayOf(date: string | null | undefined): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}
export const isSundayDate = (date: string | null | undefined): boolean => weekdayOf(date) === 0;

/** Problems of a concept's on-screen format (empty = usable). Pure; core/concept.mjs reports them in French. */
export function onScreenFormatProblems(f: unknown): string[] {
  if (f === null || f === undefined) return [];
  if (typeof f !== "object" || Array.isArray(f)) return ["on_screen must be an object or null"];
  const fmt = f as OnScreenFormat;
  const p: string[] = [];
  const re = (src: unknown, at: string) => {
    if (typeof src !== "string" || !src.trim()) return p.push(`${at} must be a non-empty regex text`);
    try { new RegExp(src); } catch (e) { p.push(`${at} is not a valid regex (${(e as Error).message})`); }
    return 0;
  };
  if (fmt.lanes !== undefined && fmt.lanes !== null) {
    if (typeof fmt.lanes !== "object" || Array.isArray(fmt.lanes)) p.push("on_screen.lanes must be an object { lane id: lane }");
    else for (const [id, l] of Object.entries(fmt.lanes)) {
      if (!l || typeof l !== "object") { p.push(`on_screen.lanes.${id} must be an object`); continue; }
      re(l.opener, `on_screen.lanes.${id}.opener`);
      if (l.chip !== undefined && l.chip !== null) re(l.chip, `on_screen.lanes.${id}.chip`);
    }
  }
  if (fmt.closer !== undefined && fmt.closer !== null && (typeof fmt.closer !== "string" || !fmt.closer.trim())) p.push("on_screen.closer must be a text or null");
  const day = fmt.closer_variant_day;
  if (day !== undefined && day !== null && !(Number.isInteger(day) && day >= 0 && day <= 6)) p.push("on_screen.closer_variant_day must be 0 to 6 or null");
  return p;
}

function compileLanes(f: OnScreenFormat): CompiledLane[] {
  const out: CompiledLane[] = [];
  for (const [id, l] of Object.entries(f.lanes ?? {})) {
    try {
      out.push({ id, opener: new RegExp(l.opener), chip: l.chip ? new RegExp(l.chip) : null, exclusive: l.exclusive === true, hint: l.hint ?? null });
    } catch { /* an invalid lane is reported by onScreenFormatProblems (concept check); here it is skipped */ }
  }
  return out;
}

/** Fields that reach the viewer (notes such as captionNotes, hookAudit, factCheck are working notes and are skipped). */
const VIEWER_FIELDS = ["title", "body", "hookText", "newGag", "beats", "onScreen", "captions"] as const;

export function checkPromptWordings(pkg: Record<string, unknown>): ValidationResult {
  const c = new IssueCollector();
  for (const field of VIEWER_FIELDS) {
    const hay = strings(pkg[field]).map(loose).join(" | ");
    for (const w of REAL_PROMPT_WORDINGS) {
      if (hay.includes(loose(w))) {
        c.error("playbook.real_prompt_wording", `"${w}" is real prompt wording (in ${field}); a fake platform prompt misleads the viewer.`, {
          path: field, fix: "Use the show's own wording instead of a real platform prompt.",
        });
      }
    }
  }
  return c.result();
}

function checkSecondOne(c: IssueCollector, onScreen: Entry[], lanes: CompiledLane[], lane: CompiledLane | null, laneRaw: string, required: boolean): void {
  const hookIdx = Math.max(0, onScreen.findIndex((e) => e.beat === "hook"));
  const hook = onScreen[hookIdx];
  const caps = list(hook.captions).filter((x) => timeOf(x) < SECOND_ONE).map(textOf).filter(Boolean);
  const chips = list(hook.chips).filter((x) => timeOf(x) <= SECOND_ONE).map(textOf).filter(Boolean);
  const path = `onScreen[${hookIdx}].captions`;
  if (caps.length === 0) {
    if (required) c.error("playbook.second1_missing", "No caption starts in second 1 of the hook beat.", { path, fix: "Put the second-1 caption at t 0." });
    return;
  }
  if (lanes.length === 0) return;
  if (!lane) {
    c.warn("playbook.lane_unknown", `Lane "${laneRaw}" is not a lane of the concept's on_screen format, so the second-1 caption was not checked.`, { path: "lane" });
    return;
  }
  const others = lanes.filter((l) => l.exclusive && l.id !== lane.id);
  const openerOk = caps.some((s) => lane.opener.test(s) && !others.some((o) => o.opener.test(s)));
  const chipOk = !lane.chip || chips.some((s) => lane.chip!.test(s));
  if (openerOk && chipOk) return;
  const why = lane.hint ?? `${lane.id} opens on a caption matching /${lane.opener.source}/${lane.chip ? ` plus a chip matching /${lane.chip.source}/` : ""} in second 1.`;
  c.error("playbook.second1_caption", `Second-1 caption ${caps.map((s) => `"${s}"`).join(", ")} does not fit the lane: ${why}`, {
    path, fix: "Rewrite the second-1 caption per the concept's on-screen format for this lane.",
  });
}

function checkCloser(c: IssueCollector, onScreen: Entry[], f: OnScreenFormat, publishDate: string | null): void {
  if (!f.closer) return;
  const closer = collapseSpace(normalizeQuotes(f.closer));
  const closeIdx = onScreen.findIndex((e) => e.beat === "close");
  const at = closeIdx >= 0 ? closeIdx : onScreen.length - 1;
  const closeCaps = list(onScreen[at].captions).map(textOf).filter(Boolean);
  const variantDay = typeof f.closer_variant_day === "number" ? f.closer_variant_day : null;
  const variantOk = variantDay !== null && weekdayOf(publishDate) === variantDay && closeCaps.length > 0;
  if (closeCaps.includes(closer) || variantOk) return;
  const variantNote = variantDay === null ? "" : ` A variant is only allowed on a publish whose weekday is ${variantDay} (0 = Sunday)${publishDate ? `; publish date ${publishDate}` : ""}.`;
  c.error("playbook.closer_caption", `The close has no "${closer}" caption${closeCaps.length ? ` (it has ${closeCaps.map((s) => `"${s}"`).join(", ")})` : ""}.${variantNote}`, {
    path: `onScreen[${at}].captions`, fix: `Add the caption "${closer}" to the close beat.`,
  });
}

/** On-screen rules for one script package: show-independent ones always, the concept's format when given. */
export function checkPlaybookOnScreen(input: unknown, rules: PlaybookRules = {}): ValidationResult {
  const c = new IssueCollector();
  if (!input || typeof input !== "object" || Array.isArray(input)) return c.result();
  const pkg = input as Record<string, unknown>;
  c.merge(checkPromptWordings(pkg));

  const format = rules.onScreen && typeof rules.onScreen === "object" ? rules.onScreen : null;
  const onScreen = Array.isArray(pkg.onScreen) ? (pkg.onScreen as Entry[]).filter((e) => e && typeof e === "object") : null;
  const mustHave = rules.requireOnScreen || pkg.stage === "captioned";
  if (!onScreen || onScreen.length === 0) {
    if (mustHave) c.error("playbook.onscreen_missing", "The package has no onScreen block.", { path: "onScreen", fix: "Add one onScreen entry per beat (captions, chips, meters, cards)." });
    else c.warn("playbook.onscreen_pending", "No onScreen block yet: the on-screen rules are checked once the voice_writer adds it.", { path: "onScreen" });
    return c.result();
  }
  if (!format) return c.result();

  const lanes = compileLanes(format);
  const laneRaw = String(rules.lane ?? pkg.lane ?? "").trim();
  const lane = lanes.find((l) => l.id === laneRaw) ?? null;

  // Exclusive openers belong to their own lane only, anywhere on screen.
  const allText = onScreen.flatMap((e) => [...list(e.captions), ...list(e.chips), ...list(e.labels), ...list(e.meters), ...list(e.cards)].map(textOf));
  for (const other of lanes.filter((l) => l.exclusive && l.id !== lane?.id)) {
    if (allText.some((s) => other.opener.test(s))) {
      c.error("playbook.opener_wrong_lane", `The ${other.id} opener is for the ${other.id} lane only; this video's lane is ${lane?.id ?? "unknown"}.`, {
        path: "onScreen", fix: "Use the lane's own second-1 caption (the concept's on-screen format).",
      });
    }
  }

  checkSecondOne(c, onScreen, lanes, lane, laneRaw, format.second1_required !== false);
  checkCloser(c, onScreen, format, rules.publishDate ?? null);
  return c.result();
}
