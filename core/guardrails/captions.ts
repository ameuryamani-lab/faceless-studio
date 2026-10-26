// Ported from AttentionOS by Evan Baker (MIT), commit 89f67813, packages/guardrails/src/captions.ts. See licences/NOTICE.
// Faceless Studio adaptation: only youtube, instagram, tiktok; zod replaced by ./schema.ts; comment-keyword / DM / lead
// logic dropped; hard per-platform limits added (YouTube title <= 100, Instagram <= 2200 chars and <= 30 hashtags,
// TikTok <= 2200 chars).
import { z } from "./schema.ts";
import { IssueCollector, schemaIssuesToIssues, type ValidationResult } from "./issues.ts";
import { EM_DASH, EN_DASH, findAllPhrases, truncate } from "./text.ts";

export const CAPTION_PLATFORMS = ["youtube", "instagram", "tiktok"] as const;
export type CaptionPlatform = (typeof CAPTION_PLATFORMS)[number];

/** CTA types a faceless channel uses (no comment-keyword, DM or book-a-call funnels). */
export const CTA_TYPE_VALUES = ["follow", "save_share", "none"] as const;
export type CtaType = (typeof CTA_TYPE_VALUES)[number];

const hashtags = z.array(z.string()).default([]);
export const youtubeCaptionSchema = z.strictObject({ title: z.string().min(1), description: z.string().default(""), hashtags });
export const instagramCaptionSchema = z.strictObject({ caption: z.string().min(1), hashtags });
export const tiktokCaptionSchema = z.strictObject({ caption: z.string().min(1), hashtags });
export const captionsSchema = z.strictObject({
  youtube: youtubeCaptionSchema.optional(),
  instagram: instagramCaptionSchema.optional(),
  tiktok: tiktokCaptionSchema.optional(),
});

export type PlatformCaption = { title?: string; description?: string; caption?: string; hashtags?: string[] };
export type Captions = Partial<Record<CaptionPlatform, PlatformCaption>>;

/** Hard limits per platform (composed caption: text plus hashtags). */
export const CAPTION_LIMITS: Record<CaptionPlatform, number> = {
  youtube: 5000, // description limit
  instagram: 2200,
  tiktok: 2200, // verify: TikTok has changed this limit several times (150, 2200, 4000); 2200 is the safe floor.
};
/** YouTube title: at most 100 characters. */
export const YOUTUBE_TITLE_MAX = 100;
/** Instagram rejects a caption with more than 30 hashtags. */
export const INSTAGRAM_HASHTAG_MAX = 30;

/** Recommended niche range (warning only); the hard caps above are errors. */
export const DEFAULT_HASHTAG_RANGE: Record<CaptionPlatform, { min: number; max: number }> = {
  youtube: { min: 1, max: 5 },
  instagram: { min: 3, max: 5 },
  tiktok: { min: 3, max: 5 },
};

/** Broad reach-bait tags that say nothing about the niche. */
export const GENERIC_HASHTAGS = new Set([
  "#fyp", "#foryou", "#foryoupage", "#fypage", "#viral", "#explore", "#explorepage", "#reels", "#reel", "#reelsinstagram",
  "#instagood", "#trending", "#tiktok", "#follow", "#like", "#likeforlike", "#followme", "#instadaily",
]);

export const HASHTAG_RE = /^#[\p{L}\p{N}_]+$/u;

export type CaptionContext = {
  ctaType?: CtaType;
  /** Platforms that must be present. Default: all three. */
  platforms?: readonly CaptionPlatform[];
  bannedPhrases?: readonly string[];
  hashtagPool?: readonly string[];
  hashtagRange?: Partial<Record<CaptionPlatform, { min: number; max: number }>>;
  allowDashes?: boolean;
};

function captionText(platform: CaptionPlatform, c: PlatformCaption): { field: string; text: string } {
  if (platform === "youtube") return { field: "description", text: String(c.description ?? "") };
  return { field: "caption", text: String(c.caption ?? "") };
}

/** Joins a platform caption's text and hashtags the way it will be published. */
export function composeCaption(platform: CaptionPlatform, caption: PlatformCaption): string {
  const { text } = captionText(platform, caption);
  const tags = (caption.hashtags ?? []).join(" ");
  return tags ? `${text.trim()}\n\n${tags}` : text.trim();
}

export function validateHashtags(
  tags: readonly string[],
  opts: { min: number; max: number; hardMax?: number; pool?: readonly string[]; path?: string; where?: string },
): ValidationResult {
  const c = new IssueCollector();
  const where = opts.where ? ` on ${opts.where}` : "";
  if (opts.hardMax !== undefined && tags.length > opts.hardMax) {
    c.error("hashtags.over_platform_limit", `${tags.length} hashtags${where}; the platform allows at most ${opts.hardMax}.`, { path: opts.path, fix: `Drop at least ${tags.length - opts.hardMax}.` });
  } else if (tags.length < opts.min || tags.length > opts.max) {
    c.warn("hashtags.count", `${tags.length} hashtag${tags.length === 1 ? "" : "s"}${where}; ${opts.min} to ${opts.max} niche tags work best.`, {
      path: opts.path,
      fix: tags.length < opts.min ? "Add niche tags that say what the video is about." : "Keep the most specific tags and drop the rest.",
    });
  }
  const seen = new Set<string>();
  const pool = opts.pool && opts.pool.length > 0 ? new Set(opts.pool.map((p) => (p.startsWith("#") ? p : `#${p}`).toLowerCase())) : null;
  tags.forEach((tag, i) => {
    const p = opts.path ? `${opts.path}[${i}]` : undefined;
    if (!HASHTAG_RE.test(tag)) {
      c.error("hashtags.format", `"${tag}" isn't a valid hashtag${where}: # followed by letters, numbers or underscores.`, { path: p, fix: `Write it as #${tag.replace(/[^\p{L}\p{N}_]/gu, "")}.` });
      return;
    }
    const k = tag.toLowerCase();
    if (seen.has(k)) c.error("hashtags.duplicate", `${tag} is listed twice${where}.`, { path: p, fix: "Remove the repeat." });
    seen.add(k);
    if (GENERIC_HASHTAGS.has(k)) c.warn("hashtags.generic", `${tag} is a broad reach tag${where}.`, { path: p, fix: "Swap it for a niche tag about the topic." });
    if (pool && !pool.has(k)) c.warn("hashtags.not_in_pool", `${tag}${where} isn't in the brand's hashtag pool.`, { path: p, fix: "Use a tag from the pool, or add it to the pool." });
  });
  return c.result();
}

/** Hard per-platform limits only (used by the publish payload check and by validateCaptions). */
export function checkPlatformLimits(platform: CaptionPlatform, cap: PlatformCaption, path: string = platform): ValidationResult {
  const c = new IssueCollector();
  const tags = cap.hashtags ?? [];
  if (platform === "youtube") {
    const title = String(cap.title ?? "");
    if (!title.trim()) c.error("captions.youtube_title_missing", "YouTube needs a title.", { path: `${path}.title`, fix: "Write a title of at most 100 characters." });
    else if ([...title].length > YOUTUBE_TITLE_MAX) {
      c.error("captions.youtube_title_length", `The YouTube title is ${[...title].length} characters; the limit is ${YOUTUBE_TITLE_MAX}.`, { path: `${path}.title`, fix: `Cut ${[...title].length - YOUTUBE_TITLE_MAX} characters.` });
    }
  }
  const len = [...composeCaption(platform, cap)].length;
  if (len > CAPTION_LIMITS[platform]) {
    c.error("captions.too_long", `The ${label(platform)} caption is ${len} characters with hashtags; the limit is ${CAPTION_LIMITS[platform]}.`, {
      path: `${path}.${captionText(platform, cap).field}`,
      fix: `Cut ${len - CAPTION_LIMITS[platform]} characters.`,
    });
  }
  if (platform === "instagram" && tags.length > INSTAGRAM_HASHTAG_MAX) {
    c.error("captions.instagram_hashtag_limit", `The Instagram caption has ${tags.length} hashtags; Instagram allows at most ${INSTAGRAM_HASHTAG_MAX}.`, { path: `${path}.hashtags`, fix: `Drop ${tags.length - INSTAGRAM_HASHTAG_MAX} hashtags.` });
  }
  return c.result();
}

export function validateCaptions(captions: unknown, ctx: CaptionContext = {}): ValidationResult {
  const c = new IssueCollector();
  const parsed = captionsSchema.safeParse(captions);
  if (!parsed.success) {
    for (const issue of schemaIssuesToIssues(parsed.error.issues, "captions")) {
      c.error(issue.code, `Captions JSON has the wrong shape: ${issue.message}.`, {
        path: issue.path,
        fix: "Return exactly {youtube:{title,description,hashtags}, instagram:{caption,hashtags}, tiktok:{caption,hashtags}} with no extra keys.",
      });
    }
    return c.result();
  }
  const caps = parsed.data as Captions;
  for (const p of ctx.platforms ?? CAPTION_PLATFORMS) {
    if (!caps[p]) c.error("captions.missing_platform", `There is no ${label(p)} caption.`, { path: p, fix: `Add the ${label(p)} entry.` });
  }
  for (const platform of CAPTION_PLATFORMS) {
    const cap = caps[platform];
    if (!cap) continue;
    const { field, text } = captionText(platform, cap);
    const tags = cap.hashtags ?? [];
    c.merge(checkPlatformLimits(platform, cap));
    if (/(^|\s)#[\p{L}\p{N}_]+/u.test(text)) {
      c.error("captions.inline_hashtags", `The ${label(platform)} ${field} has hashtags written inside the text.`, { path: `${platform}.${field}`, fix: "Move them to the hashtags list." });
    }
    const range = ctx.hashtagRange?.[platform] ?? DEFAULT_HASHTAG_RANGE[platform];
    c.merge(validateHashtags(tags, { ...range, hardMax: platform === "instagram" ? INSTAGRAM_HASHTAG_MAX : undefined, pool: ctx.hashtagPool, path: `${platform}.hashtags`, where: label(platform) }));
    if (platform === "instagram" && /https?:\/\/\S+/i.test(text)) {
      c.warn("captions.instagram_link", "The Instagram caption has a link, but links in Instagram captions aren't clickable.", { path: "instagram.caption", fix: "Remove it." });
    }
    const all = platform === "youtube" ? `${String(cap.title ?? "")}\n${text}` : text;
    for (const hit of findAllPhrases(all, ctx.bannedPhrases ?? [])) {
      c.error("captions.banned_phrase", `The ${label(platform)} caption says "${hit.match}", which is on the brand's banned list.`, { path: `${platform}.${field}`, fix: "Rewrite that part in plain words." });
    }
    if (!ctx.allowDashes && (all.includes(EM_DASH) || all.includes(EN_DASH))) {
      c.error("captions.dash", `The ${label(platform)} caption has a long dash ("${truncate(all.slice(Math.max(0, all.search(/[–—]/) - 15)), 40)}").`, { path: `${platform}.${field}`, fix: "Use a period or a comma instead." });
    }
  }
  return c.result();
}

function label(p: CaptionPlatform): string {
  return { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" }[p];
}
export { label as platformLabel };
